import { describe, it, expect, vi, beforeEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

import { loadProjectInstructions } from "../../src/agents/instructions-loader.js";

describe("loadProjectInstructions", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("reads CLAUDE.md from project root", async () => {
    vol.fromJSON({
      "/project/CLAUDE.md": "# Project instructions\nDo X and Y.",
    });

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("# Project instructions\nDo X and Y.");
  });

  it("reads .claude/rules/*.md files", async () => {
    vol.fromJSON({
      "/project/.claude/rules/alpha.md": "Rule alpha",
      "/project/.claude/rules/beta.md": "Rule beta",
    });

    const result = await loadProjectInstructions("/project");
    expect(result).toContain("Rule alpha");
    expect(result).toContain("Rule beta");
  });

  it("combines CLAUDE.md and rules files", async () => {
    vol.fromJSON({
      "/project/CLAUDE.md": "Main instructions",
      "/project/.claude/rules/rule1.md": "Rule one",
    });

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("Main instructions\n\nRule one");
  });

  it("returns empty string when neither exists", async () => {
    vol.fromJSON({ "/project/dummy.txt": "" });

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("");
  });

  it("skips empty CLAUDE.md", async () => {
    vol.fromJSON({
      "/project/CLAUDE.md": "   ",
      "/project/.claude/rules/rule1.md": "Rule one",
    });

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("Rule one");
  });

  it("sorts rule files alphabetically", async () => {
    vol.fromJSON({
      "/project/.claude/rules/z-rule.md": "Z rule",
      "/project/.claude/rules/a-rule.md": "A rule",
    });

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("A rule\n\nZ rule");
  });
});
