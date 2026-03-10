import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock modules before any imports
const { mockAddWorktree, mockRemoveWorktree, mockRunPreflightChecks, mockExistsSync } = vi.hoisted(() => ({
  mockAddWorktree: vi.fn(async () => {}),
  mockRemoveWorktree: vi.fn(async () => {}),
  mockRunPreflightChecks: vi.fn(async () => {}),
  mockExistsSync: vi.fn(() => false),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: mockExistsSync };
});

vi.mock("../src/adapters/git.js", () => ({
  createGitAdapter: vi.fn(() => ({
    checkout: vi.fn(),
    push: vi.fn(),
    addWorktree: mockAddWorktree,
    removeWorktree: mockRemoveWorktree,
  })),
}));

vi.mock("../src/adapters/github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({
    listIssuesByLabel: vi.fn(async () => []),
    getIssue: vi.fn(),
    getAuthenticatedUser: vi.fn(async () => "testuser"),
    commentOnIssue: vi.fn(),
    createPr: vi.fn(),
    getCiStatus: vi.fn(),
    mergePr: vi.fn(),
    closeIssue: vi.fn(),
    getCheckRunLogs: vi.fn(),
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
import { createGitAdapter } from "../src/adapters/git.js";
import { createGitHubAdapter } from "../src/adapters/github.js";
import { createStateHandlers } from "../src/workflow/states.js";
import { runWorkflow } from "../src/workflow/engine.js";

function makeMockGithub(overrides: Record<string, any> = {}) {
  return {
    listIssuesByLabel: vi.fn(async () => []),
    getIssue: vi.fn(),
    getAuthenticatedUser: vi.fn(async () => "testuser"),
    commentOnIssue: vi.fn(),
    createPr: vi.fn(),
    getCiStatus: vi.fn(),
    mergePr: vi.fn(),
    closeIssue: vi.fn(),
    getCheckRunLogs: vi.fn(),
    ...overrides,
  };
}

describe("watch command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent process.exit from actually exiting
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls runWorkflow directly instead of execaCommand for each new issue", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 42, title: "Test issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    // Use a single poll (avoid setInterval) by clearing the interval
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const originalSetInterval = global.setInterval;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      intervalId = originalSetInterval(() => {}, ms);
      return intervalId;
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    // Wait for fire-and-forget runWorkflow to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(createGitAdapter).toHaveBeenCalled();
    expect(createStateHandlers).toHaveBeenCalled();
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);

    // Verify the RunContext passed to runWorkflow
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.issueNumber).toBe(42);
    expect(ctx.repo).toBe("owner/repo");
    expect(ctx.state).toBe("init");
    expect(ctx.branch).toBe("aidev/issue-42");
    expect(ctx.runId).toMatch(/^run-/);

    // Clean up interval
    if (intervalId) clearInterval(intervalId);
  });

  it("does not use execaCommand or reference devloop", async () => {
    // This test verifies at the source level that execa is not imported in the watch command
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../src/cli.ts", import.meta.url),
      "utf-8"
    );

    // The watch command block should not contain execaCommand or spawn via 'devloop' CLI
    // Find the watch command section
    const watchStart = source.indexOf('.command("watch")');
    const watchEnd = source.indexOf('.command("status")');
    const watchSection = source.slice(watchStart, watchEnd);

    expect(watchSection).not.toContain("execaCommand");
    expect(watchSection).not.toContain("import(\"execa\")");
    expect(watchSection).not.toContain("import('execa')");
    // Should not spawn 'devloop' as a subprocess command
    expect(watchSection).not.toMatch(/devloop\s+run/);
  });

  it("logs errors from runWorkflow without crashing the watcher", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 99, title: "Failing issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockRejectedValue(new Error("workflow failed"));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    // This should not throw even though runWorkflow rejects
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    // Wait for fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    // The watcher should still be alive (no throw)
  });

  it("preserves worktree when watch mode issue ends in manual_handoff", async () => {
    const mockGithub = makeMockGithub({
      listIssuesByLabel: vi.fn(async () => [
        { number: 55, title: "Timeout issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
    });
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "manual_handoff",
      _timedOutState: "implementing",
      handoffReason: "State implementing timed out after 1800000ms",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    // Wait for fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);

    // addWorktree called once (for creating the worktree)
    expect(mockAddWorktree).toHaveBeenCalledTimes(1);

    // removeWorktree should NOT be called — worktree preserved for manual_handoff
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("cleans up worktree when watch mode issue completes normally", async () => {
    const mockGithub = makeMockGithub({
      listIssuesByLabel: vi.fn(async () => [
        { number: 56, title: "Normal issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
    });
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);

    // Normal completion → worktree should be cleaned up
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
  });

  it("creates unique runIds for each issue", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 10, title: "Issue 10", body: "body", labels: ["ai:run"], author: "testuser" },
        { number: 20, title: "Issue 20", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunWorkflow).toHaveBeenCalledTimes(2);

    // Sort by issue number since fire-and-forget ordering is non-deterministic
    const calls = mockRunWorkflow.mock.calls
      .map((c: any) => c[0])
      .sort((a: any, b: any) => a.issueNumber - b.issueNumber);
    const ctx1 = calls[0];
    const ctx2 = calls[1];

    expect(ctx1.runId).not.toBe(ctx2.runId);
    expect(ctx1.issueNumber).toBe(10);
    expect(ctx1.branch).toBe("aidev/issue-10");
    expect(ctx2.issueNumber).toBe(20);
    expect(ctx2.branch).toBe("aidev/issue-20");
  });

  it("passes a unique worktree cwd to each issue's runWorkflow", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 10, title: "Issue 10", body: "body", labels: ["ai:run"], author: "testuser" },
        { number: 20, title: "Issue 20", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunWorkflow).toHaveBeenCalledTimes(2);

    const ctx1 = mockRunWorkflow.mock.calls[0][0];
    const ctx2 = mockRunWorkflow.mock.calls[1][0];

    // Each issue should get a different cwd (worktree path)
    expect(ctx1.cwd).not.toBe(ctx2.cwd);
    expect(ctx1.cwd).toContain("worktree");
    expect(ctx2.cwd).toContain("worktree");
  });

  it("cleans up worktree after successful runWorkflow", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 42, title: "Test issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddWorktree).toHaveBeenCalledTimes(1);
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
  });

  it("cleans up worktree after failed runWorkflow", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 99, title: "Failing issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockRejectedValue(new Error("workflow failed"));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockAddWorktree).toHaveBeenCalledTimes(1);
    // Worktree should still be cleaned up even on failure
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
  });

  it("does not crash when worktree creation fails", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 55, title: "WT fail issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    mockAddWorktree.mockRejectedValueOnce(new Error("worktree add failed"));

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    // Should not throw
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    // runWorkflow should NOT have been called since worktree creation failed
    expect(mockRunWorkflow).not.toHaveBeenCalled();
  });

  it("passes --base option to addWorktree and RunContext", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 42, title: "Test issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
      "--base",
      "v1.2.0",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    // addWorktree should be called with the custom base
    expect(mockAddWorktree).toHaveBeenCalledTimes(1);
    expect(mockAddWorktree.mock.calls[0][1]).toBe("v1.2.0");

    // RunContext should include the custom base
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.base).toBe("v1.2.0");
  });

  it("defaults base to 'main' when --base is not specified", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 42, title: "Test issue", body: "body", labels: ["ai:run"], author: "testuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    // addWorktree should be called with default "main"
    expect(mockAddWorktree).toHaveBeenCalledTimes(1);
    expect(mockAddWorktree.mock.calls[0][1]).toBe("main");

    // RunContext should have default base "main"
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.base).toBe("main");
  });

  it("skips foreign issues with warning log in watch mode", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 42, title: "Foreign issue", body: "body", labels: ["ai:run"], author: "foreignuser" },
        { number: 43, title: "Own issue", body: "body", labels: ["ai:run"], author: "myuser" },
      ]),
      getIssue: vi.fn(),
      getAuthenticatedUser: vi.fn(async () => "myuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const originalSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation(((
      fn: Function,
      ms: number
    ) => {
      return originalSetInterval(() => {}, ms);
    }) as any);

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "watch",
      "--repo",
      "owner/repo",
      "--interval",
      "999",
    ]);

    await new Promise((r) => setTimeout(r, 50));

    // Only the own issue should be processed
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.issueNumber).toBe(43);
  });
});

