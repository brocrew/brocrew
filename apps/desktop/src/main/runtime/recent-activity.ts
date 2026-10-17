import { agentName } from '../../shared/runtime-ipc'
import { pathTail } from '../../shared/path-tail'
import {
  RECENT_ACTIVITY_LINES,
  type ActivityLine,
  type RecentActivityReading,
} from '../../shared/recent-activity'
import { ledgersSkippedOf, type DigestRow, type SessionStore } from '../db/session-store'

/** All rows and names belong to the worker's single read-only snapshot. */
export function recentActivity(
  store: SessionStore,
  from: number,
  to: number,
): RecentActivityReading {
  const read = store.activityWindow(from, to)
  const roster = store.agentIdentities()
  const names = new Map<string, string>()
  let rowsUnread = read.rowsUnread
  const candidates: {
    row: DigestRow
    piece: string
    what: ActivityLine['what']
    register: ActivityLine['register']
  }[] = []
  const skipped = new Set<string>()
  const lines: ActivityLine[] = []
  for (const row of read.rows) {
    const event = row.event
    let what: ActivityLine['what']
    let register: ActivityLine['register'] = 'observed'
    switch (event.type) {
      case 'work_given':
        what = 'started'
        break
      case 'work_replied':
        if (event.outcome === 'blocked') continue
        if (event.outcome !== 'done' && event.outcome !== 'failed') {
          rowsUnread++
          continue
        }
        what = event.outcome === 'done' ? 'finished' : 'failed'
        register = 'claimed'
        break
      case 'work_taken_back':
      case 'work_closed':
        what = 'stopped'
        break
      default:
        continue
    }
    candidates.push({ row, piece: event.piece, what, register })
  }
  candidates.sort(
    (a, b) =>
      b.row.at - a.row.at ||
      (a.row.sessionId < b.row.sessionId
        ? -1
        : a.row.sessionId > b.row.sessionId
          ? 1
          : b.row.ordinal - a.row.ordinal),
  )
  const selected = candidates.slice(0, RECENT_ACTIVITY_LINES)
  const pieces = store.activityWorkNames(selected.map(({ piece }) => piece))
  for (const { row, piece: pieceId, what, register } of selected) {
    try {
      const piece = pieces.get(pieceId)
      if (piece == null) throw new Error('the activity piece could not be named')
      let name = names.get(row.sessionId)
      if (name === undefined) {
        const profile = store.identityOf(row.sessionId)?.profileSlug ?? null
        name =
          profile === null
            ? pathTail(store.recordedOne(row.sessionId)?.cwd ?? '') || row.sessionId
            : agentName(profile, roster)
        names.set(row.sessionId, name)
      }
      lines.push({
        id: `${row.sessionId}:${String(row.ordinal)}`,
        at: row.at,
        what,
        register,
        piece: { id: pieceId, ...piece },
        agent: name,
        conversation: row.sessionId,
      })
    } catch {
      // A ledger whose pieces cannot be named is incomplete, never an empty success.
      skipped.add(row.sessionId)
    }
  }
  const complete = lines.filter(
    (line) => line.conversation === null || !skipped.has(line.conversation),
  )
  complete.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    window: { from, to },
    read: {
      walk: read.walk,
      ledgers: read.ledgers,
      rowsUnread,
      ...ledgersSkippedOf((read.ledgersSkipped ?? 0) + skipped.size),
    },
    lines: complete,
    capped: candidates.length > RECENT_ACTIVITY_LINES,
  }
}
