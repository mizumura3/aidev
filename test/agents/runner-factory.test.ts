import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/agents/claude-code-runner.js", () => ({
  ClaudeCodeRunner: vi.fn(() => ({
    run: vi.fn(async () => "mock result"),
  })),
}));

vi.mock("../../src/agents/codex-runner.js", () => ({
  CodexRunner: vi.fn(() => ({
    run: vi.fn(async () => "codex result"),
  })),
}));

vi.mock("../../src/agents/codex-cli-runner.js", () => ({
  CodexCliRunner: vi.fn(() => ({
    run: vi.fn(async () => "codex-cli result"),
  })),
}));

vi.mock("../../src/agents/instructions-aware-runner.js", () => ({
  InstructionsAwareRunner: vi.fn((inner: unknown) => inner),
}));

import { createRunner, registerBackend } from "../../src/agents/runner-factory.js";
import { ClaudeCodeRunner } from "../../src/agents/claude-code-runner.js";
import { InstructionsAwareRunner } from "../../src/agents/instructions-aware-runner.js";

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

  it("returns a CodexCliRunner wrapped with InstructionsAwareRunner for 'codex-cli' backend", () => {
    const runner = createRunner({ backend: "codex-cli", model: "o4-mini" });
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe("function");
    expect(InstructionsAwareRunner).toHaveBeenCalled();
  });

  it("returns a CodexRunner (SDK) wrapped with InstructionsAwareRunner for 'codex-sdk' backend", () => {
    const runner = createRunner({ backend: "codex-sdk", model: "o4-mini" });
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe("function");
    expect(InstructionsAwareRunner).toHaveBeenCalled();
  });

  it("throws for unknown backend with available backends listed", () => {
    expect(() => createRunner({ backend: "unknown-backend" })).toThrow(
      /Unknown backend "unknown-backend"/,
    );
    expect(() => createRunner({ backend: "unknown-backend" })).toThrow(
      /claude-code/,
    );
    expect(() => createRunner({ backend: "unknown-backend" })).toThrow(
      /codex/,
    );
  });
});