describe("run command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets skipAuthorCheck when --allow-foreign-issues is used", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
      "--allow-foreign-issues",
    ]);

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.skipAuthorCheck).toBe(true);
  });

  it("passes --base option to RunContext", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
      "--base",
      "v1.2.0",
    ]);

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.base).toBe("v1.2.0");
  });

  it("defaults base to 'main' when --base is not specified in run", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
    ]);

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.base).toBe("main");
  });

  it("skips confirmation with --yes flag", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
    ]);

    // Workflow should have been called (confirmation skipped)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
  });

  it("creates worktree and passes worktree cwd to runWorkflow", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
      "--cwd",
      "/tmp/myrepo",
    ]);

    expect(mockAddWorktree).toHaveBeenCalledTimes(1);
    expect(mockAddWorktree).toHaveBeenCalledWith(
      expect.stringContaining(".worktrees/issue-42"),
      "main",
      "/tmp/myrepo",
    );

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    const ctx = mockRunWorkflow.mock.calls[0][0];
    expect(ctx.cwd).toContain(".worktrees/issue-42");
  });

  it("cleans up worktree after successful run", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
    ]);

    // Called twice: once for stale cleanup before addWorktree, once in finally
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
  });

  it("cleans up worktree after failed run", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
      getAuthenticatedUser: vi.fn(async () => "testuser"),
      commentOnIssue: vi.fn(),
      createPr: vi.fn(),
      getCiStatus: vi.fn(),
      mergePr: vi.fn(),
      closeIssue: vi.fn(),
      getCheckRunLogs: vi.fn(),
    };
    vi.mocked(createGitHubAdapter).mockReturnValue(mockGithub);

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockRejectedValue(new Error("workflow crashed"));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
    ]);

    // Called twice: once for stale cleanup before addWorktree, once in finally
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
  });

  it("reuses existing worktree when resuming non-terminal state", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "implementing",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: false,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    // Worktree exists on disk
    mockExistsSync.mockReturnValue(true);

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // Should NOT add worktree — reuse existing
      expect(mockAddWorktree).not.toHaveBeenCalled();

      // removeWorktree should only be called once in finally (cleanup), not before
      expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);

      // ctx.cwd should be the worktree path derived from opts.cwd
      const ctx = mockRunWorkflow.mock.calls[0][0];
      expect(ctx.cwd).toContain("/tmp/real-repo/.worktrees/issue-42");
    } finally {
      mockExistsSync.mockReturnValue(false);
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("recreates worktree from init when resuming non-terminal state but worktree does not exist", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "implementing",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: false,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    // Worktree does NOT exist on disk
    mockExistsSync.mockReturnValue(false);

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // Worktree missing → recreated from scratch, state reset to init
      expect(mockAddWorktree).toHaveBeenCalled();
      const ctx = mockRunWorkflow.mock.calls[0][0];
      expect(ctx.state).toBe("init");
    } finally {
      mockExistsSync.mockReturnValue(false);
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("recreates worktree when resuming from terminal state (failed)", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "failed",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: false,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // Terminal state → should recreate worktree (remove + add)
      expect(mockRemoveWorktree).toHaveBeenCalled();
      expect(mockAddWorktree).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/real-repo/.worktrees/issue-42"),
        "main",
        "/tmp/real-repo",
      );
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("reuses worktree when resuming done+dryRun (transitions to creating_pr)", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "done",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: true,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    // Worktree exists
    mockExistsSync.mockReturnValue(true);

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // done + dryRun → creating_pr, needs existing changes → reuse worktree
      expect(mockAddWorktree).not.toHaveBeenCalled();

      // removeWorktree should only be called once in finally (cleanup), not before
      expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);

      const ctx = mockRunWorkflow.mock.calls[0][0];
      expect(ctx.state).toBe("creating_pr");
    } finally {
      mockExistsSync.mockReturnValue(false);
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("reuses worktree when resuming from manual_handoff with _timedOutState", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "manual_handoff",
        _timedOutState: "implementing",
        handoffReason: "State implementing timed out after 1800000ms",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: false,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    // Worktree exists on disk (preserved from manual_handoff)
    mockExistsSync.mockReturnValue(true);

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // manual_handoff → _timedOutState "implementing" → non-terminal → reuse worktree
      expect(mockAddWorktree).not.toHaveBeenCalled();

      // ctx.state should be restored to the timed-out state
      const ctx = mockRunWorkflow.mock.calls[0][0];
      expect(ctx.state).toBe("implementing");
    } finally {
      mockExistsSync.mockReturnValue(false);
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("falls back to init when resuming from manual_handoff without _timedOutState", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-resume-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-resume-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/stale-worktree/.worktrees/issue-42",
        state: "manual_handoff",
        handoffReason: "Manual handoff without timed out state",
        branch: "aidev/issue-42",
        base: "main",
        maxFixAttempts: 3,
        fixAttempts: 0,
        dryRun: false,
        autoMerge: false,
        issueLabels: [],
        skipAuthorCheck: false,
        skipStates: [],
      })
    );

    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    // Worktree exists on disk (preserved from manual_handoff)
    mockExistsSync.mockReturnValue(true);

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "done",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--cwd",
        "/tmp/real-repo",
        "--resume",
        "--yes",
      ]);

      // No _timedOutState → falls back to "init" (non-terminal) → reuse worktree
      expect(mockAddWorktree).not.toHaveBeenCalled();

      const ctx = mockRunWorkflow.mock.calls[0][0];
      expect(ctx.state).toBe("init");
    } finally {
      mockExistsSync.mockReturnValue(false);
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("preserves worktree when workflow result is manual_handoff", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempHome = await mkdtemp(join(tmpdir(), "aidev-resume-wt-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    vi.mocked(createGitHubAdapter).mockReturnValue(makeMockGithub({
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
    }));

    try {
      const mockRunWorkflow = vi.mocked(runWorkflow);
      mockRunWorkflow.mockImplementation(async (ctx: any) => ({
        ...ctx,
        state: "manual_handoff",
        _timedOutState: "implementing",
        handoffReason: "State implementing timed out after 1800000ms",
      }));

      const cli = createCli();
      await cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--repo",
        "owner/repo",
        "--yes",
      ]);

      // Worktree created for new run
      expect(mockAddWorktree).toHaveBeenCalled();

      // manual_handoff → keepWorktree = true → removeWorktree NOT called in finally
      expect(mockRemoveWorktree).toHaveBeenCalledTimes(1); // only stale cleanup before addWorktree
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("uses --base for worktree creation", async () => {
    vi.mocked(createGitHubAdapter).mockReturnValue(makeMockGithub({
      getIssue: vi.fn(async () => ({
        number: 42,
        title: "Test issue",
        body: "body",
        labels: [],
        author: "testuser",
      })),
    }));

    const mockRunWorkflow = vi.mocked(runWorkflow);
    mockRunWorkflow.mockImplementation(async (ctx: any) => ({
      ...ctx,
      state: "done",
    }));

    const cli = createCli();
    await cli.parseAsync([
      "node",
      "aidev",
      "run",
      "--issue",
      "42",
      "--repo",
      "owner/repo",
      "--yes",
      "--base",
      "v1.2.0",
    ]);

    expect(mockAddWorktree).toHaveBeenCalledWith(
      expect.stringContaining(".worktrees/issue-42"),
      "v1.2.0",
      expect.any(String),
    );
  });
});
