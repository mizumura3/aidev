import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
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
    if (options.maxTurns !== undefined) {
      options.logger.warn("codex-cli backend does not support maxTurns");
    }
    if (options.allowedTools !== undefined) {
      options.logger.warn("codex-cli backend does not support allowedTools");
    }

    const args = ["exec", "-s", "danger-full-access", "-C", options.cwd];

    if (this.config.model !== undefined) {
      args.push("--model", this.config.model);
    }

    let schemaPath: string | undefined;
    if (options.outputSchema) {
      schemaPath = join(tmpdir(), `aidev-schema-${randomBytes(8).toString("hex")}.json`);
      await writeFile(schemaPath, JSON.stringify(options.outputSchema), "utf-8");
      args.push("--output-schema", schemaPath);
    }

    args.push("--", prompt);

    try {
      const { stdout, stderr } = await execa("codex", args, {
        cwd: options.cwd,
        timeout: 600_000,
      });
      if (stderr) {
        options.logger.debug("codex stderr", { stderr });
      }
      return stdout;
    } finally {
      if (schemaPath) {
        await unlink(schemaPath).catch(() => {});
      }
    }
  }
}
