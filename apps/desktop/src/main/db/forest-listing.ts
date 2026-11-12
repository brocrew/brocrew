import type { AppDatabase } from './connection'
import type { ForestedNode, SessionStore } from './session-store'
import type { LedgerWalk } from '../../shared/question-contracts'
import {
  ALL_ADMITS_NEWEST,
  FOREST_PAGE,
  FOREST_WINDOW_SPAN_MS,
  type ForestCounts,
  type ForestScope,
} from '../../shared/the-whole-forest'

/** What the host knows that the database does not, for one forest listing. */
export interface ForestListingAsked {
  readonly scope: ForestScope
  /** The instant every window reaches back from. */
  readonly measuredFrom: number
  /** The conversations running a turn at {@link measuredFrom}. */
  readonly running: readonly string[]
  /** Archived conversations: in no reading. */
  readonly hidden: readonly string[]
  /** Each replaced conversation with the stand-in at the end of its chain of replacements. */
  readonly insteadOf: readonly (readonly [replaced: string, standIn: string])[]
}

/** The conversations a forest reading holds, before any ledger is read. */
export interface ForestListing {
  readonly counts: ForestCounts | null
  readonly root: string | null
  readonly total: number
  readonly admitted: readonly string[]
  readonly context: readonly string[]
  readonly behind: readonly string[]
}

// A conversation is in a reading when an agent of this app holds it and it is not archived.
const PLACED = `provider_session ps JOIN agent_identity identity ON identity.id = ps.agent_identity_id`
const VISIBLE = `ps.id NOT IN (SELECT value FROM json_each(@hidden))`
const NOT_BEHIND = `ps.id NOT IN (SELECT value FROM json_each(@behind))`

/**
 * Lists one forest reading with structural reads only: the counts in one conditional aggregate,
 * the matching conversations, and the ancestors that connect them, or one conversation's whole
 * top-level tree. No ledger is read.
 */
