# Issue #66 Implementation Plan

## Goal

Introduce a `Codex mode` where `aidev` remains the workflow/orchestration layer while external operators handle planning and implementation without nesting another Claude execution loop.

## Proposed shape

- Add a run-mode abstraction for agent execution
- Preserve existing default behavior as the standard Claude-backed mode
- Add a Codex-oriented mode that skips internal planner/implementer execution and expects externally provided artifacts or manual continuation
- Keep branch/PR/state persistence unchanged
- Define one explicit artifact ingress path up front (for example: CLI flags or a dedicated import command), rather than mixing `state.json` hand edits with normal CLI usage
- Specify the artifact contracts for `plan`, `result`, and optional `review` payloads before implementation so persistence and resume semantics stay deterministic

## TDD

Red:
- add CLI tests for selecting Codex mode
- add workflow tests proving issue/PR orchestration still runs when internal agent execution is disabled
- add persistence tests for externally supplied plan/result handoff data
- add contract tests for the chosen artifact ingress path and invalid payload handling

Green:
- implement run-mode selection and agent-runner abstraction
- wire Codex mode through `run`, `resume`, and state persistence

Refactor:
- move agent invocation behind a narrow interface so default mode and Codex mode share workflow logic

## Review notes before implementation

- The orchestration layer should not assume Claude owns every state transition
- Avoid duplicating workflow logic between default mode and Codex mode
- Keep this mode explicit; silent autodetection would make debugging worse
- Do not leave artifact injection implicit; operators need one documented way to provide `plan/result/review` data
