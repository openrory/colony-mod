import { test, expect } from 'claude-code/testing'
import { observe } from '../src/observe'

// Stand-in for the engine's next: records what it was given and answers with a fixed result.
function makeNext<E>(answer: string) {
  const seen: E[] = []
  const next = (e: E) => {
    seen.push(e)
    return answer
  }
  return { next, seen }
}

test('observer returns next(e) with the event unchanged', async () => {
  const seenByHandler: unknown[] = []
  const hook = observe<object, { tool: string }, string>((_$, e) => {
    seenByHandler.push(e)
  })
  const event = { tool: 'Bash' }
  const { next, seen } = makeNext<{ tool: string }>('answer')
  const result = await hook({}, event, next)
  expect(result).toBe('answer')
  expect(seen).toEqual([event])
  expect(seen[0]).toBe(event)
  expect(seenByHandler).toEqual([event])
})

test('observer still returns next(e) when the handler throws', async () => {
  const errors: unknown[] = []
  const hook = observe<object, { tool: string }, string>(
    () => {
      throw new Error('boom')
    },
    error => errors.push(error),
  )
  const event = { tool: 'Read' }
  const { next, seen } = makeNext<{ tool: string }>('passed')
  const result = await hook({}, event, next)
  expect(result).toBe('passed')
  expect(seen[0]).toBe(event)
  expect(errors.length).toBe(1)
})

test('observer still returns next(e) when an async handler rejects', async () => {
  const hook = observe<object, { n: number }, number>(async () => {
    throw new Error('async boom')
  })
  const event = { n: 7 }
  const { next } = makeNext<{ n: number }>(0 as unknown as string)
  const result = await hook({}, event, e => e.n)
  expect(result).toBe(7)
})

test('a handler that throws does not stop next from seeing the same event object', async () => {
  const hook = observe<object, { id: string }, { id: string }>(() => {
    throw new TypeError('nope')
  })
  const event = { id: 'x' }
  const result = await hook({}, event, e => e)
  expect(result).toBe(event)
})
