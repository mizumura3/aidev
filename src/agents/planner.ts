import { PlanSchema, type Plan } from "../types.js";
import { extractJson, INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { AgentRunner, ProgressEvent } from "./runner.js";
import type { Issue } from "../adapters/github.js";
import type { Logger } from "../util/logger.js";

export interface PlannerInput {
  issue: Issue;
  cwd: string;
}

export async function runPlanner(
  input: PlannerInput,
  logger: Logger,
  runner: AgentRunner,
  onMessage?: (message: ProgressEvent) => void
): Promise<Plan> {
  const prompt = `Analyze the codebase and the following GitHub issue. Then output your implementation plan as a single JSON object.

${INJECTION_DEFENSE_PROMPT}

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

  logger.info("Running planner agent", { issue: input.issue.number });

  const resultText = await runner.run(prompt, {
    cwd: input.cwd,
    agentName: "Planner",
    logger,
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 20,
    onMessage,
  });

  logger.info("Planner response", { length: resultText.length });

  const parsed = extractJson(resultText, "Planner");
  return PlanSchema.parse(parsed);
}
