import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockQuery,
}));

vi.mock("../../src/agents/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agents/shared.js")>();
  return {
    ...actual,
    createSafetyHook: () => ({ command: "true" }),
    getBaseSdkOptions: () => ({ pathToClaudeCodeExecutable: "/usr/bin/claude" }),
  };
});

import { runDocumenter } from "../../src/agents/documenter.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("runDocumenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes changedFiles and changeSummary in the prompt", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation(({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return (async function* () {
        yield { type: "result", subtype: "success", result: "" };
      })();
    });

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
      noopLogger as any
    );

    expect(capturedPrompt).toContain("Added watch --interval flag");
    expect(capturedPrompt).toContain("src/cli.ts");
    expect(capturedPrompt).toContain("src/workflow/engine.ts");
  });

  it("instructs to update README when user-facing changes exist", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation(({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return (async function* () {
        yield { type: "result", subtype: "success", result: "" };
      })();
    });

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
      noopLogger as any
    );

    expect(capturedPrompt).toContain("README");
    expect(capturedPrompt).toMatch(/no.*update|skip|unnecessary|not needed|do nothing/i);
  });

  it("uses only Read, Glob, Grep, Write, Edit tools", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockQuery.mockImplementation(({ options }: { prompt: string; options: Record<string, unknown> }) => {
      capturedOptions = options;
      return (async function* () {
        yield { type: "result", subtype: "success", result: "" };
      })();
    });

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
      noopLogger as any
    );

    expect(capturedOptions.allowedTools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
    ]);
  });

  it("sets maxTurns to 10", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockQuery.mockImplementation(({ options }: { prompt: string; options: Record<string, unknown> }) => {
      capturedOptions = options;
      return (async function* () {
        yield { type: "result", subtype: "success", result: "" };
      })();
    });

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
      noopLogger as any
    );

    expect(capturedOptions.maxTurns).toBe(10);
  });
});
