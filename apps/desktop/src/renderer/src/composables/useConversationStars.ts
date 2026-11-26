import { computed, inject, provide, shallowRef, type InjectionKey, type Ref } from 'vue'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { LibraryEntry } from '../../../shared/runtime-ipc'
import { oneReadAtATime } from '../lib/one-read-at-a-time'

type StarApi = Pick<ClientSessionApi, 'listStarredConversations' | 'setStarredConversation'>
export type StarTarget = string | LibraryEntry

interface ConversationStars {
  readonly entries: Readonly<Ref<readonly LibraryEntry[] | undefined>>
  refresh(): Promise<void>
  isStarred(conversation: StarTarget): boolean | undefined
  set(conversation: StarTarget, starred: boolean): Promise<void>
}

const starsKey: InjectionKey<ConversationStars> = Symbol('conversation stars')

export function provideConversationStars(
  api: StarApi | undefined,
  writeFailed: () => void,
): ConversationStars {
  const entries = shallowRef<readonly LibraryEntry[]>()
  const starredIds = computed(
    () =>
      new Set(
        entries.value?.flatMap((entry) =>
          entry.recordId === null ? [entry.id] : [entry.id, entry.recordId],
        ),
      ),
  )
  const refresh = oneReadAtATime(async () => {
    if (!api) return
    try {
      entries.value = await api.listStarredConversations()
    } catch {
      // Keep the last membership when a refresh fails.
    }
  })

  function isStarred(conversation: StarTarget): boolean | undefined {
    if (!entries.value) return undefined
    if (typeof conversation === 'string') return starredIds.value.has(conversation)
    return (
      starredIds.value.has(conversation.id) ||
      (conversation.recordId !== null && starredIds.value.has(conversation.recordId))
    )
  }

  async function set(conversation: StarTarget, starred: boolean): Promise<void> {
    if (!api) return
    const target =
      typeof conversation === 'string'
        ? { recordId: conversation }
        : conversation.recordId !== null
          ? { recordId: conversation.recordId }
          : conversation.providerSessionId !== null
            ? { provider: conversation.provider, providerSessionId: conversation.providerSessionId }
            : null
    if (target === null) return
    try {
      await api.setStarredConversation({ target, starred })
    } catch {
      writeFailed()
    }
  }

  const stars = { entries, refresh, isStarred, set }
  provide(starsKey, stars)
  return stars
}

export function useConversationStars() {
  return inject(starsKey, undefined)
}
