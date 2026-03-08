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

import { runImplementer } from "../../src/agents/implementer.js";
import type { AgentRunner } from "../../src/agents/runner.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const samplePlan = {
  summary: "s",
  steps: ["a"],
  filesToTouch: [],
  tests: [],
  risks: [],
  acceptanceCriteria: [],
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
    changeSummary: "done",
    changedFiles: ["a.ts"],
    testsRun: true,
    commitMessageDraft: "feat: x",
    prBodyDraft: "## 概要\ntest",
  });

  return { getPrompt: () => capturedPrompt, mockRunner };
}

describe("runImplementer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes resultJsonSchema as outputSchema to runner", async () => {
    const { mockRunner } = setupMocks();

    await runImplementer(
      { plan: samplePlan, workItemNumber: 1, workItemKind: "issue", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    expect(mockRunner.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        outputSchema: expect.objectContaining({ type: "object" }),
      })
    );
  });

  it("passes correct options to runner", async () => {
    const { mockRunner } = setupMocks();

    await runImplementer(
      { plan: samplePlan, workItemNumber: 1, workItemKind: "issue", cwd: "/tmp" },
      noopLogger as any,
      mockRunner
    );

    expect(mockRunner.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cwd: "/tmp",
        agentName: "Implementer",
        maxTurns: 50,
      })
    );
  });
});
