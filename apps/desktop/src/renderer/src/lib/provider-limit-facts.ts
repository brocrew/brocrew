import { computed, shallowRef } from 'vue'
import type {
  CreatedSession,
  RuntimeBridge,
  RuntimeStatesMessage,
} from '../../../shared/runtime-ipc'
import { mergeProviderBlock, type ProviderBlockFacts } from './provider-limit-status'

interface Heard {
  readonly facts: ProviderBlockFacts
  readonly order: number
}

export interface ProviderBlockStore {
  get(conversation: string): ProviderBlockFacts | null
  snapshot(): ReadonlyMap<string, ProviderBlockFacts>
  beginRead(): number
  accept(conversation: string, facts: ProviderBlockFacts, readAt?: number): void
  acceptMany(rows: readonly ({ readonly conversation: string } & ProviderBlockFacts)[]): void
  acceptListed(
    rows: readonly ({ readonly sessionId: string } & ProviderBlockFacts)[],
    readAt: number,
  ): void
  acceptSession(session: CreatedSession, readAt: number): void
  dispose(): void
}

/** One window's facts, independent of whether it is holding a live or recorded conversation. */
export function createProviderBlockStore(): ProviderBlockStore {
  const heard = shallowRef<ReadonlyMap<string, Heard>>(new Map())
  const facts = computed(() => new Map([...heard.value].map(([id, one]) => [id, one.facts])))
  let order = 0
  let disposed = false
  const beginRead = () => ++order
  function fold(
    rows: readonly ({ readonly conversation: string } & ProviderBlockFacts)[],
    at: number,
  ) {
    if (disposed) return
    const next = new Map(heard.value)
    let changed = false
    for (const row of rows) {
      if (
        row.providerBlock === undefined &&
        row.providerBlockStatus === undefined &&
        row.providerBlockLastKnown === undefined
      )
        continue
      const old = next.get(row.conversation)
      // A read that was already in flight cannot replace a later push or later requested read.
      if (old && old.order > at) continue
      next.set(row.conversation, { facts: mergeProviderBlock(old?.facts, row), order: at })
      changed = true
    }
    if (changed) heard.value = next
  }
  return {
    get: (id) => facts.value.get(id) ?? null,
    snapshot: () => facts.value,
    beginRead,
    accept: (conversation, update, readAt) =>
      fold([{ conversation, ...update }], readAt ?? beginRead()),
    acceptMany: (rows) => fold(rows, beginRead()),
    acceptListed: (rows, readAt) =>
      fold(
        rows.map((row) => ({ ...row, conversation: row.sessionId })),
        readAt,
      ),
    acceptSession: (session, readAt) =>
      fold(
        [{ conversation: session.sessionId, ...mergeProviderBlock(session, session.liveness) }],
        readAt,
      ),
    dispose: () => {
      disposed = true
      heard.value = new Map()
    },
  }
}

/** The root routes this channel to the shared facts before its ordinary rail/file readers. */
export function listenProviderStates(
  bridge: Pick<RuntimeBridge, 'onStates'>,
  store: { hearProviderStates(message: RuntimeStatesMessage): void },
  receive: (message: RuntimeStatesMessage) => void,
): () => void {
  return bridge.onStates((message) => {
    store.hearProviderStates(message)
    receive(message)
  })
}
