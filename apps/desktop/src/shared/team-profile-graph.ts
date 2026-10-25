import { z } from 'zod'

export const TEAM_PROFILE_GRAPH_BOUNDS = {
  rows: 250_000,
  deadlineMs: 5_000,
  parentDeadlineMs: 6_000,
  page: 256,
  nodePage: 100,
  edgePage: 256,
  replyBytes: 512 * 1024,
  fieldBytes: 32 * 1024,
  identities: 10_000,
  pairs: 50_000,
  routeKeys: 250_000,
  aggregateBytes: 16 * 1024 * 1024,
  workingBytes: 32 * 1024 * 1024,
  sqliteCacheBytes: 4 * 1024 * 1024,
  ttlMs: 60_000,
  workers: 2,
  queuedWindows: 2,
  restarts: 3,
  restartWindowMs: 60_000,
  lineageOps: 20_000_000,
  layoutNodes: 1_000,
  layoutPairs: 5_000,
  arrows: 10_000,
  labels: 300,
  listPage: 50,
} as const
const id = z.string().min(1).max(200)
const token = z.string().min(1).max(2048)
const count = z.number().int().nonnegative().safe()
export const graphEpoch = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000)
export const graphPhase = z.enum([
  'roster',
  'sessions',
  'work',
  'turns',
  'messages',
  'questions',
  'lineage',
  'kind',
  'page',
])
export const graphKindQuality = z.enum([
  'stable-record',
  'legacy-normal',
  'unknown-file',
  'unknown-incarnation',
  'unknown-conflict',
  'unknown-lineage',
  'unknown-changing',
])
export const graphSettingSource = z.enum([
  'conversation-setting',
  'identity-model-choice',
  'identity-provider',
  'unknown',
])
export const teamProfileGraphRequest = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('snapshot') }),
  z.strictObject({
    operation: z.literal('nodes'),
    snapshot: token,
    cursor: token.optional(),
    size: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({
    operation: z.literal('edges'),
    snapshot: token,
    cursor: token.optional(),
    size: z.number().int().min(1).max(256).optional(),
  }),
  z.strictObject({ operation: z.literal('release') }),
])
export const GRAPH_COVERAGE_KEYS = [
  'unboundConversations',
  'missingIdentityConversations',
  'earlierIncarnationConversations',
  'unresolvedWork',
  'unresolvedMessages',
  'unresolvedQuestions',
  'selfWork',
  'selfMessages',
  'selfQuestions',
  'excludedParentRoutes',
  'excludedPersonRoutes',
  'missingCreators',
  'creatorIncarnationLinksOmitted',
  'cyclicCreatorComponents',
  'unknownKinds',
  'unknownProviders',
  'unknownModels',
] as const
export const graphCoverage = z.strictObject(
  Object.fromEntries(GRAPH_COVERAGE_KEYS.map((key) => [key, count])) as Record<
    (typeof GRAPH_COVERAGE_KEYS)[number],
    typeof count
  >,
)
export const emptyGraphCoverage = (): GraphCoverage =>
  Object.fromEntries(GRAPH_COVERAGE_KEYS.map((key) => [key, 0])) as GraphCoverage
const display = z.string().max(512)
const configured = z
  .strictObject({
    provider: z.enum(['claude', 'codex']).nullable(),
    model: display.nullable(),
    source: graphSettingSource,
  })
  .refine((c) =>
    c.source === 'unknown'
      ? c.provider === null && c.model === null
      : c.source === 'identity-provider'
        ? c.provider !== null && c.model === null
        : c.source === 'identity-model-choice'
          ? c.provider !== null && c.model !== null && c.model.trim().length > 0
          : true,
  )
export const graphNode = z
  .strictObject({
    id,
    createdAt: graphEpoch,
    profile: display,
    name: display,
    clipped: z.boolean(),
    kind: z.enum(['normal', 'service', 'unknown']),
    kindQuality: graphKindQuality,
    kindReadAt: graphEpoch,
    configured,
    conversations: count,
    piecesHeld: count,
    messagesSent: count,
    recentTurns: count,
    directDescendants: count,
    descendants: count,
    recordedWorking: count,
    lastTurnAt: graphEpoch.nullable(),
    lastSavedUpdate: graphEpoch.nullable(),
  })
  .refine((n) =>
    n.kind === 'unknown'
      ? n.kindQuality.startsWith('unknown-')
      : n.kindQuality === 'stable-record' ||
        (n.kind === 'normal' && n.kindQuality === 'legacy-normal'),
  )
