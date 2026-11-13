import { z } from 'zod'
import { MAX_DIGEST_SPAN_MS } from '../../shared/digest'
import { RECENT_ACTIVITY_LINES, type RecentActivityReading } from '../../shared/recent-activity'
import { FOREST_PAGE, FOREST_WINDOWS } from '../../shared/the-whole-forest'
import type { ForestFirstRead } from './forest-first-read'
import type { SessionStore, ThreadLeadRow } from './session-store'
import type { SkipNote } from './rows-unread'

export const WINDOW_READ_BOUNDS = {
  pending: 16,
  callers: 16,
  leadPageRows: 256,
} as const

const conversationId = z.string().min(1).max(512)
const conversationIds = z.array(conversationId)

export const windowReadQuery = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('forest'),
      asked: z
        .object({
          scope: z.discriminatedUnion('is', [
            z.object({ is: z.literal('the-workspace'), window: z.enum(FOREST_WINDOWS) }).strict(),
            z.object({ is: z.literal('the-tree-of'), conversation: conversationId }).strict(),
          ]),
          measuredFrom: z.number().int().nonnegative().safe(),
          running: conversationIds,
          hidden: conversationIds,
          insteadOf: z.array(z.tuple([conversationId, conversationId])),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('forest-nodes'),
      conversations: conversationIds.min(1).max(FOREST_PAGE),
      drawn: conversationIds,
      hidden: conversationIds,
    })
    .strict(),
  z.object({ kind: z.literal('routes'), reuse: z.object({
    token: z.string(), changed: conversationIds,
  }).strict().optional() }).strict(),
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
      givers: z.array(z.string().min(1).max(512)),
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
  readonly cacheToken?: string
}
interface WindowLeads {
  readonly kind: 'leads'
  readonly rows: readonly ThreadLeadRow[]
}
interface WindowFiles {
  readonly kind: 'files'
  readonly tree: ReturnType<SessionStore['filesKept']>
  readonly added: ReturnType<SessionStore['filesKept']>
  readonly roster: ReturnType<SessionStore['agentIdentities']>
}
interface WindowActivity extends RecentActivityReading {
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
interface WindowForest extends ForestFirstRead {
  readonly kind: 'forest'
}
interface WindowForestNodes {
  readonly kind: 'forest-nodes'
  readonly nodes: ReturnType<SessionStore['forestNodesOf']>['nodes']
  readonly gone: readonly string[]
}
export type WindowReadResult =
  | WindowRoutes
  | WindowLeads
  | WindowFiles
  | WindowActivity
  | WindowIncidents
  | WindowForest
  | WindowForestNodes

const skipped = z.union([z.number().int().nonnegative().safe(), z.literal('the-whole-ledger')])
const walk = z
  .object({
    walk: z.string(),
    rows: z.array(z.unknown()),
    ledgers: z.number().int().nonnegative(),
    rowsUnread: z.number().int().nonnegative(),
    ledgersSkipped: z.number().int().nonnegative().optional(),
  })
  .strict()
const ids = z.array(z.string().min(1))
export const windowReadResult = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('forest'),
      listing: z
        .object({
          counts: z
            .object({
              active: z.number().int().nonnegative(),
              hour: z.number().int().nonnegative(),
              day: z.number().int().nonnegative(),
              week: z.number().int().nonnegative(),
              all: z.number().int().nonnegative(),
            })
            .strict()
            .nullable(),
          root: z.string().min(1).nullable(),
          total: z.number().int().nonnegative(),
          admitted: ids,
          context: ids,
          behind: ids,
        })
        .strict(),
      nodes: walk,
      unfolded: ids,
      heldByNoAgent: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('forest-nodes'), nodes: walk, gone: ids }).strict(),
  z
    .object({
      kind: z.literal('incidents'),
      owners: z.array(
        z
          .object({
            sessionId: z.string().min(1),
            pieces: z.array(z.unknown()),
            work: z.array(z.unknown()),
            routes: z.array(z.unknown()),
            messages: z.array(z.unknown()),
            stop: z.unknown(),
            piecesSkipped: z.array(skipped),
            routesSkipped: z.array(skipped),
            messagesSkipped: z.array(skipped),
            stopSkipped: z.array(skipped),
          })
          .strict(),
      ),
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
      tree: z.array(z.unknown()),
      added: z.array(z.unknown()),
      roster: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('routes'),
      cacheToken: z.string().optional(),
      routes: z.array(
        z
          .object({
            sessionId: z.string().min(1),
            requests: z.array(z.unknown()),
            skipped: z.array(skipped),
          })
          .strict(),
      ),
      questions: walk,
      decisions: walk,
    })
    .strict(),
  z.object({ kind: z.literal('leads'), rows: z.array(z.unknown()) }).strict(),
])

export interface WindowStoreReader {
  read(query: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult>
  close(): Promise<void>
}

export const windowReadFailure = z.enum([
  'rows',
  'bytes',
  'reply',
  'sessions',
  'cancelled',
  'worker-read-failed',
])
export type WindowReadFailure = z.infer<typeof windowReadFailure>

/** `busy`: all native permits are held; `failed`: the worker could not complete its read. */
export class WindowReadUnavailable extends Error {
  constructor(
    readonly why: 'unavailable' | 'failed' | 'restart' | 'busy' = 'unavailable',
    readonly reason?: WindowReadFailure,
    readonly readCause?: string,
  ) {
    super(
      (why === 'restart'
        ? 'The window’s record could not be read. Restart BroCrew to try again.'
        : 'The window’s record could not be read. Please try again.') +
        (reason === undefined ? '' : ` (${reason})`) +
        (readCause === undefined ? '' : ` Cause: ${readCause}`),
    )
  }
}
