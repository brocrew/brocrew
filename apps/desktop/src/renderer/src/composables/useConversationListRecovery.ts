import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { AgentState as OneState } from '../../../shared/agent-state-contracts'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type {
  ResumableSessionInfo,
  RuntimeStatesMessage,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import { epochDecision } from '../../../shared/data-version'
import type { PublishedListing } from '../../../shared/listing-published'
import { createProviderBlockStore, type ProviderBlockStore } from '../lib/provider-limit-facts'
import { readableError } from '../lib/session-record'
import { appClosing } from '../lib/app-closing'

/** One list read at a time, with one follow-up after a change or a failed read. */
export function useConversationListRecovery(workspace: () => string | null, reset: () => void) {
  let generation = 0
  let failedSince: number | undefined
  let disposed = false
  let reading = false
  let again = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const current = (read: number) => !disposed && !appClosing.value && read === generation
  const invalidate = () => {
    cancel()
    generation++
    failedSince = undefined
    reading = false
    again = false
  }
  watch(
    workspace,
    () => {
      invalidate()
      reset()
    },
    { flush: 'sync' },
  )
  watch(
    appClosing,
    (closing) => {
      if (closing) invalidate()
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    disposed = true
    invalidate()
  })
  return {
    begin: (): number | undefined => {
      if (!current(generation)) return undefined
      if (reading) {
        again = true
        return undefined
      }
      cancel()
      reading = true
      again = false
      return generation
    },
    current,
    succeeded: () => {
      failedSince = undefined
    },
    failed: () => {
      failedSince ??= Date.now()
      return Date.now() - failedSince >= 2_000
    },
    finish: (read: number, retry: boolean, refresh: () => void): void => {
      if (!current(read)) return
      reading = false
      if (!retry && !again) return
      again = false
      cancel()
      const quietRemaining = failedSince === undefined ? 0 : 2_000 - (Date.now() - failedSince)
      timer = setTimeout(
        () => {
          timer = undefined
          if (current(read)) refresh()
        },
        quietRemaining > 0 ? Math.min(1_000, quietRemaining) : 1_000,
      )
    },
  }
}

/** Listing membership and pushed state share the same read and recovery lifetime. */
export function useRecoveredConversationList(
  workspace: () => string | null,
  sessions: () => ClientSessionApi | undefined,
  sharedProviderBlocks: () => ProviderBlockStore | undefined,
) {
  const hostResumable = ref<ResumableSessionInfo[]>([])
  const hostUnresumable = ref<UnresumableSessionInfo[]>([])
  /** Whether the list has ever looked. Until it has, it has no count to give — not a count of 0. */
  const looked = ref(false)
  const listError = ref<string | null>(null)

  /**
   * A pushed state outlives any list read already in flight when the push arrived.
   * A later read replaces it; the paired lists may otherwise contain an older state.
   */
  const said = shallowRef<
    ReadonlyMap<
      string,
      {
        readonly state: OneState
        readonly after: number
        readonly published?: RuntimeStatesMessage['published']
      }
    >
  >(new Map())
  const localProviderBlocks = createProviderBlockStore()
  const providerBlocks = computed(() => sharedProviderBlocks() ?? localProviderBlocks)
  /**
   * ⚑ How many list reads this rail has begun — the number {@link said} dates each push by. ⚠️ A
   * read the quit stops is counted too, which moves nothing: main pushes nothing once a quit begins.
   */
  let readsAsked = 0
  let lastShown: Pick<PublishedListing, 'published' | 'readAsOf'> | undefined

  /**
   * ⚑ **D-019 · main said what some agents are doing now** — the screen hands every message on
   * `runtime:states` here. ⚠️ A conversation the list does not name yet is kept too, because the read
   * already in flight may name it; a read asked after it names it in its own answer.
   *
   * ⚑ **D-026 · a message that moved no state leaves the list as it was** — files kept, alone: the
   * rail draws no files, and a copy of what it heard would redraw every row for nothing.
   */
  function hearStates(message: RuntimeStatesMessage): void {
    if (message.moved.length === 0) return
    const next = new Map(said.value)
    for (const moved of message.moved) {
      if (lastShown !== undefined && message.published !== undefined) {
        const epoch = epochDecision(lastShown.published.epoch, message.published.epoch)
        if (epoch === 'drop') continue
        if (
          epoch === 'accept' &&
          (lastShown.published.covers.complete ||
            lastShown.published.covers.ids.includes(moved.conversation)) &&
          message.published.seq < lastShown.published.seq
        )
          continue
      }
      const previous = next.get(moved.conversation)?.published
      if (
        previous !== undefined &&
        message.published !== undefined &&
        (epochDecision(previous.epoch, message.published.epoch) === 'drop' ||
          (epochDecision(previous.epoch, message.published.epoch) === 'accept' &&
            message.published.seq <= previous.seq))
      )
        continue
      next.set(moved.conversation, {
        state: moved.state,
        after: readsAsked,
        published: message.published,
      })
    }
    said.value = next
    if (!sharedProviderBlocks()) localProviderBlocks.acceptMany(message.moved)
  }

  const listRecovery = useConversationListRecovery(workspace, () => {
    hostResumable.value = []
    hostUnresumable.value = []
    lastShown = undefined
    said.value = new Map()
    looked.value = false
    listError.value = null
    void refreshListed()
  })

  let firstPaintReported = false

  async function refreshListed(): Promise<void> {
    const cycle = listRecovery.begin()
    if (cycle === undefined) return
    let retry = false
    const asked = ++readsAsked
    const providerReadAt = providerBlocks.value.beginRead()
    try {
      const sessionsApi = sessions()
      let answer: PublishedListing | undefined
      let resumable: readonly ResumableSessionInfo[]
      let unresumable: readonly UnresumableSessionInfo[]
      if (typeof sessionsApi?.listConversations === 'function') {
        const result = await sessionsApi.listConversations()
        if (!listRecovery.current(cycle)) return
        if ('refused' in result) throw new Error(result.refused)
        answer = result
        retry = result.refresh === true
        if (lastShown !== undefined) {
          const epoch = epochDecision(lastShown.published.epoch, result.published.epoch)
          if (epoch === 'drop' || epoch === 'hold') return
          if (
            epoch === 'accept' &&
            (result.published.seq < lastShown.published.seq ||
              (result.published.seq === lastShown.published.seq &&
                (result.readAsOf ?? 0) <= (lastShown.readAsOf ?? 0)))
          )
            return
        }
        resumable = result.resumable
        unresumable = result.unresumable
        if (!result.published.covers.complete) {
          const included = new Set([...resumable, ...unresumable].map((row) => row.sessionId))
          resumable = [
            ...resumable,
            ...hostResumable.value.filter((row) => !included.has(row.sessionId)),
          ]
          unresumable = [
            ...unresumable,
            ...hostUnresumable.value.filter((row) => !included.has(row.sessionId)),
          ]
        }
        lastShown = { published: result.published, readAsOf: result.readAsOf }
      } else {
        if (!sessionsApi?.listResumable || !sessionsApi.listUnresumable)
          throw new Error('The client does not provide session reads and intents')
        ;[resumable, unresumable] = await Promise.all([
          sessionsApi.listResumable(),
          sessionsApi.listUnresumable(),
        ])
      }
      if (!listRecovery.current(cycle)) return
      providerBlocks.value.acceptListed(
        answer === undefined
          ? [...resumable, ...unresumable]
          : [...answer.resumable, ...answer.unresumable],
        providerReadAt,
      )
      hostResumable.value = [...resumable]
      hostUnresumable.value = [...unresumable]
      // A dispatch floor cannot replace states pushed after that floor, even before this caller joined.
      said.value = new Map(
        [...said.value].filter(([id, heard]) => {
          if (answer === undefined || heard.published === undefined) return heard.after >= asked
          if (!answer.published.covers.complete && !answer.published.covers.ids.includes(id))
            return true
          const epoch = epochDecision(answer.published.epoch, heard.published.epoch)
          return (
            epoch === 'advance' ||
            (epoch === 'accept' && heard.published.seq >= answer.published.seq)
          )
        }),
      )
      looked.value = true
      listRecovery.succeeded()
      listError.value = null
      if (!firstPaintReported && sessionsApi?.firstListPainted !== undefined) {
        await nextTick()
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        if (!listRecovery.current(cycle)) return
        await sessionsApi.firstListPainted()
        firstPaintReported = true
      }
    } catch (cause) {
      if (!listRecovery.current(cycle)) return
      if (listRecovery.failed()) listError.value = readableError(cause)
      retry = true
    } finally {
      listRecovery.finish(cycle, retry, () => {
        void refreshListed()
      })
    }
  }

  return {
    hostResumable,
    hostUnresumable,
    looked,
    listError,
    said,
    providerBlocks,
    hearStates,
    refreshListed,
  }
}
