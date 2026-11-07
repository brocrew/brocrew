import { FakeRuntime, type FakeSessionHandle, type StartOptions } from '@brobot2/runtime'
import type { WebContents } from 'electron'
import { executeRuntimeCommand, webContentsSink } from '../../src/main/runtime/ipc'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import {
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
} from '../../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from './the-wire'

export class IssuedSessionRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  latest(): FakeSessionHandle {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

/** One window, as far as the main process can tell — the three members `webContentsSink` reads. */
export class DemoWindow {
  private destroyed = false
  readonly received: RuntimeEventMessage[] = []
  private onEvent: ((message: RuntimeEventMessage) => void)[] = []
  private onLiveness: ((message: SessionLivenessMessage) => void)[] = []

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, message: unknown): void {
    if (channel === RUNTIME_EVENT_CHANNEL) {
      const event = message as RuntimeEventMessage
      this.received.push(event)
      for (const listener of this.onEvent) listener(event)
    }
    if (channel === RUNTIME_LIVENESS_CHANNEL) {
      for (const listener of this.onLiveness) listener(message as SessionLivenessMessage)
    }
  }

  destroy(): void {
    this.destroyed = true
  }

  /** The renderer end: a `RuntimeBridge` built by the SAME rule the preload builds one by. */
  bridge(host: RuntimeHost, aPersonIsBehindIt = true): RuntimeBridge {
    const sink = {
      ...webContentsSink(this as unknown as WebContents),
      ...(!aPersonIsBehindIt ? { ownerId: `mcp:fixture-${this.id}` } : {}),
      aPersonIsBehindIt,
    }
    const subscriptions = {
      onEvent: (fn: (message: RuntimeEventMessage) => void) => {
        this.onEvent.push(fn)
        return () => {
          this.onEvent = this.onEvent.filter((listener) => listener !== fn)
        }
      },
      onLiveness: (fn: (message: SessionLivenessMessage) => void) => {
        this.onLiveness.push(fn)
        return () => {
          this.onLiveness = this.onLiveness.filter((listener) => listener !== fn)
        }
      },
    }
    return new Proxy(subscriptions, {
      get: (base, name: string) =>
        name in base
          ? base[name as keyof typeof base]
          : (input?: Record<string, unknown>) => {
              // IPC invocation clones the command and rejects uncloneable inputs.
              let carried: unknown
              try {
                carried = asTheWireWouldCarry(name, { kind: name, ...(input ?? {}) })
              } catch (refusal) {
                return Promise.reject(refusal as Error)
              }
              return executeRuntimeCommand(
                host,
                sink,
                carried as Parameters<typeof executeRuntimeCommand>[2],
              )
            },
    }) as unknown as RuntimeBridge
  }
}
