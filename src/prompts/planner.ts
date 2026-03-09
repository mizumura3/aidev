import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { Issue } from "../adapters/github.js";
import type { Language } from "../types.js";

export interface BuildPlannerPromptInput {
  issue: Pick<Issue, "number" | "title" | "body">;
  language: Language;
}

export function buildPlannerPrompt(input: BuildPlannerPromptInput): string {
  const languageInstruction = input.language === "ja"
    ? "Write all output text in Japanese."
    : "Write all output text in English.";

  return `Analyze the codebase and the following GitHub issue. Then output your implementation plan as a single JSON object.

${INJECTION_DEFENSE_PROMPT}

${languageInstruction}

Issue #${input.issue.number}: ${wrapUntrustedContent("issue-title", input.issue.title)}

${wrapUntrustedContent("issue-body", input.issue.body)}

IMPORTANT: First, explore the codebase to understand the structure. Then output ONLY a JSON object (no prose, no markdown fences, no explanation before or after).

Required JSON schema:
{"summary":"string","steps":["string"],"filesToTouch":["string"],"tests":["string"],"risks":["string"],"acceptanceCriteria":["string"],"investigation":"string - detailed findings from your codebase analysis (what you found, root cause, relevant code paths)"}

Format rules for the "investigation" field:
- Use Markdown bullet list (\`-\` items) to structure your findings
- Wrap file paths, function names, and code snippets in backticks for inline code
- Separate logical sections (e.g. root cause, relevant code, affected areas) with blank lines and bold headers (\`**Header**\`)

Your final message must contain ONLY the JSON object, nothing else.`;
}
