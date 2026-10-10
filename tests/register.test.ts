// Engine-level test of hooks/register.tsx: the plugin's own hooks run for real, the test's `on`
// hooks sit beneath them (they stand for the engine). The colony is checked through the pane the
// plugin draws: the test's $ has no state noun, so the mounted tree is the readback.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { STATE_COLOUR } from '../src/sprites'
import { EYE_COLOUR } from '../src/view'
import { parseSummary } from '../src/snapshot'

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
  on('ui.open', (() => {
    paneOpened = true
    return { value: { isPlaced: true } }
  }) as never)
}

// Whether answerEngine's pane was opened; read by openablePane (spec 005 tests).
let paneOpened = false

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

// Shared summaries (spec 002): the engine's file answers are recorded so each test can see every
// write, list and read the plugin makes. The writes are the plugin's own; nothing else writes.
const SHARE = { folder: '/shared', id: 'sess-1', cwd: '/work/alpha' }
type FileLog = { writes: Array<{ path: string; text: string }>; lists: string[]; reads: string[] }

// Files the test puts in the shared folder: their names, modification times and text (a null text is unreadable).
type FolderFile = { mtimeMs: number; text: string | null }

function answerFiles(on: On, log: FileLog, files: Record<string, FolderFile> = {}) {
  on('session.id', (() => ({ value: SHARE.id })) as never)
  on('session.cwd', (() => ({ value: SHARE.cwd })) as never)
  on('session.end', (() => ({ sessionId: SHARE.id })) as never)
  on('fs.write', ((_$: unknown, e: { path: string; text: string }) => {
    log.writes.push(e)
    return { value: undefined }
  }) as never)
  on('fs.list', ((_$: unknown, e: { path: string }) => {
    log.lists.push(e.path)
    if (e.path !== SHARE.folder) return { value: [] }
    return {
      value: Object.entries(files).map(([name, f]) => ({
        name,
        kind: 'file',
        size: 1,
        mtimeMs: f.mtimeMs,
        isLink: false,
      })),
    }
  }) as never)
  on('fs.read', ((_$: unknown, e: { path: string }) => {
    log.reads.push(e.path)
    const name = e.path.slice(SHARE.folder.length + 1)
    const file = files[name]
    if (!file || file.text === null) throw new Error('unreadable')
    return { value: file.text }
  }) as never)
}

const emptyLog = (): FileLog => ({ writes: [], lists: [], reads: [] })

test('with the shared folder empty, no folder is written, listed or read', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  await clock.advance(15_000)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes).toEqual([])
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})

test('with the shared folder set, a state change is written as this session\'s summary', { options: { sharedFolder: SHARE.folder } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await clock.advance(2_000)
  const before = log.writes.length
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  expect(log.writes.length - before).toBe(1)
  const written = log.writes[log.writes.length - 1]!
  expect(written.path).toBe(`${SHARE.folder}/${SHARE.id}.json`)
  const summary = parseSummary(written.text)
  expect(summary).not.toBe(null)
  expect(summary!.sessionId).toBe(SHARE.id)
  expect(summary!.name).toBe('alpha')
  expect(summary!.folder).toBe(SHARE.cwd)
  expect(summary!.agents.some(a => a.id === 'main')).toBe(true)
})

test('two changes within a second are one write, then the trailing write', { options: { sharedFolder: SHARE.folder } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await clock.advance(2_000)
  const before = log.writes.length
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  expect(log.writes.length - before).toBe(1)
  await clock.advance(1_250)
  expect(log.writes.length - before).toBe(2)
  const trailing = parseSummary(log.writes[log.writes.length - 1]!.text)
  expect(trailing!.agents.find(a => a.id === 'main')?.state).toBe('pending')
})

test('at session end with the folder set, one ended summary is written and nothing after it', { options: { sharedFolder: SHARE.folder } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await clock.advance(2_000)
  const before = log.writes.length
  await $.session.end({ reason: 'exit' } as never)
  await clock.advance(10_000)
  expect(log.writes.length - before).toBe(1)
  const written = log.writes[log.writes.length - 1]!
  expect(written.path).toBe(`${SHARE.folder}/${SHARE.id}.json`)
  const summary = parseSummary(written.text)
  expect(summary!.ended).toBe(true)
  expect(summary!.agents).toEqual([])
  expect(written.text).not.toContain(SHARE.cwd)
})

test('after sharing was switched off, the next start writes one ended summary to the old folder', async ($, on) => {
  const clock = mock.clock(on)
  // What the earlier load left behind when it shared to the folder.
  mock.store(on, { lastSharedFolder: SHARE.folder })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  expect(log.writes.length).toBe(1)
  expect(log.writes[0]!.path).toBe(`${SHARE.folder}/${SHARE.id}.json`)
  expect(parseSummary(log.writes[0]!.text)!.ended).toBe(true)
  await clock.advance(10_000)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes.length).toBe(1)
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})

