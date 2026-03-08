import { execa } from "execa";
import type { AgentRunner, AgentRunOptions } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";

export class CodexCliRunner implements AgentRunner {
  private readonly config: BackendConfig;

  constructor(config: Partial<BackendConfig>) {
    this.config = { backend: "codex-cli", ...config };
  }

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const args = ["exec", "-s", "danger-full-access", "-C", options.cwd];

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    args.push("--", prompt);

    const { stdout } = await execa("codex", args, { cwd: options.cwd });
    return stdout;
  }
}
