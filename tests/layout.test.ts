import { test, expect } from 'claude-code/testing'
import { initialColony, reduce, type Signal } from '../src/model'
import { layout, FIGURE_HEIGHT, FIGURE_WIDTH, type Figure, type Scene } from '../src/layout'
import type { Colony, Exchange } from '../types'
import { SPRITES } from '../src/sprites'

const RETENTION = 30_000

function figureOf(scene: Scene, id: string): Figure {
  const found = scene.figures.find(f => f.agentId === id)
  if (!found) throw new Error(`no figure for ${id}`)
  return found
}
const BIG = { columns: 80, rows: 60 }

function build(signals: Signal[]): Colony {
  return signals.reduce(reduce, initialColony(RETENTION))
}

function withMain(extra: Signal[] = []): Colony {
  return build([{ type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 }, ...extra])
}

function sub(id: string, parentId = 'main', at = 1): Signal {
  return { type: 'agent-added', id, label: id, parentId, at }
}

function figure(scene: Scene, id: string): Figure {
  const f = scene.figures.find(x => x.agentId === id)
  if (!f) throw new Error(`no figure for ${id}`)
  return f
}

function overlaps(a: Figure, b: Figure): boolean {
  return (
    a.x < b.x + FIGURE_WIDTH &&
    b.x < a.x + FIGURE_WIDTH &&
    a.y < b.y + FIGURE_HEIGHT &&
    b.y < a.y + FIGURE_HEIGHT
  )
}

function setShift(colony: Colony, id: string, shift: number): Colony {
  return { ...colony, agents: { ...colony.agents, [id]: { ...colony.agents[id]!, shift } } }
}

function exchangeWith(fromId: string, toId: string, reasons: Exchange['reasons']): Exchange {
  return { id: `${fromId}>${toId}`, fromId, toId, reasons, burstUntil: 0 }
}

test('children are placed below their parent with a connector above them', () => {
  const colony = withMain([sub('a'), sub('b', 'a', 2)])
  const scene = layout(colony, BIG, 0)
  const a = figure(scene, 'a')
  const b = figure(scene, 'b')
  expect(a.y).toBeGreaterThan(figure(scene, 'main').y)
  // b follows a in its family block: same row to the right, or a row below.
  expect(b.y > a.y || b.x > a.x).toBe(true)
  // Family members stay together: b sits in a's family block, not beside main's other children.
  expect(scene.connectors.some(c => c.x === b.x + Math.floor(b.width / 2))).toBe(true)
})

test('an exchange pulls its pair closer by up to two columns and the gap comes back', () => {
  const colony = withMain([sub('a'), sub('b')])
  const rest = layout(colony, BIG, 0)
  const gap = figure(rest, 'b').x - figure(rest, 'a').x

  const exchanging: Colony = {
    ...setShift(setShift(colony, 'a', 2), 'b', 2),
    exchanges: { 'a>b': exchangeWith('a', 'b', ['message']) },
  }
  const near = layout(exchanging, BIG, 0)
  expect(figure(near, 'b').x - figure(near, 'a').x).toBe(gap - 4)

  const back = layout(setShift(setShift(colony, 'a', 0), 'b', 0), BIG, 0)
  expect(figure(back, 'b').x - figure(back, 'a').x).toBe(gap)
})

test('25 agents produce no overlapping figures and stay inside the viewport', () => {
  const signals: Signal[] = []
  for (let i = 0; i < 25; i++) signals.push(sub(`s${i}`, 'main', i + 1))
  const scene = layout(withMain(signals), BIG, 0)
  expect(scene.figures.length).toBe(26)
  for (let i = 0; i < scene.figures.length; i++) {
    const f = scene.figures[i]!
    expect(f.x).toBeGreaterThanOrEqual(0)
    expect(f.x + FIGURE_WIDTH).toBeLessThanOrEqual(BIG.columns)
    expect(f.y + FIGURE_HEIGHT).toBeLessThanOrEqual(BIG.rows)
    for (let j = i + 1; j < scene.figures.length; j++) {
      expect(overlaps(f, scene.figures[j]!)).toBe(false)
    }
  }
})

test('figures stay apart even when two neighbours both pull toward each other', () => {
  const colony = withMain([sub('a'), sub('b')])
  const pulled: Colony = {
    ...setShift(setShift(colony, 'a', 2), 'b', 2),
    exchanges: { 'a>b': exchangeWith('a', 'b', ['message']) },
  }
  const scene = layout(pulled, BIG, 0)
  expect(overlaps(figure(scene, 'a'), figure(scene, 'b'))).toBe(false)
})

