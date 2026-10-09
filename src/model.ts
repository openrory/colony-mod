import type { Agent, AgentState, Colony, Exchange, Usage } from '../types'
import { resolveState } from './priority'

export const MAIN_ID = 'main'
// Ids of figures that stand for another session (not an agent of this one) start with this.
export const PEER_PREFIX = 'session:'
// How long a spawn / message / result burst keeps its exchange alive (ms).
export const BURST_MS = 1500
// Silence after which a working agent with no list status becomes unknown (ms).
export const SILENCE_MS = 60_000
// How long main keeps its completed look before it returns to idle (ms).
export const MAIN_DONE_MS = 5_000
// Largest proximity shift (columns) an exchange pulls two figures together by (FR-008).
export const MAX_SHIFT = 2
// How long a listening figure shows its reaction after an inbound event (ms, FR-011).
export const REACT_MS = 1000
// Furthest a working figure drifts from its home cell (columns), and how fast (columns per tick).
export const WANDER_MAX = 2
export const WANDER_STEP = 0.25

export type Peer = { id: string; label: string; state: AgentState; note: string }

export type ExchangeReason = Exchange['reasons'][number]

export type Signal =
  | { type: 'agent-added'; id: string; label: string; parentId: string | null; at: number }
  | { type: 'agent-state'; id: string; state: AgentState; listenSource?: string | null; at: number }
  | {
      type: 'agent-ended'
      id: string
      state: 'completed' | 'failed' | 'cancelled'
      at: number
    }
  // An inbound event reaches a figure: a reaction flash, then in-progress (flashMs 0 skips the flash).
  | { type: 'agent-react'; id: string; source: string; flashMs: number; at: number }
  | {
      type: 'exchange-open'
      fromId: string
      toId: string
      reason: ExchangeReason
      at: number
    }
  | {
      type: 'exchange-close'
      fromId: string
      toId: string
      reason: ExchangeReason
      at: number
    }
  // Facts about an agent that arrive apart from its state: model, origin, context estimate.
  | {
      type: 'agent-meta'
      id: string
      at: number
      model?: string
      addressable?: boolean
      independent?: boolean
      spawnedBy?: string | null
      contextTokens?: number
    }
  // A finished turn's token counts, added to the agent's total; its run of steps starts over.
  | { type: 'agent-usage'; id: string; usage: Usage; at: number }
  // One more model request in the agent's current run.
  | { type: 'agent-step'; id: string; model?: string; at: number }
  // The other sessions on this machine, as the pane last read them; replaces the figures for them.
  | { type: 'peers'; peers: Peer[]; at: number }
  | { type: 'tick'; at: number }
  | {
      type: 'reconcile'
      at: number
      listed: Array<{ id: string; label: string; parentId: string | null; state: AgentState }>
    }

export const TERMINAL_STATES: ReadonlyArray<AgentState> = ['completed', 'failed', 'cancelled']
const WORKING_STATES: ReadonlyArray<AgentState> = ['in-progress', 'pending', 'listening']
const BURST_REASONS: ReadonlyArray<ExchangeReason> = ['spawn', 'message', 'result']

export function initialColony(retentionMs: number): Colony {
  return { agents: {}, exchanges: {}, tick: 0, retentionMs }
}

export function exchangeId(fromId: string, toId: string): string {
  return `${fromId}>${toId}`
}

// An agent no list names (an engine fork such as compaction or memory, or a workflow's agent) is
// known only by its id; the prefix tells it from a subagent.
function unlistedLabel(id: string): string {
  return `bg ${id}`
}

function newBackgroundAgent(id: string, at: number): Agent {
  return { ...newAgent(id, unlistedLabel(id), null, at), background: true }
}

