import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import { initialColony, reduce, REACT_MS, type Peer, type Signal } from '../src/model'
import { parsePeer } from '../src/peers'
import { guarded } from '../src/observe'
import { layout } from '../src/layout'
import {
  animates,
  attentionOf,
  CLOCK_MS,
  contextFor,
  DEFAULT_RETENTION_SECONDS,
  nextRecentAgent,
  pendingAgentsOf,
  readOptions,
  sharedFolderFor,
  shouldAutoOpen,
  shouldToastPending,
  shouldWrite,
  statusFor,
  summaryPath,
} from '../src/runtime'
import { buildSummary, endedSummary, parseSummary } from '../src/snapshot'
import { mergeSessions, type FileRead } from '../src/sessions'
import { reconcileFromList, toSignals, type ListedAgent } from '../src/signals'
import { estimateContextTokens } from '../src/context'
import { renderPane } from '../src/view'

const PANE = 'colony'
const PANE_TITLE = 'Colony'
const HIDDEN_KEY = 'isHiddenByUser'
const DEFAULT_RETENTION_MS = DEFAULT_RETENTION_SECONDS * 1000

// One colony per session. Its retention is set from options at session.start.
export const colonyAtom = atom(
  { plugin: 'colony', key: 'colony' } as const,
  initialColony(DEFAULT_RETENTION_MS),
)

// Module state for this load of the mod. Lost on reload, which is acceptable (see T018 notes).
let reducedMotion = false
let retentionMs = DEFAULT_RETENTION_MS
let sessionsDirectory = ''
let sessionTimer: { cancel: () => void } | null = null
let shareTimer: { cancel: () => void } | null = null
// The options as configured; the folder actually used (`sharedFolder`) is resolved at session start,
// when the environment (CLAUDE_CONFIG_DIR, HOME) can be read. Until then sharing is off.
let shareSessions = false
let sharedFolderOption = ''
let sharedFolder = ''
let recentAgentId: string | null = null
let clockTimer: { cancel: () => void } | null = null
let firstAutoDone = false
let lastStatus: string | undefined = undefined
let lastPendingCount = 0

type Dollar = EngineInterface

// Fold one signal into the colony.
export function dispatch($: Dollar, signal: Signal): Promise<unknown> {
  return applySignals($, [signal])
}

async function applySignals($: Dollar, signals: Signal[]): Promise<void> {
  if (signals.length === 0) return
  await update($, colonyAtom, c => signals.reduce(reduce, c))
  // Every state change is a chance to share (the throttle in shareState decides whether it is written now).
  if (sharedFolder) await shareState($)
}

// The engine's agent list; an unreadable list reads as empty so the colony falls back to events.
async function listAgents($: Dollar): Promise<ListedAgent[]> {
  try {
    return (await $.agent.list()) as ListedAgent[]
  } catch {
    return []
  }
}

// Reconcile with the engine's list: its status wins over inferred state (contracts/event-mapping.md).
async function reconcileAgents($: Dollar): Promise<void> {
  const listed = await listAgents($)
  await applySignals($, reconcileFromList(listed, await $.clock.now()))
}

// Run the clock only while something animates (never in reduced motion).
async function syncClock($: Dollar): Promise<void> {
  const colony = await read($, colonyAtom)
  const wanted = animates(colony, reducedMotion)
  if (wanted && !clockTimer) {
    clockTimer = $.clock.every(CLOCK_MS, () => {
      void tick($).catch(() => {})
    })
  } else if (!wanted && clockTimer) {
    clockTimer.cancel()
    clockTimer = null
  }
}

async function tick($: Dollar): Promise<void> {
  const at = await $.clock.now()
  await applySignals($, [{ type: 'tick', at }])
  await syncClock($)
}

async function paneState($: Dollar): Promise<{ paneOpen: boolean; placed: boolean }> {
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  return { paneOpen: pane !== undefined, placed: pane?.isPlaced ?? false }
}

// Keeps the status line and the pending toast in step with the colony (narrow-terminal fallback).
async function refreshPane($: Dollar): Promise<void> {
  const colony = await read($, colonyAtom)
  const { paneOpen, placed } = await paneState($)
  const status = statusFor(colony, paneOpen, placed)
  if (status !== lastStatus) {
    $.ui.status(status)
    lastStatus = status
  }
  const pending = pendingAgentsOf(colony)
  if (
    shouldToastPending({ pendingCount: pending.length, previousPendingCount: lastPendingCount, paneOpen, placed })
  ) {
    $.ui.toast(`colony: ${pending[0]?.label ?? 'an agent'} needs you`)
  }
  lastPendingCount = pending.length
}

