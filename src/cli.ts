import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGitAdapter } from "./adapters/git.js";
import { createGitHubAdapter, type Issue } from "./adapters/github.js";
import { createLogger } from "./util/logger.js";
import { runWorkflow, type Persistence } from "./workflow/engine.js";
import { createStateHandlers } from "./workflow/states.js";
import { runDocumenter } from "./agents/documenter.js";
import type { RunContext } from "./types.js";

function createFilePersistence(baseDir: string): Persistence {
  return {
    async save(ctx) {
      const dir = join(baseDir, ctx.runId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "state.json"), JSON.stringify(ctx, null, 2));

      if (ctx.plan)
        await writeFile(
          join(dir, "plan.json"),
          JSON.stringify(ctx.plan, null, 2)
        );
      if (ctx.result)
        await writeFile(
          join(dir, "result.json"),
          JSON.stringify(ctx.result, null, 2)
        );
      if (ctx.review)
        await writeFile(
          join(dir, "review.json"),
          JSON.stringify(ctx.review, null, 2)
        );
      if (ctx.fix)
        await writeFile(
          join(dir, "fix.json"),
          JSON.stringify(ctx.fix, null, 2)
        );
    },
    async load(runId) {
      try {
        const data = await readFile(
          join(baseDir, runId, "state.json"),
          "utf-8"
        );
        return JSON.parse(data) as RunContext;
      } catch {
        return null;
      }
    },
    async findLatestByIssue(issueNumber) {
      const { readdir } = await import("node:fs/promises");
      let dirs: string[];
      try {
        dirs = await readdir(baseDir);
      } catch {
        return null;
      }
      // Sort descending by timestamp (embedded in dir name)
      dirs.sort().reverse();
      for (const dir of dirs) {
        try {
          const data = await readFile(join(baseDir, dir, "state.json"), "utf-8");
          const ctx = JSON.parse(data) as RunContext;
          if (ctx.issueNumber === issueNumber) return ctx;
        } catch {
          continue;
        }
      }
      return null;
    },
  };
}

function detectRepo(cwd: string): string {
  // Try to detect from git remote, fallback to env
  return process.env.DEVLOOP_REPO ?? "mizumura3/inko";
}

