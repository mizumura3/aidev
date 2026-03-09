import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "../agents/shared.js";

export interface BuildPlannerPromptInput {
  issue: { number: number; title: string; body: string };
  languageInstruction: string;
}

export function buildPlannerPrompt(input: BuildPlannerPromptInput): string {
  return `Analyze the codebase and the following GitHub issue. Then output your implementation plan as a single JSON object.

${INJECTION_DEFENSE_PROMPT}

${input.languageInstruction}

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
