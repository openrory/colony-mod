import { test, expect } from 'claude-code/testing'
import { mergeSessions, STALE_MS, REMOVE_MS, IGNORE_AGE_MS } from '../src/sessions'
import { PEER_PREFIX, type Peer } from '../src/model'
import type { SharedSummary } from '../types'

const NOW = 1_000_000_000

function shared(sessionId: string, over: Partial<SharedSummary> = {}): SharedSummary {
  return {
    version: 1,
    sessionId,
    name: 'app',
    folder: '/Users/me/app',
    updatedAt: NOW,
    ended: false,
    agents: [],
    exchanges: [],
    ...over,
  }
}

const read = (sessionId: string, summary: SharedSummary | null) => ({ sessionId, summary })

function peer(sessionId: string, label = 'peer-app'): Peer {
  return { id: `${PEER_PREFIX}${sessionId}`, label, state: 'idle', note: 'another session' }
}

function merge(over: Partial<Parameters<typeof mergeSessions>[0]> = {}) {
  return mergeSessions({ summaries: [], peers: [], selfId: 'me', now: NOW, mtimes: {}, ...over })
}

const agent = (id: string, state: 'in-progress' | 'pending' | 'completed' = 'in-progress', parentId: string | null = null) => ({
  id,
  label: id,
  parentId,
  state,
  listenSource: null,
  model: null,
  tokens: null,
})

test('a summary younger than 10 s is live, from 10 s to under 60 s is stale, at 60 s it is removed', () => {
  expect(STALE_MS).toBe(10_000)
  expect(REMOVE_MS).toBe(60_000)
  const at = (age: number) => merge({ summaries: [read('s', shared('s', { updatedAt: NOW - age }))] }).s
  expect(at(9_999)!.freshness).toBe('live')
  expect(at(10_000)!.freshness).toBe('stale')
  expect(at(59_999)!.freshness).toBe('stale')
  expect(at(60_000)).toBe(undefined)
  expect(at(120_000)).toBe(undefined)
})

test('freshness uses the newer of updatedAt and the file modification time', () => {
  // Written 2 minutes ago by its clock, but the file was touched 5 s ago: live.
  const touched = merge({
    summaries: [read('s', shared('s', { updatedAt: NOW - 120_000 }))],
    mtimes: { s: NOW - 5_000 },
  })
  expect(touched.s!.freshness).toBe('live')
  // Both old: removed.
  const old = merge({
    summaries: [read('s', shared('s', { updatedAt: NOW - 70_000 }))],
    mtimes: { s: NOW - 70_000 },
  })
  expect(old.s).toBe(undefined)
})

test('an ended summary is removed at once', () => {
  const groups = merge({ summaries: [read('s', shared('s', { ended: true, agents: [] }))] })
  expect(groups.s).toBe(undefined)
})

test('a summary older than 24 h at first read is ignored', () => {
  expect(IGNORE_AGE_MS).toBe(24 * 60 * 60 * 1000)
  const groups = merge({ summaries: [read('s', shared('s', { updatedAt: NOW - IGNORE_AGE_MS }))] })
  expect(groups.s).toBe(undefined)
})

test('the own session is skipped, in both sources', () => {
  const groups = merge({
    selfId: 'me',
    summaries: [read('me', shared('me'))],
    peers: [peer('me')],
  })
  expect(groups.me).toBe(undefined)
  expect(Object.keys(groups)).toEqual([])
})

test('agent ids are namespaced by session, parent ids too', () => {
  const groups = merge({
    summaries: [
      read(
        'other',
        shared('other', {
          agents: [agent('main'), agent('a1', 'in-progress', 'main')],
          exchanges: [{ from: 'main', to: 'a1' }],
        }),
      ),
    ],
  })
  const group = groups.other!
  expect(group.source).toBe('shared')
  expect(group.agents.map(a => a.id)).toEqual(['other/main', 'other/a1'])
  expect(group.agents[1]!.parentId).toBe('other/main')
  expect(group.agents[0]!.parentId).toBe(null)
})

test('needsAttention is true only when some agent of the session is pending', () => {
  const pending = merge({ summaries: [read('s', shared('s', { agents: [agent('main'), agent('a', 'pending')] }))] })
  expect(pending.s!.needsAttention).toBe(true)
  const working = merge({ summaries: [read('s', shared('s', { agents: [agent('main'), agent('a')] }))] })
  expect(working.s!.needsAttention).toBe(false)
})

test('two sessions with the same name get their folder name as label, then a short id', () => {
  const groups = merge({
    summaries: [
      read('aaaaaaaa-1111', shared('aaaaaaaa-1111', { name: 'app', folder: '/x/frontend' })),
      read('bbbbbbbb-2222', shared('bbbbbbbb-2222', { name: 'app', folder: '/y/backend' })),
      read('cccccccc-3333', shared('cccccccc-3333', { name: 'api', folder: '/z/api' })),
      read('dddddddd-4444', shared('dddddddd-4444', { name: 'app', folder: '/q/app' })),
      read('eeeeeeee-5555', shared('eeeeeeee-5555', { name: 'app', folder: '/r/app' })),
    ],
  })
  expect(groups['aaaaaaaa-1111']!.name).toBe('frontend')
  expect(groups['bbbbbbbb-2222']!.name).toBe('backend')
  expect(groups['cccccccc-3333']!.name).toBe('api')
  // Same folder name too: the short id tells them apart.
  expect(groups['dddddddd-4444']!.name).toBe('dddddddd')
  expect(groups['eeeeeeee-5555']!.name).toBe('eeeeeeee')
})

test('a session present both as a shared summary and as a peer appears once, as shared', () => {
  const groups = merge({
    summaries: [read('s', shared('s', { agents: [agent('main')] }))],
    peers: [peer('s')],
  })
  expect(Object.keys(groups)).toEqual(['s'])
  expect(groups.s!.source).toBe('shared')
  expect(groups.s!.agents.length).toBe(1)
})

test('a session known only as a peer is kept as the limited fallback', () => {
  const groups = merge({ peers: [peer('p', 'other-app')] })
  expect(groups.p!.source).toBe('peer')
  expect(groups.p!.agents).toEqual([])
  expect(groups.p!.name).toBe('other-app')
  expect(groups.p!.needsAttention).toBe(false)
})

test('a summary that fails to parse falls back to its peer entry, and is omitted when there is none', () => {
  const withPeer = merge({ summaries: [read('s', null)], peers: [peer('s', 'fallback')] })
  expect(withPeer.s!.source).toBe('peer')
  expect(withPeer.s!.name).toBe('fallback')
  const without = merge({ summaries: [read('t', null)] })
  expect(without.t).toBe(undefined)
  expect(Object.keys(without)).toEqual([])
})
