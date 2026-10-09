# Data Model: Agent Colony Pane

All of this is in-memory session state (`$.state`, plugin `colony`), never persisted except two user preferences in `$.store`.

## Agent
| Field | Type | Notes |
|---|---|---|
| id | string | `main` for the main loop, else the engine agent id |
| label | string | agent type or description, truncated to the pane width (FR-005) |
| parentId | string \| null | spawner; null for main (FR-007) |
| state | AgentState | see below; always exactly one (FR-003) |
| listenSource | string \| null | e.g. `github`, `jira`, `watch`, `webhook`, `external`; only while `listening` |
| startedAt / endedAt | number \| null | ms; `endedAt` starts the retention timer (FR-015) |
| lastEventAt | number | for reconciliation and unknown detection |

## AgentState and precedence (FR-013)
`pending` > `listening` > `in-progress` > `failed`/`cancelled` > `completed` > `idle` > `unknown`.
A candidate state set is reduced to the highest-precedence member. `unknown` is shown only when no signal and no `$.agent.list()` status is available (FR-018).

### Transitions
- idle → in-progress: turn start / tool call by the agent
- in-progress → pending: permission, elicitation, question; pending → in-progress: resolved
- in-progress → completed: turn complete (main) / SubagentStop success (sub)
- in-progress → failed|cancelled: SubagentStop with failure/kill status
- idle → listening: trigger registration observed; listening → in-progress: inbound event (after a reaction flash, FR-011)
- completed → removed: after the retention period (default 30 s) or when compacted

## Exchange
| Field | Type | Notes |
|---|---|---|
| id | string | `<fromId>><toId>` |
| fromId / toId | string | agent ids |
| reasons | set of `spawn`, `message`, `waiting`, `result` | exchange is active while the set is non-empty or a result burst is animating |
| burstUntil | number | end of the short spawn/result burst |

## Colony
`{ agents: Record<id, Agent>, exchanges: Record<id, Exchange>, tick: number, retentionMs: number }` plus preferences `{ isReducedMotion: boolean, isHiddenByUser: boolean }` from `$.store`.

## Scene (derived, not stored)
Output of `layout(colony, viewport, tick)`: for each visible figure `{ agentId, x, y, sprite, frame, label }`, for each active exchange `{ from, to, glyphs }`, and a `overflow` summary row (`+N completed`) when compacted (FR-014).

## Sprite
A named pixel grid set per state: `{ state, frames: string[][] }` using `#`/`.` rows, rendered pairwise to half-blocks. Original designs only.
