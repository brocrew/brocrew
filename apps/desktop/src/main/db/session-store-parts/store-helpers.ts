import { NOT_STARTED_BECAUSE, type NotStartedBecause } from '@brobot2/runtime'
import type { ScheduledRow, ScheduleLevel } from '../../../shared/agent-state-contracts'
import type { LedgerWalk, LedgerWalkKind } from '../../../shared/question-contracts'
import type { PieceRow } from '../../../shared/task-contracts'
import type { ForestParent } from '../../../shared/the-whole-forest'
import type { ChildDescent } from '../../adopt/discover-sessions'
import { FOLD_EVENT_TYPES } from '../fold-index'
import { type RowsUnread, rowsUnreadOnce, type SkipNote, THE_WHOLE_LEDGER } from '../rows-unread'
import type { RecordedSession } from '../session-catalogue-read'
import type { SessionStore } from './session-store-contract'

export const ROUTED_REQUEST_EVENT_TYPES = [
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'work_taken_back',
  'work_closed',
  'work_replied',
  'request_escalated',
  'question_withdrawn',
  'question_ended_with_its_piece',
  'question_recipient_ended',
  'question_asked',
  'launched',
  'status',
] as const

function noSuchConversation<Row>(): LedgerWalk<Row> {
  return { rows: [], walk: 'no-such-conversation', ledgers: 0, rowsUnread: 0 }
}

export function underWhat(parent: string | null, drawn: ReadonlySet<string>): ForestParent {
  if (parent === null) return { is: 'the-person' }
  return drawn.has(parent)
    ? { is: 'a-conversation', conversation: parent }
    : { is: 'a-conversation-this-reading-did-not-draw', conversation: parent }
}

export function skipTheLedger(
  sessionId: string,
  error: unknown,
  noteSkip: SkipNote | undefined,
): void {
  console.warn(
    `session ledger: ${sessionId} could not be read and was skipped ` +
      `(${error instanceof Error ? error.message : String(error)})`,
  )
  noteSkip?.(THE_WHOLE_LEDGER, error instanceof Error ? error.message : String(error))
}

export function readOrSkip<T>(
  sessionId: string,
  noteSkip: SkipNote | undefined,
  nothing: T,
  fold: () => T,
): T {
  if (noteSkip === undefined) return fold()
  try {
    return fold()
  } catch (error) {
    skipTheLedger(sessionId, error, noteSkip)
    return nothing
  }
}

export function eachOrSkipped<K extends string, Row extends Readonly<Record<K, string>>, Built>(
  rows: readonly Row[],
  key: K,
  unread: RowsUnread,
  build: (row: Row) => Built,
): Built[] {
  return rows.flatMap((row) => readOrSkip(row[key], unread.in(row[key]), [], () => [build(row)]))
}

export function ledgersSkippedOf(count: number | undefined): { readonly ledgersSkipped?: number } {
  return count !== undefined && count > 0 ? { ledgersSkipped: count } : {}
}

function walkLedgers<Row, Candidate extends { id: string }>(
  walk: LedgerWalkKind,
  candidates: readonly Candidate[],
  foldOne: (sessionId: string, noteSkip: SkipNote, candidate: Candidate) => readonly Row[],
  unread: RowsUnread = rowsUnreadOnce(),
): LedgerWalk<Row> {
  const rows = candidates.flatMap((candidate) => {
    const noteSkip = unread.in(candidate.id)
    return [
      ...readOrSkip(candidate.id, noteSkip, [], () => foldOne(candidate.id, noteSkip, candidate)),
    ]
  })
  return {
    rows,
    walk,
    ledgers: candidates.length,
    rowsUnread: unread.count,
    ...ledgersSkippedOf(unread.ledgersSkipped),
  }
}

function stalledInOrder(found: LedgerWalk<PieceRow>): LedgerWalk<PieceRow> {
  const when = (piece: PieceRow): number => piece.stalledAt ?? Number.MAX_SAFE_INTEGER
  return {
    walk: found.walk,
    ledgers: found.ledgers,
    rowsUnread: found.rowsUnread,
    ...ledgersSkippedOf(found.ledgersSkipped),
    rows: [...found.rows].sort(
      (left, right) => when(left) - when(right) || (left.piece < right.piece ? -1 : 1),
    ),
  }
}

function parseStrings(stored: string | null): readonly string[] {
  if (stored === null) return []
  try {
    const raw: unknown = JSON.parse(stored)
    return Array.isArray(raw)
      ? raw.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
      : []
  } catch {
    return []
  }
}

