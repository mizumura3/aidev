import { query } from "@anthropic-ai/claude-code";
import { createSafetyHook, getBaseSdkOptions, streamAgentResponse } from "./shared.js";
import type { AgentRunner, AgentRunOptions } from "./runner.js";

export class ClaudeCodeRunner implements AgentRunner {
  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const effectivePrompt = options.outputSchema
      ? `${prompt}\n\nYou MUST respond with JSON matching this JSON Schema:\n${JSON.stringify(options.outputSchema, null, 2)}`
      : prompt;

    const response = query({
      prompt: effectivePrompt,
      options: {
        ...getBaseSdkOptions(),
        cwd: options.cwd,
        permissionMode: "bypassPermissions",
        ...(options.allowedTools && { allowedTools: options.allowedTools }),
        hooks: { PreToolUse: [createSafetyHook()] },
        ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
      },
    });

    const successMessage = await streamAgentResponse(response, {
      agentName: options.agentName,
      logger: options.logger,
      onMessage: options.onMessage,
    });

    return successMessage?.type === "result" && successMessage.subtype === "success"
      ? successMessage.result
      : "";
  }
}
