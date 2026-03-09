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
  const label = input.workItemKind === "pr" ? "PR" : "issue";
  const relatedLine =
    input.workItemKind === "issue"
      ? `## 関連 Issue
closes #${input.workItemNumber}`
      : `## 関連PR
improves #${input.workItemNumber}`;

  const prompt = buildImplementerPrompt({
    plan: input.plan,
    label,
    workItemNumber: input.workItemNumber,
    relatedLine,
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
