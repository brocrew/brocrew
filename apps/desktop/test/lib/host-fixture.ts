import type { RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'

export class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}
