import { test, expect } from 'claude-code/testing'
import {
  initialColony,
  reduce,
  shownStateOf,
  SILENCE_MS,
  BURST_MS,
  MAIN_DONE_MS,
  WANDER_MAX,
  type Signal,
} from '../src/model'
import type { Agent, Colony, SessionGroup } from '../types'

const RETENTION = 30_000

function at(c: Colony, id: string): Agent {
  const agent = c.agents[id]
  if (!agent) throw new Error(`agent ${id} is missing`)
  return agent
}

function run(signals: Signal[], start: Colony = initialColony(RETENTION)): Colony {
  return signals.reduce(reduce, start)
}

function withMain(): Colony {
  return run([{ type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 }])
}

test('main starts idle and walks turn start, complete, idle', () => {
  let c = withMain()
  expect(at(c, 'main').state).toBe('idle')
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'in-progress', at: 100 })
  expect(at(c, 'main').state).toBe('in-progress')
  expect(at(c, 'main').endedAt).toBe(null)
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'completed', at: 200 })
  expect(at(c, 'main').state).toBe('completed')
  expect(at(c, 'main').endedAt).toBe(200)
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'idle', at: 300 })
  expect(at(c, 'main').state).toBe('idle')
  expect(at(c, 'main').endedAt).toBe(null)
})

test('subagent lifecycle: spawn, pending, in-progress, completed', () => {
  let c = withMain()
  c = reduce(c, { type: 'agent-added', id: 'sub', label: 'Explore', parentId: 'main', at: 10 })
  expect(at(c, 'sub').state).toBe('idle')
  expect(at(c, 'sub').parentId).toBe('main')
  c = reduce(c, { type: 'agent-state', id: 'sub', state: 'in-progress', at: 20 })
  c = reduce(c, { type: 'agent-state', id: 'sub', state: 'pending', at: 30 })
  expect(at(c, 'sub').state).toBe('pending')
  c = reduce(c, { type: 'agent-state', id: 'sub', state: 'in-progress', at: 40 })
  c = reduce(c, { type: 'agent-ended', id: 'sub', state: 'completed', at: 50 })
  expect(at(c, 'sub').state).toBe('completed')
  expect(at(c, 'sub').endedAt).toBe(50)
})

test('failed and cancelled end states are recorded', () => {
  let c = run([
    { type: 'agent-added', id: 'a', label: 'a', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'a', state: 'failed', at: 5 },
  ])
  expect(at(c, 'a').state).toBe('failed')
  c = reduce(c, { type: 'agent-ended', id: 'a', state: 'cancelled', at: 9 })
  expect(at(c, 'a').state).toBe('cancelled')
})

test('listening carries its source, defaulting to external', () => {
  let c = withMain()
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'listening', listenSource: 'github', at: 1 })
  expect(at(c, 'main').listenSource).toBe('github')
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'listening', at: 2 })
  expect(at(c, 'main').listenSource).toBe('external')
  // Later work does not end the registration; only an inbound event does (see the US3 tests below).
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'in-progress', at: 3 })
  expect(at(c, 'main').listenSource).toBe('external')
  // While working, the agent is drawn working; the listening look returns once it is at rest (FR-010).
  expect(shownStateOf(at(c, 'main'))).toBe('in-progress')
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'idle', at: 4 })
  expect(shownStateOf(at(c, 'main'))).toBe('listening')
})

test('retention removes failed and cancelled subagents too, never main', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'f', label: 'f', parentId: 'main', at: 0 },
    { type: 'agent-added', id: 'x', label: 'x', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'f', state: 'failed', at: 1000 },
    { type: 'agent-ended', id: 'x', state: 'cancelled', at: 1000 },
    { type: 'agent-state', id: 'main', state: 'failed', at: 1000 },
  ])
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION - 1 })
  expect(c.agents.f).toBeDefined()
  expect(c.agents.x).toBeDefined()
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION })
  expect(c.agents.f).toBe(undefined)
  expect(c.agents.x).toBe(undefined)
  expect(c.agents.main).toBeDefined()
})

test('retention removes completed subagents after retentionMs, never main', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-ended', id: 'sub', state: 'completed', at: 1000 },
    { type: 'agent-state', id: 'main', state: 'completed', at: 1000 },
  ])
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION - 1 })
  expect(c.agents.sub).toBeDefined()
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION })
  expect(c.agents.sub).toBe(undefined)
  expect(c.agents.main).toBeDefined()
})

