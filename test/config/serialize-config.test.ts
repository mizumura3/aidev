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
      autoMerge: true,
      dryRun: false,
      base: "develop",
      skip: ["reviewing", "watching_ci"],
    };

    const result = serializeConfig(config);
    expect(result).toBe(
      [
        "maxFixAttempts: 5",
        "autoMerge: true",
        "dryRun: false",
        "base: develop",
        "skip:",
        "  - reviewing",
        "  - watching_ci",
      ].join("\n"),
    );
  });

  it("omits skip line when skip is empty array", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      autoMerge: false,
      dryRun: false,
      base: "main",
      skip: [],
    };

    const result = serializeConfig(config);
    expect(result).not.toContain("skip");
    expect(result).toBe(
      [
        "maxFixAttempts: 3",
        "autoMerge: false",
        "dryRun: false",
        "base: main",
      ].join("\n"),
    );
  });
});

describe("buildResolvedConfigBlock", () => {
  it("wraps config in aidev code fence", () => {
    const config: ResolvedConfig = {
      maxFixAttempts: 3,
      autoMerge: false,
      dryRun: false,
      base: "main",
      skip: [],
    };

    const result = buildResolvedConfigBlock(config);
    expect(result).toBe(
      [
        "```aidev",
        "maxFixAttempts: 3",
        "autoMerge: false",
        "dryRun: false",
        "base: main",
        "```",
      ].join("\n"),
    );
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
