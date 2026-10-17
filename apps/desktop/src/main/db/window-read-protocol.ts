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
export type WindowReadResult = WindowRoutes | WindowLeads | WindowFiles | WindowActivity

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

/** `failed`: the worker answered that its read failed; `unavailable`: no worker could read. */
export class WindowReadUnavailable extends Error {
  constructor(readonly why: 'unavailable' | 'failed' | 'restart' = 'unavailable') {
    super(
      why === 'restart'
        ? 'The window’s record could not be read. Restart BroCrew to try again.'
        : 'The window’s record could not be read. Please try again.',
    )
  }
}
