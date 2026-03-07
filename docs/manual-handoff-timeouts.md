# Issue #65 Implementation Plan

## Goal

Add explicit wall-clock agent timeouts and a recoverable `manual_handoff` workflow state so operators can distinguish hard failures from intentional handoff.

## Proposed shape

- Extend `RunStateSchema` with `manual_handoff`
- Persist `handoffReason`, `handoffFromState`, and `handoffAt`
- Add wall-clock timeout configuration for long-running agent states
- Transition timeout failures into `manual_handoff` instead of generic `failed`
- Teach `resume` semantics how to continue from `manual_handoff`
- Treat `manual_handoff` as a terminal workflow state until an operator explicitly resumes it
- Update notifier/output contracts (`workflow/engine`, Slack formatting, CLI completion handling) so `manual_handoff` is surfaced distinctly instead of being collapsed into `failed`

## TDD

Red:
- add type tests for the new `manual_handoff` state and persisted handoff fields
- add workflow state tests covering timeout -> `manual_handoff`
- add resume tests proving a manual handoff can restart from the correct state
- add notifier/CLI tests proving `manual_handoff` produces a distinct completion path and message

Green:
- implement the new state and timeout transition path
- persist handoff metadata in `state.json`

Refactor:
- centralize timeout/handoff conversion logic so planning/implementing/reviewing do not drift

## Review notes before implementation

- Do not overload `failed`; the point is to preserve operator intent
- Keep timeout policy configurable rather than hardcoded per state
- Avoid conflating no-output watchdogs with wall-clock limits; they solve different failure modes
- Update every consumer of terminal states in the same PR; partial support would strand runs or misreport them
