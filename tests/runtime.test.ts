import { test, expect } from 'claude-code/testing'
import {
  animates,
  contextFor,
  nextRecentAgent,
  pendingIdsOf,
  readOptions,
  attentionOf,
  shouldAutoOpen,
  shouldToastPending,
  statusFor,
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

test('readOptions defaults to motion on and 30 s retention', () => {
  expect(readOptions(undefined)).toEqual({ reducedMotion: false, retentionMs: 30_000, sessionsDirectory: '' })
  expect(readOptions({})).toEqual({ reducedMotion: false, retentionMs: 30_000, sessionsDirectory: '' })
})

test('readOptions reads reduced motion and retention seconds from options', () => {
  expect(readOptions({ reducedMotion: true, retentionSeconds: 5 })).toEqual({
    reducedMotion: true,
    retentionMs: 5_000,
    sessionsDirectory: '',
  })
  expect(readOptions({ reducedMotion: 'true', retentionSeconds: '12' })).toEqual({
    reducedMotion: true,
    retentionMs: 12_000,
    sessionsDirectory: '',
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
