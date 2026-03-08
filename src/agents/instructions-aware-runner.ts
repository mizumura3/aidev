import type { AgentRunner, AgentRunOptions } from "./runner.js";

export class InstructionsAwareRunner implements AgentRunner {
  constructor(
    private readonly inner: AgentRunner,
    private readonly instructions: string,
  ) {}

  async run(prompt: string, options: AgentRunOptions): Promise<string> {
    if (!this.instructions) {
      return this.inner.run(prompt, options);
    }

    const augmented = `<project-instructions>\n${this.instructions}\n</project-instructions>\n\n${prompt}`;
    return this.inner.run(augmented, options);
  }
}