test('past capacity the oldest completed figures collapse into the overflow count; pending is never collapsed', () => {
  const signals: Signal[] = []
  for (let i = 0; i < 30; i++) signals.push(sub(`s${i}`, 'main', i + 1))
  // s0 is the oldest; mark most of them completed, and s29 pending.
  for (let i = 0; i < 29; i++) {
    signals.push({ type: 'agent-ended', id: `s${i}`, state: 'completed', at: 100 })
  }
  signals.push({ type: 'agent-state', id: 's29', state: 'pending', at: 100 })
  const colony = withMain(signals)
  const scene = layout(colony, { columns: 44, rows: 20 }, 0)
  expect(scene.collapsed).toBeGreaterThan(0)
  expect(scene.figures.find(f => f.agentId === 's29')).toBeDefined()
  // The oldest completed figure is the first to go.
  expect(scene.figures.find(f => f.agentId === 's0')).toBeUndefined()
  expect(scene.figures.length + scene.collapsed + scene.hidden).toBe(31)
})

test('two exchanges between different pairs get separate streams that never overlap, and ending one leaves the other', () => {
  // a..c and b..d span overlapping columns, so they must take separate lanes.
  const colony = withMain([sub('a'), sub('b'), sub('c'), sub('d')])
  const both: Colony = {
    ...colony,
    exchanges: {
      'a>c': exchangeWith('a', 'c', ['message']),
      'b>d': exchangeWith('b', 'd', ['message']),
    },
  }
  const scene = layout(both, BIG, 0)
  expect(scene.streams.length).toBe(2)
  const [s1, s2] = scene.streams
  const overlapping = s1!.row === s2!.row && s1!.x < s2!.x + s2!.width && s2!.x < s1!.x + s1!.width
  expect(overlapping).toBe(false)

  const one: Colony = { ...both, exchanges: { 'b>d': both.exchanges['b>d']! } }
  const left = layout(one, BIG, 0).streams
  expect(left.length).toBe(1)
  const before = scene.streams.find(s => s.fromId === 'b')!
  expect(left[0]!.x).toBe(before.x)
  expect(left[0]!.width).toBe(before.width)
})

test('an exchange with no burst or wait draws no stream', () => {
  const colony = withMain([sub('a')])
  const scene = layout({ ...colony, exchanges: { 'main>a': exchangeWith('main', 'a', []) } }, BIG, 0)
  expect(scene.streams).toEqual([])
})

test('a tiny viewport gives a one-line summary and no figures', () => {
  const scene = layout(withMain([sub('a')]), { columns: 4, rows: 2 }, 0)
  expect(scene.tooSmall).toBe(true)
  expect(scene.figures).toEqual([])
})


// ---- US3 (T036): the source tag and the reaction frame -------------------------------------

test('a listening figure is labelled with its source tag, truncated to the figure width', () => {
  const c = build([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'Watcher', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'github', at: 1 },
    { type: 'agent-added', id: 'hook', label: 'Hook', parentId: 'main', at: 2 },
    { type: 'agent-state', id: 'hook', state: 'listening', listenSource: 'webhook', at: 3 },
  ])
  const scene = layout(c, BIG, 0)
  expect(figureOf(scene, 'sub').label).toBe('[github]')
  expect(figureOf(scene, 'hook').label).toBe('[webhoo…')
  expect(figureOf(scene, 'hook').state).toBe('listening')
  expect(figureOf(scene, 'main').label).toBe('main')
})

test('a listening figure draws the reaction frame during the flash, then the pulse again', () => {
  const base = build([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 0 },
    { type: 'agent-added', id: 'sub', label: 'Watcher', parentId: 'main', at: 0 },
    { type: 'agent-state', id: 'sub', state: 'listening', listenSource: 'github', at: 1 },
  ])
  expect(figureOf(layout(base, BIG, 0), 'sub').grid).toEqual(SPRITES.listening!.frames[0])
  const reacting = reduce(base, { type: 'agent-react', id: 'sub', source: 'github', flashMs: 1000, at: 5 })
  expect(figureOf(layout(reacting, BIG, 0), 'sub').grid).toEqual(SPRITES.listening!.reaction)
  expect(figureOf(layout(reacting, BIG, 0), 'sub').label).toBe('[github]')
})

test('a pending figure is never cut by the viewport, even when running figures overflow', () => {
  const signals: Signal[] = []
  for (let i = 0; i < 6; i++) {
    signals.push(sub(`r${i}`, 'main', i + 1))
    signals.push({ type: 'agent-state', id: `r${i}`, state: 'in-progress', at: i + 1 })
  }
  signals.push(sub('p', 'main', 99))
  signals.push({ type: 'agent-state', id: 'p', state: 'pending', at: 99 })
  const scene = layout(withMain(signals), { rows: 20, columns: 80 }, 0)
  expect(scene.figures.some(f => f.agentId === 'p')).toBe(true)
  expect(scene.hidden).toBeGreaterThan(0)
})

