import type { Result } from "../types.js";
import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface DocumenterInput {
  result: Result;
  cwd: string;
}

export async function runDocumenter(
  input: DocumenterInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<void> {
  const { result, cwd } = input;

  const prompt = `You are a documentation update agent. Your job is to check if documentation (especially README.md) needs updating based on recent code changes.

${INJECTION_DEFENSE_PROMPT}

Changed files:
${wrapUntrustedContent("changed-files", result.changedFiles.map((f) => `- ${f}`).join("\n"))}

Change summary:
${wrapUntrustedContent("change-summary", result.changeSummary)}

Instructions:
1. Read the current README.md (and any other relevant docs).
2. Compare it against the changes described above.
3. If the changes affect user-facing behavior (CLI options, commands, workflows, configuration, API), update the documentation to reflect the new behavior.
4. If the changes are purely internal (refactoring, test additions, internal bug fixes) and do not affect user-facing behavior, do nothing — no update is needed.
5. Only update sections that are directly affected. Do not rewrite unrelated parts.
6. Keep the existing style and formatting of the documentation.`;

  logger.info("Running documenter agent");

  const resultText = await runner.run(prompt, {
    cwd,
    agentName: "Documenter",
    logger,
    allowedTools: ["Read", "Glob", "Grep", "Write", "Edit"],
    maxTurns: 10,
    onMessage,
  });

  if (resultText) {
    logger.info("Documenter completed", { result: resultText.slice(0, 200) });
  }
}
