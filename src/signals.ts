// Engine event -> colony signals (contracts/event-mapping.md). Pure: no engine imports.
// Hooks in hooks/register.tsx enrich an event with what only the engine's agent list knows
// (a parent id, a description, an end status) before calling toSignals.
import { MAIN_ID, REACT_MS, TERMINAL_STATES, type Signal } from './model'
import type { AgentState, Usage } from '../types'

// What attribution needs beyond the event itself.
export type SignalContext = {
  at: number
  // The most recently active agent (see activityOf), or null before any activity.
  recentAgentId: string | null
  // Agents currently pending, i.e. waiting on the user.
  pendingIds: string[]
  // Known agents, so a recipient or teammate name can be resolved by id or label.
  agents: Array<{ id: string; label: string }>
  // Length of a reaction flash (ms); 0 under reduced motion. Defaults to REACT_MS.
  reactFlashMs?: number
}

// Tools that register an external trigger (R5). ScheduleWakeup and CronCreate are the agent's own
// timers and are deliberately absent.
const LISTENING_TOOLS: Readonly<Record<string, string>> = {
  Monitor: 'watch',
  RemoteTrigger: 'webhook',
}

type EventInput = Record<string, unknown>

// Notification types that mean the agent is waiting on the user (research R3).
const PROMPT_NOTIFICATIONS: ReadonlyArray<string> = ['permission_prompt', 'idle_prompt']

// One row of `$.agent.list()` as the mod reads it (AgentInfo, reduced to what the pane needs).
export type ListedAgent = {
  id: string
  description?: string
  type?: string
  parentId?: string
  status: string
  name?: string
  teammateId?: string
  spawnedBy?: string
}

