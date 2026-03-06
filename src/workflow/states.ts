import type { StateHandler, RunContext, RunState } from "../types.js";
import type { StateHandlerMap } from "./engine.js";
import type { GitAdapter } from "../adapters/git.js";
import type { GitHubAdapter } from "../adapters/github.js";
import { runPlanner } from "../agents/planner.js";
import { runImplementer } from "../agents/implementer.js";
import { runReviewer } from "../agents/reviewer.js";
import { runFixer } from "../agents/fixer.js";
import type { Logger } from "../util/logger.js";
import type { DocumenterInput } from "../agents/documenter.js";
import { parseIssueConfig, type ResolvedConfig } from "../config/issue-config.js";
import type { IssueConfig } from "../config/issue-config.js";
import { mergeConfigs } from "../config/merge-config.js";
import { buildResolvedConfigBlock, upsertAidevBlock } from "../config/serialize-config.js";
import type { SkippableState } from "../types.js";
import type { Issue, PullRequest } from "../adapters/github.js";

export interface Deps {
  git: GitAdapter;
  github: GitHubAdapter;
  logger: Logger;
  runDocumenter: (input: DocumenterInput, logger: Logger) => Promise<void>;
  loadRepoConfig: (cwd: string) => Promise<Partial<IssueConfig>>;
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

function toPlanningTarget(workItem: Issue | PullRequest): Issue {
  return {
    number: workItem.number,
    title: workItem.title,
    body: workItem.body,
    labels: "labels" in workItem ? workItem.labels : [],
    author: workItem.author,
  };
}

export function createStateHandlers(deps: Deps): StateHandlerMap {
  const { git, github, logger, runDocumenter, loadRepoConfig } = deps;

  const init: StateHandler = async (ctx) => {
    if (ctx.targetKind === "pr") {
      const pr = await github.getPr(ctx.prNumber!);
      logger.info("Fetched PR", {
        number: pr.number,
        title: pr.title,
      });

      if (!ctx.skipAuthorCheck) {
        const authenticatedUser = await github.getAuthenticatedUser();
        if (pr.author !== authenticatedUser) {
          throw new Error(
            `PR #${pr.number} was created by '${pr.author}', not by the authenticated user '${authenticatedUser}'. Use --allow-foreign-issues to bypass this check.`
          );
        }
      }

      const patch: Partial<RunContext> = {
        issueLabels: [],
        issueTitle: pr.title,
        base: ctx._cliExplicit?.has("base") ? ctx.base : pr.baseRefName,
        branch: pr.headRefName,
        headBranch: pr.headRefName,
      };

      const mergedCtx = { ...ctx, ...patch };
      await git.createBranch(
        mergedCtx.branch,
        `origin/${pr.headRefName}`,
        mergedCtx.cwd
      );
      logger.info("Checked out PR head branch", {
        branch: mergedCtx.branch,
        base: mergedCtx.base,
      });
      return transition(mergedCtx, "planning");
    }

    const issue = await github.getIssue(ctx.issueNumber!);
    logger.info("Fetched issue", {
      number: issue.number,
      title: issue.title,
    });

    if (!ctx.skipAuthorCheck) {
      const authenticatedUser = await github.getAuthenticatedUser();
      if (issue.author !== authenticatedUser) {
        throw new Error(
          `Issue #${issue.number} was created by '${issue.author}', not by the authenticated user '${authenticatedUser}'. Use --allow-foreign-issues to bypass this check.`
        );
      }
    }

    // Load repo-level config (.aidev.yml)
    const repoConfig = await loadRepoConfig(ctx.cwd);
    if (Object.keys(repoConfig).length > 0) {
      logger.info("Loaded repo config", { repoConfig });
    }

    // Parse issue config from body
    const issueConfig = parseIssueConfig(issue.body);
    if (Object.keys(issueConfig).length > 0) {
      logger.info("Parsed issue config", { issueConfig });
    }

    // Merge: repo < issue, excluding CLI-explicit fields
    const cliExplicit = ctx._cliExplicit ?? new Set<string>();
    const merged = mergeConfigs(repoConfig, issueConfig, cliExplicit);

    const patch: Partial<RunContext> = {
      issueLabels: issue.labels,
      issueTitle: issue.title,
    };

    if (merged.maxFixAttempts !== undefined) patch.maxFixAttempts = merged.maxFixAttempts;
    if (merged.autoMerge !== undefined) patch.autoMerge = merged.autoMerge;
    if (merged.dryRun !== undefined) patch.dryRun = merged.dryRun;
    if (merged.base !== undefined) patch.base = merged.base;
    if (merged.skip) patch.skipStates = merged.skip as SkippableState[];

    const mergedCtx = { ...ctx, ...patch };

    // Build resolved config and write back to issue body
    const resolvedConfig: ResolvedConfig = {
      maxFixAttempts: mergedCtx.maxFixAttempts,
      autoMerge: mergedCtx.autoMerge,
      dryRun: mergedCtx.dryRun,
      base: mergedCtx.base,
      skip: (mergedCtx.skipStates ?? []) as SkippableState[],
    };
    const configBlock = buildResolvedConfigBlock(resolvedConfig);
    const updatedBody = upsertAidevBlock(issue.body, configBlock);
    await github.updateIssueBody(issue.number, updatedBody);

    await git.createBranch(mergedCtx.branch, mergedCtx.base, mergedCtx.cwd);
    logger.info("Created branch", { branch: mergedCtx.branch });
    return transition(mergedCtx, "planning");
  };

  const planning: StateHandler = async (ctx) => {
    const workItem =
      ctx.targetKind === "pr"
        ? toPlanningTarget(await github.getPr(ctx.prNumber!))
        : await github.getIssue(ctx.issueNumber!);
    const planStart = performance.now();
    const plan = await runPlanner({ issue: workItem, cwd: ctx.cwd }, logger);
    const planElapsed = Math.round(performance.now() - planStart);
    logger.info("Plan created", { summary: plan.summary, agentElapsedMs: planElapsed });

    if (plan.investigation) {
      const comment = `## 🔍 Investigation\n\n${plan.investigation}\n\n## Plan\n\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
      if (ctx.targetKind === "pr") {
        await github.commentOnPr(ctx.prNumber!, comment);
        logger.info("Posted investigation to PR", { pr: ctx.prNumber });
      } else {
        await github.commentOnIssue(ctx.issueNumber!, comment);
        logger.info("Posted investigation to issue", { issue: ctx.issueNumber });
      }
    }

    return transition(ctx, "implementing", { plan });
  };

  const implementing: StateHandler = async (ctx) => {
    if (!ctx.plan) throw new Error("No plan available");
    const implStart = performance.now();
    const result = await runImplementer(
      {
        plan: ctx.plan,
        workItemKind: ctx.targetKind,
        workItemNumber: ctx.targetKind === "pr" ? ctx.prNumber! : ctx.issueNumber!,
        cwd: ctx.cwd,
      },
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
    if (ctx.skipStates?.includes("reviewing")) {
      logger.info("Skipping reviewing (configured in issue)");
      return transition(ctx, "committing");
    }
    if (!ctx.plan) throw new Error("No plan available");
    const diff = await git.diff(ctx.base, ctx.cwd);
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
    if (ctx.skipStates?.includes("documenter")) {
      logger.info("Skipping documenter (configured in issue)");
    } else {
      await runDocumenter({ result: ctx.result, cwd: ctx.cwd }, logger);
    }
    logger.info("Documentation check completed");
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
    if (ctx.targetKind === "pr") {
      await git.push(ctx.headBranch ?? ctx.branch, ctx.cwd);
      logger.info("Updated existing PR branch", { prNumber: ctx.prNumber, branch: ctx.headBranch ?? ctx.branch });
      return transition(ctx, "watching_ci", { prNumber: ctx.prNumber });
    }
    await git.push(ctx.branch, ctx.cwd);
    const prNumber = await github.createPr({
      title: ctx.result.commitMessageDraft.split("\n")[0]!,
      body: ctx.result.prBodyDraft,
      head: ctx.branch,
      base: ctx.base,
    });
    logger.info("PR created", { prNumber });
    return transition(ctx, "watching_ci", { prNumber });
  };

  const watching_ci: StateHandler = async (ctx) => {
    if (!ctx.prNumber) throw new Error("No PR number");
    if (ctx.skipStates?.includes("watching_ci")) {
      logger.info("Skipping watching_ci (configured in issue)");
      if (!shouldAutoMerge(ctx)) return transition(ctx, "done");
      return transition(ctx, "merging");
    }
    const maxWait = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 15 * 1000; // 15 seconds
    const gracePeriod = 30 * 1000; // 30 seconds for CI check runs to register
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
      if (status === "no_checks" && Date.now() - start >= gracePeriod) {
        logger.info("No CI checks found after grace period, treating as passing");
        if (!shouldAutoMerge(ctx)) return transition(ctx, "done");
        return transition(ctx, "merging");
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
    if (ctx.targetKind === "pr") {
      logger.info("Skipping issue close for PR mode", { prNumber: ctx.prNumber });
      return transition(ctx, "done");
    }
    await github.closeIssue(ctx.issueNumber!);
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
