import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeQuery } from '@brobot2/runtime/claude'
import { TheCliAnswersInOrder } from '../../../../packages/runtime/test/the-cli-answers-in-order'

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

/**
 * A buffered stand-in for the Claude SDK's query: `emit` queues a frame, `end` finishes the stream.
 * It counts each Stop and keeps every permission mode the adapter asked for.
 */
export class ClaudeQueryDouble {
  /** How many times the adapter asked the provider to stop — the proof a Stop is not a no-op. */
  interrupts = 0
  /** Every mode the adapter asked the SDK for — so "we told the provider" is checkable. */
  readonly modes: string[] = []
  /** ⚑ F080: it reads what the adapter sends, and each `result` names the message it answers. */
  readonly cli = new TheCliAnswersInOrder()
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1
  }
  async setPermissionMode(mode: string): Promise<void> {
    this.modes.push(mode)
  }
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }
}
