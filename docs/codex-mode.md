# Issue #66: External Delegation Mode (Codex Mode)

## Scope boundary with #74

**#74** (汎用ワークフローオーケストレータ化) handles pluggable agent backends:
- `AgentRunner` interface, `runner-factory.ts`, `BackendConfig` — **done**
- `--backend` / `--model` CLI flags — **done**
- `ClaudeCodeRunner`, `CodexCliRunner`, `CodexRunner` — **done**
- `InstructionsAwareRunner` decorator — **done**
- `outputSchema` in `AgentRunOptions` — **done**
- Remaining #74 work: native structured output enforcement per backend

**#66** (this issue) adds a fundamentally different execution model: **skipping agent execution entirely** and accepting artifacts from an external operator. This is NOT another `AgentRunner` implementation — it's a workflow-level concern where certain states become handoff points rather than agent invocations.

## What already exists on main

| Component | Status | Location |
|-----------|--------|----------|
| `AgentRunner` interface | Done | `src/agents/runner.ts` |
| `runner-factory.ts` + 3 backends | Done | `src/agents/` |
| `--backend` / `--model` flags | Done | `src/cli.ts:137-138` |
| `blocked` in `RunStateSchema` + `terminalStates` | Done | `src/types.ts`, `src/workflow/engine.ts:23` |
| `needs_discussion` → `blocked` transition | Done | `src/workflow/states.ts:347` |
| Config cascade for `backend`/`model` | Done | `src/workflow/states.ts:162-170` |
| `formatSlackMessage` handles `blocked` | Done | `src/cli.ts:368` |

## What #66 needs to add

### 1. `aidev import` subcommand

External operators need a way to inject artifacts into a paused run. Direct `state.json` editing is error-prone and undocumented.

```
aidev import --issue 42 --artifact-type plan plan.json
aidev import --pr 5 --artifact-type result -    # stdin
aidev import --run-id <id> --artifact-type fix fix.json --dry-run
```

Flags:
- `--run-id <id>` | `--issue <N>` | `--pr <N>` — target run (issue/pr resolve via `findLatestByIssue`/`findLatestByPr`)
- `--artifact-type` — `plan` | `result` | `fix` (not `review` — see reviewer policy below)
- positional arg or `-` for stdin
- `--max-size <bytes>` (default: 1MB) — reject oversized payloads
- `--dry-run` — validate only, do not write

Behavior:
- Validate payload against the matching Zod schema (`PlanSchema` / `ResultSchema` / `FixSchema`). On failure, print Zod error path + expected schema hint.
- Write BOTH the artifact file (`plan.json` etc.) AND update `state.json` with the artifact in the corresponding `ctx` field. The `blocked` handler and resume logic read from `ctx`, not individual files.
- Use atomic writes (temp file + `rename`) to prevent partial reads by concurrent resume.

### 2. `blockedReason` field on `RunContext`

Currently `blocked` is only reached via `needs_discussion`. External delegation needs additional blocked reasons:

```typescript
blockedReason: z.enum([
  "needs_discussion",     // existing: reviewer flagged for human review
  "awaiting_plan",        // new: external operator must supply plan
  "awaiting_result",      // new: external operator must supply result
  "awaiting_fix",         // new: external operator must supply fix
]).optional()
```

### 3. `blocked` handler (new state handler)

Currently no handler is registered for `blocked` — the workflow loop simply stops. For external delegation, a handler is needed so resume from `blocked` can gate on artifact availability:

| `blockedReason`    | Checks for       | Next state       |
|--------------------|-------------------|------------------|
| `needs_discussion` | (manual resume)   | re-enter from `reviewing` |
| `awaiting_plan`    | `ctx.plan`        | `implementing`   |
| `awaiting_result`  | `ctx.result`      | `committing`     |
| `awaiting_fix`     | `ctx.fix`         | `watching_ci`    |

If the required artifact is still absent, remain in `blocked`.

