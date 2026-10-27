/** One wake-up for a retained copy, without keeping the app alive. */
export function armRecoveryExpiry(
  expiresAt: string,
  expire: () => void,
): ReturnType<typeof setTimeout> | undefined {
  const delay = Date.parse(expiresAt) - Date.now()
  // Startup already attempted an expired copy. If safety kept it, retry on the next launch;
  // never hash a multi-gigabyte protected copy again every minute while this app stays open.
  if (!Number.isFinite(delay) || delay <= 0) return undefined
  const timer = setTimeout(expire, delay)
  timer.unref()
  return timer
}
