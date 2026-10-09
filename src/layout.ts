// Colony + viewport + tick -> Scene (data-model.md). Pure: positions, labels, frames and streams.
import type { Agent, AgentState, Colony, Exchange } from '../types'
import { isPeer, MAIN_ID, MAX_SHIFT, shownStateOf } from './model'
import { frameOf } from './sprites'
import { detailsOf, fillOf, pixelsOf, tierOf, type Tier } from './tiers'

// The smallest figure: an 8-column sprite (4 text rows) with one label row beneath it. Bigger models
// draw bigger (tiers.ts); these are the floor, and the viewport size below which only a summary fits.
export const FIGURE_WIDTH = 8
export const FIGURE_HEIGHT = 5
// Columns between neighbouring cells in a row. Two figures pulled toward each other by MAX_SHIFT and
// wandering toward each other by WANDER_MAX still keep columns between them (and layout() pushes
// apart any that would touch).
export const GAP = 8
// Below each grid row: 2 stream lanes, then 1 connector row above the next row.
const LANES = 2
const CONNECTOR_ROWS = 3

export type Viewport = { rows: number; columns: number }

export type Figure = {
  agentId: string
  x: number
  y: number
  state: AgentState
  // The frame to draw this tick: pixel rows of '#' and '.'.
  grid: string[]
  // Label, truncated with an ellipsis to the figure width.
  label: string
  isMain: boolean
  // Size: the sprite's width in columns, and its height in rows with the label row.
  width: number
  height: number
  tier: Tier | null
  // How full its context window is (0..1), or null when unknown. Drawn as a darker fill from the feet.
  fill: number | null
  // A fork or workflow agent no list names: drawn muted so active agents stand out.
  background: boolean
  // The full, untruncated title, and the lines of its hover card.
  title: string
  details: string[]
}

// A 0/1 stream between two exchanging figures, on a lane row of its own (never overlapping another).
export type Stream = {
  fromId: string
  toId: string
  row: number
  x: number
  width: number
}

// One connector glyph, drawn in the gap above a child figure.
export type Connector = { x: number; y: number }

export type Scene = {
  figures: Figure[]
  streams: Stream[]
  connectors: Connector[]
  // Agents that did not fit the viewport.
  hidden: number
  // Completed agents folded into the `+N done` overflow line.
  collapsed: number
  // The row the overflow line sits on, or -1 when nothing collapsed.
  overflowRow: number
  // The tick the frames were chosen for; the view draws streams from it.
  tick: number
  // True when the colony has no agents at all.
  empty: boolean
  // True when the viewport is too small to draw figures; draw `summary` instead.
  tooSmall: boolean
  summary: string
  // The viewport the scene was laid out for.
  viewport: Viewport
}

export function truncate(text: string, width: number): string {
  const chars = [...text]
  if (chars.length <= width) return text
  if (width <= 0) return ''
  if (width === 1) return '…'
  return chars.slice(0, width - 1).join('') + '…'
}

// A listening figure is labelled with its source tag instead of its name (FR-010): `[github]`.
export function listenTagOf(source: string | null): string {
  return truncate(`[${source ?? 'external'}]`, FIGURE_WIDTH)
}

// The figure's own copy of each agent: the state it is drawn in (FR-013), not the stored one.
function shownAgents(agents: Record<string, Agent>): Record<string, Agent> {
  const out: Record<string, Agent> = {}
  for (const agent of Object.values(agents)) out[agent.id] = { ...agent, state: shownStateOf(agent) }
  return out
}

function figureFor(agent: Agent, x: number, y: number, tick: number, px: number): Figure {
  const reacting = agent.state === 'listening' && agent.reactUntil !== null
  return {
    agentId: agent.id,
    x,
    y,
    state: agent.state,
    grid: frameOf(agent.state, tick, reacting, px),
    label:
      agent.state === 'listening'
        ? listenTagOf(agent.listenSource)
        : truncate(agent.label, px),
    isMain: agent.id === MAIN_ID,
    width: px,
    height: px / 2 + 1,
    tier: tierOf(agent.model),
    fill: fillOf(agent),
    background: agent.background,
    title: agent.label,
    details: detailsOf(agent, agent.state),
  }
}

// One short line for the pane, the status line, or a tiny viewport.
export function summaryOf(agents: Agent[]): string {
  if (agents.length === 0) return 'colony: no agents'
  // Other sessions are drawn but not counted: the summary speaks for this session.
  const shown = agents.filter(a => !isPeer(a)).map(a => shownStateOf(a))
  const working = shown.filter(s => s === 'in-progress').length
  const needs = shown.filter(s => s === 'pending').length
  const parts = [`${working} working`]
  if (needs > 0) parts.push(`${needs} needs you`)
  return `colony: ${parts.join(', ')}`
}

