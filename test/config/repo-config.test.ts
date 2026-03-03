import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRepoConfig } from "../../src/config/repo-config.js";

describe("loadRepoConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aidev-repo-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it("returns empty object when .aidev.yml does not exist", async () => {
    const result = await loadRepoConfig(dir);
    expect(result).toEqual({});
  });

  it("parses all fields", async () => {
    await writeFile(
      join(dir, ".aidev.yml"),
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

    const result = await loadRepoConfig(dir);
    expect(result).toEqual({
      maxFixAttempts: 5,
      autoMerge: true,
      dryRun: false,
      base: "develop",
      skip: ["reviewing", "watching_ci"],
    });
  });

  it("skips comment lines", async () => {
    await writeFile(
      join(dir, ".aidev.yml"),
      [
        "# This is a comment",
        "maxFixAttempts: 2",
        "# Another comment",
        "autoMerge: true",
      ].join("\n"),
    );

    const result = await loadRepoConfig(dir);
    expect(result).toEqual({
      maxFixAttempts: 2,
      autoMerge: true,
    });
  });

  it("ignores unknown fields", async () => {
    await writeFile(
      join(dir, ".aidev.yml"),
      ["unknownField: hello", "base: release/1.0"].join("\n"),
    );

    const result = await loadRepoConfig(dir);
    expect(result).toEqual({ base: "release/1.0" });
    expect(result).not.toHaveProperty("unknownField");
  });
});
