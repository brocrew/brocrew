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
  /** Main's publication sequence when this value was composed. */
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

export function acceptAnswer<V>(
  state: ScopeState<V>,
  _seq: number,
  _complete: boolean,
  _entries: ReadonlyMap<string, V>,
): ScopeState<V> {
  return state
}

export function acceptPush<V>(
  state: ScopeState<V>,
  _seq: number,
  _entries: ReadonlyMap<string, V>,
): ScopeState<V> {
  return state
}

export function acceptError<V>(
  state: ScopeState<V>,
  _seq: number,
  _message: string,
): ScopeState<V> {
  return state
}

export type EpochDecision = 'hold' | 'accept' | 'drop' | 'advance'

export function epochDecision(
  _current: PublicationEpoch | null,
  _incoming: PublicationEpoch,
): EpochDecision {
  return 'accept'
}

export function scopeAfterAdvance<V>(
  state: ScopeState<V>,
  _incoming: PublicationEpoch,
): ScopeState<V> {
  return state
}

export function settleStash<V>(
  stash: ReadonlyMap<string, Held<V>>,
  _seq: number,
  _holds: (id: string) => boolean,
): {
  readonly kept: ReadonlyMap<string, Held<V>>
  readonly promoted: ReadonlyMap<string, Held<V>>
} {
  return { kept: stash, promoted: new Map() }
}

export function newerOf<V>(a: Held<V> | undefined, _b: Held<V> | undefined): Held<V> | undefined {
  return a
}
