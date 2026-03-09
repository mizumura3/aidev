import type { RunContext, RunState, StateHandler } from "../types.js";
import type { Logger } from "../util/logger.js";
import { formatErrorDetails } from "../util/error.js";

export type StateHandlerMap = Partial<Record<RunState, StateHandler>>;

export interface Persistence {
  save(ctx: RunContext): Promise<void>;
  load(runId: string): Promise<RunContext | null>;
  findLatestByIssue?(issueNumber: number): Promise<RunContext | null>;
  findLatestByPr?(prNumber: number): Promise<RunContext | null>;
}

export interface WorkflowOptions {
  onTransition?: (from: RunState, to: RunState, elapsedMs?: number) => void;
  onComplete?: (ctx: RunContext) => Promise<void>;
  logger?: Logger;
}

const terminalStates: ReadonlySet<RunState> = new Set(["done", "failed", "blocked", "manual_handoff"]);

/**
 * Wrap a StateHandler with a wall-clock timeout.
 * If the handler doesn't complete within `timeoutMs`, the workflow transitions
 * to `manual_handoff` with `_timedOutState` set to the current state.
 * Pass `Infinity` to effectively disable the timeout.
 */
export function withTimeout(
  handler: StateHandler,
  timeoutMs: number,
  logger?: Logger,
): StateHandler {
  if (!Number.isFinite(timeoutMs)) return handler;

  return (ctx) => {
    return new Promise<{ nextState: RunState; ctx: RunContext }>((resolve) => {
      const timer = setTimeout(() => {
        logger?.warn(`State ${ctx.state} timed out after ${timeoutMs}ms — handing off`, {
          state: ctx.state,
          timeoutMs,
        });
        resolve({
          nextState: "manual_handoff",
          ctx: {
            ...ctx,
            _timedOutState: ctx.state,
            handoffReason: `State ${ctx.state} timed out after ${timeoutMs}ms`,
          },
        });
      }, timeoutMs);

      handler(ctx).then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  };
}

export async function runWorkflow(
  initial: RunContext,
  handlers: StateHandlerMap,
  persistence: Persistence,
  options?: WorkflowOptions
): Promise<RunContext> {
  let ctx = initial;
  const logger = options?.logger;
  const workflowStart = performance.now();

  while (!terminalStates.has(ctx.state)) {
    let handler = handlers[ctx.state];
    if (!handler) {
      throw new Error(`No handler for state: ${ctx.state}`);
    }

    // Apply per-state timeout if configured
    const timeoutMs = ctx.stateTimeouts?.[ctx.state];
    if (timeoutMs != null) {
      handler = withTimeout(handler, timeoutMs, logger);
    }

    const from = ctx.state;
    const handlerStart = performance.now();
    let nextState: RunState;
    let nextCtx: RunContext;
    try {
      const result = await handler(ctx);
      nextState = result.nextState;
      nextCtx = result.ctx;
    } catch (err) {
      const details = formatErrorDetails(err);
      logger?.error(`Handler failed at state: ${from}`, { state: from, ...details });
      throw err;
    }
    const elapsedMs = Math.round(performance.now() - handlerStart);

    logger?.info(`State ${from} completed`, { state: from, elapsedMs });
    options?.onTransition?.(from, nextState, elapsedMs);

    ctx = { ...nextCtx, state: nextState };
    await persistence.save(ctx);
  }

  const totalElapsedMs = Math.round(performance.now() - workflowStart);
  logger?.info("Workflow completed", { totalElapsedMs, finalState: ctx.state });

  try {
    await options?.onComplete?.(ctx);
  } catch {
    logger?.warn("onComplete callback failed");
  }

  return ctx;
}
