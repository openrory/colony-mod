import { test, expect } from 'claude-code/testing'
import {
  animates,
  contextFor,
  nextRecentAgent,
  pendingIdsOf,
  readOptions,
  sharedFolderFor,
  sessionsFolderFor,
  attentionOf,
  shouldAutoOpen,
  shouldToastPending,
  shouldWrite,
  statusFor,
  pendingAgentsOf,
  anyActiveOf,
  summaryPath,
  WRITE_MIN_MS,
  HEARTBEAT_MS,
} from '../src/runtime'
import { initialColony, reduce, type Signal } from '../src/model'
import type { AgentState, Colony } from '../types'

function colonyWith(signals: Signal[]): Colony {
  return signals.reduce(reduce, initialColony(30_000))
}

const added = (id: string, parentId: string | null = null): Signal => ({
  type: 'agent-added',
  id,
  label: id,
  parentId,
  at: 0,
})
const state = (id: string, s: AgentState): Signal => ({
  type: 'agent-state',
  id,
  state: s,
  at: 0,
})

test('readOptions defaults to motion on, 30 s retention and sharing off', () => {
  const defaults = { reducedMotion: false, retentionMs: 30_000, sessionsDirectory: '', shareSessions: false, sharedFolder: '' }
  expect(readOptions(undefined)).toEqual(defaults)
  expect(readOptions({})).toEqual(defaults)
})

test('readOptions reads the share switch from a boolean or the string true only', () => {
  expect(readOptions({ shareSessions: true }).shareSessions).toBe(true)
  expect(readOptions({ shareSessions: 'true' }).shareSessions).toBe(true)
  expect(readOptions({ shareSessions: false }).shareSessions).toBe(false)
  expect(readOptions({ shareSessions: 'yes' }).shareSessions).toBe(false)
  expect(readOptions({ shareSessions: 1 }).shareSessions).toBe(false)
})

test('readOptions reads sharedFolder as a trimmed string and empties anything else', () => {
  expect(readOptions({ sharedFolder: ' /Users/me/shared ' }).sharedFolder).toBe('/Users/me/shared')
  expect(readOptions({ sharedFolder: 7 }).sharedFolder).toBe('')
  expect(readOptions({ sharedFolder: null }).sharedFolder).toBe('')
})

test('readOptions reads reduced motion and retention seconds from options', () => {
  expect(readOptions({ reducedMotion: true, retentionSeconds: 5 })).toEqual({
    reducedMotion: true,
    retentionMs: 5_000,
    sessionsDirectory: '',
    shareSessions: false,
    sharedFolder: '',
  })
  expect(readOptions({ reducedMotion: 'true', retentionSeconds: '12' })).toEqual({
    reducedMotion: true,
    retentionMs: 12_000,
    sessionsDirectory: '',
    shareSessions: false,
    sharedFolder: '',
  })
})

test('readOptions falls back to 30 s for unusable retention', () => {
  expect(readOptions({ retentionSeconds: 'soon' }).retentionMs).toBe(30_000)
  expect(readOptions({ retentionSeconds: -4 }).retentionMs).toBe(30_000)
})

test('pendingIdsOf lists only pending agents', () => {
  const c = colonyWith([added('main'), added('a'), state('a', 'pending')])
  expect(pendingIdsOf(c)).toEqual(['a'])
  expect(pendingIdsOf(colonyWith([added('main')]))).toEqual([])
})

test('animates is true for in-progress, pending, completed and open exchanges, and never in reduced motion', () => {
  expect(animates(colonyWith([added('main')]), false)).toBe(false)
  expect(animates(colonyWith([added('main'), state('main', 'in-progress')]), false)).toBe(true)
  expect(animates(colonyWith([added('main'), state('main', 'pending')]), false)).toBe(true)
  expect(animates(colonyWith([added('main'), state('main', 'completed')]), false)).toBe(true)
  expect(animates(colonyWith([added('main'), state('main', 'in-progress')]), true)).toBe(false)
  expect(animates(colonyWith([added('main'), state('main', 'failed')]), false)).toBe(false)
  const withExchange = colonyWith([
    added('main'),
    added('sub', 'main'),
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'waiting', at: 0 },
  ])
  expect(animates(withExchange, false)).toBe(true)
})

