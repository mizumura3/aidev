import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTodoDetector } from "../../../src/improve/detectors/todo.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));
vi.mock("execa", () => ({
  execa: mockExeca,
}));

describe("TodoDetector", () => {
  const detector = createTodoDetector();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'todo'", () => {
    expect(detector.name).toBe("todo");
  });

  it("correctly parses grep output into Findings with file paths and line numbers", async () => {
    mockExeca.mockResolvedValue({
      stdout: [
        "src/utils.ts:10:  // TODO: refactor this function",
        "src/index.ts:25:  // FIXME: handle edge case",
      ].join("\n"),
    });

    const findings = await detector.detect("/tmp/repo");

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "[aidev] TODO in src/utils.ts:10",
      body: "Found TODO/FIXME comment:\n\n```\nsrc/utils.ts:10:  // TODO: refactor this function\n```",
      category: "todo",
      filePath: "src/utils.ts",
    });
    expect(findings[1]).toEqual({
      title: "[aidev] TODO in src/index.ts:25",
      body: "Found TODO/FIXME comment:\n\n```\nsrc/index.ts:25:  // FIXME: handle edge case\n```",
      category: "todo",
      filePath: "src/index.ts",
    });
  });

  it("returns empty array when no TODOs found", async () => {
    mockExeca.mockRejectedValue(new Error("grep exit code 1"));

    const findings = await detector.detect("/tmp/repo");
    expect(findings).toEqual([]);
  });

  it("ignores node_modules and dist directories", async () => {
    mockExeca.mockResolvedValue({ stdout: "" });

    await detector.detect("/tmp/repo");

    expect(mockExeca).toHaveBeenCalledWith(
      "grep",
      expect.arrayContaining([
        "--exclude-dir=node_modules",
        "--exclude-dir=dist",
        "--exclude-dir=.git",
      ]),
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });
});
