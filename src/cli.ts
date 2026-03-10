import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGitAdapter } from "./adapters/git.js";
import { createGitHubAdapter, type Issue, type PullRequest } from "./adapters/github.js";
import { createLogger } from "./util/logger.js";
import { runWorkflow, type Persistence } from "./workflow/engine.js";
import { createStateHandlers } from "./workflow/states.js";
import { runDocumenter } from "./agents/documenter.js";
import { createRunner } from "./agents/runner-factory.js";
import { DEFAULT_BACKEND } from "./agents/backend-config.js";
import type { BackendConfig } from "./agents/backend-config.js";
import { createSlackNotifier, formatSlackMessage } from "./adapters/slack.js";
import { loadRepoConfig } from "./config/repo-config.js";
import { writeAidevYml } from "./config/init.js";
import { runPreflightChecks } from "./preflight.js";
import { RunStateSchema, TERMINAL_STATES, isTerminalState, type RunContext, type RunState, type TerminalState } from "./types.js";
import { formatElapsed, formatProgressEvent } from "./agents/shared.js";
import { formatErrorDetails } from "./util/error.js";

function createFilePersistence(baseDir: string): Persistence {
  return {
    async save(ctx) {
      const dir = join(baseDir, ctx.runId);
      await mkdir(dir, { recursive: true });
      // Strip transient fields that are not JSON-serializable or not meaningful across sessions
      const { _abortSignal, _cliExplicit, ...serializable } = ctx;
      await writeFile(join(dir, "state.json"), JSON.stringify(serializable, null, 2));

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

function resolveBackendConfig(opts: { backend?: string; model?: string }): BackendConfig {
  return {
    backend: opts.backend ?? process.env.AIDEV_BACKEND ?? DEFAULT_BACKEND,
    model: opts.model ?? process.env.AIDEV_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  };
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
    .option("--max-review-rounds <n>", "Max review rounds (default: 1)", parseInt, 1)
    .option("--dry-run", "Skip push/PR/merge", false)
    .option("--auto-merge", "Merge PR and close issue after CI passes", false)
    .option("--base <branch>", "Base branch or tag to create branch from", "main")
    .option("--repo <owner/name>", "GitHub repo (owner/name)")
    .option("--claude-path <path>", "Path to native Claude Code executable")
    .option("--resume", "Resume the latest run for this target")
    .option("-y, --yes", "Skip interactive confirmation", false)
    .option("--allow-foreign-issues", "Allow processing issues or PRs from other users", false)
    .option("--verbose", "Emit JSONL progress lines to stderr for external agent observability", false)
    .option("--backend <name>", "Backend runner to use", DEFAULT_BACKEND)
    .option("--model <model>", "Model to use with the backend")
    .option("--language <lang>", "Output language (ja or en)", "ja");

  runCmd.action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const verbose = opts.verbose as boolean;
      const logger = createLogger({ minLevel: verbose ? "debug" : "info" });
      const baseDir = join(
        process.env.HOME ?? "~",
        ".aidev",
        "runs"
      );
      const persistence = createFilePersistence(baseDir);
      const targetKind = opts.pr != null ? "pr" : "issue";
      const targetNumber = targetKind === "pr" ? opts.pr : opts.issue;

      if (!opts.repo) {
        logger.error("--repo is required (e.g. --repo owner/name)");
        process.exit(1);
      }

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
          language: saved.language ?? "ja",
        };
        // If previous run completed as done (dry-run), restart from creating_pr
        // (commit already exists, just need push + PR)
        if (saved.state === "done" && saved.dryRun) {
          ctx.state = "creating_pr";
        }
        // If previous run was handed off due to timeout, resume from the timed-out state
        if (saved.state === "manual_handoff") {
          if (saved._timedOutState) {
            const parsed = RunStateSchema.safeParse(saved._timedOutState);
            if (parsed.success) {
              ctx.state = parsed.data;
            } else {
              logger.error("Invalid _timedOutState in saved run, falling back to init", {
                _timedOutState: saved._timedOutState,
              });
              ctx.state = "init";
            }
          } else {
            logger.warn("Resuming from manual_handoff with no _timedOutState, restarting from init");
            ctx.state = "init";
          }
          // Clear handoff metadata to avoid stale data in the resumed run
          delete ctx._timedOutState;
          delete ctx.handoffReason;
          // Clear only the timeout for the state that timed out to prevent
          // re-triggering. Other state timeouts remain in effect.
          if (ctx.stateTimeouts && saved._timedOutState) {
            const timedOutKey = saved._timedOutState as RunState;
            if (ctx.stateTimeouts[timedOutKey] != null) {
              logger.info("Clearing timeout for timed-out state", {
                state: timedOutKey,
                removedTimeout: ctx.stateTimeouts[timedOutKey],
                remainingTimeouts: Object.keys(ctx.stateTimeouts).filter(k => k !== timedOutKey),
              });
              delete ctx.stateTimeouts[timedOutKey];
              if (Object.keys(ctx.stateTimeouts).length === 0) {
                delete ctx.stateTimeouts;
              }
            }
          }
        }
      } else {
        const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const cwd = opts.cwd;
        const repo = opts.repo;
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
          maxReviewRounds: "max-review-rounds",
          dryRun: "dry-run",
          autoMerge: "auto-merge",
          base: "base",
          backend: "backend",
          model: "model",
          language: "language",
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
          maxReviewRounds: opts.maxReviewRounds,
          reviewRound: 0,
          dryRun: opts.dryRun,
          autoMerge: opts.autoMerge,
          language: opts.language,
          issueLabels: [],
          skipStates: [],
          skipAuthorCheck: opts.allowForeignIssues,
          _cliExplicit: cliExplicit.size > 0 ? cliExplicit : undefined,
        };
      }

      // Enable file logging now that runId is known
      const logDir = join(baseDir, ctx.runId);
      await mkdir(logDir, { recursive: true });
      logger.setLogFile(join(logDir, "run.log"));

      if (opts.resume) {
        logger.info("Resuming run", { runId: ctx.runId, fromState: ctx.state, targetKind, targetNumber });
      }

      const git = createGitAdapter();
      const github = createGitHubAdapter(ctx.repo);
      const backendConfig = resolveBackendConfig(opts);
      const runner = createRunner(backendConfig);
      const onProgress = verbose
        ? (message: import("./agents/runner.js").ProgressEvent) => {
            const line = formatProgressEvent("Agent", message);
            if (line) process.stderr.write(line + "\n");
          }
        : undefined;
      const handlers = createStateHandlers({
        git, github, logger, runner, runDocumenter, loadRepoConfig, onProgress,
        resolveRunner: (config) => createRunner(config),
      });

      const slackNotify = createSlackNotifier({
        webhookUrl: process.env.AIDEV_SLACK_WEBHOOK_URL,
        botToken: process.env.AIDEV_SLACK_BOT_TOKEN,
        channel: process.env.AIDEV_SLACK_CHANNEL,
      });

      // Create worktree for isolated work (always use original repo path, not ctx.cwd which may be stale from resume)
      const originalCwd = opts.cwd;
      const worktreePath = join(originalCwd, ".worktrees", `${targetKind}-${targetNumber}`);

      logger.info("Starting devloop", { runId: ctx.runId, targetKind, targetNumber, repo: ctx.repo });
      const workflowStart = performance.now();
      let lastKnownState = ctx.state;

      let exitCode = 0;
      let worktreeCreated = false;
      let resultState: string | undefined;

      // Determine whether to reuse existing worktree on resume.
      // Terminal states get a fresh worktree, except:
      // - done+dryRun (→creating_pr): needs existing changes preserved
      // - manual_handoff resume: state changed to _timedOutState, needs worktree
      const terminalStates = new Set<string>(TERMINAL_STATES);
      const shouldReuseWorktree = opts.resume
        && (!terminalStates.has(ctx.state) || (ctx.state === "done" && ctx.dryRun));

      try {
        if (shouldReuseWorktree) {
          if (!existsSync(worktreePath)) {
            // Worktree was deleted between handoff and resume (e.g. manual cleanup).
            // Uncommitted work is lost — recreate worktree and restart from init.
            logger.warn("Worktree not found for resume — recreating from scratch", {
              path: worktreePath,
              originalState: ctx.state,
            });
            await git.removeWorktree(worktreePath, originalCwd).catch(() => {});
            await git.addWorktree(worktreePath, ctx.base, originalCwd);
            ctx.state = "init";
            ctx.cwd = worktreePath;
            worktreeCreated = true;
          } else {
            ctx.cwd = worktreePath;
            worktreeCreated = true;
            logger.info("Reusing existing worktree for resume", { path: worktreePath });
          }
        } else {
          // Remove stale worktree from a previous interrupted run, if any
          await git.removeWorktree(worktreePath, originalCwd).catch(() => {});
          await git.addWorktree(worktreePath, ctx.base, originalCwd);
          worktreeCreated = true;
          ctx.cwd = worktreePath;
          logger.info("Created worktree", { path: worktreePath, base: ctx.base });
        }

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
            if (!isTerminalState(finalCtx.state)) return;
            const elapsedMs = Math.round(performance.now() - workflowStart);
            const message = formatSlackMessage({
              targetKind: finalCtx.targetKind,
              targetNumber: finalCtx.issueNumber ?? finalCtx.prNumber!,
              issueTitle: finalCtx.issueTitle,
              repo: finalCtx.repo,
              finalState: finalCtx.state,
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
        } else if (result.state === "manual_handoff") {
          logger.warn("Devloop handed off - needs human intervention", { runId: ctx.runId });
          resultState = result.state;
          const output = {
            status: "manual_handoff" as const,
            runId: result.runId,
            timedOutState: result._timedOutState,
            reason: result.handoffReason,
            worktreePath,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          exitCode = 1;
        } else if (result.state === "blocked") {
          logger.warn("Devloop blocked - needs human discussion", { runId: ctx.runId });
          const output = {
            status: "blocked" as const,
            runId: result.runId,
            reason: result.review?.reason ?? result.review?.summary,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          exitCode = 1;
        } else {
          logger.error("Devloop failed", { runId: ctx.runId, state: result.state });
          const output = {
            status: "failed" as const,
            runId: result.runId,
            failedAt: result.state,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          exitCode = 1;
        }
      } catch (err) {
        logger.error("Devloop crashed", { runId: ctx.runId, ...formatErrorDetails(err) });
        const output = {
          status: "failed" as const,
          runId: ctx.runId,
          failedAt: lastKnownState,
          error: err instanceof Error ? err.message : String(err),
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        exitCode = 1;
      } finally {
        // Preserve worktree if workflow reached manual_handoff (even if crash happened after)
        const shouldPreserve = resultState === "manual_handoff" || lastKnownState === "manual_handoff";
        if (worktreeCreated && !shouldPreserve) {
          await git.removeWorktree(worktreePath, originalCwd).catch((err) =>
            logger.error("Worktree cleanup failed", {
              path: worktreePath,
              error: String(err),
            })
          );
        }
        if (shouldPreserve) {
          logger.info("Worktree preserved for resume", { path: worktreePath });
        }
      }
      await logger.flush();
      if (exitCode !== 0) {
        process.exit(exitCode);
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
    .option("--backend <name>", "Backend runner to use", DEFAULT_BACKEND)
    .option("--model <model>", "Model to use with the backend")
    .option("--language <lang>", "Output language (ja or en)", "ja")
    .action(async (opts) => {
      if (opts.claudePath) process.env.CLAUDE_EXECUTABLE = opts.claudePath;
      const baseDir = join(process.env.HOME ?? "~", ".aidev", "runs");
      await mkdir(baseDir, { recursive: true });
      const logger = createLogger({
        minLevel: "info",
        logFilePath: join(baseDir, "watch.log"),
      });

      if (!opts.repo) {
        logger.error("--repo is required (e.g. --repo owner/name)");
        process.exit(1);
      }

      const repo = opts.repo;
      const cwd = opts.cwd;

      const git = createGitAdapter();
      const github = createGitHubAdapter(repo);
      const backendConfig = resolveBackendConfig(opts);
      const runner = createRunner(backendConfig);
      const persistence = createFilePersistence(baseDir);
      const handlers = createStateHandlers({
        git, github, logger, runner, runDocumenter, loadRepoConfig,
        resolveRunner: (config) => createRunner(config),
      });

      const slackNotify = createSlackNotifier({
        webhookUrl: process.env.AIDEV_SLACK_WEBHOOK_URL,
        botToken: process.env.AIDEV_SLACK_BOT_TOKEN,
        channel: process.env.AIDEV_SLACK_CHANNEL,
      });

      logger.info("Watching for issues", { label: opts.label, repo });

      const authenticatedUser = await github.getAuthenticatedUser();

      // Track issue status: allow retrying failed issues on next label scan
      const processedIssues = new Map<number, "running" | "done" | "failed">();
      let concurrentRuns = 0;
      let shuttingDown = false;
      const MAX_CONCURRENT_RUNS = 2;

      const poll = async () => {
        const issues = await github.listIssuesByLabel(opts.label);
        for (const issue of issues) {
          const status = processedIssues.get(issue.number);
          if (status === "running" || status === "done") continue;

          if (issue.author !== authenticatedUser) {
            logger.warn("Skipping foreign issue", {
              number: issue.number,
              author: issue.author,
              authenticatedUser,
            });
            processedIssues.set(issue.number, "done");
            continue;
          }

          if (concurrentRuns >= MAX_CONCURRENT_RUNS) {
            logger.info("Concurrency limit reached, deferring issue", {
              number: issue.number,
              concurrentRuns,
              max: MAX_CONCURRENT_RUNS,
            });
            continue;
          }

          logger.info("Found new issue", {
            number: issue.number,
            title: issue.title,
          });

          const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
          const worktreePath = join(cwd, ".worktrees", `issue-${issue.number}`);
          processedIssues.set(issue.number, "running");
          concurrentRuns++;

          const runIssue = async () => {
            const runLogDir = join(baseDir, runId);
            await mkdir(runLogDir, { recursive: true });
            const runLogger = createLogger({
              minLevel: "info",
              logFilePath: join(runLogDir, "run.log"),
            });

            await git.addWorktree(worktreePath, opts.base, cwd);
            let preserveWorktree = false;
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
                maxReviewRounds: 1,
                reviewRound: 0,
                dryRun: false,
                autoMerge: false,
                language: opts.language,
                issueLabels: issue.labels,
                skipStates: [],
                skipAuthorCheck: false,
              };

              const issueStart = performance.now();
              const result = await runWorkflow(ctx, handlers, persistence, {
                logger: runLogger,
                onTransition: (from, to) =>
                  runLogger.info("State transition", { from, to }),
                onComplete: async (finalCtx) => {
                  if (!isTerminalState(finalCtx.state)) return;
                  const elapsedMs = Math.round(performance.now() - issueStart);
                  const message = formatSlackMessage({
                    targetKind: finalCtx.targetKind,
                    targetNumber: finalCtx.issueNumber ?? finalCtx.prNumber!,
                    issueTitle: finalCtx.issueTitle,
                    repo: finalCtx.repo,
                    finalState: finalCtx.state,
                    elapsedMs,
                    prNumber: finalCtx.prNumber,
                  });
                  await slackNotify(message);
                },
              });

              if (result.state === "manual_handoff") {
                preserveWorktree = true;
                runLogger.warn("Issue handed off — worktree preserved for manual resume", {
                  issue: issue.number,
                  timedOutState: result._timedOutState,
                  reason: result.handoffReason,
                  worktreePath,
                  resumeCommand: `aidev run --issue ${issue.number} --repo ${repo} --cwd ${cwd} --resume --yes`,
                });
                // Mark as failed so re-labeling can trigger a retry
                processedIssues.set(issue.number, "failed");
              } else {
                processedIssues.set(issue.number, "done");
              }
            } catch (err) {
              processedIssues.set(issue.number, "failed");
              throw err;
            } finally {
              concurrentRuns--;
              if (shuttingDown && concurrentRuns === 0) {
                logger.info("All in-flight runs completed after shutdown signal, exiting");
                process.exit(0);
              }
              if (!preserveWorktree) {
                await git.removeWorktree(worktreePath, cwd).catch((err) =>
                  runLogger.error("Worktree cleanup failed", {
                    path: worktreePath,
                    error: String(err),
                  })
                );
              }
            }
          };

          runIssue().catch((err) =>
            logger.error("Run failed", {
              issue: issue.number,
              ...formatErrorDetails(err),
            })
          );
        }
      };

      await poll();
      const intervalId = setInterval(async () => {
        try {
          await poll();
        } catch (err) {
          logger.error("Poll cycle failed", { ...formatErrorDetails(err) });
        }
      }, opts.interval * 1000);

      // Graceful shutdown on SIGTERM/SIGINT
      const shutdown = () => {
        shuttingDown = true;
        clearInterval(intervalId);
        logger.info("Shutting down watch mode", { inFlightRuns: concurrentRuns });
        if (concurrentRuns === 0) process.exit(0);
        // In-flight runs will exit via the finally block when they complete
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
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
        ".aidev",
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
