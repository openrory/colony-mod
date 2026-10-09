# Feature Specification: Agent Details and Other-Session Figures

**Feature Branch**: `003-agent-details-and-peers`

**Created**: 2026-10-09

**Status**: Implemented, documented after the fact. The behaviour below was added by the author after the first release (spec 001) and is described here from the code and its tests (`src/tiers.ts`, `src/context.ts`, `src/peers.ts`, `tests/tiers.test.ts`, `tests/peers.test.ts`). Where something could not be confirmed from them it is listed under Assumptions.

**Depends on**: [001-agent-colony-pane](../001-agent-colony-pane/spec.md)

**Input**: User description: "I tested it and made some fixes" (the author's additions: figures sized by model, a context-fill shade, a details card per agent, and other sessions shown as single figures)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what each agent is and what it has used (Priority: P1)

The user rests the pointer on any figure and sees a card with that agent's full title, its state in plain words (asleep, working, needs you, listening, done, failed, cancelled, unknown), the model it runs on and that model's family, the tokens it has used so far (input and output, plus cache reads), roughly how full its context window is, who started it, and whether it can be reused (sent more work later). When an agent has not reported usage yet, the card says so instead of showing zeros.

**Why this priority**: It answers the questions the figure alone cannot: which model is this, and is it burning tokens or running out of room.

**Independent Test**: Run a task with a subagent, rest the pointer on its figure and on the main agent's, and confirm each card shows the lines above, with "tokens not reported yet" before any usage exists.

**Acceptance Scenarios**:

1. **Given** an agent has reported usage, **When** the user views its card, **Then** it shows tokens in and out, and cache reads when there are any.
2. **Given** an agent has not reported usage, **When** the user views its card, **Then** it says "tokens not reported yet".
3. **Given** a subagent was started by another agent, **When** the user views its card, **Then** it names the starter; **given** it is independent of any agent here, **Then** it says it was not started by an agent here.
4. **Given** an agent can be sent further work, **When** the user views its card, **Then** it says "reusable".
5. **Given** the agent's model is unknown, **When** the user views its card, **Then** it says "model unknown" rather than guessing.

---

### User Story 2 - Tell the model and the context pressure at a glance (Priority: P2)

Without opening a card, the user can see two things on the figure itself: bigger models are drawn as bigger figures (four sizes, one per model family, smallest to largest), and a darker shade rises from the figure's feet as the agent's context window fills, so an agent close to full stands out.

**Why this priority**: A glance at the colony shows which agents are the expensive ones and which are about to run out of room, with no hovering.

**Independent Test**: Run subagents on two different model families and confirm their figures differ in size; feed one a long conversation and confirm its shading rises.

**Acceptance Scenarios**:

1. **Given** agents on the four model families, **When** the pane is drawn, **Then** each figure's size grows with its family (smallest for the smallest model), and an agent with an unknown model is drawn at the base size.
2. **Given** an agent's context is about half full, **When** the pane is drawn, **Then** about half the figure's height is shaded; **given** it is over full, **Then** the shading is clamped to full.
3. **Given** nothing is known about an agent's context yet, **When** the pane is drawn, **Then** no shading is shown.

---

### User Story 3 - See my other sessions (Priority: P3)

The user can point the mod at the folder where Claude Code keeps its session files. Each other running session then appears as one figure, labelled with the session's name, showing whether it is busy or idle, with a card saying where it is and when it last updated. Other sessions never open the pane by themselves, never count in the status-line summary, and are never removed just for being quiet. With the setting left empty, no other session is read at all.

**Why this priority**: A lightweight way to notice that another session is busy, without any agent detail. Spec 002 builds a richer view of other sessions on top of this and keeps this one as its fallback.

**Independent Test**: Set the sessions folder, start a second session, and confirm it appears as one figure that changes between busy and idle; leave the setting empty and confirm nothing about other sessions appears.

**Acceptance Scenarios**:

1. **Given** a session file with a name, a status and a recent update, **When** the pane polls the folder, **Then** that session appears as one figure with its name, a busy or idle state, and a card note naming its folder and how long ago it updated.
2. **Given** the file belongs to the current session, is older than six hours, or is unreadable, **When** the pane polls, **Then** it is not shown.
3. **Given** another session becomes busy, **When** the pane polls, **Then** the pane does not open and the status-line summary does not change.
4. **Given** the sessions folder setting is empty, **When** the mod runs, **Then** it reads no session files.

---

### Edge Cases

- A model id the mod does not recognise (a new family, a custom alias): shown at the base size, with its raw id on the card.
- A context window larger than the default (1M-token models): the card marks the percentage as approximate and names the window assumed.
- Very long agent titles: the card wraps them; the label under the figure still truncates.
- Two sessions with the same name: both are shown; the card's folder note tells them apart.
- Session files that are half-written or not JSON: ignored without an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Resting the pointer on a figure MUST show a card with the agent's full title, its state in words, its model (with the family when recognised, or "model unknown"), and its token usage (or "tokens not reported yet").
- **FR-002**: The card MUST show cache reads when non-zero, an approximate context-fill percentage with the window assumed when context is known, who started the agent (or that it was not started by an agent here), and "reusable" when the agent can be sent further work.
- **FR-003**: A figure's size MUST depend on its model family, in four steps from the smallest model to the largest; an unknown model MUST be drawn at the smallest size.
- **FR-004**: A figure MUST show a shade rising from its feet in proportion to how full the agent's context window is, clamped between empty and full, and none while the fill is unknown.
- **FR-005**: The mod MUST estimate an agent's context size from its conversation when the engine does not report it, and the card MUST mark the percentage as approximate.
- **FR-006**: The context window MUST be assumed to be 1M tokens for models whose id says so or that are in the current top generation, and 200k tokens otherwise.
- **FR-007**: When a sessions folder is set, each other running session MUST appear as one figure labelled with its name, with state busy (in progress), idle, or unknown, and a card note naming its folder and its last update.
- **FR-008**: Other sessions MUST NOT open the pane, MUST NOT count in the status-line summary, and MUST NOT be removed by the silence rule that applies to agents.
- **FR-009**: The current session, sessions not updated for six hours, and unusable files MUST NOT be shown.
- **FR-010**: With the sessions folder empty (the default) the mod MUST NOT read any session file.

### Key Entities

- **Agent details**: Per agent, in addition to spec 001's fields: model, token usage (input, output, cache read, cache write), estimated context size, who started it, whether it is independent, whether it is reusable, and a free-text note.
- **Model family**: One of four steps (smallest to largest) derived from a model id or alias; each has a figure size.
- **Peer session**: Another running session read from the sessions folder: name, folder, last-updated time, busy or idle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a usability check, at least 90% of users can say which of two figures runs on the larger model from the pane alone.
- **SC-002**: A user can find a given agent's model and token usage in under 5 seconds by resting the pointer on its figure.
- **SC-003**: In a usability check, at least 90% of users can pick out the agent whose context is nearly full among five without opening any card.
- **SC-004**: With the sessions folder empty, no file outside the plugin's own is read (verifiable by an automated check).
- **SC-005**: Opening the card or drawing sizes and shading adds no noticeable slowdown, as reported by users in testing.

## Assumptions

- The card appears when the pointer rests on a figure in a terminal that reports pointer movement; how it behaves in terminals that do not was not confirmed.
- Usage numbers come from the engine's end-of-turn reports; an agent that has not finished a turn has none yet.
- Context size is an estimate (about 3.5 characters per token) because the engine does not report a running subagent's window; the percentage is therefore approximate by design.
- The four model families are the current ones (smallest to largest: haiku, sonnet, opus, fable); new families fall back to the smallest size until added.
- Session files are the ones Claude Code keeps on the same machine; their format is not a public interface and may change.
- The sessions folder setting is the existing `sessionsDirectory` option (default empty).
- Spec 002 (all-sessions pane) supersedes this feature's peer view for sessions that share; this view remains for sessions that do not.
