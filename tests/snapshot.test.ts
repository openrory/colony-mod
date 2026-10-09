import { test, expect } from 'claude-code/testing'
import { buildSummary, endedSummary, parseSummary } from '../src/snapshot'
import { initialColony, reduce, type Signal } from '../src/model'
import type { Agent, Colony } from '../types'

const SESSION = { id: 'sess-1', name: 'app', folder: '/Users/me/app' }
const NOW = 1_791_536_256_952

function colonyWith(signals: Signal[]): Colony {
  return signals.reduce(reduce, initialColony(30_000))
}

const added = (id: string, parentId: string | null = 'main'): Signal => ({
  type: 'agent-added',
  id,
  label: id,
  parentId,
  at: 1,
})
const state = (id: string, s: 'in-progress' | 'pending' | 'idle'): Signal => ({
  type: 'agent-state',
  id,
  state: s,
  at: 2,
})

const AGENT_KEYS = ['id', 'label', 'parentId', 'state', 'listenSource', 'model', 'tokens']
const SUMMARY_KEYS = ['version', 'sessionId', 'name', 'folder', 'updatedAt', 'ended', 'agents', 'exchanges']

test('buildSummary carries exactly the contract fields, even when agents carry extra fields', () => {
  const base = colonyWith([
    added('main', null),
    state('main', 'in-progress'),
    added('a'),
    state('a', 'pending'),
    { type: 'agent-usage', id: 'a', usage: { input: 10, output: 5, cacheRead: 999, cacheWrite: 888 }, at: 3 },
    { type: 'agent-meta', id: 'a', model: 'claude-haiku-5-5', at: 3 },
    { type: 'exchange-open', fromId: 'main', toId: 'a', reason: 'message', at: 4 },
  ])
  // Smuggle conversation content and every other field into the input, as a future change might.
  const polluted: Colony = {
    ...base,
    agents: {
      ...base.agents,
      a: {
        ...base.agents.a,
        note: 'NOTE-SECRET',
        prompt: 'PROMPT-SECRET',
        toolText: 'TOOL-SECRET',
        messages: ['MESSAGE-SECRET'],
      } as unknown as Agent,
    },
    secretColonyField: 'COLONY-SECRET',
  } as unknown as Colony

  const summary = buildSummary(polluted, SESSION, NOW)
  expect(Object.keys(summary).sort()).toEqual([...SUMMARY_KEYS].sort())
  expect(summary.version).toBe(1)
  expect(summary.sessionId).toBe('sess-1')
  expect(summary.name).toBe('app')
  expect(summary.folder).toBe('/Users/me/app')
  expect(summary.updatedAt).toBe(NOW)
  expect(summary.ended).toBe(false)
  for (const agent of summary.agents) expect(Object.keys(agent).sort()).toEqual([...AGENT_KEYS].sort())

  const a = summary.agents.find(x => x.id === 'a')!
  expect(a).toEqual({
    id: 'a',
    label: 'a',
    parentId: 'main',
    state: 'pending',
    listenSource: null,
    model: 'claude-haiku-5-5',
    tokens: { in: 10, out: 5 },
  })
  expect(summary.exchanges).toEqual([{ from: 'main', to: 'a' }])

  const text = JSON.stringify(summary)
  for (const secret of ['NOTE-SECRET', 'PROMPT-SECRET', 'TOOL-SECRET', 'MESSAGE-SECRET', 'COLONY-SECRET', 'cacheRead', 'cacheWrite']) {
    expect(text.includes(secret)).toBe(false)
  }
})

test('labels longer than 40 characters are cut to 40', () => {
  const colony = colonyWith([
    { type: 'agent-added', id: 'long', label: 'x'.repeat(60), parentId: 'main', at: 1 },
  ])
  const summary = buildSummary(colony, SESSION, NOW)
  expect(summary.agents.find(x => x.id === 'long')!.label).toBe('x'.repeat(40))
})

test('more than 100 agents are cut to 100, dropping the oldest completed first', () => {
  const signals: Signal[] = [added('main', null), state('main', 'in-progress')]
  // 10 completed subagents with the oldest end times, then 94 still working.
  for (let i = 0; i < 10; i++) {
    signals.push(added(`done${i}`))
    signals.push({ type: 'agent-ended', id: `done${i}`, state: 'completed', at: 100 + i })
  }
  for (let i = 0; i < 94; i++) {
    signals.push(added(`run${i}`))
    signals.push(state(`run${i}`, 'in-progress'))
  }
  // 1 + 10 + 94 = 105 agents: 5 must go, and they are the five oldest completed ones.
  const summary = buildSummary(colonyWith(signals), SESSION, NOW)
  expect(summary.agents.length).toBe(100)
  const ids = summary.agents.map(x => x.id)
  for (let i = 0; i < 5; i++) expect(ids.includes(`done${i}`)).toBe(false)
  for (let i = 5; i < 10; i++) expect(ids.includes(`done${i}`)).toBe(true)
  for (let i = 0; i < 94; i++) expect(ids.includes(`run${i}`)).toBe(true)
  expect(ids.includes('main')).toBe(true)
})

