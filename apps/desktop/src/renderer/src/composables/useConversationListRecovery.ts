import { onBeforeUnmount, watch } from 'vue'
import { appClosing } from '../lib/app-closing'

/** Retry a failed conversation read twice, one second apart, before reporting it. */
export function useConversationListRecovery(workspace: () => string | null, reset: () => void) {
  let generation = 0
  let failures = 0
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
      failures = 0
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
      failures = 0
    },
    retry: (read: number): Promise<boolean> => {
      if (!current(read) || ++failures >= 3) return Promise.resolve(false)
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
