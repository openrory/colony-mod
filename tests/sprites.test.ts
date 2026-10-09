import { test, expect } from 'claude-code/testing'
import { SPRITES, STATE_COLOUR, frameOf, renderSprite, spriteFor } from '../src/sprites'

const STATES = [
  'idle',
  'in-progress',
  'pending',
  'listening',
  'completed',
  'failed',
  'cancelled',
  'unknown',
] as const

test('every drawn state has a sprite with at least one frame', () => {
  for (const state of STATES) {
    expect(SPRITES[state]).toBeDefined()
    expect(SPRITES[state]!.frames.length).toBeGreaterThan(0)
  }
})

test('every state has a colour name kept apart from the grids', () => {
  for (const state of STATES) expect(typeof STATE_COLOUR[state]).toBe('string')
})

test('no two states share identical first frames', () => {
  const firsts = STATES.map(s => SPRITES[s]!.frames[0]!.join('\n'))
  expect(new Set(firsts).size).toBe(STATES.length)
})

test('each state differs from every other in shape, ignoring colour', () => {
  for (const a of STATES) {
    for (const b of STATES) {
      if (a === b) continue
      expect(SPRITES[a]!.frames[0]!.join('\n')).not.toBe(SPRITES[b]!.frames[0]!.join('\n'))
    }
  }
})

test('the listening first frame differs in shape from every other state (any frame, any state)', () => {
  const listening = SPRITES.listening!.frames[0]!.join('\n')
  for (const state of STATES) {
    if (state === 'listening') continue
    for (const frame of SPRITES[state]!.frames) {
      expect(frame.join('\n')).not.toBe(listening)
    }
  }
})

test('every grid is rectangular and uses only #, o (an eye) and .', () => {
  for (const state of STATES) {
    const grids = [...SPRITES[state]!.frames, ...(SPRITES[state]!.reaction ? [SPRITES[state]!.reaction!] : [])]
    for (const frame of grids) {
      const width = frame[0]!.length
      expect(frame.length).toBe(8)
      for (const row of frame) {
        expect(row.length).toBe(width)
        expect(/^[#o.]+$/.test(row)).toBe(true)
      }
    }
  }
})

test('failed and cancelled endings are static and have their own drawings', () => {
  expect(SPRITES.failed!.frames.length).toBe(1)
  expect(SPRITES.cancelled!.frames.length).toBe(1)
  expect(SPRITES.failed).not.toBe(SPRITES.unknown)
  expect(SPRITES.cancelled).not.toBe(SPRITES.failed)
  expect(spriteFor('failed')).toBe(SPRITES.failed!)
  expect(spriteFor('cancelled')).toBe(SPRITES.cancelled!)
})

test('animated states have two frames, unknown is static', () => {
  expect(SPRITES.idle!.frames.length).toBe(2)
  expect(SPRITES['in-progress']!.frames.length).toBe(2)
  expect(SPRITES.pending!.frames.length).toBe(2)
  expect(SPRITES.completed!.frames.length).toBe(2)
  expect(SPRITES.unknown!.frames.length).toBe(1)
})

test('listening pulses its antenna over two frames and has a reaction frame', () => {
  expect(SPRITES.listening!.frames.length).toBe(2)
  expect(SPRITES.listening!.reaction).toBeDefined()
  expect(SPRITES.listening!.reaction).not.toEqual(SPRITES.listening!.frames[0])
  expect(SPRITES.listening!.reaction).not.toEqual(SPRITES.listening!.frames[1])
})

test('frameOf pulses listening over time and shows the reaction frame while reacting', () => {
  expect(frameOf('listening', 0, false)).toEqual(SPRITES.listening!.frames[0])
  expect(frameOf('listening', 2, false)).toEqual(SPRITES.listening!.frames[1])
  expect(frameOf('listening', 0, true)).toEqual(SPRITES.listening!.reaction)
  expect(frameOf('listening', 2, true)).toEqual(SPRITES.listening!.reaction)
  // A state without a reaction frame keeps its ordinary animation even when flagged.
  expect(frameOf('idle', 2, true)).toEqual(SPRITES.idle!.frames[1])
})

test('renderSprite maps row pairs to half-block characters', () => {
  expect(renderSprite(['#.', '.#'])).toEqual(['▀▄'])
  expect(renderSprite(['##', '##'])).toEqual(['██'])
  expect(renderSprite(['..', '..'])).toEqual(['  '])
  expect(renderSprite(['#.', '#.', '..', '..'])).toEqual(['█ ', '  '])
  expect(renderSprite(['#.', '..', '..', '.#'])).toEqual(['▀ ', ' ▄'])
})

test('renderSprite of an 8x8 grid gives 4 text rows of width 8', () => {
  const lines = renderSprite(SPRITES.idle!.frames[0]!)
  expect(lines.length).toBe(4)
  for (const line of lines) expect([...line].length).toBe(8)
})

test('spriteFor returns the listening drawing and falls back to unknown only for unknown states', () => {
  expect(spriteFor('listening')).toBe(SPRITES.listening!)
  expect(spriteFor('pending')).toBe(SPRITES.pending!)
})
