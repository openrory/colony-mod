# Implementation Plan: Agent Colony Pane

**Branch**: `001-agent-colony-pane` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-agent-colony-pane/spec.md`

## Summary

A Claude Code mod (function-hooks plugin) that opens a side pane drawing every agent in the session as a small pixel-art creature. The mod observes engine events (subagent start/stop, tool calls tagged with `agentId`, permission/notification/elicitation events, agent-to-agent `session.send`, inbound `session.receive` deliveries) and folds them into one in-memory colony model. A pure layout/animation step turns the model into a sprite scene; a `ui.render` hook on the pane draws it. A clock tick drives animation; state is held in `$.state` atoms so the pane redraws on every change. The mod is read-only: its hooks always pass through `next(e)` unchanged. See [research.md](research.md) for the platform findings behind each choice.

## Technical Context

**Language/Version**: TypeScript (ES modules, JSX via global `h`), as required by the mods runtime

**Primary Dependencies**: none beyond the `claude-code` types module (no DOM, no Node in the runtime)

**Storage**: session `$.state` atoms for the colony; `$.store` for the user's pane preferences (reduced motion, hidden-by-user flag). No files.

**Testing**: `claude plugin test` (`*.test.ts`) for the pure model, layout and sprite code; `claude plugin validate` and `tsc -p` for contract/type checks; manual scenarios in [quickstart.md](quickstart.md)

**Target Platform**: Claude Code terminal surface (pane seats at 144+ columns unasked, 110+ if the user opened it). Desktop/VS Code surfaces are best-effort via the same element table.

**Project Type**: Claude Code mod (single plugin folder)

**Performance Goals**: state change visible in the pane ≤ 1 s (SC-002); animation tick ≈ 4 fps; hooks add negligible latency (no awaits on the critical path other than atom updates)

**Constraints**: hooks must never alter tool calls, prompts or permissions (FR-016); a failing hook must not block the session (every observer hook passes through even on error); pane size is whatever the surface grants

**Distribution**: public GitHub repository that is itself a plugin marketplace (`.claude-plugin/marketplace.json` beside `plugin.json`), installed with `/plugin install colony --marketplace <owner>/<repo>`

**Scale/Scope**: ≥ 25 simultaneous agents legible (SC-005); about 8 sprite states; one pane

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template, so it defines no gates. Self-imposed principles used instead: (1) observe-only, (2) pure core logic with tests, (3) no feature beyond the spec. Status: PASS before and after Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-colony-pane/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── event-mapping.md      # engine event -> colony model change
│   ├── pane-render.md        # what the pane draws, per state
│   └── user-surface.md       # slash command, options, status line
└── tasks.md                  # created by /speckit-tasks
```

### Source Code (repository root)

```text
.claude-plugin/
├── plugin.json               # name, version, userConfig, types
└── marketplace.json          # makes the repository installable from GitHub
hooks/
├── hooks.json                # { "modules": ["./register.tsx"] }
└── register.tsx              # wires events -> model, ui.render -> view, clock tick
src/
├── model.ts                  # Agent, Exchange, Colony; pure reducer(colony, signal)
├── signals.ts                # engine event -> Signal (pure mapping, per contracts/event-mapping.md)
├── priority.ts               # state precedence (pending > listening > in-progress ...)
├── layout.ts                 # positions, grouping, compaction, exchange proximity
├── sprites.ts                # pixel grids per state + frames (half-block rendering)
├── view.tsx                  # Colony + viewport + tick -> element tree
└── particles.ts              # 0/1 stream between two figures
types/
└── index.d.ts                # PluginState contract for the colony atoms
README.md                     # install / update / uninstall / usage / legend / limits
LICENSE                       # chosen by the author before publishing
docs/
└── PUBLISHING.md             # author's steps to publish on GitHub
tests/
├── model.test.ts
├── signals.test.ts
├── layout.test.ts
└── sprites.test.ts
```

**Structure Decision**: single plugin folder at the repository root, loaded with `--plugin-dir`. Logic lives in pure `src/` modules so it is testable without the engine; `hooks/register.tsx` is thin glue.

## Complexity Tracking

No constitution violations to justify.
