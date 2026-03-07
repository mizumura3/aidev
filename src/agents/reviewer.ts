import { ReviewSchema, type Plan, type Review } from "../types.js";
import { extractJson, INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface ReviewerInput {
  plan: Plan;
  diff: string;
  cwd: string;
}

export async function runReviewer(
  input: ReviewerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Review> {
  const prompt = `You are a code review agent. Review the implementation against the plan.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

${wrapUntrustedContent("diff", input.diff)}

Review criteria:
1. Does the implementation match the plan?
2. Are there any bugs or security issues?
3. Are tests adequate?
4. Is the code clean and well-structured?

Respond ONLY with a JSON object:
{
  "decision": "approve" | "changes_requested",
  "mustFix": ["string[] - issues that must be fixed (empty if approve)"],
  "summary": "string - review summary"
}

Output ONLY valid JSON, no markdown fences.`;

  logger.info("Running reviewer agent");

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
