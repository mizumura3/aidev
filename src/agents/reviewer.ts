import { ReviewSchema, type Plan, type Review } from "../types.js";
import { extractJson } from "./shared.js";
import { reviewJsonSchema } from "./schemas.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface ReviewerInput {
  plan: Plan;
  diff: string;
  cwd: string;
  language: "ja" | "en";
}

export interface ReviewRoundInfo {
  reviewRound: number;
  maxReviewRounds: number;
}

export async function runReviewer(
  input: ReviewerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void,
  roundInfo?: ReviewRoundInfo,
): Promise<Review> {
  const prompt = buildReviewerPrompt({
    plan: input.plan,
    diff: input.diff,
    language: input.language,
    roundInfo: roundInfo
      ? { round: roundInfo.reviewRound, max: roundInfo.maxReviewRounds }
      : undefined,
  });

  logger.info("Running reviewer agent", roundInfo ? { round: roundInfo.reviewRound } : {});

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Reviewer",
    logger,
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 20,
    onMessage,
    outputSchema: reviewJsonSchema,
  });

  const parsed = extractJson(resultText, "Reviewer");
  return ReviewSchema.parse(parsed);
}
