import { Codex } from "@openai/codex-sdk";
import type { AgentRunner, AgentRunOptions } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";

export class CodexRunner implements AgentRunner {
  private readonly config: BackendConfig;
  private readonly codex: Codex;

  constructor(config: BackendConfig) {
    this.config = config;
    this.codex = new Codex({
      ...(config.apiKey && { apiKey: config.apiKey }),
    });
  }

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const thread = this.codex.startThread({
      ...(this.config.model && { model: this.config.model }),
      workingDirectory: options.cwd,
      sandboxMode: "danger-full-access",
    });

    if (options.onMessage) {
      const { events } = await thread.runStreamed(prompt);
      let finalResponse = "";
      for await (const event of events) {
        options.onMessage(event);
        if (event.type === "item.completed" && "item" in event) {
          const item = event.item;
          if (item.type === "agent_message") {
            finalResponse = item.text;
          }
        }
      }
      return finalResponse;
    } else {
      const turn = await thread.run(prompt);
      return turn.finalResponse;
    }
  }
}