Note: `blocked` stays in `terminalStates` (stops the loop). Resume re-enters the loop from the `blocked` handler as the initial state. This does NOT require removing `blocked` from `terminalStates` — instead, the resume path in `cli.ts` must NOT treat `blocked` as a permanent end state (unlike `done`/`failed`).

### 4. State handler changes for delegation mode

Delegation mode is active when `ctx.backend === "external"`. This is a new backend name — it is NOT registered in `runner-factory.ts` because no `AgentRunner` is needed.

- **`planning`**: if `backend === "external"` and `ctx.plan` is absent → transition to `blocked` with `blockedReason: "awaiting_plan"`. If `ctx.plan` exists (supplied via import) → skip to `implementing`.
- **`implementing`**: if `backend === "external"` and `ctx.result` is absent → `blocked` with `"awaiting_result"`. If present → skip to `committing`.
- **`reviewing`**: runs internal reviewer in ALL modes (quality gate aidev always owns). On `changes_requested` in external mode → clear `ctx.result`, transition to `blocked` with `"awaiting_result"`.
- **`committing`**: make idempotent — if working tree is clean (external operator already committed), skip `git addAll + commit`.
- **`fixing`**: if `backend === "external"` and `ctx.fix` is absent → `blocked` with `"awaiting_fix"`. If present → apply fix flow.

### 5. Resume logic update (`cli.ts`)

Current resume (cli.ts) handles `done + dryRun` as a special case. Add:
- `blocked` → load context, validate mode consistency, re-enter workflow loop (the `blocked` handler will gate on artifact presence)
- Mode consistency: if persisted `backend` differs from CLI `--backend`, reject with error

### 6. `watch` command guard

`watch` auto-processes issues with no mechanism for artifact handoff. Reject `--backend external` in watch with a clear error.

## What #66 does NOT touch (belongs to #74)

- `AgentRunner` interface or existing runner implementations
- `runner-factory.ts` registry
- `outputSchema` handling
- `--model` flag behavior
- Native structured output enforcement per backend

## TDD

Red:
- `aidev import` CLI tests: file/stdin, issue/pr resolution, validation errors, dry-run, atomic writes, size limits, reject `review` type, dual-write (artifact file + state.json)
- `blocked` handler tests: artifact present → correct next state; absent → stay blocked; `blockedReason` mapping
- State handler tests for `backend === "external"`: planning/implementing/fixing skip to blocked; reviewing still runs internally; `changes_requested` → blocked; committing idempotent
- Resume from blocked: mode-consistency enforcement; re-enter loop
- Watch command: reject `--backend external`

Green (ordered by dependency):
1. Add `blockedReason` optional enum field to `RunContextSchema`
2. Implement `blocked` state handler with artifact-presence gating
3. Implement `aidev import` subcommand with validation, atomic writes, dual-write
4. Add `backend === "external"` guards to `planning`, `implementing`, `fixing` handlers
5. Make `committing` handler idempotent
6. Handle `reviewing → blocked` for external mode on `changes_requested`
7. Update resume logic for `blocked` state + mode-consistency check
8. Guard `watch` command against `--backend external`

Refactor:
- Update `createFilePersistence.save()` to use atomic writes (temp + rename) — pre-existing issue, now a practical concern with `aidev import`

## Design decisions

- **Reviewer always internal**: external operators do not supply review artifacts. The reviewer is aidev's quality gate.
- **`external` is a backend name, not a new `AgentRunner`**: it signals "no agent execution" at the workflow level. `createRunner("external")` intentionally throws — the state handlers never reach the runner.
- **`aidev import` over CLI flags on `run`**: import can be called against a paused run without restarting the process. Operators work at their own pace.
- **Atomic writes**: `aidev import` and persistence both use temp+rename to prevent partial reads during concurrent resume.
- **`blocked` is a gate, not a dead end**: resume from blocked re-enters the workflow loop. The handler checks for the required artifact and either advances or stays put.
