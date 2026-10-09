// Engine-level test of hooks/register.tsx: the plugin's own hooks run for real, the test's `on`
// hooks sit beneath them (they stand for the engine). The colony is checked through the pane the
// plugin draws: the test's $ has no state noun, so the mounted tree is the readback.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { STATE_COLOUR } from '../src/sprites'
import { EYE_COLOUR } from '../src/view'

const SESSION = { cwd: '/tmp/colony-test', surface: null, isInteractive: false }
const TOOL_ANSWER = { result: { text: 'engine answer', isError: false } }

// The engine's own answers beneath the plugin: nothing else in the test answers these events.
function answerEngine(on: On, seen: unknown[] = []) {
  on('session.start', (() => ({ cwd: SESSION.cwd })) as never)
  on('turn.start', (() => ({ turnId: 'turn_1' })) as never)
  on('tool.call', ((_$: unknown, e: unknown) => {
    seen.push(e)
    return TOOL_ANSWER
  }) as never)
  on('classic.PermissionRequest', (() => ({})) as never)
  on('command.register', (() => ({ value: {} })) as never)
  on('ui.open', (() => ({ isPlaced: true })) as never)
}

const PANE = {
  plugin: 'colony',
  surface: 'terminal',
  component: 'Pane',
  props: {},
  requestId: 'colony',
  viewport: { columns: 80, rows: 24 },
} as const

test('a tool.call reaches the engine unchanged and its answer comes back', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen: unknown[] = []
  answerEngine(on, seen)
  await $.session.start(SESSION as never)
  const call = { tool: 'Bash', tool_use_id: 'toolu_1', input: { command: 'ls' } }
  const result = await $.tool.call(call as never)
  expect(seen.length).toBe(1)
  expect(seen[0]).toEqual(call)
  expect(result).toEqual(TOOL_ANSWER)
})

test('a permission request makes the main agent pending', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  answerEngine(on)
  await $.session.start(SESSION as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  const ui = await $.ui.mount(PANE as never)
  // The main figure is drawn in the pending colour.
  const texts = await ui.findAll({ type: 'Text' })
  const pending = texts.filter(
    el => (el.props as { color?: string }).color === STATE_COLOUR.pending,
  )
  expect(pending.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('the pane render hook draws the main figure labelled main', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  answerEngine(on)
  await $.session.start(SESSION as never)
  const ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws a hover card with the full title, and eyes in their own colour', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  answerEngine(on)
  on('classic.SubagentStart', (() => ({})) as never)
  await $.session.start(SESSION as never)
  const title = 'Explore the repo and find every place the cache is invalidated'
  await $.classic.SubagentStart({ agent_id: 'sub1', agent_type: 'Explore', description: title } as never)
  // Sleeping figures have their eyes shut, so wake main with a turn.
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  const ui = await $.ui.mount(PANE as never)
  // The figure's label is cut short, but the hidden card carries the whole title.
  const boxes = await ui.findAll({ type: 'Box' })
  // One hidden card per figure (main and the subagent); the harness cannot hover, so the reveal itself
  // is the surface's job and is not exercised here.
  const cards = boxes.filter(el => {
    const props = el.props as { display?: string; position?: string }
    return props.display === 'none' && props.position === 'absolute'
  })
  expect(cards.length).toBe(2)
  // The card wraps the title over lines, so both halves are there.
  expect(await ui.find({ type: 'Text', text: /find every place/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache is invalidated/ })).toBeDefined()
  // Eyes are drawn in the eye colour, apart from the state colour.
  // (A half-block cell holds an eye as its foreground or, in the lower half, its background.)
  const eyes = (await ui.findAll({ type: 'Text' })).filter(el => {
    const props = el.props as { color?: string; backgroundColor?: string }
    return props.color === EYE_COLOUR || props.backgroundColor === EYE_COLOUR
  })
  expect(eyes.length).toBeGreaterThan(0)
  await ui.unmount()
})
