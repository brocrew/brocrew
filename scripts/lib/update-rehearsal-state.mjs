import { STATE_RULES } from './upgrade-path.mjs'

/** Keep state bytes exact, except for the cleanup progress allowed by the upgrade check. */
export function rehearsalStateKept(name, before, after) {
  if (before == null || after == null) return before == null && after == null
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after)) return false
  if (before.equals(after)) return true
  if (name !== 'transcript-retention.json') return false
  try {
    return (
      STATE_RULES[name](
        JSON.parse(before.toString('utf8')),
        JSON.parse(after.toString('utf8')),
        after.length,
      ).length === 0
    )
  } catch {
    return false
  }
}
