import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExeca = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

import { CodexCliRunner } from "../../src/agents/codex-cli-runner.js";
import type { AgentRunOptions } from "../../src/agents/runner.js";

function makeOptions(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    cwd: "/test/project",
    agentName: "TestAgent",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  };
}

describe("CodexCliRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns codex exec with correct arguments", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "the answer" });

    const runner = new CodexCliRunner({});
    await runner.run("do something", makeOptions({ cwd: "/my/project" }));

    expect(mockExeca).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "-s", "danger-full-access", "-C", "/my/project"]),
      expect.objectContaining({ cwd: "/my/project", timeout: 600_000 }),
    );
  });

  it("includes prompt as last argument", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "result" });

    const runner = new CodexCliRunner({});
    await runner.run("fix the bug", makeOptions());

    const args = mockExeca.mock.calls[0]![1] as string[];
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 1]).toBe("fix the bug");
  });

  it("returns stdout as result", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "fixed it" });

    const runner = new CodexCliRunner({});
    const result = await runner.run("fix", makeOptions());

    expect(result).toBe("fixed it");
  });

  it("passes model via --model flag when configured", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "done" });

    const runner = new CodexCliRunner({ model: "o4-mini" });
    await runner.run("hello", makeOptions());

    const args = mockExeca.mock.calls[0]![1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("o4-mini");
  });

  it("does not include --model flag when model is not set", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "done" });

    const runner = new CodexCliRunner({});
    await runner.run("hello", makeOptions());

    const args = mockExeca.mock.calls[0]![1] as string[];
    expect(args).not.toContain("--model");
  });

  it("propagates errors from execa", async () => {
    mockExeca.mockRejectedValueOnce(new Error("command not found: codex"));

    const runner = new CodexCliRunner({});
    await expect(runner.run("hello", makeOptions())).rejects.toThrow(
      "command not found: codex",
    );
  });

  it("logs stderr when present", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ok", stderr: "some warning" });

    const opts = makeOptions();
    const runner = new CodexCliRunner({});
    await runner.run("hello", opts);

    expect(opts.logger.debug).toHaveBeenCalledWith("codex stderr", { stderr: "some warning" });
  });

  it("warns when maxTurns is set", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    const opts = makeOptions({ maxTurns: 10 });
    const runner = new CodexCliRunner({});
    await runner.run("hello", opts);

    expect(opts.logger.warn).toHaveBeenCalledWith("codex-cli backend does not support maxTurns");
  });

  it("warns when allowedTools is set", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    const opts = makeOptions({ allowedTools: ["Read"] });
    const runner = new CodexCliRunner({});
    await runner.run("hello", opts);

    expect(opts.logger.warn).toHaveBeenCalledWith("codex-cli backend does not support allowedTools");
  });

  it("includes --output-schema flag when outputSchema is provided", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    const runner = new CodexCliRunner({});
    await runner.run("hello", makeOptions({ outputSchema: { type: "object", properties: {} } }));

    const args = mockExeca.mock.calls[0]![1] as string[];
    expect(args).toContain("--output-schema");
    const idx = args.indexOf("--output-schema");
    expect(args[idx + 1]).toMatch(/aidev-schema-.*\.json$/);
  });

  it("does not include --output-schema flag when outputSchema is not set", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    const runner = new CodexCliRunner({});
    await runner.run("hello", makeOptions());

    const args = mockExeca.mock.calls[0]![1] as string[];
    expect(args).not.toContain("--output-schema");
  });
});
