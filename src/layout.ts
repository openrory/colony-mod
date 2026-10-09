// Colony + viewport + tick -> Scene (data-model.md). Pure: positions, labels, frames and streams.
import type { Agent, AgentState, Colony, Exchange, SessionGroup } from '../types'
import { exchangeId, isPeer, MAIN_ID, MAX_SHIFT, shownStateOf } from './model'
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
  // A figure of a stale session group: drawn dimmed and frozen (spec 002).
  stale: boolean
}

// A run of text on a row of the pane, in one style (group headers, the `+N done` line of a group).
export type Segment = { text: string; color?: string; dim?: boolean }
export type Line = { row: number; segments: Segment[] }

// One other session's group as the pane drew it: its header row, and whether its agents are shown.
export type GroupView = {
  sessionId: string
  name: string
  row: number
  expanded: boolean
  source: SessionGroup['source']
  freshness: SessionGroup['freshness']
  needsAttention: boolean
  agents: number
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
  // Header rows and `+N done` lines of the session groups (spec 002), drawn as text on their rows.
  lines: Line[]
  // The other sessions, in the order drawn (empty when none are shared or known).
  groups: GroupView[]
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

function figureFor(agent: Agent, x: number, y: number, tick: number, px: number, isMain: boolean): Figure {
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
    isMain,
    stale: false,
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
export function familyOrder(agents: Agent[], root: string = MAIN_ID): Agent[] {
  const ids = new Set(agents.map(a => a.id))
  const byParent = new Map<string, Agent[]>()
  for (const agent of agents) {
    if (agent.id === root) continue
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : root
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
  visit(root, seen)
  // Agents caught in a parent cycle (or their own parent) are unreachable from main: draw them last.
  for (const agent of agents.slice().sort(byStart)) {
    if (agent.id === root || out.includes(agent)) continue
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

// The agents of one colony (this session's, or one other session's group) laid out in a viewport.
// `root` is the agent drawn on top (main, or a group's own main agent).
function layoutAgents(colony: Colony, viewport: Viewport, tick: number, root: string = MAIN_ID): Scene {
  const byId = shownAgents(colony.agents)
  const agents = Object.values(byId)
  const summary = summaryOf(agents)
  const none = {
    figures: [],
    streams: [],
    connectors: [],
    hidden: 0,
    collapsed: 0,
    overflowRow: -1,
    tick,
    viewport,
    lines: [],
    groups: [],
  }
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
  const others = agents.filter(a => a.id !== root)
  const maxW = Math.max(FIGURE_WIDTH, ...others.map(pxOf))
  const maxH = maxW / 2 + 1
  const rowStep = maxH + CONNECTOR_ROWS

  const base = new Map<string, { x: number; y: number; rowTop: number; rowBottom: number }>()
  const placed: Array<{ agent: Agent; x: number; y: number }> = []

  // Main figure on top, centred.
  const main = byId[root]
  let top = 0
  if (main) {
    const px = pxOf(main)
    const height = px / 2 + 1
    const x = Math.floor((viewport.columns - px) / 2)
    base.set(root, { x, y: 0, rowTop: 0, rowBottom: height })
    placed.push({ agent: main, x, y: 0 })
    top = height + CONNECTOR_ROWS
  }

  // Everyone else in family order in a grid beneath.
  const cols = gridColumns(viewport.columns, maxW)
  const { kept, collapsed, reserveLine } = fitOthers(familyOrder(agents, root), cols, maxH, viewport.rows - top)
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
    const drift = agent.id === root ? 0 : Math.round(agent.wander)
    const x2 = x + shiftFor(agent, colony.exchanges, base) + drift
    return figureFor(agent, x2, y, tick, pxOf(agent), agent.id === root)
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
    lines: [],
    groups: [],
  }
}

// ---- Session groups (spec 002, contracts/pane-render.md) --------------------------------------

// The text of a group's header row: name, folder dimmed, then the markers. A collapsed group names how
// many agents it folds. Pure: the same words for live, stale and limited groups.
export function headerOf(group: SessionGroup, expanded: boolean): Segment[] {
  const out: Segment[] = [{ text: group.name }]
  if (group.folder) out.push({ text: `  ${group.folder}`, dim: true })
  if (group.needsAttention) out.push({ text: '  ! needs you', color: 'yellow' })
  if (group.freshness === 'stale') out.push({ text: '  stale', dim: true })
  if (group.source === 'peer') out.push({ text: '  limited', dim: true })
  if (!expanded && group.agents.length > 0) out.push({ text: `  +${group.agents.length} agents`, dim: true })
  return out
}

// What a block of drawn parts takes up: rows from its top to its lowest figure, lane, connector or line.
type Parts = {
  figures: Figure[]
  streams: Stream[]
  connectors: Connector[]
  lines: Line[]
  overflowRow?: number
}

function heightOf(parts: Parts): number {
  let height = (parts.overflowRow ?? -1) + 1
  for (const f of parts.figures) height = Math.max(height, f.y + f.height)
  for (const s of parts.streams) height = Math.max(height, s.row + 1)
  for (const c of parts.connectors) height = Math.max(height, c.y + 1)
  for (const l of parts.lines) height = Math.max(height, l.row + 1)
  return height
}

// One group's drawing, in its own rows (row 0 is the first row under its header).
type Block = Parts & { hidden: number; height: number }

type Plan = { group: SessionGroup; block: Block; expanded: boolean; dropped: boolean }

// Other sessions in a stable order: by name, then by id.
function orderedGroups(sessions: Record<string, SessionGroup>): SessionGroup[] {
  return Object.values(sessions).sort(
    (a, b) => a.name.localeCompare(b.name) || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
  )
}

// A group's agents as a colony of their own: the same drawing as a local session. Exchanges between
// its agents pull the pair together like local ones do.
function groupColony(group: SessionGroup): Colony {
  const agents: Record<string, Agent> = {}
  for (const a of group.agents) agents[a.id] = { ...a }
  const exchanges: Record<string, Exchange> = {}
  for (const e of group.exchanges) {
    const from = agents[e.from]
    const to = agents[e.to]
    if (!from || !to) continue
    const id = exchangeId(e.from, e.to)
    exchanges[id] = { id, fromId: e.from, toId: e.to, reasons: ['message'], burstUntil: 0 }
    from.shift = MAX_SHIFT
    to.shift = MAX_SHIFT
  }
  return { agents, exchanges, tick: 0, retentionMs: 0, sessions: {} }
}

// The fallback figure of a session that does not share (spec 003): one unknown-style figure.
function peerBlockOf(group: SessionGroup, columns: number): Block {
  const px = FIGURE_WIDTH
  const figure: Figure = {
    agentId: group.sessionId,
    x: Math.floor((columns - px) / 2),
    y: 0,
    state: 'unknown',
    grid: frameOf('unknown', 0, false, px),
    label: truncate(group.name, px),
    isMain: false,
    width: px,
    height: px / 2 + 1,
    tier: null,
    fill: null,
    background: false,
    title: group.name,
    details: ['limited: this session shares no agent detail'],
    stale: false,
  }
  return { figures: [figure], streams: [], connectors: [], lines: [], hidden: 0, height: figure.height }
}

// A group's drawing in the viewport's width. A stale group is frozen on its first frame, dimmed, with no
// streams: it does not animate.
function blockOf(group: SessionGroup, viewport: Viewport, tick: number): Block {
  if (group.agents.length === 0) {
    if (group.source === 'peer') return peerBlockOf(group, viewport.columns)
    return { figures: [], streams: [], connectors: [], lines: [], hidden: 0, height: 0 }
  }
  const frozen = group.freshness === 'stale'
  const scene = layoutAgents(groupColony(group), viewport, frozen ? 0 : tick, `${group.sessionId}/${MAIN_ID}`)
  const figures = scene.figures.map(f => ({ ...f, stale: frozen }))
  const streams = frozen ? [] : scene.streams
  const lines: Line[] = []
  // Past the group's capacity, its oldest completed agents fold into a `+N done` line under them.
  if (scene.collapsed > 0) {
    const row = heightOf({ figures, streams, connectors: scene.connectors, lines })
    lines.push({ row, segments: [{ text: `+${scene.collapsed} done`, dim: true }] })
  }
  const parts = { figures, streams, connectors: scene.connectors, lines }
  return { ...parts, hidden: scene.hidden, height: heightOf(parts) }
}

// The whole pane: the local session first, then each other session as a group under it. When the
// groups do not fit, fresh quiet groups fold to their header first, then stale ones; a group needing
// attention and the local session never fold. Only if even the folded headers do not fit are the last
// groups left out (counted in `hidden`).
export function layout(colony: Colony, viewport: Viewport, tick: number): Scene {
  const groups = orderedGroups(colony.sessions)
  const tooSmall = viewport.columns < FIGURE_WIDTH || viewport.rows < FIGURE_HEIGHT
  if (groups.length === 0 || tooSmall) return layoutAgents(colony, viewport, tick)

  // The local session keeps the rows above the groups' headers.
  const localRows = Math.max(FIGURE_HEIGHT, viewport.rows - groups.length)
  const local = layoutAgents(colony, { ...viewport, rows: localRows }, tick)
  const budget = viewport.rows - heightOf(local)

  const plans: Plan[] = groups.map(group => ({ group, block: blockOf(group, viewport, tick), expanded: true, dropped: false }))
  const cost = (p: Plan) => 1 + (p.expanded ? p.block.height : 0)
  const used = () => plans.reduce((sum, p) => sum + (p.dropped ? 0 : cost(p)), 0)

  const quiet = plans.filter(p => p.group.freshness === 'live' && !p.group.needsAttention).reverse()
  const stale = plans.filter(p => p.group.freshness === 'stale' && !p.group.needsAttention).reverse()
  const folded: Plan[] = []
  for (const p of [...quiet, ...stale]) {
    if (used() <= budget) break
    p.expanded = false
    folded.push(p)
  }
  // Fold only as deep as the space needs: the last folded groups reopen first, if they fit again.
  for (const p of folded.reverse()) {
    p.expanded = true
    if (used() > budget) p.expanded = false
  }
  // Last resort, when even the folded headers do not fit: a group needing attention folds to its header
  // (its marker stays), then the other groups are left out from the end, and attention groups last.
  const others = plans.filter(p => !p.group.needsAttention).reverse()
  const attention = plans.filter(p => p.group.needsAttention).reverse()
  for (const p of attention) {
    if (used() <= budget) break
    p.expanded = false
  }
  for (const p of [...others, ...attention]) {
    if (used() <= budget) break
    p.dropped = true
  }

  const figures = [...local.figures]
  const streams = [...local.streams]
  const connectors = [...local.connectors]
  const lines: Line[] = []
  const views: GroupView[] = []
  let hidden = local.hidden
  let row = heightOf(local)
  for (const p of plans) {
    if (p.dropped) {
      hidden += p.group.agents.length || 1
      continue
    }
    const header = row
    lines.push({ row: header, segments: headerOf(p.group, p.expanded) })
    views.push({
      sessionId: p.group.sessionId,
      name: p.group.name,
      row: header,
      expanded: p.expanded,
      source: p.group.source,
      freshness: p.group.freshness,
      needsAttention: p.group.needsAttention,
      agents: p.group.agents.length,
    })
    if (p.expanded) {
      const dy = header + 1
      figures.push(...p.block.figures.map(f => ({ ...f, y: f.y + dy })))
      streams.push(...p.block.streams.map(s => ({ ...s, row: s.row + dy })))
      connectors.push(...p.block.connectors.map(c => ({ ...c, y: c.y + dy })))
      lines.push(...p.block.lines.map(l => ({ ...l, row: l.row + dy })))
      hidden += p.block.hidden
    }
    row = header + cost(p)
  }

  return {
    ...local,
    figures,
    streams,
    connectors,
    lines,
    groups: views,
    hidden,
    empty: false,
    tooSmall: false,
    viewport,
  }
}
