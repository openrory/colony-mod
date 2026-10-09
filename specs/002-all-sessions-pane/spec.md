# Feature Specification: All-Sessions Pane

**Feature Branch**: `002-all-sessions-pane`

**Created**: 2026-10-09

**Status**: Draft

**Depends on**: [001-agent-colony-pane](../001-agent-colony-pane/spec.md) (figures, states, exchanges, the side pane)

**Input**: User description: "so there's no way to have a single pane of glass for all my agents and subagents? ... Each session writes its own colony state, and the pane in any session reads all of them"

## Clarifications

### Session 2026-10-09

- Q: How should one pane show agents from all of the user's running sessions? → A: Each session shares its own agents' state, and any pane combines what every session shares (opt-in, same user and machine only); sessions that do not share are still shown as a single figure.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One pane for all my sessions (Priority: P1)

A user often runs several Claude Code sessions at once, each with its own agents and subagents. They want to open the pane in any one session and see every session's agents together: each session as a group, with its own agents, states and exchanges, so they can tell at a glance which session needs their answer and what is going on everywhere. Each session shares only a summary of its own agents' state; nothing is shared unless the user turns sharing on.

**Why this priority**: It turns the pane from a per-session view into a single overview of all of the user's agent work. It builds on the single-session pane (spec 001) and is only valuable to people running more than one session.

**Independent Test**: Run two sessions with sharing turned on, give each a task that starts subagents, and confirm the pane in either session shows both sessions' agents with correct states, including a pending state raised in the other session and an exchange between that session's agents.

**Acceptance Scenarios**:

1. **Given** two sessions both have sharing on, **When** the user opens the pane in session A, **Then** session B appears as a group with its own agents and subagents next to session A's.
2. **Given** an agent in session B needs the user's answer, **When** the user looks at the pane in session A, **Then** that agent shows the pending appearance and its session group is marked as needing attention.
3. **Given** two agents in session B are exchanging information, **When** the user looks at the pane in session A, **Then** the same move-closer and 0s-and-1s exchange is shown for them.
4. **Given** session B ends or stops responding, **When** a short time has passed, **Then** its group first shows as stale and then disappears from the pane in session A.
5. **Given** sharing is off in a session, **When** the user looks at the pane in another session, **Then** that session's agents and subagents are not shown (a session may still appear as a single figure if the user has chosen to show other sessions).
6. **Given** a session has not shared (for example the mod is not installed there), **When** the pane shows it as a single figure, **Then** the figure is clearly marked as less detailed and its state is shown as unknown rather than guessed.

---

### Edge Cases

- Two sessions in the same folder or with the same name: each is shown separately and labelled so they can be told apart.
- A session that crashes without cleaning up: its group is marked stale and then removed after a short time.
- Sessions running different versions of the mod, or whose summary cannot be read: the summary is ignored; if the session is also known from the sessions folder (spec 003) it is shown as a single limited figure, otherwise it is not shown. Never an error or a blank pane.
- Many sessions at once (e.g. 10): the pane stays readable, collapsing quiet sessions before groups that need attention.
- The user turns sharing off or on while sessions are running: the change takes effect without restarting sessions (changing the option reloads the mod), and turning it off replaces the session's shared summary with an ended marker that contains no name, folder or agent information.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mod MUST let the pane show agents from all of the user's other running sessions on the same machine, each session as its own labelled group containing that session's agents and subagents with their states.
- **FR-002**: Sharing MUST be opt-in and off by default. While it is off, a session MUST NOT make its agents' state visible to other sessions and MUST NOT read other sessions' shared state.
- **FR-003**: A session MUST share only a summary of its own agents' state (session name and folder, and for each agent: label, state, parent, model, token totals and listening source, plus current exchanges) and MUST NOT share conversation content, prompts, tool inputs or outputs, or file contents.
- **FR-004**: Other sessions' agents MUST appear with the same states, looks and exchange animation as local agents (spec 001: FR-003, FR-004, FR-008), updating within 3 seconds of a change in the originating session.
- **FR-005**: A session group MUST be marked as stale when its session has not updated for a short period, and MUST be removed when the session has ended or has stayed stale beyond a longer period.
- **FR-006**: A pending agent in any session MUST make its session group visibly marked as needing attention, even when the group is collapsed.
- **FR-007**: A session that does not share MUST still be shown, if the user has set the other-sessions folder (spec 003), as a single clearly marked figure with an unknown or limited state, never as invented detail.
- **FR-008**: The pane MUST ignore any shared summary it cannot read or that comes from an unsupported version, without failing, and the README MUST describe what is shared and how to turn sharing off.
- **FR-009**: A pending agent in a session that shares MUST also be counted in the status-line summary and trigger the pending toast. Sessions shown only as single limited figures (spec 003) still do not count.

### Key Entities

- **Session**: A running Claude Code session of the user. Attributes: identity, display name, folder, last-updated time, whether it shares, and its group of agents.
- **Shared Summary**: What a session makes available to other sessions when sharing is on: its agents (label, state, parent, model, listening source), active exchanges, a format version and a last-updated time. Contains no conversation content.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With two sharing sessions, a state change in one is visible in the pane of the other within 3 seconds.
- **SC-002**: In a usability check, at least 90% of users running three sessions can name the session that needs their answer in under 5 seconds from the pane alone.
- **SC-003**: With sharing off, no information about a session's agents is available to any other session.
- **SC-004**: Sharing across 10 sessions adds no noticeable slowdown to any of them, as reported by users in testing.

## Assumptions

- This feature extends the single-session pane (spec 001); everything about how a figure looks and animates is defined there.
- Sharing covers one user's sessions on one machine; other users, other machines and remote sessions are out of scope.
- Sharing is controlled by the option `sharedFolder` (off by default). Showing sessions that do not share is controlled separately by the option `sessionsDirectory` from spec 003 (also off by default). A session appears with full detail when it shares into the folder, and as a single limited figure when it only appears in the sessions folder.
- The earlier session-level view (other sessions as single figures, no agent detail) is kept as the fallback for sessions that do not share (FR-007).
- A shared summary is considered stale after about 10 seconds without an update and is removed after about 60 seconds, or immediately when its session ends cleanly.
- Sessions running the mod at user scope (see the README install steps) are the ones that can share; a session without the mod can only be shown as a single figure.
