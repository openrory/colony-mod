# Feature Specification: Agent Colony Pane

**Feature Branch**: `001-agent-colony-pane`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "I would like to create a claude mod that shows a side pane with all agents and subagents as pixelated figures, sort of like the claude and space invaders pixelated figures. The agents have multiple states that need to be visualised: idle (sleeping), pending (e.g. question needs an answer, approve/reject), in progress, or completed. I also want to visualise subagents and how agents talk together, so visualise that as well, for instance by moving them closer together and show them exchanging 0s and 1s. An agent could also be listening for a hook or event (e.g. Jira/Github update), so visualise that as well"

## Clarifications

### Session 2026-10-09

- Q: What should count as two agents "exchanging information" that triggers the move-closer and 0s-and-1s animation? → A: Subagent start and result return, any explicit message between agents, and the whole time a parent is waiting on an active subagent.
- Q: What should make an agent show as "listening for an external event"? → A: Any idle agent with a registered external trigger (hook, webhook, watch, schedule), labelled with its source type; unknown sources shown as "external".
- Q: When should the pane appear? → A: It opens automatically when a subagent first appears or an agent needs the user's input; once the user hides it, it stays hidden until the user reopens it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every agent and its state at a glance (Priority: P1)

While working in Claude Code, the user opens a side pane that shows each running agent as a small pixel-art creature (in the spirit of the Claude mascot and Space Invaders sprites). Each creature's look and animation reflects what that agent is doing right now: sleeping (idle), waving for attention (pending, needs the user's answer or approval), busy/animated (in progress), or celebrating/settled (completed).

**Why this priority**: This is the core value: a glanceable overview of agent activity. Even with nothing else, a live roster of agents with distinct, readable states delivers a usable MVP.

**Independent Test**: Start a session with one agent that goes through idle, working, asking a question, and finishing. Confirm the pane shows one figure whose appearance changes to match each state without any other feature present.

**Acceptance Scenarios**:

1. **Given** a session with no active agent work, **When** the pane is open, **Then** the main agent is shown as a sleeping figure.
2. **Given** an agent is executing a task, **When** the user looks at the pane, **Then** that agent's figure shows a distinct "working" animation.
3. **Given** an agent is waiting for the user to answer a question or approve/reject an action, **When** the user looks at the pane, **Then** that agent's figure shows an attention-seeking "pending" appearance clearly different from every other state.
4. **Given** an agent has finished its task, **When** the user looks at the pane, **Then** its figure shows a "completed" appearance that is distinct from idle.
5. **Given** the user resolves a pending question, **When** the agent resumes, **Then** the figure leaves the pending appearance and shows the new state.

---

### User Story 2 - Understand subagents and how agents collaborate (Priority: P2)

When an agent spawns subagents or exchanges information with other agents, the pane shows the relationship: subagents appear alongside their parent, and agents that are communicating move closer together and visibly exchange streams of 0s and 1s between them. When communication ends they drift apart again.

**Why this priority**: Shows the multi-agent structure, which is the main thing a plain status list cannot convey. It builds on Story 1's figures.

**Independent Test**: Trigger a task that spawns at least two subagents and has them report back; confirm the subagents appear, are visually tied to their parent, and show the exchange animation while messages pass.

**Acceptance Scenarios**:

1. **Given** an agent spawns a subagent, **When** the subagent starts, **Then** a new figure appears in the pane visibly grouped with its parent.
2. **Given** two agents are exchanging information, **When** the exchange occurs, **Then** the two figures move closer together and a stream of 0s and 1s is shown passing between them.
3. **Given** the exchange finishes, **When** no further messages pass, **Then** the figures return to their resting positions and the stream stops.
4. **Given** a subagent finishes, **When** its result is returned, **Then** its figure shows the completed appearance and its hand-off to the parent is visible.

---

### User Story 3 - See agents that are listening for external events (Priority: P3)

Some agents wait for an external trigger (for example a Jira or GitHub update) instead of working or sleeping. The pane shows such agents in a distinct "listening" appearance (for example, an antenna or ear cue) that is different from sleeping, and indicates which kind of source they are waiting on. When the event arrives, the agent visibly reacts and transitions into working.

**Why this priority**: Valuable for long-lived, event-driven agents but not needed for the basic overview.

**Independent Test**: Register an agent that waits for an external event; confirm it shows the listening appearance with its source label, then fire the event and confirm the reaction and transition to in-progress.

**Acceptance Scenarios**:

1. **Given** an agent is waiting on an external event source, **When** the user looks at the pane, **Then** it appears in a listening state distinct from idle/sleeping, labelled with the source (e.g. Jira, GitHub).
2. **Given** a listening agent receives its event, **When** the event arrives, **Then** the figure shows a visible reaction and then switches to the in-progress appearance.

---

### Edge Cases