// Subagents in family order: each agent's children follow it, so a family shares a block of the grid.
// Children whose parent is not in the colony join main's children.
export function familyOrder(agents: Agent[]): Agent[] {
  const ids = new Set(agents.map(a => a.id))
  const byParent = new Map<string, Agent[]>()
  for (const agent of agents) {
    if (agent.id === MAIN_ID) continue
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : MAIN_ID
    const list = byParent.get(parent) ?? []
    list.push(agent)
    byParent.set(parent, list)
  }
  const byStart = (a: Agent, b: Agent) =>
    (a.startedAt ?? 0) - (b.startedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const out: Agent[] = []
  const visit = (parent: string, seen: Set<string>) => {
    for (const child of (byParent.get(parent) ?? []).sort(byStart)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      visit(child.id, seen)
    }
  }
  const seen = new Set<string>()
  visit(MAIN_ID, seen)
  // Agents caught in a parent cycle (or their own parent) are unreachable from main: draw them last.
  for (const agent of agents.slice().sort(byStart)) {
    if (agent.id === MAIN_ID || out.includes(agent)) continue
    out.push(agent)
    seen.add(agent.id)
  }
  return out
}

// How many grid figures fit in `avail` rows of the viewport, for cells `maxH` rows tall.
function capacityFor(cols: number, maxH: number, avail: number): number {
  if (avail < maxH) return 0
  return cols * (Math.floor((avail - maxH) / (maxH + CONNECTOR_ROWS)) + 1)
}

function gridColumns(columns: number, maxW: number): number {
  return Math.max(1, Math.floor((columns + GAP) / (maxW + GAP)))
}

// Overflow: past capacity, the oldest completed figures fold into the `+N done` line. Pending and
// running figures are never folded. Returns the figures to lay out and how many were folded.
function fitOthers(
  others: Agent[],
  cols: number,
  maxH: number,
  avail: number,
): { kept: Agent[]; collapsed: number; reserveLine: boolean } {
  const full = capacityFor(cols, maxH, avail)
  if (others.length <= full) return { kept: others, collapsed: 0, reserveLine: false }
  const room = capacityFor(cols, maxH, avail - 1)
  const excess = others.length - room
  const completed = others
    .filter(a => a.state === 'completed')
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || (a.id < b.id ? -1 : 1))
  const folded = new Set(completed.slice(0, Math.max(0, excess)).map(a => a.id))
  const kept = others.filter(a => !folded.has(a.id))
  if (folded.size === 0) return { kept, collapsed: 0, reserveLine: false }
  return { kept, collapsed: folded.size, reserveLine: true }
}

// Exchanges that draw a stream: they carry a burst or a wait (an exchange only easing back draws none).
function streamExchanges(exchanges: Record<string, Exchange>): Exchange[] {
  return Object.keys(exchanges)
    .sort()
    .map(key => exchanges[key]!)
    .filter(ex => ex.reasons.length > 0)
}

// The pull (in columns) a figure feels toward its partner: its shift, toward the partner's column.
function shiftFor(
  agent: Agent,
  exchanges: Record<string, Exchange>,
  base: Map<string, { x: number; y: number }>,
): number {
  const magnitude = Math.min(MAX_SHIFT, Math.max(0, agent.shift))
  if (magnitude === 0) return 0
  for (const ex of Object.values(exchanges)) {
    const partner = ex.fromId === agent.id ? ex.toId : ex.toId === agent.id ? ex.fromId : null
    if (partner === null) continue
    const me = base.get(agent.id)
    const other = base.get(partner)
    if (!me || !other) continue
    const dx = other.x - me.x
    if (dx === 0) continue
    return Math.sign(dx) * Math.min(magnitude, Math.abs(dx))
  }
  return 0
}