function newAgent(id: string, label: string, parentId: string | null, at: number): Agent {
  return {
    id,
    label,
    parentId,
    state: 'idle',
    listenSource: null,
    reactUntil: null,
    startedAt: at,
    endedAt: null,
    lastEventAt: at,
    listed: false,
    shift: 0,
    model: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    steps: 0,
    contextTokens: null,
    wander: 0,
    wanderTarget: 0,
    addressable: false,
    independent: false,
    background: false,
    spawnedBy: null,
    note: null,
  }
}

export function isPeer(agent: Pick<Agent, 'id'>): boolean {
  return agent.id.startsWith(PEER_PREFIX)
}

function isFinishedSubagent(agent: Agent): boolean {
  return agent.id !== MAIN_ID && TERMINAL_STATES.includes(agent.state)
}

function setAgents(colony: Colony, agents: Record<string, Agent>): Colony {
  return { ...colony, agents }
}

// The state a figure is drawn in (FR-013): a reaction flash outranks the stored state, and a listening
// registration shows only while the agent is otherwise at rest (FR-010: an idle agent); pending outranks both.
const AT_REST: ReadonlyArray<AgentState> = ['idle', 'completed', 'unknown']
export function shownStateOf(agent: Agent): AgentState {
  if (agent.reactUntil !== null) return resolveState([agent.state, 'listening'])
  if (agent.listenSource !== null && AT_REST.includes(agent.state)) return 'listening'
  return agent.state
}

// Silent working agents become unknown (FR-018). Terminal and idle agents are not "working".
// The main agent is never judged by silence (a long tool call is not unknown), and an agent the
// engine's list named at the last reconcile is trusted to that status instead of silence.
function markSilent(agents: Record<string, Agent>, at: number): Record<string, Agent> {
  let out = agents
  for (const agent of Object.values(agents)) {
    if (agent.id === MAIN_ID || agent.listed || isPeer(agent)) continue
    if (WORKING_STATES.includes(agent.state) && at - agent.lastEventAt >= SILENCE_MS) {
      if (out === agents) out = { ...agents }
      out[agent.id] = { ...agent, state: 'unknown' }
    }
  }
  return out
}

// Burst reasons (spawn, message, result) last only while their burst animates.
function pruneBursts(
  reasons: ExchangeReason[],
  burstUntil: number,
  at: number,
): ExchangeReason[] {
  if (burstUntil > at) return reasons
  return reasons.filter(r => !BURST_REASONS.includes(r))
}

function dropDanglingExchanges(
  exchanges: Record<string, Exchange>,
  agents: Record<string, Agent>,
): Record<string, Exchange> {
  const out: Record<string, Exchange> = {}
  for (const [key, ex] of Object.entries(exchanges)) {
    if (agents[ex.fromId] && agents[ex.toId]) out[key] = ex
  }
  return out
}

// Target proximity shift for one agent (0, 1 or 2 columns), from the exchanges it is in.
// A live burst pulls it two columns, a plain wait one, nothing none.
function targetShiftOf(agentId: string, exchanges: Record<string, Exchange>): number {
  let target = 0
  for (const ex of Object.values(exchanges)) {
    if (ex.fromId !== agentId && ex.toId !== agentId) continue
    if (ex.reasons.length === 0) continue
    const bursting = ex.reasons.some(r => BURST_REASONS.includes(r))
    target = Math.max(target, bursting ? MAX_SHIFT : 1)
  }
  return target
}

// Each figure moves one column toward its target per tick, so the pull eases in and back out.
function easeShifts(agents: Record<string, Agent>, exchanges: Record<string, Exchange>): Record<string, Agent> {
  let out = agents
  for (const agent of Object.values(agents)) {
    const target = targetShiftOf(agent.id, exchanges)
    const shift = agent.shift < target ? agent.shift + 1 : agent.shift > target ? agent.shift - 1 : agent.shift
    if (shift === agent.shift) continue
    if (out === agents) out = { ...agents }
    out[agent.id] = { ...agent, shift }
  }
  return out
}

// A small stable hash, so wandering is deterministic and the reducer stays pure.
function hashOf(text: string, n: number): number {
  let h = 2166136261 ^ n
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) % 1000
}

