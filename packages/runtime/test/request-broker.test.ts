import { describe, expect, it } from 'vitest'
import { RequestBroker } from '../src/internal/request-broker'

/**
 * Focused tests for the atomic `reserve()` slot (023 P1-B). Reserve-before-publish
 * is the confused-deputy fix: only the FIRST caller for an id takes the resolver
 * slot; a duplicate is rejected WITHOUT displacing it, so the adapter can withhold
 * a second (cross-authorizing) card.
 */

const make = () =>
  new RequestBroker<string>(
    () => false,
    () => 'SAFE',
  )

describe('RequestBroker.reserve (023 P1-B)', () => {
  it('accepts the first reservation and rejects a duplicate without displacing it', async () => {
    const b = make()
    const first = b.reserve('x')
    expect(first.accepted).toBe(true)

    const dup = b.reserve('x')
    expect(dup.accepted).toBe(false)
    await expect(dup.response).resolves.toBe('SAFE') // duplicate → safe-reject, took no slot

    // respond() resolves the FIRST reservation, proving the duplicate never took the slot.
    expect(b.respond('x', 'WINNER')).toBe(true)
    await expect(first.response).resolves.toBe('WINNER')
  })

  it('rejects a reservation for an already-answered id', async () => {
    const b = make()
    const r = b.reserve('x')
    expect(b.respond('x', 'done')).toBe(true)
    await r.response

    const again = b.reserve('x')
    expect(again.accepted).toBe(false)
    await expect(again.response).resolves.toBe('SAFE')
  })

  it('rejects (no card path) when the session is closing', async () => {
    const b = new RequestBroker<string>(
      () => true,
      () => 'SAFE',
    )
    const r = b.reserve('x')
    expect(r.accepted).toBe(false)
    await expect(r.response).resolves.toBe('SAFE')
  })

  it('settles a reservation when its abort signal fires', async () => {
    const b = make()
    const ctl = new AbortController()
    const r = b.reserve('x', ctl.signal)
    expect(r.accepted).toBe(true)
    ctl.abort()
    await expect(r.response).resolves.toBe('SAFE')
  })

  it('REFUSES a reservation whose signal is ALREADY aborted — no card, nothing pending (044 P2 #2)', async () => {
    // Pre-fix this installed a resolver, immediately force-rejected it, and still said
    // `accepted:true` — so the caller published a card for a request the provider had already
    // been safely refused. A dead card the UI can never answer.
    const b = make()
    const ctl = new AbortController()
    ctl.abort() // aborted BEFORE we reserve
    const r = b.reserve('x', ctl.signal)

    expect(r.accepted).toBe(false)
    await expect(r.response).resolves.toBe('SAFE')
    expect(b.pendingCount).toBe(0) // no resolver was ever installed
  })

  it('a refused pre-aborted reservation does not burn the id — a live one can still be made', async () => {
    // Nothing was ever pending or answered, so the id is untouched: a genuine later request with
    // the same id must still be reservable (the guard must not double as a tombstone).
    const b = make()
    const aborted = new AbortController()
    aborted.abort()
    expect(b.reserve('x', aborted.signal).accepted).toBe(false)

    const live = b.reserve('x', new AbortController().signal)
    expect(live.accepted).toBe(true)
    expect(b.pendingCount).toBe(1)
    expect(b.respond('x', 'ANSWERED')).toBe(true)
    await expect(live.response).resolves.toBe('ANSWERED')
  })

  it('register() still returns just the response (back-compat for the Fake)', async () => {
    const b = make()
    const p = b.register('x')
    expect(b.respond('x', 'v')).toBe(true)
    await expect(p).resolves.toBe('v')
  })
})

