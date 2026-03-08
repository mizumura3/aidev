import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRunPreflightChecks } = vi.hoisted(() => ({
  mockRunPreflightChecks: vi.fn(async () => {}),
}));

vi.mock("../src/adapters/git.js", () => ({
  createGitAdapter: vi.fn(() => ({
    createBranch: vi.fn(),
    addAll: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    diff: vi.fn(),
    currentBranch: vi.fn(),
    addWorktree: vi.fn(),
    removeWorktree: vi.fn(),
  })),
}));

vi.mock("../src/adapters/github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({
    getIssue: vi.fn(),
    getPr: vi.fn(async () => ({
      number: 5,
      title: "PR mode",
      body: "Handle this PR directly",
      baseRefName: "main",
      headRefName: "feature/pr-mode",
      author: "testuser",
    })),
    getAuthenticatedUser: vi.fn(async () => "testuser"),
    commentOnIssue: vi.fn(),
    commentOnPr: vi.fn(),
    createPr: vi.fn(),
    getCiStatus: vi.fn(),
    mergePr: vi.fn(),
    closeIssue: vi.fn(),
    listIssuesByLabel: vi.fn(async () => []),
    getCheckRunLogs: vi.fn(),
    updateIssueBody: vi.fn(),
  })),
}));

vi.mock("../src/workflow/states.js", () => ({
  createStateHandlers: vi.fn(() => ({
    init: vi.fn(async (ctx: any) => ({
      nextState: "done",
      ctx: { ...ctx, state: "done" },
    })),
  })),
}));

vi.mock("../src/workflow/engine.js", () => ({
  runWorkflow: vi.fn(async (ctx: any) => ({ ...ctx, state: "done" })),
}));

vi.mock("../src/preflight.js", () => ({
  runPreflightChecks: mockRunPreflightChecks,
}));

vi.mock("../src/agents/runner-factory.js", () => ({
  createRunner: vi.fn(() => ({
    run: vi.fn(async () => "mock result"),
  })),
}));

import { createCli } from "../src/cli.js";
import { runWorkflow } from "../src/workflow/engine.js";

describe("run command PR mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts --pr and builds a PR-targeted RunContext", async () => {
    const cli = createCli();

    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--pr",
      "5",
      "--repo",
      "owner/repo",
      "--cwd",
      "/tmp/repo",
      "-y",
    ]);

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    const ctx = vi.mocked(runWorkflow).mock.calls[0][0];
    expect(ctx.targetKind).toBe("pr");
    expect(ctx.prNumber).toBe(5);
    expect(ctx.issueNumber).toBeUndefined();
    expect(ctx.branch).toBe("feature/pr-mode");
  });
});
