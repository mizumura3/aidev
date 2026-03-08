import { Codex } from "@openai/codex-sdk";
import type { AgentRunner, AgentRunOptions } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";
import { loadProjectInstructions } from "./instructions-loader.js";

export class CodexRunner implements AgentRunner {
  private readonly config: BackendConfig;

  constructor(config: BackendConfig) {
    this.config = config;
  }

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const codex = new Codex({
      ...(this.config.apiKey && { apiKey: this.config.apiKey }),
    });

    const thread = codex.startThread({
      ...(this.config.model && { model: this.config.model }),
      workingDirectory: options.cwd,
      sandboxMode: "danger-full-access",
    });

    // Load project instructions and prepend to prompt (lazy, per-run)
    const instructions = await loadProjectInstructions(options.cwd);
    const finalPrompt =
      instructions
        ? `<project-instructions>\n${instructions}\n</project-instructions>\n\n${prompt}`
        : prompt;

    try {
      if (options.onMessage) {
        const { events } = await thread.runStreamed(finalPrompt);
        let finalResponse = "";
        for await (const event of events) {
          options.onMessage(event);
          if (event.type === "turn.completed") {
            // Extract final response from agent_message items seen so far
            // The finalResponse is not available in streaming mode, so we
            // collect agent_message texts as they complete.
          }
          if (event.type === "item.completed" && "item" in event) {
            const item = event.item;
            if (item.type === "agent_message") {
              finalResponse = item.text;
            }
          }
        }
        return finalResponse;
      } else {
        const turn = await thread.run(finalPrompt);
        return turn.finalResponse;
      }
    } catch (error) {
      options.logger.error(`Codex runner error: ${error}`);
      return "";
    }
  }
}
