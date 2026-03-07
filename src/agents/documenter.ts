import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import type { Result } from "../types.js";
import { createSafetyHook, getBaseSdkOptions, streamAgentResponse } from "./shared.js";
import type { Logger } from "../util/logger.js";

export interface DocumenterInput {
  result: Result;
  cwd: string;
}

export async function runDocumenter(
  input: DocumenterInput,
  logger: Logger,
  onMessage?: (message: SDKMessage) => void
): Promise<void> {
  const { result, cwd } = input;

  const prompt = `You are a documentation update agent. Your job is to check if documentation (especially README.md) needs updating based on recent code changes.

Changed files:
${result.changedFiles.map((f) => `- ${f}`).join("\n")}

Change summary:
${result.changeSummary}

Instructions:
1. Read the current README.md (and any other relevant docs).
2. Compare it against the changes described above.
3. If the changes affect user-facing behavior (CLI options, commands, workflows, configuration, API), update the documentation to reflect the new behavior.
4. If the changes are purely internal (refactoring, test additions, internal bug fixes) and do not affect user-facing behavior, do nothing — no update is needed.
5. Only update sections that are directly affected. Do not rewrite unrelated parts.
6. Keep the existing style and formatting of the documentation.`;

  logger.info("Running documenter agent");

  const response = query({
    prompt,
    options: {
      ...getBaseSdkOptions(),
      cwd,
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Glob", "Grep", "Write", "Edit"],
      hooks: { PreToolUse: [createSafetyHook()] },
      maxTurns: 10,
    },
  });

  const successMessage = await streamAgentResponse(response, {
    agentName: "Documenter",
    logger,
    onMessage,
  });

  if (successMessage?.type === "result" && successMessage.subtype === "success") {
    logger.info("Documenter completed", { result: successMessage.result.slice(0, 200) });
  }
}
