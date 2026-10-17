import { onScopeDispose, ref, watch, type Ref } from 'vue'

const MINUTE_MS = 60_000

/** "Still thinking (N min).": whole minutes of silence after the model's reasoning, at least one. */
export function stillThinkingSays(thinkingForMs: number): string {
  return `Still thinking (${String(Math.max(1, Math.floor(thinkingForMs / MINUTE_MS)))} min).`
}

/**
 * The line while the model thinks in silence, or `null`. Counted from `since`, the moment the
 * silence began, and moved when each whole minute since then is reached; nothing ticks while
 * `since` is `null`.
 */
export function useStillThinking(
  since: () => number | null,
  now: () => number = Date.now,
): Ref<string | null> {
  const said = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => clearTimeout(timer)
  const say = (from: number): void => {
    const thinkingFor = Math.max(0, now() - from)
    said.value = stillThinkingSays(thinkingFor)
    timer = setTimeout(() => say(from), MINUTE_MS - (thinkingFor % MINUTE_MS))
    // Under `renderToString` nothing unmounts, so the timer must not hold the process open.
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  watch(
    since,
    (from) => {
      stop()
      if (from === null) said.value = null
      else say(from)
    },
    { immediate: true },
  )
  onScopeDispose(stop)
  return said
}
