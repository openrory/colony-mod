---

description: "Task list for one switch for sharing, clear option names"
---

# Tasks: One Switch for Sharing, Clear Option Names

**Input**: spec.md and plan.md in `/specs/005-one-switch-sharing/`. **Tests**: included.

## Phase 1: User Story 1 - One switch (P1) 🎯

- [X] T001 [US1] Write failing tests first in `tests/runtime.test.ts` for a new pure `sessionsFolderFor({ shareSessions, sessionsDirectory, configDir, home })`: an override wins (trimmed, trailing slashes stripped) even with the switch off; switch on with no override gives `<configDir>/sessions` when configDir is non-empty, else `<home>/.claude/sessions`; switch off and no override gives ''; the Claude folder unknown gives ''. Mirror the existing `sharedFolderFor` tests
- [X] T002 [US1] Implement `sessionsFolderFor` in `src/runtime.ts` (same style as `sharedFolderFor`)
- [X] T003 [US1] In `hooks/register.tsx` replace `resolveSharedFolder` with `resolveFolders` that resolves BOTH folders once at session start (reading the two variables CLAUDE_CONFIG_DIR and HOME through the engine's environment noun, names as string literals), and make the peer reader (`readPeers`, `pollSessions`, `startPeers`) use the resolved sessions folder, not the raw `sessionsDirectory`; with the switch off and no override, no file in either folder is listed, read or written (FR-005)
- [X] T004 [US1] Add engine-level tests in `tests/register.test.ts` (using `mock.env`): switch on reads `<HOME>/.claude/sessions` and writes `<HOME>/.claude/colony`; the configured Claude folder wins over HOME for both; only an old-style `sessionsDirectory` override set (switch off) reads that folder and writes nothing; switch off and no overrides touches no file; the Claude folder unknown with the switch on touches no file. Update existing tests that relied on the old behaviour
- [X] T005 [US1] Update `.claude-plugin/plugin.json` titles and descriptions as in plan.md (keys unchanged) and bump `version` to `0.3.0`
- [X] T006 [US1] Rewrite the README options table and the "Sharing across sessions" section around the one switch (FR-004): the three options in plain words; defaults `<Claude folder>/colony` and `<Claude folder>/sessions`; overrides optional and turning on their part; the privacy text kept; say that turning the switch on also reads Claude Code's own session files for the limited view and that their format may change. Add a "Releasing 0.3.0" note to `docs/PUBLISHING.md`
- [X] T007 [US1] Add a one-line pointer at the top of specs 002 and 003 `spec.md`: "Option rules superseded by spec 005"
- [X] T008 [US1] Run `claude plugin test .`, `claude plugin validate .` and `tsc -p .`; all must pass with no new warnings

## Dependencies

T001 before T002; T003 needs T002; T004 after T003; T005 to T007 independent of each other after T003; T008 last.
