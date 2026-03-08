import type { AgentRunner } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";
import { DEFAULT_BACKEND } from "./backend-config.js";
import { ClaudeCodeRunner } from "./claude-code-runner.js";

type RunnerFactory = (config: BackendConfig) => AgentRunner;

const registry = new Map<string, RunnerFactory>();

registry.set("claude-code", (_config) => new ClaudeCodeRunner());

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
