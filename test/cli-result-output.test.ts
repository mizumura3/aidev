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
    getIssue: vi.fn(async () => ({
      number: 10,
      title: "Test issue",
      body: "body",
      author: "testuser",
      labels: [],
    })),
    getPr: vi.fn(),
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
  createStateHandlers: vi.fn(() => ({})),
}));

const { mockRunWorkflow } = vi.hoisted(() => ({
  mockRunWorkflow: vi.fn(),
}));

vi.mock("../src/workflow/engine.js", () => ({
  runWorkflow: mockRunWorkflow,
}));

vi.mock("../src/preflight.js", () => ({
  runPreflightChecks: mockRunPreflightChecks,
}));

import { createCli } from "../src/cli.js";

describe("--verbose flag", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("causes progress lines to be written to stderr when --verbose is set", async () => {
    mockRunWorkflow.mockImplementation(async (_ctx: any, _handlers: any, _persistence: any, options: any) => {
      // Simulate state transitions that trigger onTransition
      options?.onTransition?.("init", "planning");
      options?.onTransition?.("planning", "implementing");
      return {
        runId: "run-v1",
        state: "done",
        prNumber: 42,
        result: {
          changeSummary: "Added X",
          changedFiles: ["src/main.ts"],
          testsRun: true,
          commitMessageDraft: "feat: add X",
          prBodyDraft: "## Summary\nAdded X",
        },
      };
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y", "--verbose",
    ]);

    const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string);
    const progressLines = stderrCalls.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.event === "state_transition";
      } catch {
        return false;
      }
    });
    expect(progressLines.length).toBeGreaterThan(0);

    for (const line of progressLines) {
      const parsed = JSON.parse(line);
      expect(parsed.agent).toBe("Workflow");
      expect(parsed.ts).toBeDefined();
    }
  });

  it("does not emit progress lines without --verbose", async () => {
    mockRunWorkflow.mockImplementation(async (_ctx: any, _handlers: any, _persistence: any, options: any) => {
      options?.onTransition?.("init", "planning");
      return {
        runId: "run-nv1",
        state: "done",
        prNumber: 42,
        result: {
          changeSummary: "Added X",
          changedFiles: ["src/main.ts"],
          testsRun: true,
          commitMessageDraft: "feat: add X",
          prBodyDraft: "## Summary\nAdded X",
        },
      };
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y",
    ]);

    const stderrCalls = stderrSpy.mock.calls.map((c) => c[0] as string);
    const progressLines = stderrCalls.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.event === "state_transition";
      } catch {
        return false;
      }
    });
    expect(progressLines.length).toBe(0);
  });

  it("stdout still contains only the final structured result JSON with --verbose", async () => {
    mockRunWorkflow.mockImplementation(async (_ctx: any, _handlers: any, _persistence: any, options: any) => {
      options?.onTransition?.("init", "planning");
      return {
        runId: "run-v2",
        state: "done",
        prNumber: 42,
        result: {
          changeSummary: "Added X",
          changedFiles: ["src/main.ts"],
          testsRun: true,
          commitMessageDraft: "feat: add X",
          prBodyDraft: "## Summary\nAdded X",
        },
      };
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y", "--verbose",
    ]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0] as string);
    const resultLines = stdoutCalls.filter((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.status !== undefined;
      } catch {
        return false;
      }
    });
    expect(resultLines).toHaveLength(1);
    expect(JSON.parse(resultLines[0]!).status).toBe("done");
  });
});

describe("run command result output", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs structured JSON result to stdout on success", async () => {
    mockRunWorkflow.mockResolvedValue({
      runId: "run-123",
      targetKind: "issue",
      issueNumber: 10,
      repo: "owner/repo",
      cwd: "/tmp/repo",
      state: "done",
      branch: "aidev/issue-10",
      base: "main",
      maxFixAttempts: 3,
      fixAttempts: 0,
      dryRun: false,
      autoMerge: false,
      issueLabels: [],
      skipStates: [],
      skipAuthorCheck: false,
      prNumber: 42,
      result: {
        changeSummary: "Added feature X",
        changedFiles: ["src/main.ts"],
        testsRun: true,
        commitMessageDraft: "feat: add X",
        prBodyDraft: "## Summary\nAdded X",
      },
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y",
    ]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0] as string);
    const resultLine = stdoutCalls.find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.status !== undefined;
      } catch {
        return false;
      }
    });

    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!);
    expect(result.status).toBe("done");
    expect(result.prNumber).toBe(42);
    expect(result.changedFiles).toEqual(["src/main.ts"]);
  });

  it("outputs structured JSON error to stdout on failure", async () => {
    mockRunWorkflow.mockResolvedValue({
      runId: "run-456",
      targetKind: "issue",
      issueNumber: 10,
      repo: "owner/repo",
      cwd: "/tmp/repo",
      state: "failed",
      branch: "aidev/issue-10",
      base: "main",
      maxFixAttempts: 3,
      fixAttempts: 0,
      dryRun: false,
      autoMerge: false,
      issueLabels: [],
      skipStates: [],
      skipAuthorCheck: false,
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y",
    ]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0] as string);
    const resultLine = stdoutCalls.find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.status !== undefined;
      } catch {
        return false;
      }
    });

    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!);
    expect(result.status).toBe("failed");
    expect(result.failedAt).toBe("failed");
  });

  it("outputs structured JSON error to stdout on uncaught exception", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("Planner emitted no output for 30000ms"));

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y",
    ]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0] as string);
    const resultLine = stdoutCalls.find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed.status !== undefined;
      } catch {
        return false;
      }
    });

    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Planner emitted no output");
  });

  it("reports the last known state in failedAt when workflow crashes mid-run", async () => {
    mockRunWorkflow.mockImplementation(async (_ctx: any, _handlers: any, _persistence: any, options: any) => {
      options?.onTransition?.("init", "planning");
      options?.onTransition?.("planning", "implementing");
      throw new Error("Agent timeout");
    });

    const cli = createCli();
    await cli.parseAsync([
      "node", "aidev", "run", "--issue", "10",
      "--repo", "owner/repo", "--cwd", "/tmp/repo", "-y",
    ]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => c[0] as string);
    const resultLine = stdoutCalls.find((line) => {
      try {
        return JSON.parse(line).status !== undefined;
      } catch {
        return false;
      }
    });

    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!);
    expect(result.status).toBe("failed");
    expect(result.failedAt).toBe("implementing");
  });
});