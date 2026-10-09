// A rough count of the tokens in a conversation, from its text. The engine does not report a
// subagent's context window while it runs, so the pane estimates it (about 3.5 characters a token).
const CHARS_PER_TOKEN = 3.5

export function estimateContextTokens(messages: ReadonlyArray<{ content?: unknown }>): number {
  let chars = 0
  for (const message of messages) {
    const content = message.content
    chars += typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length
  }
  return Math.round(chars / CHARS_PER_TOKEN)
}
