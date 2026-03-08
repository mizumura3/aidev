import { z } from "zod";

export const SkippableStateSchema = z.enum([
  "reviewing",
  "watching_ci",
  "documenter",
]);
export type SkippableState = z.infer<typeof SkippableStateSchema>;
export const LanguageSchema = z.enum(["ja", "en"]);
export type Language = z.infer<typeof LanguageSchema>;

export const RunStateSchema = z.enum([
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
  "blocked",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const PlanSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()).min(1),
  filesToTouch: z.array(z.string()),
  tests: z.array(z.string()),
  risks: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  investigation: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const ResultSchema = z.object({
  changeSummary: z.string(),
  changedFiles: z.array(z.string()),
  testsRun: z.boolean(),
  commitMessageDraft: z.string(),
  prBodyDraft: z.string(),
});
export type Result = z.infer<typeof ResultSchema>;

export const ReviewSchema = z.object({
  decision: z.enum(["approve", "changes_requested", "needs_discussion"]),
  severity: z.enum(["trivial", "significant"]).optional(),
  mustFix: z.array(z.string()),
  reason: z.string().optional(),
  summary: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const FixSchema = z.object({
  rootCause: z.string(),
  fixPlan: z.string(),
  filesToTouch: z.array(z.string()),
});
export type Fix = z.infer<typeof FixSchema>;

export const RunContextSchema = z.object({
  runId: z.string(),
  targetKind: z.enum(["issue", "pr"]).default("issue"),
  issueNumber: z.number().optional(),
  prNumber: z.number().optional(),
  repo: z.string(),
  cwd: z.string(),
  state: RunStateSchema,
  branch: z.string(),
  headBranch: z.string().optional(),
  base: z.string().default("main"),
  maxFixAttempts: z.number().default(3),
  fixAttempts: z.number().default(0),
  maxReviewRounds: z.number().default(1),
  reviewRound: z.number().default(0),
  dryRun: z.boolean(),
  autoMerge: z.boolean().default(false),
  language: LanguageSchema.default("ja"),
  issueLabels: z.array(z.string()).default([]),
  skipAuthorCheck: z.boolean().default(false),
  skipStates: z.array(SkippableStateSchema).default([]),
  issueTitle: z.string().optional(),
  plan: PlanSchema.optional(),
  result: ResultSchema.optional(),
  review: ReviewSchema.optional(),
  fix: FixSchema.optional(),
  fixTrigger: z.enum(["ci", "review"]).optional(),
}).superRefine((ctx, issueCtx) => {
  if (ctx.targetKind === "issue" && ctx.issueNumber == null) {
    issueCtx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issueNumber"],
      message: "issueNumber is required for issue mode",
    });
  }
  if (ctx.targetKind === "pr" && ctx.prNumber == null) {
    issueCtx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prNumber"],
      message: "prNumber is required for PR mode",
    });
  }
});
export type RunContext = z.infer<typeof RunContextSchema> & {
  /** Set of CLI flags explicitly specified (transient, not persisted) */
  _cliExplicit?: Set<string>;
};

export type StateHandler = (
  ctx: RunContext
) => Promise<{ nextState: RunState; ctx: RunContext }>;
