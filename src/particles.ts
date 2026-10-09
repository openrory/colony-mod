// The 0/1 stream drawn between two exchanging figures (FR-008). Pure: glyphs for a width and tick.

// Glyph at absolute position k: alternates along the line, so the stream never repeats in place.
function bitAt(k: number): '0' | '1' {
  return ((k % 2) + 2) % 2 === 0 ? '0' : '1'
}

// `width` glyphs; each tick every glyph flips and the line moves one glyph along.
export function stream(width: number, tick: number): string {
  let out = ''
  for (let i = 0; i < width; i++) out += bitAt(i + tick)
  return out
}
