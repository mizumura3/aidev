import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAidevYml, writeAidevYml } from "../src/config/init.js";

describe("generateAidevYml", () => {
  it("generates a template with all fields", () => {
    const content = generateAidevYml();
    expect(content).toContain("maxFixAttempts: 3");
    expect(content).toContain("autoMerge: false");
    expect(content).toContain("dryRun: false");
    expect(content).toContain("base: main");
    expect(content).toContain("# skip:");
  });
});

describe("writeAidevYml", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aidev-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("creates .aidev.yml in the specified directory", async () => {
    await writeAidevYml(dir, false);

    const content = await readFile(join(dir, ".aidev.yml"), "utf-8");
    expect(content).toContain("maxFixAttempts: 3");
  });

  it("throws when file already exists without force", async () => {
    await writeFile(join(dir, ".aidev.yml"), "existing");

    await expect(writeAidevYml(dir, false)).rejects.toThrow("already exists");
  });

  it("overwrites existing file with force", async () => {
    await writeFile(join(dir, ".aidev.yml"), "old content");

    await writeAidevYml(dir, true);

    const content = await readFile(join(dir, ".aidev.yml"), "utf-8");
    expect(content).toContain("maxFixAttempts: 3");
  });
});
