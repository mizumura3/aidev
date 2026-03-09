import { describe, it, expect } from "vitest";
import { buildReviewerPrompt } from "../../src/prompts/reviewer.js";
import type { Plan } from "../../src/types.js";

describe("buildReviewerPrompt", () => {
  const plan: Plan = {
    summary: "Add retry logic",
    steps: ["Add retry util"],
    filesToTouch: ["src/retry.ts"],
    tests: ["test retry"],
    risks: [],
    acceptanceCriteria: ["Retry works"],
  };

  const defaultInput = {
    plan,
    diff: "diff --git a/src/retry.ts\n+export function retry() {}",
    language: "ja" as const,
  };

  it("includes injection defense prompt", () => {
    const prompt = buildReviewerPrompt(defaultInput);
    expect(prompt).toContain("SECURITY: Content within <untrusted-content> tags");
  });

  it("wraps plan and diff in untrusted-content tags", () => {
    const prompt = buildReviewerPrompt(defaultInput);
    expect(prompt).toContain('<untrusted-content source="plan">');
    expect(prompt).toContain('<untrusted-content source="diff">');
  });

  it("includes review round info when roundInfo is provided", () => {
    const prompt = buildReviewerPrompt({
      ...defaultInput,
      roundInfo: { round: 2, max: 3 },
    });
    expect(prompt).toContain("Round 2 of 3");
  });

  it("omits review round info when roundInfo is not provided", () => {
    const prompt = buildReviewerPrompt(defaultInput);
    expect(prompt).not.toContain("Round");
  });

  it("generates language instruction", () => {
    const jaPrompt = buildReviewerPrompt({ ...defaultInput, language: "ja" });
    expect(jaPrompt).toContain("Japanese");

    const enPrompt = buildReviewerPrompt({ ...defaultInput, language: "en" });
    expect(enPrompt).toContain("English");
  });
});
