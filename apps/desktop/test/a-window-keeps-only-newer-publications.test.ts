import { describe, expect, it } from 'vitest'
import {
  acceptAnswer,
  acceptError,
  acceptPush,
  emptyScope,
  epochDecision,
  newerOf,
  scopeAfterAdvance,
  settleStash,
  type Held,
  type ScopeState,
} from '../src/shared/data-version'

const rows = (entries: Record<string, string>) => new Map(Object.entries(entries))
const values = (state: ScopeState<string>) =>
  Object.fromEntries([...state.rows].map(([id, held]) => [id, held.value]))
const whole = (state: ScopeState<string>, seq: number, entries: Record<string, string>) =>
  acceptAnswer(state, seq, true, rows(entries))
const partial = (state: ScopeState<string>, seq: number, entries: Record<string, string>) =>
  acceptAnswer(state, seq, false, rows(entries))
const push = (state: ScopeState<string>, seq: number, entries: Record<string, string>) =>
  acceptPush(state, seq, rows(entries))
const start = () => emptyScope<string>()

describe('a window keeps only newer publications', () => {
  it('a newer push survives an older complete answer', () => {
    const state = whole(push(whole(start(), 10, { a: 'idle' }), 12, { a: 'working' }), 11, {
      a: 'idle',
    })
    expect(values(state)).toEqual({ a: 'working' })
  })

  it('an older push loses to a newer complete answer', () => {
    expect(values(push(whole(start(), 12, { a: 'idle' }), 11, { a: 'working' }))).toEqual({
      a: 'idle',
    })
  })

  it('a complete answer removes what it omits, and a late older write cannot bring it back', () => {
    let state = whole(start(), 10, { x: 'one', y: 'two' })
    state = whole(state, 14, { y: 'two' })
    expect(values(state)).toEqual({ y: 'two' })
    expect(values(push(state, 13, { x: 'one' }))).toEqual({ y: 'two' })
    expect(values(partial(state, 13, { x: 'one' }))).toEqual({ y: 'two' })
    expect(values(push(state, 15, { x: 'back' }))).toEqual({ x: 'back', y: 'two' })
  })

  it('a capped answer removes nothing and leaves the watermark where it was', () => {
    let state = whole(start(), 10, { a: '1', b: '2' })
    state = partial(state, 12, { a: '1b' })
    expect(values(state)).toEqual({ a: '1b', b: '2' })
    expect(state.watermark).toBe(10)
  })

  it('each scope keeps its own watermark', () => {
    const one = whole(start(), 20, { a: '1' })
    const two = whole(start(), 5, { b: '2' })
    expect(values(push(two, 6, { c: '3' }))).toEqual({ b: '2', c: '3' })
    expect(values(push(one, 6, { c: '3' }))).toEqual({ a: '1' })
  })

  it('an error leaves the rows and the watermark alone, and a later answer clears it', () => {
    let state = whole(start(), 10, { a: '1' })
    state = acceptError(state, 11, 'could not read')
    expect(state.error?.seq).toBe(11)
    expect(values(state)).toEqual({ a: '1' })
    expect(state.watermark).toBe(10)
    state = whole(state, 12, { a: '2' })
    expect(state.error).toBeNull()
    expect(values(state)).toEqual({ a: '2' })
  })

  it('an error does not undo a newer push', () => {
    const state = acceptError(push(whole(start(), 10, { a: '1' }), 13, { a: '2' }), 12, 'failed')
    expect(values(state)).toEqual({ a: '2' })
  })

  it('an answer that observed a later value keeps it: an older push and a failed reread change nothing', () => {
    let state = whole(start(), 12, { x: 'C' })
    state = push(state, 11, { x: 'B' })
    state = acceptError(state, 12, 'the reread failed')
    state = partial(state, 12, { other: 'z' })
    expect(state.rows.get('x')?.value).toBe('C')
  })

  it('another run never resets what a window holds, and a lower n is late', () => {
    const b = { run: 'B', n: 1 }
    expect(epochDecision(null, b)).toBe('hold')
    expect(epochDecision(b, { run: 'A', n: 5 })).toBe('drop')
    expect(epochDecision(b, { run: 'B', n: 0 })).toBe('drop')
    expect(epochDecision(b, { run: 'B', n: 1 })).toBe('accept')
    expect(epochDecision(b, { run: 'B', n: 2, reason: 'resync' })).toBe('advance')
  })

  it('the listing owns membership: a state for a conversation it does not hold waits, then joins or goes', () => {
    const stash = new Map<string, Held<string>>([
      ['old', { seq: 9, value: 'idle' }],
      ['racing', { seq: 15, value: 'working' }],
      ['listed', { seq: 12, value: 'working' }],
    ])
    const { kept, promoted } = settleStash(stash, 14, (id) => id === 'listed')
    expect([...promoted.keys()]).toEqual(['listed'])
    expect([...kept.keys()]).toEqual(['racing'])
    expect(newerOf({ seq: 14, value: 'idle' }, promoted.get('listed'))?.value).toBe('idle')
    expect(newerOf({ seq: 11, value: 'idle' }, promoted.get('listed'))?.value).toBe('working')
  })

  it('a late error does not overrule a fresher answer', () => {
    const state = acceptError(whole(start(), 14, { a: '1' }), 13, 'late')
    expect(state.error).toBeNull()
  })

  it('a workspace switch clears what a window holds; a resync keeps it as stale until a complete answer', () => {
    const held = whole(start(), 10, { a: '1' })
    const other = scopeAfterAdvance(held, { run: 'B', n: 2, reason: 'workspace' })
    expect(other.rows.size).toBe(0)
    expect(other.watermark).toBe(-1)
    const kept = scopeAfterAdvance(held, { run: 'B', n: 2, reason: 'resync' })
    expect(values(kept)).toEqual({ a: '1' })
    expect(kept.stale).toBe(true)
    expect(partial(kept, 11, { a: '2' }).stale).toBe(true)
    expect(whole(kept, 11, { a: '2' }).stale).toBe(false)
  })

  it('a complete answer keeps what was created after it', () => {
    const state = whole(push(whole(start(), 10, {}), 17, { x: 'new' }), 16, {})
    expect(values(state)).toEqual({ x: 'new' })
  })

  it('an older complete answer is ignored as a whole, so it cannot revive what a newer one removed', () => {
    let state = whole(start(), 10, { x: '1', y: '2' })
    state = whole(state, 15, { y: '2' })
    expect(values(whole(state, 14, { x: '1', y: '2' }))).toEqual({ y: '2' })
    expect(whole(state, 14, { y: 'older' }).rows.get('y')?.value).toBe('2')
  })

  it('a partial answer missing a row, then a lower push, removes nothing and follows the row rule', () => {
    let state = whole(start(), 10, { a: '1', b: '2' })
    state = partial(state, 12, { a: '3' })
    state = push(state, 11, { a: 'older', b: 'newer' })
    expect(values(state)).toEqual({ a: '3', b: 'newer' })
  })

  it('a push held above three answers stays: push 18, whole 16, whole 17', () => {
    let state = whole(start(), 10, {})
    state = push(state, 18, { x: 'pushed' })
    state = whole(state, 16, {})
    state = whole(state, 17, {})
    expect(values(state)).toEqual({ x: 'pushed' })
  })

  it('errors are ordered among themselves and against answers', () => {
    let state = acceptError(start(), 20, 'first')
    state = partial(state, 19, { a: '1' })
    expect(state.error?.seq).toBe(20)
    expect(acceptError(state, 19, 'older').error?.message).toBe('first')
    expect(partial(state, 20, { a: '2' }).error).toBeNull()
  })

  it('after a resync, the first complete answer of the new epoch is newer than what the stale scope holds', () => {
    const held = whole(start(), 10, { a: '1' })
    const kept = scopeAfterAdvance(held, { run: 'B', n: 2, reason: 'resync' })
    expect(whole(kept, 10, { a: '2' })).toBe(kept)
    const fresh = whole(kept, 11, { a: '2' })
    expect(values(fresh)).toEqual({ a: '2' })
    expect(fresh.stale).toBe(false)
  })

  it('an answer that changes nothing returns the same state', () => {
    const value = 'idle'
    const once = acceptAnswer(start(), 10, false, new Map([['a', value]]))
    expect(acceptAnswer(once, 10, false, new Map([['a', value]]))).toBe(once)
    expect(acceptAnswer(once, 9, false, new Map([['a', 'older']]))).not.toBe(start())
    expect(acceptAnswer(once, 9, false, new Map([['a', 'older']])).rows).toBe(once.rows)
  })
})
