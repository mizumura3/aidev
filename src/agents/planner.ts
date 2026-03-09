import { PlanSchema, type Plan } from "../types.js";
import { extractJson } from "./shared.js";
import { planJsonSchema } from "./schemas.js";
import { buildPlannerPrompt } from "../prompts/planner.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Issue } from "../adapters/github.js";
import type { Logger } from "../util/logger.js";

export interface PlannerInput {
  issue: Issue;
  cwd: string;
  language: "ja" | "en";
}

export async function runPlanner(
  input: PlannerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Plan> {
  const prompt = buildPlannerPrompt({
    issue: input.issue,
    language: input.language,
  });

  logger.info("Running planner agent", { issue: input.issue.number });

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Planner",
    logger,
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 20,
    onMessage,
    outputSchema: planJsonSchema,
  });

  logger.info("Planner response", { length: resultText.length });

  const parsed = extractJson(resultText, "Planner");
  return PlanSchema.parse(parsed);
}