function modelled(id: string, model: string, parentId = 'main', at = 1): Signal[] {
  return [
    { type: 'agent-added', id, label: id, parentId, at },
    { type: 'agent-meta', id, model, at },
  ]
}

test('a bigger model draws a bigger figure, and main does not enlarge the others cells', () => {
  const colony = withMain([
    ...modelled('h', 'haiku'),
    ...modelled('s', 'claude-sonnet-5-5'),
    ...modelled('o', 'claude-opus-5-5'),
    ...modelled('f', 'claude-fable-5-1'),
    { type: 'agent-meta', id: 'main', model: 'claude-fable-5-1', at: 1 },
  ])
  const scene = layout(colony, { columns: 200, rows: 60 }, 0)
  const widths = ['h', 's', 'o', 'f'].map(id => figure(scene, id).width)
  expect(widths).toEqual([...widths].sort((a, b) => a - b))
  expect(new Set(widths).size).toBe(4)
  // A figure's height is half its width plus the label row.
  for (const f of scene.figures) expect(f.height).toBe(f.width / 2 + 1)
  // Small figures stand on the same baseline as the big ones in their row.
  const bottoms = ['h', 's', 'o', 'f'].map(id => figure(scene, id).y + figure(scene, id).height)
  expect(new Set(bottoms).size).toBe(1)
  // A model-less subagent is the base size.
  const plain = layout(withMain([sub('p')]), BIG, 0)
  expect(figure(plain, 'p').width).toBe(FIGURE_WIDTH)
})

test('mixed sizes never overlap or leave the viewport, however the figures drift', () => {
  const models = ['haiku', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
  const signals: Signal[] = []
  for (let i = 0; i < 14; i++) {
    signals.push(...modelled(`s${i}`, models[i % 4]!, 'main', i + 1))
    signals.push({ type: 'agent-state', id: `s${i}`, state: 'in-progress', at: i + 1 })
  }
  signals.push({ type: 'exchange-open', fromId: 'main', toId: 's0', reason: 'waiting', at: 20 })
  let colony = withMain(signals)
  const view = { columns: 100, rows: 60 }
  for (let t = 0; t < 120; t++) {
    colony = reduce(colony, { type: 'tick', at: 100 + t * 250 })
    const scene = layout(colony, view, t)
    for (let i = 0; i < scene.figures.length; i++) {
      const f = scene.figures[i]!
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x + f.width).toBeLessThanOrEqual(view.columns)
      expect(f.y + f.height).toBeLessThanOrEqual(view.rows)
      for (let j = i + 1; j < scene.figures.length; j++) {
        const g = scene.figures[j]!
        const apart = f.x + f.width <= g.x || g.x + g.width <= f.x || f.y + f.height <= g.y || g.y + g.height <= f.y
        expect(apart).toBe(true)
      }
    }
  }
})

test('a figure carries its full title, its context fill and its hover details', () => {
  const title = 'Explore the repo and find every place the cache is invalidated'
  const colony = withMain([
    { type: 'agent-added', id: 'a', label: title, parentId: 'main', at: 1 },
    { type: 'agent-meta', id: 'a', model: 'haiku', contextTokens: 50_000, at: 1 },
  ])
  const f = figure(layout(colony, BIG, 0), 'a')
  expect(f.title).toBe(title)
  expect(f.label.endsWith('…')).toBe(true)
  expect(f.label.length).toBeLessThanOrEqual(f.width)
  expect(f.fill).toBe(0.25)
  expect(f.details).toContain('context ~25% of 200k')
  expect(figure(layout(withMain([sub('b')]), BIG, 0), 'b').fill).toBe(null)
})

test('an agent no orchestrator started has no connector; agents in a parent cycle are still drawn', () => {
  const colony = withMain([
    sub('t'),
    { type: 'agent-meta', id: 't', independent: true, at: 1 },
    sub('x', 'y', 2),
    sub('y', 'x', 3),
    sub('self', 'self', 4),
  ])
  const scene = layout(colony, BIG, 0)
  const t = figure(scene, 't')
  expect(scene.connectors.some(c => c.x === t.x + Math.floor(t.width / 2))).toBe(false)
  for (const id of ['x', 'y', 'self']) expect(figure(scene, id)).toBeDefined()
})
