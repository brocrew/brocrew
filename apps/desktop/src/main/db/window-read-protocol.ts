import { z } from 'zod'
import { MAX_DIGEST_SPAN_MS } from '../../shared/digest'
import { RECENT_ACTIVITY_LINES, type RecentActivityReading } from '../../shared/recent-activity'
import type { SessionStore, SkipNote, ThreadLeadRow } from './session-store'

export const WINDOW_READ_BOUNDS = {
  sessions: 2_000,
  rows: 100_000,
  bytes: 32 * 1024 * 1024,
  replyBytes: 4 * 1024 * 1024,
  pending: 16,
  callers: 16,
  leadPageRows: 256,
} as const

export const windowReadQuery = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('routes') }).strict(),
  z.object({ kind: z.literal('incidents') }).strict(),
  z
    .object({
      kind: z.literal('activity'),
      from: z.number().int().nonnegative().safe(),
      to: z.number().int().nonnegative().safe(),
    })
    .strict()
    .refine(({ from, to }) => to > from && to - from <= MAX_DIGEST_SPAN_MS),
  z
    .object({
      kind: z.literal('files'),
      sessionId: z.string().min(1).max(512),
      givers: z.array(z.string().min(1).max(512)).max(WINDOW_READ_BOUNDS.sessions),
    })
    .strict(),
  z
    .object({
      kind: z.literal('leads'),
      sessionId: z.string().min(1).max(512),
      opening: z.string().min(1).max(4096),
      historicalOpening: z.string().min(1).max(4096),
      before: z.number().int().nonnegative().safe(),
    })
    .strict(),
])
export type WindowReadQuery = z.infer<typeof windowReadQuery>
export type SkippedRow = Parameters<SkipNote>[0]
export interface RoutingReading {
  readonly sessionId: string
  readonly requests: ReturnType<SessionStore['routedRequestsOf']>
  readonly skipped: readonly SkippedRow[]
}
export interface WindowRoutes {
  readonly kind: 'routes'
  readonly routes: readonly RoutingReading[]
  readonly questions: ReturnType<SessionStore['questionsAPersonMustAnswer']>
  readonly decisions: ReturnType<SessionStore['decisionsAwaitingAPerson']>
}
export interface WindowLeads {
  readonly kind: 'leads'
  readonly rows: readonly ThreadLeadRow[]
}
export interface WindowFiles {
  readonly kind: 'files'
  readonly tree: ReturnType<SessionStore['filesKept']>
  readonly added: ReturnType<SessionStore['filesKept']>
  readonly roster: ReturnType<SessionStore['agentIdentities']>
}
export interface WindowActivity extends RecentActivityReading {
  readonly kind: 'activity'
}
export interface IncidentReading {
  readonly sessionId: string
  readonly pieces: ReturnType<SessionStore['openPiecesOf']>
  readonly work: ReturnType<SessionStore['reconciliationWork']>
  readonly routes: ReturnType<SessionStore['routedRequestsOf']>
  readonly messages: ReturnType<SessionStore['messagesWaitingIn']>
  readonly stop: ReturnType<SessionStore['lastAskToStop']>
  readonly piecesSkipped: readonly SkippedRow[]
  readonly routesSkipped: readonly SkippedRow[]
  readonly messagesSkipped: readonly SkippedRow[]
  readonly stopSkipped: readonly SkippedRow[]
}
export interface WindowIncidents {
  readonly kind: 'incidents'
  readonly owners: readonly IncidentReading[]
}
export type WindowReadResult =
  WindowRoutes | WindowLeads | WindowFiles | WindowActivity | WindowIncidents

const skipped = z.union([z.number().int().nonnegative().safe(), z.literal('the-whole-ledger')])
const walk = z
  .object({
    walk: z.string(),
    rows: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
    ledgers: z.number().int().nonnegative(),
    rowsUnread: z.number().int().nonnegative(),
    ledgersSkipped: z.number().int().nonnegative().optional(),
  })
  .strict()
export const windowReadResult = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('incidents'),
      owners: z
        .array(
          z
            .object({
              sessionId: z.string().min(1),
              pieces: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
              work: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
              routes: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
              messages: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
              stop: z.unknown(),
              piecesSkipped: z.array(skipped).max(WINDOW_READ_BOUNDS.rows),
              routesSkipped: z.array(skipped).max(WINDOW_READ_BOUNDS.rows),
              messagesSkipped: z.array(skipped).max(WINDOW_READ_BOUNDS.rows),
              stopSkipped: z.array(skipped).max(WINDOW_READ_BOUNDS.rows),
            })
            .strict(),
        )
        .max(WINDOW_READ_BOUNDS.sessions),
    })
    .strict(),
  z
    .object({
      kind: z.literal('activity'),
      window: z
        .object({
          from: z.number().int().nonnegative().safe(),
          to: z.number().int().nonnegative().safe(),
        })
        .strict(),
      read: walk.omit({ rows: true }),
      capped: z.boolean(),
      lines: z
        .array(
          z
            .object({
              id: z.string(),
              at: z.number().int().nonnegative().safe(),
              what: z.enum(['finished', 'failed', 'started', 'stopped']),
              register: z.enum(['observed', 'claimed']),
              piece: z
                .object({ id: z.string(), label: z.string(), title: z.string().nullable() })
                .strict(),
              agent: z.string(),
              conversation: z.string().nullable(),
            })
            .strict(),
        )
        .max(RECENT_ACTIVITY_LINES),
    })
    .strict(),
  z
    .object({
      kind: z.literal('files'),
      tree: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
      added: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
      roster: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.sessions),
    })
    .strict(),
  z
    .object({
      kind: z.literal('routes'),
      routes: z
        .array(
          z
            .object({
              sessionId: z.string().min(1),
              requests: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows),
              skipped: z.array(skipped).max(WINDOW_READ_BOUNDS.rows),
            })
            .strict(),
        )
        .max(WINDOW_READ_BOUNDS.sessions),
      questions: walk,
      decisions: walk,
    })
    .strict(),
  z
    .object({ kind: z.literal('leads'), rows: z.array(z.unknown()).max(WINDOW_READ_BOUNDS.rows) })
    .strict(),
])

export interface WindowStoreReader {
  read(query: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult>
  close(): Promise<void>
}

/** `busy`: all native permits are held; `failed`: the worker could not complete its read. */
export class WindowReadUnavailable extends Error {
  constructor(readonly why: 'unavailable' | 'failed' | 'restart' | 'busy' = 'unavailable') {
    super(
      why === 'restart'
        ? 'The window’s record could not be read. Restart BroCrew to try again.'
        : 'The window’s record could not be read. Please try again.',
    )
  }
}
