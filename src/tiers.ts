// What a figure's size and shading say about its agent: the model it runs on (size) and how full
// its context window is (a darker fill rising from the feet). Pure helpers; no engine imports.
import type { Agent, AgentState } from '../types'

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'

// Sprite size in pixels per side, per model tier: a bigger model is a bigger figure. The drawings are
// 8 pixels, so the smallest tier is the drawing itself and the others are scaled up from it.
export const TIER_PIXELS: Readonly<Record<Tier, number>> = { haiku: 8, sonnet: 10, opus: 12, fable: 16 }

// A model id or alias -> its tier; null when the model is unknown or not one of the four.
export function tierOf(model: string | null): Tier | null {
  const name = (model ?? '').toLowerCase()
  if (name.includes('haiku')) return 'haiku'
  if (name.includes('sonnet')) return 'sonnet'
  if (name.includes('opus')) return 'opus'
  if (name.includes('fable')) return 'fable'
  return null
}

// The sprite size for a model: its tier's, or the base drawing when the tier is unknown.
export function pixelsOf(model: string | null): number {
  const tier = tierOf(model)
  return tier === null ? TIER_PIXELS.haiku : TIER_PIXELS[tier]
}

const DEFAULT_WINDOW = 200_000
const LARGE_WINDOW = 1_000_000

// The context window assumed for a model: 1M when its id says so or it is a 5.5 model, else 200k. The engine does not
// report a subagent's window, so this is an assumption the hover card marks with a tilde.
export function windowOf(model: string | null): number {
  return /\[1m\]|-1m\b|-5-5\b/i.test(model ?? '') ? LARGE_WINDOW : DEFAULT_WINDOW
}

// How full the agent's context is, 0..1, or null while nothing is known.
export function fillOf(agent: Pick<Agent, 'model' | 'contextTokens'>): number | null {
  if (agent.contextTokens === null) return null
  return Math.max(0, Math.min(1, agent.contextTokens / windowOf(agent.model)))
}

// 12345 -> 12.3k, 1234567 -> 1.2M.
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

const STATE_WORD: Readonly<Record<AgentState, string>> = {
  idle: 'asleep',
  'in-progress': 'working',
  pending: 'needs you',
  listening: 'listening',
  completed: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  unknown: 'unknown',
}

// Wrap text to a width on word boundaries; a word longer than the width is split.
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while ([...w].length > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push([...w].slice(0, width).join(''))
      w = [...w].slice(width).join('')
    }
    if (!line) line = w
    else if ([...line].length + 1 + [...w].length <= width) line += ` ${w}`
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

// The hover card for one agent: its full title, then what it is and what it has used.
export function detailsOf(agent: Agent, shown: AgentState): string[] {
  const lines: string[] = [STATE_WORD[shown]]
  if (agent.note) lines.push(agent.note)
  const tier = tierOf(agent.model)
  const model = agent.model ? (tier ? `${agent.model} (${tier})` : agent.model) : 'model unknown'
  lines.push(model)
  const u = agent.usage
  if (u.input + u.output + u.cacheRead + u.cacheWrite > 0) {
    lines.push(`tokens ${compact(u.input + u.cacheWrite)} in, ${compact(u.output)} out`)
    if (u.cacheRead > 0) lines.push(`cache read ${compact(u.cacheRead)}`)
  } else {
    lines.push('tokens not reported yet')
  }
  const fill = fillOf(agent)
  if (fill !== null) lines.push(`context ~${Math.round(fill * 100)}% of ${compact(windowOf(agent.model))}`)
  if (agent.spawnedBy) lines.push(`started by ${agent.spawnedBy}`)
  else if (agent.independent) lines.push('not started by an agent here')
  if (agent.addressable) lines.push('reusable')
  return lines
}
