import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

describe("LICENSE file", () => {
  const license = readFileSync(resolve(root, "LICENSE"), "utf-8");

  it("contains MIT License text", () => {
    expect(license).toContain("MIT License");
  });

  it("contains correct copyright holder", () => {
    expect(license).toContain("Satoshi Mizumura");
  });

  it("contains correct year", () => {
    expect(license).toContain("2026");
  });
});

describe(".gitignore", () => {
  const gitignore = readFileSync(resolve(root, ".gitignore"), "utf-8");

  it("contains .env entry", () => {
    const lines = gitignore.split("\n").map((l) => l.trim());
    expect(lines).toContain(".env");
  });
});

describe("package.json", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf-8")
  );

  it('has license field set to "MIT"', () => {
    expect(pkg.license).toBe("MIT");
  });
});
