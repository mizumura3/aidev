import type { Result } from "../types.js";
import { buildDocumenterPrompt } from "../prompts/documenter.js";
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

  const prompt = buildDocumenterPrompt({
    changeSummary: result.changeSummary,
    changedFiles: result.changedFiles,
  });

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
