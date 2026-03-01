import type { RunContext, RunState, StateHandler } from "../types.js";

export type StateHandlerMap = Partial<Record<RunState, StateHandler>>;

export interface Persistence {
  save(ctx: RunContext): Promise<void>;
  load(runId: string): Promise<RunContext | null>;
}

export interface WorkflowOptions {
  onTransition?: (from: RunState, to: RunState) => void;
}

const terminalStates: ReadonlySet<RunState> = new Set(["done", "failed"]);

export async function runWorkflow(
  initial: RunContext,
  handlers: StateHandlerMap,
  persistence: Persistence,
  options?: WorkflowOptions
): Promise<RunContext> {
  let ctx = initial;

  while (!terminalStates.has(ctx.state)) {
    const handler = handlers[ctx.state];
    if (!handler) {
      throw new Error(`No handler for state: ${ctx.state}`);
    }

    const from = ctx.state;
    const { nextState, ctx: nextCtx } = await handler(ctx);

    options?.onTransition?.(from, nextState);

    ctx = { ...nextCtx, state: nextState };
    await persistence.save(ctx);
  }

  return ctx;
}
