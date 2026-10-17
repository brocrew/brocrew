import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * ⛔ **How long until the displayed minute stops being true** (211 §5, from 210 finding 6).
 *
 * Pure, and exported on its own, because it is the whole of the design: a clock that shows hours and
 * minutes only has to move when the minute rolls over, so the tick is scheduled to the BOUNDARY
 * rather than run on a short interval and hoped to be close enough. One re-render per minute, and
 * the number on screen is never wrong — a 10-second interval would be six times the work for a value
 * that can still be nine seconds stale.
 *
 * ⚠️ **A boundary exactly now is a whole minute away, not zero.** Returning 0 would schedule a
 * timeout that fires immediately, re-reads the same minute, and schedules another — a spin. Every
 * zone this app can run in is a whole number of minutes from UTC, so epoch minutes and displayed
 * minutes roll over together.
 */
export const MINUTE_MS = 60_000

export function msUntilNextMinute(now: number): number {
  const past = ((now % MINUTE_MS) + MINUTE_MS) % MINUTE_MS
  return MINUTE_MS - past
}

/**
 * ⛔ **A clock that is true for as long as it is on screen** (211 §5).
 *
 * 210 opened Home at `00:43`, left it alone, and at `00:46` it still read `00:43`; navigating away
 * and back "fixed" it, which is the tell — the value was sampled when the surface mounted and never
 * again. ⚑ **The smallest of the five things the app said that were not so, and the one that teaches
 * a user not to trust the bigger ones**: a clock is the one number on a screen everybody can check.
 *
 * ⚠️ **`setTimeout` re-armed each tick, not `setInterval`.** An interval drifts against the wall
 * clock — a machine that sleeps for an hour resumes with the same phase it had — and this has to
 * land ON the rollover, so each tick asks {@link msUntilNextMinute} again from the time it actually
 * woke up. That is also what makes a wake-from-sleep correct itself immediately.
 *
 * ⛔ **It stops when the surface using it goes away**, through `onScopeDispose` rather than
 * `onUnmounted`, so it is equally safe inside a `computed`-free helper or an `effectScope` — and a
 * timer left running past its component is the cost `099` spent a dispatch removing from the rail.
 */
export function useMinuteClock(now: () => number = Date.now): Ref<number> {
  const clock = ref(now())
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    timer = setTimeout(() => {
      clock.value = now()
      arm()
    }, msUntilNextMinute(now()))
    // ⚠️ A no-op in the renderer, where `setTimeout` returns a number — and load-bearing under
    // `renderToString`, which runs `setup` in Node and never unmounts anything. Without it every
    // server-rendered surface leaves a live handle behind and the test process has a reason to stay
    // alive that has nothing to do with the test.
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  arm()

  onScopeDispose(() => clearTimeout(timer))
  return clock
}
