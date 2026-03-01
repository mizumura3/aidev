import { query } from "@anthropic-ai/claude-code";
import { ResultSchema, type Plan, type Result } from "../types.js";
import { createSafetyHook, extractJson, getBaseSdkOptions } from "./shared.js";
import type { Logger } from "../util/logger.js";

export interface ImplementerInput {
  plan: Plan;
  issueNumber: number;
  cwd: string;
}

export async function runImplementer(
  input: ImplementerInput,
  logger: Logger
): Promise<Result> {
  const prompt = `You are an implementation agent. Implement the following plan for issue #${input.issueNumber}.

Plan:
${JSON.stringify(input.plan, null, 2)}

Requirements:
1. Follow TDD - write tests first, then implement
2. Run tests to verify your implementation works
3. Keep changes minimal and focused

When you are done, respond ONLY with a JSON object:
{
  "changeSummary": "string - what you changed",
  "changedFiles": ["string[] - files modified"],
  "testsRun": true/false,
  "commitMessageDraft": "string - conventional commit message",
  "prBodyDraft": "string - PR description in markdown"
}

Output ONLY valid JSON, no markdown fences.`;

  logger.info("Running implementer agent", { issue: input.issueNumber });

  const response = query({
    prompt,
    options: {
      ...getBaseSdkOptions(),
      cwd: input.cwd,
      permissionMode: "bypassPermissions",
      hooks: { PreToolUse: [createSafetyHook()] },
      maxTurns: 50,
    },
  });

  let resultText = "";
  for await (const message of response) {
    if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
    }
  }

  const parsed = extractJson(resultText, "Implementer");
  return ResultSchema.parse(parsed);
}
