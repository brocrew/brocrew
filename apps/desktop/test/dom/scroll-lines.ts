import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'

const AT = 1_700_000_000_000

export function scrollMessage(ordinal: number): RuntimeEventMessage {
  return {
    sessionId: 'sess_1',
    ordinal,
    at: AT + ordinal,
    event: {
      type: 'assistant_message',
      // ⚠️ **Fixed width on purpose.** Row height must not depend on the ordinal, or the fixture
      // measures text wrapping instead of the anchor: a 3-digit and a 4-digit ordinal can wrap
      // differently, and a page whose rows are a different height from the ones it displaces is a
      // fixture that cannot tell a correct anchor from an accidental one.
      text: `line ${String(ordinal).padStart(6, '0')} — ${'the quick brown fox jumps. '.repeat(3)}`,
    } as TranscriptEvent,
  } as RuntimeEventMessage
}

export const scrollLines = (from: number, count: number): RuntimeEventMessage[] =>
  Array.from({ length: count }, (_, index) => scrollMessage(from + index))
