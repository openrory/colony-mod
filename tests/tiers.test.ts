import { test, expect } from 'claude-code/testing'
import { compact, detailsOf, fillOf, pixelsOf, tierOf, windowOf, wrap } from '../src/tiers'
import { initialColony, reduce } from '../src/model'
import type { Agent } from '../types'

function agentWith(change: Partial<Agent> = {}): Agent {
  const c = reduce(initialColony(30_000), { type: 'agent-added', id: 'a', label: 'Find the flaky test', parentId: 'main', at: 0 })
  return { ...c.agents.a!, ...change }
}

test('model ids and aliases map to a tier, unknown ones to none', () => {
  expect(tierOf('haiku')).toBe('haiku')
  expect(tierOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(tierOf('claude-opus-5-5')).toBe('opus')
  expect(tierOf('claude-fable-5-1')).toBe('fable')
  expect(tierOf('mystery')).toBe(null)
  expect(tierOf(null)).toBe(null)
})

test('a bigger model is a bigger figure, and an unknown one is the base drawing', () => {
  const sizes = ['haiku', 'sonnet', 'opus', 'fable'].map(m => pixelsOf(m))
  expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  expect(new Set(sizes).size).toBe(4)
  expect(pixelsOf(null)).toBe(pixelsOf('haiku'))
})

test('context fill is the tokens over the window, clamped, and null while unknown', () => {
  expect(fillOf(agentWith())).toBe(null)
  expect(fillOf(agentWith({ model: 'haiku', contextTokens: 50_000 }))).toBe(0.25)
  expect(fillOf(agentWith({ model: 'haiku', contextTokens: 900_000 }))).toBe(1)
  expect(windowOf('claude-opus-5-5[1m]')).toBe(1_000_000)
  expect(windowOf('claude-opus-5-5')).toBe(1_000_000)
  expect(windowOf('claude-haiku-5-5')).toBe(1_000_000)
  expect(windowOf('claude-opus-4-1')).toBe(200_000)
})

test('compact numbers and word wrapping', () => {
  expect(compact(950)).toBe('950')
  expect(compact(1234)).toBe('1.2k')
  expect(compact(48_000)).toBe('48k')
  expect(compact(2_500_000)).toBe('2.5M')
  expect(wrap('one two three', 7)).toEqual(['one two', 'three'])
  expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
})

test('the hover card names state, model, tokens, context and origin', () => {
  const lines = detailsOf(
    agentWith({
      model: 'claude-haiku-5-5',
      usage: { input: 1000, output: 500, cacheRead: 4000, cacheWrite: 200 },
      contextTokens: 100_000,
      spawnedBy: 'ci-bot',
      addressable: true,
    }),
    'in-progress',
  )
  expect(lines[0]).toBe('working')
  expect(lines).toContain('claude-haiku-5-5 (haiku)')
  expect(lines).toContain('tokens 1.2k in, 500 out')
  expect(lines).toContain('cache read 4.0k')
  expect(lines).toContain('context ~10% of 1.0M')
  expect(lines).toContain('started by ci-bot')
  expect(lines).toContain('reusable')
  expect(detailsOf(agentWith(), 'idle')).toContain('tokens not reported yet')
})
