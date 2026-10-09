import { test, expect } from 'claude-code/testing'
import { resolveState } from '../src/priority'
import type { AgentState } from '../types'

// Precedence: pending > listening > in-progress > failed/cancelled > completed > idle > unknown
const ORDER: AgentState[] = [
  'pending',
  'listening',
  'in-progress',
  'failed',
  'completed',
  'idle',
  'unknown',
]

test('pending beats every other state', () => {
  const others: AgentState[] = [
    'listening',
    'in-progress',
    'failed',
    'cancelled',
    'completed',
    'idle',
    'unknown',
  ]
  for (const other of others) {
    expect(resolveState(['pending', other])).toBe('pending')
    expect(resolveState([other, 'pending'])).toBe('pending')
  }
})

test('every pairwise precedence holds in both orders', () => {
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      expect(resolveState([ORDER[i]!, ORDER[j]!])).toBe(ORDER[i]!)
      expect(resolveState([ORDER[j]!, ORDER[i]!])).toBe(ORDER[i]!)
    }
  }
})

test('listening beats in-progress, in-progress beats failed and cancelled', () => {
  expect(resolveState(['in-progress', 'listening'])).toBe('listening')
  expect(resolveState(['cancelled', 'in-progress'])).toBe('in-progress')
  expect(resolveState(['failed', 'in-progress'])).toBe('in-progress')
})

test('failed and cancelled beat completed, which beats idle and unknown', () => {
  expect(resolveState(['completed', 'failed'])).toBe('failed')
  expect(resolveState(['completed', 'cancelled'])).toBe('cancelled')
  expect(resolveState(['idle', 'completed'])).toBe('completed')
  expect(resolveState(['unknown', 'idle'])).toBe('idle')
})

test('a single candidate resolves to itself and no candidates resolve to unknown', () => {
  expect(resolveState(['idle'])).toBe('idle')
  expect(resolveState([])).toBe('unknown')
})
