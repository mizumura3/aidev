import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock modules before any imports
vi.mock("../src/adapters/git.js", () => ({
  createGitAdapter: vi.fn(() => ({ checkout: vi.fn(), push: vi.fn() })),
}));

vi.mock("../src/adapters/github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({
    listIssuesByLabel: vi.fn(async () => []),
    getIssue: vi.fn(),
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

import { createCli } from "../src/cli.js";
import { createGitAdapter } from "../src/adapters/git.js";
import { createGitHubAdapter } from "../src/adapters/github.js";
import { createStateHandlers } from "../src/workflow/states.js";
import { runWorkflow } from "../src/workflow/engine.js";

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
        { number: 42, title: "Test issue", body: "body", labels: ["ai:run"] },
      ]),
      getIssue: vi.fn(),
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
        { number: 99, title: "Failing issue", body: "body", labels: ["ai:run"] },
      ]),
      getIssue: vi.fn(),
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

  it("creates unique runIds for each issue", async () => {
    const mockGithub = {
      listIssuesByLabel: vi.fn(async () => [
        { number: 10, title: "Issue 10", body: "body", labels: ["ai:run"] },
        { number: 20, title: "Issue 20", body: "body", labels: ["ai:run"] },
      ]),
      getIssue: vi.fn(),
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

    expect(ctx1.runId).not.toBe(ctx2.runId);
    expect(ctx1.issueNumber).toBe(10);
    expect(ctx1.branch).toBe("aidev/issue-10");
    expect(ctx2.issueNumber).toBe(20);
    expect(ctx2.branch).toBe("aidev/issue-20");
  });
});
