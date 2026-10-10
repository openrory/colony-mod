# Feature Specification: Shared Summaries Are Never Mistaken for Sessions

**Feature Branch**: `004-ignore-own-summaries`

**Created**: 2026-10-10

**Status**: Draft

**Depends on**: [002-all-sessions-pane](../002-all-sessions-pane/spec.md) (shared summaries), [003-agent-details-and-peers](../003-agent-details-and-peers/spec.md) (other sessions as single figures)

**Input**: User description: "make the ghost-figure fix, but speckit-spec it first" (a defect found while reviewing a setup where the sessions folder and the shared folder were the same)

## Clarifications

### Session 2026-10-10

- Q: Does this change what users configure? → A: No. It changes only how the sessions folder is read; no option, default or file format changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No phantom sessions in the pane (Priority: P1)

A user has the **Other sessions folder** option (spec 003) pointing at a folder that also holds the mod's shared summaries (spec 002), for example because they set both options to the same place. Today the mod reads every summary file in that folder as if it were a session file, so a session that has ended, or that shares, can appear as an extra figure with an unknown state, and an ended session can linger as a phantom for up to six hours. After this change, the pane shows each real session once, and files the mod wrote itself are never shown as sessions.

**Why this priority**: It is a correctness defect that shows the user sessions that do not exist. It is small, but it makes the pane untrustworthy, and a plausible setup (both options on one folder) triggers it.

**Independent Test**: Put a live summary file, an ended summary file and a normal session file for the same sessions in one folder, point both options at it, and confirm the pane shows each real session exactly once and nothing for ended ones.

**Acceptance Scenarios**:

1. **Given** a folder holding the mod's shared-summary file for a session and no normal session file for it, **When** the pane reads that folder as the sessions folder, **Then** no figure appears for that file.
2. **Given** a session ended sharing and left an ended marker in the folder, **When** the pane reads that folder as the sessions folder, **Then** no phantom figure remains for it.
3. **Given** a session is both sharing and has a normal session file in the folder, **When** the pane is drawn, **Then** it appears once, with the full detail from its shared summary.
4. **Given** normal session files and no summaries, **When** the pane reads the folder, **Then** behaviour is exactly as before (spec 003).

---

### Edge Cases

- A summary file from a newer version of the mod (unknown version number): still never shown as a session.
- A file that is neither a session record nor a summary: ignored, as today.
- A damaged or half-written summary: ignored without an error.
- A session file that happens to contain a field named like a summary field: still treated as a session file unless it has the shape of a summary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When reading the sessions folder, the mod MUST NOT treat a shared-summary file (including an ended marker) as a session, whatever folder it is in.
- **FR-002**: A session that has ended sharing MUST NOT remain visible as a phantom figure because of its leftover marker file.
- **FR-003**: A session that appears both as a normal session file and as a shared summary MUST appear once, with the shared summary's detail (spec 002 FR-007 is unchanged).
- **FR-004**: Reading normal session files MUST behave exactly as before this change.
- **FR-005**: No option, default, file format or file location changes.

### Key Entities

- **Shared-summary file**: A file the mod writes for sharing (spec 002). Identified by its shape, not by its name or folder.
- **Session file**: A file Claude Code keeps for a running session (spec 003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the sessions folder and the shared folder set to the same place, the number of figures for a session is exactly one while it runs and zero once it has ended and stopped sharing.
- **SC-002**: With no summary files present, the pane draws exactly the same figures as before this change.
- **SC-003**: No file of the mod's own is ever drawn as a session, checked by an automated test covering live and ended summaries.

## Assumptions

- The mod's summary files are recognisable by their shape (they hold a list of agents), which a normal session file does not.
- Claude Code's own session files do not contain such a list; their format is not a public interface, so the check is made on the summary side only.
- Spec 002's fallback (a session known only as a session file is drawn as a limited figure) is unchanged.
