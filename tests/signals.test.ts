import { test, expect } from 'claude-code/testing'
import {
  toSignals,
  activityOf,
  endStateOf,
  listStateOf,
  reconcileFromList,
  type SignalContext,
} from '../src/signals'
import type { Signal } from '../src/model'

const ctx = (over: Partial<SignalContext> = {}): SignalContext => ({
  at: 100,
  recentAgentId: null,
  pendingIds: [],
  agents: [],
  ...over,
})

test('session.start creates main as a root agent', () => {
  expect(toSignals('session.start', {}, ctx())).toEqual([
    { type: 'agent-added', id: 'main', label: 'main', parentId: null, at: 100 },
  ])
})

test('turn.start and turn.complete move main to in-progress and completed', () => {
  expect(toSignals('turn.start', { text: 'hi' }, ctx())).toEqual([
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 100 },
  ])
  expect(toSignals('turn.complete', {}, ctx())).toEqual([
    { type: 'agent-state', id: 'main', state: 'completed', at: 100 },
  ])
})

test('tool.call without agentId is main; with agentId it is that agent', () => {
  expect(toSignals('tool.call', { tool: 'Bash', tool_use_id: 't1' }, ctx())).toEqual([
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 100 },
  ])
  expect(toSignals('tool.call', { tool: 'Read', agentId: 'sub1' }, ctx())).toEqual([
    { type: 'agent-state', id: 'sub1', state: 'in-progress', at: 100 },
  ])
})

test('permission request is pending for the event agent, else the most recent agent, else main', () => {
  const pending = (id: string): Signal => ({ type: 'agent-state', id, state: 'pending', at: 100 })
  expect(toSignals('classic.PermissionRequest', { tool_name: 'Bash', agent_id: 'sub2' }, ctx())).toEqual([
    pending('sub2'),
  ])
  expect(
    toSignals('classic.PermissionRequest', { tool_name: 'Bash' }, ctx({ recentAgentId: 'sub3' })),
  ).toEqual([pending('sub3')])
  expect(toSignals('classic.PermissionRequest', { tool_name: 'Bash' }, ctx())).toEqual([pending('main')])
})

test('elicitation is pending with the same attribution', () => {
  expect(
    toSignals('classic.Elicitation', { mcp_server_name: 'x', message: 'q' }, ctx({ recentAgentId: 'sub4' })),
  ).toEqual([{ type: 'agent-state', id: 'sub4', state: 'pending', at: 100 }])
})

test('notification is pending only for permission and idle prompt types', () => {
  const pendingMain = [{ type: 'agent-state', id: 'main', state: 'pending', at: 100 }]
  expect(toSignals('classic.Notification', { notification_type: 'permission_prompt', message: 'm' }, ctx())).toEqual(
    pendingMain,
  )
  expect(toSignals('classic.Notification', { notification_type: 'idle_prompt', message: 'm' }, ctx())).toEqual(
    pendingMain,
  )
  expect(toSignals('classic.Notification', { notification_type: 'auth_success', message: 'm' }, ctx())).toEqual([])
})

test('ElicitationResult and prompt.submit clear pending for the pending agents', () => {
  const c = ctx({ pendingIds: ['sub5'] })
  const cleared: Signal[] = [{ type: 'agent-state', id: 'sub5', state: 'in-progress', at: 100 }]
  expect(toSignals('classic.ElicitationResult', { action: 'accept', mcp_server_name: 'x' }, c)).toEqual(cleared)
  expect(toSignals('prompt.submit', { text: 'go' }, c)).toEqual(cleared)
  expect(toSignals('prompt.submit', { text: 'go' }, ctx())).toEqual([])
})

test('unrelated events map to no signals', () => {
  expect(toSignals('session.send', { to: 'x', text: 'y' }, ctx())).toEqual([])
})

