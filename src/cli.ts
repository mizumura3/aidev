import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitAdapter } from "./adapters/git.js";
import { createGitHubAdapter } from "./adapters/github.js";
import { createLogger } from "./util/logger.js";
import { runWorkflow, type Persistence } from "./workflow/engine.js";
import { createStateHandlers } from "./workflow/states.js";
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
    .option("--no-merge", "Skip merge after CI passes")
    .option("--repo <owner/name>", "GitHub repo (owner/name)")
    .option("--claude-path <path>", "Path to native Claude Code executable")
    .action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const logger = createLogger("info");
      const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const cwd = opts.cwd;
      const repo = opts.repo ?? detectRepo(cwd);
      const branch = `devloop/issue-${opts.issue}`;

      const ctx: RunContext = {
        runId,
        issueNumber: opts.issue,
        repo,
        cwd,
        state: "init",
        branch,
        maxFixAttempts: opts.maxFixAttempts,
        fixAttempts: 0,
        dryRun: opts.dryRun,
        noMerge: !opts.merge,
      };

      const git = createGitAdapter();
      const github = createGitHubAdapter(repo);
      const handlers = createStateHandlers({ git, github, logger });
      const baseDir = join(
        process.env.HOME ?? "~",
        ".devloop",
        "runs"
      );
      const persistence = createFilePersistence(baseDir);

      logger.info("Starting devloop", { runId, issue: opts.issue, repo });

      const result = await runWorkflow(ctx, handlers, persistence, {
        onTransition: (from, to) =>
          logger.info("State transition", { from, to }),
      });

      if (result.state === "done") {
        logger.info("Devloop completed successfully", { runId });
      } else {
        logger.error("Devloop failed", { runId, state: result.state });
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
      const github = createGitHubAdapter(repo);

      logger.info("Watching for issues", { label: opts.label, repo });

      const processedIssues = new Set<number>();

      const poll = async () => {
        const issues = await github.listIssuesByLabel(opts.label);
        for (const issue of issues) {
          if (processedIssues.has(issue.number)) continue;
          processedIssues.add(issue.number);
          logger.info("Found new issue", {
            number: issue.number,
            title: issue.title,
          });

          // Spawn a run for this issue
          const { execaCommand } = await import("execa");
          const args = [
            "run",
            "--issue",
            String(issue.number),
            "--cwd",
            opts.cwd,
            "--repo",
            repo,
          ];
          execaCommand(`devloop ${args.join(" ")}`, {
            stdio: "inherit",
          }).catch((err) =>
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
