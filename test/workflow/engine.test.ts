import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runWorkflow,
  type StateHandlerMap,
  type Persistence,
} from "../../src/workflow/engine.js";
import type { RunContext, RunState } from "../../src/types.js";
import type { Logger } from "../../src/util/logger.js";

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "test-run",
    issueNumber: 1,
    repo: "owner/repo",
    cwd: "/tmp/repo",
    state: "init",
    branch: "devloop/issue-1",
    maxFixAttempts: 3,
    fixAttempts: 0,
    dryRun: false,
    noMerge: false,
    ...overrides,
  };
}

function makeHandler(nextState: RunState) {
  return vi.fn(async (ctx: RunContext) => ({
    nextState,
    ctx: { ...ctx, state: nextState },
  }));
}

function makePersistence(): Persistence {
  return {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
  };
}

describe("runWorkflow", () => {
  it("transitions init → planning → implementing → ... → done", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      planning: makeHandler("implementing"),
      implementing: makeHandler("reviewing"),
      reviewing: makeHandler("committing"),
      committing: makeHandler("creating_pr"),
      creating_pr: makeHandler("watching_ci"),
      watching_ci: makeHandler("merging"),
      merging: makeHandler("closing_issue"),
      closing_issue: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    const result = await runWorkflow(ctx, handlers, persistence);

    expect(result.state).toBe("done");
    expect(handlers.init).toHaveBeenCalledOnce();
    expect(handlers.planning).toHaveBeenCalledOnce();
    expect(handlers.closing_issue).toHaveBeenCalledOnce();
  });

  it("persists state after each transition", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      planning: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    await runWorkflow(ctx, handlers, persistence);

    // init -> planning (save), planning -> done (save)
    expect(persistence.save).toHaveBeenCalledTimes(2);
  });

  it("handles reviewing → implementing (changes_requested)", async () => {
    let reviewCount = 0;
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      planning: makeHandler("implementing"),
      implementing: makeHandler("reviewing"),
      reviewing: vi.fn(async (ctx) => {
        reviewCount++;
        if (reviewCount === 1) {
          return { nextState: "implementing" as RunState, ctx: { ...ctx, state: "implementing" as RunState } };
        }
        return { nextState: "committing" as RunState, ctx: { ...ctx, state: "committing" as RunState } };
      }),
      committing: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    const result = await runWorkflow(ctx, handlers, persistence);

    expect(result.state).toBe("done");
    expect(handlers.implementing).toHaveBeenCalledTimes(2);
    expect(handlers.reviewing).toHaveBeenCalledTimes(2);
  });

  it("handles CI failure → fixing → watching_ci retry", async () => {
    let ciCount = 0;
    const handlers: StateHandlerMap = {
      init: makeHandler("watching_ci"),
      watching_ci: vi.fn(async (ctx) => {
        ciCount++;
        if (ciCount === 1) {
          return {
            nextState: "fixing" as RunState,
            ctx: { ...ctx, state: "fixing" as RunState, fixAttempts: ctx.fixAttempts + 1 },
          };
        }
        return { nextState: "done" as RunState, ctx: { ...ctx, state: "done" as RunState } };
      }),
      fixing: makeHandler("watching_ci"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    const result = await runWorkflow(ctx, handlers, persistence);

    expect(result.state).toBe("done");
    expect(handlers.fixing).toHaveBeenCalledOnce();
    expect(ciCount).toBe(2);
  });

  it("transitions to failed when max fix attempts exceeded", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("watching_ci"),
      watching_ci: vi.fn(async (ctx) => ({
        nextState: "fixing" as RunState,
        ctx: { ...ctx, state: "fixing" as RunState, fixAttempts: ctx.fixAttempts + 1 },
      })),
      fixing: vi.fn(async (ctx) => {
        if (ctx.fixAttempts >= ctx.maxFixAttempts) {
          return { nextState: "failed" as RunState, ctx: { ...ctx, state: "failed" as RunState } };
        }
        return { nextState: "watching_ci" as RunState, ctx: { ...ctx, state: "watching_ci" as RunState } };
      }),
    };
    const persistence = makePersistence();
    const ctx = makeCtx({ maxFixAttempts: 2 });

    const result = await runWorkflow(ctx, handlers, persistence);

    expect(result.state).toBe("failed");
  });

  it("throws if handler is missing for current state", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      // planning handler missing
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    await expect(runWorkflow(ctx, handlers, persistence)).rejects.toThrow(
      /No handler for state: planning/
    );
  });

  it("resumes from a non-init state", async () => {
    const handlers: StateHandlerMap = {
      creating_pr: makeHandler("watching_ci"),
      watching_ci: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx({ state: "creating_pr" });

    const result = await runWorkflow(ctx, handlers, persistence);

    expect(result.state).toBe("done");
    expect(handlers.creating_pr).toHaveBeenCalledOnce();
  });

  it("logs per-handler elapsed time when logger is provided", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      planning: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await runWorkflow(ctx, handlers, persistence, { logger });

    // Should log elapsed time for each handler
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("init"),
      expect.objectContaining({ elapsedMs: expect.any(Number) })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("planning"),
      expect.objectContaining({ elapsedMs: expect.any(Number) })
    );
  });

  it("logs total workflow elapsed time when logger is provided", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await runWorkflow(ctx, handlers, persistence, { logger });

    expect(logger.info).toHaveBeenCalledWith(
      "Workflow completed",
      expect.objectContaining({
        totalElapsedMs: expect.any(Number),
        finalState: "done",
      })
    );
  });

  it("does not fail when logger is not provided", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();

    // No logger — should not throw
    const result = await runWorkflow(ctx, handlers, persistence);
    expect(result.state).toBe("done");
  });

  it("emits events via onTransition callback", async () => {
    const handlers: StateHandlerMap = {
      init: makeHandler("planning"),
      planning: makeHandler("done"),
    };
    const persistence = makePersistence();
    const ctx = makeCtx();
    const transitions: Array<{ from: RunState; to: RunState }> = [];

    await runWorkflow(ctx, handlers, persistence, {
      onTransition: (from, to) => transitions.push({ from, to }),
    });

    expect(transitions).toEqual([
      { from: "init", to: "planning" },
      { from: "planning", to: "done" },
    ]);
  });
});