test('activityOf reports the agent that is active', () => {
  expect(activityOf('tool.call', { agentId: 'sub6' })).toBe('sub6')
  expect(activityOf('tool.call', {})).toBe('main')
  expect(activityOf('turn.start', {})).toBe('main')
  expect(activityOf('turn.complete', {})).toBe(null)
})

// ---- US2 rows (T022): exchanges between agents -------------------------------------------

const agents = [
  { id: 'main', label: 'main' },
  { id: 'sub1', label: 'Explore' },
  { id: 'sub2', label: 'Plan' },
]
const withAgents = (over: Partial<SignalContext> = {}): SignalContext => ctx({ agents, ...over })

test('agent.spawn adds the new agent under its parent and opens spawn and waiting exchanges', () => {
  expect(toSignals('agent.spawn', { agentId: 'sub1', description: 'Find files', subagentType: 'Explore' }, ctx())).toEqual([
    { type: 'agent-added', id: 'sub1', label: 'Find files', parentId: 'main', at: 100 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub1', reason: 'spawn', at: 100 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub1', reason: 'waiting', at: 100 },
    { type: 'agent-meta', id: 'sub1', model: undefined, addressable: false, at: 100 },
  ])
  expect(toSignals('agent.spawn', { agentId: 'sub2', parentAgentId: 'sub1', subagentType: 'Plan' }, ctx())[0]).toEqual(
    { type: 'agent-added', id: 'sub2', label: 'Plan', parentId: 'sub1', at: 100 },
  )
})

test('agent.spawn without an agent id (refused spawn) maps to no signals', () => {
  expect(toSignals('agent.spawn', { description: 'x', subagentType: 'Explore' }, ctx())).toEqual([])
})

test('classic.SubagentStart adds the agent with its parent and opens the same exchanges', () => {
  expect(
    toSignals('classic.SubagentStart', { agent_id: 'sub1', agent_type: 'Explore', parentId: 'main', description: 'Scan' }, ctx()),
  ).toEqual([
    { type: 'agent-added', id: 'sub1', label: 'Scan', parentId: 'main', at: 100 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub1', reason: 'spawn', at: 100 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub1', reason: 'waiting', at: 100 },
  ])
  // Without a known parent or description the agent hangs off main and is labelled by its type.
  expect(toSignals('classic.SubagentStart', { agent_id: 'sub2', agent_type: 'Plan' }, ctx())[0]).toEqual(
    { type: 'agent-added', id: 'sub2', label: 'Plan', parentId: 'main', at: 100 },
  )
})

test('SubagentStop closes waiting, ends the agent by status and opens a result burst to the parent', () => {
  const stop = (status?: string): Signal[] =>
    toSignals('classic.SubagentStop', { agent_id: 'sub1', agent_type: 'Explore', parentId: 'main', status }, ctx())
  const ended = (state: 'completed' | 'failed' | 'cancelled'): Signal[] => [
    { type: 'exchange-close', fromId: 'main', toId: 'sub1', reason: 'waiting', at: 100 },
    { type: 'agent-ended', id: 'sub1', state, at: 100 },
    { type: 'exchange-open', fromId: 'main', toId: 'sub1', reason: 'result', at: 100 },
  ]
  expect(stop('completed')).toEqual(ended('completed'))
  expect(stop('failed')).toEqual(ended('failed'))
  expect(stop('killed')).toEqual(ended('cancelled'))
  expect(stop(undefined)).toEqual(ended('completed'))
})

test('endStateOf maps engine statuses to the ending states', () => {
  expect(endStateOf('completed')).toBe('completed')
  expect(endStateOf('failed')).toBe('failed')
  expect(endStateOf('killed')).toBe('cancelled')
  expect(endStateOf('running')).toBe('completed')
  expect(endStateOf(undefined)).toBe('completed')
})

test('listStateOf maps every AgentStatus to one AgentState', () => {
  expect(listStateOf('pending')).toBe('idle')
  expect(listStateOf('idle')).toBe('idle')
  expect(listStateOf('running')).toBe('in-progress')
  expect(listStateOf('waiting')).toBe('in-progress')
  expect(listStateOf('completed')).toBe('completed')
  expect(listStateOf('failed')).toBe('failed')
  expect(listStateOf('killed')).toBe('cancelled')
})