function theFoldIndexHolds(statement: { readonly source: string }): void {
  const sql = statement.source
  const lists = [...sql.matchAll(/(?<![.\w])type\s+in\s*\(([^)]*)\)/gi)].map((one) => one[1] ?? '')
  const named = [
    ...lists.flatMap((list) => [...list.matchAll(/'([^']*)'/g)].map((one) => one[1] ?? '')),
    ...[...sql.matchAll(/(?<![.\w])type\s*=\s*'([^']*)'/gi)].map((one) => one[1] ?? ''),
  ]
  const unreadable =
    /(?<![.\w])type\s+(?:not\s+in|like|glob)\b|(?<![.\w])type\s*(?:<>|!=|=\s*[?@:$])/i.test(sql) ||
    lists.some((list) => /[?@:$]/.test(list))
  const missing = named.filter((type) => !FOLD_EVENT_TYPES.includes(type))
  if (unreadable || missing.length > 0) {
    throw new Error(
      unreadable
        ? 'a read through events_fold_idx compares the event type in a way that cannot be checked ' +
            'against the types the index holds: name its types as literals'
        : `a read through events_fold_idx names ${missing.join(', ')}, which the index does not hold: ` +
            'add it to FOLD_EVENT_TYPES in db/fold-index.ts and generate the migration that ' +
            'recreates the index',
    )
  }
}

// The ordinal evidence follows the folded array when a worker keeps it across snapshots.
const pieceStallOrdinals = new WeakMap<readonly PieceRow[], ReadonlyMap<string, number>>()

export function mergeDescent(
  stored: ChildDescent | null,
  live: ChildDescent | undefined,
): ChildDescent | null {
  if (!live) return stored
  const answered = Object.fromEntries(
    Object.entries(live).filter(([, value]) => value !== undefined),
  ) as ChildDescent
  return stored === null ? answered : { ...stored, ...answered }
}

function scheduleLevelFromRow(row: {
  session_id: string
  payload: string
  first_listed: string | null
  compacted_at: number | null
}): ReturnType<SessionStore['newestScheduleLevels']>[number] | null {
  try {
    const said = notStartedSaidIn(row.payload)
    return {
      conversation: row.session_id,
      level: scheduleLevelOf(row.payload, row.first_listed),
      compactedAt: row.compacted_at,
      ...(Object.keys(said).length === 0 ? {} : { notStartedSaid: said }),
    }
  } catch (error) {
    console.warn(
      `session store skipped an unreadable schedule in ${row.session_id}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** What a stored level says this app does not start its conversation for, by job; a word it does not know is passed over. */
function notStartedSaidIn(payload: string): Record<string, NotStartedBecause> {
  const level = JSON.parse(payload) as { jobs?: unknown }
  const said: Record<string, NotStartedBecause> = {}
  if (!Array.isArray(level.jobs)) return said
  for (const job of level.jobs as unknown[]) {
    if (typeof job !== 'object' || job === null) continue
    const { id, notStarted } = job as { id?: unknown; notStarted?: unknown }
    const known = NOT_STARTED_BECAUSE.find((word) => word === notStarted)
    if (typeof id === 'string' && known !== undefined) said[id] = known
  }
  return said
}

function scheduleLevelOf(payload: string, firstListed: string | null): ScheduleLevel {
  const level = JSON.parse(payload) as { jobs?: unknown; dropped?: unknown }
  const listed = (firstListed === null ? {} : JSON.parse(firstListed)) as Record<string, unknown>
  if (!Array.isArray(level.jobs)) throw new Error('its level lists no jobs')
  const jobs: ScheduledRow[] = []
  let unread = 0
  for (const job of level.jobs as unknown[]) {
    const row = job as { id?: unknown; schedule?: unknown; recurring?: unknown; prompt?: unknown }
    if (
      typeof job !== 'object' ||
      job === null ||
      typeof row.id !== 'string' ||
      (row.schedule !== undefined && typeof row.schedule !== 'string') ||
      (row.recurring !== undefined && typeof row.recurring !== 'boolean') ||
      (row.prompt !== undefined && typeof row.prompt !== 'string')
    ) {
      unread += 1
      continue
    }
    const since = listed[row.id]
    jobs.push({
      id: row.id,
      ...(row.schedule === undefined ? {} : { schedule: row.schedule }),
      ...(row.recurring === undefined ? {} : { recurring: row.recurring }),
      ...(row.prompt === undefined ? {} : { prompt: row.prompt }),
      ...(typeof since === 'number' ? { listedSince: since } : {}),
    })
  }
  const dropped = typeof level.dropped === 'number' ? level.dropped : 0
  return { jobs, dropped: dropped + unread }
}

export function aRowADeliveryCanStart(row: RecordedSession): boolean {
  return (
    !row.foundInUserHome && !row.restoredFromBundle && row.child === null && row.adoptedAt === null
  )
}

export {
  noSuchConversation,
  walkLedgers,
  stalledInOrder,
  parseStrings,
  theFoldIndexHolds,
  pieceStallOrdinals,
  scheduleLevelFromRow,
}