export function createCli() {
  const program = new Command();

  program.name("aidev").description("AI-powered development loop").version("0.0.1");

  program
    .command("run")
    .description("Run the full dev loop for an issue")
    .requiredOption("--issue <number>", "GitHub issue number", parseInt)
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--max-fix-attempts <n>", "Max CI fix attempts", parseInt, 3)
    .option("--dry-run", "Skip push/PR/merge", false)
    .option("--auto-merge", "Merge PR and close issue after CI passes", false)
    .option("--repo <owner/name>", "GitHub repo (owner/name)")
    .option("--claude-path <path>", "Path to native Claude Code executable")
    .option("--resume", "Resume the latest run for this issue")
    .option("-y, --yes", "Skip interactive confirmation", false)
    .option("--allow-foreign-issues", "Allow processing issues from other users", false)
    .action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const logger = createLogger("info");
      const baseDir = join(
        process.env.HOME ?? "~",
        ".devloop",
        "runs"
      );
      const persistence = createFilePersistence(baseDir);

      let ctx: RunContext;

      if (opts.resume) {
        const saved = await persistence.findLatestByIssue!(opts.issue);
        if (!saved) {
          logger.error("No previous run found for issue", { issue: opts.issue });
          process.exit(1);
        }
        // Override flags for resumed run
        ctx = {
          ...saved,
          dryRun: opts.dryRun,
          autoMerge: opts.autoMerge,
        };
        // If previous run completed as done (dry-run), restart from creating_pr
        // (commit already exists, just need push + PR)
        if (saved.state === "done" && saved.dryRun) {
          ctx.state = "creating_pr";
        }
        logger.info("Resuming run", { runId: ctx.runId, fromState: ctx.state, issue: opts.issue });
      } else {
        const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const cwd = opts.cwd;
        const repo = opts.repo ?? detectRepo(cwd);
        const branch = `aidev/issue-${opts.issue}`;

        // Fetch issue for confirmation
        const ghForConfirm = createGitHubAdapter(repo);
        const issue = await ghForConfirm.getIssue(opts.issue);

        if (!opts.yes) {
          if (process.stdin.isTTY) {
            const truncated = issue.body && issue.body.length > 500
              ? issue.body.slice(0, 500) + "..."
              : issue.body;
            console.log(`\n--- Issue #${issue.number}: ${issue.title} ---`);
            console.log(`Author: ${issue.author}`);
            if (truncated) console.log(`\n${truncated}\n`);

            const confirmed = await new Promise<boolean>((resolve) => {
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              rl.question("Proceed with this issue? (y/N) ", (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === "y");
              });
            });

            if (!confirmed) {
              logger.info("Cancelled by user");
              process.exit(0);
            }
          } else {
            logger.info("Non-interactive mode: skipping confirmation (use --yes to suppress this message)");
          }
        }

        ctx = {
          runId,
          issueNumber: opts.issue,
          repo,
          cwd,
          state: "init",
          branch,
          maxFixAttempts: opts.maxFixAttempts,
          fixAttempts: 0,
          dryRun: opts.dryRun,
          autoMerge: opts.autoMerge,
          issueLabels: [],
          skipAuthorCheck: opts.allowForeignIssues,
        };
      }

      const git = createGitAdapter();
      const github = createGitHubAdapter(ctx.repo);
      const handlers = createStateHandlers({ git, github, logger, runDocumenter });

      logger.info("Starting devloop", { runId: ctx.runId, issue: opts.issue, repo: ctx.repo });

      const result = await runWorkflow(ctx, handlers, persistence, {
        logger,
        onTransition: (from, to) =>
          logger.info("State transition", { from, to }),
      });

      if (result.state === "done") {
        logger.info("Devloop completed successfully", { runId: ctx.runId });
      } else {
        logger.error("Devloop failed", { runId: ctx.runId, state: result.state });
        process.exit(1);
      }
    });

  program
    .command("watch")
    .description("Watch for issues with a label and process them")
    .option("--label <label>", "Label to watch", "ai:run")
    .option("--interval <seconds>", "Poll interval in seconds", parseInt, 30)
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--repo <owner/name>", "GitHub repo (owner/name)")
    .option("--claude-path <path>", "Path to native Claude Code executable")
    .action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const logger = createLogger("info");
      const repo = opts.repo ?? detectRepo(opts.cwd);
      const cwd = opts.cwd;
      const baseDir = join(process.env.HOME ?? "~", ".devloop", "runs");

      const git = createGitAdapter();
      const github = createGitHubAdapter(repo);
      const persistence = createFilePersistence(baseDir);
      const handlers = createStateHandlers({ git, github, logger, runDocumenter });

      logger.info("Watching for issues", { label: opts.label, repo });

      const authenticatedUser = await github.getAuthenticatedUser();
      const processedIssues = new Set<number>();

      const poll = async () => {
        const issues = await github.listIssuesByLabel(opts.label);
        for (const issue of issues) {
          if (processedIssues.has(issue.number)) continue;
          processedIssues.add(issue.number);

          if (issue.author !== authenticatedUser) {
            logger.warn("Skipping foreign issue", {
              number: issue.number,
              author: issue.author,
              authenticatedUser,
            });
            continue;
          }

          logger.info("Found new issue", {
            number: issue.number,
            title: issue.title,
          });

          const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
          const worktreePath = join(cwd, ".worktrees", `issue-${issue.number}`);

          const runIssue = async () => {
            await git.addWorktree(worktreePath, "main", cwd);
            try {
              const ctx: RunContext = {
                runId,
                issueNumber: issue.number,
                repo,
                cwd: worktreePath,
                state: "init",
                branch: `aidev/issue-${issue.number}`,
                maxFixAttempts: 3,
                fixAttempts: 0,
                dryRun: false,
                autoMerge: false,
                issueLabels: issue.labels,
                skipAuthorCheck: false,
              };

              await runWorkflow(ctx, handlers, persistence, {
                logger,
                onTransition: (from, to) =>
                  logger.info("State transition", { from, to }),
              });
            } finally {
              await git.removeWorktree(worktreePath, cwd).catch((err) =>
                logger.error("Worktree cleanup failed", {
                  path: worktreePath,
                  error: String(err),
                })
              );
            }
          };

          runIssue().catch((err) =>
            logger.error("Run failed", {
              issue: issue.number,
              error: String(err),
            })
          );
        }
      };

      await poll();
      setInterval(poll, opts.interval * 1000);
    });

  program
    .command("status")
    .description("Show status of a run")
    .argument("<run-id>", "Run ID")
    .action(async (runId) => {
      const baseDir = join(
        process.env.HOME ?? "~",
        ".devloop",
        "runs"
      );
      const persistence = createFilePersistence(baseDir);
      const ctx = await persistence.load(runId);
      if (!ctx) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(ctx, null, 2));
    });

  return program;
}