test('recent agent follows activity and is kept by other events', () => {
  expect(nextRecentAgent(null, 'tool.call', { agentId: 'sub1' })).toBe('sub1')
  expect(nextRecentAgent('sub1', 'classic.Notification', {})).toBe('sub1')
  expect(nextRecentAgent('sub1', 'tool.call', {})).toBe('main')
})

test('contextFor carries the time, the recent agent and the pending ids', () => {
  const c = colonyWith([added('main'), added('a'), state('a', 'pending')])
  expect(contextFor(c, 'main', 42)).toEqual({
    at: 42,
    recentAgentId: 'main',
    pendingIds: ['a'],
    agents: [
      { id: 'main', label: 'main' },
      { id: 'a', label: 'a' },
    ],
    reactFlashMs: 1000,
  })
})

test('contextFor passes a zero reaction flash through (reduced motion)', () => {
  const c = colonyWith([added('main')])
  expect(contextFor(c, null, 1, 0).reactFlashMs).toBe(0)
})

test('status line shows a summary only while the open pane is not placed', () => {
  const c = colonyWith([added('main'), state('main', 'in-progress'), added('a'), state('a', 'pending')])
  expect(statusFor(c, true, false)).toBe('colony: 1 working, 1 needs you')
  expect(statusFor(c, true, true)).toBe(undefined)
  expect(statusFor(c, false, false)).toBe(undefined)
})

test('auto-open happens on the first pending or first subagent, only when not hidden and not open', () => {
  const base = { attention: 1, hidden: false, paneOpen: false, firstAutoDone: false }
  expect(shouldAutoOpen(base)).toBe(true)
  expect(shouldAutoOpen({ ...base, attention: 0 })).toBe(false)
  expect(shouldAutoOpen({ ...base, hidden: true })).toBe(false)
  expect(shouldAutoOpen({ ...base, paneOpen: true })).toBe(false)
  expect(shouldAutoOpen({ ...base, firstAutoDone: true })).toBe(false)
})

test('attention counts pending agents and subagents, but not main alone', () => {
  expect(attentionOf(colonyWith([added('main')]))).toBe(0)
  expect(attentionOf(colonyWith([added('main'), added('sub')]))).toBe(1)
  expect(attentionOf(colonyWith([added('main'), state('main', 'pending')]))).toBe(1)
})

test('a pending toast fires only for a new pending while the open pane is unplaced', () => {
  expect(
    shouldToastPending({ pendingCount: 1, previousPendingCount: 0, paneOpen: true, placed: false }),
  ).toBe(true)
  expect(
    shouldToastPending({ pendingCount: 1, previousPendingCount: 1, paneOpen: true, placed: false }),
  ).toBe(false)
  expect(
    shouldToastPending({ pendingCount: 1, previousPendingCount: 0, paneOpen: true, placed: true }),
  ).toBe(false)
  expect(
    shouldToastPending({ pendingCount: 1, previousPendingCount: 0, paneOpen: false, placed: false }),
  ).toBe(false)
})

test('shouldWrite writes a change at most once per second and a heartbeat every 5 s, busy or idle', () => {
  expect(WRITE_MIN_MS).toBe(1000)
  expect(HEARTBEAT_MS).toBe(5000)
  const base = { changed: false, lastWriteAt: 0, now: 10_000, lastHeartbeatAt: 10_000 }
  // Nothing changed and a heartbeat was just written: nothing to write.
  expect(shouldWrite(base)).toBe(false)
  // A change waits until a second has passed since the last write.
  expect(shouldWrite({ ...base, changed: true, lastWriteAt: 9_500 })).toBe(false)
  expect(shouldWrite({ ...base, changed: true, lastWriteAt: 9_000 })).toBe(true)
  // A heartbeat is due every 5 s even when nothing changed (an idle session must not look stale).
  expect(shouldWrite({ ...base, lastHeartbeatAt: 5_001 })).toBe(false)
  expect(shouldWrite({ ...base, lastHeartbeatAt: 5_000 })).toBe(true)
  expect(shouldWrite({ ...base, lastHeartbeatAt: 0 })).toBe(true)
})

