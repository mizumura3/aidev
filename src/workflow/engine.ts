import { TERMINAL_STATES } from "../types.js";
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

const terminalStates: ReadonlySet<RunState> = new Set(TERMINAL_STATES);

/**
 * Minimum allowed state timeout. Values below this threshold are rejected
 * to prevent accidental instant timeouts (e.g. from malicious issue body config).
 */
export const MIN_STATE_TIMEOUT_MS = 5_000;

/**
 * Maximum allowed state timeout (1 hour). Values above this are clamped
 * to prevent unbounded resource holds from malicious issue body config.
 */
export const MAX_STATE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Wrap a StateHandler with a wall-clock timeout and cooperative cancellation.
 *
 * When the timeout fires:
 * 1. An `AbortSignal` injected into `ctx._abortSignal` is aborted.
 * 2. The workflow transitions to `manual_handoff`.
 *
 * **Important**: Cancellation is cooperative. The handler continues running
 * in the background after timeout unless it checks `ctx._abortSignal?.aborted`
 * and terminates early. Callers should propagate the signal to child processes
 * and cancellable APIs (e.g. `fetch(url, { signal })`) where possible.
 *
 * Pass `Infinity` or a non-positive value to effectively disable the timeout.
 *
 * **NOTE**: This function does NOT enforce `MIN_STATE_TIMEOUT_MS`. The engine's
 * `runWorkflow` applies min/max guards before calling this. Direct callers
 * (e.g. tests) bypass those guards and must enforce their own minimum.
 */
export function withTimeout(
  handler: StateHandler,
  timeoutMs: number,
  logger?: Logger,
): StateHandler {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return handler;

  return (ctx) => {
    const ac = new AbortController();
    const ctxWithSignal = { ...ctx, _abortSignal: ac.signal };

    return new Promise<{ nextState: RunState; ctx: RunContext }>((resolve, reject) => {
      const timer = setTimeout(() => {
        ac.abort();
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

      handler(ctxWithSignal).then(
        (result) => {
          clearTimeout(timer);
          if (ac.signal.aborted) {
            // Handler completed after timeout — result is discarded but log for debugging
            logger?.warn(`State ${ctx.state} handler completed after timeout (result discarded)`, {
              state: ctx.state,
              handlerNextState: result.nextState,
            });
            return; // resolve() already called by timer
          }
          resolve(result);
        },
        (err) => {
          clearTimeout(timer);
          if (ac.signal.aborted) {
            logger?.warn(`State ${ctx.state} handler failed after timeout (error discarded)`, {
              state: ctx.state,
              error: String(err),
            });
            return; // resolve() already called by timer
          }
          reject(err);
        },
      );
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

    // Apply per-state timeout if configured (enforce min/max as defense in depth)
    const timeoutMs = ctx.stateTimeouts?.[ctx.state];
    if (timeoutMs != null && timeoutMs >= MIN_STATE_TIMEOUT_MS) {
      const clampedMs = Math.min(timeoutMs, MAX_STATE_TIMEOUT_MS);
      if (clampedMs < timeoutMs) {
        logger?.warn(`stateTimeouts.${ctx.state} exceeds maximum — clamped from ${timeoutMs}ms to ${MAX_STATE_TIMEOUT_MS}ms`, {
          state: ctx.state,
          configured: timeoutMs,
          clamped: MAX_STATE_TIMEOUT_MS,
        });
      }
      handler = withTimeout(handler, clampedMs, logger);
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
    try {
      await persistence.save(ctx);
    } catch (saveErr) {
      logger?.error("Failed to persist state — halting to prevent state divergence", {
        state: ctx.state,
        runId: ctx.runId,
        ...formatErrorDetails(saveErr),
      });
      throw saveErr;
    }
  }

  const totalElapsedMs = Math.round(performance.now() - workflowStart);
  logger?.info("Workflow completed", { totalElapsedMs, finalState: ctx.state });

  try {
    await options?.onComplete?.(ctx);
  } catch (err) {
    logger?.warn("onComplete callback failed", { ...formatErrorDetails(err) });
  }

  return ctx;
}
