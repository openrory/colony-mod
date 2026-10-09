# Quickstart: validating the Agent Colony Pane

## Prerequisites
- Claude Code build with mods support; terminal at least 144 columns wide (or open the pane yourself with `/colony`).
- Repo checked out; mod folder is the repository root.

## Static checks
1. `claude plugin validate .` reports the hooks it uses and no refusals.
2. `tsc -p .` passes.
3. `claude plugin test .` passes (model, mapping, layout, sprites).

## Run
`claude --plugin-dir .` then `/colony` (see [contracts/user-surface.md](contracts/user-surface.md)).

## Scenarios (map to spec stories)
1. **States at a glance (US1)**: fresh session → main agent sleeping. Ask for a task → working animation. Trigger a command needing approval → pending pose; approve → back to working; finish → completed pose, then idle.
2. **Subagents and exchange (US2)**: ask for two parallel subagent tasks. Two figures appear grouped under main; 0/1 stream and proximity during spawn, while waiting, and at result; they drift apart afterward. Pane auto-opens on first subagent and stays closed once you hide it.
3. **Pending attribution (US1)**: make a subagent request a permission; confirm the right figure shows pending (see research R3 risk).
4. **Listening (US3)**: start a monitor or watcher → listening pose labelled `watch` (a scheduled wake-up must NOT show listening). Deliver an inbound event if available (e.g. GitHub subscription) → reaction flash then working.
5. **Failure and edge cases**: cancel a subagent → distinct cancelled look. Spawn 25+ subagents → no overlap, overflow row. Narrow pane → labels truncate. Option reduced motion on → static, still distinguishable; check grayscale terminal theme.
6. **Read-only (FR-016)**: with the mod loaded, tool permissions and outputs are identical to a run without it.

## Sharing check (FR-019, SC-008)
1. `claude plugin validate .` passes with `.claude-plugin/marketplace.json` present.
2. Push the repository to GitHub (public).
3. In a clean Claude Code session (or another machine), run `/plugin install colony --marketplace <owner>/<repo>` exactly as the README states, answer `y`, pick user scope.
4. Confirm: `Installed colony. Plugin is now active.`, `/colony` opens the pane, and the options screen appeared.
5. Time the walk from the README alone; it must take under 5 minutes.
6. Follow the README's uninstall steps and confirm the pane no longer opens.
