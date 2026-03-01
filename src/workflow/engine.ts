import type { RunContext, RunState, StateHandler } from "../types.js";
import type { Logger } from "../util/logger.js";

export type StateHandlerMap = Partial<Record<RunState, StateHandler>>;

export interface Persistence {
  save(ctx: RunContext): Promise<void>;
  load(runId: string): Promise<RunContext | null>;
  findLatestByIssue?(issueNumber: number): Promise<RunContext | null>;
}

export interface WorkflowOptions {
  onTransition?: (from: RunState, to: RunState) => void;
  logger?: Logger;
}

const terminalStates: ReadonlySet<RunState> = new Set(["done", "failed"]);

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
    const handler = handlers[ctx.state];
    if (!handler) {
      throw new Error(`No handler for state: ${ctx.state}`);
    }

    const from = ctx.state;
    const handlerStart = performance.now();
    const { nextState, ctx: nextCtx } = await handler(ctx);
    const elapsedMs = Math.round(performance.now() - handlerStart);

    logger?.info(`State ${from} completed`, { state: from, elapsedMs });
    options?.onTransition?.(from, nextState);

    ctx = { ...nextCtx, state: nextState };
    await persistence.save(ctx);
  }

  const totalElapsedMs = Math.round(performance.now() - workflowStart);
  logger?.info("Workflow completed", { totalElapsedMs, finalState: ctx.state });

  return ctx;
}
