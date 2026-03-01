import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLintDetector } from "../../../src/improve/detectors/lint.js";
import { access } from "node:fs/promises";

const { mockExeca, mockAccess } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
  mockAccess: vi.fn(),
}));
vi.mock("execa", () => ({
  execa: mockExeca,
}));
vi.mock("node:fs/promises", () => ({
  access: mockAccess,
}));

describe("LintDetector", () => {
  const detector = createLintDetector();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'lint'", () => {
    expect(detector.name).toBe("lint");
  });

  it("detects ESLint config and runs eslint --format json", async () => {
    // eslint config exists
    mockAccess.mockResolvedValueOnce(undefined);
    // biome config does not exist
    mockAccess.mockRejectedValueOnce(new Error("not found"));

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          filePath: "/tmp/repo/src/app.ts",
          messages: [
            { ruleId: "no-unused-vars", message: "x is unused", line: 5, column: 1 },
          ],
        },
      ]),
    });

    const findings = await detector.detect("/tmp/repo");

    expect(mockExeca).toHaveBeenCalledWith(
      "npx",
      ["eslint", ".", "--format", "json"],
      expect.objectContaining({ cwd: "/tmp/repo", reject: false }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: "[aidev] Lint: no-unused-vars in src/app.ts",
      body: expect.stringContaining("x is unused"),
      category: "lint",
      filePath: "src/app.ts",
    });
  });

  it("detects biome config and runs biome lint --reporter json", async () => {
    // eslint.config.js does not exist
    mockAccess.mockRejectedValueOnce(new Error("not found"));
    // .eslintrc.json does not exist (chained check)
    mockAccess.mockRejectedValueOnce(new Error("not found"));
    // biome.json exists
    mockAccess.mockResolvedValueOnce(undefined);

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: "lint/suspicious/noDoubleEquals",
            message: "Use === instead of ==",
            location: { path: { file: "src/utils.ts" }, span: { start: { line: 10 } } },
          },
        ],
      }),
    });

    const findings = await detector.detect("/tmp/repo");

    expect(mockExeca).toHaveBeenCalledWith(
      "npx",
      ["biome", "lint", ".", "--reporter", "json"],
      expect.objectContaining({ cwd: "/tmp/repo", reject: false }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: "[aidev] Lint: lint/suspicious/noDoubleEquals in src/utils.ts",
      body: expect.stringContaining("Use === instead of =="),
      category: "lint",
      filePath: "src/utils.ts",
    });
  });

  it("returns empty array when no linter config found", async () => {
    mockAccess.mockRejectedValue(new Error("not found"));

    const findings = await detector.detect("/tmp/repo");
    expect(findings).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});
