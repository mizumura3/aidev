import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockExtractJson } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExtractJson: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockQuery,
}));

vi.mock("../../src/agents/shared.js", () => ({
  createSafetyHook: () => ({ command: "true" }),
  extractJson: mockExtractJson,
  getBaseSdkOptions: () => ({ pathToClaudeCodeExecutable: "/usr/bin/claude" }),
}));

import { runPlanner } from "../../src/agents/planner.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("runPlanner prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes investigation format instructions for markdown lists and inline code", async () => {
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
      summary: "s",
      steps: ["a"],
      filesToTouch: [],
      tests: [],
      risks: [],
      acceptanceCriteria: [],
      investigation: "test",
    });

    await runPlanner(
      { issue: { number: 1, title: "Test", body: "body", labels: [] }, cwd: "/tmp" },
      noopLogger as any
    );

    // Verify the prompt instructs markdown bullet list format for investigation
    expect(capturedPrompt).toContain("investigation");
    expect(capturedPrompt).toMatch(/bullet|`-`|list/i);
    expect(capturedPrompt).toMatch(/backtick|inline code|`/);
  });
});