test('agent ids are unique in the output', () => {
  const colony = colonyWith([added('main', null), added('a'), added('b'), state('a', 'idle')])
  const ids = buildSummary(colony, SESSION, NOW).agents.map(x => x.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('figures of other sessions and exchanges with them are never shared', () => {
  const colony = colonyWith([
    added('main', null),
    added('a'),
    { type: 'peers', peers: [{ id: 'session:other', label: 'other', state: 'in-progress', note: 'n' }], at: 1 },
    { type: 'exchange-open', fromId: 'main', toId: 'session:other', reason: 'waiting', at: 2 },
  ])
  const summary = buildSummary(colony, SESSION, NOW)
  expect(summary.agents.map(x => x.id).sort()).toEqual(['a', 'main'])
  expect(summary.exchanges).toEqual([])
})

test('endedSummary carries only version, session id, time and the ended marker', () => {
  const ended = endedSummary(SESSION, NOW)
  expect(ended).toEqual({ version: 1, sessionId: 'sess-1', updatedAt: NOW, ended: true, agents: [] })
  expect(Object.keys(ended).sort()).toEqual(['agents', 'ended', 'sessionId', 'updatedAt', 'version'])
})

const valid = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    sessionId: 'sess-1',
    name: 'app',
    folder: '/Users/me/app',
    updatedAt: NOW,
    ended: false,
    agents: [
      { id: 'main', label: 'main', parentId: null, state: 'in-progress', listenSource: null, model: 'sonnet', tokens: { in: 1200, out: 500 } },
      { id: 'a1b2', label: 'US2 layout', parentId: 'main', state: 'pending', listenSource: null, model: 'haiku', tokens: null },
    ],
    exchanges: [{ from: 'main', to: 'a1b2' }],
    ...over,
  })

test('parseSummary accepts a valid v1 summary and ignores unknown extra fields', () => {
  const parsed = parseSummary(valid({ extra: 'EXTRA', agents: [
    { id: 'main', label: 'main', parentId: null, state: 'idle', listenSource: null, model: null, tokens: null, prompt: 'P' },
  ] }))
  expect(parsed).not.toBe(null)
  expect(parsed!.sessionId).toBe('sess-1')
  expect(parsed!.agents[0]).toEqual({ id: 'main', label: 'main', parentId: null, state: 'idle', listenSource: null, model: null, tokens: null })
  expect((parsed as unknown as Record<string, unknown>).extra).toBe(undefined)
  expect(JSON.stringify(parsed).includes('EXTRA')).toBe(false)
  expect(parseSummary(valid())!.agents.length).toBe(2)
})

test('parseSummary rejects invalid JSON, another version, a missing session id and a non-finite time', () => {
  expect(parseSummary('{not json')).toBe(null)
  expect(parseSummary(valid({ version: 2 }))).toBe(null)
  expect(parseSummary(valid({ version: undefined }))).toBe(null)
  expect(parseSummary(valid({ sessionId: undefined }))).toBe(null)
  expect(parseSummary(valid({ sessionId: '' }))).toBe(null)
  expect(parseSummary(valid({ updatedAt: null }))).toBe(null)
  expect(parseSummary(valid({ updatedAt: 'soon' }))).toBe(null)
})

test('parseSummary rejects a label over 200 characters and more than 100 agents', () => {
  const longAgent = { id: 'x', label: 'y'.repeat(201), parentId: null, state: 'idle', listenSource: null, model: null, tokens: null }
  expect(parseSummary(valid({ agents: [longAgent] }))).toBe(null)
  const many = Array.from({ length: 101 }, (_, i) => ({ id: `a${i}`, label: 'a', parentId: null, state: 'idle', listenSource: null, model: null, tokens: null }))
  expect(parseSummary(valid({ agents: many }))).toBe(null)
})

test('parseSummary maps an unknown state to unknown', () => {
  const parsed = parseSummary(valid({ agents: [
    { id: 'x', label: 'x', parentId: null, state: 'dancing', listenSource: null, model: null, tokens: null },
  ] }))
  expect(parsed!.agents[0]!.state).toBe('unknown')
})

test('parseSummary rejects a file whose agent ids repeat', () => {
  const twin = { id: 'x', label: 'x', parentId: null, state: 'idle', listenSource: null, model: null, tokens: null }
  expect(parseSummary(valid({ agents: [twin, twin] }))).toBe(null)
})

test('parseSummary reads an ended marker as ended with no agents', () => {
  const parsed = parseSummary(JSON.stringify({ version: 1, sessionId: 'sess-1', updatedAt: NOW, ended: true, agents: [] }))
  expect(parsed).not.toBe(null)
  expect(parsed!.ended).toBe(true)
  expect(parsed!.agents).toEqual([])
})
