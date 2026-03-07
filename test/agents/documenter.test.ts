import { describe, it, expect, vi, beforeEach } from "vitest";

import { runDocumenter } from "../../src/agents/documenter.js";
import type { AgentRunner, AgentRunOptions } from "../../src/agents/runner.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockRunner() {
  let capturedPrompt = "";
  let capturedOptions: AgentRunOptions | undefined;
  const mockRunner: AgentRunner = {
    run: vi.fn(async (prompt: string, options: AgentRunOptions) => {
      capturedPrompt = prompt;
      capturedOptions = options;
      return "";
    }),
  };
  return {
    mockRunner,
    getPrompt: () => capturedPrompt,
    getOptions: () => capturedOptions!,
  };
}

describe("runDocumenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes changedFiles and changeSummary in the prompt", async () => {
    const { mockRunner, getPrompt } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "Added watch --interval flag",
          changedFiles: ["src/cli.ts", "src/workflow/engine.ts"],
          testsRun: true,
          commitMessageDraft: "feat: add interval flag",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getPrompt()).toContain("Added watch --interval flag");
    expect(getPrompt()).toContain("src/cli.ts");
    expect(getPrompt()).toContain("src/workflow/engine.ts");
  });

  it("instructs to update README when user-facing changes exist", async () => {
    const { mockRunner, getPrompt } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "Refactored internals",
          changedFiles: ["src/util/logger.ts"],
          testsRun: true,
          commitMessageDraft: "refactor: logger",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getPrompt()).toContain("README");
    expect(getPrompt()).toMatch(/no.*update|skip|unnecessary|not needed|do nothing/i);
  });

  it("uses only Read, Glob, Grep, Write, Edit tools", async () => {
    const { mockRunner, getOptions } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "test",
          changedFiles: ["a.ts"],
          testsRun: true,
          commitMessageDraft: "test",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getOptions().allowedTools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
    ]);
  });

  it("wraps changedFiles in untrusted-content tags", async () => {
    const { mockRunner, getPrompt } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "test summary",
          changedFiles: ["src/cli.ts", "src/engine.ts"],
          testsRun: true,
          commitMessageDraft: "test",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getPrompt()).toContain('<untrusted-content source="changed-files">');
    expect(getPrompt()).toContain("src/cli.ts");
  });

  it("wraps changeSummary in untrusted-content tags", async () => {
    const { mockRunner, getPrompt } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "Added watch --interval flag",
          changedFiles: ["src/cli.ts"],
          testsRun: true,
          commitMessageDraft: "test",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getPrompt()).toContain('<untrusted-content source="change-summary">');
    expect(getPrompt()).toContain("Added watch --interval flag");
  });

  it("includes injection defense instructions", async () => {
    const { mockRunner, getPrompt } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "test",
          changedFiles: ["a.ts"],
          testsRun: true,
          commitMessageDraft: "test",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getPrompt()).toMatch(/never execute/i);
    expect(getPrompt()).toMatch(/never delete/i);
    expect(getPrompt()).toMatch(/never skip.*test/i);
  });

  it("sets maxTurns to 10", async () => {
    const { mockRunner, getOptions } = createMockRunner();

    await runDocumenter(
      {
        result: {
          changeSummary: "test",
          changedFiles: ["a.ts"],
          testsRun: true,
          commitMessageDraft: "test",
          prBodyDraft: "",
        },
        cwd: "/tmp/repo",
      },
      noopLogger as any,
      mockRunner
    );

    expect(getOptions().maxTurns).toBe(10);
  });
});