test('a burst of changes is written once at its start and once as the trailing write', () => {
  // The caller keeps `pending` until a write happens; here changes arrive at 0, 100 and 200 ms.
  const changes = new Set([0, 100, 200])
  let pending = false
  let lastWrite = Number.NEGATIVE_INFINITY
  const writes: number[] = []
  for (let now = 0; now <= 2_000; now += 50) {
    if (changes.has(now)) pending = true
    if (shouldWrite({ changed: pending, lastWriteAt: lastWrite, now, lastHeartbeatAt: 0 })) {
      writes.push(now)
      pending = false
      lastWrite = now
    }
  }
  expect(writes).toEqual([0, 1_000])
})

// Other sessions that share (spec 002 FR-006, FR-009): their pending agents count; limited figures do not.
function sharingSession(sessionId: string, freshness: 'live' | 'stale', state: AgentState, source: 'shared' | 'peer' = 'shared'): Signal {
  const agents = source === 'shared'
    ? [{ id: `${sessionId}/w`, label: 'w', parentId: null, state, reactUntil: null, listenSource: null } as unknown as Colony['agents'][string]]
    : []
  return {
    type: 'sessions',
    at: 0,
    sessions: {
      [sessionId]: { sessionId, name: sessionId, folder: '', updatedAt: 0, source, freshness, agents, exchanges: [], needsAttention: state === 'pending' },
    },
  }
}

test('status line counts pending and working agents of live sharing sessions', () => {
  const c = colonyWith([added('main'), sharingSession('other', 'live', 'pending')])
  expect(statusFor(c, true, false)).toBe('colony: 0 working, 1 needs you')
  const busy = colonyWith([added('main'), sharingSession('other', 'live', 'in-progress')])
  expect(statusFor(busy, true, false)).toBe('colony: 1 working')
})

test('a stale sharing session or a limited peer figure is not counted in the status line', () => {
  const stale = colonyWith([added('main'), sharingSession('other', 'stale', 'pending')])
  expect(statusFor(stale, true, false)).toBe('colony: 0 working')
  const limited = colonyWith([added('main'), sharingSession('other', 'live', 'pending', 'peer')])
  expect(statusFor(limited, true, false)).toBe('colony: 0 working')
})

test('pending agents of live sharing sessions are listed for the toast, limited figures are not', () => {
  const c = colonyWith([added('main'), sharingSession('other', 'live', 'pending')])
  expect(pendingAgentsOf(c).map(a => a.id)).toEqual(['other/w'])
  expect(pendingAgentsOf(colonyWith([added('main'), sharingSession('x', 'live', 'pending', 'peer')]))).toEqual([])
  expect(pendingAgentsOf(colonyWith([added('main'), sharingSession('x', 'stale', 'pending')]))).toEqual([])
})

test('attention for opening the pane still counts only this session', () => {
  expect(attentionOf(colonyWith([added('main'), sharingSession('other', 'live', 'pending')]))).toBe(0)
})

const NO_ENV = { configDir: '', home: '' }

test('sharing is off when the switch is off and no folder is set, whatever the environment', () => {
  expect(sharedFolderFor({ shareSessions: false, sharedFolder: '', ...NO_ENV })).toBe('')
  expect(sharedFolderFor({ shareSessions: false, sharedFolder: '', configDir: '/cfg', home: '/home/u' })).toBe('')
  expect(sharedFolderFor({ shareSessions: false, sharedFolder: '   ', configDir: '', home: '/home/u' })).toBe('')
})

