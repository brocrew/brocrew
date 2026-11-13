import { onBeforeUnmount, watch } from 'vue'
import { appClosing } from '../lib/app-closing'

/** Allow two seconds for conversation reads to recover, retrying one second apart. */
export function useConversationListRecovery(workspace: () => string | null, reset: () => void) {
  let generation = 0
  let failedSince: number | undefined
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let finishWait: ((retry: boolean) => void) | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    finishWait?.(false)
    finishWait = undefined
  }
  const current = (read: number) => !disposed && !appClosing.value && read === generation
  const begin = () => {
    cancel()
    return ++generation
  }
  watch(
    workspace,
    () => {
      begin()
      failedSince = undefined
      reset()
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    disposed = true
    begin()
  })
  return {
    begin,
    current,
    succeeded: () => {
      failedSince = undefined
    },
    retry: (read: number): Promise<boolean> => {
      if (!current(read)) return Promise.resolve(false)
      failedSince ??= Date.now()
      if (Date.now() - failedSince >= 2_000) return Promise.resolve(false)
      return new Promise((resolve) => {
        finishWait = resolve
        timer = setTimeout(() => {
          timer = undefined
          finishWait = undefined
          resolve(current(read))
        }, 1_000)
      })
    },
  }
}
