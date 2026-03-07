# Issue #65 Implementation Plan

## Goal

Add a recoverable `manual_handoff` workflow state and the surrounding persistence/output contracts so operators can distinguish intentional handoff from hard failure.

The primary source of handoff policy should be the target repository's `CLAUDE.md` / `.claude/` rules. Generic wall-clock timeouts should exist only as a later safety net.

## Proposed shape

- Extend `RunStateSchema` with `manual_handoff`
- Persist `handoffReason`, `handoffFromState`, and `handoffAt`
- Treat `manual_handoff` as a terminal workflow state until an operator explicitly resumes it
- Teach `resume` semantics how to continue from `manual_handoff`
- Update notifier/output contracts (`workflow/engine`, Slack formatting, CLI completion handling) so `manual_handoff` is surfaced distinctly instead of being collapsed into `failed`
- Add an explicit handoff contract so an agent can declare "this requires human intervention" in a machine-readable way
- Read handoff conditions from repo-local rules first (`CLAUDE.md`, `.claude/`), letting each project define what should escalate to a human

## Implementation order

1. **Repo rules first**
   - Document handoff conditions in the target repository's `CLAUDE.md` / `.claude/` rules
   - Keep the decision policy project-specific and inspectable
2. **Explicit handoff contract**
   - Let the agent surface handoff intent in a machine-readable form
   - Example: structured JSON result or another parseable response shape carrying `handoffReason`
3. **Workflow state + terminal consumers**
   - Persist `manual_handoff` in `state.json`
   - Update workflow engine, CLI, and Slack/output consumers to treat it distinctly from `failed`
4. **Wall-clock timeout as safety net**
   - Add a generic timeout path only after the contract-based flow exists
   - Use it as the last line of defense for stuck runs, not the primary signal

## TDD

Red:
- add type tests for the new `manual_handoff` state and persisted handoff fields
- add workflow/CLI/Slack tests proving `manual_handoff` is surfaced as a distinct terminal outcome
- add resume tests proving a manual handoff can restart from the correct state
- add contract tests proving aidev can consume an agent-declared handoff signal

Green:
- implement the new terminal state and persistence shape
- implement notifier/CLI/workflow handling for `manual_handoff`
- implement the agent handoff contract ingestion path

Refactor:
- centralize terminal-state handling so `done` / `failed` / `manual_handoff` do not drift across workflow engine, CLI, and notifications
- keep timeout-to-handoff conversion separate from the core state model so the safety net can evolve independently

## Optional follow-up: wall-clock safety net

After the rules-based and contract-based handoff flow is working:

- add configurable wall-clock timeout configuration for long-running agent states
- transition timeout overruns into `manual_handoff` with explicit timeout metadata
- keep this as fallback behavior for cases repo rules did not catch

## Review notes before implementation

- Do not overload `failed`; the point is to preserve operator intent
- Do not make aidev the primary owner of "what requires human judgment"; that belongs in repo-local rules
- Keep wall-clock timeout policy configurable and secondary to explicit handoff rules
- Avoid conflating no-output watchdogs with wall-clock limits; they solve different failure modes
- Update every consumer of terminal states in the same PR; partial support would strand runs or misreport them
