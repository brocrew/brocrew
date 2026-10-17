/**
 * Logs when the window's page stops answering and when it answers again.
 *
 * Chromium says so only after an input event has waited on the page for about 16 seconds while the
 * window is in sight (its hang monitor's 15 s, then a 1 s ping), so a shorter freeze of the page
 * never reaches this. A spinning wheel is the main process's, never the page's: the page owns no
 * window. The page's own recorder reports its shorter freezes.
 */
export function logWhenThePageStopsAnswering(
  window: {
    on(event: 'unresponsive' | 'responsive', listener: () => void): unknown
  },
  log: (line: string) => void,
  now: () => number = Date.now,
): void {
  let since: number | null = null
  window.on('unresponsive', () => {
    if (since !== null) return
    since = now()
    log('the window’s page stopped answering')
  })
  window.on('responsive', () => {
    if (since === null) return
    log(`the window’s page answers again after ${String(now() - since)} ms`)
    since = null
  })
}