test('session.send opens a message burst from the sender (agentId or main) to the recipient', () => {
  const burst = (fromId: string, toId: string): Signal => ({
    type: 'exchange-open',
    fromId,
    toId,
    reason: 'message',
    at: 100,
  })
  expect(toSignals('session.send', { to: 'Explore', text: 'hi' }, withAgents())).toEqual([burst('main', 'sub1')])
  expect(toSignals('session.send', { to: 'main', text: 'ok', agentId: 'sub1' }, withAgents())).toEqual([
    burst('sub1', 'main'),
  ])
  expect(toSignals('session.send', { to: { agentId: 'sub2' }, text: 'x' }, withAgents())).toEqual([burst('main', 'sub2')])
})

test('session.send to an unknown recipient or to oneself maps to no signals', () => {
  expect(toSignals('session.send', { to: 'nobody', text: 'hi' }, withAgents())).toEqual([])
  expect(toSignals('session.send', { to: 'Explore', text: 'hi', agentId: 'sub1' }, withAgents())).toEqual([])
})

test('classic.TeammateIdle makes the named teammate idle', () => {
  expect(toSignals('classic.TeammateIdle', { teammate_name: 'Explore' }, withAgents())).toEqual([
    { type: 'agent-state', id: 'sub1', state: 'idle', at: 100 },
  ])
  expect(toSignals('classic.TeammateIdle', { teammate_name: 'nobody' }, withAgents())).toEqual([])
})

test('reconcileFromList turns the engine list into a reconcile and closes waiting for ended children', () => {
  const listed = [
    { id: 'sub1', description: 'Scan', type: 'Explore', parentId: undefined, status: 'running' as const },
    { id: 'sub2', description: 'Plan', type: 'Plan', parentId: 'sub1', status: 'killed' as const },
    { id: 'sub3', description: '', type: 'general-purpose', status: 'completed' as const },
  ]
  expect(reconcileFromList(listed, 500)).toEqual([
    {
      type: 'reconcile',
      at: 500,
      listed: [
        { id: 'sub1', label: 'Scan', parentId: 'main', state: 'in-progress' },
        { id: 'sub2', label: 'Plan', parentId: 'sub1', state: 'cancelled' },
        { id: 'sub3', label: 'general-purpose', parentId: 'main', state: 'completed' },
      ],
    },
    { type: 'exchange-close', fromId: 'sub1', toId: 'sub2', reason: 'waiting', at: 500 },
    { type: 'exchange-close', fromId: 'main', toId: 'sub3', reason: 'waiting', at: 500 },
  ])
})

// ---- US3 rows (T032): listening registrations and reactions -------------------------------

test('Monitor and RemoteTrigger tool calls register a listener with source watch or webhook', () => {
  expect(toSignals('tool.call', { tool: 'Monitor', agentId: 'sub1' }, withAgents())).toEqual([
    { type: 'agent-state', id: 'sub1', state: 'in-progress', at: 100 },
    { type: 'agent-state', id: 'sub1', state: 'listening', listenSource: 'watch', at: 100 },
  ])
  expect(toSignals('tool.call', { tool: 'RemoteTrigger' }, withAgents())).toEqual([
    { type: 'agent-state', id: 'main', state: 'in-progress', at: 100 },
    { type: 'agent-state', id: 'main', state: 'listening', listenSource: 'webhook', at: 100 },
  ])
})

test('ScheduleWakeup and CronCreate are the agent own timers and never register a listener', () => {
  for (const tool of ['ScheduleWakeup', 'CronCreate', 'Bash']) {
    const signals = toSignals('tool.call', { tool, agentId: 'sub1' }, withAgents())
    expect(signals).toEqual([{ type: 'agent-state', id: 'sub1', state: 'in-progress', at: 100 }])
  }
})