const WANDERS: ReadonlyArray<AgentState> = ['in-progress', 'listening']

// Working figures drift to a new spot every so often; resting ones, and any in an exchange, drift home.
function wanderAgents(
  agents: Record<string, Agent>,
  exchanges: Record<string, Exchange>,
  tick: number,
): Record<string, Agent> {
  let out = agents
  for (const agent of Object.values(agents)) {
    if (agent.id === MAIN_ID) continue
    const talking = targetShiftOf(agent.id, exchanges) > 0
    const roams = WANDERS.includes(shownStateOf(agent)) && !talking
    let target = agent.wanderTarget
    if (!roams) target = 0
    else if ((tick + hashOf(agent.id, 0)) % 16 === 0) {
      target = (hashOf(agent.id, tick) % (2 * WANDER_MAX + 1)) - WANDER_MAX
    }
    const gap = target - agent.wander
    const wander = Math.abs(gap) <= WANDER_STEP ? target : agent.wander + Math.sign(gap) * WANDER_STEP
    if (wander === agent.wander && target === agent.wanderTarget) continue
    if (out === agents) out = { ...agents }
    out[agent.id] = { ...agent, wander, wanderTarget: target }
  }
  return out
}

function isEasing(ex: Exchange, agents: Record<string, Agent>): boolean {
  return (agents[ex.fromId]?.shift ?? 0) > 0 || (agents[ex.toId]?.shift ?? 0) > 0
}

