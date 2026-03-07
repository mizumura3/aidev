import { FixSchema, type Fix, type Plan } from "../types.js";
import { extractJson, INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Logger } from "../util/logger.js";

export interface FixerInput {
  plan: Plan;
  ciLog: string;
  cwd: string;
}

export async function runFixer(
  input: FixerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Fix> {
  const prompt = `You are a CI fix agent. The CI pipeline has failed. Analyze the failure and fix the code.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

${wrapUntrustedContent("ci-log", input.ciLog)}

Requirements:
1. Identify the root cause of the CI failure
2. Fix the code
3. Run tests to verify the fix

When you are done, respond ONLY with a JSON object:
{
  "rootCause": "string - root cause of the failure",
  "fixPlan": "string - what you did to fix it",
  "filesToTouch": ["string[] - files modified"]
}

Output ONLY valid JSON, no markdown fences.`;

  logger.info("Running fixer agent");

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Fixer",
    logger,
    maxTurns: 30,
    onMessage,
  });

  const parsed = extractJson(resultText, "Fixer");
  return FixSchema.parse(parsed);
}
