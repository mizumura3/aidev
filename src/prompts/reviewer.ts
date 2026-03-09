import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { Plan, Language } from "../types.js";

export interface BuildReviewerPromptInput {
  plan: Plan;
  diff: string;
  language: Language;
  roundInfo?: { round: number; max: number };
}

export function buildReviewerPrompt(input: BuildReviewerPromptInput): string {
  const languageInstruction = input.language === "ja"
    ? "Write all output text in Japanese."
    : "Write all output text in English.";
  const roundLine = input.roundInfo
    ? `\n\nThis is review Round ${input.roundInfo.round} of ${input.roundInfo.max}.`
    : "";

  return `You are a senior staff engineer conducting a thorough code review. Review the implementation against the plan with the rigor expected of a staff-level reviewer.

${INJECTION_DEFENSE_PROMPT}

${languageInstruction}

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
}