describe('a request its own signal settles is reported withdrawn, and no other', () => {
  const withdrawing = () => {
    const withdrawn: string[] = []
    const broker = new RequestBroker<string>(
      () => false,
      () => 'SAFE',
      (id) => withdrawn.push(id),
    )
    return { broker, withdrawn }
  }

  it('reports a request whose signal aborts while it waits, once', async () => {
    const { broker, withdrawn } = withdrawing()
    const ctl = new AbortController()
    const r = broker.reserve('x', ctl.signal)
    ctl.abort()
    await expect(r.response).resolves.toBe('SAFE')
    expect(withdrawn).toEqual(['x'])
    expect(broker.respond('x', 'late')).toBe(false)
    expect(withdrawn).toEqual(['x'])
  })

  it('does not report a request an answer settled before its signal aborted', async () => {
    const { broker, withdrawn } = withdrawing()
    const ctl = new AbortController()
    const r = broker.reserve('x', ctl.signal)
    expect(broker.respond('x', 'answer')).toBe(true)
    ctl.abort()
    await expect(r.response).resolves.toBe('answer')
    expect(withdrawn).toEqual([])
  })

  it('does not report requests settleAll settled before their signals aborted', async () => {
    const { broker, withdrawn } = withdrawing()
    const one = new AbortController()
    const two = new AbortController()
    broker.reserve('x', one.signal)
    broker.reserve('y', two.signal)
    broker.settleAll()
    one.abort()
    two.abort()
    expect(withdrawn).toEqual([])
  })

  it.each(['an answer', 'settleAll'] as const)(
    'a late abort of a request %s settled leaves a later request reusing its id to its own signal',
    async (settledBy) => {
      const { broker, withdrawn } = withdrawing()
      const old = new AbortController()
      broker.reserve('x', old.signal)
      if (settledBy === 'an answer') expect(broker.respond('x', 'answer')).toBe(true)
      else broker.settleAll()
      expect(broker.retireSettled()).toEqual(['x'])
      const now = new AbortController()
      const later = broker.reserve('x', now.signal)
      expect(later.accepted).toBe(true)

      old.abort()
      expect(withdrawn).toEqual([])
      expect(broker.has('x')).toBe(true)

      now.abort()
      await expect(later.response).resolves.toBe('SAFE')
      expect(withdrawn).toEqual(['x'])
      expect(broker.respond('x', 'late')).toBe(false)
    },
  )

  it('a later request reusing an id is still answerable after the earlier signal aborts', async () => {
    const { broker, withdrawn } = withdrawing()
    const old = new AbortController()
    broker.reserve('x', old.signal)
    broker.respond('x', 'answer')
    broker.retireSettled()
    const later = broker.reserve('x', new AbortController().signal)
    old.abort()
    expect(broker.respond('x', 'second answer')).toBe(true)
    await expect(later.response).resolves.toBe('second answer')
    expect(withdrawn).toEqual([])
  })

  it('does not report a request refused because its signal had already aborted', () => {
    const { broker, withdrawn } = withdrawing()
    const ctl = new AbortController()
    ctl.abort()
    expect(broker.reserve('x', ctl.signal).accepted).toBe(false)
    expect(withdrawn).toEqual([])
  })
})

describe('RequestBroker.retireSettled — lifecycle-bounded tombstones (044 P2 #7)', () => {
  it('retires answered tombstones and reports them, so `answered` stops growing for the session', () => {
    const b = make()
    for (const id of ['a', 'b', 'c']) {
      b.reserve(id)
      expect(b.respond(id, 'v')).toBe(true)
    }
    expect(b.answeredCount).toBe(3)

    // The caller gets the retired ids so a stronger barrier (the Codex numeric floor) can absorb them.
    expect(b.retireSettled().sort()).toEqual(['a', 'b', 'c'])
    expect(b.answeredCount).toBe(0)
  })

  it('SAFETY: a late/duplicate answer for a RETIRED id is still a refusal, never an authorization', () => {
    // The invariant that makes pruning safe: `respond` consults only `pending`, and a tombstoned
    // id had its resolver TAKEN AND DELETED before it was tombstoned. Retiring the tombstone
    // therefore cannot reopen anything — the id is unreachable because its resolver is gone.
    const b = make()
    b.reserve('x')
    expect(b.respond('x', 'FIRST')).toBe(true)
    b.retireSettled()

    expect(b.respond('x', 'LATE')).toBe(false)
    expect(b.respond('x', 'LATE AGAIN')).toBe(false)
    expect(b.pendingCount).toBe(0)
  })

  it('never retires a STILL-PENDING request — a live card cannot be orphaned mid-flight', async () => {
    const b = make()
    const live = b.reserve('live')
    b.reserve('done')
    b.respond('done', 'v')

    expect(b.retireSettled()).toEqual(['done']) // only the settled one
    expect(b.pendingCount).toBe(1)
    // The live request is untouched: still reserved (no second card) and still answerable exactly once.
    expect(b.reserve('live').accepted).toBe(false)
    expect(b.respond('live', 'ANSWERED')).toBe(true)
    await expect(live.response).resolves.toBe('ANSWERED')
  })

  it('a settleAll()-settled request is tombstoned and then retired like any other', () => {
    const b = make()
    b.reserve('x')
    b.settleAll() // safe-rejected on interrupt/close
    expect(b.answeredCount).toBe(1)
    expect(b.retireSettled()).toEqual(['x'])
    expect(b.respond('x', 'LATE')).toBe(false) // still a refusal
  })

  it('documents the consequence: after retirement an id is reservable again (the adapter-level floor is what refuses it)', () => {
    // Pinned deliberately. The broker alone cannot refuse a replayed id once its tombstone is
    // retired — the Codex adapter keeps an O(1) monotonic numeric floor for exactly that, and it
    // gates `onServerRequest` BEFORE the broker is consulted. Stated here so a future change to
    // either half is a conscious one rather than a silent weakening.
    const b = make()
    b.reserve('x')
    b.respond('x', 'v')
    expect(b.reserve('x').accepted).toBe(false) // before retirement: refused
    b.retireSettled()
    expect(b.reserve('x').accepted).toBe(true) // after: the broker no longer knows it
  })
})
