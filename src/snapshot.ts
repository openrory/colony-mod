// The summary a session shares with other sessions (contracts/shared-summary.md). Pure: the writer
// builds only from an explicit allow-list, and the reader validates what it finds. No engine imports.
import { isPeer, MAIN_ID, TERMINAL_STATES } from './model'
import type { Agent, AgentState, Colony, SharedAgent, SharedSummary } from '../types'

export const SUMMARY_VERSION = 1
export const MAX_AGENTS = 100
// Labels are cut to this length when written; a reader accepts up to LABEL_READ_MAX and cuts to LABEL_MAX.
export const LABEL_MAX = 40
export const LABEL_READ_MAX = 200

const STATES: ReadonlyArray<AgentState> = [
  'idle',
  'in-progress',
  'pending',
  'listening',
  'completed',
  'failed',
  'cancelled',
  'unknown',
]

export type SessionInfo = { id: string; name: string; folder: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokensOf(agent: Agent): { in: number; out: number } | null {
  const { input, output } = agent.usage
  if (input === 0 && output === 0) return null
  return { in: input, out: output }
}

// Over the limit, the writer drops the oldest finished subagents first, then the oldest of the rest.
// The main agent is never dropped.
function withinLimit(agents: Agent[]): Agent[] {
  let excess = agents.length - MAX_AGENTS
  if (excess <= 0) return agents
  const dropped = new Set<string>()
  const finished = agents
    .filter(a => a.id !== MAIN_ID && TERMINAL_STATES.includes(a.state))
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  for (const a of finished.slice(0, excess)) dropped.add(a.id)
  excess -= dropped.size
  if (excess > 0) {
    const rest = agents
      .filter(a => a.id !== MAIN_ID && !dropped.has(a.id))
      .sort((a, b) => a.lastEventAt - b.lastEventAt)
    for (const a of rest.slice(0, excess)) dropped.add(a.id)
  }
  return agents.filter(a => !dropped.has(a.id))
}

// Builds this session's summary. Each agent is copied field by field from the allow-list; nothing
// else on an agent, the colony or an exchange is ever copied. Other sessions' figures are not shared.
export function buildSummary(colony: Colony, session: SessionInfo, now: number): SharedSummary {
  const own = withinLimit(Object.values(colony.agents).filter(a => !isPeer(a)))
  const ids = new Set(own.map(a => a.id))
  const agents: SharedAgent[] = own.map(a => ({
    id: a.id,
    label: a.label.slice(0, LABEL_MAX),
    parentId: a.parentId,
    state: a.state,
    listenSource: a.listenSource,
    model: a.model,
    tokens: tokensOf(a),
  }))
  const exchanges = Object.values(colony.exchanges)
    .filter(x => ids.has(x.fromId) && ids.has(x.toId))
    .map(x => ({ from: x.fromId, to: x.toId }))
  return {
    version: 1,
    sessionId: session.id,
    name: session.name,
    folder: session.folder,
    updatedAt: now,
    ended: false,
    agents,
    exchanges,
  }
}

// The marker written when a session ends or sharing is switched off: no name, no folder, no agents.
export function endedSummary(session: { id: string }, now: number): SharedSummary {
  return { version: 1, sessionId: session.id, updatedAt: now, ended: true, agents: [] }
}

function readAgent(item: unknown): SharedAgent | null {
  if (!isRecord(item)) return null
  const { id, label } = item
  if (typeof id !== 'string' || id === '') return null
  if (typeof label !== 'string' || label.length > LABEL_READ_MAX) return null
  const state = STATES.includes(item.state as AgentState) ? (item.state as AgentState) : 'unknown'
  const tokens = isRecord(item.tokens) && typeof item.tokens.in === 'number' && typeof item.tokens.out === 'number'
    ? { in: item.tokens.in, out: item.tokens.out }
    : null
  return {
    id,
    label: label.slice(0, LABEL_MAX),
    parentId: typeof item.parentId === 'string' ? item.parentId : null,
    state,
    listenSource: typeof item.listenSource === 'string' ? item.listenSource : null,
    model: typeof item.model === 'string' ? item.model : null,
    tokens,
  }
}

function readExchanges(raw: unknown): Array<{ from: string; to: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ from: string; to: string }> = []
  for (const item of raw) {
    if (isRecord(item) && typeof item.from === 'string' && typeof item.to === 'string') {
      out.push({ from: item.from, to: item.to })
    }
  }
  return out
}

// One session's file text -> a summary, or null when it must be ignored (FR-008). Fields outside
// the contract are dropped because the result is built afresh.
export function parseSummary(text: string): SharedSummary | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.version !== SUMMARY_VERSION) return null
  const { sessionId, updatedAt } = raw
  if (typeof sessionId !== 'string' || sessionId === '') return null
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const list = raw.agents
  if (!Array.isArray(list) || list.length > MAX_AGENTS) return null
  const agents: SharedAgent[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const agent = readAgent(item)
    if (!agent || seen.has(agent.id)) return null
    seen.add(agent.id)
    agents.push(agent)
  }
  const summary: SharedSummary = {
    version: 1,
    sessionId,
    updatedAt,
    ended: raw.ended === true,
    agents,
    exchanges: readExchanges(raw.exchanges),
  }
  if (typeof raw.name === 'string') summary.name = raw.name
  if (typeof raw.folder === 'string') summary.folder = raw.folder
  return summary
}
