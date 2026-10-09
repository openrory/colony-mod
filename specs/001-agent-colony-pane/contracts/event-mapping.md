# Contract: engine event → colony change

All hooks are observers: they call `next(e)` with `e` unchanged (FR-016).

| Engine event | Colony change |
|---|---|
| `session.start` | create `main` (idle); register `/colony`; seed from `$.agent.list()` |
| `turn.start` / `turn.complete` | main → in-progress / completed then idle |
| `agent.spawn`, `classic.SubagentStart` | add agent (parent = spawner, default main); open exchange `spawn` (burst) + `waiting` |
| `classic.SubagentStop` | agent → completed / failed / cancelled by status; exchange `result` burst; drop `waiting` |
| `tool.call` (any, with optional `agentId`) | that agent → in-progress; clears its pending; scheduling/monitor tools mark listening registration |
| `classic.PermissionRequest`, `classic.Elicitation`, `classic.Notification` (prompt types) | attributed agent → pending |
| `classic.ElicitationResult`, `prompt.submit`, next tool result | clear pending |
| `session.send` | open exchange `message` between sender (`agentId` or main) and `to` for a short burst |
| `session.receive` with `event.source` | listening agent for that source → reaction flash → in-progress; otherwise label `external` |
| `classic.TeammateIdle` | teammate → idle |
| clock tick | advance `tick`; expire bursts; remove agents past retention |

Reconciliation: on every `turn.complete` and on pane open, compare with `$.agent.list()`; its `status` wins over inferred state; agents it does not list and that have no events for 60 s become `unknown`.
