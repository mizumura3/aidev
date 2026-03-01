import { describe, it, expect, vi } from "vitest";
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
    branch: "devloop/issue-1",
    maxFixAttempts: 3,
    fixAttempts: 0,
    dryRun: false,
    autoMerge: false,
    issueLabels: [],
    ...overrides,
  };
}

function makeDeps(overrides?: {
  git?: Partial<GitAdapter>;
  github?: Partial<GitHubAdapter>;
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
    })),
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
  return { git, github, logger };
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
});
