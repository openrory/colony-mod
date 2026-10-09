// Original pixel-art sprites (FR-004). Each state is a set of frames; a frame is a grid of
// '#' (ink), 'o' (an eye, drawn bright) and '.' (empty) rows. Shape and pose carry the state; colour
// is a separate hint. A sleeping figure's shut eyes are two bright dashes ('oo'); a fallen or hollow
// figure has no 'o': its eyes are crossed or it has none.
import type { AgentState } from '../types'

export type SpriteSet = {
  // Frames in playback order; a static state has one frame.
  frames: string[][]
  // Shown instead of the frames while a figure reacts to an inbound event (listening only).
  reaction?: string[]
}

// 8 columns by 8 pixel rows: two pixel rows make one text row (renderSprite).
export const SPRITES: Partial<Record<AgentState, SpriteSet>> = {
  // Head down, eyes shut as two dashes, drifting z.
  idle: {
    frames: [
      [
        '....###.',
        '......#.',
        '.######.',
        '.oo##oo.',
        '.######.',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
      [
        '.....###',
        '......#.',
        '.######.',
        '.oo##oo.',
        '.######.',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
    ],
  },
  // Eyes open, arms swinging while typing; legs take a walk step. 'o' is an eye pixel.
  'in-progress': {
    frames: [
      [
        '........',
        '..####..',
        '.######.',
        '.#o##o#.',
        '.######.',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
      [
        '........',
        '..####..',
        '.######.',
        '.#o##o#.',
        '.######.',
        '..####..',
        '.#....#.',
        '#......#',
      ],
    ],
  },
  // Arms raised beside the head and a tall bang above; the bang blinks. Eyes wide open.
  pending: {
    frames: [
      [
        '......#.',
        '......#.',
        '#.####.#',
        '##o##o##',
        '#.####.#',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
      [
        '........',
        '......#.',
        '#.####.#',
        '##o##o##',
        '#.####.#',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
    ],
  },
  // Arms up in a V with a tick mark; the tick sparkles. Happy open eyes.
  completed: {
    frames: [
      [
        '......#.',
        '#.####.#',
        '.#o##o#.',
        '..####..',
        '..####..',
        '..#..#..',
        '..#..#..',
        '........',
      ],
      [
        '.......#',
        '#.####.#',
        '.#o##o#.',
        '..####..',
        '..####..',
        '..#..#..',
        '..#..#..',
        '........',
      ],
    ],
  },
  // Fallen flat: cracked body spread across the floor with x-shaped eyes. Static.
  failed: {
    frames: [
      [
        '........',
        '........',
        '........',
        '.#.##.#.',
        '..####..',
        '########',
        '########',
        '........',
      ],
    ],
  },
  // Stopped inside a box with a dot: the run was cut short by the user or the system. Static.
  cancelled: {
    frames: [
      [
        '........',
        '........',
        '.######.',
        '.#....#.',
        '.#.##.#.',
        '.######.',
        '........',
        '........',
      ],
    ],
  },
  // Antenna raised and bobbing (pulse over two frames); a reaction frame with the antenna flared
  // out and both ears up, shown for the flash after an inbound event.
  listening: {
    frames: [
      [
        '....#...',
        '....#...',
        '.######.',
        '.#o##o#.',
        '..####..',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
      [
        '...#....',
        '...#....',
        '.######.',
        '.#o##o#.',
        '..####..',
        '..####..',
        '..#..#..',
        '..#..#..',
      ],
    ],
    reaction: [
      '#......#',
      '.#....#.',
      '.######.',
      '.#o##o#.',
      '..####..',
      '..####..',
      '..#..#..',
      '..#..#..',
    ],
  },
  // Hollow figure with a question mark; still, never animated.
  unknown: {
    frames: [
      [
        '....###.',
        '.....#..',
        '....#...',
        '........',
        '..####..',
        '..#..#..',
        '..####..',
        '..#..#..',
      ],
    ],
  },
}

// Colour names per state, kept apart from the grids (the grids never depend on colour).
export const STATE_COLOUR: Partial<Record<AgentState, string>> = {
  idle: 'gray',
  'in-progress': 'cyan',
  pending: 'yellow',
  completed: 'green',
  failed: 'red',
  cancelled: 'magenta',
  listening: 'blue',
  unknown: 'gray',
}

// The darker shade of each state colour, for the part of a figure that shows a filled context window.
export const STATE_COLOUR_DARK: Partial<Record<AgentState, string>> = {
  idle: '#5a5a5a',
  'in-progress': '#00757f',
  pending: '#8a6d00',
  completed: '#1d7a1d',
  failed: '#8a1f1f',
  cancelled: '#7a1f7a',
  listening: '#2c3fa6',
  unknown: '#5a5a5a',
}

// Muted shades for background agents (engine forks and workflow agents), so they sit behind the rest.
export const BACKGROUND_COLOUR = '#4a4a4a'
export const BACKGROUND_COLOUR_DARK = '#383838'

// Resample a square pixel grid to `size` by nearest neighbour, so one drawing serves every model size.
export function scaleGrid(grid: string[], size: number): string[] {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === size && cols === size) return grid
  const out: string[] = []
  for (let y = 0; y < size; y++) {
    const src = grid[Math.min(rows - 1, Math.floor(((y + 0.5) * rows) / size))]!
    let line = ''
    for (let x = 0; x < size; x++) line += src[Math.min(cols - 1, Math.floor(((x + 0.5) * cols) / size))]
    out.push(line)
  }
  return out
}

// The sprite for a state; states without a drawing yet fall back to unknown.
export function spriteFor(state: AgentState): SpriteSet {
  return SPRITES[state] ?? SPRITES.unknown!
}

// Ticks per animation frame (the clock runs about 4 fps, so this is about 2 frames per second).
export const TICKS_PER_FRAME = 2

// The grid drawn this tick: the reaction frame while reacting (when the state has one), else the
// frame the tick's animation step lands on.
export function frameOf(state: AgentState, tick: number, reacting: boolean, size = 8): string[] {
  const set = spriteFor(state)
  if (reacting && set.reaction) return scaleGrid(set.reaction, size)
  const index = Math.floor(tick / TICKS_PER_FRAME) % set.frames.length
  return scaleGrid(set.frames[index]!, size)
}

// Pixel rows to half-block text rows: each text row covers two pixel rows.
// top + bottom ink -> █, top only -> ▀, bottom only -> ▄, neither -> space.
export function renderSprite(grid: string[]): string[] {
  const out: string[] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y]!
    const bottom = grid[y + 1] ?? '.'.repeat(top.length)
    let line = ''
    for (let x = 0; x < top.length; x++) {
      const t = top[x] === '#' || top[x] === 'o'
      const b = bottom[x] === '#' || bottom[x] === 'o'
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' '
    }
    out.push(line)
  }
  return out
}

// One text cell of a drawn sprite: the character, and which pixel kind shows in its top (foreground)
// and bottom (background) half. An eye over ink is drawn as a bright foreground on an ink background.
export type SpriteCell = { ch: string; fg: 'ink' | 'eye' | null; bg: 'ink' | 'eye' | null }

// Like renderSprite, but keeps what each half-block is made of so the view can colour eyes apart.
export function renderCells(grid: string[]): SpriteCell[][] {
  const kind = (c: string | undefined): 'ink' | 'eye' | null => (c === '#' ? 'ink' : c === 'o' ? 'eye' : null)
  const out: SpriteCell[][] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y]!
    const bottom = grid[y + 1] ?? '.'.repeat(top.length)
    const line: SpriteCell[] = []
    for (let x = 0; x < top.length; x++) {
      const t = kind(top[x])
      const b = kind(bottom[x])
      if (t === null && b === null) line.push({ ch: ' ', fg: null, bg: null })
      else if (t === b) line.push({ ch: '█', fg: t, bg: null })
      else if (t === null) line.push({ ch: '▄', fg: b, bg: null })
      else if (b === null) line.push({ ch: '▀', fg: t, bg: null })
      else line.push({ ch: '▀', fg: t, bg: b })
    }
    out.push(line)
  }
  return out
}