- Many agents at once (e.g. 20+ subagents): the pane must stay readable, scrolling or compacting rather than overlapping or clipping figures.
- Narrow or very short pane: layout adapts; labels truncate gracefully rather than breaking the layout.
- An agent fails or is cancelled instead of completing: it must show a recognizable ending distinct from "completed".
- An agent is both listening and pending (e.g. event arrived, now needs approval): the more urgent state (pending) takes precedence.
- Several conversations occurring simultaneously among different agent pairs: each pair is shown without the streams being confused.
- Completed agents accumulating over a long session: they are eventually collapsed or removed so the pane does not fill with stale figures.
- Users who prefer reduced motion: state remains distinguishable without relying on animation alone.
- Colour-blind users: states are distinguishable by shape/pose, not colour alone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mod MUST provide a side pane that the user can show and hide during a Claude Code session. The pane MUST open automatically when a subagent first appears or an agent needs the user's input, unless the user has hidden it; once hidden, it MUST stay hidden until the user reopens it.
- **FR-002**: The pane MUST display one pixel-art figure for every active agent, including the main agent and all subagents.
- **FR-003**: Each figure MUST visually represent exactly one of these states: idle (sleeping), pending (awaiting user answer/approval), in progress, completed, or listening for an external event.
- **FR-004**: Each state MUST be distinguishable from every other state by pose or shape and animation, not by colour alone.
- **FR-005**: Each figure MUST carry a short label identifying the agent (name or role).
- **FR-006**: State changes MUST appear in the pane promptly after they occur in the session.
- **FR-007**: Subagents MUST be shown visually grouped with, or connected to, the agent that spawned them.
- **FR-008**: The pane MUST treat the following as an exchange: a subagent being started, a subagent's result returning to its parent, any explicit message between two agents, and the entire period during which a parent is waiting on an active subagent. For the duration of an exchange it MUST move the involved figures closer together and show a stream of 0s and 1s between them.
- **FR-009**: When an exchange ends, the involved figures MUST return to their resting arrangement.
- **FR-010**: Any idle agent with an external trigger that the mod has seen registered or fire during the session (a watcher, webhook, or an inbound event from a named source) MUST appear in a listening appearance labelled with its source type (e.g. Jira, GitHub); if the source type is unknown it MUST be labelled "external". An agent merely waiting on a timer of its own (e.g. a scheduled wake-up) or a background task is not listening. Triggers configured before the session and never observed are out of scope for v1.
- **FR-011**: When a listening agent's event arrives, the pane MUST show a visible reaction before the agent's state changes.
- **FR-012**: Agents that end by error or cancellation MUST be shown differently from completed agents.
- **FR-013**: When several states apply at once, the pane MUST show the highest-priority state, with pending taking precedence over all others.
- **FR-014**: The pane MUST remain legible when many agents are present, by scrolling or compacting rather than overlapping figures.
- **FR-015**: Completed agents MUST be retained for a limited time and then collapsed or removed so the pane does not accumulate stale figures.
- **FR-016**: The mod MUST NOT alter the behaviour, output, or permissions of the agents it displays; it only observes and presents.
- **FR-017**: The mod MUST offer a reduced-motion option that preserves state readability without continuous animation.
- **FR-018**: If the pane cannot determine an agent's state, it MUST show a neutral "unknown" appearance instead of a misleading one.
- **FR-019**: The mod MUST be shareable through a public GitHub repository: the repository MUST be installable by another person with a single documented install command, and its README MUST give step-by-step install, update, uninstall and usage instructions, a legend of the figure states, the available options, and the known limits.

### Key Entities

- **Agent**: A main or sub agent in a session. Attributes: identity/label, parent (if any), current state, optional listening source, start and end times.
- **Agent State**: One of idle, pending, in progress, completed, listening, plus failed/cancelled and unknown. Each maps to one figure appearance.
- **Exchange**: A communication between two agents (spawn, result return, explicit message, or parent waiting on an active subagent) over a period of time, with a direction and start/end, driving the "closer together with 0s and 1s" visual.
- **Event Source**: An external origin an agent can wait on (e.g. Jira, GitHub), with a display label.
- **Figure**: The pixel-art representation of an agent: its look, pose, animation, and position in the pane.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a usability check, at least 90% of first-time users correctly name the state (idle, pending, in progress, completed, listening) of a highlighted figure after a few seconds of viewing, without a legend.
- **SC-002**: A state change in a session is reflected in the pane within 1 second.
- **SC-003**: A user can tell which agents need their input in under 3 seconds when 10 agents are shown.
- **SC-004**: In a usability check, at least 90% of users correctly identify which two agents are communicating when an exchange is shown.
- **SC-005**: The pane stays fully legible (no overlapping or clipped figures) with at least 25 simultaneous agents.
- **SC-006**: Running the mod adds no noticeable slowdown to the user's session, as reported by users in testing.
- **SC-007**: Every state remains distinguishable with colour removed and with reduced motion enabled.
- **SC-008**: A person who has never seen the mod can install it from the GitHub repository by following only the README and see the pane working within 5 minutes.

## Assumptions

- The mod is delivered as a Claude Code mod as described in the official mods documentation, and can show a live side pane and observe session/agent activity through the facilities that documentation provides.
- Only agents in the current Claude Code session are shown; cross-machine or historical agents are out of scope for v1.
- The pixel figures are original designs inspired by retro pixel-art style; no third-party mascot artwork is reproduced.
- External event sources for v1 are labelled generically, with Jira and GitHub as the named examples; any source an agent reports waiting on can be shown with its own label.
- The pane is read-only: the user answers questions and approvals in the normal Claude Code interface, not through the pane.
- A completed agent stays visible for about 30 seconds by default before being collapsed.
- The mods API cannot list already-configured hooks or triggers, so an agent shows as listening only after its trigger is observed.
- The mod is published as a public GitHub repository that other people install from; the README is the only onboarding material they get.
- The terminal or interface used supports the pane's minimum size and basic colour display.