export function reduce(colony: Colony, signal: Signal): Colony {
  switch (signal.type) {
    case 'agent-added': {
      const existing = colony.agents[signal.id]
      if (existing) {
        // Idempotent: a repeat add refreshes the label only.
        return setAgents(colony, {
          ...colony.agents,
          [signal.id]: {
            ...existing,
            label: signal.label,
            parentId: signal.parentId ?? existing.parentId,
            lastEventAt: signal.at,
          },
        })
      }
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: newAgent(signal.id, signal.label, signal.parentId, signal.at),
      })
    }

    case 'agent-state': {
      const known = colony.agents[signal.id]
      // A finished subagent stays finished: a late event must not revive it (it would linger as a ghost).
      if (known && isFinishedSubagent(known) && signal.state !== 'listening') return colony
      const existing = known ?? newBackgroundAgent(signal.id, signal.at)
      // A listening registration is an overlay: it sets the source and leaves the stored state alone.
      if (signal.state === 'listening') {
        const registered: Agent = {
          ...existing,
          listenSource: signal.listenSource ?? 'external',
          lastEventAt: signal.at,
        }
        return setAgents(colony, { ...colony.agents, [signal.id]: registered })
      }
      const next: Agent = {
        ...existing,
        state: signal.state,
        // Re-entering a live state clears the end marker; the retention timer restarts on the next end.
        endedAt: TERMINAL_STATES.includes(signal.state) ? (existing.endedAt ?? signal.at) : null,
        lastEventAt: signal.at,
      }
      return setAgents(colony, { ...colony.agents, [signal.id]: next })
    }

    case 'agent-react': {
      const existing = colony.agents[signal.id]
      // Pending outranks listening (FR-013): an agent waiting on the user does not react.
      if (existing?.state === 'pending') return colony
      if (existing && isFinishedSubagent(existing)) return colony
      const agent = existing ?? newBackgroundAgent(signal.id, signal.at)
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: {
          ...agent,
          listenSource: signal.source,
          reactUntil: signal.at + signal.flashMs,
          endedAt: null,
          lastEventAt: signal.at,
        },
      })
    }

    case 'agent-ended': {
      const existing =
        colony.agents[signal.id] ?? newBackgroundAgent(signal.id, signal.at)
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: {
          ...existing,
          // A reusable agent that finishes a task rests; it is not removed.
          state: existing.addressable && signal.state === 'completed' ? 'idle' : signal.state,
          listenSource: null,
          reactUntil: null,
          // A repeat stop keeps the first end time, so it cannot extend retention.
          endedAt:
            existing.addressable && signal.state === 'completed'
              ? null
              : isFinishedSubagent(existing)
                ? (existing.endedAt ?? signal.at)
                : signal.at,
          lastEventAt: signal.at,
        },
      })
    }

    case 'agent-meta': {
      const existing = colony.agents[signal.id]
      if (!existing) return colony
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: {
          ...existing,
          model: signal.model ?? existing.model,
          addressable: signal.addressable ?? existing.addressable,
          independent: signal.independent ?? existing.independent,
          spawnedBy: signal.spawnedBy === undefined ? existing.spawnedBy : signal.spawnedBy,
          contextTokens: signal.contextTokens ?? existing.contextTokens,
        },
      })
    }

    case 'agent-usage': {
      const existing = colony.agents[signal.id]
      if (!existing) return colony
      const u = existing.usage
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: {
          ...existing,
          usage: {
            input: u.input + signal.usage.input,
            output: u.output + signal.usage.output,
            cacheRead: u.cacheRead + signal.usage.cacheRead,
            cacheWrite: u.cacheWrite + signal.usage.cacheWrite,
          },
          // One step is the exact window (input side of the last response); more is an estimate the
          // caller supplies through agent-meta, so only the single-step case is settled here.
          contextTokens:
            existing.steps <= 1
              ? signal.usage.input + signal.usage.cacheRead + signal.usage.cacheWrite + signal.usage.output
              : existing.contextTokens,
          steps: 0,
        },
      })
    }

    case 'agent-step': {
      const existing = colony.agents[signal.id]
      if (!existing) return colony
      return setAgents(colony, {
        ...colony.agents,
        [signal.id]: { ...existing, steps: existing.steps + 1, model: signal.model ?? existing.model },
      })
    }

    case 'peers': {
      const agents: Record<string, Agent> = {}
      for (const [id, agent] of Object.entries(colony.agents)) if (!isPeer(agent)) agents[id] = agent
      for (const peer of signal.peers) {
        const existing = colony.agents[peer.id] ?? newAgent(peer.id, peer.label, null, signal.at)
        agents[peer.id] = {
          ...existing,
          label: peer.label,
          state: peer.state,
          independent: true,
          note: peer.note,
          lastEventAt: signal.at,
        }
      }
      return setAgents(colony, agents)
    }

    case 'exchange-open': {
      const id = exchangeId(signal.fromId, signal.toId)
      const existing = colony.exchanges[id]
      const reasons = new Set(existing?.reasons ?? [])
      reasons.add(signal.reason)
      const isBurst = BURST_REASONS.includes(signal.reason)
      const burstUntil = isBurst
        ? Math.max(existing?.burstUntil ?? 0, signal.at + BURST_MS)
        : (existing?.burstUntil ?? 0)
      // A message to a finished subagent resumes it (a reusable agent), unlike a stray late event.
      const target = colony.agents[signal.toId]
      const agents =
        signal.reason === 'message' && target && isFinishedSubagent(target)
          ? { ...colony.agents, [target.id]: { ...target, state: 'in-progress' as const, endedAt: null, lastEventAt: signal.at } }
          : colony.agents
      return {
        ...colony,
        agents,
        exchanges: {
          ...colony.exchanges,
          [id]: {
            id,
            fromId: signal.fromId,
            toId: signal.toId,
            reasons: [...reasons],
            burstUntil,
          },
        },
      }
    }

    case 'exchange-close': {
      const id = exchangeId(signal.fromId, signal.toId)
      const existing = colony.exchanges[id]
      if (!existing) return colony
      const reasons = pruneBursts(
        existing.reasons.filter(r => r !== signal.reason),
        existing.burstUntil,
        signal.at,
      )
      // Dropped only once no reason is left and both figures are back at rest (easing finishes first).
      if (reasons.length === 0 && !isEasing(existing, colony.agents)) {
        const { [id]: _removed, ...rest } = colony.exchanges
        return { ...colony, exchanges: rest }
      }
      return {
        ...colony,
        exchanges: { ...colony.exchanges, [id]: { ...existing, reasons } },
      }
    }

    case 'tick': {
      // A reaction flash that has run its course ends the listening: the agent goes to in-progress.
      let agents: Record<string, Agent> = colony.agents
      for (const agent of Object.values(colony.agents)) {
        if (agent.reactUntil === null || signal.at < agent.reactUntil) continue
        if (agents === colony.agents) agents = { ...colony.agents }
        agents[agent.id] = {
          ...agent,
          state: agent.state === 'pending' ? 'pending' : 'in-progress',
          listenSource: null,
          reactUntil: null,
        }
      }
      agents = markSilent(agents, signal.at)
      // Main's completed look fades back to idle after MAIN_DONE_MS (main is never removed).
      const main = agents[MAIN_ID]
      if (
        main &&
        main.state === 'completed' &&
        main.endedAt !== null &&
        signal.at - main.endedAt >= MAIN_DONE_MS
      ) {
        agents = { ...agents, [MAIN_ID]: { ...main, state: 'idle', endedAt: null } }
      }
      for (const agent of Object.values(agents)) {
        // FR-015: every terminal subagent (completed, failed, cancelled) is removed; main never is.
        const expired =
          agent.id !== MAIN_ID &&
          !isPeer(agent) &&
          !agent.addressable &&
          TERMINAL_STATES.includes(agent.state) &&
          agent.endedAt !== null &&
          signal.at - agent.endedAt >= colony.retentionMs
        if (expired) {
          if (agents === colony.agents) agents = { ...colony.agents }
          delete agents[agent.id]
        }
      }
      let exchanges: Record<string, Exchange> = {}
      for (const [key, ex] of Object.entries(colony.exchanges)) {
        const reasons = pruneBursts(ex.reasons, ex.burstUntil, signal.at)
        exchanges[key] = reasons.length === ex.reasons.length ? ex : { ...ex, reasons }
      }
      exchanges = dropDanglingExchanges(exchanges, agents)
      agents = easeShifts(agents, exchanges)
      agents = wanderAgents(agents, exchanges, colony.tick)
      // An exchange with no reason left is kept only while its figures are still easing back.
      for (const [key, ex] of Object.entries(exchanges)) {
        if (ex.reasons.length === 0 && !isEasing(ex, agents)) {
          if (exchanges === colony.exchanges) exchanges = { ...colony.exchanges }
          delete exchanges[key]
        }
      }
      return { ...colony, agents, exchanges, tick: colony.tick + 1 }
    }

    case 'reconcile': {
      // The engine's list status wins over inferred state (contracts/event-mapping.md).
      const agents: Record<string, Agent> = { ...colony.agents }
      const listedIds = new Set<string>()
      for (const item of signal.listed) {
        listedIds.add(item.id)
        const existing = agents[item.id] ?? newAgent(item.id, item.label, item.parentId, signal.at)
        const state = existing.addressable && item.state === 'completed' ? 'idle' : item.state
        agents[item.id] = {
          ...existing,
          label: item.label,
          parentId: item.parentId,
          state,
          listed: true,
          background: false,
          listenSource: existing.listenSource,
          endedAt: TERMINAL_STATES.includes(state) ? (existing.endedAt ?? signal.at) : null,
          lastEventAt: signal.at,
        }
      }
      // Agents the list does not name are judged by silence alone.
      const unlisted: Record<string, Agent> = {}
      for (const [id, agent] of Object.entries(agents)) {
        if (!listedIds.has(id)) unlisted[id] = { ...agent, listed: false }
      }
      const silent = markSilent(unlisted, signal.at)
      for (const [id, agent] of Object.entries(silent)) agents[id] = agent
      return setAgents(colony, agents)
    }
  }
}