// Other sessions. Two sources, both read only while the pane is open: the shared folder (option
// `sharedFolder`, spec 002) and the peer folder (option `sessionsDirectory`, spec 003). Nothing is read
// from a folder the person has not named; a file that cannot be read or parsed is skipped.
const PEER_POLL_MS = 5000
const SHARED_POLL_MS = 1000

async function readPeers($: Dollar): Promise<Peer[]> {
  const now = await $.clock.now()
  const self = await Promise.resolve($.session.id()).catch(() => null)
  const peers: Peer[] = []
  for (const entry of await $.fs.list(sessionsDirectory)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const text = await $.fs.read(`${sessionsDirectory.replace(/\/$/, '')}/${entry.name}`)
      const peer = parsePeer(typeof text === 'string' ? text : '', self ?? null, now)
      if (peer) peers.push(peer)
    } catch {
      // Unreadable or vanished between listing and reading: skip it.
    }
  }
  return peers
}

// The spec 003 peer view, unchanged: with no shared folder, the peer folder's sessions are the figures.
async function pollPeers($: Dollar): Promise<void> {
  const peers = await readPeers($)
  await applySignals($, [{ type: 'peers', peers, at: await $.clock.now() }])
}

// Summaries from the shared folder, each file read only when its modification time changed since the
// last poll. A file that cannot be read or parsed leaves no summary; a missing folder leaves none at all.
const sharedFiles = new Map<string, { mtimeMs: number; read: FileRead }>()

async function readSharedFile($: Dollar, name: string): Promise<FileRead> {
  const stem = name.slice(0, -'.json'.length)
  try {
    const text = await $.fs.read(`${sharedFolder.replace(/\/+$/, '')}/${name}`)
    const summary = parseSummary(typeof text === 'string' ? text : '')
    return { sessionId: summary?.sessionId ?? stem, summary }
  } catch {
    return { sessionId: stem, summary: null }
  }
}

async function readShared($: Dollar): Promise<{ summaries: FileRead[]; mtimes: Record<string, number> }> {
  const summaries: FileRead[] = []
  const mtimes: Record<string, number> = {}
  const entries = await $.fs.list(sharedFolder).catch(() => null)
  if (!entries) return { summaries, mtimes }
  const listed = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    listed.add(entry.name)
    let cached = sharedFiles.get(entry.name)
    if (!cached || cached.mtimeMs !== entry.mtimeMs) {
      cached = { mtimeMs: entry.mtimeMs, read: await readSharedFile($, entry.name) }
      sharedFiles.set(entry.name, cached)
    }
    summaries.push(cached.read)
    mtimes[cached.read.sessionId] = entry.mtimeMs
  }
  for (const name of sharedFiles.keys()) if (!listed.has(name)) sharedFiles.delete(name)
  return { summaries, mtimes }
}

async function selfIdOf($: Dollar): Promise<string | null> {
  try {
    return await $.session.id()
  } catch {
    return null
  }
}

// Shared summaries and the peer list merged into session groups; a session that shares is drawn as shared,
// once. The peer figures are then groups too, so they are not also sent as agents.
async function pollShared($: Dollar): Promise<void> {
  const now = await $.clock.now()
  const peers = sessionsDirectory ? await readPeers($).catch((): Peer[] => []) : []
  const { summaries, mtimes } = await readShared($)
  const sessions = mergeSessions({ summaries, peers, selfId: await selfIdOf($), now, mtimes })
  await applySignals($, [{ type: 'sessions', sessions, at: now }])
}

async function pollSessions($: Dollar): Promise<void> {
  if (!(await paneState($)).paneOpen) return stopSessions()
  try {
    if (sharedFolder) await pollShared($)
    else await pollPeers($)
    await syncClock($)
  } catch {
    // The folder is missing or unreadable: no other sessions are shown.
  }
}

function stopSessions(): void {
  sessionTimer?.cancel()
  sessionTimer = null
}

