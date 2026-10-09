---

description: "Task list for Agent Colony Pane"
---

# Tasks: Agent Colony Pane

**Input**: Design documents from `/specs/001-agent-colony-pane/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. plan.md specifies unit tests (`claude plugin test`) for the pure model, mapping, layout and sprite code. Engine glue is verified by the quickstart scenarios.

**Organization**: Grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 from spec.md
- The mod folder is the repository root. Engine type declarations are in `.claude-plugin/types/` once the engine has loaded the mod; before that, in the plugin-authoring skill's `types/claude-code.d.ts`.

---

## Phase 1: Setup

**Purpose**: Plugin skeleton that loads and validates

- [X] T001 Create `.claude-plugin/plugin.json` with `{ "name": "colony", "version": "0.1.0", "description": "Side pane showing agents as pixel creatures", "types": "./types/index.d.ts" }` plus `userConfig` fields `reducedMotion` (boolean, default false) and `retentionSeconds` (number, default 30) per contracts/user-surface.md
- [X] T002 Create `hooks/hooks.json` with `{ "modules": ["./register.tsx"] }`
- [X] T003 [P] Create `types/index.d.ts` declaring `interface PluginState` entry `colony` with the `Colony` shape from data-model.md (agents, exchanges, tick, retentionMs) and the exported types `Agent`, `AgentState`, `Exchange`, `Colony`
- [X] T004 [P] Create `tsconfig.json` extending `.claude-plugin/types/tsconfig.json` and covering `hooks`, `src`, `types`, `tests`
- [X] T005a Create `.claude-plugin/marketplace.json` per contracts/user-surface.md (marketplace name `colony-mod`, one plugin `colony` with `"source": "./"`; plugin name MUST match `.claude-plugin/plugin.json`) so the repository is installable from GitHub (FR-019)
- [X] T005 Create a minimal `hooks/register.tsx` exporting `register: Register` that only registers the `/colony` command; run `claude plugin validate .` and confirm it loads with `claude --plugin-dir .`

---

## Phase 2: Foundational (blocking)

**Purpose**: Pure model, state precedence and state storage shared by all stories

**⚠️ CRITICAL**: No user story work begins until this phase is complete

- [X] T006 [P] Implement `src/priority.ts`: `resolveState(candidates: AgentState[]): AgentState` using precedence `pending > listening > in-progress > failed/cancelled > completed > idle > unknown` (FR-013)
- [X] T007 Write `tests/priority.test.ts` covering every pairwise precedence, with pending beating all states (write after T006; fails until it lands)
- [X] T008 Implement `src/model.ts`: types from data-model.md and a pure `reduce(colony, signal): Colony` handling signals `agent-added`, `agent-state`, `agent-ended`, `exchange-open`, `exchange-close`, `tick`, `reconcile`; includes retention expiry using `retentionMs` (FR-015) and `unknown` for agents silent 60 s with no list status (FR-018)
- [X] T009 Write `tests/model.test.ts`: lifecycle transitions from data-model.md, retention removal, unknown fallback, idempotent repeated signals (write after T008)
- [X] T010 Add the colony atom in `hooks/register.tsx` using `atom({ plugin: 'colony', key: 'colony' } as const, initialColony)` with a helper `dispatch($, signal)` that calls `update($, colonyAtom, c => reduce(c, signal))`
- [X] T011 Add an observer wrapper helper in `src/observe.ts`: `observe(handler)` returns a hook that runs `handler` in try/catch and ALWAYS returns `next(e)` unchanged, even on error (FR-016)

**Checkpoint**: Model compiles, tests pass, observer wrapper exists.

---

## Phase 3: User Story 1 - See every agent and its state at a glance (Priority: P1) 🎯 MVP

**Goal**: A pane showing one pixel figure per agent, with distinct idle / pending / in-progress / completed looks.

**Independent Test**: quickstart scenarios 1 and 3. One agent goes idle → working → pending → completed and the figure changes each time.

### Tests for User Story 1

- [X] T012 [P] [US1] Write `tests/signals.test.ts` for the US1 rows of contracts/event-mapping.md: `session.start`, `turn.start`, `turn.complete`, `tool.call` (with and without `agentId`), `classic.PermissionRequest`, `classic.Elicitation`, `classic.ElicitationResult`, `classic.Notification` (permission and idle prompt types), `prompt.submit` map to the expected signals
- [X] T013 [P] [US1] Write `tests/sprites.test.ts`: every `AgentState` has a sprite; no two states share identical first frames; each state differs from every other when colour is ignored (FR-004, SC-007); grids are rectangular

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement `src/sprites.ts`: original pixel grids (`#`/`.` rows) for idle, in-progress, pending, completed, unknown, with 2 frames where animated, and `renderSprite(grid, frame)` converting row pairs to half-block characters `▀ ▄ █` per contracts/pane-render.md
- [X] T015 [US1] Implement `src/signals.ts` US1 mappings: pure `toSignals(eventName, e): Signal[]` per contracts/event-mapping.md, including pending attribution (use `e.agentId` when present, else most recently active agent, else `main`) and pending clearing on the next tool result, `ElicitationResult` or `prompt.submit`
- [X] T016 [US1] Implement `src/layout.ts` base layout: main figure on top, other agents in a grid beneath, labels truncated with `…` to the figure width (FR-005), returns a `Scene` as defined in data-model.md
- [X] T017 [US1] Implement `src/view.tsx`: `renderPane(scene, { Box, Text })` drawing figures, labels and the empty-state line
- [X] T018 [US1] Wire `hooks/register.tsx`: on `session.start` create `main` (the pane itself opens on the first pending or first subagent, or via `/colony`); observe `turn.start`, `turn.complete`, `tool.call`, `classic.PermissionRequest`, `classic.Elicitation`, `classic.ElicitationResult`, `classic.Notification`, `prompt.submit` via the `observe` wrapper and `toSignals`; add `ui.render` hook for `{ component: 'Pane', requestId: 'colony' }` that reads the atom and returns `renderPane(layout(...))`
- [X] T019 [US1] Add the animation clock in `hooks/register.tsx`: `$.clock.every(250, …)` dispatching `tick` only while some figure animates; honour `reducedMotion` by never starting it (FR-017)
- [X] T020 [US1] Implement the `/colony` toggle via `command.run` in `hooks/register.tsx` and the `$.store` flag `isHiddenByUser` (FR-001); auto-open the pane the first time any agent becomes pending unless `isHiddenByUser`; add a narrow-terminal fallback: when `$.ui.open` returns `isPlaced: false`, call `$.ui.status` with a summary such as `colony: 2 working, 1 needs you`
- [ ] T021 [US1] Run `claude plugin validate .`, `tsc -p .`, `claude plugin test .`, then walk quickstart scenarios 1 and 3 and fix issues

