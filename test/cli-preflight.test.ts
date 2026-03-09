import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { mockRunPreflightChecks } = vi.hoisted(() => ({
  mockRunPreflightChecks: vi.fn(),
}));

vi.mock("../src/preflight.js", () => ({
  runPreflightChecks: mockRunPreflightChecks,
}));

vi.mock("../src/adapters/git.js", () => ({
  createGitAdapter: vi.fn(() => ({
    addWorktree: vi.fn(async () => {}),
    removeWorktree: vi.fn(async () => {}),
  })),
}));

vi.mock("../src/adapters/github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({
    getIssue: vi.fn(async () => ({
      number: 42,
      title: "Issue 42",
      body: "Test",
      labels: [],
      author: "testuser",
    })),
    getAuthenticatedUser: vi.fn(async () => "testuser"),
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

describe("run command preflight", () => {
  let tempHome: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunPreflightChecks.mockResolvedValue(undefined);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (tempHome) {
      return rm(tempHome, { recursive: true, force: true });
    }
  });

  it("runs preflight checks before workflow execution", async () => {
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
      "/tmp/repo",
      "-y",
    ]);

    expect(mockRunPreflightChecks).toHaveBeenCalledOnce();
    expect(mockRunPreflightChecks).toHaveBeenCalledWith();
  });

  it("runs preflight checks before resuming a saved workflow", async () => {
    tempHome = await mkdtemp(join(tmpdir(), "aidev-home-"));
    const runDir = join(tempHome, ".aidev", "runs", "run-test");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "state.json"),
      JSON.stringify({
        runId: "run-test",
        targetKind: "issue",
        issueNumber: 42,
        repo: "owner/repo",
        cwd: "/tmp/repo",
        state: "planning",
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
    process.env.HOME = tempHome;

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
      "/tmp/repo",
      "--resume",
      "-y",
    ]);

    expect(mockRunPreflightChecks).toHaveBeenCalledOnce();
    expect(mockRunPreflightChecks).toHaveBeenCalledWith();
  });
});
