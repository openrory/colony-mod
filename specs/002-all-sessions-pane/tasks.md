---

description: "Task list for All-Sessions Pane"
---

# Tasks: All-Sessions Pane

**Input**: Design documents from `/specs/002-all-sessions-pane/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (shared-summary.md, pane-render.md, user-surface.md), quickstart.md. Builds on spec 001 (existing code in `src/`, `hooks/register.tsx`, 134 tests).

**Tests**: Included, as in plan.md: pure code is unit-tested with `claude plugin test`; the write throttle and the off switch get engine-level tests. Live scenarios are in quickstart.md.

**Organization**: This spec has one user story (P1). Pure modules come first (Foundational), then the story's wiring, drawing and fallback, then polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 only (phase labels for Setup, Foundational and Polish are omitted)
- Mod folder = repository root. Engine types: `.claude-plugin/types/` when the mod is loaded, else the plugin-authoring skill's `types/claude-code.d.ts`. `$.fs` has `read`, `write`, `list`, `exists` only (no delete).
- Lessons from spec 001: every observer hook is a literal `($, e, next) => guarded(() => ..., () => next(e))` and returns `next(e)` unchanged; functions that receive `$` are declared in `hooks/register.tsx`; pure logic lives in `src/` and stays free of engine imports.

---

## Phase 1: Setup

- [X] T001 Add the option `sharedFolder` to `userConfig` in `.claude-plugin/plugin.json`: `{ "type": "string", "title": "Shared folder", "default": "", "description": "Absolute path of a folder shared by your sessions. Set the same path in every session to see all your sessions' agents in one pane. Leave empty to share nothing and read nothing." }`; extend `readOptions` and `ColonyOptions` in `src/runtime.ts` with `sharedFolder: string` (empty string when unset) and update `tests/runtime.test.ts`
- [X] T002 [P] Extend `types/index.d.ts` with the types `SharedSummary`, `SharedAgent`, `SessionGroup` (fields per data-model.md) and add `sessions: Record<string, SessionGroup>` to `Colony` (default `{}` in `initialColony` in `src/model.ts`)

---

## Phase 2: Foundational (pure modules)

**Purpose**: Everything that can be built and tested without the engine

**⚠️ CRITICAL**: complete before Phase 3

- [X] T003 [P] Write `tests/snapshot.test.ts` first: (a) `buildSummary` output contains exactly the contract's fields and nothing else, even when the input agents carry extra fields such as `note`, `usage` details, prompts or tool text (FR-003, SC-003); (b) labels longer than 40 characters are truncated to 40; (c) more than 100 agents are cut to 100 dropping the oldest completed first; (d) ids are unique; (e) `parseSummary` accepts a valid v1 summary, ignores unknown extra fields, rejects invalid JSON, `version` other than 1, a missing `sessionId`, a non-finite `updatedAt`, a label over 200 characters, and maps an unknown `state` to `unknown`; (f) an `ended: true` summary parses as ended
- [X] T004 Implement `src/snapshot.ts` (after T003): `buildSummary(colony, session: { id, name, folder }, now): SharedSummary` using an allow-list of exactly `{ version: 1, sessionId, name, folder, updatedAt, ended, agents: [{ id, label, parentId, state, listenSource, model, tokens }], exchanges: [{ from, to }] }`; `endedSummary(session, now)` returning only `{ version: 1, sessionId, updatedAt, ended: true, agents: [] }` (no name and no folder); `parseSummary(text): SharedSummary | null` enforcing the validation rules in data-model.md ("`version` must equal 1; `sessionId` non-empty string; `updatedAt` finite number; `agents` at most 100; `label` at most 40 chars (truncated by the writer; the reader rejects more than 200); `state` one of the AgentState values, otherwise `unknown`; ids unique within the file")
- [X] T005 [P] Write `tests/sessions.test.ts` first: freshness is live below 10 s, stale from 10 s to 60 s, removed at 60 s or more since the newer of `updatedAt` and the file's modification time, removed at once when `ended`, and ignored when the file is older than 24 h at first read; the own `sessionId` is skipped; agent ids are namespaced `<sessionId>/<id>`; `needsAttention` is true when any agent is pending; two sessions with the same name get distinct labels (folder's last path segment, then a short id); a session present both as a shared summary and as a peer (`PEER_PREFIX` + sessionId) appears once, as shared; a session known only as a peer is kept as the limited fallback; a session whose summary fails to parse falls back to its peer entry when one exists and is omitted when none does
- [X] T006 Implement `src/sessions.ts` (after T005): `mergeSessions({ summaries, peers, selfId, now, mtimes }): Record<string, SessionGroup>` implementing the rules above, with exported constants `STALE_MS = 10_000`, `REMOVE_MS = 60_000`, `IGNORE_AGE_MS = 24 * 60 * 60 * 1000`
- [X] T007 Add a signal `{ type: 'sessions'; sessions: Record<string, SessionGroup>; at: number }` to `Signal` and `reduce` in `src/model.ts` that replaces `colony.sessions` wholesale (the poll result is the truth); extend `tests/model.test.ts`: replacing, clearing, and that local agents and exchanges are untouched
- [X] T008 [P] Add pure write-scheduling helpers to `src/runtime.ts`: `shouldWrite({ changed, lastWriteAt, now, lastHeartbeatAt })` returning true at most once per second on change (the trailing change must always eventually be written) and as a heartbeat every 5 s while the session is alive, busy or idle; with tests in `tests/runtime.test.ts`

**Checkpoint**: snapshot, sessions, signal and schedule helpers are tested and green (`claude plugin test .`).

---

## Phase 3: User Story 1 - One pane for all my sessions (Priority: P1) 🎯

**Goal**: with `sharedFolder` set, every session writes its own summary and any pane shows all sessions as groups; sessions that do not share fall back to a single limited figure; with it unset nothing is read or written.

**Independent Test**: quickstart scenarios 1 to 7 (two sessions sharing; pending and exchange visible across; stale and ended; off switch; privacy; unreadable file; many sessions).

### Tests for User Story 1

- [X] T009 [P] [US1] Write `tests/layout.test.ts` additions for session groups per contracts/pane-render.md: each other session is a group with a header (`<name>` and the folder dimmed) beneath the local session; a group with a pending agent shows the `needs you` marker even when collapsed; a stale group is drawn dimmed with `stale` and without animation; a fallback peer shows one unknown-style figure with `limited`; collapse order when space is short is fresh quiet groups, then stale groups, and groups needing attention and the local session never collapse; ten groups stay within the viewport without overlap
- [X] T010 [P] [US1] Write engine-level tests in `tests/register.test.ts`: with `sharedFolder` empty no `$.fs.write` and no `$.fs.list` or `$.fs.read` of any folder happens (FR-002, SC-003); with it set, a state change leads to one write of `<folder>/<sessionId>.json` whose content passes `parseSummary`; two changes within one second lead to one write followed by the trailing write; at `session.end` one `ended` summary is written; setting the option, then reloading with it empty, leads to exactly one `ended` write to the previously used folder

### Implementation for User Story 1

- [X] T011 [US1] Extend `hooks/register.tsx` writer: when `sharedFolder` is non-empty, after each state change (dispatch) and on a heartbeat, call `buildSummary` and `$.fs.write("<sharedFolder>/<sessionId>.json", JSON.stringify(summary))` following `shouldWrite`; write nothing when the option is empty; use `$.session.id()` for the id, `folder` from `$.session.cwd()` and `name` from the last segment of that folder (the first 8 characters of the id when the folder is empty); the API has no session name
- [X] T012 [US1] Extend `hooks/register.tsx` end-of-session and turning sharing off: remember the shared folder in `$.store` under `lastSharedFolder` whenever the option is set. On `session.start` and on `session.end`, if the option is empty and `lastSharedFolder` is set, write one `endedSummary` to `<lastSharedFolder>/<sessionId>.json` and clear the key; on `session.end` with the option set, write one `endedSummary` to the current folder. Changing the option in the config menu reloads the mod, so this is how turning sharing off takes effect without a restart (spec edge case; SC-003)
- [X] T013 [US1] Extend `hooks/register.tsx` reader: while the pane is open and `sharedFolder` is set, poll every 1 s: `$.fs.list(sharedFolder)`, read only `.json` files whose `mtimeMs` changed since the last poll (keep a map in a module variable), `parseSummary` each, run `mergeSessions` together with the existing peer list from `readPeers`, and dispatch the `sessions` signal; any unreadable file or missing folder is skipped without error (FR-008); stop the timer when the pane closes (reuse the pattern of `startPeers` and `stopPeers`)
- [X] T014 [US1] Extend `src/layout.ts` and `src/view.tsx` per contracts/pane-render.md and tests T009: group headers, `needs you` marker, dimmed `stale` look, `limited` fallback figure, collapse order, duplicate-name labels; groups reuse the existing figure, sprite, label and exchange drawing for their agents (spec 001 FR-003, FR-004, FR-008)
- [X] T015 [US1] Extend `statusFor` and `attentionOf` in `src/runtime.ts` so the status-line summary and the pending toast also count pending agents in other sessions' groups (FR-006), without letting other sessions open the pane by themselves; update `tests/runtime.test.ts` (FR-009; spec 003 FR-008 still holds for sessions shown only as limited figures)
- [X] T016 [US1] Keep the spec 003 behaviour intact: the existing peer view stays the fallback (FR-007) controlled by `sessionsDirectory`; add a regression test in `tests/peers.test.ts` that a session present in both sources is drawn once, as shared; the two options (`sharedFolder`, `sessionsDirectory`) are independent and the README must say so
- [X] T017 [US1] Run `claude plugin validate .` and `claude plugin test .`; fix issues. Then type-check with a scratch tsconfig outside the repo that points `claude-code` at the engine declarations (as done in spec 001). Manual quickstart scenarios stay for the user

- [X] T022 [US1] Make the shared folder default to `<config dir>/colony` with an explicit switch (release 0.2.1): add the boolean option `shareSessions` (default false, sharing stays opt-in per FR-002) to `.claude-plugin/plugin.json`, make `sharedFolder` optional (empty = default folder); add the pure helper `sharedFolderFor` in `src/runtime.ts` and `shareSessions` in `readOptions`/`ColonyOptions`; in `hooks/register.tsx` read `CLAUDE_CONFIG_DIR` and `HOME` through `$.env.get` at session start and use the resolved folder for the writer, reader, `lastSharedFolder` and the ended marker; tests in `tests/runtime.test.ts` for every branch and in `tests/register.test.ts` for the HOME default, `CLAUDE_CONFIG_DIR` precedence, no environment, and the switch off

**Checkpoint**: the story works end to end in tests; live behaviour is the user's to verify.

---

## Phase 4: Polish & Cross-Cutting

- [X] T018 [P] Add a "Sharing across sessions" section to `README.md` (FR-008): what is shared (exactly the fields in contracts/shared-summary.md and nothing from conversations), where (the `sharedFolder` path, one `<sessionId>.json` file per session), how to turn it on (set the same folder in every session) and off (clear the option; the session writes one `ended` file), that old files are tiny and safe to delete by hand because the mods API cannot delete them, and that sessions without the mod appear as a single limited figure; and how to set `sessionsDirectory` (spec 003) to also see sessions that do not share
- [X] T019 [P] Bump `version` to `0.2.0` in `.claude-plugin/plugin.json` and add a "Releasing 0.2.0" note to `docs/PUBLISHING.md` (new option; no migration needed)
- [X] T020 [P] Update the "Known limits" in `README.md` for this feature: sharing needs the mod in every session, updates lag by about a second, same user and machine only, and the folder must be set by hand because the API has no home-directory path
- [ ] T021 Walk quickstart scenarios 1 to 7 with two or more real sessions, tick off T017 and the scenarios you have verified, and record SC-001 (3 s) and SC-004 (10 sessions) results at the end of `specs/002-all-sessions-pane/quickstart.md`

---

## Dependencies & Execution Order

- Setup (T001, T002) → Foundational (T003 to T008) → User Story 1 (T009 to T017) → Polish (T018 to T021).
- Tests before code: T003 before T004, T005 before T006, T009 and T010 before T011 to T014.
- T007 needs T002 and T006. T013 needs T004, T006, T007 and T001. T014 needs T009 and T007. T015 needs T007. T016 needs T013.
- `hooks/register.tsx` is edited by T011, T012 and T013, so they run in sequence.

### Parallel Opportunities

- T002 alongside T001.
- T003, T005 and T008 together (different files).
- T009 and T010 together.
- T018, T019 and T020 together.

### Parallel Example

```text
Task: "tests/snapshot.test.ts allow-list and validation"   (T003)
Task: "tests/sessions.test.ts freshness and merging"        (T005)
Task: "write-scheduling helpers in src/runtime.ts"          (T008)
```

## Implementation Strategy

- **MVP**: Phases 1 to 3. Without Polish the feature works but the privacy text is missing, so do T018 before sharing the release.
- Build Foundational first (all pure, all unit-tested); the engine wiring comes last and is the riskiest part, so it is the part to escalate from Haiku to Sonnet if it struggles.
- Stop at the Phase 2 checkpoint and at T017 to review before the live walk.
