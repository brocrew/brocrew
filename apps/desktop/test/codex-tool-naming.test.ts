import { expect, it } from 'vitest'
import { transcripts } from '../src/main/providers/codex/transcripts'

it.each(['mcp__brobot__message_agent', 'brobot__message_agent'])(
  'reads current and retained legacy tool names: %s',
  (name) => {
    expect(transcripts.splitToolName!(name)).toEqual({ server: 'brobot', tool: 'message_agent' })
  },
)

it.each(['message_agent', 'mcp__brobot__', 'brobot__'])(
  'keeps malformed names unpaired: %s',
  (name) => {
    expect(transcripts.splitToolName!(name)).toBeNull()
  },
)
