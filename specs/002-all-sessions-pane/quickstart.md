# Quickstart: validating the All-Sessions Pane

Builds on the single-session setup in [spec 001's quickstart](../001-agent-colony-pane/quickstart.md) (install, `claude --plugin-dir .`, `/colony`).

## Scenarios (FR-001 to FR-008, SC-001 to SC-003)
Prerequisites: the mod installed at user scope; two terminal sessions A and B; set the `sharedFolder` option to the same empty folder (for example `~/.claude/colony`) for both.
1. **See each other**: start a task with subagents in B. In A's pane (open with `/colony`), B appears as a group with its agents; states match B's own pane within 3 seconds.
2. **Pending and exchange across sessions**: make an agent in B ask for approval: A's pane marks B's group `needs you` and shows the pending figure. Let B's main wait on a running subagent: A shows the same 0/1 exchange as B.
3. **Stale and ended**: close B's terminal abruptly: its group dims with `stale` after about 10 s and disappears after about 60 s. End B cleanly: it disappears at once.
4. **Opt-in off**: unset `sharedFolder` in B and run a task there: A shows no B agents (SC-003) and B's summary file shows `"ended": true`.
5. **Privacy**: open a summary file; it contains only the fields in contracts/shared-summary.md and no prompt or tool text.
6. **Unreadable file**: edit one summary to `version: 2` or invalid JSON: A ignores it without error.
7. **Many sessions**: with 10 sessions sharing, A's pane stays legible and sessions needing attention are never collapsed.
