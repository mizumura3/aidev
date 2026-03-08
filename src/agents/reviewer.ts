import { ReviewSchema, type Plan, type Review } from "../types.js";
import { extractJson, INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface ReviewerInput {
  plan: Plan;
  diff: string;
  cwd: string;
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
  const roundLine = roundInfo
    ? `\n\nThis is review Round ${roundInfo.reviewRound} of ${roundInfo.maxReviewRounds}.`
    : "";

  const prompt = `You are a senior staff engineer conducting a thorough code review. Review the implementation against the plan with the rigor expected of a staff-level reviewer.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

${wrapUntrustedContent("diff", input.diff)}
${roundLine}

Review with the following priorities (in order):

1. **Validity of approach** — Is this the right approach? Is there a simpler way? If the fundamental approach is wrong, use "needs_discussion" to escalate to a human.
2. **Correctness** — Bugs, logic errors, security vulnerabilities.
3. **Design** — SOLID principles, dependency direction, appropriate abstractions, YAGNI.
4. **Edge cases** — Error handling, boundary values, concurrency.
5. **Readability & maintainability** — Naming, clarity of intent, unnecessary complexity.
6. **Consistency** — Alignment with existing codebase conventions and project rules (check .claude/ and CLAUDE.md if present).

Respond ONLY with a JSON object:
{
  "decision": "approve" | "changes_requested" | "needs_discussion",
  "mustFix": ["string[] - issues that must be fixed (empty if approve)"],
  "reason": "string - explanation when needs_discussion (optional otherwise)",
  "summary": "string - review summary in markdown with line breaks for readability"
}

- Use "approve" when the code is ready to merge.
- Use "changes_requested" when there are fixable issues.
- Use "needs_discussion" when the approach or premise itself is questionable and needs human judgment.

Output ONLY valid JSON, no markdown fences.`;

  logger.info("Running reviewer agent", roundInfo ? { round: roundInfo.reviewRound } : {});

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Reviewer",
    logger,
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 20,
    onMessage,
  });

  const parsed = extractJson(resultText, "Reviewer");
  return ReviewSchema.parse(parsed);
}
