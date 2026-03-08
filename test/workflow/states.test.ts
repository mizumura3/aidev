import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/agents/reviewer.js", () => ({
  runReviewer: vi.fn(async () => ({
    decision: "approve",
    mustFix: [],
    summary: "Looks good",
  })),
}));

vi.mock("../../src/agents/planner.js", () => ({
  runPlanner: vi.fn(async () => ({
    summary: "Plan for PR mode",
    steps: ["Inspect", "Implement"],
    filesToTouch: ["src/cli.ts"],
    tests: ["test/workflow/states.test.ts"],
    risks: [],
    acceptanceCriteria: ["PR mode works"],
    investigation: "- Found the relevant PR flow",
  })),
}));

import { createStateHandlers, type Deps } from "../../src/workflow/states.js";
import type { RunContext } from "../../src/types.js";
import type { GitAdapter } from "../../src/adapters/git.js";
import type { GitHubAdapter } from "../../src/adapters/github.js";
import type { Logger } from "../../src/util/logger.js";

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "test-run",
    targetKind: "issue",
    issueNumber: 1,
    repo: "owner/repo",
    cwd: "/tmp/repo",
    state: "init",
    branch: "aidev/issue-1",
    maxFixAttempts: 3,
    fixAttempts: 0,
    dryRun: false,
    autoMerge: false,
    issueLabels: [],
    skipStates: [],
    base: "main",
    ...overrides,
  };
}

function makeDeps(overrides?: {
  git?: Partial<GitAdapter>;
  github?: Partial<GitHubAdapter>;
  runDocumenter?: Deps["runDocumenter"];
  loadRepoConfig?: Deps["loadRepoConfig"];
}): Deps {
  const git: GitAdapter = {
    createBranch: vi.fn(async () => {}),
    addAll: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    diff: vi.fn(async () => ""),
    currentBranch: vi.fn(async () => "main"),
    ...overrides?.git,
  };
  const github: GitHubAdapter = {
    getIssue: vi.fn(async () => ({
      number: 1,
      title: "Test issue",
      body: "Test body",
      labels: [],
      author: "testuser",
    })),
    getPr: vi.fn(async () => ({
      number: 5,
      title: "Test PR",
      body: "PR body",
      baseRefName: "main",
      headRefName: "feature/pr-mode",
      author: "testuser",
    })),
    getAuthenticatedUser: vi.fn(async () => "testuser"),
    commentOnIssue: vi.fn(async () => {}),
    commentOnPr: vi.fn(async () => {}),
    createPr: vi.fn(async () => 42),
    getCiStatus: vi.fn(async () => "passing" as const),
    mergePr: vi.fn(async () => {}),
    closeIssue: vi.fn(async () => {}),
    listIssuesByLabel: vi.fn(async () => []),
    getCheckRunLogs: vi.fn(async () => ""),
    updateIssueBody: vi.fn(async () => {}),
    ...overrides?.github,
  };
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const runner = { run: vi.fn(async () => "") };
  const runDocumenter = overrides?.runDocumenter ?? vi.fn(async () => {});
  const loadRepoConfig = overrides?.loadRepoConfig ?? vi.fn(async () => ({}));
  const resolveRunner = vi.fn(() => runner);
  return { git, github, logger, runner, runDocumenter, loadRepoConfig, resolveRunner };
}

