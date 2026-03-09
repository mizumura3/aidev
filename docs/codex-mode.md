# Issue #66 Implementation Plan

## Goal

Introduce a `Codex mode` where `aidev` remains the workflow/orchestration layer while external operators handle planning and implementation without nesting another Claude execution loop.

## Prerequisites

- Add a `--backend <name>` CLI option to the `run` command (does not exist yet). Default: `"claude-code"`. Validate against a known set of backends.
- Add a `backend` field to `RunContextSchema` (types.ts) so the active mode is persisted and survives resume. Without this, resume cannot distinguish which mode originated the run.
- Add a `blocked` state to `RunStateSchema`. Semantics: `blocked` IS included in `terminalStates` (stops the workflow loop), but is NOT a permanent end state — it is resumable. The resume path re-enters the loop from a `blocked` handler that gates on artifact availability.
- Audit existing tests that construct `RunContext` directly (outside `makeCtx()`) to ensure the new `backend` field (with default) does not break them.
- Update `formatSlackMessage` type signature and implementation to handle `blocked` alongside `done` and `failed`.

## Agent-runner interface sketch

The current codebase calls `runPlanner()`, `runImplementer()`, `runReviewer()`, `runFixer()` directly from state handlers with agent-specific signatures. The abstraction should:

```typescript
interface AgentDispatcher {
  plan(input: PlannerInput, logger: Logger): Promise<Plan>
  implement(input: ImplementerInput, logger: Logger): Promise<Result>
  review(input: ReviewerInput, logger: Logger): Promise<Review>
  fix(input: FixerInput, logger: Logger): Promise<Fix>
  document(input: DocumenterInput, logger: Logger): Promise<void>
}
```

- **Default mode** (`claude-code`): delegates to existing `runPlanner`, `runImplementer`, etc.
- **Codex mode**: the dispatcher is **not** responsible for detecting missing artifacts. State handlers check artifact availability BEFORE calling the dispatcher. If the required artifact is absent, the handler transitions to `blocked` without invoking the dispatcher. This keeps the dispatcher's return types clean (`Promise<Plan>`, not a union with a blocked sentinel).
- **Reviewer in Codex mode**: the `review()` method delegates to the internal `runReviewer` even in Codex mode. The reviewer acts as a quality gate that aidev always owns — the external operator does not supply review artifacts. This ensures a consistent safety net regardless of who authored the code.
- State handlers receive `AgentDispatcher` via `Deps`, replacing direct agent imports.
- This keeps the workflow engine (`engine.ts`) unchanged — only the dispatcher implementation varies per mode.
- `documenter` is included in the dispatcher interface. In Codex mode, it is a no-op (external operators handle their own documentation).

## Proposed shape

- Add a run-mode abstraction for agent execution (see interface sketch above)
- Preserve existing default behavior as the standard Claude-backed mode
- Add a Codex-oriented mode that skips internal planner/implementer execution and expects externally provided artifacts or manual continuation
- Keep branch/PR/state persistence unchanged
- Artifact ingress: use a dedicated `aidev import` subcommand. The import command:
  - Accepts `--run-id <id>` OR `--issue <N>` OR `--pr <N>` (resolve to latest run via `findLatestByIssue`/`findLatestByPr`)
  - Accepts `--artifact-type` (plan|result|fix) — `review` is not importable (see reviewer policy above)
  - Accepts a file path as positional arg, or stdin (with `-`)
  - Accepts `--max-size <bytes>` (default: 1MB) — reject payloads exceeding this limit. Applied to both file and stdin reads.
  - Supports `--dry-run` to validate the artifact without writing it (prints validation result and exits)
  - On validation failure, prints the specific Zod error path and a hint showing the expected schema shape
  - **Write behavior**: import writes BOTH the artifact file (`plan.json`, `result.json`, `fix.json`) AND updates `state.json` with the artifact data in the corresponding field (`ctx.plan`, `ctx.result`, `ctx.fix`). This ensures resume can find the artifact via `ctx` without needing to re-read individual files.
- **Atomic writes**: `aidev import` must write artifacts via temp file + rename to prevent partial reads by a concurrent `aidev run --resume`. The existing `createFilePersistence.save()` should also be updated to use atomic writes (this is a pre-existing issue, but Codex mode makes it a practical concern).
- Specify the artifact contracts for `plan`, `result`, and `fix` payloads before implementation so persistence and resume semantics stay deterministic
- All externally supplied artifacts MUST be validated against their Zod schemas (`PlanSchema`, `ResultSchema`, `FixSchema`) at ingress. Treat external artifacts as untrusted input — never deserialise into `RunContext` without schema validation.
- Resume must enforce mode consistency: a run started in Codex mode cannot be resumed in default mode (and vice versa). The `backend` field in persisted state is the source of truth.

## State machine adjustments for Codex mode

### `init` state

The `init` handler runs identically in both modes with two exceptions:
- **Author check**: in Codex mode, `--allow-foreign-issues` defaults to `true` (team workflows where the operator is not the issue author are common). The flag remains available for explicit override.
- **Config cascade**: `backend` participates in the standard precedence (CLI > issue body > `.aidev.yml` > default). If `.aidev.yml` sets `backend: codex` but CLI passes `--backend claude-code`, CLI wins.

### `blocked` state

`blocked` is a **gate state**: it is terminal for the current workflow loop invocation but resumable.

Resume flow:
1. Workflow reaches a point where an external artifact is required but absent → handler returns `{ nextState: "blocked", ctx: { ...ctx, blockedReason: "awaiting_plan" } }`
2. Operator supplies artifact: `aidev import --issue 42 --artifact-type plan plan.json`
3. Operator resumes: `aidev run --issue 42 --resume`
4. Resume logic (cli.ts) detects `state === "blocked"`, loads context (which now includes the imported artifact in `ctx.plan`)
5. `blocked` handler checks `blockedReason`, verifies the required artifact is present, transitions to the appropriate next state
6. If artifact is still missing, remains in `blocked`

