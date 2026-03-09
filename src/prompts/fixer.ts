import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { Plan } from "../types.js";

export interface BuildFixerPromptInput {
  plan: Plan;
  ciLog?: string;
  reviewFeedback?: string;
}

export function buildFixerPrompt(input: BuildFixerPromptInput): string {
  const isReviewFix = !!input.reviewFeedback;
  const contextSection = isReviewFix
    ? `You are a code fix agent. A code review has requested changes. Analyze the feedback and fix the code.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

${wrapUntrustedContent("review-feedback", input.reviewFeedback!)}

Requirements:
1. Identify the root cause of each review issue
2. Fix the code to address all review feedback
3. Run tests to verify the fix`
    : `You are a CI fix agent. The CI pipeline has failed. Analyze the failure and fix the code.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

${wrapUntrustedContent("ci-log", input.ciLog ?? "")}

Requirements:
1. Identify the root cause of the CI failure
2. Fix the code
3. Run tests to verify the fix`;

  return `${contextSection}

When you are done, respond ONLY with a JSON object:
{
  "rootCause": "string - root cause of the failure",
  "fixPlan": "string - what you did to fix it",
  "filesToTouch": ["string[] - files modified"]
}

Output ONLY valid JSON, no markdown fences.`;
}