test('a set folder is used as given (trimmed) when sharing is on or off, and wins over the default', () => {
  expect(sharedFolderFor({ shareSessions: false, sharedFolder: ' /Users/me/shared ', ...NO_ENV })).toBe('/Users/me/shared')
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '/Users/me/shared', configDir: '/cfg', home: '/home/u' })).toBe('/Users/me/shared')
})

test('a set folder loses its trailing slashes', () => {
  expect(sharedFolderFor({ shareSessions: false, sharedFolder: '/Users/me/shared//', ...NO_ENV })).toBe('/Users/me/shared')
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '/Users/me/shared/', ...NO_ENV })).toBe('/Users/me/shared')
})

test('with the switch on and no folder set, the default is CLAUDE_CONFIG_DIR/colony', () => {
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '', configDir: '/cfg/claude', home: '/home/u' })).toBe('/cfg/claude/colony')
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '', configDir: '/cfg/claude/', home: '' })).toBe('/cfg/claude/colony')
})

test('with the switch on and no CLAUDE_CONFIG_DIR, the default is HOME/.claude/colony', () => {
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '', configDir: '', home: '/home/u' })).toBe('/home/u/.claude/colony')
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '', configDir: '  ', home: '/home/u/' })).toBe('/home/u/.claude/colony')
})

test('with the switch on and neither CLAUDE_CONFIG_DIR nor HOME known, sharing stays off', () => {
  expect(sharedFolderFor({ shareSessions: true, sharedFolder: '', ...NO_ENV })).toBe('')
})

test('the sessions folder override wins (trimmed, no trailing slashes) even with the switch off', () => {
  expect(sessionsFolderFor({ shareSessions: false, sessionsDirectory: ' /Users/me/.claude/sessions/ ', ...NO_ENV })).toBe('/Users/me/.claude/sessions')
  expect(sessionsFolderFor({ shareSessions: true, sessionsDirectory: '/x/sessions', configDir: '/cfg', home: '/home/u' })).toBe('/x/sessions')
  expect(sessionsFolderFor({ shareSessions: false, sessionsDirectory: '   ', ...NO_ENV })).toBe('')
})

test('with the switch on and no override, the sessions folder is CLAUDE_CONFIG_DIR/sessions, else HOME/.claude/sessions', () => {
  expect(sessionsFolderFor({ shareSessions: true, sessionsDirectory: '', configDir: '/cfg/claude/', home: '/home/u' })).toBe('/cfg/claude/sessions')
  expect(sessionsFolderFor({ shareSessions: true, sessionsDirectory: '', configDir: '', home: '/home/u/' })).toBe('/home/u/.claude/sessions')
})

test('with the switch off and no override, the sessions folder is empty whatever the environment', () => {
  expect(sessionsFolderFor({ shareSessions: false, sessionsDirectory: '', configDir: '/cfg', home: '/home/u' })).toBe('')
  expect(sessionsFolderFor({ shareSessions: false, sessionsDirectory: '', ...NO_ENV })).toBe('')
})

test('with the switch on and neither CLAUDE_CONFIG_DIR nor HOME known, the sessions folder stays off', () => {
  expect(sessionsFolderFor({ shareSessions: true, sessionsDirectory: '', ...NO_ENV })).toBe('')
})

test('the summary path is one json file per session in the folder, with no doubled slash', () => {
  expect(summaryPath('/Users/me/shared', 'abc')).toBe('/Users/me/shared/abc.json')
  expect(summaryPath('/Users/me/shared/', 'abc')).toBe('/Users/me/shared/abc.json')
})

test('anyActiveOf is true while an own agent is working or pending, never for idle or finished ones', () => {
  expect(anyActiveOf(colonyWith([added('main')]))).toBe(false)
  expect(anyActiveOf(colonyWith([added('main'), state('main', 'in-progress')]))).toBe(true)
  expect(anyActiveOf(colonyWith([added('main'), state('main', 'pending')]))).toBe(true)
  expect(anyActiveOf(colonyWith([added('main'), state('main', 'completed')]))).toBe(false)
})
