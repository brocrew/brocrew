import type { ClaudeQuery } from '@brobot2/runtime/claude'

// A scripted stream with the same lifecycle controls used by the compaction fixtures.
export function scriptedClaudeQuery(
  wire: Pick<ClaudeQuery, 'close' | typeof Symbol.asyncIterator>,
  controls: Partial<
    Pick<ClaudeQuery, 'interrupt' | 'setPermissionMode' | 'supportedCommands'>
  > = {},
): ClaudeQuery {
  return {
    setPermissionMode: async () => {},
    interrupt: async () => {},
    ...controls,
    close: () => wire.close(),
    [Symbol.asyncIterator]: () => wire[Symbol.asyncIterator](),
  }
}
