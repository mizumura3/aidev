import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();
const mockRunStreamed = vi.fn();
const mockStartThread = vi.fn(() => ({
  run: mockRun,
  runStreamed: mockRunStreamed,
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(() => ({
    startThread: mockStartThread,
  })),
}));

import { Codex } from "@openai/codex-sdk";
import { CodexRunner } from "../../src/agents/codex-runner.js";
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

describe("CodexRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs Codex with apiKey in constructor", () => {
    new CodexRunner({ apiKey: "sk-test-key", model: "o4-mini" });

    expect(Codex).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
  });

  it("constructs Codex without apiKey when not provided", () => {
    new CodexRunner({});

    expect(Codex).toHaveBeenCalledWith({});
  });

  it("reuses the same Codex instance across multiple run() calls", async () => {
    const runner = new CodexRunner({ apiKey: "sk-test-key" });
    mockRun.mockResolvedValue({ finalResponse: "done", items: [], usage: null });

    await runner.run("hello", makeOptions());
    await runner.run("world", makeOptions());

    // Codex constructor called once (in constructor), not per run()
    expect(Codex).toHaveBeenCalledTimes(1);
  });

  it("starts thread with correct options", async () => {
    const runner = new CodexRunner({ model: "o4-mini" });
    mockRun.mockResolvedValueOnce({ finalResponse: "done", items: [], usage: null });

    await runner.run("hello", makeOptions({ cwd: "/my/project" }));

    expect(mockStartThread).toHaveBeenCalledWith({
      model: "o4-mini",
      workingDirectory: "/my/project",
      sandboxMode: "danger-full-access",
    });
  });

  it("passes prompt directly without instruction loading", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "result", items: [], usage: null });

    await runner.run("do something", makeOptions());

    const calledPrompt = mockRun.mock.calls[0]![0] as string;
    expect(calledPrompt).toBe("do something");
  });

  it("returns finalResponse from thread.run()", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "the answer", items: [], usage: null });

    const result = await runner.run("question", makeOptions());

    expect(result).toBe("the answer");
  });

  it("calls onMessage for streaming events", async () => {
    const onMessage = vi.fn();
    const runner = new CodexRunner({});

    async function* fakeEvents() {
      yield { type: "item.completed" as const, item: { id: "1", type: "agent_message" as const, text: "hi" } };
      yield { type: "turn.completed" as const, usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } };
    }
    mockRunStreamed.mockResolvedValueOnce({ events: fakeEvents() });

    await runner.run("hello", makeOptions({ onMessage }));

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "item.completed" }),
    );
  });

  it("propagates errors to the caller", async () => {
    const runner = new CodexRunner({});
    mockRunStreamed.mockRejectedValueOnce(new Error("SDK error"));

    await expect(
      runner.run("hello", makeOptions({ onMessage: vi.fn() })),
    ).rejects.toThrow("SDK error");
  });

  it("uses run() when no onMessage callback", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "sync result", items: [], usage: null });

    const result = await runner.run("hello", makeOptions());

    expect(mockRun).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
    expect(result).toBe("sync result");
  });

  it("uses runStreamed() when onMessage callback is provided", async () => {
    const onMessage = vi.fn();
    const runner = new CodexRunner({});

    async function* fakeEvents() {
      yield { type: "turn.completed" as const, usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } };
    }
    mockRunStreamed.mockResolvedValueOnce({ events: fakeEvents() });

    await runner.run("hello", makeOptions({ onMessage }));

    expect(mockRunStreamed).toHaveBeenCalled();
  });

  it("warns when maxTurns is set", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "ok", items: [], usage: null });

    const opts = makeOptions({ maxTurns: 10 });
    await runner.run("hello", opts);

    expect(opts.logger.warn).toHaveBeenCalledWith("codex-sdk backend does not support maxTurns");
  });

  it("warns when allowedTools is set", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "ok", items: [], usage: null });

    const opts = makeOptions({ allowedTools: ["Read"] });
    await runner.run("hello", opts);

    expect(opts.logger.warn).toHaveBeenCalledWith("codex-sdk backend does not support allowedTools");
  });

  it("returns empty string when streaming yields no agent_message", async () => {
    const onMessage = vi.fn();
    const runner = new CodexRunner({});

    async function* fakeEvents() {
      yield { type: "turn.completed" as const, usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } };
    }
    mockRunStreamed.mockResolvedValueOnce({ events: fakeEvents() });

    const result = await runner.run("hello", makeOptions({ onMessage }));

    expect(result).toBe("");
  });

  it("passes outputSchema to thread.run() when provided", async () => {
    const runner = new CodexRunner({});
    const schema = { type: "object", properties: { foo: { type: "string" } } };
    mockRun.mockResolvedValueOnce({ finalResponse: "ok", items: [], usage: null });

    await runner.run("hello", makeOptions({ outputSchema: schema }));

    expect(mockRun).toHaveBeenCalledWith("hello", { outputSchema: schema });
  });

  it("passes outputSchema to thread.runStreamed() when provided", async () => {
    const onMessage = vi.fn();
    const runner = new CodexRunner({});
    const schema = { type: "object", properties: { foo: { type: "string" } } };

    async function* fakeEvents() {
      yield { type: "turn.completed" as const, usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } };
    }
    mockRunStreamed.mockResolvedValueOnce({ events: fakeEvents() });

    await runner.run("hello", makeOptions({ onMessage, outputSchema: schema }));

    expect(mockRunStreamed).toHaveBeenCalledWith("hello", { outputSchema: schema });
  });

  it("does not pass outputSchema when not provided", async () => {
    const runner = new CodexRunner({});
    mockRun.mockResolvedValueOnce({ finalResponse: "ok", items: [], usage: null });

    await runner.run("hello", makeOptions());

    expect(mockRun).toHaveBeenCalledWith("hello", {});
  });
});
