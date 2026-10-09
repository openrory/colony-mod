# Data Model: All-Sessions Pane

All in memory in the reading session, rebuilt on each poll; the only persisted data is each session's own shared summary file. Agent, AgentState and Exchange are defined in [spec 001's data model](../001-agent-colony-pane/data-model.md).

## Session
| Field | Type | Notes |
|---|---|---|
| sessionId | string | unique; the own session is excluded from the "other" groups |
| name | string | display name; if two sessions share a name the group label adds the folder or a short id (edge case) |
| folder | string | the session's working folder, shown dimmed |
| updatedAt | number | ms from the summary's `updatedAt`; drives staleness |
| source | `shared` \| `peer` | `shared` = read from a SharedSummary; `peer` = fallback single figure (limited detail) |
| freshness | `live` \| `stale` | derived: live < 10 s, stale 10-60 s; beyond that, or `ended`, the session is removed |
| agents | Agent[] | the session's agents (empty for `peer`) |
| needsAttention | boolean | derived: any agent `pending` (FR-006) |

## SharedSummary (file format v1; see contracts/shared-summary.md)
`{ version, sessionId, name, folder, updatedAt, ended?, agents: [{ id, label, parentId, state, listenSource, model, tokens }], exchanges: [{ from, to }] }`

### Validation
- `version` must equal 1; `sessionId` non-empty string; `updatedAt` finite number; `agents` at most 100; `label` at most 40 chars (truncated by the writer; the reader rejects more than 200); `state` one of the AgentState values, otherwise `unknown`; ids unique within the file.
- Agent ids are namespaced by session (`<sessionId>/<id>`) when merged into the pane so they cannot collide with local ids.

### State transitions
- absent -> live: first valid summary read
- live -> stale: no update for 10 s; stale -> live on the next update
- live or stale -> removed: `ended` marker, or 60 s without update, or a file older than 24 h at first read
- sharing turned off in a session: it writes one `ended` summary, then stops writing (SC-003, edge case).