export function forestListing(db: AppDatabase, asked: ForestListingAsked): ForestListing {
  const hidden = JSON.stringify(asked.hidden)
  const visibleAmong = db.prepare(
    `SELECT ps.id AS id FROM ${PLACED}
      WHERE ps.id IN (SELECT value FROM json_each(@ids)) AND ${VISIBLE}`,
  )
  const visible = (ids: Iterable<string>): Set<string> =>
    new Set(
      (visibleAmong.all({ ids: JSON.stringify([...ids]), hidden }) as { id: string }[]).map(
        (row) => row.id,
      ),
    )

  // A replaced conversation stands behind its stand-in only where the stand-in is in a reading.
  const standIns = visible(asked.insteadOf.map(([, standIn]) => standIn))
  const insteadOf = new Map(asked.insteadOf.filter(([, standIn]) => standIns.has(standIn)))
  const place = (id: string): string => insteadOf.get(id) ?? id
  const predecessorsOf = new Map<string, string[]>()
  for (const [replaced, standIn] of insteadOf) {
    predecessorsOf.set(standIn, [...(predecessorsOf.get(standIn) ?? []), replaced])
  }
  const behindAll = JSON.stringify([...insteadOf.keys()])
  const eligible = (ids: Iterable<string>): Set<string> => {
    const seen = visible(ids)
    for (const id of seen) if (insteadOf.has(id)) seen.delete(id)
    return seen
  }

  const newestFirst = db.prepare(
    `SELECT ps.id AS id FROM provider_session ps
      WHERE ps.id IN (SELECT value FROM json_each(@ids))
      ORDER BY ps.updated_at DESC, ps.id DESC`,
  )
  const ordered = (ids: Iterable<string>): string[] =>
    (newestFirst.all({ ids: JSON.stringify([...ids]) }) as { id: string }[]).map((row) => row.id)

  /** Every conversation the given ones descend from, at its place, that is in a reading. */
  const ancestorsUp = db.prepare(
    `WITH RECURSIVE up(id) AS (
       SELECT parent_session_id FROM provider_session
        WHERE id IN (SELECT value FROM json_each(@seeds)) AND parent_session_id IS NOT NULL
       UNION
       SELECT ps.parent_session_id FROM provider_session ps JOIN up ON ps.id = up.id
        WHERE ps.parent_session_id IS NOT NULL
     )
     SELECT id FROM up`,
  )
  const below = db.prepare(
    `WITH RECURSIVE down(id) AS (
       SELECT value FROM json_each(@seeds)
       UNION
       SELECT ps.id FROM provider_session ps JOIN down ON ps.parent_session_id = down.id
     )
     SELECT id FROM down`,
  )
  // A walk follows the recorded parents, so a stand-in's line and each of its predecessors' lines
  // are walked alike: the conversations a replaced one started hang on its stand-in, and only its
  // own line reaches them. Each conversation reached is taken at its place.
  const closure = (
    walk: ReturnType<AppDatabase['prepare']>,
    from: Iterable<string>,
    have: ReadonlySet<string>,
  ): Set<string> => {
    const found = new Set<string>()
    const walked = new Set<string>()
    const routesOf = (ids: Iterable<string>): string[] =>
      [...ids]
        .flatMap((id) => [id, ...(predecessorsOf.get(id) ?? [])])
        .filter((id) => !walked.has(id))
    let seeds = routesOf(from)
    while (seeds.length > 0) {
      for (const id of seeds) walked.add(id)
      const reached = (walk.all({ seeds: JSON.stringify(seeds) }) as { id: string }[]).map((row) =>
        place(row.id),
      )
      const fresh = eligible(reached.filter((id) => !have.has(id) && !found.has(id)))
      for (const id of fresh) found.add(id)
      seeds = routesOf(fresh)
    }
    return found
  }
  const behindOf = (drawn: ReadonlySet<string>): string[] =>
    ordered(
      [...visible(insteadOf.keys())].filter((replaced) => drawn.has(insteadOf.get(replaced)!)),
    )

  if (asked.scope.is === 'the-tree-of') {
    const parentOf = db.prepare(
      `SELECT parent_session_id AS parent FROM provider_session WHERE id = ?`,
    )
    let route = asked.scope.conversation
    let at = place(route)
    if (!eligible([at]).has(at)) {
      return { counts: null, root: null, total: 0, admitted: [], context: [], behind: [] }
    }
    // Up the recorded parents to the top, one step at a time, so a hand-made loop ends where it
    // closes. A parent that is the stand-in's own predecessor is the same place, and is climbed past.
    const climbed = new Set([route])
    for (;;) {
      const parent = (parentOf.get(route) as { parent: string | null } | undefined)?.parent ?? null
      if (parent === null || climbed.has(parent)) break
      const next = place(parent)
      if (next !== at && !eligible([next]).has(next)) break
      climbed.add(parent)
      route = parent
      at = next
    }
    const tree = closure(below, [at], new Set())
    tree.add(at)
    const admitted = ordered(tree)
    return {
      counts: null,
      root: at,
      total: admitted.length,
      admitted,
      context: [],
      behind: behindOf(tree),
    }
  }

  const running = JSON.stringify(asked.running)
  const cutoff = (span: number): number => asked.measuredFrom - span
  const counted = db
    .prepare(
      `SELECT count(*) AS everything,
              coalesce(sum(ps.updated_at >= @week), 0) AS week,
              coalesce(sum(ps.updated_at >= @day), 0) AS day,
              coalesce(sum(ps.updated_at >= @hour), 0) AS hour,
              coalesce(sum(ps.id IN (SELECT value FROM json_each(@running))), 0) AS active
         FROM ${PLACED}
        WHERE ${VISIBLE} AND ${NOT_BEHIND}`,
    )
    .get({
      hidden,
      behind: behindAll,
      running,
      week: cutoff(FOREST_WINDOW_SPAN_MS.week),
      day: cutoff(FOREST_WINDOW_SPAN_MS.day),
      hour: cutoff(FOREST_WINDOW_SPAN_MS.hour),
    }) as { everything: number; week: number; day: number; hour: number; active: number }
  const counts: ForestCounts = {
    active: counted.active,
    hour: counted.hour,
    day: counted.day,
    week: counted.week,
    all: counted.everything,
  }
  const window = asked.scope.window
  const total = counts[window]
  const limit = window === 'all' ? ALL_ADMITS_NEWEST : total
  const admitted = (
    db
      .prepare(
        `SELECT ps.id AS id FROM ${PLACED}
          WHERE ${VISIBLE} AND ${NOT_BEHIND}
            AND (@running IS NULL OR ps.id IN (SELECT value FROM json_each(@running)))
            AND (@from IS NULL OR ps.updated_at >= @from)
          ORDER BY ps.updated_at DESC, ps.id DESC
          LIMIT @limit`,
      )
      .all({
        hidden,
        behind: behindAll,
        running: window === 'active' ? running : null,
        from:
          window === 'active' || window === 'all' ? null : cutoff(FOREST_WINDOW_SPAN_MS[window]),
        limit,
      }) as { id: string }[]
  ).map((row) => row.id)
  const members = new Set(admitted)
  const context = closure(ancestorsUp, admitted, members)
  const drawn = new Set([...members, ...context])
  return {
    counts,
    root: null,
    total,
    admitted,
    context: ordered(context),
    behind: behindOf(drawn),
  }
}

/** A reading's first answer: its conversations and the first page of their nodes. */
export interface ForestFirstRead {
  readonly listing: ForestListing
  readonly nodes: LedgerWalk<ForestedNode>
  /** The listed conversations whose nodes are still to be read, in the order to ask. */
  readonly unfolded: readonly string[]
  readonly heldByNoAgent: number
}

/**
 * Every conversation a listing names, in the order its nodes are read: a tree's root first, then
 * the replaced and the connecting ancestors, then the members newest first.
 */
export function listedInOrder(listing: ForestListing): string[] {
  const root = listing.root === null ? [] : [listing.root]
  return [
    ...root,
    ...listing.behind,
    ...listing.context,
    ...listing.admitted.filter((id) => id !== listing.root),
  ]
}

/** Lists a reading and reads the nodes of its first {@link FOREST_PAGE} conversations. */
export function readTheForestFirst(
  store: Pick<SessionStore, 'forestListing' | 'forestNodesOf' | 'conversationsHeldByNoAgent'>,
  asked: ForestListingAsked,
): ForestFirstRead {
  const listing = store.forestListing(asked)
  const listed = listedInOrder(listing)
  const first = listed.slice(0, FOREST_PAGE)
  return {
    listing,
    // Read in the same snapshot as the listing, so none of the first page is gone.
    nodes: store.forestNodesOf(first, new Set(listed), asked.hidden).nodes,
    unfolded: listed.slice(FOREST_PAGE),
    heldByNoAgent: store.conversationsHeldByNoAgent(),
  }
}
