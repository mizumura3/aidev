# Issue #66 Implementation Plan

## Goal

Introduce a `Codex mode` where `aidev` remains the workflow/orchestration layer while external operators handle planning and implementation without nesting another Claude execution loop.

## Proposed shape

- Add a run-mode abstraction for agent execution
- Preserve existing default behavior as the standard Claude-backed mode
- Add a Codex-oriented mode that skips internal planner/implementer execution and expects externally provided artifacts or manual continuation
- Keep branch/PR/state persistence unchanged

## TDD

Red:
- add CLI tests for selecting Codex mode
- add workflow tests proving issue/PR orchestration still runs when internal agent execution is disabled
- add persistence tests for externally supplied plan/result handoff data

Green:
- implement run-mode selection and agent-runner abstraction
- wire Codex mode through `run`, `resume`, and state persistence

Refactor:
- move agent invocation behind a narrow interface so default mode and Codex mode share workflow logic

## Review notes before implementation

- The orchestration layer should not assume Claude owns every state transition
- Avoid duplicating workflow logic between default mode and Codex mode
- Keep this mode explicit; silent autodetection would make debugging worse
