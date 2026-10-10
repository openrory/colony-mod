# Feature Specification: One Switch for Sharing, Clear Option Names

**Feature Branch**: `005-one-switch-sharing`

**Created**: 2026-10-10

**Status**: Draft

**Depends on**: [002-all-sessions-pane](../002-all-sessions-pane/spec.md), [003-agent-details-and-peers](../003-agent-details-and-peers/spec.md)

**Input**: User description: "Other sessions folder, is that the same as Shared folder? ... yes, rename them and merge into one switch"

## Clarifications

### Session 2026-10-10

- Q: Do the settings keys change? → A: No. Only the names and descriptions people read change, so existing settings keep working.
- Q: Can someone still use only one of the two folders? → A: Yes, through the optional overrides; setting an override also turns on its own part.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn on one switch and see all my sessions (Priority: P1)

A user running several sessions switches on **Share with my other sessions** in each of them. Nothing else needs setting. Each session then shares its own agents (full detail for the other sessions that share) and the pane also shows any other running session that does not share, as a single limited figure. Today this takes two options with similar names and two folders, and users cannot tell what each does.

**Why this priority**: The two options confused the author within minutes of using them; a new user would be worse off. One switch with sensible folders is the whole point of the pane being easy to try.

**Independent Test**: With a clean install, switch on the one option in two sessions and confirm: the second session appears as a full group in the first, a third session without the mod appears as a limited figure, and the options list shows plain names with a one-line explanation each.

**Acceptance Scenarios**:

1. **Given** the switch is off and no override is set, **When** the mod runs, **Then** it reads and writes nothing in any shared or session-files folder.
2. **Given** the switch is on, **When** the mod runs, **Then** it shares this session's summary in the default sharing folder and also reads the default Claude session-files folder to show non-sharing sessions as limited figures.
3. **Given** the switch is on and an override folder is set for one part, **When** the mod runs, **Then** that part uses the override and the other part uses its default.
4. **Given** the switch is off and an override is set (for example by an earlier version), **When** the mod runs, **Then** only the part with the override is active, as before.
5. **Given** the folders cannot be determined (no home or config location is known), **When** the switch is on, **Then** that part stays off and nothing is written or read.

---

### Edge Cases

- Both overrides set to the same folder: works (spec 004 keeps the mod's files from showing up as sessions).
- Switch on, the sessions folder does not exist: no limited figures, no error.
- A user who set only the old session-files option before this change: sees no change in behaviour.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mod MUST offer one switch, **Share with my other sessions**, off by default. When on, it MUST share this session's agents and show other sessions: full detail for sessions that share, a single limited figure for running sessions that do not.
- **FR-002**: With the switch on, the sharing folder MUST default to `<Claude folder>/colony` and the Claude session-files folder to `<Claude folder>/sessions`, where `<Claude folder>` is the configured Claude folder if one is set and the user's `.claude` folder otherwise. If it cannot be determined, that part MUST stay off.
- **FR-003**: Each folder MUST have an optional override. A non-empty override MUST also turn on its own part even when the switch is off, so settings made with earlier versions keep working.
- **FR-004**: The options MUST have plain names and one-line descriptions saying what each does: "Share with my other sessions", "Sharing folder (optional)", and "Claude session files folder (optional)". The README options table MUST describe them in the same words.
- **FR-005**: With the switch off and both overrides empty, the mod MUST NOT read or write any file in either folder. This replaces spec 003's rule that the session-files folder is read only when its own option is set.
- **FR-006**: The settings keys MUST NOT change, so existing user settings keep working.

### Key Entities

- **Sharing switch**: The single on/off option.
- **Override**: An optional folder path for one of the two folders; empty means use the default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can turn on sharing across two sessions by changing one setting in each, in under 2 minutes.
- **SC-002**: With the switch off and no override, no file in either folder is read or written (verified by an automated test).
- **SC-003**: In a usability check, at least 90% of users can say from the options list alone what each of the three options does.
- **SC-004**: A user with only the earlier session-files option set sees exactly the behaviour they had before.

## Assumptions

- The Claude session-files folder is the one Claude Code keeps for its running sessions; its format is not a public interface and may change (spec 003).
- Reading Claude's own session files is acceptable for the same user on the same machine once the switch is on; the README says so.
- Spec 002's other rules (what is shared, staleness, ended markers) and spec 004's fix are unchanged.