test('retention does not remove running or failed subagents', () => {
  let c = run([
    { type: 'agent-added', id: 'run', label: 'run', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'run', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, { type: 'tick', at: 10 * RETENTION })
  expect(c.agents.run).toBeDefined()
})

test('tick advances the counter', () => {
  const c = reduce(withMain(), { type: 'tick', at: 1 })
  expect(c.tick).toBe(1)
})

test('silent working subagent becomes unknown after 60 s with no list status', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, { type: 'tick', at: SILENCE_MS - 1 })
  expect(at(c, 'sub').state).toBe('in-progress')
  c = reduce(c, { type: 'tick', at: SILENCE_MS })
  expect(at(c, 'sub').state).toBe('unknown')
})

test('idle and completed agents never become unknown from silence', () => {
  // Long retention so the completed subagent is still present after the silent period.
  let c = run(
    [
      { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
      { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
      { type: 'agent-ended', id: 'sub', state: 'completed', at: 0 },
    ],
    initialColony(100 * SILENCE_MS),
  )
  c = reduce(c, { type: 'tick', at: 10 * SILENCE_MS })
  expect(at(c, 'main').state).toBe('idle')
  expect(at(c, 'sub').state).toBe('completed')
})

test('a long tool call never flips the main agent to unknown', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, { type: 'tick', at: 10 * SILENCE_MS })
  expect(at(c, 'main').state).toBe('in-progress')
  c = reduce(c, { type: 'reconcile', at: 10 * SILENCE_MS, listed: [] })
  expect(at(c, 'main').state).toBe('in-progress')
})

test('a reconcile-listed subagent is not made unknown by later silence', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, {
    type: 'reconcile',
    at: 1,
    listed: [{ id: 'sub', label: 'sub', parentId: 'main', state: 'in-progress' }],
  })
  c = reduce(c, { type: 'tick', at: 10 * SILENCE_MS })
  expect(at(c, 'sub').state).toBe('in-progress')
  expect(at(c, 'sub').listed).toBe(true)
})

test('an agent the list stops naming is judged by silence again', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 0 },
    { type: 'reconcile', at: 1, listed: [{ id: 'sub', label: 'sub', parentId: 'main', state: 'in-progress' }] },
  ])
  c = reduce(c, { type: 'reconcile', at: 2, listed: [] })
  c = reduce(c, { type: 'tick', at: SILENCE_MS + 2 })
  expect(at(c, 'sub').state).toBe('unknown')
})

test('reconcile: list status wins over inferred state', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, {
    type: 'reconcile',
    at: 5,
    listed: [{ id: 'sub', label: 'sub', parentId: 'main', state: 'failed' }],
  })
  expect(at(c, 'sub').state).toBe('failed')
  expect(at(c, 'sub').endedAt).toBe(5)
})

test('reconcile adds agents the model has not seen', () => {
  const c = reduce(withMain(), {
    type: 'reconcile',
    at: 5,
    listed: [{ id: 'x', label: 'Plan', parentId: 'main', state: 'pending' }],
  })
  expect(at(c, 'x').state).toBe('pending')
  expect(at(c, 'x').parentId).toBe('main')
})

test('reconcile: an unlisted working agent that stays silent becomes unknown', () => {
  let c = run([
    { type: 'agent-added', id: 'ghost', label: 'ghost', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'ghost', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, { type: 'reconcile', at: SILENCE_MS, listed: [] })
  expect(at(c, 'ghost').state).toBe('unknown')
})

test('reconcile: a listed agent is not made unknown by silence', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 0 },
  ])
  c = reduce(c, {
    type: 'reconcile',
    at: SILENCE_MS,
    listed: [{ id: 'sub', label: 'sub', parentId: 'main', state: 'in-progress' }],
  })
  expect(at(c, 'sub').state).toBe('in-progress')
})

test('spawn opens a burst exchange that stays while waiting, then result closes waiting', () => {
  let c = withMain()
  c = reduce(c, { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'spawn', at: 0 })
  c = reduce(c, { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'waiting', at: 0 })
  const ex = c.exchanges['main>sub']!
  expect(ex.reasons.sort()).toEqual(['spawn', 'waiting'])
  expect(ex.burstUntil).toBe(BURST_MS)
  c = reduce(c, { type: 'exchange-close', fromId: 'main', toId: 'sub', reason: 'waiting', at: 2000 })
  expect(c.exchanges['main>sub']).toBe(undefined)
})

