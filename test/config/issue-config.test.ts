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
});
