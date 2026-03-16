import { describe, it, expect } from "vitest";
import { formatStatus } from "../src/util/format-status.js";
import type { RunContext } from "../src/types.js";

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "abc-123",
    issueNumber: 42,
    repo: "owner/repo",
    cwd: "/tmp/work",
    state: "implementing",
    branch: "feat/my-feature",
    base: "main",
    maxFixAttempts: 3,
    fixAttempts: 0,
    dryRun: false,
    autoMerge: false,
    issueLabels: [],
    skipAuthorCheck: false,
    skipStates: [],
    ...overrides,
  };
}

describe("formatStatus", () => {
  it("returns state, issue number, branch, repo for minimal context", () => {
    const out = formatStatus(makeCtx());
    expect(out).toContain("State:        implementing");
    expect(out).toContain("Run ID:       abc-123");
    expect(out).toContain("Issue:        #42");
    expect(out).toContain("Repo:         owner/repo");
    expect(out).toContain("Branch:       feat/my-feature");
    expect(out).toContain("Base:         main");
  });

  it("includes prNumber when present", () => {
    const out = formatStatus(makeCtx({ prNumber: 99 }));
    expect(out).toContain("PR:           #99");
  });

  it("does not include PR line when prNumber is absent", () => {
    const out = formatStatus(makeCtx());
    expect(out).not.toContain("PR:");
  });

  it("includes issueTitle when present", () => {
    const out = formatStatus(makeCtx({ issueTitle: "Add dark mode" }));
    expect(out).toContain("Issue:        #42 - Add dark mode");
  });

  it("shows review decision when review exists", () => {
    const out = formatStatus(
      makeCtx({
        review: {
          decision: "changes_requested",
          mustFix: ["fix the bug"],
          summary: "needs work",
        },
      })
    );
    expect(out).toContain("Review:       changes_requested");
  });

  it("shows fixAttempts/maxFixAttempts when in fixing state", () => {
    const out = formatStatus(
      makeCtx({ state: "fixing", fixAttempts: 1, maxFixAttempts: 3 })
    );
    expect(out).toContain("Fix Attempts: 1/3");
  });

  it("shows fixAttempts/maxFixAttempts when fixAttempts > 0", () => {
    const out = formatStatus(
      makeCtx({ state: "done", fixAttempts: 2, maxFixAttempts: 3 })
    );
    expect(out).toContain("Fix Attempts: 2/3");
  });

  it("does not show fixAttempts when 0 and not in fixing state", () => {
    const out = formatStatus(makeCtx({ state: "done", fixAttempts: 0 }));
    expect(out).not.toContain("Fix Attempts:");
  });

  it("shows dryRun when true", () => {
    const out = formatStatus(makeCtx({ dryRun: true }));
    expect(out).toContain("Dry Run:      true");
  });

  it("shows autoMerge when true", () => {
    const out = formatStatus(makeCtx({ autoMerge: true }));
    expect(out).toContain("Auto Merge:   true");
  });

  it("does not show dryRun/autoMerge when false", () => {
    const out = formatStatus(makeCtx({ dryRun: false, autoMerge: false }));
    expect(out).not.toContain("Dry Run:");
    expect(out).not.toContain("Auto Merge:");
  });
});
