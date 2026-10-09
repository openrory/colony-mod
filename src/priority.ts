import type { AgentState } from '../types'

// Highest precedence first (FR-013). failed and cancelled share a rank.
const RANK: Record<AgentState, number> = {
  pending: 7,
  listening: 6,
  'in-progress': 5,
  failed: 4,
  cancelled: 4,
  completed: 3,
  idle: 2,
  unknown: 1,
}

export function resolveState(candidates: AgentState[]): AgentState {
  let best: AgentState = 'unknown'
  let bestRank = 0
  for (const candidate of candidates) {
    const rank = RANK[candidate]
    if (rank > bestRank) {
      best = candidate
      bestRank = rank
    }
  }
  return best
}
