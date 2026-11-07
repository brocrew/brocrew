/**
 * The version every main-to-window publication carries, and the pure rules a window uses to accept
 * it. Main stamps each answer and push with the publication sequence at the moment its value was
 * composed; a window keeps, per population and scope, the stamp of each row it holds and the stamp
 * of its last complete answer, and accepts only what is newer. Cache validity in main never uses
 * these stamps.
 */

/** One main process's publisher: `run` per process, `n` per workspace switch or full resync. */
export interface PublicationEpoch {
  readonly run: string
  readonly n: number
  /** Why `n` moved: another workspace clears what a window holds; a resync keeps it as stale. */
  readonly reason?: 'workspace' | 'resync'
}

export type Population =
  'listing' | 'states' | 'waits' | 'forest' | 'persons' | 'roster' | 'files' | 'cast'

export type Coverage =
  | { readonly population: Population; readonly scope?: string; readonly complete: true }
  | {
      readonly population: Population
      readonly scope?: string
      readonly complete: false
      readonly ids: readonly string[]
    }

export interface Published {
  readonly epoch: PublicationEpoch
  /**
   * Main's publication sequence when this value was composed. It only rises within a run, across
   * epochs too, and main advances it at every resync before any answer of the new epoch, so that
   * answer is newer than everything a stale scope still holds.
   */
  readonly seq: number
  readonly covers: Coverage
}

export interface Held<V> {
  readonly seq: number
  readonly value: V
}

/** What a window holds for one population and scope. */
export interface ScopeState<V> {
  /** The stamp of the last accepted complete answer, or -1. */
  readonly watermark: number
  readonly rows: ReadonlyMap<string, Held<V>>
  /** The stamp of the last accepted answer, complete or partial, or -1. */
  readonly lastValid: number
  readonly error: { readonly seq: number; readonly message: string } | null
  /** Kept from an earlier epoch of the same workspace until a complete answer lands. */
  readonly stale: boolean
}

export function emptyScope<V>(): ScopeState<V> {
  return { watermark: -1, rows: new Map(), lastValid: -1, error: null, stale: false }
}

/** The same rows, kept but no longer current, after a resync epoch. */
export function markStale<V>(state: ScopeState<V>): ScopeState<V> {
  return { ...state, stale: true }
}

function clearedError<V>(state: ScopeState<V>, seq: number): ScopeState<V>['error'] {
  return state.error !== null && seq >= state.error.seq ? null : state.error
}

/**
 * A read's answer at `seq`. A complete answer older than or equal to the watermark is ignored as a
 * whole, so it can never bring back what a newer complete answer removed. A complete answer removes
 * only rows older than itself; a partial one never removes anything.
 */
export function acceptAnswer<V>(
  state: ScopeState<V>,
  seq: number,
  complete: boolean,
  entries: ReadonlyMap<string, V>,
): ScopeState<V> {
  if (complete && seq <= state.watermark) return state
  let rows: Map<string, Held<V>> | null = null
  const changed = () => (rows ??= new Map(state.rows))
  if (complete) {
    for (const [id, held] of state.rows) {
      if (!entries.has(id) && held.seq < seq) changed().delete(id)
    }
  }
  for (const [id, value] of entries) {
    const held = state.rows.get(id)
    const applies = held === undefined ? seq > state.watermark : seq >= held.seq
    if (applies && (held === undefined || held.seq !== seq || held.value !== value))
      changed().set(id, { seq, value })
  }
  const watermark = complete ? seq : state.watermark
  const lastValid = Math.max(state.lastValid, seq)
  const error = clearedError(state, seq)
  const stale = complete ? false : state.stale
  if (
    rows === null &&
    watermark === state.watermark &&
    lastValid === state.lastValid &&
    error === state.error &&
    stale === state.stale
  )
    return state
  return { watermark, rows: rows ?? state.rows, lastValid, error, stale }
}

/** A push at `seq` for the rows it names; it never removes, and never revives below the watermark. */
export function acceptPush<V>(
  state: ScopeState<V>,
  seq: number,
  entries: ReadonlyMap<string, V>,
): ScopeState<V> {
  let rows: Map<string, Held<V>> | null = null
  for (const [id, value] of entries) {
    const held = state.rows.get(id)
    const applies = held === undefined ? seq > state.watermark : seq > held.seq
    if (!applies) continue
    rows ??= new Map(state.rows)
    rows.set(id, { seq, value })
  }
  return rows === null ? state : { ...state, rows }
}

/** A failed read at `seq`: it marks the scope unavailable only if nothing newer has answered. */
export function acceptError<V>(state: ScopeState<V>, seq: number, message: string): ScopeState<V> {
  if (seq <= state.lastValid) return state
  if (state.error !== null && seq <= state.error.seq) return state
  return { ...state, error: { seq, message } }
}

export type EpochDecision = 'hold' | 'accept' | 'drop' | 'advance'

/**
 * Whether a message from `incoming` may be applied while `current` is the publisher a handshake
 * named. Before the handshake answers, messages are held. Another run is never adopted by arrival.
 */
export function epochDecision(
  current: PublicationEpoch | null,
  incoming: PublicationEpoch,
): EpochDecision {
  if (current === null) return 'hold'
  if (incoming.run !== current.run || incoming.n < current.n) return 'drop'
  return incoming.n === current.n ? 'accept' : 'advance'
}

/** What a scope becomes when the epoch advances: cleared for another workspace, stale otherwise. */
export function scopeAfterAdvance<V>(
  state: ScopeState<V>,
  incoming: PublicationEpoch,
): ScopeState<V> {
  return incoming.reason === 'resync' ? markStale(state) : emptyScope<V>()
}

/**
 * State pushes for conversations the listing does not hold yet, after a complete listing answer at
 * `seq`: those it holds become rows, those older than it are dropped, and newer ones stay.
 */
export function settleStash<V>(
  stash: ReadonlyMap<string, Held<V>>,
  seq: number,
  holds: (id: string) => boolean,
): {
  readonly kept: ReadonlyMap<string, Held<V>>
  readonly promoted: ReadonlyMap<string, Held<V>>
} {
  const kept = new Map<string, Held<V>>()
  const promoted = new Map<string, Held<V>>()
  for (const [id, held] of stash) {
    if (holds(id)) promoted.set(id, held)
    else if (held.seq > seq) kept.set(id, held)
  }
  return { kept, promoted }
}

/** The newer of two stamped values for one field fed by two populations; the first wins a tie. */
export function newerOf<V>(a: Held<V> | undefined, b: Held<V> | undefined): Held<V> | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return b.seq > a.seq ? b : a
}
