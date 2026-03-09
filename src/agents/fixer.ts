import { FixSchema, type Fix, type Plan } from "../types.js";
import { extractJson } from "./shared.js";
import { fixJsonSchema } from "./schemas.js";
import { buildFixerPrompt } from "../prompts/fixer.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface FixerInput {
  plan: Plan;
  ciLog?: string;
  reviewFeedback?: string;
  cwd: string;
}

export async function runFixer(
  input: FixerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Fix> {
  const prompt = buildFixerPrompt({
    plan: input.plan,
    ciLog: input.ciLog,
    reviewFeedback: input.reviewFeedback,
  });

  logger.info("Running fixer agent");

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Fixer",
    logger,
    maxTurns: 30,
    onMessage,
    outputSchema: fixJsonSchema,
  });

  const parsed = extractJson(resultText, "Fixer");
  return FixSchema.parse(parsed);
}
