import { query } from "@anthropic-ai/claude-code";
import { ReviewSchema, type Plan, type Review } from "../types.js";
import { createSafetyHook, extractJson, getBaseSdkOptions } from "./shared.js";
import type { Logger } from "../util/logger.js";

export interface ReviewerInput {
  plan: Plan;
  diff: string;
  cwd: string;
}

export async function runReviewer(
  input: ReviewerInput,
  logger: Logger
): Promise<Review> {
  const prompt = `You are a code review agent. Review the implementation against the plan.

Plan:
${JSON.stringify(input.plan, null, 2)}

Git diff:
\`\`\`
${input.diff}
\`\`\`

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

  const response = query({
    prompt,
    options: {
      ...getBaseSdkOptions(),
      cwd: input.cwd,
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      hooks: { PreToolUse: [createSafetyHook()] },
      maxTurns: 20,
    },
  });

  let resultText = "";
  for await (const message of response) {
    if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
    }
  }

  const parsed = extractJson(resultText, "Reviewer");
  return ReviewSchema.parse(parsed);
}
