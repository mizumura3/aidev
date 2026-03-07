import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGitAdapter } from "./adapters/git.js";
import { createGitHubAdapter, type Issue, type PullRequest } from "./adapters/github.js";
import { createLogger } from "./util/logger.js";
import { runWorkflow, type Persistence } from "./workflow/engine.js";
import { createStateHandlers } from "./workflow/states.js";
import { runDocumenter } from "./agents/documenter.js";
import { ClaudeCodeRunner } from "./agents/claude-code-runner.js";
import { createSlackNotifier, formatSlackMessage } from "./adapters/slack.js";
import { loadRepoConfig } from "./config/repo-config.js";
import { writeAidevYml } from "./config/init.js";
import { runPreflightChecks } from "./preflight.js";
import type { RunContext } from "./types.js";
import { formatElapsed, formatProgressEvent } from "./agents/shared.js";

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
    async findLatestByPr(prNumber) {
      const { readdir } = await import("node:fs/promises");
      let dirs: string[];
      try {
        dirs = await readdir(baseDir);
      } catch {
        return null;
      }
      dirs.sort().reverse();
      for (const dir of dirs) {
        try {
          const data = await readFile(join(baseDir, dir, "state.json"), "utf-8");
          const ctx = JSON.parse(data) as RunContext;
          if (ctx.prNumber === prNumber && ctx.targetKind === "pr") return ctx;
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

  const runCmd = program
    .command("run")
    .description("Run the full dev loop for an issue or pull request")
    .option("--issue <number>", "GitHub issue number", parseInt)
    .option("--pr <number>", "GitHub pull request number", parseInt)
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--max-fix-attempts <n>", "Max CI fix attempts", parseInt, 3)
    .option("--dry-run", "Skip push/PR/merge", false)
    .option("--auto-merge", "Merge PR and close issue after CI passes", false)
    .option("--base <branch>", "Base branch or tag to create branch from", "main")
    .option("--repo <owner/name>", "GitHub repo (owner/name)")
    .option("--claude-path <path>", "Path to native Claude Code executable")
    .option("--resume", "Resume the latest run for this target")
    .option("-y, --yes", "Skip interactive confirmation", false)
    .option("--allow-foreign-issues", "Allow processing issues or PRs from other users", false)
    .option("--verbose", "Emit JSONL progress lines to stderr for external agent observability", false);

  runCmd.action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const verbose = opts.verbose as boolean;
      const logger = createLogger(verbose ? "debug" : "info");
      const baseDir = join(
        process.env.HOME ?? "~",
        ".devloop",
        "runs"
      );
      const persistence = createFilePersistence(baseDir);
      const targetKind = opts.pr != null ? "pr" : "issue";
      const targetNumber = targetKind === "pr" ? opts.pr : opts.issue;

      if ((opts.issue == null && opts.pr == null) || (opts.issue != null && opts.pr != null)) {
        logger.error("Specify exactly one of --issue or --pr");
        process.exit(1);
      }

      let ctx: RunContext;

      await runPreflightChecks();

      if (opts.resume) {
        const saved =
          targetKind === "pr"
            ? await persistence.findLatestByPr?.(opts.pr)
            : await persistence.findLatestByIssue?.(opts.issue);
        if (!saved) {
          logger.error("No previous run found for target", { targetKind, targetNumber });
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
        logger.info("Resuming run", { runId: ctx.runId, fromState: ctx.state, targetKind, targetNumber });
      } else {
        const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const cwd = opts.cwd;
        const repo = opts.repo ?? detectRepo(cwd);
        const ghForConfirm = createGitHubAdapter(repo);

        let issue: Issue | undefined;
        let pr: PullRequest | undefined;
        let branch: string;

        if (targetKind === "pr") {
          pr = await ghForConfirm.getPr(opts.pr);
          branch = pr.headRefName;
        } else {
          issue = await ghForConfirm.getIssue(opts.issue);
          branch = `aidev/issue-${opts.issue}`;
        }

        const target = targetKind === "pr" ? pr! : issue!;

        if (!opts.yes) {
          if (process.stdin.isTTY) {
            const truncated = target.body && target.body.length > 500
              ? target.body.slice(0, 500) + "..."
              : target.body;
            console.log(`\n--- ${targetKind.toUpperCase()} #${target.number}: ${target.title} ---`);
            console.log(`Author: ${target.author}`);
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

        // Track which flags were explicitly set via CLI
        const cliExplicit = new Set<string>();
        const flagMap: Record<string, string> = {
          maxFixAttempts: "max-fix-attempts",
          dryRun: "dry-run",
          autoMerge: "auto-merge",
          base: "base",
        };
        for (const [ctxKey, cliName] of Object.entries(flagMap)) {
          if (runCmd.getOptionValueSource(cliName) === "cli") {
            cliExplicit.add(ctxKey);
          }
        }

        ctx = {
          runId,
          targetKind,
          issueNumber: opts.issue,
          prNumber: opts.pr,
          repo,
          cwd,
          state: "init",
          branch,
          headBranch: pr?.headRefName,
          base: opts.base,
          maxFixAttempts: opts.maxFixAttempts,
          fixAttempts: 0,
          dryRun: opts.dryRun,
          autoMerge: opts.autoMerge,
          issueLabels: [],
          skipStates: [],
          skipAuthorCheck: opts.allowForeignIssues,
          _cliExplicit: cliExplicit.size > 0 ? cliExplicit : undefined,
        };
      }

      const git = createGitAdapter();
      const github = createGitHubAdapter(ctx.repo);
      const runner = new ClaudeCodeRunner();
      const onProgress = verbose
        ? (message: import("./agents/runner.js").ProgressEvent) => {
            const line = formatProgressEvent("Agent", message);
            if (line) process.stderr.write(line + "\n");
          }
        : undefined;
      const handlers = createStateHandlers({ git, github, logger, runner, runDocumenter, loadRepoConfig, onProgress });

      const slackNotify = createSlackNotifier({
        webhookUrl: process.env.AIDEV_SLACK_WEBHOOK_URL,
        botToken: process.env.AIDEV_SLACK_BOT_TOKEN,
        channel: process.env.AIDEV_SLACK_CHANNEL,
      });

      logger.info("Starting devloop", { runId: ctx.runId, targetKind, targetNumber, repo: ctx.repo });
      const workflowStart = performance.now();
      let lastKnownState = ctx.state;

      try {
        const result = await runWorkflow(ctx, handlers, persistence, {
          logger,
          onTransition: (from, to, elapsedMs) => {
            lastKnownState = to;
            const elapsed = elapsedMs != null ? formatElapsed(elapsedMs) : undefined;
            logger.info("State transition", { from, to, ...(elapsed ? { elapsed } : {}) });
            if (verbose) {
              const line = formatProgressEvent("Workflow", {
                type: "state_transition" as any,
                from,
                to,
                ...(elapsed ? { elapsed } : {}),
              } as any);
              if (line) process.stderr.write(line + "\n");
            }
          },
          onComplete: async (finalCtx) => {
            const elapsedMs = Math.round(performance.now() - workflowStart);
            const message = formatSlackMessage({
              targetKind: finalCtx.targetKind,
              targetNumber: finalCtx.issueNumber ?? finalCtx.prNumber!,
              issueTitle: finalCtx.issueTitle,
              repo: finalCtx.repo,
              finalState: finalCtx.state as "done" | "failed",
              elapsedMs,
              prNumber: finalCtx.prNumber,
            });
            await slackNotify(message);
          },
        });

        if (result.state === "done") {
          logger.info("Devloop completed successfully", { runId: ctx.runId });
          const output = {
            status: "done" as const,
            runId: result.runId,
            prNumber: result.prNumber,
            changedFiles: result.result?.changedFiles,
            summary: result.result?.changeSummary,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
        } else {
          logger.error("Devloop failed", { runId: ctx.runId, state: result.state });
          const output = {
            status: "failed" as const,
            runId: result.runId,
            failedAt: result.state,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          process.exit(1);
        }
      } catch (err) {
        logger.error("Devloop crashed", { runId: ctx.runId, error: String(err) });
        const output = {
          status: "failed" as const,
          runId: ctx.runId,
          failedAt: lastKnownState,
          error: err instanceof Error ? err.message : String(err),
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(1);
      }
    });

  program
    .command("watch")
    .description("Watch for issues with a label and process them")
    .option("--label <label>", "Label to watch", "ai:run")
    .option("--interval <seconds>", "Poll interval in seconds", parseInt, 30)
    .option("--cwd <path>", "Working directory", process.cwd())
    .option("--base <branch>", "Base branch or tag to create worktrees from", "main")
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
      const runner = new ClaudeCodeRunner();
      const persistence = createFilePersistence(baseDir);
      const handlers = createStateHandlers({ git, github, logger, runner, runDocumenter, loadRepoConfig });

      const slackNotify = createSlackNotifier({
        webhookUrl: process.env.AIDEV_SLACK_WEBHOOK_URL,
        botToken: process.env.AIDEV_SLACK_BOT_TOKEN,
        channel: process.env.AIDEV_SLACK_CHANNEL,
      });

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
            await git.addWorktree(worktreePath, opts.base, cwd);
            try {
              const ctx: RunContext = {
                runId,
                targetKind: "issue",
                issueNumber: issue.number,
                repo,
                cwd: worktreePath,
                state: "init",
                branch: `aidev/issue-${issue.number}`,
                base: opts.base,
                maxFixAttempts: 3,
                fixAttempts: 0,
                dryRun: false,
                autoMerge: false,
                issueLabels: issue.labels,
                skipStates: [],
                skipAuthorCheck: false,
              };

              const issueStart = performance.now();
              await runWorkflow(ctx, handlers, persistence, {
                logger,
                onTransition: (from, to) =>
                  logger.info("State transition", { from, to }),
                onComplete: async (finalCtx) => {
                  const elapsedMs = Math.round(performance.now() - issueStart);
                  const message = formatSlackMessage({
                    targetKind: finalCtx.targetKind,
                    targetNumber: finalCtx.issueNumber ?? finalCtx.prNumber!,
                    issueTitle: finalCtx.issueTitle,
                    repo: finalCtx.repo,
                    finalState: finalCtx.state as "done" | "failed",
                    elapsedMs,
                    prNumber: finalCtx.prNumber,
                  });
                  await slackNotify(message);
                },
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
    .command("init")
    .description("Generate a .aidev.yml config file in the target directory")
    .option("--cwd <path>", "Target directory", process.cwd())
    .option("--force", "Overwrite existing .aidev.yml", false)
    .action(async (opts) => {
      await writeAidevYml(opts.cwd, opts.force);
      console.log(`Created .aidev.yml in ${opts.cwd}`);
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
