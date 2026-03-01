import type { StateHandler, RunContext, RunState } from "../types.js";
import type { StateHandlerMap } from "./engine.js";
import type { GitAdapter } from "../adapters/git.js";
import type { GitHubAdapter } from "../adapters/github.js";
import { runPlanner } from "../agents/planner.js";
import { runImplementer } from "../agents/implementer.js";
import { runReviewer } from "../agents/reviewer.js";
import { runFixer } from "../agents/fixer.js";
import type { Logger } from "../util/logger.js";

export interface Deps {
  git: GitAdapter;
  github: GitHubAdapter;
  logger: Logger;
}

function transition(
  ctx: RunContext,
  nextState: RunState,
  patch?: Partial<RunContext>
) {
  return { nextState, ctx: { ...ctx, ...patch, state: nextState } };
}

function shouldAutoMerge(ctx: RunContext): boolean {
  return ctx.autoMerge || ctx.issueLabels.includes("auto-merge");
}

export function createStateHandlers(deps: Deps): StateHandlerMap {
  const { git, github, logger } = deps;

  const init: StateHandler = async (ctx) => {
    const issue = await github.getIssue(ctx.issueNumber);
    logger.info("Fetched issue", {
      number: issue.number,
      title: issue.title,
    });
    await git.createBranch(ctx.branch, ctx.cwd);
    logger.info("Created branch", { branch: ctx.branch });
    return transition(ctx, "planning", { issueLabels: issue.labels });
  };

  const planning: StateHandler = async (ctx) => {
    const issue = await github.getIssue(ctx.issueNumber);
    const planStart = performance.now();
    const plan = await runPlanner({ issue, cwd: ctx.cwd }, logger);
    const planElapsed = Math.round(performance.now() - planStart);
    logger.info("Plan created", { summary: plan.summary, agentElapsedMs: planElapsed });

    if (plan.investigation) {
      const comment = `## 🔍 Investigation\n\n${plan.investigation}\n\n## Plan\n\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
      await github.commentOnIssue(ctx.issueNumber, comment);
      logger.info("Posted investigation to issue", { issue: ctx.issueNumber });
    }

    return transition(ctx, "implementing", { plan });
  };

  const implementing: StateHandler = async (ctx) => {
    if (!ctx.plan) throw new Error("No plan available");
    const implStart = performance.now();
    const result = await runImplementer(
      { plan: ctx.plan, issueNumber: ctx.issueNumber, cwd: ctx.cwd },
      logger
    );
    const implElapsed = Math.round(performance.now() - implStart);
    logger.info("Implementation complete", {
      changedFiles: result.changedFiles,
      agentElapsedMs: implElapsed,
    });
    return transition(ctx, "reviewing", { result });
  };

  const reviewing: StateHandler = async (ctx) => {
    if (!ctx.plan) throw new Error("No plan available");
    const diff = await git.diff("main", ctx.cwd);
    const reviewStart = performance.now();
    const review = await runReviewer(
      { plan: ctx.plan, diff, cwd: ctx.cwd },
      logger
    );
    const reviewElapsed = Math.round(performance.now() - reviewStart);
    logger.info("Review complete", { decision: review.decision, agentElapsedMs: reviewElapsed });

    if (review.decision === "changes_requested") {
      return transition(ctx, "implementing", { review });
    }
    return transition(ctx, "committing", { review });
  };

  const committing: StateHandler = async (ctx) => {
    if (!ctx.result) throw new Error("No result available");
    await git.addAll(ctx.cwd);
    await git.commit(ctx.result.commitMessageDraft, ctx.cwd);
    logger.info("Committed changes");

    if (ctx.dryRun) {
      logger.info("Dry run - skipping push and PR creation");
      return transition(ctx, "done");
    }
    return transition(ctx, "creating_pr");
  };

  const creating_pr: StateHandler = async (ctx) => {
    if (!ctx.result) throw new Error("No result available");
    await git.push(ctx.branch, ctx.cwd);
    const prNumber = await github.createPr({
      title: ctx.result.commitMessageDraft.split("\n")[0]!,
      body: ctx.result.prBodyDraft,
      head: ctx.branch,
      base: "main",
    });
    logger.info("PR created", { prNumber });
    return transition(ctx, "watching_ci", { prNumber });
  };

  const watching_ci: StateHandler = async (ctx) => {
    if (!ctx.prNumber) throw new Error("No PR number");
    const maxWait = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 15 * 1000; // 15 seconds
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const status = await github.getCiStatus(ctx.branch);
      if (status === "passing") {
        logger.info("CI passed");
        if (!shouldAutoMerge(ctx)) return transition(ctx, "done");
        return transition(ctx, "merging");
      }
      if (status === "failing") {
        logger.warn("CI failed");
        if (ctx.fixAttempts >= ctx.maxFixAttempts) {
          logger.error("Max fix attempts exceeded");
          return transition(ctx, "failed");
        }
        return transition(ctx, "fixing", {
          fixAttempts: ctx.fixAttempts + 1,
        });
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    logger.error("CI timed out");
    return transition(ctx, "failed");
  };

  const fixing: StateHandler = async (ctx) => {
    if (!ctx.plan) throw new Error("No plan available");
    const ciLog = await github.getCheckRunLogs(ctx.branch);
    const fixStart = performance.now();
    const fix = await runFixer(
      { plan: ctx.plan, ciLog, cwd: ctx.cwd },
      logger
    );
    const fixElapsed = Math.round(performance.now() - fixStart);
    logger.info("Fix applied", { rootCause: fix.rootCause, agentElapsedMs: fixElapsed });

    await git.addAll(ctx.cwd);
    await git.commit(`fix: ${fix.rootCause}`, ctx.cwd);
    await git.push(ctx.branch, ctx.cwd);
    return transition(ctx, "watching_ci", { fix });
  };

  const merging: StateHandler = async (ctx) => {
    if (!ctx.prNumber) throw new Error("No PR number");
    await github.mergePr(ctx.prNumber);
    logger.info("PR merged", { prNumber: ctx.prNumber });
    return transition(ctx, "closing_issue");
  };

  const closing_issue: StateHandler = async (ctx) => {
    await github.closeIssue(ctx.issueNumber);
    logger.info("Issue closed", { issue: ctx.issueNumber });
    return transition(ctx, "done");
  };

  return {
    init,
    planning,
    implementing,
    reviewing,
    committing,
    creating_pr,
    watching_ci,
    fixing,
    merging,
    closing_issue,
  };
}
