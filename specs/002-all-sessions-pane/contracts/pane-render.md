# Contract: pane rendering of session groups

Extends [spec 001's pane-render contract](../../001-agent-colony-pane/contracts/pane-render.md): figures, states and exchanges are drawn exactly as there.

## Session groups
- The local session is drawn first, as today. Each other session follows as a group with a header row: `<name>  <folder dimmed>` and its agents laid out as for a local session (main, children beneath, same sprites, labels, exchanges).
- **Needs attention** (FR-006): a header marker (the pending `!` glyph and the words `needs you`) on any group with a pending agent; the marker stays when the group is collapsed.
- **Stale** (10-60 s without update): the whole group is drawn dimmed with `stale` in the header; no animation.
- **Fallback peer** (a session that does not share): one unknown-style figure with `limited` in the header (FR-007).
- **Collapse order** when space is short: fresh, quiet sessions collapse to the header plus a `+N agents` count first; stale groups next; groups needing attention and the local session never collapse.
- Duplicate names: append the folder's last path segment, then a short session id (edge case).
