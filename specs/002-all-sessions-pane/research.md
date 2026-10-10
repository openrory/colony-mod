# Research: All-Sessions Pane

Source: the mods plugin-authoring reference and the engine's `claude-code.d.ts` for this build; the layout of the files Claude Code keeps for each session on disk was inspected on the author's machine.

## R1. One pane for all sessions

- **Decision**: every session whose mod has sharing on writes a summary of its OWN agents to a shared folder; the pane in any session reads every summary in that folder and draws each session as a group. The existing session-file peer view (`src/peers.ts`) stays as the fallback for sessions that do not share (FR-007).
- **Rationale**: a session's mod is the only place with the real events (spawn, stop, permission requests, messages), so states and exchanges are exact, not inferred. The mods API has no cross-session event channel and a session cannot see another session's subagents.
- **Alternatives considered**: (a) infer subagents from other sessions' transcript files: inferred states, no exchanges, depends on internal file layout, reads conversation files; rejected as the primary path. (b) `$.store`: persists across sessions but is a per-user key-value store with a 4 MiB cap, not designed for concurrent writers; rejected. (c) a local socket/daemon: needs a process and port binding, which sandboxes forbid; rejected.

## R2. No file delete in the mods API

- **Finding**: `$.fs` offers `read`, `write`, `list` (name, kind, size, mtimeMs) and `exists`; there is no remove.
- **Decision**: on a clean end, a session overwrites its file with `{ "ended": true, ... }`; readers drop ended files at once and drop any file whose last update is older than 60 s; files older than 24 h are ignored (the README says they are safe to delete by hand).
- **Consequence**: the folder accumulates tiny files over time; they are bounded in size (R5) and ignored when old.

## R3. Where the shared folder lives

- **Finding (corrected)**: the API does give the environment: `$.env.get("HOME")` and `$.env.get("CLAUDE_CONFIG_DIR")` resolve variables (string literals only, listed by `claude plugin validate`). An earlier note said the API had no home path; that was wrong. Tests can mock them with `mock.env`.
- **Decision**: a boolean option `shareSessions` (default false) is the switch. Off = sharing off and no reading of other sessions' shared state (FR-002, SC-003). On = the folder is `<config dir>/colony`, where the config dir is `CLAUDE_CONFIG_DIR` or else `<HOME>/.claude`, so no folder has to be typed. An optional option `sharedFolder` (absolute path, default empty) overrides the folder; a non-empty `sharedFolder` also turns sharing on, so 0.2.0 users keep sharing. The folder is resolved once at session start by the pure helper `sharedFolderFor` (`src/runtime.ts`). The same user settings apply to all of the user's sessions, so one setting turns it on everywhere. The existing `sessionsDirectory` option keeps controlling only the fallback peer view.
- **Session name and folder**: the API gives `$.session.cwd()` and `$.session.id()` but no session name, so the name is derived from the last segment of the folder (or a short id). A change to an option in the config menu reloads the mod, so turning sharing on or off takes effect without a restart; module variables reset on reload, so the previously used folder is remembered in `$.store`.
- **Two options**: `shareSessions` (and the optional `sharedFolder`) control sharing; the existing `sessionsDirectory` (spec 003) controls the fallback view of sessions that do not share.
- **Alternatives**: a single option for both (simpler, but the fallback needs the folder holding Claude Code's own session files, which is a different location).

## R4. Write and read cadence

- **Decision**: rewrite the own summary only when it changed, at most once per second (trailing edge so the last change is always written), plus a heartbeat write every 5 s while the session is alive, busy or idle so readers can tell alive from stale. Readers poll every 1 s while the pane is open and `list` the folder, reading only files whose `mtimeMs` changed since the last poll.
- **Rationale**: meets SC-001 (3 s) with headroom; cost is O(changed files) per poll (SC-004).
- **Stale/removal**: stale after 10 s without update (shown dimmed, "stale"), removed after 60 s or on `ended` (spec Assumptions).

## R5. Privacy and size cap

- **Decision**: the summary is built from an allow-list in `src/snapshot.ts`: per agent only `id`, `label` (truncated to 40 chars), `parentId`, `state`, `listenSource`, `model`, token totals, plus exchanges as `{ from, to }`; never prompts, messages, tool inputs/outputs or file contents (FR-003). Max 100 agents per summary (oldest completed dropped first). A test asserts that no field outside the allow-list can appear.

## R6. Versioning and unreadable files

- **Decision**: every summary has `version: 1`. A reader ignores files with a higher or missing version, invalid JSON, or failed validation, and shows that session as a single limited figure only if it is also known from the session-file fallback; otherwise it is not shown (FR-008). Unknown extra fields are ignored so a minor addition does not break older readers.
