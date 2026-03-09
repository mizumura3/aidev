import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "../agents/shared.js";

export interface BuildDocumenterPromptInput {
  changeSummary: string;
  changedFilesSection: string;
}

export function buildDocumenterPrompt(input: BuildDocumenterPromptInput): string {
  return `You are a documentation update agent. Your job is to check if documentation (especially README.md) needs updating based on recent code changes.

${INJECTION_DEFENSE_PROMPT}

Changed files:
${wrapUntrustedContent("changed-files", input.changedFilesSection)}

Change summary:
${wrapUntrustedContent("change-summary", input.changeSummary)}

Instructions:
1. Read the current README.md (and any other relevant docs).
2. Compare it against the changes described above.
3. If the changes affect user-facing behavior (CLI options, commands, workflows, configuration, API), update the documentation to reflect the new behavior.
4. If the changes are purely internal (refactoring, test additions, internal bug fixes) and do not affect user-facing behavior, do nothing — no update is needed.
5. Only update sections that are directly affected. Do not rewrite unrelated parts.
6. Keep the existing style and formatting of the documentation.`;
}
