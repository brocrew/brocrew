import { STATE_RULES } from './upgrade-path.mjs'

const RETENTION = 'transcript-retention.json'

/** Keep state bytes exact, except the retention file the new version sets to keep every transcript. */
export function rehearsalStateKept(name, before, after) {
  if (before == null && name === RETENTION && Buffer.isBuffer(after)) {
    try {
      return after.length <= 65536 && JSON.parse(after.toString('utf8')).period === 'forever'
    } catch {
      return false
    }
  }
  if (before == null || after == null) return before == null && after == null
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after)) return false
  if (before.equals(after)) return true
  if (name !== RETENTION) return false
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
