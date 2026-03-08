import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFiles = new Map<string, string>();

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return content;
  }),
  readdir: vi.fn(async (path: string) => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const entries: string[] = [];
    for (const key of mockFiles.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) entries.push(rest);
      }
    }
    if (entries.length === 0 && !mockFiles.has(path)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }
    return entries;
  }),
}));

import { loadProjectInstructions } from "../../src/agents/instructions-loader.js";

describe("loadProjectInstructions", () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it("reads CLAUDE.md from project root", async () => {
    mockFiles.set("/project/CLAUDE.md", "# Project instructions\nDo X and Y.");

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("# Project instructions\nDo X and Y.");
  });

  it("reads .claude/rules/*.md files", async () => {
    mockFiles.set("/project/.claude/rules/alpha.md", "Rule alpha");
    mockFiles.set("/project/.claude/rules/beta.md", "Rule beta");

    const result = await loadProjectInstructions("/project");
    expect(result).toContain("Rule alpha");
    expect(result).toContain("Rule beta");
  });

  it("combines CLAUDE.md and rules files", async () => {
    mockFiles.set("/project/CLAUDE.md", "Main instructions");
    mockFiles.set("/project/.claude/rules/rule1.md", "Rule one");

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("Main instructions\n\nRule one");
  });

  it("returns empty string when neither exists", async () => {
    const result = await loadProjectInstructions("/project");
    expect(result).toBe("");
  });

  it("skips empty CLAUDE.md", async () => {
    mockFiles.set("/project/CLAUDE.md", "   ");
    mockFiles.set("/project/.claude/rules/rule1.md", "Rule one");

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("Rule one");
  });

  it("sorts rule files alphabetically", async () => {
    mockFiles.set("/project/.claude/rules/z-rule.md", "Z rule");
    mockFiles.set("/project/.claude/rules/a-rule.md", "A rule");

    const result = await loadProjectInstructions("/project");
    expect(result).toBe("A rule\n\nZ rule");
  });
});
