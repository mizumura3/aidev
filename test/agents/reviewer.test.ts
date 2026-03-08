import { describe, it, expect, vi } from "vitest";
import { runReviewer, type ReviewerInput } from "../../src/agents/reviewer.js";
import type { Logger } from "../../src/util/logger.js";
import type { AgentRunner } from "../../src/agents/runner.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeInput(overrides?: Partial<ReviewerInput>): ReviewerInput {
  return {
    plan: {
      summary: "Add feature X",
      steps: ["Step 1"],
      filesToTouch: ["src/foo.ts"],
      tests: ["test/foo.test.ts"],
      risks: [],
      acceptanceCriteria: ["X works"],
    },
    diff: "diff --git a/src/foo.ts ...",
    cwd: "/tmp/repo",
    language: "ja",
    ...overrides,
  };
}

describe("runReviewer", () => {
  it("returns approve when agent outputs valid JSON", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "Implementation matches plan",
        })
      ),
    };

    const result = await runReviewer(makeInput(), makeLogger(), runner);

    expect(result.decision).toBe("approve");
    expect(result.mustFix).toEqual([]);
  });

  it("returns needs_discussion with reason", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "needs_discussion",
          mustFix: [],
          reason: "The approach contradicts existing architecture",
          summary: "Needs human review",
        })
      ),
    };

    const result = await runReviewer(makeInput(), makeLogger(), runner);

    expect(result.decision).toBe("needs_discussion");
    expect(result.reason).toBe("The approach contradicts existing architecture");
  });

  it("includes reviewRound in prompt when provided", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "LGTM",
        })
      ),
    };

    await runReviewer(
      makeInput(),
      makeLogger(),
      runner,
      undefined,
      { reviewRound: 3, maxReviewRounds: 5 }
    );

    const prompt = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Round 3 of 5");
  });

  it("includes staff engineer persona in prompt", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "LGTM",
        })
      ),
    };

    await runReviewer(makeInput(), makeLogger(), runner);

    const prompt = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("staff engineer");
  });

  it("includes needs_discussion in prompt JSON template", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "LGTM",
        })
      ),
    };

    await runReviewer(makeInput(), makeLogger(), runner);

    const prompt = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('"needs_discussion"');
  });

  it("passes reviewJsonSchema as outputSchema to runner", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "LGTM",
        })
      ),
    };

    await runReviewer(makeInput(), makeLogger(), runner);

    expect(runner.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        outputSchema: expect.objectContaining({ type: "object" }),
      })
    );
  });

  it("includes explicit output language instruction", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () =>
        JSON.stringify({
          decision: "approve",
          mustFix: [],
          summary: "LGTM",
        })
      ),
    };

    await runReviewer({ ...makeInput(), language: "en" }, makeLogger(), runner);

    const prompt = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Write all output text in English");
  });
});