describe("init handler", () => {
  it("saves issue labels to ctx.issueLabels", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "",
          labels: ["auto-merge", "enhancement"],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.issueLabels).toEqual(["auto-merge", "enhancement"]);
    expect(result.nextState).toBe("planning");
  });

  it("saves empty labels when issue has none", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.issueLabels).toEqual([]);
  });

  it("rejects issue when author does not match authenticated user", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "",
          labels: [],
          author: "foreignuser",
        })),
        getAuthenticatedUser: vi.fn(async () => "myuser"),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    await expect(handlers.init!(ctx)).rejects.toThrow("foreignuser");
  });

  it("allows issue when author matches authenticated user", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "",
          labels: [],
          author: "myuser",
        })),
        getAuthenticatedUser: vi.fn(async () => "myuser"),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.nextState).toBe("planning");
  });

  it("passes ctx.base to git.createBranch", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ base: "v1.2.0" });

    await handlers.init!(ctx);

    expect(deps.git.createBranch).toHaveBeenCalledWith(
      ctx.branch,
      "v1.2.0",
      ctx.cwd
    );
  });

  it("passes default base 'main' to git.createBranch", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    await handlers.init!(ctx);

    expect(deps.git.createBranch).toHaveBeenCalledWith(
      ctx.branch,
      "main",
      ctx.cwd
    );
  });

  it("parses issue config from body and merges into ctx", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "```aidev\nmaxFixAttempts: 5\nautoMerge: true\nbase: release/1.3\nskip:\n  - reviewing\n```",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.maxFixAttempts).toBe(5);
    expect(result.ctx.autoMerge).toBe(true);
    expect(result.ctx.base).toBe("release/1.3");
    expect(result.ctx.skipStates).toEqual(["reviewing"]);
  });

  it("does not override ctx values when issue body has no aidev block", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "Just a regular issue",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ maxFixAttempts: 7 });

    const result = await handlers.init!(ctx);

    expect(result.ctx.maxFixAttempts).toBe(7);
    expect(result.ctx.skipStates).toEqual([]);
  });

  it("saves issueTitle from fetched issue", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Add awesome feature",
          body: "",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.issueTitle).toBe("Add awesome feature");
  });

  it("uses branch from base in issue config for git.createBranch", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "```aidev\nbase: release/2.0\n```",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    // Issue config base should be used for branch creation
    expect(deps.git.createBranch).toHaveBeenCalledWith(
      ctx.branch,
      "release/2.0",
      ctx.cwd
    );
    expect(result.ctx.base).toBe("release/2.0");
  });

  it("skips author check when skipAuthorCheck is true", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "",
          labels: [],
          author: "foreignuser",
        })),
        getAuthenticatedUser: vi.fn(async () => "myuser"),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ skipAuthorCheck: true });

    const result = await handlers.init!(ctx);

    expect(result.nextState).toBe("planning");
    // getAuthenticatedUser should not be called when check is skipped
    expect(deps.github.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("applies .aidev.yml repo config to ctx", async () => {
    const deps = makeDeps({
      loadRepoConfig: vi.fn(async () => ({ base: "develop", autoMerge: true })),
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.base).toBe("develop");
    expect(result.ctx.autoMerge).toBe(true);
  });

  it("issue config overrides repo config", async () => {
    const deps = makeDeps({
      loadRepoConfig: vi.fn(async () => ({ base: "develop", maxFixAttempts: 10 })),
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "```aidev\nbase: release/1.0\n```",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    const result = await handlers.init!(ctx);

    expect(result.ctx.base).toBe("release/1.0");
    expect(result.ctx.maxFixAttempts).toBe(10);
  });

  it("CLI flags override both repo and issue config", async () => {
    const deps = makeDeps({
      loadRepoConfig: vi.fn(async () => ({ base: "develop" })),
      github: {
        getIssue: vi.fn(async () => ({
          number: 1,
          title: "Test",
          body: "```aidev\nbase: release/1.0\n```",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ base: "cli-branch", _cliExplicit: new Set(["base"]) });

    const result = await handlers.init!(ctx);

    expect(result.ctx.base).toBe("cli-branch");
  });

  it("writes resolved config back to issue body", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx();

    await handlers.init!(ctx);

    expect(deps.github.updateIssueBody).toHaveBeenCalledWith(
      1,
      expect.stringContaining("```aidev"),
    );
  });

  it("writes resolved config even with default options only", async () => {
    const deps = makeDeps({
      github: {
        getIssue: vi.fn(async () => ({
          number: 5,
          title: "Test",
          body: "Simple issue body",
          labels: [],
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ issueNumber: 5 });

    await handlers.init!(ctx);

    expect(deps.github.updateIssueBody).toHaveBeenCalledWith(
      5,
      expect.stringContaining("```aidev"),
    );
    // Original body should be preserved
    expect(deps.github.updateIssueBody).toHaveBeenCalledWith(
      5,
      expect.stringContaining("Simple issue body"),
    );
  });

  it("initializes PR mode from PR metadata and uses the remote PR head branch as base", async () => {
    const deps = makeDeps({
      github: {
        getPr: vi.fn(async () => ({
          number: 5,
          title: "Fix this PR directly",
          body: "PR body",
          baseRefName: "feat/base",
          headRefName: "feat/head",
          author: "testuser",
        })),
      },
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      targetKind: "pr",
      prNumber: 5,
      branch: "placeholder",
      base: "main",
    });

    const result = await handlers.init!(ctx);

    expect(result.ctx.targetKind).toBe("pr");
    expect(result.ctx.base).toBe("feat/base");
    expect(result.ctx.branch).toBe("feat/head");
    expect(result.ctx.headBranch).toBe("feat/head");
    expect(deps.git.createBranch).toHaveBeenCalledWith(
      "feat/head",
      "origin/feat/head",
      ctx.cwd
    );
    expect(deps.github.updateIssueBody).not.toHaveBeenCalled();
  });
});

describe("watching_ci handler", () => {
  it("skips to merging when skipStates includes watching_ci and autoMerge", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "watching_ci",
      prNumber: 42,
      skipStates: ["watching_ci"],
      autoMerge: true,
    });

    const result = await handlers.watching_ci!(ctx);

    expect(result.nextState).toBe("merging");
    expect(deps.github.getCiStatus).not.toHaveBeenCalled();
  });

  it("skips to done when skipStates includes watching_ci and no autoMerge", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "watching_ci",
      prNumber: 42,
      skipStates: ["watching_ci"],
      autoMerge: false,
      issueLabels: [],
    });

    const result = await handlers.watching_ci!(ctx);

    expect(result.nextState).toBe("done");
    expect(deps.github.getCiStatus).not.toHaveBeenCalled();
  });

  it("transitions to merging when issueLabels includes auto-merge", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "watching_ci",
      prNumber: 42,
      autoMerge: false,
      issueLabels: ["auto-merge"],
    });

    const result = await handlers.watching_ci!(ctx);

    expect(result.nextState).toBe("merging");
  });

  it("transitions to merging when autoMerge flag is true", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "watching_ci",
      prNumber: 42,
      autoMerge: true,
      issueLabels: [],
    });

    const result = await handlers.watching_ci!(ctx);

    expect(result.nextState).toBe("merging");
  });

  it("transitions to done when no auto-merge label and autoMerge is false", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "watching_ci",
      prNumber: 42,
      autoMerge: false,
      issueLabels: ["bug"],
    });

    const result = await handlers.watching_ci!(ctx);

    expect(result.nextState).toBe("done");
  });

  describe("no_checks grace period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps polling when no_checks is returned during grace period", async () => {
      const getCiStatus = vi.fn();
      // First call: no_checks (within grace period), second call: passing
      getCiStatus.mockResolvedValueOnce("no_checks");
      getCiStatus.mockResolvedValueOnce("passing");

      const deps = makeDeps({ github: { getCiStatus } });
      const handlers = createStateHandlers(deps);
      const ctx = makeCtx({
        state: "watching_ci",
        prNumber: 42,
        autoMerge: true,
      });

      const promise = handlers.watching_ci!(ctx);
      // Advance past the poll interval (15s) to trigger second poll
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(getCiStatus).toHaveBeenCalledTimes(2);
      expect(result.nextState).toBe("merging");
    });

    it("treats no_checks as passing after grace period expires", async () => {
      const getCiStatus = vi.fn().mockResolvedValue("no_checks");

      const deps = makeDeps({ github: { getCiStatus } });
      const handlers = createStateHandlers(deps);
      const ctx = makeCtx({
        state: "watching_ci",
        prNumber: 42,
        autoMerge: true,
      });

      const promise = handlers.watching_ci!(ctx);
      // Advance past the grace period (30s) + poll intervals
      // First poll at 0s: no_checks (within grace, wait 15s)
      // Second poll at 15s: no_checks (within grace, wait 15s)
      await vi.advanceTimersByTimeAsync(15_000);
      // Third poll at 30s: no_checks (grace period exceeded, treat as passing)
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.nextState).toBe("merging");
    });

    it("transitions to done when no_checks after grace period and no auto-merge", async () => {
      const getCiStatus = vi.fn().mockResolvedValue("no_checks");

      const deps = makeDeps({ github: { getCiStatus } });
      const handlers = createStateHandlers(deps);
      const ctx = makeCtx({
        state: "watching_ci",
        prNumber: 42,
        autoMerge: false,
        issueLabels: [],
      });

      const promise = handlers.watching_ci!(ctx);
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.nextState).toBe("done");
    });

    it("transitions correctly when no_checks is followed by real passing", async () => {
      const getCiStatus = vi.fn();
      getCiStatus.mockResolvedValueOnce("no_checks");
      getCiStatus.mockResolvedValueOnce("passing");

      const deps = makeDeps({ github: { getCiStatus } });
      const handlers = createStateHandlers(deps);
      const ctx = makeCtx({
        state: "watching_ci",
        prNumber: 42,
        autoMerge: true,
      });

      const promise = handlers.watching_ci!(ctx);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(getCiStatus).toHaveBeenCalledTimes(2);
      expect(result.nextState).toBe("merging");
    });

    it("transitions to fixing when no_checks is followed by failing", async () => {
      const getCiStatus = vi.fn();
      getCiStatus.mockResolvedValueOnce("no_checks");
      getCiStatus.mockResolvedValueOnce("failing");

      const deps = makeDeps({ github: { getCiStatus } });
      const handlers = createStateHandlers(deps);
      const ctx = makeCtx({
        state: "watching_ci",
        prNumber: 42,
        autoMerge: true,
      });

      const promise = handlers.watching_ci!(ctx);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(getCiStatus).toHaveBeenCalledTimes(2);
      expect(result.nextState).toBe("fixing");
    });
  });
});

