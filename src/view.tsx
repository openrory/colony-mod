// Scene -> element tree (contracts/pane-render.md). JSX compiles to the engine's global `h`;
// this module neither declares nor imports it. Box and Text come from $.ui.resolve(e).
//
// Two layers: the background (connectors, streams, the `+N done` line) is rows of text, and every
// figure sits on top as an absolutely positioned box so it can carry a hover. The hover card is its
// own box at the top level, in the figure's hover group, so no later figure can paint over it.
import type { Figure, Scene } from './layout'
import { stream } from './particles'
import { BACKGROUND_COLOUR, BACKGROUND_COLOUR_DARK, renderCells, STATE_COLOUR, STATE_COLOUR_DARK } from './sprites'
import { wrap } from './tiers'

// An element constructor from the engine's element table. Typed loosely: the engine checks its props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tag = (props: any) => any
export type Tags = { Box: Tag; Text: Tag }

// One screen cell: a character plus the style it is drawn in.
type Cell = { ch: string; color?: string; dim?: boolean }

const BLANK: Cell = { ch: ' ' }

// The eye colour: bright against both the body colour and its darker fill.
export const EYE_COLOUR = 'white'

// Paint the background layer onto a cell grid: connectors, then streams, then the overflow line.
export function paint(scene: Scene): Cell[][] {
  const { columns, rows } = scene.viewport
  const width = Math.max(
    0,
    ...scene.streams.map(s => s.x + s.width),
    ...scene.connectors.map(c => c.x + 1),
    ...scene.figures.map(f => f.x + f.width),
  )
  const height = Math.max(
    0,
    ...scene.figures.map(f => f.y + f.height),
    ...scene.streams.map(s => s.row + 1),
    ...scene.connectors.map(c => c.y + 1),
    scene.overflowRow + 1,
  )
  const grid: Cell[][] = Array.from({ length: Math.min(height, rows) }, () =>
    Array.from({ length: Math.min(width, columns) }, () => BLANK),
  )

  for (const c of scene.connectors) if (grid[c.y]?.[c.x]) grid[c.y]![c.x] = { ch: '│', dim: true }

  for (const s of scene.streams) {
    const glyphs = [...stream(s.width, scene.tick)]
    glyphs.forEach((ch, i) => {
      if (grid[s.row]?.[s.x + i]) grid[s.row]![s.x + i] = { ch, color: 'cyan' }
    })
  }

  if (scene.overflowRow >= 0 && grid[scene.overflowRow]) {
    const line = `+${scene.collapsed} done`
    ;[...line].forEach((ch, i) => {
      if (grid[scene.overflowRow]![i]) grid[scene.overflowRow]![i] = { ch, dim: true }
    })
  }
  return grid
}

// Consecutive cells with the same style become one Text element.
function runsOf(cells: Cell[]): Cell[][] {
  const runs: Cell[][] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last[0]!.color === cell.color && last[0]!.dim === cell.dim) last.push(cell)
    else runs.push([cell])
  }
  return runs
}

// A text run of one figure row: same foreground and background colour.
type Run = { text: string; color?: string; background?: string }

// The rows of a figure's sprite as coloured runs. The fraction of the context window in use fills the
// body from the feet up in the darker shade of the state colour; eyes stay bright.
export function spriteRuns(figure: Figure): Run[][] {
  const cells = renderCells(figure.grid)
  const body = figure.background ? BACKGROUND_COLOUR : STATE_COLOUR[figure.state]
  const dark = figure.background ? BACKGROUND_COLOUR_DARK : (STATE_COLOUR_DARK[figure.state] ?? body)
  const filledRows =
    figure.fill === null ? 0 : figure.fill <= 0 ? 0 : Math.max(1, Math.round(figure.fill * cells.length))
  return cells.map((row, r) => {
    const ink = r >= cells.length - filledRows ? dark : body
    const colourOf = (kind: 'ink' | 'eye' | null) => (kind === 'eye' ? EYE_COLOUR : kind === 'ink' ? ink : undefined)
    const runs: Run[] = []
    for (const cell of row) {
      const color = colourOf(cell.fg)
      const background = colourOf(cell.bg)
      const last = runs[runs.length - 1]
      if (last && last.color === color && last.background === background) last.text += cell.ch
      else runs.push({ text: cell.ch, color, background })
    }
    return runs
  })
}

const CARD_MAX_WIDTH = 44
const CARD_MIN_WIDTH = 16

// The hover card's lines and size: the full title wrapped, then the details.
export function cardOf(figure: Figure, columns: number): { title: string[]; details: string[]; width: number; height: number } {
  const inner = Math.max(8, Math.min(CARD_MAX_WIDTH, columns) - 4)
  const title = wrap(figure.title, inner)
  const details = figure.details.flatMap(line => wrap(line, inner))
  const longest = Math.max(...title.map(l => [...l].length), ...details.map(l => [...l].length))
  const width = Math.min(columns, Math.max(CARD_MIN_WIDTH, longest + 4))
  return { title, details, width, height: title.length + details.length + 2 }
}

export function renderPane(scene: Scene, { Box, Text }: Tags) {
  if (scene.empty) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No agents yet.</Text>
      </Box>
    )
  }
  if (scene.tooSmall) {
    return (
      <Box flexDirection="column">
        <Text>{scene.summary}</Text>
      </Box>
    )
  }

  const { columns, rows } = scene.viewport
  const grid = paint(scene)
  const height = Math.max(grid.length, ...scene.figures.map(f => f.y + f.height))

  return (
    <Box flexDirection="column" width={columns} height={Math.min(rows, Math.max(height, 1))}>
      {grid.map(cells => {
        if (cells.length === 0) return <Text> </Text>
        return (
          <Box flexDirection="row">
            {runsOf(cells).map(run => (
              <Text color={run[0]!.color} dimColor={run[0]!.dim}>
                {run.map(c => c.ch).join('')}
              </Text>
            ))}
          </Box>
        )
      })}
      {scene.figures.map((figure, i) => (
        <Box
          key={`f${i}`}
          position="absolute"
          left={figure.x}
          top={figure.y}
          width={figure.width}
          height={figure.height}
          flexDirection="column"
          hover={{ scope: `fig${i}` }}
        >
          {spriteRuns(figure).map(runs => (
            <Box flexDirection="row">
              {runs.map(run => (
                <Text color={run.color} backgroundColor={run.background}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
          <Text dimColor>{figure.label.padEnd(figure.width)}</Text>
        </Box>
      ))}
      {scene.figures.map((figure, i) => {
        const card = cardOf(figure, columns)
        const left = Math.max(0, Math.min(figure.x, columns - card.width))
        // Below the figure when it fits, else above it.
        const below = figure.y + figure.height
        const top = below + card.height <= rows ? below : Math.max(0, figure.y - card.height)
        return (
          <Box
            position="absolute"
            left={left}
            top={top}
            width={card.width}
            display="none"
            hover={{ display: 'flex', scope: `fig${i}` }}
            flexDirection="column"
            borderStyle="round"
            paddingX={1}
          >
            {card.title.map(line => (
              <Text bold>{line}</Text>
            ))}
            {card.details.map(line => (
              <Text dimColor>{line}</Text>
            ))}
          </Box>
        )
      })}
      {scene.hidden > 0 && <Text dimColor>+{scene.hidden} not shown</Text>}
    </Box>
  )
}