**Checkpoint**: US1 is a working MVP.

---

## Phase 4: User Story 2 - Subagents and how agents collaborate (Priority: P2)

**Goal**: Subagents appear grouped under their parent; communicating agents move closer and exchange 0s and 1s.

**Independent Test**: quickstart scenario 2. Two subagents appear, show the exchange animation while spawning, waiting and returning, then drift apart.

### Tests for User Story 2

- [X] T022 [P] [US2] Extend `tests/signals.test.ts` with `agent.spawn`, `classic.SubagentStart`, `classic.SubagentStop` (success, failed, killed) and `session.send` (with and without `agentId`) and `classic.TeammateIdle` per the exchange definition in the spec Clarifications
- [X] T023 [P] [US2] Write `tests/layout.test.ts`: children placed under their parent with connector; exchange pairs get a smaller horizontal gap; gap restored after exchange ends; 25 agents produce no overlapping positions (SC-005); pending figures are never collapsed; two simultaneous exchanges between different agent pairs get separate streams that never overlap, and ending one leaves the other intact
- [X] T024 [P] [US2] Write `tests/particles.test.ts`: the 0/1 stream string has the requested width, alternates deterministically per tick and shifts by one glyph per tick

### Implementation for User Story 2

- [X] T025 [P] [US2] Implement `src/particles.ts`: `stream(width, tick): string` of dim `0`/`1` glyphs scrolling between two figures
- [X] T026 [US2] Extend `src/signals.ts` with the US2 rows: spawn/start add an agent with `parentId` and open exchange reasons `spawn` and `waiting`; stop closes `waiting`, adds a `result` burst and sets completed/failed/cancelled; `session.send` opens a `message` burst between sender (`agentId` or `main`) and `to`
- [X] T027 [US2] Extend `src/layout.ts`: grouping with parent connector, proximity shift of up to 2 columns for active exchanges with easing back, overflow row `+N done` collapsing oldest completed figures past capacity (FR-014), one-line summary for tiny viewports
- [X] T028 [US2] Extend `src/view.tsx` to draw the connector, the stream between exchanging figures and the overflow row
- [X] T029 [US2] Add failed and cancelled sprites to `src/sprites.ts` (cracked/fallen figure with `x` eyes) and extend `tests/sprites.test.ts` accordingly (FR-012)
- [X] T030 [US2] Wire `hooks/register.tsx`: observe `agent.spawn`, `classic.SubagentStart`, `classic.SubagentStop`, `classic.TeammateIdle`, `session.send`; seed and reconcile from `$.agent.list()` on `session.start`, on `turn.complete` and when the pane opens (its `status` wins); auto-open the pane the first time a subagent appears unless `isHiddenByUser` (the first-pending auto-open is in T020)
- [ ] T031 [US2] Run validate, type-check and tests, then walk quickstart scenarios 2, 3 and 5 (cancel, 25+ subagents, narrow pane, grayscale) and fix issues

**Checkpoint**: US1 and US2 work together.

---

## Phase 5: User Story 3 - Agents listening for external events (Priority: P3)

**Goal**: Idle agents with a registered external trigger show a listening look labelled with the source; arriving events produce a reaction before the agent starts working.

