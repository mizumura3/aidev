import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/claude-code-runner.js", () => ({
  ClaudeCodeRunner: vi.fn(() => ({
    run: vi.fn(async () => "mock result"),
  })),
}));

import { createRunner, registerBackend } from "../../src/agents/runner-factory.js";
import { ClaudeCodeRunner } from "../../src/agents/claude-code-runner.js";

describe("createRunner", () => {
  it("uses a custom backend registered via registerBackend", () => {
    const customRunner = { run: vi.fn(async () => "custom") };
    registerBackend("custom", (_config) => customRunner);

    const runner = createRunner({ backend: "custom" });
    expect(runner).toBe(customRunner);
  });

  it("returns a ClaudeCodeRunner for 'claude-code' backend", () => {
    const runner = createRunner({ backend: "claude-code" });
    expect(ClaudeCodeRunner).toHaveBeenCalled();
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe("function");
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
