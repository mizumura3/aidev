import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/agents/reviewer.js", () => ({
  runReviewer: vi.fn(async () => ({
    decision: "approve",
    mustFix: [],
    summary: "Looks good",
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
    base: "main",
    ...overrides,
  };
}

function makeDeps(overrides?: {
  git?: Partial<GitAdapter>;
  github?: Partial<GitHubAdapter>;
  runDocumenter?: Deps["runDocumenter"];
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
    getAuthenticatedUser: vi.fn(async () => "testuser"),
    commentOnIssue: vi.fn(async () => {}),
    createPr: vi.fn(async () => 42),
    getCiStatus: vi.fn(async () => "passing" as const),
    mergePr: vi.fn(async () => {}),
    closeIssue: vi.fn(async () => {}),
    listIssuesByLabel: vi.fn(async () => []),
    getCheckRunLogs: vi.fn(async () => ""),
    ...overrides?.github,
  };
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const runDocumenter = overrides?.runDocumenter ?? vi.fn(async () => {});
  return { git, github, logger, runDocumenter };
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
});

describe("watching_ci handler", () => {
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
      deps.logger
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
});

describe("reviewing handler", () => {
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
});
