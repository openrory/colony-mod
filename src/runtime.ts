// Pure helpers behind hooks/register.tsx: option parsing, signal context, clock and pane decisions.
// No engine imports, so each rule is unit-tested without the engine.
import { activityOf, type SignalContext } from './signals'
import { summaryOf } from './layout'
import { isPeer, REACT_MS, shownStateOf } from './model'
import type { Agent, AgentState, Colony } from '../types'

export const DEFAULT_RETENTION_SECONDS = 30
export const CLOCK_MS = 250

// States whose figures animate; while any is present (or an exchange is open) the clock runs.
const ANIMATED: ReadonlyArray<AgentState> = ['in-progress', 'pending', 'completed', 'listening']

export type ColonyOptions = { reducedMotion: boolean; retentionMs: number; sessionsDirectory: string }

// userConfig values as the engine hands them to register(on, options). Anything unusable falls back.
export function readOptions(options: Readonly<Record<string, unknown>> | undefined): ColonyOptions {
  const raw = Number(options?.retentionSeconds)
  const seconds =
    options?.retentionSeconds !== undefined && Number.isFinite(raw) && raw >= 0
      ? raw
      : DEFAULT_RETENTION_SECONDS
  return {
    reducedMotion: options?.reducedMotion === true || options?.reducedMotion === 'true',
    retentionMs: Math.round(seconds * 1000),
    // Empty (the default) means other sessions are never read.
    sessionsDirectory: typeof options?.sessionsDirectory === 'string' ? options.sessionsDirectory.trim() : '',
  }
}

export function pendingIdsOf(colony: Colony): string[] {
  return Object.values(colony.agents)
    .filter(a => a.state === 'pending')
    .map(a => a.id)
}

// The clock runs only while a figure animates or an exchange is open, and never in reduced motion.
export function animates(colony: Colony, reducedMotion: boolean): boolean {
  if (reducedMotion) return false
  if (Object.keys(colony.exchanges).length > 0) return true
  // A figure still drifting (or easing home after it stopped working) keeps the clock running too.
  return Object.values(colony.agents).some(
    (a: Agent) => ANIMATED.includes(shownStateOf(a)) || a.wander !== a.wanderTarget || a.wanderTarget !== 0,
  )
}

// The most recently active agent, kept across events (see activityOf); unchanged by other events.
export function nextRecentAgent(previous: string | null, eventName: string, e: Record<string, unknown>): string | null {
  return activityOf(eventName, e) ?? previous
}

export function contextFor(
  colony: Colony,
  recentAgentId: string | null,
  at: number,
  reactFlashMs: number = REACT_MS,
): SignalContext {
  const agents = Object.values(colony.agents).map(a => ({ id: a.id, label: a.label }))
  return { at, recentAgentId, pendingIds: pendingIdsOf(colony), agents, reactFlashMs }
}

// The status line text, or undefined when the pane is placed (or not open at all).
export function statusFor(colony: Colony, paneOpen: boolean, placed: boolean): string | undefined {
  if (!paneOpen || placed) return undefined
  return summaryOf(Object.values(colony.agents))
}

// What justifies opening the pane: pending agents plus subagents (main alone never does).
export function attentionOf(colony: Colony): number {
  const pending = pendingIdsOf(colony).length
  const subagents = Object.values(colony.agents).filter(a => a.id !== 'main' && !isPeer(a)).length
  return pending + subagents
}

// Auto-open the first time an agent needs the user or a subagent appears, unless the user hid the pane (FR-001).
export function shouldAutoOpen(input: {
  attention: number
  hidden: boolean
  paneOpen: boolean
  firstAutoDone: boolean
}): boolean {
  return input.attention > 0 && !input.hidden && !input.paneOpen && !input.firstAutoDone
}

// Toast when a new pending appears while the open pane is not placed (narrow terminal).
export function shouldToastPending(input: {
  pendingCount: number
  previousPendingCount: number
  paneOpen: boolean
  placed: boolean
}): boolean {
  return input.paneOpen && !input.placed && input.pendingCount > input.previousPendingCount
}
