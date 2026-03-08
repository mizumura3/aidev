import { Codex } from "@openai/codex-sdk";
import type { AgentRunner, AgentRunOptions } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";

const PER_EVENT_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 600_000;

// Note: Codex SDK manages its own sandbox via sandboxMode.
// The safety hooks in shared.ts (blockDangerousOps) are
// Claude Code-specific and not applicable here.
export class CodexRunner implements AgentRunner {
  private readonly config: Partial<BackendConfig>;
  private readonly codex: Codex;

  constructor(config: Partial<BackendConfig>) {
    this.config = config;
    this.codex = new Codex({
      ...(config.apiKey && { apiKey: config.apiKey }),
    });
  }

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    if (options.maxTurns !== undefined) {
      options.logger.warn("codex-sdk backend does not support maxTurns");
    }
    if (options.allowedTools !== undefined) {
      options.logger.warn("codex-sdk backend does not support allowedTools");
    }

    const thread = this.codex.startThread({
      ...(this.config.model !== undefined && { model: this.config.model }),
      workingDirectory: options.cwd,
      sandboxMode: "danger-full-access",
    });

    if (options.onMessage) {
      const { events } = await thread.runStreamed(prompt, {
        ...(options.outputSchema && { outputSchema: options.outputSchema }),
      });
      // Keep the last agent_message as the final response
      let finalResponse = "";
      const iterator = events[Symbol.asyncIterator]();
      while (true) {
        const next = await withTimeout(
          iterator.next(),
          PER_EVENT_TIMEOUT_MS,
        );
        if (next.done) break;
        const event = next.value;
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
      const turn = await withTimeout(
        thread.run(prompt, {
          ...(options.outputSchema && { outputSchema: options.outputSchema }),
        }),
        RUN_TIMEOUT_MS,
      );
      return turn.finalResponse;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Codex timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timeoutHandle),
  );
}
