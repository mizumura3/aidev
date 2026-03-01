import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { PlanSchema, type Plan } from "../types.js";
import { createSafetyHook, extractJson, getBaseSdkOptions } from "./shared.js";
import type { Issue } from "../adapters/github.js";
import type { Logger } from "../util/logger.js";

export interface PlannerInput {
  issue: Issue;
  cwd: string;
}

export async function runPlanner(
  input: PlannerInput,
  logger: Logger
): Promise<Plan> {
  const prompt = `Analyze the codebase and the following GitHub issue. Then output your implementation plan as a single JSON object.

Issue #${input.issue.number}: ${input.issue.title}

${input.issue.body}

IMPORTANT: First, explore the codebase to understand the structure. Then output ONLY a JSON object (no prose, no markdown fences, no explanation before or after).

Required JSON schema:
{"summary":"string","steps":["string"],"filesToTouch":["string"],"tests":["string"],"risks":["string"],"acceptanceCriteria":["string"],"investigation":"string - detailed findings from your codebase analysis (what you found, root cause, relevant code paths)"}

Your final message must contain ONLY the JSON object, nothing else.`;

  logger.info("Running planner agent", { issue: input.issue.number });

  const response = query({
    prompt,
    options: {
      ...getBaseSdkOptions(),
      cwd: input.cwd,
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      hooks: { PreToolUse: [createSafetyHook()] },
      maxTurns: 20,
    },
  });

  let resultText = "";
  for await (const message of response) {
    if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
    }
  }

  logger.info("Planner response", { length: resultText.length });

  const parsed = extractJson(resultText, "Planner");
  return PlanSchema.parse(parsed);
}
