import { type AgentToolHost } from './host'
import { LISTING_INPUT } from './catalog'

/**
 * **What `list_tasks` says when rows of its own record could not be read** (671 · R18).
 *
 * **The digest's `source-unreadable` sentence, pointed at this list** (`466`, `463` F3): a
 * COUNT, what it costs the reader, and that the cause is not recorded — `LedgerWalk.rowsUnread`'s
 * rule, *"a count of the rows it is unable to speak for, with the cause still unstated"*.
 * **It instructs nothing**: there is no act a model can take that repairs a torn row, so naming
 * one would be `402`'s defect — telling an agent to do something this app cannot honour.
 * `units` is not the word here: these are ledger ROWS, which is what the payload's
 * `rows_unread` counts.
 */
export const unreadRowsSentence = (count: number): string =>
  `${String(count)} ${count === 1 ? 'row' : 'rows'} of this app's record could not be read, so ` +
  'a piece of work may be missing from the lists above, or its state may be wrong. ' +
  'Nothing records why.'

/**
 * **676 · the same count, said by `list_questions`** — {@link unreadRowsSentence}'s shape and
 * rule, naming what THIS list could be short of. It instructs nothing, for that sentence's reason.
 */
export const unreadQuestionRowsSentence = (count: number): string =>
  `${String(count)} ${count === 1 ? 'row' : 'rows'} of this app's record could not be read, so ` +
  'a question may be missing from the list above, or its words may be absent. ' +
  'Nothing records why.'

/** **D-017 · R8** — `count` conversations whose whole record a read skipped, spelled once. */
const recordsOf = (count: number): string =>
  count === 1 ? "1 conversation's record" : `${String(count)} conversations' records`

/**
 * **D-017 · R8 — what a list of work says when it skipped whole records** — its own sentence
 * beside {@link unreadRowsSentence}, because a whole record is not one row.
 */
export const skippedRecordsSentence = (count: number): string =>
  `${recordsOf(count)} could not be read, so ` +
  'a piece of work may be missing from the lists above, or its state may be wrong. ' +
  'Nothing records why.'

/** **D-017 · R8 — the same, said by `list_questions`** — {@link unreadQuestionRowsSentence}'s. */
export const skippedQuestionRecordsSentence = (count: number): string =>
  `${recordsOf(count)} could not be read, so ` +
  'a question may be missing from the list above, or its words may be absent. ' +
  'Nothing records why.'

/** **D-017 · R8** — the sentence for skipped records, or nothing when none were skipped. */
export const whenSkipped = (count: number | undefined, say: (count: number) => string): string[] =>
  count === undefined || count === 0 ? [] : [say(count)]

/**
 * **What `list_tasks` and `list_questions` list.** Not told otherwise, what is open: what is over
 * is counted, and listed only when asked for — `ended`, or `all` — newest first and no more than a
 * limit. So an answer stays the size of the work in hand, however long the history behind it.
 */
const LISTINGS = LISTING_INPUT.members

type Listing = (typeof LISTINGS)[number]

/** How many ended rows a list returns unless the caller says, and the most it ever returns. */
export const ENDED_LISTED = 20

export const ENDED_LISTED_AT_MOST = 200

export const LIMIT_DESCRIBED = (what: string): string =>
  `How many ended ${what} to list at most, newest first — ${String(ENDED_LISTED)} unless you say, and never more than ${String(ENDED_LISTED_AT_MOST)}. The rest are counted.`

/** The listing a call asked for, or what is wrong with how it asked. */
export function theListingAsked(
  state: unknown,
  limit: unknown,
): { readonly listing: Listing; readonly limit: number } | { readonly problems: string[] } {
  const problems: string[] = []
  if (state !== undefined && !LISTINGS.some((one) => one === state)) {
    problems.push('state, when given, must be open, ended or all')
  }
  if (
    limit !== undefined &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > ENDED_LISTED_AT_MOST)
  ) {
    problems.push(
      `limit, when given, must be a whole number from 1 to ${String(ENDED_LISTED_AT_MOST)}`,
    )
  }
  if (problems.length > 0) return { problems }
  return {
    listing: (state as Listing | undefined) ?? 'open',
    limit: (limit as number | undefined) ?? ENDED_LISTED,
  }
}

/** How many rows go by each word, in the order the words are first met. */
export function countedBy<Row>(
  rows: readonly Row[],
  word: (row: Row) => string,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[word(row)] = (counts[word(row)] ?? 0) + 1
  return counts
}

/** Counts as a sentence says them, the largest first: `35 done, 2 withdrawn`. */
export const countsSaid = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .sort(([a, one], [b, other]) => other - one || a.localeCompare(b))
    .map(([word, count]) => `${String(count)} ${word}`)
    .join(', ')

/**
 * What a listing shows of rows that are open or over: the open ones whole (unless only the ended
 * ones were asked for), any `kept` beside them in every listing — over, and still this caller's to
 * read, so never cut by the limit — then the other ended ones newest first up to the limit, and the
 * rest only counted.
 */
export function listedOf<Row>(
  rows: readonly Row[],
  asked: { readonly listing: Listing; readonly limit: number },
  is: {
    readonly open: (row: Row) => boolean
    /** Over, and listed whole all the same. */
    readonly kept: (row: Row) => boolean
    readonly endedAt: (row: Row) => number | null
  },
): {
  readonly whole: readonly Row[]
  readonly ended: readonly Row[]
  readonly rest: readonly Row[]
} {
  const open = rows.filter(is.open)
  const kept = rows.filter((row) => !is.open(row) && is.kept(row))
  const keptOrOpen = new Set([...open, ...kept])
  const over = rows
    .filter((row) => !keptOrOpen.has(row))
    .sort((a, b) => (is.endedAt(b) ?? 0) - (is.endedAt(a) ?? 0))
  const ended = asked.listing === 'open' ? [] : over.slice(0, asked.limit)
  return {
    whole: asked.listing === 'ended' ? kept : [...open, ...kept],
    ended,
    rest: [...over.slice(ended.length), ...(asked.listing === 'ended' ? open : [])],
  }
}

/**
 * **F033 · what a line calls a conversation, about one piece** — its root, else its own piece on
 * that piece's chain ({@link AgentToolHost.nameByItsWorkUnder}); about none, what it is called now.
 */
export type WhatToCallItUnder = (conversation: string, about: string | null) => string

/**
 * **D-016 · commit 7 · R3 — each conversation named by the piece it owns, once per CALL** —
 * memoised as `list_tasks` memoised its askers' names (724): a line per row names one conversation
 * once, and the price is bounded by the rows the call returns. **F033 · by the piece the line is
 * about** — a message by the piece it was sent under, an ask to stop by the piece it stopped — once
 * per conversation and piece.
 */
export const namedByItsWorkOnce = (
  host: Pick<AgentToolHost, 'nameByItsWorkUnder'>,
): WhatToCallItUnder => {
  const names = new Map<string, string>()
  return (conversation, about) => {
    const key = `${conversation}\u0000${about ?? ''}`
    const known = names.get(key)
    if (known !== undefined) return known
    const name = host.nameByItsWorkUnder(conversation, about)
    names.set(key, name)
    return name
  }
}