describe("committing handler", () => {
  const result = {
    changeSummary: "Added feature X",
    changedFiles: ["src/foo.ts"],
    testsRun: true,
    commitMessageDraft: "feat: add feature X",
    prBodyDraft: "## Summary\nAdded feature X",
  };

  it("calls runDocumenter before git operations", async () => {
    const callOrder: string[] = [];
    const runDocumenter = vi.fn(async () => {
      callOrder.push("documenter");
    });
    const deps = makeDeps({
      git: {
        addAll: vi.fn(async () => {
          callOrder.push("addAll");
        }),
        commit: vi.fn(async () => {
          callOrder.push("commit");
        }),
      },
      runDocumenter,
    });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ state: "committing", result });

    await handlers.committing!(ctx);

    expect(callOrder).toEqual(["documenter", "addAll", "commit"]);
  });

  it("passes result and cwd to runDocumenter", async () => {
    const runDocumenter = vi.fn(async () => {});
    const deps = makeDeps({ runDocumenter });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ state: "committing", result, cwd: "/my/repo" });

    await handlers.committing!(ctx);

    expect(runDocumenter).toHaveBeenCalledWith(
      { result, cwd: "/my/repo" },
      deps.logger,
      deps.runner,
      undefined
    );
  });

  it("transitions to creating_pr after commit", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ state: "committing", result });

    const { nextState } = await handlers.committing!(ctx);

    expect(nextState).toBe("creating_pr");
  });

  it("transitions to done when dryRun is true", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ state: "committing", result, dryRun: true });

    const { nextState } = await handlers.committing!(ctx);

    expect(nextState).toBe("done");
  });

  it("throws when result is missing", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({ state: "committing" });

    await expect(handlers.committing!(ctx)).rejects.toThrow(
      "No result available"
    );
  });

  it("skips runDocumenter when skipStates includes documenter", async () => {
    const runDocumenter = vi.fn(async () => {});
    const deps = makeDeps({ runDocumenter });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "committing",
      result,
      skipStates: ["documenter"],
    });

    await handlers.committing!(ctx);

    expect(runDocumenter).not.toHaveBeenCalled();
    expect(deps.git.addAll).toHaveBeenCalled();
    expect(deps.git.commit).toHaveBeenCalled();
  });
});

