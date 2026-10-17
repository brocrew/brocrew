import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * 🔴 **F080 — what a Claude CLI double owes the adapter: a `result` names the message it answers.**
 *
 * ⚑ Measured on CLI 2.1.287 (`probe:claude-provider-burst`): every `result` that answers a message
 * the app sent echoes that message's uuid (`user_message_uuid`, `user_message_uuids`), and a loop
 * the CLI ran for itself — a wake, the empty loop for a stopped task's notice — names none. The
 * adapter ends a turn only on the result that names the turn's own message.
 *
 * ⚑ So a double READS what the adapter sends, as the CLI does, and stamps each `result` it yields
 * with the oldest message not yet answered — the CLI's queue order, which is also why a stopped
 * turn's late result names the stopped turn's message and not its replacement's. ⚑ A result that
 * already says (`user_message_uuid` present, `null` for a loop of the CLI's own) is left as it is.
 */
export class TheCliAnswersInOrder {
  private readonly unanswered: string[] = []

  /** Read the prompt the adapter writes to, as the CLI does. */
  listen(prompt: AsyncIterable<unknown>): void {
    void (async () => {
      for await (const message of prompt) {
        const uuid = (message as { uuid?: unknown }).uuid
        if (typeof uuid === 'string') this.unanswered.push(uuid)
      }
    })().catch(() => {})
  }

  /** A frame as the CLI would yield it: a `result` names the message it answers. */
  stamp(message: SDKMessage): SDKMessage {
    if (message.type !== 'result' || 'user_message_uuid' in message) return message
    const uuid = this.unanswered.shift()
    if (uuid === undefined) return message
    return { ...message, user_message_uuid: uuid, user_message_uuids: [uuid] } as SDKMessage
  }

  /** An iterator whose results are stamped as they are read — after what was sent before them. */
  over(inner: AsyncIterator<SDKMessage>): AsyncIterator<SDKMessage> {
    return {
      next: async () => {
        const step = await inner.next()
        return step.done === true ? step : { done: false, value: this.stamp(step.value) }
      },
      return: async (value?: unknown) =>
        inner.return
          ? inner.return(value as never)
          : { done: true as const, value: undefined as never },
    }
  }
}
