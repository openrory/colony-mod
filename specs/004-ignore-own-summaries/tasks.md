---

description: "Task list for ignoring the mod's own summaries when reading sessions"
---

# Tasks: Shared Summaries Are Never Mistaken for Sessions

**Input**: spec.md and plan.md in `/specs/004-ignore-own-summaries/`. **Tests**: included (SC-003).

## Phase 1: User Story 1 - No phantom sessions in the pane (P1) 🎯

**Independent Test**: acceptance scenarios 1 to 4 in spec.md, as automated tests in `tests/peers.test.ts`.

- [X] T001 [US1] Write failing tests in `tests/peers.test.ts` first: (a) a live shared-summary record (`version: 1`, `sessionId`, `updatedAt`, `agents: [...]`) parses to null; (b) an ended marker (`ended: true`, `agents: []`) parses to null; (c) a summary with an unknown `version` and an `agents` list parses to null; (d) a normal session record with a string `version`, a `status` and no `agents` still parses exactly as before; (e) a record with `agents` that is not an array is treated as a normal session record
- [X] T002 [US1] In `src/peers.ts`, make `parsePeer` return null when `Array.isArray(record.agents)` (placed right after the object check), with a comment saying why (the mod's own shared summaries must never be drawn as sessions)
- [X] T003 [US1] Add an integration test in `tests/peers.test.ts` (or `tests/sessions.test.ts`): sessions folder and shared folder identical; a live summary + its normal session file for session A, and an ended marker for session B with no session file: `mergeSessions` yields exactly A once (shared, full detail) and nothing for B
- [X] T004 [US1] Run `claude plugin test .`, `claude plugin validate .` and `tsc -p .`; all must pass with no new warnings. Bump `version` to `0.2.2` in `.claude-plugin/plugin.json` and add a "Releasing 0.2.2" note to `docs/PUBLISHING.md`

## Dependencies

T001 before T002; T003 after T002; T004 last. Single story; no parallel work worth marking.

## Implementation Strategy

Tiny fix, done in one sitting. The only live check (optional): set both options to one folder in two sharing sessions and end one; confirm no phantom figure.
