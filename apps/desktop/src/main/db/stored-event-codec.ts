import type { EventRow, PersistedEvent } from './ledger-row-types'
import type { SkipNote } from './rows-unread'
import { MAILBOX_KINDS } from '../../shared/conversation-events'
import type {
  MailboxKind,
  MemoryNoteSeen,
  TheQuestionItAsks,
  TranscriptEvent,
} from '../../shared/conversation-events'
import type {
  AnsweredQuestion,
  TurnAuthorship,
  UserTurnPart,
} from '../../shared/human-answer-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type { WorkReport } from '../../shared/task-contracts'
import { moveOriginOf } from '../../shared/move-request'
import {
  boundRaw,
  boundRecall,
  isMessageAct,
  storedQuestionsParsed,
  type MemoryRecallEntry,
} from '@brobot2/runtime'
import { storedRefusalTold } from '../../shared/refusals'
import {
  TURN_AUTHORSHIP_KEYS,
  MAX_TURN_PARTS,
  USER_TURN_PART_KEYS,
  MAX_HANDED_PATHS,
  isPathSegment,
  MEMORY_NOTES_PER_EVENT,
  MEMORY_NOTE_TEXT_CAP,
} from '../../shared/runtime-ipc'
import { REPLY_SUMMARY_LIMIT } from '../runtime/reply-rails'
import { isAWorkReport } from '../../shared/tasks'
import { pieceNumbersOf } from '../../shared/piece-called'
import { MAX_RESOURCES_PER_REPLY } from '../../shared/documents'

