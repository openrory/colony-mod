// Merges the shared summaries other sessions wrote and the peer fallback into session groups for the
// pane (spec 002, data-model.md). Pure: hooks/register.tsx reads the folder and passes the results in.
import { PEER_PREFIX, type Peer } from './model'
import type { Agent, SessionGroup, SharedAgent, SharedSummary } from '../types'

// Live below STALE_MS since the newer of updatedAt and the file's modification time; stale up to REMOVE_MS.
export const STALE_MS = 10_000
export const REMOVE_MS = 60_000
// A summary older than this is ignored outright (in practice the removal rule already drops it sooner).
export const IGNORE_AGE_MS = 24 * 60 * 60 * 1000

// One file in the shared folder, as the reader read it. `summary` is null when it could not be used.
export type FileRead = { sessionId: string; summary: SharedSummary | null }

export type MergeInput = {
  summaries: FileRead[]
  peers: Peer[]
  selfId: string | null
  now: number
  // Modification time (ms) of each shared file, by session id.
  mtimes: Record<string, number>
}

function lastSegment(folder: string): string {
  return folder.split('/').filter(Boolean).pop() ?? ''
}

// A shared agent as a full pane agent. Ids are namespaced by session so they cannot clash with local ids.
function agentOf(sessionId: string, a: SharedAgent, updatedAt: number): Agent {
  const ns = (id: string) => `${sessionId}/${id}`
  return {
    id: ns(a.id),
    label: a.label,
    parentId: a.parentId === null ? null : ns(a.parentId),
    state: a.state,
    listenSource: a.listenSource,
    reactUntil: null,
    startedAt: null,
    endedAt: null,
    lastEventAt: updatedAt,
    listed: false,
    shift: 0,
    model: a.model,
    usage: { input: a.tokens?.in ?? 0, output: a.tokens?.out ?? 0, cacheRead: 0, cacheWrite: 0 },
    steps: 0,
    contextTokens: null,
    wander: 0,
    wanderTarget: 0,
    addressable: false,
    independent: false,
    background: false,
    spawnedBy: null,
    note: null,
  }
}

// A group from a usable summary, or null when the summary says the session has ended or it is too old.
function sharedGroup(sessionId: string, summary: SharedSummary, mtime: number, now: number): SessionGroup | null {
  if (summary.ended) return null
  const age = now - Math.max(summary.updatedAt, mtime)
  if (age >= REMOVE_MS || age >= IGNORE_AGE_MS) return null
  const folder = summary.folder ?? ''
  const agents = summary.agents.map(a => agentOf(sessionId, a, summary.updatedAt))
  return {
    sessionId,
    name: summary.name || lastSegment(folder) || sessionId.slice(0, 8),
    folder,
    updatedAt: summary.updatedAt,
    source: 'shared',
    freshness: age < STALE_MS ? 'live' : 'stale',
    agents,
    exchanges: (summary.exchanges ?? []).map(e => ({ from: `${sessionId}/${e.from}`, to: `${sessionId}/${e.to}` })),
    needsAttention: agents.some(a => a.state === 'pending'),
  }
}

// Two groups with the same name are told apart by their folder's last segment, then by a short id.
function distinctNames(groups: SessionGroup[]): void {
  const byName = new Map<string, SessionGroup[]>()
  for (const g of groups) byName.set(g.name, [...(byName.get(g.name) ?? []), g])
  for (const clash of byName.values()) {
    if (clash.length < 2) continue
    const counts = new Map<string, number>()
    for (const g of clash) {
      const seg = lastSegment(g.folder)
      counts.set(seg, (counts.get(seg) ?? 0) + 1)
    }
    for (const g of clash) {
      const seg = lastSegment(g.folder)
      g.name = seg && counts.get(seg) === 1 ? seg : g.sessionId.slice(0, 8)
    }
  }
}

export function mergeSessions(input: MergeInput): Record<string, SessionGroup> {
  const { summaries, peers, selfId, now, mtimes } = input
  const peerBySession = new Map<string, Peer>()
  for (const p of peers) {
    if (p.id.startsWith(PEER_PREFIX)) peerBySession.set(p.id.slice(PEER_PREFIX.length), p)
  }
  // The limited figure for a session that does not share (spec 003 fallback).
  const fallback = (sessionId: string): SessionGroup | null => {
    const p = peerBySession.get(sessionId)
    if (!p || sessionId === selfId) return null
    return {
      sessionId,
      name: p.label,
      folder: '',
      updatedAt: now,
      source: 'peer',
      freshness: 'live',
      agents: [],
      exchanges: [],
      needsAttention: false,
    }
  }

  const groups: SessionGroup[] = []
  const handled = new Set<string>()
  for (const { sessionId, summary } of summaries) {
    if (sessionId === selfId || handled.has(sessionId)) continue
    handled.add(sessionId)
    // A usable shared summary wins; an ended, stale, unreadable or missing one falls back to the peer entry.
    const group = summary ? sharedGroup(sessionId, summary, mtimes[sessionId] ?? 0, now) : null
    const chosen = group ?? fallback(sessionId)
    if (chosen) groups.push(chosen)
  }
  for (const sessionId of peerBySession.keys()) {
    if (handled.has(sessionId)) continue
    handled.add(sessionId)
    const chosen = fallback(sessionId)
    if (chosen) groups.push(chosen)
  }

  distinctNames(groups)
  const out: Record<string, SessionGroup> = {}
  for (const g of groups) out[g.sessionId] = g
  return out
}
