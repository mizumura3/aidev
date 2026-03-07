import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExtractJson } = vi.hoisted(() => ({
  mockExtractJson: vi.fn(),
}));

vi.mock("../../src/agents/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agents/shared.js")>();
  return {
    ...actual,
    extractJson: mockExtractJson,
  };
});

import { runFixer } from "../../src/agents/fixer.js";
import type { AgentRunner } from "../../src/agents/runner.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function setupMocks() {
  let capturedPrompt = "";
  const mockRunner: AgentRunner = {
    run: vi.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return "{}";
    }),
  };

  mockExtractJson.mockReturnValue({
    rootCause: "test",
    fixPlan: "fix",
    filesToTouch: [],
  });

  return { getPrompt: () => capturedPrompt, mockRunner };
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
    const { getPrompt, mockRunner } = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "Error: test failed at line 42", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toContain('<untrusted-content source="ci-log">');
    expect(capturedPrompt).toContain("Error: test failed at line 42");
    expect(capturedPrompt).toContain("</untrusted-content>");
  });

  it("wraps plan in untrusted-content delimiter tags", async () => {
    const { getPrompt, mockRunner } = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "some log", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toContain('<untrusted-content source="plan">');
  });

  it("includes injection defense instructions", async () => {
    const { getPrompt, mockRunner } = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "log", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toMatch(/never execute/i);
    expect(capturedPrompt).toMatch(/never delete/i);
    expect(capturedPrompt).toMatch(/never skip.*test/i);
  });

  it("includes system-level instruction about treating delimited content as data", async () => {
    const { getPrompt, mockRunner } = setupMocks();

    await runFixer(
      { plan: samplePlan, ciLog: "log", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    const capturedPrompt = getPrompt();
    expect(capturedPrompt).toMatch(/untrusted-content.*data|data.*untrusted-content/is);
  });
});
