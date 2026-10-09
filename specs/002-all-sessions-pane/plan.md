# Implementation Plan: All-Sessions Pane

**Branch**: `002-all-sessions-pane` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-all-sessions-pane/spec.md`. **Depends on**: [001-agent-colony-pane](../001-agent-colony-pane/plan.md).

## Summary

When the user sets a shared folder, each session's mod writes a small versioned summary of its own agents to that folder (rewritten on change, throttled, with a heartbeat), and the pane in every session reads all summaries there and draws each other session as a group beneath the local one. Sessions that do not share fall back to the existing single-figure peer view. Details: [research.md](research.md), [contracts/shared-summary.md](contracts/shared-summary.md).

## Technical Context

**Language/Version**: TypeScript (ES modules, JSX via global `h`) in the existing mod

**Primary Dependencies**: none new; `$.fs` (`read`, `write`, `list`, `exists`), `$.clock`, the existing colony atom

**Storage**: one small JSON file per session in the user-chosen shared folder; no delete exists in the API, so a session overwrites its file with an `ended` marker (research R2)

**Testing**: `claude plugin test` for the pure code (snapshot allow-list, parsing and validation, staleness, merging, layout of groups); engine-level tests for the write throttle and the off switch; manual scenarios in [quickstart.md](quickstart.md)

**Target Platform**: Claude Code terminal; the same machine and user only

**Project Type**: extension of the existing mod (single plugin folder)

**Performance Goals**: a change in one session visible in another within 3 s (SC-001); reading cost proportional to changed files per poll; summaries under 64 KiB; no noticeable slowdown at 10 sessions (SC-004)

**Constraints**: opt-in, off by default (FR-002); allow-listed fields only, no conversation content (FR-003); hooks stay observers and always pass through (spec 001 FR-016); the API has no home-directory path, so the folder is an option (R3)

**Scale/Scope**: up to 10 sessions, up to 100 agents each

## Constitution Check

The constitution file is still the unfilled template, so it defines no gates. Self-imposed principles carried over from spec 001: observe-only, pure core logic with tests, nothing beyond the spec. Status: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-all-sessions-pane/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── shared-summary.md     # the file each session shares
│   ├── pane-render.md        # session groups in the pane
│   └── user-surface.md       # the sharedFolder option, README duties
└── tasks.md                  # created by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── snapshot.ts               # Colony -> SharedSummary (privacy allow-list); parse, validate, version
├── sessions.ts               # merge summaries into session groups; stale/ended/duplicate-name rules
├── layout.ts                 # extended: session groups, attention marker, collapse order
├── view.tsx                  # extended: group headers, stale look, limited look
├── runtime.ts                # extended: write/read cadence helpers
└── peers.ts                  # unchanged: fallback for sessions that do not share
hooks/
└── register.tsx              # extended: write own summary, poll folder, end marker on session end / option off
.claude-plugin/
└── plugin.json               # new option sharedFolder
tests/
├── snapshot.test.ts
├── sessions.test.ts
└── layout.test.ts            # group cases added
README.md                     # new "Sharing across sessions" section (privacy, cleanup)
```

**Structure Decision**: extend the single plugin folder; new logic in two pure modules, thin glue in `hooks/register.tsx`.

## Complexity Tracking

No constitution violations to justify.
