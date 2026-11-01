import Database from 'better-sqlite3'
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { serialize } from 'node:v8'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  graphReadContext,
  teamProfileGraphRequest,
  teamProfileGraphResult,
  graphUnavailable,
  graphEpoch,
  graphAdd,
  graphScalar,
  graphDayStart,
  emptyGraphCoverage,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
  type TeamProfileGraphReadContext,
  type GraphNode,
  type GraphEdge,
  type GraphPhase,
  type GraphUnavailable,
  type GraphCoverage,
} from '../../shared/team-profile-graph'
import { readIdentityCreator, agentIdentityRowId } from './identity'
import { graphKindOf, readGraphKindFile, type GraphKindEvidence } from './team-profile-graph-kind'
import { graphLineage } from './team-profile-graph-lineage'

type Row = Record<string, string | number | null>
type Session = {
  id: string
  identity: string | null
  created: number
  updated: number | null
  parent: string | null
  generation: number
  provider: 'claude' | 'codex' | null
  model: string | null
}
type Reading = Extract<TeamProfileGraphResult, { type: 'snapshot' }> & {
  nodes: GraphNode[]
  edges: GraphEdge[]
  context: TeamProfileGraphReadContext
  deadline: number
}
class Failed extends Error {
  constructor(
    readonly reason: GraphUnavailable['cause'],
    readonly unread = 0,
  ) {
    super(reason)
  }
}
const epoch = (v: unknown): v is number => graphEpoch.safeParse(v).success
const provider = (v: unknown): 'claude' | 'codex' | null =>
  v === 'claude' || v === 'codex' ? v : null
const textBytes = (v: unknown): number => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : 8)
const key = (v: unknown): string => {
  if (typeof v !== 'string' || !v.length || v.length > 200) throw new Failed('metadata', 1)
  return v
}
const nullableKey = (v: unknown): string | null => (v === null ? null : key(v))
const count = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Failed('metadata', 1)
  return v
}
const display = (v: unknown): string | null =>
  v === null
    ? null
    : typeof v === 'string'
      ? v
      : (() => {
          throw new Failed('metadata', 1)
        })()
// SQLite bounds source bytes before returning text; display strings include one clipping sentinel.
const column = (name: string, kind: 'key' | 'display' | 'json' = 'key'): string =>
  `CASE WHEN ${name} IS NULL THEN NULL WHEN typeof(${name})='text' AND length(CAST(${name} AS BLOB))<=${kind === 'key' ? 800 : B.fieldBytes} THEN ${kind === 'display' ? `substr(${name},1,513)` : name} ELSE NULL END AS ${name.split('.').at(-1)}, CASE WHEN ${name} IS NOT NULL AND (typeof(${name})!='text' OR length(CAST(${name} AS BLOB))>${kind === 'key' ? 800 : B.fieldBytes}) THEN 1 ELSE 0 END AS bad_${name.split('.').at(-1)}`

