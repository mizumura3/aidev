import type { AgentRunner, AgentRunOptions } from "./runner.js";
import { loadProjectInstructions } from "./instructions-loader.js";

/**
 * Decorator that injects project instructions (CLAUDE.md, .claude/rules/*.md)
 * into prompts before delegating to the inner runner.
 *
 * When static instructions are provided at construction time, those are used.
 * When omitted, instructions are loaded lazily from `options.cwd` on each run
 * and cached per cwd to avoid repeated file I/O.
 */
export class InstructionsAwareRunner implements AgentRunner {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly inner: AgentRunner,
    private readonly instructions?: string,
  ) {}

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    let instructions: string;
    if (this.instructions !== undefined) {
      instructions = this.instructions;
    } else if (this.cache.has(options.cwd)) {
      instructions = this.cache.get(options.cwd)!;
    } else {
      instructions = await loadProjectInstructions(options.cwd);
      this.cache.set(options.cwd, instructions);
    }

    if (!instructions) {
      return this.inner.run(prompt, options);
    }

    const augmented = `<project-instructions>\n${instructions}\n</project-instructions>\n\n${prompt}`;
    return this.inner.run(augmented, options);
  }
}