A new `blockedReason` field is added to `RunContext`.

### `blockedReason` → artifact check → next state mapping

| `blockedReason`    | Required artifact | Check              | Next state       |
|--------------------|-------------------|--------------------|------------------|
| `awaiting_plan`    | `ctx.plan`        | `PlanSchema.parse` | `implementing`   |
| `awaiting_result`  | `ctx.result`      | `ResultSchema.parse` | `reviewing`    |
| `awaiting_fix`     | `ctx.fix`         | `FixSchema.parse`  | `watching_ci`    |

### State-specific changes

- `planning` (Codex mode): check if `ctx.plan` exists (supplied via import). If yes, skip to `implementing`. If no, transition to `blocked` with `blockedReason: "awaiting_plan"`.
- `implementing` (Codex mode): check if `ctx.result` exists. If yes, skip to `reviewing`. If no, transition to `blocked` with `blockedReason: "awaiting_result"`.
- `reviewing`: runs internal reviewer in BOTH modes. On `changes_requested` in Codex mode, clears `ctx.result` and transitions to `blocked` with `blockedReason: "awaiting_result"`.
- `committing`: check for uncommitted changes before running `git addAll + commit`. If the working tree is clean (external operator already committed), skip the commit step. aidev handles either case idempotently.
- `fixing` (Codex mode): check if `ctx.fix` exists. If yes, apply fix flow. If no, transition to `blocked` with `blockedReason: "awaiting_fix"`.

## Interactions with existing commands

- `watch` command: Codex mode is NOT supported via `watch`. The watch loop auto-processes issues and has no mechanism for external artifact handoff. Explicitly reject `--backend codex` in watch mode with a clear error message.
- `status` command: Should display the active backend/mode and `blockedReason` (if any) alongside run state.

## TDD

Red:
- add CLI tests for `--backend` option on `run` command (valid/invalid values)
- add CLI tests for selecting Codex mode (`--backend codex`)
- add CLI tests for `aidev import` subcommand:
  - happy path with file and stdin
  - `--issue`/`--pr` resolution to run-id
  - validation errors with descriptive output (Zod path + schema hint)
  - `--dry-run` validation-only mode
  - atomic write verification
  - oversized payload rejection
  - reject `--artifact-type review` (not importable)
  - verify both artifact file and `state.json` are updated
- add CLI tests rejecting Codex mode in `watch` command
- add workflow tests proving issue/PR orchestration still runs when internal agent execution is disabled
- add persistence tests for externally supplied plan/result handoff data
- add contract tests for artifact validation:
  - missing required fields (e.g. `steps: []` violates `.min(1)`)
  - extraneous / unknown fields (verify Zod `strict()` or `strip()` policy)
  - oversized payloads (exceeding `--max-size`)
  - schema version mismatch (forward-compatible: unknown fields stripped, missing required fields rejected)
- add resume tests for mode-consistency enforcement (cross-mode resume must fail)
- add resume-from-blocked tests:
  - artifact now present → correct next state (per mapping table)
  - artifact still missing → stays in `blocked`
  - `blockedReason` correctly maps to the required artifact check
- add `init` state tests for Codex mode defaults (`allow-foreign-issues` default true)
- add `init` state tests for config cascade with `backend` field
- add `reviewing` state test: reviewer runs internally in Codex mode; `changes_requested` → `blocked`
- add `committing` state test for already-committed changes (idempotent commit)
- add Slack notification test for `blocked` state formatting

Green (ordered by dependency):
1. add `backend` field to `RunContextSchema` with default `"claude-code"` and `blockedReason` optional field
2. add `blocked` to `RunStateSchema` and `terminalStates` set in engine.ts
3. add `--backend` CLI option to `run` command with validation
4. implement `AgentDispatcher` interface with `document` method, plus default implementation (wrapping existing agent calls)
5. implement Codex dispatcher (artifact-reading implementation)
6. implement `aidev import` subcommand with schema validation, atomic writes, size limits, dry-run, and dual-write (artifact file + state.json)
7. implement `blocked` state handler with artifact-presence gating (per mapping table)
8. wire Codex mode through `run` and `resume` (mode-consistency check, `init` defaults)
9. handle `reviewing → blocked` transition for Codex mode
10. make `committing` handler idempotent (skip commit if no staged changes)
11. update `formatSlackMessage` to handle `blocked` state

Refactor:
- move agent invocation behind `AgentDispatcher` so default mode and Codex mode share workflow logic
- replace direct `runPlanner`/`runImplementer`/`runReviewer`/`runFixer` calls in states.ts with dispatcher calls
- update `createFilePersistence.save()` to use atomic writes (temp + rename)

## Review notes before implementation

- The orchestration layer should not assume Claude owns every state transition
- Avoid duplicating workflow logic between default mode and Codex mode
- Keep this mode explicit; silent autodetection would make debugging worse
- Do not leave artifact injection implicit; operators need one documented way to provide `plan/result/fix` data
- External artifacts are untrusted input — validate at the boundary, not deep inside the workflow engine
- The `blocked` handler is a gate, not a dead end — always check if the required artifact has been supplied since the last run
- The reviewer agent runs internally in both modes — it is the quality gate aidev always owns
- The `committing` handler must be idempotent — external operators may or may not have committed their changes
- File-based persistence is not atomic by default — use temp+rename for all writes that may be read concurrently
- `aidev import` must update both the artifact file and `state.json` — the blocked handler reads from `ctx`, not from individual files
