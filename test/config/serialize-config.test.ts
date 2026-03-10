import { describe, it, expect } from "vitest";
import {
  serializeConfig,
  buildResolvedConfigBlock,
  upsertAidevBlock,
} from "../../src/config/serialize-config.js";
import type { ResolvedConfig } from "../../src/config/issue-config.js";

describe("serializeConfig", () => {
  it("serializes all fields", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 5,
      maxReviewRounds: 1,
      autoMerge: true,
      dryRun: false,
      base: "develop",
      language: "ja",
      skip: ["reviewing", "watching_ci"],
    };

    const result = serializeConfig(config);
    expect(result).toBe(
      [
        "maxFixAttempts: 5",
        "maxReviewRounds: 1",
        "autoMerge: true",
        "dryRun: false",
        "base: develop",
        "language: ja",
        "skip:",
        "  - reviewing",
        "  - watching_ci",
      ].join("\n"),
    );
  });

  it("includes backend and model when present", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
      backend: "codex",
      model: "o3",
    };

    const result = serializeConfig(config);
    expect(result).toContain("backend: codex");
    expect(result).toContain("model: o3");
  });

  it("omits backend and model when undefined", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
    };

    const result = serializeConfig(config);
    expect(result).not.toContain("backend");
    expect(result).not.toContain("model");
  });

  it("serializes stateTimeouts as nested map", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
      stateTimeouts: { implementing: 1800000, reviewing: 600000 },
    };

    const result = serializeConfig(config);
    expect(result).toContain("stateTimeouts:");
    expect(result).toContain("  implementing: 1800000");
    expect(result).toContain("  reviewing: 600000");
  });

  it("sorts stateTimeouts entries alphabetically", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
      stateTimeouts: { reviewing: 600000, implementing: 1800000 },
    };

    const result = serializeConfig(config);
    const lines = result.split("\n");
    const timeoutLines = lines.filter((l) => l.startsWith("  ") && l.includes(":"));
    expect(timeoutLines[0]).toContain("implementing");
    expect(timeoutLines[1]).toContain("reviewing");
  });

  it("omits stateTimeouts when empty or undefined", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
    };

    const result = serializeConfig(config);
    expect(result).not.toContain("stateTimeouts");
  });

  it("omits skip line when skip is empty array", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
    };

    const result = serializeConfig(config);
    expect(result).not.toContain("skip");
    expect(result).toBe(
      [
        "maxFixAttempts: 3",
        "maxReviewRounds: 1",
        "autoMerge: false",
        "dryRun: false",
        "base: main",
        "language: ja",
      ].join("\n"),
    );
  });
});

describe("buildResolvedConfigBlock", () => {
  it("wraps config in aidev code fence", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
    };

    const result = buildResolvedConfigBlock(config);
    expect(result).toBe(
      [
        "```aidev",
        "maxFixAttempts: 3",
        "maxReviewRounds: 1",
        "autoMerge: false",
        "dryRun: false",
        "base: main",
        "language: ja",
        "```",
      ].join("\n"),
    );
  });
});

describe("stateTimeouts round-trip", () => {
  it("serialize → parse preserves stateTimeouts values", async () => {
    const { parseConfigBlock } = await import("../../src/config/issue-config.js");
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      maxReviewRounds: 1,
      autoMerge: false,
      dryRun: false,
      base: "main",
      language: "ja",
      skip: [],
      stateTimeouts: { implementing: 1800000, reviewing: 600000 },
    };

    const serialized = serializeConfig(config);
    const parsed = parseConfigBlock(serialized);

    expect(parsed.stateTimeouts).toEqual({
      implementing: 1800000,
      reviewing: 600000,
    });
  });
});

describe("upsertAidevBlock", () => {
  it("replaces existing aidev block", () => {
    const body = "Some text\n```aidev\nold: config\n```\nMore text";
    const block = "```aidev\nnew: config\n```";

    const result = upsertAidevBlock(body, block);
    expect(result).toBe("Some text\n```aidev\nnew: config\n```\nMore text");
  });

  it("appends block when no existing aidev block", () => {
    const body = "Issue description here.";
    const block = "```aidev\nbase: main\n```";

    const result = upsertAidevBlock(body, block);
    expect(result).toBe("Issue description here.\n\n```aidev\nbase: main\n```");
  });

  it("returns block alone when body is empty", () => {
    const block = "```aidev\nbase: main\n```";

    const result = upsertAidevBlock("", block);
    expect(result).toBe("```aidev\nbase: main\n```");
  });

  it("replaces only the first aidev block", () => {
    const body = "```aidev\nfirst\n```\ntext\n```aidev\nsecond\n```";
    const block = "```aidev\nreplaced\n```";

    const result = upsertAidevBlock(body, block);
    expect(result).toBe("```aidev\nreplaced\n```\ntext\n```aidev\nsecond\n```");
  });
});
