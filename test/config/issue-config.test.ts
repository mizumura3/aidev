import { describe, it, expect } from "vitest";
import { parseIssueConfig, type IssueConfig } from "../../src/config/issue-config.js";

describe("parseIssueConfig", () => {
  it("returns empty config when body has no aidev block", () => {
    const result = parseIssueConfig("Just a regular issue body");
    expect(result).toEqual({});
  });

  it("returns empty config when body is empty", () => {
    const result = parseIssueConfig("");
    expect(result).toEqual({});
  });

  it("parses maxFixAttempts", () => {
    const body = "Some text\n```aidev\nmaxFixAttempts: 5\n```\nMore text";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBe(5);
  });

  it("parses autoMerge", () => {
    const body = "```aidev\nautoMerge: true\n```";
    const result = parseIssueConfig(body);
    expect(result.autoMerge).toBe(true);
  });

  it("parses dryRun", () => {
    const body = "```aidev\ndryRun: true\n```";
    const result = parseIssueConfig(body);
    expect(result.dryRun).toBe(true);
  });

  it("parses base branch", () => {
    const body = "```aidev\nbase: release/1.3\n```";
    const result = parseIssueConfig(body);
    expect(result.base).toBe("release/1.3");
  });

  it("parses skip list", () => {
    const body = "```aidev\nskip:\n  - reviewing\n  - watching_ci\n```";
    const result = parseIssueConfig(body);
    expect(result.skip).toEqual(["reviewing", "watching_ci"]);
  });

  it("parses all fields together", () => {
    const body = [
      "## Issue description",
      "",
      "```aidev",
      "maxFixAttempts: 5",
      "autoMerge: true",
      "dryRun: false",
      "base: release/1.3",
      "language: en",
      "skip:",
      "  - reviewing",
      "  - documenter",
      "```",
      "",
      "More details here.",
    ].join("\n");

    const result = parseIssueConfig(body);
    expect(result).toEqual({
      maxFixAttempts: 5,
      autoMerge: true,
      dryRun: false,
      base: "release/1.3",
      language: "en",
      skip: ["reviewing", "documenter"],
    });
  });

  it("ignores unknown fields", () => {
    const body = "```aidev\nunknownField: 42\nmaxFixAttempts: 3\n```";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBe(3);
    expect(result).not.toHaveProperty("unknownField");
  });

  it("ignores invalid skip values", () => {
    const body = "```aidev\nskip:\n  - reviewing\n  - invalid_state\n```";
    const result = parseIssueConfig(body);
    expect(result.skip).toEqual(["reviewing"]);
  });

  it("ignores non-numeric maxFixAttempts", () => {
    const body = "```aidev\nmaxFixAttempts: abc\n```";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBeUndefined();
  });

  it("ignores non-boolean autoMerge", () => {
    const body = "```aidev\nautoMerge: yes\n```";
    const result = parseIssueConfig(body);
    expect(result.autoMerge).toBeUndefined();
  });

  it("handles aidev block with extra whitespace", () => {
    const body = "```aidev  \n  maxFixAttempts: 5  \n```";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBe(5);
  });

  it("only extracts the first aidev block", () => {
    const body = "```aidev\nmaxFixAttempts: 5\n```\n\n```aidev\nmaxFixAttempts: 10\n```";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBe(5);
  });

  it("does not confuse other code blocks", () => {
    const body = "```yaml\nmaxFixAttempts: 99\n```\n\n```aidev\nmaxFixAttempts: 3\n```";
    const result = parseIssueConfig(body);
    expect(result.maxFixAttempts).toBe(3);
  });

  it("parses skip with single item", () => {
    const body = "```aidev\nskip:\n  - documenter\n```";
    const result = parseIssueConfig(body);
    expect(result.skip).toEqual(["documenter"]);
  });

  it("parses backend field", () => {
    const body = "```aidev\nbackend: claude-code\n```";
    const result = parseIssueConfig(body);
    expect(result.backend).toBe("claude-code");
  });

  it("parses model field", () => {
    const body = "```aidev\nmodel: sonnet\n```";
    const result = parseIssueConfig(body);
    expect(result.model).toBe("sonnet");
  });

  it("ignores empty backend value", () => {
    const body = "```aidev\nbackend:\nmaxFixAttempts: 3\n```";
    const result = parseIssueConfig(body);
    expect(result.backend).toBeUndefined();
    expect(result.maxFixAttempts).toBe(3);
  });

  it("ignores empty model value", () => {
    const body = "```aidev\nmodel:\nmaxFixAttempts: 3\n```";
    const result = parseIssueConfig(body);
    expect(result.model).toBeUndefined();
    expect(result.maxFixAttempts).toBe(3);
  });

  it("parses maxReviewRounds", () => {
    const body = "```aidev\nmaxReviewRounds: 5\n```";
    const result = parseIssueConfig(body);
    expect(result.maxReviewRounds).toBe(5);
  });

  it("ignores non-numeric maxReviewRounds", () => {
    const body = "```aidev\nmaxReviewRounds: abc\n```";
    const result = parseIssueConfig(body);
    expect(result.maxReviewRounds).toBeUndefined();
  });

  it("ignores zero maxReviewRounds", () => {
    const body = "```aidev\nmaxReviewRounds: 0\n```";
    const result = parseIssueConfig(body);
    expect(result.maxReviewRounds).toBeUndefined();
  });

  it("parses language when value is ja or en", () => {
    const body = "```aidev\nlanguage: en\n```";
    const result = parseIssueConfig(body);
    expect(result.language).toBe("en");
  });

  it("ignores invalid language values", () => {
    const body = "```aidev\nlanguage: fr\nmaxFixAttempts: 3\n```";
    const result = parseIssueConfig(body);
    expect(result.language).toBeUndefined();
    expect(result.maxFixAttempts).toBe(3);
  });

  it("parses stateTimeouts with valid state keys", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 1800000",
      "  reviewing: 600000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toEqual({
      implementing: 1800000,
      reviewing: 600000,
    });
  });

  it("ignores stateTimeouts with invalid state keys", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 1800000",
      "  nonexistent: 600000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toEqual({
      implementing: 1800000,
    });
  });

  it("ignores stateTimeouts with non-numeric values", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: abc",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toBeUndefined();
  });

  it("rejects stateTimeouts below MIN_STATE_TIMEOUT_MS (5000ms)", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 1",
      "  reviewing: 10000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    // implementing: 1ms is below 5000ms minimum → rejected
    // reviewing: 10000ms is above minimum → accepted
    expect(result.stateTimeouts).toEqual({
      reviewing: 10000,
    });
  });

  it("rejects stateTimeouts of exactly MIN_STATE_TIMEOUT_MS - 1", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 4999",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toBeUndefined();
  });

  it("accepts stateTimeouts of exactly MIN_STATE_TIMEOUT_MS", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 5000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toEqual({
      implementing: 5000,
    });
  });

  it("rejects stateTimeouts above MAX_STATE_TIMEOUT_MS (1 hour)", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 7200000",
      "  reviewing: 600000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    // implementing: 7200000 (2h) exceeds 3600000 (1h) max → rejected
    // reviewing: 600000 (10min) is within range → accepted
    expect(result.stateTimeouts).toEqual({
      reviewing: 600000,
    });
  });

  it("accepts stateTimeouts of exactly MAX_STATE_TIMEOUT_MS", () => {
    const body = [
      "```aidev",
      "stateTimeouts:",
      "  implementing: 3600000",
      "```",
    ].join("\n");
    const result = parseIssueConfig(body);
    expect(result.stateTimeouts).toEqual({
      implementing: 3600000,
    });
  });

  it("rejects base field with path traversal", () => {
    const body = "```aidev\nbase: ../../etc/passwd\n```";
    const result = parseIssueConfig(body);
    expect(result.base).toBeUndefined();
  });

  it("rejects base field with special characters", () => {
    const body = "```aidev\nbase: main; rm -rf /\n```";
    const result = parseIssueConfig(body);
    expect(result.base).toBeUndefined();
  });

  it("accepts valid branch names in base field", () => {
    const body = "```aidev\nbase: release/1.3\n```";
    const result = parseIssueConfig(body);
    expect(result.base).toBe("release/1.3");
  });

  it("accepts tag-style base values", () => {
    const body = "```aidev\nbase: v1.2.0\n```";
    const result = parseIssueConfig(body);
    expect(result.base).toBe("v1.2.0");
  });
});
