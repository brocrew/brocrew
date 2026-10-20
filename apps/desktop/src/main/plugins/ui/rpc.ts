import type { PluginValueSchema, PluginManifest } from '../package-schema'
import {
  boundedJson,
  exact,
  plain,
  pluginUiPacket,
  PLUGIN_UI_BUSY,
  PLUGIN_UI_LIMITS,
  PLUGIN_UI_UNAVAILABLE,
} from '../../../shared/plugin-ui'

export interface PluginUiBinding {
  pluginId: string
  releaseDigest: string
  installId: string
  incarnation: string
  leaseId: string
}
/** This authenticated adapter is bound by the supervisor; snapshots contain public UI data only. */
export interface PluginUiPeer {
  read(
    payload: unknown,
    revision: number,
    binding: Readonly<PluginUiBinding>,
    signal: AbortSignal,
  ): Promise<unknown>
  subscribe(
    payload: unknown,
    revision: number,
    binding: Readonly<PluginUiBinding>,
    signal: AbortSignal,
    emit: (publicSnapshot: unknown) => void,
  ): Promise<() => void>
  proposeConfig(
    payload: unknown,
    revision: number,
    binding: Readonly<PluginUiBinding>,
    signal: AbortSignal,
  ): Promise<unknown>
}
type Schemas = NonNullable<PluginManifest['ui']>['methodSchemas']
export function matchesUiSchema(value: unknown, schema: PluginValueSchema): boolean {
  if (schema.enum && !schema.enum.some((item) => item === value)) return false
  switch (schema.type) {
    case 'null':
      return value === null
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (schema.type !== 'integer' || Number.isSafeInteger(value)) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      )
    case 'string':
      return typeof value === 'string' && value.length <= (schema.maxLength ?? 0)
    case 'array':
      return (
        Array.isArray(value) &&
        value.length <= (schema.maxItems ?? 0) &&
        schema.items !== undefined &&
        value.every((item) => matchesUiSchema(item, schema.items!))
      )
    case 'object':
      return (
        plain(value) &&
        Object.keys(value).every(
          (key) =>
            Object.hasOwn(schema.properties ?? {}, key) &&
            matchesUiSchema(value[key], schema.properties![key]!),
        ) &&
        (schema.required ?? []).every((key) => Object.hasOwn(value, key))
      )
  }
}
interface Subscription {
  abort: AbortController
  stop?: () => void
}
export class PluginUiRpc {
  private readonly pending = new Map<string, AbortController>()
  private readonly subscriptions = new Map<string, Subscription>()
  private closed = false
  private lastSnapshot = -Infinity
  private waitingSnapshots = 0
  private readTurn = Promise.resolve()
  constructor(
    private readonly options: {
      binding: Readonly<PluginUiBinding>
      schemas: Schemas
      peer: PluginUiPeer
      current(): boolean
      emit(subscriptionId: string, publicSnapshot: unknown): void
      propose(publicProposal: unknown, revision: number): void
      now(): number
    },
  ) {}
  private live(): boolean {
    try {
      return !this.closed && this.options.current()
    } catch {
      return false
    }
  }
  private data(value: unknown): unknown {
    const json = boundedJson(value, PLUGIN_UI_LIMITS.reply)
    if (json === null) throw new Error(PLUGIN_UI_UNAVAILABLE)
    return JSON.parse(json)
  }
  async invoke(input: unknown): Promise<unknown> {
    if (
      !this.live() ||
      !pluginUiPacket(input) ||
      !matchesUiSchema(input.payload, this.options.schemas[input.method])
    )
      throw new Error(PLUGIN_UI_UNAVAILABLE)
    if (this.pending.has(input.requestId) || this.pending.size >= PLUGIN_UI_LIMITS.pending)
      throw new Error(PLUGIN_UI_BUSY)
    if (
      input.method === 'subscribe' &&
      (this.subscriptions.size >= PLUGIN_UI_LIMITS.subscriptions ||
        this.subscriptions.has(input.requestId))
    )
      throw new Error(PLUGIN_UI_BUSY)
    const abort = new AbortController(),
      binding = this.options.binding
    this.pending.set(input.requestId, abort)
    const previousRead = this.readTurn
    let releaseRead: (() => void) | undefined
    if (input.method === 'read') {
      this.waitingSnapshots++
      this.readTurn = new Promise<void>((resolve) => {
        releaseRead = resolve
      })
    }
    const perform = async () => {
      if (input.method === 'read') await previousRead
      if (!this.live() || abort.signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
      return this.perform(input, binding, abort)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let canceled: (() => void) | undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      canceled = () => reject(new Error(PLUGIN_UI_UNAVAILABLE))
      abort.signal.addEventListener('abort', canceled, { once: true })
    })
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error(PLUGIN_UI_UNAVAILABLE))
      }, PLUGIN_UI_LIMITS.timeout)
    })
    try {
      const answer = await Promise.race([perform(), timeout, cancellation])
      if (!this.live() || abort.signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
      return this.data(answer)
    } catch {
      if (input.method === 'subscribe') this.unsubscribe(input.requestId, abort)
      throw new Error(PLUGIN_UI_UNAVAILABLE)
    } finally {
      clearTimeout(timer)
      if (canceled) abort.signal.removeEventListener('abort', canceled)
      this.pending.delete(input.requestId)
      if (releaseRead) {
        this.waitingSnapshots--
        releaseRead()
      }
      if (!this.subscriptions.has(input.requestId)) abort.abort()
    }
  }
  private async perform(
    input: import('../../../shared/plugin-ui').PluginUiPacket,
    binding: Readonly<PluginUiBinding>,
    abort: AbortController,
  ): Promise<unknown> {
    switch (input.method) {
      case 'read': {
        await this.snapshotSlot(abort.signal)
        const value = this.data(
          await this.options.peer.read(input.payload, input.configRevision, binding, abort.signal),
        )
        if (!this.live() || abort.signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
        this.lastSnapshot = this.options.now()
        return value
      }
      case 'subscribe': {
        const slot: Subscription = { abort }
        this.subscriptions.set(input.requestId, slot)
        try {
          const stop = await this.options.peer.subscribe(
            input.payload,
            input.configRevision,
            binding,
            abort.signal,
            (value) => {
              if (
                !this.live() ||
                abort.signal.aborted ||
                this.subscriptions.get(input.requestId) !== slot ||
                this.waitingSnapshots > 0 ||
                this.options.now() - this.lastSnapshot < 1000
              )
                return
              try {
                const snapshot = this.data(value)
                this.lastSnapshot = this.options.now()
                this.options.emit(input.requestId, snapshot)
              } catch {
                this.unsubscribe(input.requestId, abort)
              }
            },
          )
          if (
            !this.live() ||
            abort.signal.aborted ||
            this.subscriptions.get(input.requestId) !== slot
          ) {
            stop()
            throw new Error(PLUGIN_UI_UNAVAILABLE)
          }
          slot.stop = stop
          return { subscriptionId: input.requestId }
        } catch {
          this.unsubscribe(input.requestId, abort)
          throw new Error(PLUGIN_UI_UNAVAILABLE)
        }
      }
      case 'unsubscribe': {
        if (
          !plain(input.payload) ||
          !exact(input.payload, ['subscriptionId']) ||
          typeof input.payload.subscriptionId !== 'string' ||
          !this.subscriptions.has(input.payload.subscriptionId)
        )
          throw new Error(PLUGIN_UI_UNAVAILABLE)
        this.unsubscribe(input.payload.subscriptionId)
        return { unsubscribed: true }
      }
      case 'proposeConfig': {
        const proposal = this.data(
          await this.options.peer.proposeConfig(
            input.payload,
            input.configRevision,
            binding,
            abort.signal,
          ),
        )
        if (!this.live() || abort.signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
        this.options.propose(proposal, input.configRevision)
        return { proposed: true }
      }
    }
  }
  /** A successful Apply is followed immediately by a read. Pace its reply rather than
   * misreporting the committed change as unavailable. The existing pending/deadline limits
   * bound waiters; subscription pushes cannot consume a queued reader's next slot.
   */
  private async snapshotSlot(signal: AbortSignal): Promise<void> {
    while (this.options.now() - this.lastSnapshot < 1000) {
      if (!this.live() || signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
      const remaining = Math.min(1000, 1000 - (this.options.now() - this.lastSnapshot))
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }, remaining)
        const cancel = () => {
          clearTimeout(timer)
          reject(new Error(PLUGIN_UI_UNAVAILABLE))
        }
        signal.addEventListener('abort', cancel, { once: true })
      })
    }
    if (!this.live() || signal.aborted) throw new Error(PLUGIN_UI_UNAVAILABLE)
  }

  private unsubscribe(id: string, owner?: AbortController): void {
    const slot = this.subscriptions.get(id)
    // Async cleanup belongs to this invocation, even if its request ID was reused.
    if (owner && slot?.abort !== owner) return
    this.subscriptions.delete(id)
    slot?.abort.abort()
    try {
      slot?.stop?.()
    } catch {
      /* no peer errors cross into the page */
    }
  }
  close(): void {
    this.closed = true
    for (const abort of this.pending.values()) abort.abort()
    for (const id of this.subscriptions.keys()) this.unsubscribe(id)
  }
}
