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
  pendingIdsOf,
  readOptions,
  shouldAutoOpen,
  shouldToastPending,
  statusFor,
} from '../src/runtime'
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
let peerTimer: { cancel: () => void } | null = null
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
  const pendingCount = pendingIdsOf(colony).length
  if (
    shouldToastPending({ pendingCount, previousPendingCount: lastPendingCount, paneOpen, placed })
  ) {
    const who = Object.values(colony.agents).find(a => a.state === 'pending')
    $.ui.toast(`colony: ${who?.label ?? 'an agent'} needs you`)
  }
  lastPendingCount = pendingCount
}

// Other sessions: read the session files in the folder the person named. Nothing is read unless the
// option is set; a file that cannot be read or parsed is skipped.
const PEER_POLL_MS = 5000

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

async function pollPeers($: Dollar): Promise<void> {
  if (!(await paneState($)).paneOpen) return stopPeers()
  try {
    const peers = await readPeers($)
    await applySignals($, [{ type: 'peers', peers, at: await $.clock.now() }])
    await syncClock($)
  } catch {
    // The folder is missing or unreadable: no other sessions are shown.
  }
}

function stopPeers(): void {
  peerTimer?.cancel()
  peerTimer = null
}

async function startPeers($: Dollar): Promise<void> {
  if (!sessionsDirectory || peerTimer) return
  peerTimer = $.clock.every(PEER_POLL_MS, () => {
    void pollPeers($).catch(() => {})
  })
  await pollPeers($)
}

async function showPane($: Dollar): Promise<void> {
  await reconcileAgents($)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  await startPeers($)
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

async function sessionStart($: Dollar, e: unknown): Promise<void> {
  await $.command.register({
    name: 'colony',
    description: 'Show or hide the agent colony pane',
  })
  await update($, colonyAtom, c => ({ ...c, retentionMs }))
  await fold($, 'session.start', e as Record<string, unknown>)
  await reconcileAgents($)
  // The pane opens on the first pending or first subagent (FR-001), or when the person runs /colony.
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
  if (close.id === PANE) stopPeers()
  if (close.id === PANE && close.origin.kind === 'person') await $.store.set(HIDDEN_KEY, true)
}

export const register: Register = (on, options) => {
  const parsed = readOptions(options as Readonly<Record<string, unknown>>)
  reducedMotion = parsed.reducedMotion
  retentionMs = parsed.retentionMs
  sessionsDirectory = parsed.sessionsDirectory

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
