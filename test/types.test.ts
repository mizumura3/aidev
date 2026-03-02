import { describe, it, expect } from "vitest";
import {
  RunStateSchema,
  PlanSchema,
  ResultSchema,
  ReviewSchema,
  FixSchema,
  RunContextSchema,
  type RunState,
  type Plan,
  type Result,
  type Review,
  type Fix,
  type RunContext,
} from "../src/types.js";

describe("RunStateSchema", () => {
  it("accepts all valid states", () => {
    const validStates: RunState[] = [
      "init",
      "planning",
      "implementing",
      "reviewing",
      "committing",
      "creating_pr",
      "watching_ci",
      "fixing",
      "merging",
      "closing_issue",
      "done",
      "failed",
    ];
    for (const state of validStates) {
      expect(RunStateSchema.parse(state)).toBe(state);
    }
  });

  it("rejects invalid state", () => {
    expect(() => RunStateSchema.parse("unknown")).toThrow();
  });
});

describe("PlanSchema", () => {
  const validPlan: Plan = {
    summary: "Add feature X",
    steps: ["Step 1", "Step 2"],
    filesToTouch: ["src/foo.ts"],
    tests: ["test/foo.test.ts"],
    risks: ["None"],
    acceptanceCriteria: ["Feature X works"],
  };

  it("accepts valid plan", () => {
    expect(PlanSchema.parse(validPlan)).toEqual(validPlan);
  });

  it("rejects plan without summary", () => {
    const { summary, ...rest } = validPlan;
    expect(() => PlanSchema.parse(rest)).toThrow();
  });

  it("rejects plan with empty steps", () => {
    expect(() => PlanSchema.parse({ ...validPlan, steps: [] })).toThrow();
  });

  it("accepts plan with optional investigation field", () => {
    const planWithInvestigation = {
      ...validPlan,
      investigation: "Found that the dashboard uses Riverpod AsyncValue but initial state is AsyncData([]) instead of AsyncLoading.",
    };
    const parsed = PlanSchema.parse(planWithInvestigation);
    expect(parsed.investigation).toContain("AsyncValue");
  });

  it("accepts plan without investigation field", () => {
    const parsed = PlanSchema.parse(validPlan);
    expect(parsed.investigation).toBeUndefined();
  });
});

describe("ResultSchema", () => {
  const validResult: Result = {
    changeSummary: "Implemented feature X",
    changedFiles: ["src/foo.ts"],
    testsRun: true,
    commitMessageDraft: "feat: add X",
    prBodyDraft: "## Summary\nAdded X",
  };

  it("accepts valid result", () => {
    expect(ResultSchema.parse(validResult)).toEqual(validResult);
  });

  it("rejects result without changeSummary", () => {
    const { changeSummary, ...rest } = validResult;
    expect(() => ResultSchema.parse(rest)).toThrow();
  });
});

describe("ReviewSchema", () => {
  it("accepts approve decision", () => {
    const review: Review = {
      decision: "approve",
      mustFix: [],
      summary: "Looks good",
    };
    expect(ReviewSchema.parse(review)).toEqual(review);
  });

  it("accepts changes_requested decision", () => {
    const review: Review = {
      decision: "changes_requested",
      mustFix: ["Fix the bug in line 10"],
      summary: "Needs work",
    };
    expect(ReviewSchema.parse(review)).toEqual(review);
  });

  it("rejects invalid decision", () => {
    expect(() =>
      ReviewSchema.parse({ decision: "reject", mustFix: [], summary: "No" })
    ).toThrow();
  });
});

describe("FixSchema", () => {
  const validFix: Fix = {
    rootCause: "Missing null check",
    fixPlan: "Add null check before access",
    filesToTouch: ["src/bar.ts"],
  };

  it("accepts valid fix", () => {
    expect(FixSchema.parse(validFix)).toEqual(validFix);
  });

  it("rejects fix without rootCause", () => {
    const { rootCause, ...rest } = validFix;
    expect(() => FixSchema.parse(rest)).toThrow();
  });
});

describe("RunContextSchema", () => {
  const validContext: RunContext = {
    runId: "run-123",
    issueNumber: 42,
    repo: "mizumura3/inko",
    cwd: "/tmp/inko",
    state: "init",
    branch: "aidev/issue-42",
    base: "main",
    maxFixAttempts: 3,
    fixAttempts: 0,
    dryRun: false,
    autoMerge: false,
    issueLabels: [],
    skipAuthorCheck: false,
  };

  it("accepts valid context", () => {
    expect(RunContextSchema.parse(validContext)).toEqual(validContext);
  });

  it("accepts context with optional fields", () => {
    const ctx: RunContext = {
      ...validContext,
      plan: {
        summary: "Do X",
        steps: ["Step 1"],
        filesToTouch: ["a.ts"],
        tests: ["a.test.ts"],
        risks: [],
        acceptanceCriteria: ["X done"],
      },
      prNumber: 10,
    };
    expect(RunContextSchema.parse(ctx)).toEqual(ctx);
  });

  it("defaults maxFixAttempts to 3", () => {
    const { maxFixAttempts, ...rest } = validContext;
    const parsed = RunContextSchema.parse(rest);
    expect(parsed.maxFixAttempts).toBe(3);
  });

  it("defaults fixAttempts to 0", () => {
    const { fixAttempts, ...rest } = validContext;
    const parsed = RunContextSchema.parse(rest);
    expect(parsed.fixAttempts).toBe(0);
  });

  it("defaults autoMerge to false", () => {
    const { autoMerge, ...rest } = validContext;
    const parsed = RunContextSchema.parse(rest);
    expect(parsed.autoMerge).toBe(false);
  });

  it("defaults issueLabels to empty array", () => {
    const parsed = RunContextSchema.parse(validContext);
    expect(parsed.issueLabels).toEqual([]);
  });

  it("accepts issueLabels with string array", () => {
    const parsed = RunContextSchema.parse({
      ...validContext,
      issueLabels: ["auto-merge", "bug"],
    });
    expect(parsed.issueLabels).toEqual(["auto-merge", "bug"]);
  });

  it("defaults base to 'main'", () => {
    const parsed = RunContextSchema.parse(validContext);
    expect(parsed.base).toBe("main");
  });

  it("accepts custom base value", () => {
    const parsed = RunContextSchema.parse({ ...validContext, base: "v1.2.0" });
    expect(parsed.base).toBe("v1.2.0");
  });

  it("accepts branch-style base value", () => {
    const parsed = RunContextSchema.parse({ ...validContext, base: "release/1.3" });
    expect(parsed.base).toBe("release/1.3");
  });

  it("rejects context without issueNumber", () => {
    const { issueNumber, ...rest } = validContext;
    expect(() => RunContextSchema.parse(rest)).toThrow();
  });
});