describe("reviewing handler", () => {
  it("skips to committing when skipStates includes reviewing", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "reviewing",
      skipStates: ["reviewing"],
      plan: {
        summary: "Do X",
        steps: ["Step 1"],
        filesToTouch: ["a.ts"],
        tests: ["a.test.ts"],
        risks: [],
        acceptanceCriteria: ["X done"],
      },
    });

    const result = await handlers.reviewing!(ctx);

    expect(result.nextState).toBe("committing");
    // Should not call git.diff or runReviewer
    expect(deps.git.diff).not.toHaveBeenCalled();
  });

  it("passes ctx.base to git.diff instead of hardcoded 'main'", async () => {
    const diff = vi.fn(async () => "some diff");
    const deps = makeDeps({ git: { diff } });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "reviewing",
      base: "v1.2.0",
      plan: {
        summary: "Do X",
        steps: ["Step 1"],
        filesToTouch: ["a.ts"],
        tests: ["a.test.ts"],
        risks: [],
        acceptanceCriteria: ["X done"],
      },
    });

    await handlers.reviewing!(ctx);

    expect(diff).toHaveBeenCalledWith("v1.2.0", ctx.cwd);
  });

  it("uses default base 'main' for git.diff when base is not customized", async () => {
    const diff = vi.fn(async () => "some diff");
    const deps = makeDeps({ git: { diff } });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "reviewing",
      plan: {
        summary: "Do X",
        steps: ["Step 1"],
        filesToTouch: ["a.ts"],
        tests: ["a.test.ts"],
        risks: [],
        acceptanceCriteria: ["X done"],
      },
    });

    await handlers.reviewing!(ctx);

    expect(diff).toHaveBeenCalledWith("main", ctx.cwd);
  });
});