async function startSessions($: Dollar): Promise<void> {
  if ((!sharedFolder && !sessionsDirectory) || sessionTimer) return
  sessionTimer = $.clock.every(sharedFolder ? SHARED_POLL_MS : PEER_POLL_MS, () => {
    void pollSessions($).catch(() => {})
  })
  await pollSessions($)
}

// Own summary (spec 002). Written only while the shared folder is set. buildSummary is the only content;
// the content is compared without its time, and shouldWrite decides when a change or a heartbeat goes out.
const SHARE_TICK_MS = 250
const LAST_FOLDER_KEY = 'lastSharedFolder'
let lastWrittenKey: string | null = null
let lastWriteAt = Number.NEGATIVE_INFINITY
let lastHeartbeatAt = Number.NEGATIVE_INFINITY
// Set when the session ends: the clock may still tick after it, and nothing may follow the ended marker.
let sharingEnded = false

// The session's id, folder and name. The API has no session name: the name is the folder's last
// segment, or the first 8 characters of the id when the folder is empty.
async function ownSession($: Dollar): Promise<{ id: string; name: string; folder: string }> {
  const id = await $.session.id()
  const folder = await $.session.cwd()
  const last = folder.split('/').filter(Boolean).pop() ?? ''
  return { id, name: last || id.slice(0, 8), folder }
}

async function shareState($: Dollar): Promise<void> {
  if (!sharedFolder || sharingEnded) return
  const now = await $.clock.now()
  const colony = await read($, colonyAtom)
  const session = await ownSession($)
  const summary = buildSummary(colony, session, now)
  const key = JSON.stringify({ ...summary, updatedAt: 0 })
  const due = shouldWrite({
    changed: key !== lastWrittenKey,
    lastWriteAt,
    now,
    lastHeartbeatAt,
  })
  if (!due) return
  // Stamped before the write, so a failing write is not retried on every tick.
  lastWriteAt = now
  lastHeartbeatAt = now
  await $.fs.write(summaryPath(sharedFolder, session.id), JSON.stringify(summary))
  lastWrittenKey = key
}

function startSharing($: Dollar): void {
  if (!sharedFolder || shareTimer) return
  // A trailing change is written by the next tick once the interval has passed; heartbeats ride the same tick.
  shareTimer = $.clock.every(SHARE_TICK_MS, () => {
    void shareState($).catch(() => {})
  })
}

function stopSharing(): void {
  shareTimer?.cancel()
  shareTimer = null
}

// The ended marker for the session: no name, no folder, no agents.
async function writeEnded($: Dollar, folder: string): Promise<void> {
  const id = await $.session.id()
  const now = await $.clock.now()
  await $.fs.write(summaryPath(folder, id), JSON.stringify(endedSummary({ id }, now)))
}

// Sharing is off but this session shared before (the option was cleared and the mod reloaded): mark its
// summary ended in the folder it last used, then forget that folder.
async function endLeftoverShare($: Dollar): Promise<void> {
  if (sharedFolder) return
  const last = await $.store.get(LAST_FOLDER_KEY)
  if (typeof last !== 'string' || last === '') return
  await writeEnded($, last)
  await $.store.delete(LAST_FOLDER_KEY)
}

async function showPane($: Dollar): Promise<void> {
  await reconcileAgents($)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  await startSessions($)
  await refreshPane($)
}

// Auto-open the first time a subagent appears or an agent needs the user (FR-001).
async function autoOpen($: Dollar): Promise<void> {
  if (firstAutoDone) return
  const colony = await read($, colonyAtom)
  const attention = attentionOf(colony)
  // Nothing to show: no engine calls on the hot path (every tool call passes through here).
  if (attention === 0) return
  const { paneOpen } = await paneState($)
  const hidden = Boolean(await $.store.get(HIDDEN_KEY))
  if (!shouldAutoOpen({ attention, hidden, paneOpen, firstAutoDone })) return
  firstAutoDone = true
  await showPane($)
}