test('an exchange with a live burst survives a close and is removed by tick afterwards', () => {
  let c = withMain()
  c = reduce(c, { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'result', at: 0 })
  c = reduce(c, { type: 'exchange-close', fromId: 'main', toId: 'sub', reason: 'waiting', at: 100 })
  expect(c.exchanges['main>sub']).toBeDefined()
  c = reduce(c, { type: 'tick', at: BURST_MS })
  expect(c.exchanges['main>sub']).toBe(undefined)
})

test('exchanges are dropped when an endpoint is removed by retention', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'sub', state: 'completed', at: 0 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'waiting', at: 0 },
  ])
  c = reduce(c, { type: 'tick', at: RETENTION })
  expect(c.agents.sub).toBe(undefined)
  expect(Object.keys(c.exchanges)).toEqual([])
})

test('repeated signals are idempotent', () => {
  const signals: Signal[] = [
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 1 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 2 },
    { type: 'agent-state', id: 'sub', state: 'in-progress', at: 2 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'spawn', at: 3 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'spawn', at: 3 },
    { type: 'agent-ended', id: 'sub', state: 'completed', at: 4 },
    { type: 'agent-ended', id: 'sub', state: 'completed', at: 4 },
  ]
  const once = run(signals)
  const twice = run([...signals, ...signals])
  expect(twice.agents).toEqual(once.agents)
  expect(twice.exchanges).toEqual(once.exchanges)
})

test('agent-added for an existing id does not reset its state', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'pending', at: 1 },
  ])
  c = reduce(c, { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 2 })
  expect(at(c, 'sub').state).toBe('pending')
})

test('main completed returns to idle after MAIN_DONE_MS and is never removed', () => {
  let c = withMain()
  c = reduce(c, { type: 'agent-state', id: 'main', state: 'completed', at: 1000 })
  c = reduce(c, { type: 'tick', at: 1000 + MAIN_DONE_MS - 1 })
  expect(at(c, 'main').state).toBe('completed')
  c = reduce(c, { type: 'tick', at: 1000 + MAIN_DONE_MS })
  expect(at(c, 'main').state).toBe('idle')
  expect(at(c, 'main').endedAt).toBe(null)
  c = reduce(c, { type: 'tick', at: 10 * RETENTION })
  expect(at(c, 'main').state).toBe('idle')
})

// ---- Easing of the proximity shift (T027) ------------------------------------------------

test('a live burst eases both figures out to two columns, one column per tick, then back out', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'spawn', at: 0 },
  ])
  expect(at(c, 'sub').shift).toBe(0)
  c = reduce(c, { type: 'tick', at: 100 })
  expect(at(c, 'sub').shift).toBe(1)
  c = reduce(c, { type: 'tick', at: 200 })
  expect(at(c, 'sub').shift).toBe(2)
  expect(at(c, 'main').shift).toBe(2)
  // The burst ends at BURST_MS: the exchange has no reasons left but stays while figures ease back.
  c = reduce(c, { type: 'tick', at: BURST_MS + 100 })
  expect(at(c, 'sub').shift).toBe(1)
  expect(c.exchanges['main>sub']).toBeDefined()
  c = reduce(c, { type: 'tick', at: BURST_MS + 200 })
  expect(at(c, 'sub').shift).toBe(0)
  expect(c.exchanges['main>sub']).toBe(undefined)
})

test('a waiting exchange holds one column for as long as the wait lasts', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'waiting', at: 0 },
  ])
  c = reduce(c, { type: 'tick', at: 100 })
  c = reduce(c, { type: 'tick', at: 5000 })
  expect(at(c, 'sub').shift).toBe(1)
  expect(at(c, 'main').shift).toBe(1)
  c = reduce(c, { type: 'exchange-close', fromId: 'main', toId: 'sub', reason: 'waiting', at: 6000 })
  c = reduce(c, { type: 'tick', at: 6100 })
  expect(at(c, 'sub').shift).toBe(0)
  expect(c.exchanges['main>sub']).toBe(undefined)
})

test('agent-added for a known agent takes the parent it was given when it had none', () => {
  let c = withMain()
  c = reduce(c, { type: 'agent-added', id: 'sub', label: 'sub', parentId: null, at: 1 })
  c = reduce(c, { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 2 })
  expect(at(c, 'sub').parentId).toBe('main')
})

// ---- US3 (T033): listening, reaction flash and precedence ----------------------------------

const FLASH = 1000