test('with the shared folder set, the other sessions summaries are read once per change and an unreadable file is skipped', { options: { sharedFolder: SHARE.folder } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const log = emptyLog()
  const other = JSON.stringify({ version: 1, sessionId: 'other', name: 'beta', folder: '/work/beta', updatedAt: 0, agents: [] })
  // The pane is open once the plugin has opened it.
  let open = false
  on('session.start', (() => ({ cwd: SESSION.cwd })) as never)
  on('command.register', (() => ({ value: {} })) as never)
  on('ui.open', (() => {
    open = true
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.panes', (() => ({ value: open ? [{ id: PANE.requestId, isPlaced: true }] : [] })) as never)
  answerFiles(on, log, {
    'other.json': { mtimeMs: 5, text: other },
    'broken.json': { mtimeMs: 5, text: null },
    'notes.txt': { mtimeMs: 5, text: 'not a summary' },
  })
  // Opening the pane starts the reader: nothing is read while the pane is closed.
  await $.session.start(SESSION as never)
  expect(log.lists).toEqual([])
  await $.command.run({ command: 'colony' } as never)
  expect(open).toBe(true)
  expect(log.lists).toContain(SHARE.folder)
  expect(log.reads).toContain(`${SHARE.folder}/other.json`)
  expect(log.reads).toContain(`${SHARE.folder}/broken.json`)
  expect(log.reads).not.toContain(`${SHARE.folder}/notes.txt`)
  const readsBefore = log.reads.length
  await clock.advance(3_000)
  // Polled again, but nothing changed: no file is read again.
  expect(log.lists.length).toBeGreaterThan(1)
  expect(log.reads.length).toBe(readsBefore)
})

// Sharing by default (spec 002, FR-002): the switch picks the folder from the environment, read at session start.
test('with the switch on and no folder set, summaries go to <HOME>/.claude/colony', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await clock.advance(2_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  expect(log.writes.length).toBeGreaterThan(0)
  for (const write of log.writes) expect(write.path).toBe(`/home/tester/.claude/colony/${SHARE.id}.json`)
})

test('CLAUDE_CONFIG_DIR wins over HOME for the default folder', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg/claude', HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await clock.advance(2_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  expect(log.writes.length).toBeGreaterThan(0)
  for (const write of log.writes) expect(write.path).toBe(`/cfg/claude/colony/${SHARE.id}.json`)
  expect(log.lists.some(path => path.startsWith('/home/tester'))).toBe(false)
})

test('with the switch on but neither CLAUDE_CONFIG_DIR nor HOME known, no folder is touched', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  await clock.advance(15_000)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes).toEqual([])
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})

// Spec 005: one switch covers both folders. The pane is opened by the person (/colony), so the readers run;
// the test's fs answers record every list, read and write the plugin makes.
function openablePane(on: On) {
  paneOpened = false
  on('ui.panes', (() => ({ value: paneOpened ? [{ id: PANE.requestId, isPlaced: true }] : [] })) as never)
}

test('with the switch off and no overrides, neither folder is listed, read or written, even with the pane open', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  openablePane(on)
  await $.session.start(SESSION as never)
  await $.command.run({ command: 'colony' } as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  await clock.advance(15_000)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes).toEqual([])
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})

test('with the switch on and no overrides, <HOME>/.claude/sessions is read and <HOME>/.claude/colony is written', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  openablePane(on)
  await $.session.start(SESSION as never)
  await $.command.run({ command: 'colony' } as never)
  await clock.advance(2_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  expect(log.lists).toContain('/home/tester/.claude/sessions')
  expect(log.writes.length).toBeGreaterThan(0)
  for (const write of log.writes) expect(write.path).toBe(`/home/tester/.claude/colony/${SHARE.id}.json`)
})

test('with the switch on, CLAUDE_CONFIG_DIR wins over HOME for both folders', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg/claude', HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  openablePane(on)
  await $.session.start(SESSION as never)
  await $.command.run({ command: 'colony' } as never)
  await clock.advance(2_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  expect(log.lists).toContain('/cfg/claude/sessions')
  expect(log.writes.length).toBeGreaterThan(0)
  for (const write of log.writes) expect(write.path).toBe(`/cfg/claude/colony/${SHARE.id}.json`)
  expect(log.lists.some(path => path.startsWith('/home/tester'))).toBe(false)
})

test('an old-style sessions folder override alone (switch off) is read for the limited view and nothing is written', { options: { sessionsDirectory: '/old/sessions' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  openablePane(on)
  await $.session.start(SESSION as never)
  await $.command.run({ command: 'colony' } as never)
  await clock.advance(6_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.lists).toContain('/old/sessions')
  expect(log.lists.some(path => path.startsWith('/home/tester'))).toBe(false)
  expect(log.writes).toEqual([])
})

test('with the switch on but the Claude folder unknown, the pane opens and no folder is touched', { options: { shareSessions: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  openablePane(on)
  await $.session.start(SESSION as never)
  await $.command.run({ command: 'colony' } as never)
  await clock.advance(6_000)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes).toEqual([])
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})

test('with the switch off, a set HOME does not turn sharing on', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg/claude', HOME: '/home/tester' })
  const log = emptyLog()
  answerEngine(on)
  answerFiles(on, log)
  await $.session.start(SESSION as never)
  await $.turn.start({ text: 'hello', turnId: 'turn_1' } as never)
  await clock.advance(15_000)
  await $.session.end({ reason: 'exit' } as never)
  expect(log.writes).toEqual([])
  expect(log.lists).toEqual([])
  expect(log.reads).toEqual([])
})