export function toPersistedEvents(
  rows: EventRow[],
  noteSkip?: (ordinal: number, cause?: string) => void,
): PersistedEvent[] {
  return rows.flatMap((row) => {
    try {
      return [
        {
          ordinal: row.ordinal,
          at: row.created_at,
          event: boundStoredEvent(JSON.parse(row.payload) as TranscriptEvent),
        },
      ]
    } catch (error) {
      console.warn(
        `session ledger: ordinal ${row.ordinal} could not be read and was skipped ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      )
      noteSkip?.(row.ordinal, error instanceof Error ? error.message : String(error))
      return []
    }
  })
}

export function* persistedEventsFrom(
  rows: Iterable<EventRow>,
  noteSkip?: SkipNote,
): IterableIterator<PersistedEvent> {
  for (const row of rows) yield* toPersistedEvents([row], noteSkip)
}

export function noteUnreadRow(
  sessionId: string,
  ordinal: number,
  noteSkip: ((ordinal: number, cause?: string) => void) | undefined,
  because = 'is not JSON',
): void {
  console.warn(
    `session ledger: ${sessionId} ordinal ${String(ordinal)} ${because} and was skipped by a guarded read`,
  )
  noteSkip?.(ordinal, because)
}

export function boundStoredEvent(event: TranscriptEvent): TranscriptEvent {
  return boundTheParts(boundOneRow(event))
}

function boundOneRow(event: TranscriptEvent): TranscriptEvent {
  return boundStoredPayloads(
    boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event))))),
  )
}

function answerStoredOn(value: unknown): AnsweredQuestion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const one = value as Record<string, unknown>
  if (
    !isAStoredId(one.requestId) ||
    !(one.answeredBy === null || isAStoredId(one.answeredBy)) ||
    typeof one.answer !== 'string' ||
    one.answer.length > REPLY_SUMMARY_LIMIT ||
    !(one.cannotAnswer === undefined || one.cannotAnswer === true) ||
    !(one.clipped === undefined || one.clipped === true)
  )
    return undefined
  return {
    requestId: one.requestId,
    answeredBy: one.answeredBy,
    answer: one.answer,
    ...(one.cannotAnswer === true ? { cannotAnswer: true } : {}),
    ...(one.clipped === true ? { clipped: true } : {}),
  }
}

function boundCardFacts(event: TranscriptEvent): TranscriptEvent {
  if (event.type === 'tool_result' && event.messageAct !== undefined) {
    const { messageAct, ...kept } = event
    return { ...kept, ...(isMessageAct(messageAct) ? { messageAct } : {}) }
  }
  if (event.type === 'message_sent') {
    const { messageAct, addressedAs, toLabel, ...kept } = event
    return {
      ...kept,
      ...(isMessageAct(messageAct) ? { messageAct } : {}),
      ...(isAStoredId(addressedAs) ? { addressedAs } : {}),
      ...(typeof toLabel === 'string' && toLabel.length > 0 && toLabel.length <= REPLY_SUMMARY_LIMIT
        ? { toLabel }
        : {}),
    }
  }
  if (event.type === 'tool_refused') {
    if (event.told === undefined) return event
    const { told: stored, ...kept } = event
    const told = storedRefusalTold(stored)
    return { ...kept, ...(told === undefined ? {} : { told }) }
  }
  if (
    event.type !== 'user_turn' &&
    event.type !== 'message_queued' &&
    event.type !== 'message_unqueued'
  )
    return event
  if (event.answeredQuestion === undefined) return event
  const { answeredQuestion: stored, ...kept } = event
  const answeredQuestion = answerStoredOn(stored)
  return { ...kept, ...(answeredQuestion === undefined ? {} : { answeredQuestion }) }
}

function boundTheParts(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' || event.parts === undefined) return event
  const stored: unknown = event.parts
  const parts = (Array.isArray(stored) ? (stored as unknown[]) : [])
    .slice(0, MAX_TURN_PARTS)
    .flatMap((one): UserTurnPart[] => {
      if (typeof one !== 'object' || one === null) return []
      const said = one as Record<string, unknown>
      if (typeof said.text !== 'string') return []
      const built: Record<string, unknown> = {}
      built.type = event.type
      for (const key of USER_TURN_PART_KEYS) if (said[key] !== undefined) built[key] = said[key]
      const bounded = boundOneRow(built as TranscriptEvent)
      if (bounded.type !== 'user_turn') return []
      const { type: _type, ...part } = bounded
      void _type
      return [part]
    })
  return { ...event, parts }
}

export function authorshipStoredOn(payload: string | null): TurnAuthorship {
  const stored = aStoredObject(payload)
  if (stored === null) return {}
  const carried: Record<string, unknown> = {}
  for (const key of TURN_AUTHORSHIP_KEYS) {
    const value = stored[key]
    if (key === 'movedFrom') {
      const origin = moveOriginOf(value)
      if (origin !== undefined) carried[key] = origin
    } else if (key === 'answeredQuestion') {
      const answer = answerStoredOn(value)
      if (answer !== undefined) carried[key] = answer
    } else if (value !== undefined) carried[key] = value
  }
  return carried as TurnAuthorship
}

export function attachmentsStoredOn(payload: string | null): { attachments?: HandedPath[] } {
  const attachments = aStoredObject(payload)?.attachments
  return attachments === undefined ? {} : { attachments: attachments as HandedPath[] }
}

export function isMailboxKind(kind: unknown): kind is MailboxKind {
  return typeof kind === 'string' && (MAILBOX_KINDS as readonly string[]).includes(kind)
}

export function theQuestionItAsks(stored: unknown): { readonly asks: TheQuestionItAsks } | null {
  if (typeof stored !== 'object' || stored === null) return null
  const { asker, requestId } = stored as Record<string, unknown>
  if (typeof asker !== 'string' || asker.length === 0) return null
  if (typeof requestId !== 'string' || requestId.length === 0) return null
  return { asks: { asker, requestId } }
}

export function aStoredObject(payload: string | null): Record<string, unknown> | null {
  if (payload === null) return null
  let stored: unknown
  try {
    stored = JSON.parse(payload)
  } catch {
    return null
  }
  return typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : null
}

function boundPieceNamed(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' && event.type !== 'message_sent') return event
  if (event.piece === undefined && event.label === undefined) return event
  const aPiece = isAStoredId(event.piece)
  const aLabel = aPiece && typeof event.label === 'string' && pieceNumbersOf(event.label) !== null
  if (aPiece && (event.label === undefined || aLabel)) return event
  const { piece: _piece, label: _label, ...rest } = event
  void _piece
  void _label
  return (aPiece ? { ...rest, piece: event.piece } : rest) as TranscriptEvent
}

function boundTheDrive(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' && event.type !== 'message_queued') return event
  if (event.drives === undefined || isAStoredId(event.drives)) return event
  const { drives: _drives, ...rest } = event
  void _drives
  return rest as TranscriptEvent
}

function boundRelayedIdentity(event: TranscriptEvent): TranscriptEvent {
  if (event.type === 'work_interrupted' || event.type === 'stop_unanswered') {
    if (event.agentProfile === undefined) return event
    const asker: unknown = event.agentProfile
    if (typeof asker === 'string' && isPathSegment(asker) && typeof event.agent === 'string') {
      return event
    }
    const { agentProfile: _unplaced, ...kept } = event
    void _unplaced
    return kept as TranscriptEvent
  }
  if (
    event.type === 'user_turn' ||
    event.type === 'message_queued' ||
    event.type === 'message_unqueued'
  ) {
    if (event.relayedFromProfile === undefined) return event
    const slug: unknown = event.relayedFromProfile
    if (typeof slug === 'string' && isPathSegment(slug)) return event
    const { relayedFromProfile: _stored, ...rest } = event
    void _stored
    return rest as TranscriptEvent
  }
  return event
}

function boundStoredPayloads(event: TranscriptEvent): TranscriptEvent {
  if (
    (event.type === 'work_given' || event.type === 'work_rebriefed') &&
    event.definitionOfDone !== undefined &&
    (typeof event.definitionOfDone !== 'string' ||
      event.definitionOfDone.length > 512 ||
      event.definitionOfDone.trim() === '')
  )
    throw new Error('unread done condition')
  if (
    event.type === 'work_rebriefed' &&
    event.brief === undefined &&
    event.definitionOfDone === undefined
  )
    throw new Error('empty work revision')
  if (event.type === 'user_input_request') {
    return { ...event, questions: [...storedQuestionsParsed(event.questions)] }
  }
  if (
    (event.type === 'user_turn' ||
      event.type === 'message_queued' ||
      event.type === 'message_unqueued') &&
    event.attachments !== undefined
  ) {
    const kept = boundHandedPaths(event.attachments)
    if (kept.length > 0) return { ...event, attachments: kept }
    const { attachments: _dropped, ...rest } = event
    void _dropped
    return rest as TranscriptEvent
  }
  if (event.type === 'memory_note') {
    const notes = boundMemoryNotes(event.notes)
    const cut = Math.max(0, boundedLength(event.notes) - notes.length)
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) + cut
    return { ...event, notes, ...(dropped > 0 ? { dropped } : {}) }
  }
  if (event.type === 'memory_loaded') {
    const usable =
      typeof event.index === 'string' &&
      event.index.length > 0 &&
      event.index.length <= MAX_STORED_PATH_CHARS
    const beside =
      typeof event.beside === 'number' && Number.isFinite(event.beside) && event.beside >= 0
        ? Math.floor(event.beside)
        : 0
    const lookedAt =
      typeof event.lookedAt === 'number' && Number.isFinite(event.lookedAt) && event.lookedAt > 0
        ? Math.floor(event.lookedAt)
        : undefined
    // CONSTRUCTED, never spread — the rule `boundMemoryNotes` records one function over.
    return {
      type: 'memory_loaded',
      index: usable ? event.index : '',
      beside,
      ...(lookedAt === undefined ? {} : { lookedAt }),
    }
  }
  if (event.type === 'memory_recall') {
    const claimed = Array.isArray(event.entries) ? event.entries.length : 0
    const sent = storedRecallEntries(event.entries)
    const bound = boundRecall(sent, storedThreadIds(event.threadIds))
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) +
      (claimed - sent.length) +
      bound.dropped
    const threadsDropped =
      (typeof event.threadsDropped === 'number' && event.threadsDropped > 0
        ? event.threadsDropped
        : 0) + bound.threadsDropped
    const {
      threadIds: _storedIds,
      dropped: _storedDropped,
      threadsDropped: _storedThreadsDropped,
      ...rest
    } = event
    void _storedIds
    void _storedDropped
    void _storedThreadsDropped
    return {
      ...rest,
      entries: bound.entries,
      ...(dropped > 0 ? { dropped } : {}),
      ...(bound.threadIds.length > 0 ? { threadIds: bound.threadIds } : {}),
      ...(threadsDropped > 0 ? { threadsDropped } : {}),
    }
  }
  if (event.type !== 'unknown') return event
  const bounded = boundRaw(event.raw, event.label)
  // Returned by identity when nothing was over the limit, so the common path allocates nothing.
  return bounded === event.raw ? event : { ...event, raw: bounded }
}

function boundHandedPaths(attachments: unknown): HandedPath[] {
  return (Array.isArray(attachments) ? attachments : [])
    .filter(
      (each): each is HandedPath =>
        typeof each?.path === 'string' &&
        each.path.length > 0 &&
        each.path.length <= MAX_STORED_PATH_CHARS &&
        (each.kind === 'file' || each.kind === 'directory'),
    )
    .slice(0, MAX_HANDED_PATHS)
    .map((each) => ({ path: each.path, kind: each.kind, outsideCwd: each.outsideCwd === true }))
}

function boundWorkReport(event: TranscriptEvent): TranscriptEvent {
  if (
    event.type !== 'user_turn' &&
    event.type !== 'message_queued' &&
    event.type !== 'message_unqueued'
  ) {
    return event
  }
  if (event.work === undefined) return event
  const kept = isAWorkReport(event.work) ? boundedWorkReport(event.work) : null
  const { work: _stored, ...rest } = event
  void _stored
  return (kept === null ? rest : { ...rest, work: kept }) as TranscriptEvent
}

export function isAStoredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STORED_ID_CHARS
}

function boundedWorkReport(report: WorkReport): WorkReport | null {
  if (
    !isAStoredId(report.piece) ||
    !isAStoredId(report.state) ||
    pieceNumbersOf(report.label) === null
  ) {
    return null
  }
  const resources = Array.isArray(report.resources)
    ? report.resources.filter(isAStoredId).slice(0, MAX_RESOURCES_PER_REPLY)
    : []
  return {
    piece: report.piece,
    label: report.label,
    ...(isAStoredId(report.owner) ? { owner: report.owner } : {}),
    state: report.state,
    ...(isAStoredId(report.outcome) ? { outcome: report.outcome } : {}),
    ...(resources.length > 0 ? { resources } : {}),
    ...(report.needsUserAction === true ? { needsUserAction: true as const } : {}),
    ...(isAStoredId(report.stalledBecause) ? { stalledBecause: report.stalledBecause } : {}),
  }
}

/** How many entries the stored row claimed, so what the bound removed can be counted rather than guessed. */
function boundedLength(notes: unknown): number {
  return Array.isArray(notes) ? notes.length : 0
}

function storedRecallEntries(entries: unknown): MemoryRecallEntry[] {
  return (Array.isArray(entries) ? entries : [])
    .filter(
      (each): each is Record<string, unknown> =>
        typeof each === 'object' && each !== null && typeof each['path'] === 'string',
    )
    .map((each) => {
      const start = each['lineStart']
      const end = each['lineEnd']
      const ranged =
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end >= start
      return {
        path: each['path'] as string,
        ...(ranged ? { lineStart: start as number, lineEnd: end as number } : {}),
        ...(typeof each['note'] === 'string' ? { note: each['note'] } : {}),
      }
    })
}

function storedThreadIds(ids: unknown): string[] {
  return (Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === 'string')
}

function boundMemoryNotes(notes: unknown): MemoryNoteSeen[] {
  return (Array.isArray(notes) ? notes : [])
    .filter(
      (each): each is MemoryNoteSeen =>
        typeof each?.path === 'string' &&
        each.path.length > 0 &&
        each.path.length <= MAX_STORED_PATH_CHARS,
    )
    .slice(0, MEMORY_NOTES_PER_EVENT)
    .map((each) => {
      const text = typeof each.text === 'string' ? each.text.slice(0, MEMORY_NOTE_TEXT_CAP) : null
      return {
        path: each.path,
        ...(typeof each.bytes === 'number' && Number.isFinite(each.bytes) && each.bytes >= 0
          ? { bytes: each.bytes }
          : {}),
        ...(typeof each.unread === 'string' && each.unread.length > 0 && each.unread.length <= 64
          ? { unread: each.unread }
          : {}),
        ...(text === null ? {} : { text }),
        ...(each.truncated === true ||
        (typeof each.text === 'string' && each.text.length > MEMORY_NOTE_TEXT_CAP)
          ? { truncated: true }
          : {}),
      }
    })
}

const MAX_STORED_PATH_CHARS = 4096

const MAX_STORED_ID_CHARS = 200