test('listening -> reaction flash -> in-progress, the flash consumed by tick', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'Watcher', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'github', at: 10 },
  ])
  expect(shownStateOf(at(c, 'sub'))).toBe('listening')
  expect(at(c, 'sub').listenSource).toBe('github')

  c = reduce(c, { type: 'agent-react', id: 'sub', source: 'github', flashMs: FLASH, at: 100 })
  expect(shownStateOf(at(c, 'sub'))).toBe('listening')
  expect(at(c, 'sub').reactUntil).toBe(100 + FLASH)

  c = reduce(c, { type: 'tick', at: 100 + FLASH - 1 })
  expect(at(c, 'sub').reactUntil).toBe(100 + FLASH)
  expect(shownStateOf(at(c, 'sub'))).toBe('listening')

  c = reduce(c, { type: 'tick', at: 100 + FLASH })
  expect(at(c, 'sub').reactUntil).toBe(null)
  expect(at(c, 'sub').listenSource).toBe(null)
  expect(at(c, 'sub').state).toBe('in-progress')
  expect(shownStateOf(at(c, 'sub'))).toBe('in-progress')
})

test('a zero flash (reduced motion) leaves the reaction on the next tick, so no motion is needed', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'jira', at: 1 },
  ])
  c = reduce(c, { type: 'agent-react', id: 'sub', source: 'jira', flashMs: 0, at: 5 })
  c = reduce(c, { type: 'tick', at: 5 })
  expect(shownStateOf(at(c, 'sub'))).toBe('in-progress')
})

test('pending outranks listening: a reaction never shows over a pending agent', () => {
  let c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'pending', at: 1 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'github', at: 2 },
  ])
  expect(shownStateOf(at(c, 'sub'))).toBe('pending')
  c = reduce(c, { type: 'agent-react', id: 'sub', source: 'github', flashMs: FLASH, at: 3 })
  expect(at(c, 'sub').reactUntil).toBe(null)
  expect(shownStateOf(at(c, 'sub'))).toBe('pending')
})

test('a listener survives later work and turn end; only an inbound event consumes it', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 1 },
    { type: 'agent-state', id: 'main', state: 'listening', listenSource: 'watch', at: 2 },
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 3 },
    { type: 'agent-state', id: 'main', state: 'completed', at: 4 },
  ])
  expect(at(c, 'main').state).toBe('completed')
  expect(shownStateOf(at(c, 'main'))).toBe('listening')
  expect(at(c, 'main').listenSource).toBe('watch')
  c = reduce(c, { type: 'agent-react', id: 'main', source: 'github', flashMs: 0, at: 5 })
  c = reduce(c, { type: 'tick', at: 5 })
  expect(shownStateOf(at(c, 'main'))).toBe('in-progress')
})

test('listening is one of the states a figure can show, and a listener reduces to listening over idle', () => {
  const c = run([
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'external', at: 1 },
  ])
  expect(shownStateOf(at(c, 'sub'))).toBe('listening')
  expect(at(c, 'sub').state).toBe('idle')
})

test('a finished subagent is not revived by a late state or reaction event', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'w', state: 'completed', at: 1000 },
  ])
  c = reduce(c, { type: 'agent-state', id: 'w', state: 'in-progress', at: 2000 })
  c = reduce(c, { type: 'agent-react', id: 'w', source: 'webhook', flashMs: 0, at: 2500 })
  expect(at(c, 'w').state).toBe('completed')
  expect(at(c, 'w').endedAt).toBe(1000)
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION })
  expect(c.agents.w).toBe(undefined)
})

test('a repeated stop keeps the first end time, so retention is not extended', () => {
  let c = run([
    { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'w', state: 'completed', at: 1000 },
    { type: 'agent-ended', id: 'w', state: 'completed', at: 20_000 },
  ])
  expect(at(c, 'w').endedAt).toBe(1000)
  c = reduce(c, { type: 'tick', at: 1000 + RETENTION })
  expect(c.agents.w).toBe(undefined)
})

test('a message to a finished subagent resumes it, unlike a stray late event', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 },
    { type: 'agent-ended', id: 'w', state: 'completed', at: 1000 },
  ])
  c = reduce(c, { type: 'exchange-open', fromId: 'main', toId: 'w', reason: 'message', at: 2000 })
  expect(at(c, 'w').state).toBe('in-progress')
  expect(at(c, 'w').endedAt).toBe(null)
})