describe("creating_pr handler", () => {
  const result = {
    changeSummary: "Added feature X",
    changedFiles: ["src/foo.ts"],
    testsRun: true,
    commitMessageDraft: "feat: add feature X",
    prBodyDraft: "## Summary\nAdded feature X",
  };

  it("passes ctx.base as PR base instead of hardcoded 'main'", async () => {
    const createPr = vi.fn(async () => 42);
    const deps = makeDeps({ github: { createPr } });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "creating_pr",
      base: "release/1.3",
      result,
    });

    await handlers.creating_pr!(ctx);

    expect(createPr).toHaveBeenCalledWith(
      expect.objectContaining({ base: "release/1.3" })
    );
  });

  it("uses default base 'main' for PR when base is not customized", async () => {
    const createPr = vi.fn(async () => 42);
    const deps = makeDeps({ github: { createPr } });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      state: "creating_pr",
      result,
    });

    await handlers.creating_pr!(ctx);

    expect(createPr).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main" })
    );
  });

  it("pushes directly to the existing PR head branch in PR mode", async () => {
    const createPr = vi.fn(async () => 42);
    const deps = makeDeps({ github: { createPr } });
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      targetKind: "pr",
      prNumber: 5,
      branch: "feat/taka-qa-flow",
      headBranch: "feat/taka-qa-flow",
      state: "creating_pr",
      result,
    });

    const next = await handlers.creating_pr!(ctx);

    expect(deps.git.push).toHaveBeenCalledWith("feat/taka-qa-flow", ctx.cwd);
    expect(createPr).not.toHaveBeenCalled();
    expect(next.ctx.prNumber).toBe(5);
    expect(next.nextState).toBe("watching_ci");
  });
});

describe("planning handler", () => {
  it("posts investigation comments to the PR in PR mode", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      targetKind: "pr",
      prNumber: 5,
      state: "planning",
      branch: "feat/taka-qa-flow",
    });

    await handlers.planning!(ctx);

    expect(deps.github.commentOnPr).toHaveBeenCalledWith(
      5,
      expect.stringContaining("## 🔍 Investigation"),
    );
    expect(deps.github.commentOnIssue).not.toHaveBeenCalled();
  });
});

describe("closing_issue handler", () => {
  it("skips issue closing in PR mode", async () => {
    const deps = makeDeps();
    const handlers = createStateHandlers(deps);
    const ctx = makeCtx({
      targetKind: "pr",
      prNumber: 5,
      state: "closing_issue",
    });

    const result = await handlers.closing_issue!(ctx);

    expect(result.nextState).toBe("done");
    expect(deps.github.closeIssue).not.toHaveBeenCalled();
  });
});
