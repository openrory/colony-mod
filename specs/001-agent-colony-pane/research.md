# Research: Agent Colony Pane

Source: the mods plugin-authoring reference and the engine's `claude-code.d.ts` for this build (API is early-access and may move; regenerate rather than edit). Online docs page was not fetched; findings come from the local declarations.

## R1. Delivery vehicle

- **Decision**: a function-hooks plugin (`.claude-plugin/plugin.json` + `hooks/hooks.json` + a TSX module exporting `register`).
- **Rationale**: the only supported way to draw a pane (`$.ui.open` + a `ui.render` hook on `{ component: 'Pane', requestId }`).
- **Alternatives**: classic shell-command hooks plus an external TUI (no access to the in-session pane, needs IPC); rejected.

## R2. Detecting agents and their lifecycle

- **Decision**: seed from `$.agent.list()` (id, type, description, `status`: pending/running/waiting/idle/completed/failed/killed, parent id) and keep current from `classic.SubagentStart` / `classic.SubagentStop` and `agent.spawn`. Tool calls carry `agentId` (absent = main loop), giving per-agent activity.
- **Rationale**: `AgentInfo.status` maps almost one-to-one to the spec's states and includes failed/killed (FR-012); parent id gives grouping (FR-007).
- **Alternatives**: parsing the transcript; rejected as fragile.

## R3. Detecting "pending" (needs the user)

- **Decision**: pending begins on `classic.PermissionRequest`, `classic.Elicitation`, `classic.Notification` of a permission/idle-prompt type, and a `tool.call` of the question tool; it ends on the matching tool result, `classic.ElicitationResult`, a `prompt.submit`, or the next event from that agent.
- **Open risk**: whether permission events identify the requesting subagent. Fallback: attribute to the agent with the most recent running tool call, else to main. Verify in quickstart scenario 3.

## R4. Detecting exchanges (spec clarification Q1)

- **Decision**: an exchange opens on `agent.spawn`/`SubagentStart` (parent↔child), on `session.send` (sender `agentId` → `to`), and stays open while a parent has a running child; it gets a result burst on `SubagentStop`. Closes when the last of those ends.
- **Rationale**: matches the clarified definition exactly using only observable events.

## R5. Detecting "listening" (spec clarification Q2)

- **Decision**: three signals. (a) Observed registrations: `tool.call` of `Monitor` or `RemoteTrigger` on an otherwise idle agent marks it listening with source `watch`/`webhook`. `ScheduleWakeup` and `CronCreate` are the agent's own timers and do NOT count. (b) Configured hooks/triggers are not enumerable by the API, so none are guessed. (c) Inbound `session.receive` with `event.source` (e.g. `github`) labels the source and triggers the reaction animation (FR-011); unknown source labelled `external`.
- **Limit**: an agent can only be shown as listening for triggers the mod has seen registered or fire during the session. Documented in the spec Assumptions on implementation.
- **Alternatives**: poll `background_tasks` summaries on `classic.SubagentStop` as a cross-check; kept as an optional reconcile step.

## R6. Drawing pixel art

- **Decision**: sprites as small bit grids rendered with Unicode half-blocks (`▀ ▄ █`) so two pixel rows fit in one text row, coloured via Text colour props; shape and pose (not colour) encode state (FR-004). 0/1 stream = a row of dim `0`/`1` glyphs between two figures, shifted per tick.
- **Alternatives**: image/canvas elements (not available in the terminal element table); sixel (not portable).

## R7. Animation and redraw

- **Decision**: `$.clock.every(250, …)` updates a `tick` atom only while something animates; atoms redraw the readers. Reduced-motion option freezes to a static frame and stops the timer (FR-017).

## R8. Opening the pane

- **Decision**: `$.ui.open({ id: 'colony', title: 'Colony' })` on first subagent or first pending, unless `$.store` says the user hid it; a `/colony` command toggles. `UiOpenResult.isPlaced` can be false below 144 columns when opened unasked, so the mod mirrors the most urgent state into `$.ui.status` and a toast as fallback.
- **Rationale**: honours FR-001 and the clarification while respecting platform width rules.

## R9. Staying read-only

- **Decision**: every observer hook calls `next(e)` with the unmodified event and is wrapped so a thrown error still passes through (`.catch` calling `next`). No `deny`, no rewrites (FR-016).

## R10. Testing

- **Decision**: keep reducer, mapping, layout and sprite code pure and unit-tested with `claude plugin test`; engine glue verified by the quickstart scenarios.

## R11. Sharing via GitHub

- **Decision**: the repository root is both the plugin and a one-plugin marketplace. `.claude-plugin/marketplace.json` lists `{ "name": "colony", "source": "./" }`; others install with `/plugin install colony --marketplace <owner>/<repo>`, answer `y` to add the marketplace, pick a scope (user scope keeps it for later sessions), and set the `userConfig` options on the screen that follows. The install takes effect in the running session without a reload.
- **Rationale**: this is the platform's own sharing path (plugin-authoring reference, "Sharing a mod"); it needs one extra file and a README.
- **Notes**: the install command runs at a terminal session's prompt, not in the desktop app's Code tab. The mod's pane still draws for the desktop surface once installed from a terminal at user scope. `claude plugin validate .` checks the marketplace file, manifest and hooks module together. Common failures to document: `Marketplace file not found at …` (wrong repo or missing file) and `Plugin "colony" not found in marketplace …` (name mismatch between `plugin.json` and `marketplace.json`).