test('agent-usage adds tokens across turns; one step settles the context, more leaves the estimate', () => {
  let c = run([
    { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 },
    { type: 'agent-step', id: 'w', model: 'claude-haiku-5-5', at: 1 },
    { type: 'agent-usage', id: 'w', usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10 }, at: 2 },
  ])
  expect(at(c, 'w').model).toBe('claude-haiku-5-5')
  expect(at(c, 'w').contextTokens).toBe(180)
  expect(at(c, 'w').steps).toBe(0)
  c = run(
    [
      { type: 'agent-meta', id: 'w', contextTokens: 7000, at: 3 },
      { type: 'agent-step', id: 'w', at: 4 },
      { type: 'agent-step', id: 'w', at: 5 },
      { type: 'agent-usage', id: 'w', usage: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, at: 6 },
    ],
    c,
  )
  expect(at(c, 'w').usage).toEqual({ input: 101, output: 21, cacheRead: 51, cacheWrite: 11 })
  expect(at(c, 'w').contextTokens).toBe(7000)
})

test('usage and meta for an unknown agent are ignored', () => {
  const c = withMain()
  expect(reduce(c, { type: 'agent-usage', id: 'ghost', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, at: 1 })).toBe(c)
  expect(reduce(c, { type: 'agent-meta', id: 'ghost', model: 'haiku', at: 1 })).toBe(c)
})

test('a working subagent wanders within bounds; a talking, resting or main figure does not', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 },
    { type: 'agent-added', id: 'z', label: 'z', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'w', state: 'in-progress', at: 0 },
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 0 },
  ])
  let moved = false
  for (let t = 1; t <= 200; t++) {
    c = reduce(c, { type: 'tick', at: t * 250 })
    expect(Math.abs(at(c, 'w').wander)).toBeLessThanOrEqual(WANDER_MAX)
    if (at(c, 'w').wander !== 0) moved = true
    expect(at(c, 'main').wander).toBe(0)
    expect(at(c, 'z').wander).toBe(0)
  }
  expect(moved).toBe(true)
  // Deterministic: the same signals give the same drift.
  const again = run(
    [{ type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 }, { type: 'agent-added', id: 'w', label: 'w', parentId: 'main', at: 0 }, { type: 'agent-state', id: 'w', state: 'in-progress', at: 0 }],
  )
  const a = Array.from({ length: 50 }, (_, i) => i).reduce((col, i) => reduce(col, { type: 'tick', at: i }), again)
  const b = Array.from({ length: 50 }, (_, i) => i).reduce((col, i) => reduce(col, { type: 'tick', at: i }), again)
  expect(at(a, 'w').wander).toBe(at(b, 'w').wander)
})

test('a reusable agent that completes rests instead of being removed', () => {
  let c = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'r', label: 'reviewer', parentId: 'main', at: 0 },
    { type: 'agent-meta', id: 'r', addressable: true, at: 0 },
    { type: 'agent-ended', id: 'r', state: 'completed', at: 1000 },
  ])
  expect(at(c, 'r').state).toBe('idle')
  c = reduce(c, { type: 'tick', at: 1000 + 10 * RETENTION })
  expect(c.agents.r).toBeDefined()
  // It was never "finished", so a stray state event still reaches it (it works again).
  c = reduce(c, { type: 'agent-state', id: 'r', state: 'in-progress', at: 2000 })
  expect(at(c, 'r').state).toBe('in-progress')
})

const otherSession = (sessionId: string): SessionGroup => ({
  sessionId,
  name: 'app',
  folder: '/Users/me/app',
  updatedAt: 1,
  source: 'shared',
  freshness: 'live',
  agents: [],
  exchanges: [],
  needsAttention: false,
})

test('a sessions signal replaces the other sessions wholesale', () => {
  const start = run([{ type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 }])
  expect(start.sessions).toEqual({})
  const one = reduce(start, { type: 'sessions', sessions: { a: otherSession('a') }, at: 1 })
  expect(Object.keys(one.sessions)).toEqual(['a'])
  const two = reduce(one, { type: 'sessions', sessions: { b: otherSession('b') }, at: 2 })
  expect(Object.keys(two.sessions)).toEqual(['b'])
})

test('a sessions signal with nothing clears the other sessions', () => {
  const one = reduce(initialColony(RETENTION), { type: 'sessions', sessions: { a: otherSession('a') }, at: 1 })
  const cleared = reduce(one, { type: 'sessions', sessions: {}, at: 2 })
  expect(cleared.sessions).toEqual({})
})

test('a sessions signal leaves local agents and exchanges untouched', () => {
  const local = run([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'sub', parentId: 'main', at: 0 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub', reason: 'spawn', at: 0 },
  ])
  const after = reduce(local, { type: 'sessions', sessions: { a: otherSession('a') }, at: 5 })
  expect(after.agents).toBe(local.agents)
  expect(after.exchanges).toBe(local.exchanges)
  expect(after.tick).toBe(local.tick)
})