**Independent Test**: quickstart scenario 4.

### Tests for User Story 3

- [X] T032 [P] [US3] Extend `tests/signals.test.ts`: `Monitor` or `RemoteTrigger` tool calls on an idle agent produce a listening registration (source `watch` or `webhook`); `ScheduleWakeup` and `CronCreate` do NOT; `session.receive` with `event.source = 'github'` produces a reaction signal for a listener with that source; a source-less event yields label `external`; an agent merely waiting on its own timer or background task is NOT marked listening
- [X] T033 [P] [US3] Extend `tests/model.test.ts`: listening → reaction flash → in-progress; pending outranks listening (FR-013)

### Implementation for User Story 3

- [X] T034 [P] [US3] Add the listening sprite (antenna or ear extended) with pulse frames and a reaction frame to `src/sprites.ts`; extend `tests/sprites.test.ts`
- [X] T035 [US3] Extend `src/signals.ts` with the listening rows of contracts/event-mapping.md, including source labelling and the `external` fallback; extend `src/model.ts` with `listenSource` handling and the reaction flash (short timed marker consumed by `tick`)
- [X] T036 [US3] Extend `src/view.tsx` to show the `[source]` tag under listening figures and the reaction frame (FR-010, FR-011)
- [X] T037 [US3] Wire `hooks/register.tsx`: observe `session.receive` (using `e.event?.source` and `e.agentId`) and scheduling/monitor tool calls inside the existing `tool.call` observer
- [ ] T038 [US3] Run validate, type-check and tests, then walk quickstart scenario 4 and fix issues

**Checkpoint**: All three stories work independently and together.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T039 [P] Verify reduced motion: with `reducedMotion` true no timer runs and every state is still distinguishable in static frames (FR-017, SC-007); add a test in `tests/sprites.test.ts` for static frames
- [X] T040 [P] Write `README.md` at the repository root (FR-019): what the mod shows (with a text mock of each state), a state legend, an Install section with the code block `/plugin install colony --marketplace <owner>/<repo>` and the steps that follow (answer `y` to add the marketplace, pick a scope, set options), a Try-without-installing section (`git clone` then `claude --plugin-dir <folder>`), Update and Uninstall steps, the `/colony` command and options, requirements (terminal install command; 144-column pane width), Troubleshooting for `Marketplace file not found at` and `Plugin "colony" not found in marketplace`, and the known limits from research.md R3 and R5
- [X] T040a [P] Add a `LICENSE` file (ask the author which license to use before writing it) and verify the existing root `.gitignore` ignores `.claude-plugin/types/`, `node_modules/`, `dist/`, `*.tsbuildinfo`, editor/OS files, `.env*` and `.claude/settings.local.json`; `.specify/` and `specs/` stay committed
- [X] T040b Write `docs/PUBLISHING.md` for the author: create the public GitHub repository, push, tag a release, replace `<owner>/<repo>` placeholders in README, and bump `version` in `.claude-plugin/plugin.json` for each update
- [X] T041 Verify FR-016 read-only: add a test in `tests/observe.test.ts` that every observer returns the exact `next(e)` result and still does so when its handler throws
- [ ] T042 Confirm performance (SC-002, SC-006): with 25 agents, state changes appear in the pane within 1 s and the tick timer stops when nothing animates; record the result in `specs/001-agent-colony-pane/quickstart.md`
- [ ] T042a Run `claude plugin validate .` (checks marketplace file, manifest and hooks module together) and walk the "Sharing check" in quickstart.md from a clean session using only the README; record the elapsed time against SC-008
- [ ] T043 Run the full quickstart (all six scenarios) and update the spec Assumptions with the final listening limits discovered in research R5

---

## Dependencies & Execution Order

- Setup (Phase 1) → Foundational (Phase 2) → User stories → Polish.
- US1 has no story dependencies and is the MVP.
- US2 builds on US1's figures, layout and view (extends the same files); start after T021.
- US3 builds on the model and signals; it can start after Phase 2 for tests and sprites, but its wiring (T037) needs the register file from US1.
- Within a story: tests, then sprites/mapping/layout, then view, then wiring, then verification.

### Parallel Opportunities

- Phase 1: T003 and T004.
- Phase 2: T006/T007, T009 alongside T008's tests once types exist.
- US1: T012, T013, T014 together.
- US2: T022, T023, T024, T025 together.
- US3: T032, T033, T034 together.
- Polish: T039 and T040.

### Parallel Example: User Story 1

```text
Task: "Write tests/signals.test.ts for US1 event mappings"      (T012)
Task: "Write tests/sprites.test.ts state distinctness"          (T013)
Task: "Implement src/sprites.ts pixel grids"                    (T014)
```

## Implementation Strategy

- **MVP**: Phases 1–3 (through T021): the pane with the five core looks and live state.
- **Increment 2**: Phase 4 adds subagent grouping and exchange animation.
- **Increment 3**: Phase 5 adds listening.
- Stop and demo at each checkpoint using the matching quickstart scenarios.
