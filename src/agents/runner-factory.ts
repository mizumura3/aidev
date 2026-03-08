import type { AgentRunner } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";
import { DEFAULT_BACKEND } from "./backend-config.js";
import { ClaudeCodeRunner } from "./claude-code-runner.js";
import { CodexRunner } from "./codex-runner.js";
import { CodexCliRunner } from "./codex-cli-runner.js";
import { InstructionsAwareRunner } from "./instructions-aware-runner.js";

type RunnerFactory = (config: BackendConfig) => AgentRunner;

const registry = new Map<string, RunnerFactory>();

registry.set("claude-code", (config) => {
  if (config.model) {
    console.warn(`claude-code backend does not yet support model selection (got "${config.model}")`);
  }
  return new ClaudeCodeRunner();
});

registry.set("codex-cli", (config) => new InstructionsAwareRunner(new CodexCliRunner(config)));

registry.set("codex-sdk", (config) => new InstructionsAwareRunner(new CodexRunner(config)));

export function registerBackend(name: string, factory: RunnerFactory): void {
  registry.set(name, factory);
}

export function createRunner(config: BackendConfig): AgentRunner {
  const name = config.backend ?? DEFAULT_BACKEND;
  const factory = registry.get(name);
  if (!factory) {
    const available = Array.from(registry.keys()).join(", ");
    throw new Error(
      `Unknown backend "${name}". Available backends: ${available}`,
    );
  }
  return factory(config);
}
