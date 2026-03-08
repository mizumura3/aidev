import type { AgentRunner, AgentRunOptions } from "./runner.js";
import { loadProjectInstructions } from "./instructions-loader.js";

/**
 * Decorator that injects project instructions (CLAUDE.md, .claude/rules/*.md)
 * into prompts before delegating to the inner runner.
 *
 * When static instructions are provided at construction time, those are used.
 * When omitted, instructions are loaded lazily from `options.cwd` on each run.
 */
export class InstructionsAwareRunner implements AgentRunner {
  constructor(
    private readonly inner: AgentRunner,
    private readonly instructions?: string,
  ) {}

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    const instructions =
      this.instructions !== undefined
        ? this.instructions
        : await loadProjectInstructions(options.cwd);

    if (!instructions) {
      return this.inner.run(prompt, options);
    }

    const augmented = `<project-instructions>\n${instructions}\n</project-instructions>\n\n${prompt}`;
    return this.inner.run(augmented, options);
  }
}
