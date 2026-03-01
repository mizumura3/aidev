import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { PlanSchema, type Plan } from "../types.js";
import { createSafetyHook } from "./shared.js";
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
  const prompt = `You are a planning agent. Analyze the following GitHub issue and create an implementation plan.

Issue #${input.issue.number}: ${input.issue.title}

${input.issue.body}

Respond ONLY with a JSON object matching this schema:
{
  "summary": "string - brief summary of what needs to be done",
  "steps": ["string[] - ordered implementation steps (at least 1)"],
  "filesToTouch": ["string[] - files that will be created or modified"],
  "tests": ["string[] - test files to create or modify"],
  "risks": ["string[] - potential risks or concerns"],
  "acceptanceCriteria": ["string[] - criteria for completion"]
}

Output ONLY valid JSON, no markdown fences, no explanation.`;

  logger.info("Running planner agent", { issue: input.issue.number });

  const response = query({
    prompt,
    options: {
      cwd: input.cwd,
      permissionMode: "plan",
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

  const parsed = JSON.parse(resultText);
  return PlanSchema.parse(parsed);
}
