import { test, expect } from 'claude-code/testing'
import { parsePeer, PEER_STALE_MS } from '../src/peers'
import { initialColony, reduce, PEER_PREFIX, MAIN_ID } from '../src/model'
import { attentionOf, readOptions } from '../src/runtime'
import { summaryOf } from '../src/layout'
import { mergeSessions } from '../src/sessions'
import { parseSummary } from '../src/snapshot'

const NOW = 1_000_000_000
const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ sessionId: 'abc', cwd: '/Users/me/projects/app', name: 'app-a1', status: 'busy', updatedAt: NOW - 120_000, ...over })

test('a session file becomes a peer with its name, state and a note', () => {
  const peer = parsePeer(file(), 'me', NOW)!
  expect(peer.id).toBe(`${PEER_PREFIX}abc`)
  expect(peer.label).toBe('app-a1')
  expect(peer.state).toBe('in-progress')
  expect(peer.note).toBe('another session in /Users/me/projects/app, updated 2m ago')
  expect(parsePeer(file({ status: 'idle' }), 'me', NOW)!.state).toBe('idle')
  expect(parsePeer(file({ status: 'weird' }), 'me', NOW)!.state).toBe('unknown')
  expect(parsePeer(file({ name: '' }), 'me', NOW)!.label).toBe('app')
})

test('this session, stale sessions and unusable files are not peers', () => {
  expect(parsePeer(file(), 'abc', NOW)).toBe(null)
  expect(parsePeer(file({ updatedAt: NOW - PEER_STALE_MS - 1 }), 'me', NOW)).toBe(null)
  expect(parsePeer('not json', 'me', NOW)).toBe(null)
  expect(parsePeer('[]', 'me', NOW)).toBe(null)
  expect(parsePeer(JSON.stringify({ cwd: '/x' }), 'me', NOW)).toBe(null)
})

test('peers replace the other-session figures, never touch real agents, and are not removed by silence', () => {
  let c = reduce(initialColony(30_000), { type: 'agent-added', id: MAIN_ID, label: 'main', parentId: null, at: 0 })
  const peer = (id: string) => ({ id: `${PEER_PREFIX}${id}`, label: id, state: 'idle' as const, note: 'n' })
  c = reduce(c, { type: 'peers', peers: [peer('a'), peer('b')], at: 1 })
  expect(Object.keys(c.agents).sort()).toEqual(['main', 'session:a', 'session:b'])
  expect(c.agents['session:a']!.independent).toBe(true)
  c = reduce(c, { type: 'tick', at: 10 * 60_000 })
  expect(c.agents['session:a']).toBeDefined()
  c = reduce(c, { type: 'peers', peers: [peer('b')], at: 2 })
  expect(Object.keys(c.agents).sort()).toEqual(['main', 'session:b'])
})

test('other sessions neither open the pane nor count in the summary', () => {
  let c = reduce(initialColony(30_000), { type: 'agent-added', id: MAIN_ID, label: 'main', parentId: null, at: 0 })
  c = reduce(c, { type: 'peers', peers: [{ id: `${PEER_PREFIX}a`, label: 'a', state: 'in-progress', note: 'n' }], at: 1 })
  expect(attentionOf(c)).toBe(0)
  expect(summaryOf(Object.values(c.agents))).toBe('colony: 0 working')
})

test('the sessions folder option is empty unless set', () => {
  expect(readOptions({}).sessionsDirectory).toBe('')
  expect(readOptions({ sessionsDirectory: ' /Users/me/.claude/sessions ' }).sessionsDirectory).toBe('/Users/me/.claude/sessions')
  expect(readOptions({ sessionsDirectory: 7 }).sessionsDirectory).toBe('')
})

test('a session that shares and is also a peer is drawn once, as shared', () => {
  const summary = parseSummary(JSON.stringify({
    version: 1,
    sessionId: 'abc',
    name: 'app-shared',
    folder: '/Users/me/projects/app',
    updatedAt: NOW,
    agents: [{ id: 'main', label: 'main', parentId: null, state: 'in-progress' }],
  }))!
  const peer = parsePeer(file(), 'me', NOW)!
  const groups = mergeSessions({
    summaries: [{ sessionId: 'abc', summary }],
    peers: [peer],
    selfId: 'me',
    now: NOW,
    mtimes: { abc: NOW },
  })
  expect(Object.keys(groups)).toEqual(['abc'])
  expect(groups.abc!.source).toBe('shared')
  expect(groups.abc!.name).toBe('app-shared')
  expect(groups.abc!.agents.map(a => a.id)).toEqual(['abc/main'])
})

// Spec 004: the mod's own shared summaries are never read as sessions (they carry an `agents` list).
const summaryFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    sessionId: 'abc',
    name: 'app-shared',
    folder: '/Users/me/projects/app',
    updatedAt: NOW,
    ended: false,
    agents: [{ id: 'main', label: 'main', parentId: null, state: 'in-progress' }],
    exchanges: [],
    ...over,
  })

test('shared summaries, live or ended, are never peers', () => {
  expect(parsePeer(summaryFile(), 'me', NOW)).toBe(null)
  expect(parsePeer(JSON.stringify({ version: 1, sessionId: 'abc', updatedAt: NOW, ended: true, agents: [] }), 'me', NOW)).toBe(null)
  expect(parsePeer(summaryFile({ version: 9 }), 'me', NOW)).toBe(null)
})

test('a normal session record still parses, even with a string version or an agents field that is not a list', () => {
  expect(parsePeer(file({ version: '2.1.295' }), 'me', NOW)!.label).toBe('app-a1')
  expect(parsePeer(file({ agents: 'none' }), 'me', NOW)!.label).toBe('app-a1')
})

test('with both folders the same, a live summary and its session file show once and an ended marker shows nothing', () => {
  const live = parseSummary(summaryFile())!
  const text = [
    summaryFile(),
    file(),
    JSON.stringify({ version: 1, sessionId: 'gone', updatedAt: NOW, ended: true, agents: [] }),
  ]
  const peers = text.map(t => parsePeer(t, 'me', NOW)).filter(p => p !== null)
  const groups = mergeSessions({
    summaries: [{ sessionId: 'abc', summary: live }],
    peers,
    selfId: 'me',
    now: NOW,
    mtimes: { abc: NOW },
  })
  expect(Object.keys(groups)).toEqual(['abc'])
  expect(groups.abc!.source).toBe('shared')
})