// Apply one event's signals, then settle the clock and the pane.
async function fold($: Dollar, eventName: string, e: Record<string, unknown>): Promise<void> {
  const colony = await read($, colonyAtom)
  const at = await $.clock.now()
  // A reaction flash is motion, so reduced motion skips it (the figure goes straight to in-progress).
  const signals = toSignals(eventName, e, contextFor(colony, recentAgentId, at, reducedMotion ? 0 : REACT_MS))
  recentAgentId = nextRecentAgent(recentAgentId, eventName, e)
  await applySignals($, signals)
  // Reduced motion never runs the clock, so retention expiry and easing ride on events instead.
  if (reducedMotion) await applySignals($, [{ type: 'tick', at }])
  await autoOpen($)
  await syncClock($)
  await refreshPane($)
}

// Observer hooks (FR-016): fold the event into the colony, then pass it on unchanged, even when
// folding fails. Each hook runs its task through guarded() (src/observe.ts, the body of observe()).
// The engine follows $ only into functions declared in this file, so $ stays inside these hooks.
const foldEvent = (eventName: string, $: Dollar, e: unknown) =>
  fold($, eventName, e as Record<string, unknown>)

// The engine's list row for a subagent, if it has one yet.
async function listedRow($: Dollar, id: unknown): Promise<ListedAgent | undefined> {
  return (await listAgents($)).find(row => row.id === id)
}

// The effective shared folder, computed once per session start: the folder option, else <config dir>/colony.
// A failed environment read counts as unset, so the default path is never guessed.
async function resolveSharedFolder($: Dollar): Promise<string> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? ''
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  return sharedFolderFor({ shareSessions, sharedFolder: sharedFolderOption, configDir, home })
}

async function sessionStart($: Dollar, e: unknown): Promise<void> {
  await $.command.register({
    name: 'colony',
    description: 'Show or hide the agent colony pane',
  })
  await update($, colonyAtom, c => ({ ...c, retentionMs }))
  sharedFolder = await resolveSharedFolder($)
  await endLeftoverShare($)
  if (sharedFolder) {
    sharingEnded = false
    await $.store.set(LAST_FOLDER_KEY, sharedFolder)
    startSharing($)
  }
  await fold($, 'session.start', e as Record<string, unknown>)
  await reconcileAgents($)
  // The pane opens on the first pending or first subagent (FR-001), or when the person runs /colony.
}

// The session ends: its summary is marked ended in the shared folder, or in the folder it last shared to
// when sharing is off now (FR-003, spec edge case).
async function sessionEnd($: Dollar): Promise<void> {
  stopSharing()
  sharingEnded = true
  if (sharedFolder) await writeEnded($, sharedFolder)
  else await endLeftoverShare($)
}

async function turnComplete($: Dollar, e: unknown): Promise<void> {
  await foldEvent('turn.complete', $, e)
  await reconcileAgents($)
}

// agent.spawn answers the new agent's id only after the spawn, so the id comes from the result.
async function spawnSeen($: Dollar, e: unknown, out: unknown): Promise<void> {
  const agentId = (out as { agentId?: unknown } | undefined)?.agentId
  if (typeof agentId !== 'string') return
  await fold($, 'agent.spawn', { ...(e as Record<string, unknown>), agentId })
}

// SubagentStart and SubagentStop carry no parent or status: the engine's list supplies them.
async function subagentStart($: Dollar, e: unknown): Promise<void> {
  const payload = e as Record<string, unknown>
  const row = await listedRow($, payload.agent_id)
  await fold($, 'classic.SubagentStart', {
    ...payload,
    parentId: row?.parentId,
    description: row?.description ?? payload.description,
  })
}

async function subagentStop($: Dollar, e: unknown): Promise<void> {
  const payload = e as Record<string, unknown>
  const row = await listedRow($, payload.agent_id)
  await fold($, 'classic.SubagentStop', {
    ...payload,
    parentId: row?.parentId,
    status: row?.status,
  })
}

// Messages in an agent's transcript when its context was last estimated; throttles the estimate.
const estimatedAt = new Map<string, number>()
const ESTIMATE_EVERY = 4