// The token counts of a turn.complete `usage` (ModelUsage), or null when it carries none.
export function usageOf(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') return null
  const u = value as Record<string, unknown>
  const n = (k: string) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0)
  return {
    input: n('input_tokens'),
    output: n('output_tokens'),
    cacheRead: n('cache_read_input_tokens'),
    cacheWrite: n('cache_creation_input_tokens'),
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// The agent a hook fired from: `agentId` on engine events, `agent_id` on classic hooks; null = main.
export function agentOf(e: EventInput): string | null {
  const id = e.agentId ?? e.agent_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// The agent an event shows as active, for recentAgentId tracking. Null when the event is not activity.
export function activityOf(eventName: string, e: EventInput): string | null {
  if (eventName === 'tool.call') return agentOf(e) ?? MAIN_ID
  if (eventName === 'turn.start') return MAIN_ID
  return null
}

// Pending attribution: the event's own agent, else the most recently active agent, else main.
function pendingOwner(e: EventInput, ctx: SignalContext): string {
  return agentOf(e) ?? ctx.recentAgentId ?? MAIN_ID
}

function clearPending(ctx: SignalContext): Signal[] {
  return ctx.pendingIds.map(id => ({
    type: 'agent-state' as const,
    id,
    state: 'in-progress' as const,
    at: ctx.at,
  }))
}

// The ending state of a subagent from its engine status (AgentStatus). The SubagentStop hook itself
// carries no outcome, so a status the list gives decides, and anything else reads as completed.
export function endStateOf(status: string | undefined): 'completed' | 'failed' | 'cancelled' {
  if (status === 'failed') return 'failed'
  if (status === 'killed' || status === 'cancelled') return 'cancelled'
  return 'completed'
}

// The pane state an engine AgentStatus shows as (contracts/event-mapping.md, R2).
export function listStateOf(status: string): AgentState {
  switch (status) {
    case 'running':
    case 'waiting':
      return 'in-progress'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'cancelled'
    default:
      // pending (not started) and idle (between turns)
      return 'idle'
  }
}

// Resolve a recipient or teammate name against known agents: an id, or a label that names exactly one.
export function resolveAgent(to: unknown, agents: SignalContext['agents']): string | null {
  const key =
    typeof to === 'string'
      ? to
      : to && typeof to === 'object' && typeof (to as { agentId?: unknown }).agentId === 'string'
        ? (to as { agentId: string }).agentId
        : ''
  if (!key) return null
  if (agents.some(a => a.id === key)) return key
  const named = agents.filter(a => a.label === key)
  return named.length === 1 ? named[0]!.id : null
}

// A new subagent: it is added under its parent, and the parent opens a spawn burst and a wait.
function spawnSignals(parentId: string, childId: string, label: string, at: number): Signal[] {
  return [
    { type: 'agent-added', id: childId, label, parentId, at },
    { type: 'exchange-open', fromId: parentId, toId: childId, reason: 'spawn', at },
    { type: 'exchange-open', fromId: parentId, toId: childId, reason: 'waiting', at },
  ]
}

export function toSignals(eventName: string, e: EventInput, ctx: SignalContext): Signal[] {
  switch (eventName) {
    case 'session.start':
      return [{ type: 'agent-added', id: MAIN_ID, label: 'main', parentId: null, at: ctx.at }]

    case 'turn.start':
      return [{ type: 'agent-state', id: MAIN_ID, state: 'in-progress', at: ctx.at }]

    // A turn that ran in a subagent's loop (it carries that agent's id) is that agent's usage only;
    // the main agent completes when its own turn does.
    case 'turn.complete': {
      const id = agentOf(e)
      const usage = usageOf(e.usage)
      const model = text((e.usage as { model?: unknown } | undefined)?.model)
      const out: Signal[] = []
      if (id === null) out.push({ type: 'agent-state', id: MAIN_ID, state: 'completed', at: ctx.at })
      if (usage) {
        out.push({ type: 'agent-usage', id: id ?? MAIN_ID, usage, at: ctx.at })
        if (model) out.push({ type: 'agent-meta', id: id ?? MAIN_ID, model, at: ctx.at })
      }
      return out
    }

    // A model request is about to go out: the model it names, and one more step in the run.
    case 'turn.step':
      return [{ type: 'agent-step', id: agentOf(e) ?? MAIN_ID, model: text(e.model) || undefined, at: ctx.at }]

    case 'tool.call': {
      // A tool call is the agent working; it also resolves that agent's pending state.
      const id = agentOf(e) ?? MAIN_ID
      const working: Signal = { type: 'agent-state', id, state: 'in-progress', at: ctx.at }
      const source = typeof e.tool === 'string' ? LISTENING_TOOLS[e.tool] : undefined
      if (source === undefined) return [working]
      // A watch or webhook registration: the agent now listens for that trigger (FR-010).
      return [working, { type: 'agent-state', id, state: 'listening', listenSource: source, at: ctx.at }]
    }

    // An inbound delivery with an event: the target reacts under the event's source (FR-011).
    case 'session.receive': {
      if (!e.event || typeof e.event !== 'object') return []
      const event = e.event as { source?: unknown }
      const source = typeof event.source === 'string' && event.source.length > 0 ? event.source : 'external'
      return [
        {
          type: 'agent-react',
          id: agentOf(e) ?? MAIN_ID,
          source,
          flashMs: ctx.reactFlashMs ?? REACT_MS,
          at: ctx.at,
        },
      ]
    }

    case 'classic.PermissionRequest':
    case 'classic.Elicitation':
      return [{ type: 'agent-state', id: pendingOwner(e, ctx), state: 'pending', at: ctx.at }]

    case 'classic.Notification': {
      const kind = typeof e.notification_type === 'string' ? e.notification_type : ''
      if (!PROMPT_NOTIFICATIONS.includes(kind)) return []
      return [{ type: 'agent-state', id: pendingOwner(e, ctx), state: 'pending', at: ctx.at }]
    }

    case 'classic.ElicitationResult':
    case 'prompt.submit':
      return clearPending(ctx)

    // Spawn: the engine answers the new agent's id only after the spawn, so the hook passes it in.
    case 'agent.spawn': {
      const childId = text(e.agentId)
      if (!childId) return []
      const parent = text(e.parentAgentId) || MAIN_ID
      const label = text(e.description) || text(e.subagentType) || childId
      const model = text(e.model) || text(e.parentModel)
      return [
        ...spawnSignals(parent, childId, label, ctx.at),
        { type: 'agent-meta', id: childId, model: model || undefined, addressable: e.isTeammate === true, at: ctx.at },
      ]
    }

    case 'classic.SubagentStart': {
      const childId = text(e.agent_id)
      if (!childId) return []
      const parent = text(e.parentId) || MAIN_ID
      const label = text(e.description) || text(e.agent_type) || childId
      return [
        ...spawnSignals(parent, childId, label, ctx.at),
        ...(text(e.model) ? [{ type: 'agent-meta' as const, id: childId, model: text(e.model), at: ctx.at }] : []),
      ]
    }

    // Stop: the wait ends, the agent ends by its status, and its result burst returns to the parent.
    case 'classic.SubagentStop': {
      const childId = text(e.agent_id)
      if (!childId) return []
      const parent = text(e.parentId) || MAIN_ID
      return [
        { type: 'exchange-close', fromId: parent, toId: childId, reason: 'waiting', at: ctx.at },
        { type: 'agent-ended', id: childId, state: endStateOf(text(e.status)), at: ctx.at },
        { type: 'exchange-open', fromId: parent, toId: childId, reason: 'result', at: ctx.at },
      ]
    }

    case 'session.send': {
      const sender = agentOf(e) ?? MAIN_ID
      const recipient = resolveAgent(e.to, ctx.agents)
      if (!recipient || recipient === sender) return []
      return [{ type: 'exchange-open', fromId: sender, toId: recipient, reason: 'message', at: ctx.at }]
    }

    case 'classic.TeammateIdle': {
      const id = agentOf(e) ?? resolveAgent(e.teammate_name, ctx.agents)
      if (!id) return []
      return [{ type: 'agent-state', id, state: 'idle', at: ctx.at }]
    }

    default:
      return []
  }
}

// The engine's agent list as a reconcile: list status wins (contracts/event-mapping.md). Children of
// an agent that has ended lose their waiting exchange, since their SubagentStop may never arrive.
export function reconcileFromList(listed: ListedAgent[], at: number): Signal[] {
  const items = listed.map(info => ({
    id: info.id,
    label: info.description || info.type || info.id,
    parentId: info.parentId || MAIN_ID,
    state: listStateOf(info.status),
  }))
  // What the list knows about an agent's origin: a name or teammate address makes it reusable, and a
  // teammate or an agent a plugin started has no orchestrator among the agents drawn here.
  const metas: Signal[] = listed.flatMap(info => {
    const addressable = Boolean(info.name || info.teammateId)
    const independent = Boolean(info.teammateId)
    if (!addressable && !info.spawnedBy) return []
    return [
      {
        type: 'agent-meta' as const,
        id: info.id,
        addressable: addressable || undefined,
        independent: independent || undefined,
        spawnedBy: info.spawnedBy ?? undefined,
        at,
      },
    ]
  })
  const closes: Signal[] = []
  for (const item of items) {
    if (TERMINAL_STATES.includes(item.state)) {
      closes.push({ type: 'exchange-close', fromId: item.parentId, toId: item.id, reason: 'waiting', at })
    }
  }
  return [{ type: 'reconcile', at, listed: items }, ...metas, ...closes]
}
