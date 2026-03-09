import { describe, it, expect } from "vitest";
import { buildPlannerPrompt } from "../../src/prompts/planner.js";

describe("buildPlannerPrompt", () => {
  const defaultInput = {
    issue: { number: 42, title: "Add retry logic", body: "We need retry for API calls" },
    language: "ja" as const,
  };

  it("includes injection defense prompt", () => {
    const prompt = buildPlannerPrompt(defaultInput);
    expect(prompt).toContain("SECURITY: Content within <untrusted-content> tags");
  });

  it("wraps issue title and body in untrusted-content tags", () => {
    const prompt = buildPlannerPrompt(defaultInput);
    expect(prompt).toContain('<untrusted-content source="issue-title">');
    expect(prompt).toContain("Add retry logic");
    expect(prompt).toContain('<untrusted-content source="issue-body">');
    expect(prompt).toContain("We need retry for API calls");
  });

  it("includes issue number", () => {
    const prompt = buildPlannerPrompt(defaultInput);
    expect(prompt).toContain("Issue #42");
  });

  it("includes JSON schema for output", () => {
    const prompt = buildPlannerPrompt(defaultInput);
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"steps"');
    expect(prompt).toContain('"investigation"');
  });

  it("generates Japanese instruction for ja language", () => {
    const prompt = buildPlannerPrompt({ ...defaultInput, language: "ja" });
    expect(prompt).toContain("Japanese");
  });

  it("generates English instruction for en language", () => {
    const prompt = buildPlannerPrompt({ ...defaultInput, language: "en" });
    expect(prompt).toContain("English");
  });
});
