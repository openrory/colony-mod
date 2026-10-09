import { test, expect } from 'claude-code/testing'
import { stream } from '../src/particles'

test('the stream has the requested width and only 0 and 1 glyphs', () => {
  for (const width of [0, 1, 2, 7, 12]) {
    const s = stream(width, 3)
    expect([...s].length).toBe(width)
    expect(/^[01]*$/.test(s)).toBe(true)
  }
})

test('the stream is deterministic for a given tick', () => {
  expect(stream(10, 4)).toBe(stream(10, 4))
})

test('every glyph flips on the next tick', () => {
  const a = [...stream(10, 5)]
  const b = [...stream(10, 6)]
  for (let i = 0; i < a.length; i++) expect(a[i]).not.toBe(b[i])
})

test('the stream shifts by one glyph per tick', () => {
  const now = stream(10, 8)
  const next = stream(10, 9)
  expect(next.slice(0, -1)).toBe(now.slice(1))
})

test('the stream works for negative and large ticks', () => {
  expect([...stream(6, -1)].every(c => c === '0' || c === '1')).toBe(true)
  expect(stream(6, 1_000_001)).toBe(stream(6, 1_000_001))
})
