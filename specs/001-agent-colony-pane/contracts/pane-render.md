# Contract: pane rendering

Pane id `colony`, title `Colony`, drawn by `ui.render` for `{ component: 'Pane', requestId: 'colony' }` using elements from `$.ui.resolve(e)` (Box, Text).

## Per-state look (shape/pose first, colour second — FR-004, SC-007)
| State | Pose | Animation (full motion) | Static frame (reduced motion) |
|---|---|---|---|
| idle | eyes closed, head down, `z` | slow `z` float | single `z` |
| in-progress | eyes open, arms/legs moving | 2-frame walk/typing cycle | frame 1 + `…` |
| pending | arms raised, `!` above | bob + blinking `!` | arms raised + `!` |
| completed | arms up in a V, tick mark | brief sparkle, then calm | V pose + `✓` |
| listening | antenna/ear extended, source tag | antenna pulse | antenna + tag |
| failed / cancelled | cracked/fallen figure, `x` eyes | none | same |
| unknown | outline with `?` | none | same |

## Layout
- Main figure at the top; subagents in a row/grid beneath it, connector glyph to the parent.
- Label under each figure, truncated with `…`; listening shows `[source]`.
- Exchange: both figures shift toward each other by up to 2 columns, a line of alternating `0`/`1` glyphs scrolls between them; on end they ease back.
- Overflow: past capacity, oldest completed figures collapse to a `+N done` row; pending figures are never collapsed.
- Empty or narrow viewport: render a one-line summary instead of clipping.