// A model request is about to go out. Count it for its agent, and now and then estimate that agent's
// context from its transcript. Light on purpose: no pane or status work, this fires on every step.
async function stepSeen($: Dollar, e: Record<string, unknown>): Promise<void> {
  const at = await $.clock.now()
  const colony = await read($, colonyAtom)
  await applySignals($, toSignals('turn.step', e, contextFor(colony, recentAgentId, at)))
  const id = typeof e.agentId === 'string' && e.agentId ? e.agentId : 'main'
  const count = typeof e.messageCount === 'number' ? e.messageCount : 0
  if (count - (estimatedAt.get(id) ?? -ESTIMATE_EVERY) < ESTIMATE_EVERY) return
  estimatedAt.set(id, count)
  try {
    const args = id === 'main' ? { as: 'api' as const } : { agentId: id, as: 'api' as const }
    const messages = await $.session.messages(args as never)
    if (!Array.isArray(messages)) return
    await applySignals($, [
      { type: 'agent-meta', id, contextTokens: estimateContextTokens(messages), at },
    ])
  } catch {
    // The transcript can be unreadable (a finished agent, another process): the estimate just waits.
  }
}

async function uiClosed($: Dollar, e: unknown): Promise<void> {
  // Closing the pane with the person's own mark or key counts as hiding it (FR-001).
  const close = e as { id: string; origin: { kind: string } }
  if (close.id === PANE) stopSessions()
  if (close.id === PANE && close.origin.kind === 'person') await $.store.set(HIDDEN_KEY, true)
}

export const register: Register = (on, options) => {
  const parsed = readOptions(options as Readonly<Record<string, unknown>>)
  reducedMotion = parsed.reducedMotion
  retentionMs = parsed.retentionMs
  sessionsDirectory = parsed.sessionsDirectory
  shareSessions = parsed.shareSessions
  sharedFolderOption = parsed.sharedFolder
  sharedFolder = ''

  on('session.start', ($, e, next) => guarded(() => sessionStart($, e), () => next(e)))

  on('command.run', { command: 'colony' }, async $ => {
    const paneOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (paneOpen) {
      await $.store.set(HIDDEN_KEY, true)
      await $.ui.close({ id: PANE })
      return { text: 'Colony pane hidden.' }
    }
    await $.store.set(HIDDEN_KEY, false)
    await showPane($)
    return { text: 'Colony pane shown.' }
  })

  on('ui.close', ($, e, next) => guarded(() => uiClosed($, e), () => next(e)))
  on('session.end', ($, e, next) => guarded(() => sessionEnd($), () => next(e)))

  on('turn.start', ($, e, next) => guarded(() => foldEvent('turn.start', $, e), () => next(e)))
  on('turn.complete', ($, e, next) => guarded(() => turnComplete($, e), () => next(e)))
  // Streaming event: observe the request, then pass the stream through untouched.
  on('turn.step', async function* ($, e, next) {
    await guarded(() => stepSeen($, e as unknown as Record<string, unknown>), () => undefined)
    return yield* next(e)
  })
  on('tool.call', ($, e, next) => guarded(() => foldEvent('tool.call', $, e), () => next(e)))
  on('classic.PermissionRequest', ($, e, next) => guarded(() => foldEvent('classic.PermissionRequest', $, e), () => next(e)))
  on('classic.Elicitation', ($, e, next) => guarded(() => foldEvent('classic.Elicitation', $, e), () => next(e)))
  on('classic.ElicitationResult', ($, e, next) => guarded(() => foldEvent('classic.ElicitationResult', $, e), () => next(e)))
  on('classic.Notification', ($, e, next) => guarded(() => foldEvent('classic.Notification', $, e), () => next(e)))
  on('prompt.submit', ($, e, next) => guarded(() => foldEvent('prompt.submit', $, e), () => next(e)))

  on('agent.spawn', async ($, e, next) => {
    const out = await next(e)
    await guarded(() => spawnSeen($, e, out), () => out)
    return out
  })
  on('classic.SubagentStart', ($, e, next) => guarded(() => subagentStart($, e), () => next(e)))
  on('classic.SubagentStop', ($, e, next) => guarded(() => subagentStop($, e), () => next(e)))
  on('classic.TeammateIdle', ($, e, next) => guarded(() => foldEvent('classic.TeammateIdle', $, e), () => next(e)))
  on('session.send', ($, e, next) => guarded(() => foldEvent('session.send', $, e), () => next(e)))
  on('session.receive', ($, e, next) => guarded(() => foldEvent('session.receive', $, e), () => next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const colony = await read($, colonyAtom)
    const viewport = { rows: e.viewport?.rows ?? 24, columns: e.viewport?.columns ?? 80 }
    const scene = layout(colony, viewport, reducedMotion ? 0 : colony.tick)
    return renderPane(scene, { Box, Text })
  })
}
