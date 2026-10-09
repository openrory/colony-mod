// PluginState contract for the colony mod. Self-contained: no imports.

export type AgentState =
  | 'idle'
  | 'in-progress'
  | 'pending'
  | 'listening'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type Agent = {
  id: string;
  label: string;
  parentId: string | null;
  state: AgentState;
  // The trigger registration (watch, webhook, a source label or external). It persists until an
  // inbound event consumes it (see reactUntil); later work does not end it.
  listenSource: string | null;
  // End of the reaction flash after an inbound event (ms), or null when not reacting.
  reactUntil: number | null;
  startedAt: number | null;
  endedAt: number | null;
  lastEventAt: number;
  // True while the engine's agent list (reconcile) names this agent; list status wins over silence.
  listed: boolean;
  // Columns this figure is pulled toward its exchange partner (0..2); eases one column per tick.
  shift: number;
  // The model it runs on, as the engine names it (an alias such as `haiku` or a full id), or null.
  model: string | null;
  // Tokens used so far, summed over its finished turns.
  usage: Usage;
  // Model requests seen in its current run (turn.step events); lets context be estimated from usage.
  steps: number;
  // Estimated tokens in its context window, or null before any estimate.
  contextTokens: number | null;
  // Columns the figure has wandered from its home cell, and where it is heading (-2..2, eased).
  wander: number;
  wanderTarget: number;
  // Reusable: addressable by name or as a teammate, so it rests (idle) instead of being removed.
  addressable: boolean;
  // Not started by an orchestrator agent in this session (no connector to main is drawn).
  independent: boolean;
  // Known only by an id no agent list names (an engine fork or a workflow's agent): drawn muted.
  background: boolean;
  // The plugin that started it, when one did.
  spawnedBy: string | null;
  // A line for the hover card about where it lives (another session's folder and last update).
  note: string | null;
};

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type Exchange = {
  id: string;
  fromId: string;
  toId: string;
  reasons: Array<'spawn' | 'message' | 'waiting' | 'result'>;
  burstUntil: number;
};

// One agent as another session shares it (contracts/shared-summary.md). Only these fields exist.
export type SharedAgent = {
  id: string;
  label: string;
  parentId: string | null;
  state: AgentState;
  listenSource: string | null;
  model: string | null;
  tokens: { in: number; out: number } | null;
};

// A session's shared summary file (version 1). An ended marker carries no name and no folder.
export type SharedSummary = {
  version: 1;
  sessionId: string;
  name?: string;
  folder?: string;
  updatedAt: number;
  ended?: boolean;
  agents: SharedAgent[];
  // Absent on an ended marker (contracts/shared-summary.md).
  exchanges?: Array<{ from: string; to: string }>;
};

// Another session as the pane draws it: its agents when it shares (source `shared`), or a single
// limited figure when it is only known from the sessions folder (source `peer`).
export type SessionGroup = {
  sessionId: string;
  name: string;
  folder: string;
  updatedAt: number;
  source: 'shared' | 'peer';
  freshness: 'live' | 'stale';
  agents: Agent[];
  // The exchanges the session shares, with agent ids namespaced as the agents are (`<sessionId>/<id>`).
  exchanges: Array<{ from: string; to: string }>;
  needsAttention: boolean;
};

export type Colony = {
  agents: Record<string, Agent>;
  exchanges: Record<string, Exchange>;
  tick: number;
  retentionMs: number;
  sessions: Record<string, SessionGroup>;
};

declare module 'claude-code' {
  interface PluginState {
    colony: { colony: Colony };
  }
}
