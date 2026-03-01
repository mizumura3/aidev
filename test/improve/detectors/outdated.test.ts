import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOutdatedDetector } from "../../../src/improve/detectors/outdated.js";

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

describe("OutdatedDetector", () => {
  const detector = createOutdatedDetector();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'outdated'", () => {
    expect(detector.name).toBe("outdated");
  });

  it("detects bun.lock and uses bun outdated", async () => {
    // bun.lock exists
    mockAccess.mockResolvedValueOnce(undefined);

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        { name: "react", current: "17.0.2", latest: "18.2.0" },
        { name: "lodash", current: "4.17.20", latest: "4.17.21" },
      ]),
    });

    const findings = await detector.detect("/tmp/repo");

    expect(mockExeca).toHaveBeenCalledWith(
      "bun",
      ["outdated", "--json"],
      expect.objectContaining({ cwd: "/tmp/repo", reject: false }),
    );
    // Only major version bumps
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: "[aidev] Outdated: react 17.0.2 → 18.2.0",
      body: expect.stringContaining("react"),
      category: "outdated",
    });
  });

  it("detects package-lock.json and uses npm outdated", async () => {
    // bun.lock does not exist
    mockAccess.mockRejectedValueOnce(new Error("not found"));
    // package-lock.json exists
    mockAccess.mockResolvedValueOnce(undefined);

    // npm outdated --json outputs an object keyed by package name
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        typescript: { current: "4.9.5", wanted: "4.9.5", latest: "5.3.2" },
        vitest: { current: "3.0.0", wanted: "3.0.1", latest: "3.0.1" },
      }),
    });

    const findings = await detector.detect("/tmp/repo");

    expect(mockExeca).toHaveBeenCalledWith(
      "npm",
      ["outdated", "--json"],
      expect.objectContaining({ cwd: "/tmp/repo", reject: false }),
    );
    // Only major bumps: typescript 4→5
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      title: "[aidev] Outdated: typescript 4.9.5 → 5.3.2",
      body: expect.stringContaining("typescript"),
      category: "outdated",
    });
  });

  it("filters to only major version bumps", async () => {
    mockAccess.mockRejectedValueOnce(new Error("not found"));
    mockAccess.mockResolvedValueOnce(undefined);

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        lodash: { current: "4.17.20", wanted: "4.17.21", latest: "4.17.21" },
      }),
    });

    const findings = await detector.detect("/tmp/repo");
    expect(findings).toHaveLength(0);
  });

  it("returns empty when no lock file found", async () => {
    mockAccess.mockRejectedValue(new Error("not found"));

    const findings = await detector.detect("/tmp/repo");
    expect(findings).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});
