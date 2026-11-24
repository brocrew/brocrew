import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
} from '../../src/shared/runtime-ipc'

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }

  types(): string[] {
    return this.events().map((event) => event.type)
  }

  find<T extends TranscriptEvent['type']>(
    type: T,
  ): Extract<TranscriptEvent, { type: T }> | undefined {
    return this.events().find(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export { RecordingSink, waitFor }
