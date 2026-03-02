import { describe, it, expect, vi, beforeEach } from "vitest";
import { runImprove } from "../../src/improve/runner.js";
import type { Detector, Finding } from "../../src/improve/types.js";
import type { GitHubAdapter } from "../../src/adapters/github.js";
import type { Logger } from "../../src/util/logger.js";

function makeGitHub(overrides?: Partial<GitHubAdapter>): GitHubAdapter {
  return {
    getIssue: vi.fn(),
    commentOnIssue: vi.fn(),
    createPr: vi.fn(),
    getCiStatus: vi.fn(),
    mergePr: vi.fn(),
    closeIssue: vi.fn(),
    listIssuesByLabel: vi.fn(),
    getCheckRunLogs: vi.fn(),
    createIssue: vi.fn().mockResolvedValue(99),
    searchIssues: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeDetector(
  name: string,
  findings: Finding[],
): Detector {
  return { name, detect: vi.fn().mockResolvedValue(findings) };
}

describe("ImproveRunner", () => {
  let github: GitHubAdapter;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    github = makeGitHub();
    logger = makeLogger();
  });

  it("calls all enabled detectors and collects Findings", async () => {
    const d1 = makeDetector("todo", [
      { title: "[aidev] TODO in src/a.ts:1", body: "body1", category: "todo", filePath: "src/a.ts" },
    ]);
    const d2 = makeDetector("lint", [
      { title: "[aidev] Lint: no-unused-vars in src/b.ts", body: "body2", category: "lint", filePath: "src/b.ts" },
    ]);

    await runImprove({
      cwd: "/tmp/repo",
      repo: "owner/repo",
      detectors: [d1, d2],
      github,
      logger,
      dryRun: false,
    });

    expect(d1.detect).toHaveBeenCalledWith("/tmp/repo");
    expect(d2.detect).toHaveBeenCalledWith("/tmp/repo");
    expect(github.createIssue).toHaveBeenCalledTimes(2);
  });

  it("deduplicates against existing open issues by searching title prefix", async () => {
    const finding: Finding = {
      title: "[aidev] TODO in src/a.ts:1",
      body: "body",
      category: "todo",
      filePath: "src/a.ts",
    };
    const detector = makeDetector("todo", [finding]);

    // Existing open issue with matching title
    vi.mocked(github.searchIssues).mockResolvedValue([
      { number: 50, title: "[aidev] TODO in src/a.ts:1", body: "body", labels: ["auto-merge"] },
    ]);

    await runImprove({
      cwd: "/tmp/repo",
      repo: "owner/repo",
      detectors: [detector],
      github,
      logger,
      dryRun: false,
    });

    expect(github.createIssue).not.toHaveBeenCalled();
  });

  it("skips issue creation for findings that match existing open issues", async () => {
    const findings: Finding[] = [
      { title: "[aidev] TODO in src/a.ts:1", body: "body1", category: "todo", filePath: "src/a.ts" },
      { title: "[aidev] TODO in src/b.ts:5", body: "body2", category: "todo", filePath: "src/b.ts" },
    ];
    const detector = makeDetector("todo", findings);

    // Only first finding has existing issue
    vi.mocked(github.searchIssues).mockResolvedValue([
      { number: 50, title: "[aidev] TODO in src/a.ts:1", body: "body", labels: [] },
    ]);

    await runImprove({
      cwd: "/tmp/repo",
      repo: "owner/repo",
      detectors: [detector],
      github,
      logger,
      dryRun: false,
    });

    // Only one issue created (for the non-duplicate)
    expect(github.createIssue).toHaveBeenCalledTimes(1);
    expect(github.createIssue).toHaveBeenCalledWith({
      title: "[aidev] TODO in src/b.ts:5",
      body: "body2",
      labels: ["auto-merge"],
    });
  });

  it("creates issues with correct title format, body template, and auto-merge label", async () => {
    const finding: Finding = {
      title: "[aidev] TODO in src/a.ts:1",
      body: "some body",
      category: "todo",
      filePath: "src/a.ts",
    };
    const detector = makeDetector("todo", [finding]);

    await runImprove({
      cwd: "/tmp/repo",
      repo: "owner/repo",
      detectors: [detector],
      github,
      logger,
      dryRun: false,
    });

    expect(github.createIssue).toHaveBeenCalledWith({
      title: "[aidev] TODO in src/a.ts:1",
      body: "some body",
      labels: ["auto-merge"],
    });
  });

  it("in dry-run mode logs findings without creating issues", async () => {
    const finding: Finding = {
      title: "[aidev] TODO in src/a.ts:1",
      body: "body",
      category: "todo",
      filePath: "src/a.ts",
    };
    const detector = makeDetector("todo", [finding]);

    await runImprove({
      cwd: "/tmp/repo",
      repo: "owner/repo",
      detectors: [detector],
      github,
      logger,
      dryRun: true,
    });

    expect(github.createIssue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });
});