export function layout(colony: Colony, viewport: Viewport, tick: number): Scene {
  const byId = shownAgents(colony.agents)
  const agents = Object.values(byId)
  const summary = summaryOf(agents)
  const none = { figures: [], streams: [], connectors: [], hidden: 0, collapsed: 0, overflowRow: -1, tick, viewport }
  if (agents.length === 0) {
    return { ...none, empty: true, tooSmall: false, summary }
  }
  if (viewport.columns < FIGURE_WIDTH || viewport.rows < FIGURE_HEIGHT) {
    return { ...none, empty: false, tooSmall: true, summary }
  }

  // Each figure's size follows its model, shrunk to fit a small viewport (never below the base figure).
  const fits = Math.max(FIGURE_WIDTH, 2 * Math.floor(Math.min(viewport.columns, 2 * (viewport.rows - 1)) / 2))
  const pxOf = (agent: Agent) => Math.max(FIGURE_WIDTH, Math.min(pixelsOf(agent.model), fits))
  // Grid cells fit the biggest of the other agents; main stands alone on the row above them.
  const others = agents.filter(a => a.id !== MAIN_ID)
  const maxW = Math.max(FIGURE_WIDTH, ...others.map(pxOf))
  const maxH = maxW / 2 + 1
  const rowStep = maxH + CONNECTOR_ROWS

  const base = new Map<string, { x: number; y: number; rowTop: number; rowBottom: number }>()
  const placed: Array<{ agent: Agent; x: number; y: number }> = []

  // Main figure on top, centred.
  const main = byId[MAIN_ID]
  let top = 0
  if (main) {
    const px = pxOf(main)
    const height = px / 2 + 1
    const x = Math.floor((viewport.columns - px) / 2)
    base.set(MAIN_ID, { x, y: 0, rowTop: 0, rowBottom: height })
    placed.push({ agent: main, x, y: 0 })
    top = height + CONNECTOR_ROWS
  }

  // Everyone else in family order in a grid beneath.
  const cols = gridColumns(viewport.columns, maxW)
  const { kept, collapsed, reserveLine } = fitOthers(familyOrder(agents), cols, maxH, viewport.rows - top)
  const capacity = capacityFor(cols, maxH, viewport.rows - top - (reserveLine ? 1 : 0))
  // Past capacity, drop from the end of family order but never a pending figure (the user must see it).
  let overflow = Math.max(0, kept.length - capacity)
  const dropped = new Set<string>()
  for (let i = kept.length - 1; i >= 0 && overflow > 0; i--) {
    if (kept[i]!.state === 'pending') continue
    dropped.add(kept[i]!.id)
    overflow--
  }
  // Only if pending figures alone exceed capacity are some of them cut.
  const shown = kept.filter(a => !dropped.has(a.id)).slice(0, capacity)
  const hidden = kept.length - shown.length
  shown.forEach((agent, i) => {
    const px = pxOf(agent)
    const rowTop = top + Math.floor(i / cols) * rowStep
    const x = (i % cols) * (maxW + GAP) + Math.floor((maxW - px) / 2)
    const y = rowTop + (maxH - (px / 2 + 1))
    base.set(agent.id, { x, y, rowTop, rowBottom: rowTop + maxH })
    placed.push({ agent, x, y })
  })

  // Figures: the base position moved toward the exchange partner by the eased shift, then by the
  // wander drift of a working figure.
  const figures: Figure[] = placed.map(({ agent, x, y }) => {
    const drift = agent.id === MAIN_ID ? 0 : Math.round(agent.wander)
    const x2 = x + shiftFor(agent, colony.exchanges, base) + drift
    return figureFor(agent, x2, y, tick, pxOf(agent))
  })

  // Keep every row's figures apart (a drift or pull never makes two touch) and inside the pane.
  const rows = new Map<number, Figure[]>()
  for (const f of figures) {
    const rowTop = base.get(f.agentId)!.rowTop
    rows.set(rowTop, [...(rows.get(rowTop) ?? []), f])
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    let edge = 0
    for (const f of row) {
      f.x = Math.max(f.x, edge)
      edge = f.x + f.width + 1
    }
    let limit = viewport.columns
    for (let i = row.length - 1; i >= 0; i--) {
      const f = row[i]!
      f.x = Math.max(0, Math.min(f.x, limit - f.width))
      limit = f.x - 1
    }
  }
  const at = new Map(figures.map(f => [f.agentId, f]))

  // Connectors: one glyph per child in the gap directly above it, clear of every figure. An agent no
  // orchestrator here started (a teammate, an independent agent) has none.
  const connectors: Connector[] = []
  for (const figure of figures) {
    const agent = byId[figure.agentId]!
    if (figure.isMain || agent.independent || !agent.parentId || !at.has(agent.parentId)) continue
    const cx = figure.x + Math.floor(figure.width / 2)
    const rowTop = base.get(figure.agentId)!.rowTop
    for (let y = Math.max(0, rowTop - CONNECTOR_ROWS); y < figure.y; y++) connectors.push({ x: cx, y })
  }

  // Streams: one per active exchange, on a lane row below the upper figure's row; lanes never overlap.
  const lanes = new Map<number, Array<[number, number]>>()
  const streams: Stream[] = []
  for (const ex of streamExchanges(colony.exchanges)) {
    const a = at.get(ex.fromId)
    const b = at.get(ex.toId)
    if (!a || !b) continue
    const upper = a.y < b.y || (a.y === b.y && a.x <= b.x) ? a : b
    const x0 = Math.min(a.x + Math.floor(a.width / 2), b.x + Math.floor(b.width / 2))
    const x1 = Math.max(a.x + Math.floor(a.width / 2), b.x + Math.floor(b.width / 2))
    const span: [number, number] = [x0, x1]
    const below = base.get(upper.agentId)!.rowBottom
    for (let lane = 0; lane < LANES; lane++) {
      const row = below + lane
      if (row >= viewport.rows) continue
      const taken = lanes.get(row) ?? []
      if (taken.some(([s, e]) => x0 <= e && s <= x1)) continue
      taken.push(span)
      lanes.set(row, taken)
      streams.push({ fromId: ex.fromId, toId: ex.toId, row, x: x0, width: x1 - x0 + 1 })
      break
    }
  }

  return {
    figures,
    streams,
    connectors,
    hidden,
    collapsed,
    overflowRow: collapsed > 0 ? viewport.rows - 1 : -1,
    tick,
    empty: false,
    tooSmall: false,
    summary,
    viewport,
  }
}