test('session.receive with an event source reacts the target agent under that source label', () => {
  const event = { source: 'github', kind: 'pull_request.closed', data: {}, untrustedKeys: [] }
  expect(
    toSignals('session.receive', { origin: { kind: 'task-notification' }, text: 'x', event, agentId: 'sub1' }, withAgents()),
  ).toEqual([{ type: 'agent-react', id: 'sub1', source: 'github', flashMs: 1000, at: 100 }])
  expect(toSignals('session.receive', { origin: { kind: 'task-notification' }, text: 'x', event }, withAgents())).toEqual([
    { type: 'agent-react', id: 'main', source: 'github', flashMs: 1000, at: 100 },
  ])
})

test('session.receive without an event source is labelled external; plain text is no signal', () => {
  const event = { kind: 'ping', data: {}, untrustedKeys: [] }
  expect(toSignals('session.receive', { origin: { kind: 'bridge' }, text: 'x', event }, withAgents())).toEqual([
    { type: 'agent-react', id: 'main', source: 'external', flashMs: 1000, at: 100 },
  ])
  expect(toSignals('session.receive', { origin: { kind: 'peer' }, text: 'hello' }, withAgents())).toEqual([])
})

test('session.receive uses the flash length from the context (zero under reduced motion)', () => {
  const event = { source: 'jira', kind: 'issue', data: {}, untrustedKeys: [] }
  expect(
    toSignals('session.receive', { origin: { kind: 'bridge' }, text: 'x', event }, withAgents({ reactFlashMs: 0 })),
  ).toEqual([{ type: 'agent-react', id: 'main', source: 'jira', flashMs: 0, at: 100 }])
})

test('agent.spawn carries the model (own, else the parent) and marks a teammate reusable', () => {
  const spawn = toSignals('agent.spawn', { agentId: 's', model: 'haiku', parentModel: 'opus', isTeammate: true }, ctx())
  expect(spawn.at(-1)).toEqual({ type: 'agent-meta', id: 's', model: 'haiku', addressable: true, at: 100 })
  const inherits = toSignals('agent.spawn', { agentId: 's', parentModel: 'opus' }, ctx())
  expect(inherits.at(-1)).toEqual({ type: 'agent-meta', id: 's', model: 'opus', addressable: false, at: 100 })
})

test('turn.complete in a subagent loop is that agent usage only; main completes on its own turn', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2, model: 'claude-haiku-5-5' }
  expect(toSignals('turn.complete', { agentId: 'w', usage }, ctx())).toEqual([
    { type: 'agent-usage', id: 'w', usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 }, at: 100 },
    { type: 'agent-meta', id: 'w', model: 'claude-haiku-5-5', at: 100 },
  ])
  const main = toSignals('turn.complete', { usage }, ctx())
  expect(main[0]).toEqual({ type: 'agent-state', id: 'main', state: 'completed', at: 100 })
  expect(main.some(x => x.type === 'agent-usage' && x.id === 'main')).toBe(true)
})

test('turn.step counts a step for its agent and names the model', () => {
  expect(toSignals('turn.step', { agentId: 'w', model: 'claude-opus-5-5' }, ctx())).toEqual([
    { type: 'agent-step', id: 'w', model: 'claude-opus-5-5', at: 100 },
  ])
})

test('reconcile marks named agents and teammates reusable, teammates independent', () => {
  const out = reconcileFromList(
    [
      { id: 'a', status: 'idle', name: 'reviewer' },
      { id: 'b', status: 'running', teammateId: 'x@team', spawnedBy: 'plug' },
      { id: 'c', status: 'running' },
    ],
    100,
  )
  const metas = out.filter(x => x.type === 'agent-meta')
  expect(metas.length).toBe(2)
  expect(metas[0]).toMatchObject({ id: 'a', addressable: true })
  expect(metas[1]).toMatchObject({ id: 'b', addressable: true, independent: true, spawnedBy: 'plug' })
})
