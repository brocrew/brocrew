import { onBeforeUnmount, ref, watch } from 'vue'
import type { ConversationTaskPageResult } from '../../../shared/conversation-task-page'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
import { readableError } from '../lib/session-record'

export interface TaskPageSource {
  readonly read: RuntimeBridge['readConversationTasks']
  readonly readAll?: RuntimeBridge['readAllConversationTasks']
  readonly revision: number
}

export function useConversationTaskPage(
  source: () => TaskPageSource | undefined,
  selected: () => string | undefined,
) {
  const page = ref<Extract<ConversationTaskPageResult, { ok: true }> | null>(null)
  const pending = ref(false)
  const error = ref<string | null>(null)
  let reading = 0

  async function read(cursor?: string): Promise<void> {
    const sessionId = selected()
    const reader = source()?.read
    if (!sessionId || !reader) return
    const mine = ++reading
    pending.value = true
    error.value = null
    try {
      const result = await reader(cursor ? { sessionId, cursor } : { sessionId })
      if (mine !== reading) return
      if (!result.ok && result.reason === 'invalid-cursor' && cursor) {
        page.value = null
        await read()
        return
      }
      if (!result.ok) {
        error.value = 'Could not read this conversation’s tasks.'
        return
      }
      if (result.conversation !== sessionId) return
      const previous = cursor ? page.value : null
      page.value = previous ? { ...result, other: [...previous.other, ...result.other] } : result
    } catch (cause) {
      if (mine === reading) error.value = readableError(cause)
    } finally {
      if (mine === reading) pending.value = false
    }
  }

  watch(
    [selected, () => source()?.revision],
    ([sessionId], previous) => {
      reading += 1
      if (sessionId !== previous?.[0] || !source()) page.value = null
      error.value = null
      pending.value = false
      void read()
    },
    { immediate: true, flush: 'sync' },
  )
  onBeforeUnmount(() => {
    reading += 1
  })

  return {
    page,
    pending,
    error,
    showMore: () => {
      if (!pending.value && page.value?.next) void read(page.value.next)
    },
  }
}