export const graphEdge = z
  .strictObject({ source: id, target: id, work: count, messages: count, questions: count })
  .refine(
    (e) =>
      e.source !== e.target &&
      Number.isSafeInteger(e.work + e.messages + e.questions) &&
      e.work + e.messages + e.questions > 0,
  )
const stamp = { snapshot: token, readAt: graphEpoch, expiresAt: graphEpoch, stale: z.boolean() }
export const graphMetrics = z.strictObject({
  rows: count,
  projectedBytes: count,
  aggregateBytes: count,
  cacheBytes: count,
  elapsedMs: z.number().finite().nonnegative(),
})
export const graphUnavailableResult = z.strictObject({
  type: z.literal('unavailable'),
  cause: z.enum([
    'closed',
    'cancelled',
    'busy',
    'changed',
    'expired',
    'invalid-cursor',
    'metadata',
    'budget',
    'worker',
  ]),
  complete: z.literal(false),
  phase: graphPhase,
  visited: count,
  unread: count,
  remaining: z.union([count, z.literal('unknown')]),
  retryAfterMs: z.number().finite().nonnegative().optional(),
})
export const teamProfileGraphResult = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('snapshot'),
    ...stamp,
    semanticsVersion: z.literal(1),
    timezone: z.string().min(1).max(128),
    todaySince: graphEpoch,
    recentSince: graphEpoch,
    nodeCount: count.max(10_000),
    edgeCount: count.max(50_000),
    coverage: graphCoverage,
    metrics: graphMetrics,
  }),
  z.strictObject({
    type: z.literal('nodes'),
    ...stamp,
    nodes: z.array(graphNode).max(100),
    next: token.nullable(),
  }),
  z.strictObject({
    type: z.literal('edges'),
    ...stamp,
    edges: z.array(graphEdge).max(256),
    next: token.nullable(),
  }),
  z.strictObject({ type: z.literal('released') }),
  graphUnavailableResult,
])
export const graphReadContext = z.strictObject({
  workspaceNonce: id,
  ownerNonce: id,
  hostRevision: token,
  timezone: z
    .string()
    .min(1)
    .max(128)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
      } catch {
        return false
      }
    }),
})
export type TeamProfileGraphRequest = z.infer<typeof teamProfileGraphRequest>
export type TeamProfileGraphResult = z.infer<typeof teamProfileGraphResult>
export type GraphNode = z.infer<typeof graphNode>
export type GraphEdge = z.infer<typeof graphEdge>
export type GraphCoverage = z.infer<typeof graphCoverage>
export type GraphMetrics = z.infer<typeof graphMetrics>
export type GraphPhase = z.infer<typeof graphPhase>
export type KindQuality = z.infer<typeof graphKindQuality>
export type GraphUnavailable = z.infer<typeof graphUnavailableResult>
export type TeamProfileGraphReadContext = z.infer<typeof graphReadContext>
export interface TeamProfileGraphReader {
  read(
    request: TeamProfileGraphRequest,
    context: TeamProfileGraphReadContext,
  ): Promise<TeamProfileGraphResult>
  close(): Promise<void>
}
export const graphUnavailable = (
  cause: GraphUnavailable['cause'],
  phase: GraphPhase = 'roster',
  visited = 0,
  unread = 0,
  retryAfterMs?: number,
): GraphUnavailable => ({
  type: 'unavailable',
  cause,
  complete: false,
  phase,
  visited,
  unread,
  remaining: 'unknown',
  ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
})
export function graphAdd(a: number, b: number): number {
  const sum = a + b
  if (
    !Number.isSafeInteger(a) ||
    a < 0 ||
    !Number.isSafeInteger(b) ||
    b < 0 ||
    !Number.isSafeInteger(sum)
  )
    throw new Error('count overflow')
  return sum
}
export const graphScalar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function graphDayStart(readAt: number, timezone: string): number {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  })
  const dateKey = (at: number): string => {
    const parts = format.formatToParts(at)
    return ['era', 'year', 'month', 'day']
      .map((k) => parts.find((p) => p.type === k)?.value ?? '')
      .join('-')
  }
  const target = dateKey(readAt)
  let low = readAt - 48 * 60 * 60 * 1000,
    high = readAt
  // The date changes at a timezone calendar boundary, including skipped midnight/DST.
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (dateKey(mid) === target) high = mid
    else low = mid + 1
  }
  return low
}
