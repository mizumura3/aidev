import { z } from "zod";

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
  decision: z.enum(["approve", "changes_requested"]),
  mustFix: z.array(z.string()),
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
  issueNumber: z.number(),
  repo: z.string(),
  cwd: z.string(),
  state: RunStateSchema,
  branch: z.string(),
  maxFixAttempts: z.number().default(3),
  fixAttempts: z.number().default(0),
  dryRun: z.boolean(),
  autoMerge: z.boolean().default(false),
  issueLabels: z.array(z.string()).default([]),
  plan: PlanSchema.optional(),
  result: ResultSchema.optional(),
  review: ReviewSchema.optional(),
  fix: FixSchema.optional(),
  prNumber: z.number().optional(),
});
export type RunContext = z.infer<typeof RunContextSchema>;

export type StateHandler = (
  ctx: RunContext
) => Promise<{ nextState: RunState; ctx: RunContext }>;
