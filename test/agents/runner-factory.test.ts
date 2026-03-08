import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/claude-code-runner.js", () => ({
  ClaudeCodeRunner: vi.fn(() => ({
    run: vi.fn(async () => "mock result"),
  })),
}));

import { createRunner } from "../../src/agents/runner-factory.js";
import { ClaudeCodeRunner } from "../../src/agents/claude-code-runner.js";

describe("createRunner", () => {
  it("returns a ClaudeCodeRunner for 'claude-code' backend", () => {
    const runner = createRunner({ backend: "claude-code" });
    expect(ClaudeCodeRunner).toHaveBeenCalled();
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe("function");
  });

  it("defaults to claude-code when backend is 'claude-code'", () => {
    const runner = createRunner({ backend: "claude-code" });
    expect(runner).toBeDefined();
  });

  it("throws for unknown backend with available backends listed", () => {
    expect(() => createRunner({ backend: "unknown-backend" })).toThrow(
      /Unknown backend "unknown-backend"/,
    );
    expect(() => createRunner({ backend: "unknown-backend" })).toThrow(
      /claude-code/,
    );
  });
});