/** Complete immutable profile counts from one bounded, read-only SQLite transaction. */
export class TeamProfileGraphEngine {
  private readonly db: Database.Database
  private readonly secret = randomBytes(32)
  private reading: Reading | undefined
  private closed = false
  private visited = 0
  private projectedBytes = 0
  private projectedResident = 0
  private workingBytes = 0
  private aggregateEstimate = 4096
  private started = 0
  private phase: GraphPhase = 'roster'
  private cancelled: () => boolean = () => false
  constructor(
    file: string,
    private readonly executionFile: string,
    private readonly now: () => number = Date.now,
    private readonly monotonic: () => number = () => performance.now(),
    private readonly trace?: (sql: string, bindings: readonly unknown[]) => void,
  ) {
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only=ON')
      this.db.pragma('cache_size=-4096')
      if (this.db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Failed('worker')
      this.checkPlans()
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  expiresIn(): number {
    return Math.max(0, (this.reading?.deadline ?? this.monotonic()) - this.monotonic())
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.reading = undefined
    this.db.close()
  }
  read(
    input: TeamProfileGraphRequest,
    source: TeamProfileGraphReadContext,
    cancelled: () => boolean = () => false,
  ): TeamProfileGraphResult {
    this.visited = 0
    this.projectedBytes = 0
    this.workingBytes = 0
    this.started = this.monotonic()
    this.phase = 'roster'
    this.cancelled = cancelled
    if (this.closed) return graphUnavailable('closed')
    try {
      const request = teamProfileGraphRequest.parse(input),
        context = graphReadContext.parse(source)
      this.check()
      if (request.operation === 'release') {
        this.reading = undefined
        return { type: 'released' }
      }
      if (request.operation === 'snapshot') {
        this.reading = undefined
        this.aggregateEstimate = 4096
        const reading = this.build(context)
        this.reading = reading
        const header: Extract<TeamProfileGraphResult, { type: 'snapshot' }> = {
          type: 'snapshot',
          snapshot: reading.snapshot,
          readAt: reading.readAt,
          expiresAt: reading.expiresAt,
          stale: reading.stale,
          semanticsVersion: 1,
          timezone: reading.timezone,
          todaySince: reading.todaySince,
          recentSince: reading.recentSince,
          nodeCount: reading.nodeCount,
          edgeCount: reading.edgeCount,
          coverage: reading.coverage,
          metrics: reading.metrics,
        }
        return this.reply(header)
      }
      this.phase = 'page'
      const r = this.reading
      if (!r || this.monotonic() >= r.deadline) {
        this.reading = undefined
        throw new Failed('expired')
      }
      if (
        r.snapshot !== request.snapshot ||
        r.context.ownerNonce !== context.ownerNonce ||
        r.context.workspaceNonce !== context.workspaceNonce
      )
        throw new Failed('invalid-cursor')
      r.stale ||= r.context.hostRevision !== context.hostRevision
      const population = request.operation === 'nodes' ? r.nodes : r.edges
      const offset =
        request.cursor === undefined ? 0 : this.offset(request.cursor, request.operation, r)
      if (offset > population.length) throw new Failed('invalid-cursor')
      const end = Math.min(
        population.length,
        offset + (request.size ?? (request.operation === 'nodes' ? B.nodePage : B.edgePage)),
      )
      const stamp = {
        snapshot: r.snapshot,
        readAt: r.readAt,
        expiresAt: r.expiresAt,
        stale: r.stale,
      }
      const next = end < population.length ? this.cursor(request.operation, end, r) : null
      return this.reply(
        request.operation === 'nodes'
          ? { type: 'nodes', ...stamp, nodes: r.nodes.slice(offset, end), next }
          : { type: 'edges', ...stamp, edges: r.edges.slice(offset, end), next },
      )
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      return graphUnavailable(
        error instanceof Failed ? error.reason : 'metadata',
        this.phase,
        this.visited,
        error instanceof Failed ? error.unread : 1,
      )
    }
  }
  private reply(result: TeamProfileGraphResult): TeamProfileGraphResult {
    if (serialize(result).byteLength > B.replyBytes) throw new Failed('budget')
    return teamProfileGraphResult.parse(result)
  }
  private check(): void {
    if (this.cancelled()) throw new Failed('cancelled')
    if (this.monotonic() - this.started >= B.deadlineMs) throw new Failed('budget')
  }
  private reserve(bytes: number): void {
    this.check()
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.workingBytes + bytes + B.sqliteCacheBytes + this.projectedResident + 2 * 1024 * 1024 >
        B.workingBytes
    )
      throw new Failed('budget')
    this.workingBytes += bytes
  }
  private bump(object: GraphCoverage | GraphNode | GraphEdge, field: string): void {
    const row = object as unknown as Record<string, number>
    try {
      row[field] = graphAdd(row[field]!, 1)
    } catch {
      throw new Failed('metadata', 1)
    }
  }
  private *pages(
    sql: string,
    bindings: readonly unknown[] = [],
    ordinal = false,
    nativeBudget = 4 * 1024 * 1024,
  ): Generator<Row> {
    const statement = this.db.prepare(sql)
    let after: number | bigint = ordinal ? -1 : -9223372036854775808n
    while (true) {
      this.check()
      if (this.workingBytes + B.sqliteCacheBytes + nativeBudget + 2 * 1024 * 1024 > B.workingBytes)
        throw new Failed('budget')
      const pageSize = Math.min(B.page, B.rows - this.visited)
      if (pageSize <= 0) throw new Failed('budget')
      const args = [...bindings, after, pageSize]
      this.trace?.(sql, args)
      const rows = statement.all(...args) as Row[]
      const bytes = serialize(rows).byteLength
      this.projectedBytes = graphAdd(this.projectedBytes, bytes)
      if (
        bytes * 3 + rows.length * 1024 > nativeBudget ||
        this.workingBytes + B.sqliteCacheBytes + bytes > B.workingBytes
      )
        throw new Failed('budget')
      this.projectedResident = bytes * 2 + rows.length * 1024
      try {
        this.reserve(0)
        this.visited += rows.length
        for (const row of rows) {
          this.check()
          const position = row.position
          if (typeof position !== 'number' || !Number.isSafeInteger(position) || position <= after)
            throw new Failed('metadata', 1)
          after = position
          for (const [name, value] of Object.entries(row))
            if (name.startsWith('bad_') && value !== 0) throw new Failed('metadata', 1)
          yield row
        }
      } finally {
        this.projectedResident = 0
      }
      if (rows.length < pageSize) return
    }
  }
  private checkPlans(): void {
    const probes = [
      [
        'SELECT rowid FROM agent_identity WHERE rowid>? ORDER BY rowid LIMIT ?',
        [-1, 256],
        'INTEGER PRIMARY KEY',
      ],
      [
        'SELECT rowid FROM provider_session WHERE rowid>? ORDER BY rowid LIMIT ?',
        [-1, 256],
        'INTEGER PRIMARY KEY',
      ],
      [
        'SELECT rowid FROM work WHERE rowid>? ORDER BY rowid LIMIT ?',
        [-1, 256],
        'INTEGER PRIMARY KEY',
      ],
      [
        'SELECT ordinal FROM turn WHERE session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?',
        ['s', 0, -1, 256],
        'turn_session_ordinal_uq',
      ],
      [
        'SELECT ordinal FROM events WHERE type=? AND session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?',
        ['message_sent', 's', 0, -1, 256],
        'events_kind_owner_idx',
      ],
    ] as const
    for (const [sql, args, index] of probes) {
      const plan = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]
      if (
        !plan.some((p) => p.detail.includes('SEARCH') && p.detail.includes(index)) ||
        plan.some((p) => /TEMP B-TREE|SCAN /.test(p.detail))
      )
        throw new Failed('metadata')
    }
  }
  private cursor(operation: string, offset: number, r: Reading): string {
    const value = `${operation}.${offset}`
    return `${value}.${createHmac('sha256', this.secret).update(`${r.snapshot}|${r.context.workspaceNonce}|${r.context.ownerNonce}|${value}`).digest('base64url')}`
  }
  private offset(cursor: string, operation: string, r: Reading): number {
    const match = /^(nodes|edges)\.(0|[1-9][0-9]*)\.([A-Za-z0-9_-]{43})$/.exec(cursor)
    if (!match || match[1] !== operation) throw new Failed('invalid-cursor')
    const offset = Number(match[2])
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Failed('invalid-cursor')
    const expected = this.cursor(operation, offset, r)
    if (
      expected.length !== cursor.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(cursor))
    )
      throw new Failed('invalid-cursor')
    return offset
  }
  private build(context: TeamProfileGraphReadContext): Reading {
    const version = this.db.pragma('data_version', { simple: true })
    this.db.exec('BEGIN')
    if (this.db.prepare('SELECT rowid FROM agent_identity ORDER BY rowid LIMIT 1').get())
      this.visited++
    const readAt = this.now()
    if (!epoch(readAt)) throw new Failed('metadata')
    const recentSince = readAt - 7 * 86_400_000,
      todaySince = graphDayStart(readAt, context.timezone)
    const coverage = emptyGraphCoverage(),
      nodes: GraphNode[] = [],
      byId = new Map<string, GraphNode>(),
      creators = new Map<string, string>(),
      defaults = new Map<string, GraphNode['configured']>()
    this.phase = 'roster'
    const choiceValid =
      "CASE WHEN typeof(model_choice)='text' AND length(CAST(model_choice AS BLOB))<=32768 THEN json_valid(model_choice) ELSE 0 END"
    const choice = `CASE WHEN ${choiceValid} THEN CASE WHEN json_type(model_choice)='object' AND json_type(model_choice,'$.provider')='text' AND json_type(model_choice,'$.model')='text' AND (json_type(model_choice,'$.effort') IS NULL OR json_type(model_choice,'$.effort') IN ('text','null')) THEN json_object('provider',substr(json_extract(model_choice,'$.provider'),1,201),'model',substr(json_extract(model_choice,'$.model'),1,513),'effort',substr(json_extract(model_choice,'$.effort'),1,201)) ELSE NULL END ELSE NULL END AS model_choice`
    for (const row of this.pages(
      `SELECT rowid AS position,${column('id')},${column('slug', 'display')},${column('display_name', 'display')},${column('provider')},${choice},${column('created_by')},created_at FROM agent_identity WHERE rowid>? ORDER BY rowid LIMIT ?`,
      [],
      false,
      16 * 1024 * 1024,
    )) {
      if (!epoch(row.created_at) || row.created_at > readAt) continue
      if (nodes.length >= B.identities) throw new Failed('budget')
      const id = key(row.id),
        profile = display(row.slug),
        name = display(row.display_name) ?? profile
      if (profile === null || name === null) throw new Failed('metadata', 1)
      this.reserve(768 + textBytes(id) * 2 + textBytes(profile) * 2 + textBytes(name) * 2)
      this.aggregateEstimate +=
        1536 +
        textBytes(id) * 2 +
        textBytes(profile) * 2 +
        textBytes(name) * 2 +
        textBytes(row.model_choice) * 2
      const node: GraphNode = {
        id,
        createdAt: row.created_at,
        profile: profile.slice(0, 512),
        name: name.slice(0, 512),
        clipped:
          profile.length > 512 ||
          name.length > 512 ||
          (typeof row.model_choice === 'string' && JSON.parse(row.model_choice).model.length > 512),
        kind: 'unknown',
        kindQuality: 'unknown-file',
        kindReadAt: readAt,
        configured: { provider: null, model: null, source: 'unknown' },
        conversations: 0,
        piecesHeld: 0,
        messagesSent: 0,
        recentTurns: 0,
        directDescendants: 0,
        descendants: 0,
        recordedWorking: 0,
        lastTurnAt: null,
        lastSavedUpdate: null,
      }
      byId.set(id, node)
      nodes.push(node)
      const creator = readIdentityCreator(display(row.created_by))
      if (creator?.by === 'an-agent') creators.set(id, agentIdentityRowId(creator.agent))
      defaults.set(id, this.defaultSetting(row))
    }
    const sessions = new Map<string, Session>(),
      selected = new Map<string, Session>(),
      roots = new Set<string>(),
      evidence = new Map<string, GraphKindEvidence>()
    for (const node of nodes)
      evidence.set(node.id, {
        complete: true,
        serviceBirths: [],
        workerBirths: 0,
        earlierBirths: false,
        serviceBindsCurrent: false,
      })
    this.phase = 'sessions'
    for (const row of this.pages(
      `SELECT s.rowid AS position,${column('s.id')},${column('s.agent_identity_id')},${column('s.parent_session_id')},${column('s.provider')},${column('s.model', 'display')},s.created_at,s.updated_at,${column('s.status')},coalesce(g.active,0) AS generation FROM provider_session AS s LEFT JOIN derived_generation AS g ON g.session_id=s.id WHERE s.rowid>? ORDER BY s.rowid LIMIT ?`,
      [],
      false,
      8 * 1024 * 1024,
    )) {
      if (!epoch(row.created_at) || row.created_at > readAt) continue
      const id = key(row.id),
        identity = nullableKey(row.agent_identity_id),
        parent = nullableKey(row.parent_session_id)
      const node = identity === null ? undefined : byId.get(identity)
      if (identity === null) this.bump(coverage, 'unboundConversations')
      else if (!node) this.bump(coverage, 'missingIdentityConversations')
      this.reserve(384 + textBytes(id) * 2 + textBytes(identity) * 2 + textBytes(row.model) * 2)
      const updated =
        epoch(row.updated_at) && row.updated_at <= readAt && row.updated_at >= row.created_at
          ? row.updated_at
          : null
      const s: Session = {
        id,
        identity,
        created: row.created_at,
        updated,
        parent,
        generation: count(row.generation),
        provider: provider(row.provider),
        model:
          typeof row.model === 'string' && row.model.trim().length ? row.model.slice(0, 512) : null,
      }
      sessions.set(id, s)
      if (!node) continue
      node.clipped ||= (display(row.model)?.length ?? 0) > 512
      this.bump(node, 'conversations')
      if (row.status === 'working') this.bump(node, 'recordedWorking')
      if (s.created < node.createdAt) this.bump(coverage, 'earlierIncarnationConversations')
      if (updated !== null)
        node.lastSavedUpdate = Math.max(node.lastSavedUpdate ?? updated, updated)
      if (s.created >= node.createdAt && updated !== null && updated >= s.created) {
        const previous = selected.get(node.id)
        if (
          !previous ||
          updated > previous.updated! ||
          (updated === previous.updated &&
            (s.created > previous.created ||
              (s.created === previous.created && graphScalar(id, previous.id) < 0)))
        )
          selected.set(node.id, s)
      }
    }
    this.phase = 'work'
    const pairs = new Map<string, GraphEdge>()
    const addPair = (
      source: string | null,
      target: string | null,
      category: 'work' | 'messages' | 'questions',
    ) => {
      if (source === null || target === null || !byId.has(source) || !byId.has(target)) {
        this.bump(
          coverage,
          category === 'work'
            ? 'unresolvedWork'
            : category === 'messages'
              ? 'unresolvedMessages'
              : 'unresolvedQuestions',
        )
        return
      }
      if (source === target) {
        this.bump(
          coverage,
          category === 'work'
            ? 'selfWork'
            : category === 'messages'
              ? 'selfMessages'
              : 'selfQuestions',
        )
        return
      }
      const k = JSON.stringify([source, target])
      let pair = pairs.get(k)
      if (!pair) {
        if (pairs.size >= B.pairs) throw new Failed('budget')
        this.reserve(256 + textBytes(k) * 2)
        this.aggregateEstimate += 512 + textBytes(k) * 2
        pair = { source, target, work: 0, messages: 0, questions: 0 }
        pairs.set(k, pair)
      }
      this.bump(pair, category)
    }
    for (const row of this.pages(
      `SELECT rowid AS position,${column('parent_id')},${column('owner_session_id')},${column('given_by_session_id')},created_at FROM work WHERE rowid>? ORDER BY rowid LIMIT ?`,
    )) {
      const owner = key(row.owner_session_id)
      if (row.parent_id === null) {
        if (!epoch(row.created_at)) {
          const identity = sessions.get(owner)?.identity
          const facts = identity ? evidence.get(identity) : undefined
          if (facts) facts.complete = false
          continue
        }
        if (row.created_at <= readAt && !roots.has(owner)) {
          this.reserve(96 + textBytes(owner) * 2)
          roots.add(owner)
        }
        continue
      }
      if (!epoch(row.created_at) || row.created_at > readAt) continue
      const target = sessions.get(owner)?.identity ?? null,
        source = sessions.get(nullableKey(row.given_by_session_id) ?? '')?.identity ?? null
      const held = target === null ? undefined : byId.get(target)
      if (held) this.bump(held, 'piecesHeld')
      if (row.given_by_session_id !== null) addPair(source, target, 'work')
      else if (!held) this.bump(coverage, 'unresolvedWork')
    }
    const routeKeys = new Set<string>()
    for (const s of sessions.values()) {
      const node = s.identity === null ? undefined : byId.get(s.identity)
      if (!node) continue
      this.phase = 'turns'
      for (const row of this.pages(
        'SELECT ordinal AS position,opened_at,closed_at FROM turn WHERE session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?',
        [s.id, s.generation],
        true,
      )) {
        const opened = row.opened_at,
          closed = row.closed_at
        if (!epoch(opened) || opened > readAt) continue
        node.lastTurnAt = Math.max(node.lastTurnAt ?? opened, opened)
        if (opened >= recentSince) this.bump(node, 'recentTurns')
        if (epoch(closed) && closed >= opened && closed <= readAt)
          node.lastTurnAt = Math.max(node.lastTurnAt, closed)
      }
      for (const category of ['messages', 'questions'] as const) {
        this.phase = category
        const type = category === 'messages' ? 'message_sent' : 'request_routed'
        const valid =
          "CASE WHEN typeof(payload)='text' AND length(CAST(payload AS BLOB))<=32768 THEN json_valid(payload) ELSE 0 END"
        const object = `CASE WHEN ${valid} THEN json_type(payload)='object' ELSE 0 END`
        const extract = (field: string) =>
          `CASE WHEN ${object} THEN CASE WHEN json_type(payload,'$.${field}')='text' THEN substr(json_extract(payload,'$.${field}'),1,201) ELSE NULL END ELSE NULL END AS "${field}"`
        for (const row of this.pages(
          `SELECT ordinal AS position,created_at,CASE WHEN ${object} THEN 0 ELSE 1 END AS bad_payload,${extract('to')}${category === 'questions' ? `,${extract('parent')},${extract('requestId')}` : ''} FROM events WHERE type=? AND session_id=? AND generation=? AND ordinal>? ORDER BY ordinal LIMIT ?`,
          [type, s.id, s.generation],
          true,
        )) {
          if (!epoch(row.created_at) || row.created_at > readAt) continue
          const to = key(row.to)
          if (category === 'messages') {
            this.bump(node, 'messagesSent')
            addPair(node.id, sessions.get(to)?.identity ?? null, 'messages')
          } else {
            const request = key(row.requestId)
            if (to === 'the-parent') {
              this.bump(coverage, 'excludedParentRoutes')
              continue
            }
            if (to === 'a-person') {
              this.bump(coverage, 'excludedPersonRoutes')
              continue
            }
            if (to !== 'an-agent') throw new Failed('metadata', 1)
            const recipient = key(row.parent),
              dedup = JSON.stringify([s.id, request, recipient])
            if (routeKeys.has(dedup)) continue
            if (routeKeys.size >= B.routeKeys) throw new Failed('budget')
            this.reserve(128 + textBytes(dedup) * 2)
            routeKeys.add(dedup)
            addPair(node.id, sessions.get(recipient)?.identity ?? null, 'questions')
          }
        }
      }
    }
    this.phase = 'lineage'
    const parents = new Map<string, string>()
    for (const [child, parent] of creators) {
      const p = byId.get(parent),
        c = byId.get(child)!
      if (!p) this.bump(coverage, 'missingCreators')
      else if (p.createdAt > c.createdAt) this.bump(coverage, 'creatorIncarnationLinksOmitted')
      else parents.set(child, parent)
    }
    try {
      graphLineage(
        nodes,
        parents,
        coverage,
        (bytes) => this.reserve(bytes),
        () => this.check(),
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'lineage budget') throw new Failed('budget')
      throw error
    }
    this.phase = 'kind'
    for (const s of sessions.values()) {
      const node = s.identity === null ? undefined : byId.get(s.identity)
      if (!node) continue
      const facts = evidence.get(node.id)!
      if (s.parent === null && !roots.has(s.id)) {
        this.reserve(64 + textBytes(s.id) * 2)
        ;(facts.serviceBirths as string[]).push(s.id)
        facts.earlierBirths ||= s.created < node.createdAt
      }
      // First-life registration is separate from active-generation interaction reads.
      if (s.parent !== null)
        for (const row of this.pages(
          "SELECT ordinal AS position FROM events WHERE session_id=? AND generation=? AND ordinal>? AND ordinal=0 AND type='worker_registered' ORDER BY ordinal LIMIT ?",
          [s.id, 0],
          true,
        )) {
          void row
          facts.workerBirths++
          facts.earlierBirths ||= s.created < node.createdAt
        }
    }
    const kindFile = readGraphKindFile(this.executionFile, (bytes) => this.reserve(bytes), this.now)
    for (const node of nodes) {
      const facts = evidence.get(node.id)!
      const entry = kindFile.reading.readable ? kindFile.reading.kept.profiles[node.id] : undefined
      const bound = entry?.serviceConversation ? sessions.get(entry.serviceConversation) : undefined
      facts.serviceBindsCurrent = bound?.identity === node.id && bound.created >= node.createdAt
      Object.assign(node, graphKindOf(node, kindFile, facts))
      const setting = selected.get(node.id)
      node.configured = setting
        ? { provider: setting.provider, model: setting.model, source: 'conversation-setting' }
        : defaults.get(node.id)!
      if (node.kind === 'unknown') this.bump(coverage, 'unknownKinds')
      if (node.configured.provider === null) this.bump(coverage, 'unknownProviders')
      if (node.configured.model === null) this.bump(coverage, 'unknownModels')
    }
    this.db.exec('COMMIT')
    this.check()
    nodes.sort((a, b) => graphScalar(a.id, b.id))
    const edges = [...pairs.values()].sort(
      (a, b) => graphScalar(a.source, b.source) || graphScalar(a.target, b.target),
    )
    this.reserve(this.aggregateEstimate)
    const bytes = serialize({ nodes, edges, coverage }).byteLength
    if (bytes > B.aggregateBytes) throw new Failed('budget')
    if (bytes > this.aggregateEstimate) throw new Failed('budget')
    const completed = this.monotonic(),
      expiresAt = this.now() + B.ttlMs
    const result: Reading = {
      type: 'snapshot',
      snapshot: randomUUID(),
      readAt,
      expiresAt,
      stale: version !== this.db.pragma('data_version', { simple: true }),
      semanticsVersion: 1,
      timezone: context.timezone,
      todaySince,
      recentSince,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      coverage,
      metrics: {
        rows: this.visited,
        projectedBytes: this.projectedBytes,
        aggregateBytes: bytes,
        cacheBytes: this.workingBytes + B.sqliteCacheBytes,
        elapsedMs: completed - this.started,
      },
      nodes,
      edges,
      context: { ...context },
      deadline: completed + B.ttlMs,
    }
    this.check()
    return result
  }
  private defaultSetting(row: Row): GraphNode['configured'] {
    const p = provider(row.provider)
    if (typeof row.model_choice === 'string')
      try {
        const c: unknown = JSON.parse(row.model_choice)
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          const one = c as Record<string, unknown>,
            cp = provider(one.provider)
          if (
            cp !== null &&
            (p === null || p === cp) &&
            typeof one.model === 'string' &&
            one.model.trim().length > 0 &&
            (one.effort === null || one.effort === undefined || typeof one.effort === 'string')
          )
            return { provider: cp, model: one.model.slice(0, 512), source: 'identity-model-choice' }
        }
      } catch {
        /* An unreadable default cannot establish a provider/model pair. */
      }
    return p === null
      ? { provider: null, model: null, source: 'unknown' }
      : { provider: p, model: null, source: 'identity-provider' }
  }
}
