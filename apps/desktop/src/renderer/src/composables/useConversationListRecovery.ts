import { onBeforeUnmount, watch } from 'vue'
import { appClosing } from '../lib/app-closing'

/** One list read at a time, with one follow-up after a change or a failed read. */
export function useConversationListRecovery(workspace: () => string | null, reset: () => void) {
  let generation = 0
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
    finish: (read: number, retry: boolean, refresh: () => void): void => {
      if (!current(read)) return
      reading = false
      if (!retry && !again) return
      again = false
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        if (current(read)) refresh()
      }, 1_000)
    },
  }
}
