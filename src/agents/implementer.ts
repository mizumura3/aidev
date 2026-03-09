import { ResultSchema, type Plan, type Result } from "../types.js";
import { extractJson } from "./shared.js";
import { resultJsonSchema } from "./schemas.js";
import { buildImplementerPrompt } from "../prompts/implementer.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface ImplementerInput {
  plan: Plan;
  workItemNumber: number;
  workItemKind: "issue" | "pr";
  cwd: string;
}

export async function runImplementer(
  input: ImplementerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Result> {
  const prompt = buildImplementerPrompt({
    plan: input.plan,
    workItemKind: input.workItemKind,
    workItemNumber: input.workItemNumber,
  });

  logger.info("Running implementer agent", {
    workItemKind: input.workItemKind,
    workItemNumber: input.workItemNumber,
  });

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Implementer",
    logger,
    maxTurns: 50,
    onMessage,
    outputSchema: resultJsonSchema,
  });

  const parsed = extractJson(resultText, "Implementer");
  return ResultSchema.parse(parsed);
}
