// Other Claude sessions on this machine, read from the folder of session files the person points the
// mod at (option `sessionsDirectory`). Session-level only: another session's own subagents are not
// visible from here. Pure parsing; hooks/register.tsx does the reading.
import { PEER_PREFIX, type Peer } from './model'
import type { AgentState } from '../types'

// A session file older than this is taken as a session that has gone (nothing says it is alive).
export const PEER_STALE_MS = 6 * 60 * 60 * 1000

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 90) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function stateOf(status: unknown): AgentState {
  if (status === 'busy') return 'in-progress'
  if (status === 'idle') return 'idle'
  return 'unknown'
}

// One session file's text -> a peer, or null when it is not a usable record.
export function parsePeer(text: string, selfId: string | null, now: number): Peer | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // The mod's own shared summaries (spec 002) carry a list of agents; they are never sessions, even when
  // the sessions folder and the shared folder are the same (spec 004). Session files have no such list.
  if (Array.isArray(r.agents)) return null
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : ''
  if (!sessionId || sessionId === selfId) return null
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : typeof r.startedAt === 'number' ? r.startedAt : 0
  if (updatedAt === 0 || now - updatedAt > PEER_STALE_MS) return null
  const cwd = typeof r.cwd === 'string' ? r.cwd : ''
  const folder = cwd.split('/').filter(Boolean).pop() ?? ''
  const name = typeof r.name === 'string' && r.name ? r.name : folder || sessionId.slice(0, 8)
  const where = cwd ? ` in ${cwd}` : ''
  return {
    id: `${PEER_PREFIX}${sessionId}`,
    label: name,
    state: stateOf(r.status),
    note: `another session${where}, updated ${ago(now - updatedAt)}`,
  }
}
