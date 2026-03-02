import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockExtractJson } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExtractJson: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockQuery,
}));

vi.mock("../../src/agents/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agents/shared.js")>();
  return {
    ...actual,
    createSafetyHook: () => ({ command: "true" }),
    extractJson: mockExtractJson,
    getBaseSdkOptions: () => ({ pathToClaudeCodeExecutable: "/usr/bin/claude" }),
  };
});

import { runFixer } from "../../src/agents/fixer.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function setupMocks() {
  let capturedPrompt = "";
  mockQuery.mockImplementation(({ prompt }: { prompt: string }) => {
    capturedPrompt = prompt;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "{}",
      };
    })();
  });

  mockExtractJson.mockReturnValue({
    rootCause: "test",
    fixPlan: "fix",
    filesToTouch: [],
  });

  return () => capturedPrompt;
}

const samplePlan = {
  summary: "s",
  steps: ["a"],
  filesToTouch: [],
  tests: [],
  risks: [],
  acceptanceCriteria: [],
  investigation: "test",
};

describe("runFixer prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps CI log in untrusted-content delimiter tags", async () => {
    const getPrompt = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "Error: test failed at line 42", cwd: "/tmp" },
      noopLogger as any
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toContain('<untrusted-content source="ci-log">');
    expect(capturedPrompt).toContain("Error: test failed at line 42");
    expect(capturedPrompt).toContain("</untrusted-content>");
  });

  it("wraps plan in untrusted-content delimiter tags", async () => {
    const getPrompt = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "some log", cwd: "/tmp" },
      noopLogger as any
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toContain('<untrusted-content source="plan">');
  });

  it("includes system-level instruction about treating delimited content as data", async () => {
    const getPrompt = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "log", cwd: "/tmp" },
      noopLogger as any
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toMatch(/untrusted-content.*data|data.*untrusted-content/is);
  });
});
