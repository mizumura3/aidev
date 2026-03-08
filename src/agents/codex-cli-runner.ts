import { execa } from "execa";
import type { AgentRunner, AgentRunOptions } from "./runner.js";
import type { BackendConfig } from "./backend-config.js";

// Note: Codex CLI manages its own sandbox via -s flag.
// The safety hooks in shared.ts (blockDangerousOps) are
// Claude Code-specific and not applicable here.
export class CodexCliRunner implements AgentRunner {
  private readonly config: BackendConfig;

  constructor(config: Partial<BackendConfig>) {
    this.config = { backend: "codex-cli", ...config };
  }

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    if (options.maxTurns) {
      options.logger.warn("codex-cli backend does not support maxTurns");
    }
    if (options.allowedTools) {
      options.logger.warn("codex-cli backend does not support allowedTools");
    }

    const args = ["exec", "-s", "danger-full-access", "-C", options.cwd];

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    args.push("--", prompt);

    const { stdout, stderr } = await execa("codex", args, { cwd: options.cwd });
    if (stderr) {
      options.logger.debug("codex stderr", { stderr });
    }
    return stdout;
  }
}
