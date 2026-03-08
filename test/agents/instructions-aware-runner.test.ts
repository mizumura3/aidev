import { describe, it, expect, vi } from "vitest";
import { InstructionsAwareRunner } from "../../src/agents/instructions-aware-runner.js";
import type { AgentRunner, AgentRunOptions } from "../../src/agents/runner.js";

function createMockRunner(): AgentRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async () => "mock result"),
  };
}

const baseOptions: AgentRunOptions = {
  cwd: "/tmp",
  agentName: "test",
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
};

describe("InstructionsAwareRunner", () => {
  it("prepends instructions to the prompt", async () => {
    const inner = createMockRunner();
    const runner = new InstructionsAwareRunner(inner, "Do this and that.");

    await runner.run("Original prompt", baseOptions);

    expect(inner.run).toHaveBeenCalledTimes(1);
    const actualPrompt = inner.run.mock.calls[0][0] as string;
    expect(actualPrompt).toContain("<project-instructions>");
    expect(actualPrompt).toContain("Do this and that.");
    expect(actualPrompt).toContain("Original prompt");
    // Instructions come before the original prompt
    expect(actualPrompt.indexOf("Do this and that.")).toBeLessThan(
      actualPrompt.indexOf("Original prompt"),
    );
  });

  it("passes through when instructions are empty", async () => {
    const inner = createMockRunner();
    const runner = new InstructionsAwareRunner(inner, "");

    await runner.run("Original prompt", baseOptions);

    expect(inner.run).toHaveBeenCalledWith("Original prompt", baseOptions);
  });

  it("passes options through unchanged", async () => {
    const inner = createMockRunner();
    const runner = new InstructionsAwareRunner(inner, "Instructions");

    await runner.run("Prompt", baseOptions);

    expect(inner.run.mock.calls[0][1]).toBe(baseOptions);
  });

  it("returns the inner runner result", async () => {
    const inner = createMockRunner();
    inner.run.mockResolvedValue("inner result");
    const runner = new InstructionsAwareRunner(inner, "Instructions");

    const result = await runner.run("Prompt", baseOptions);
    expect(result).toBe("inner result");
  });
});
