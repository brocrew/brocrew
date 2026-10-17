import { describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent, SessionRef } from '../src/index'
import { runtimeEventSchema } from '../src/index'
import { FakeRuntime } from '../src/fake-runtime'
import { SessionMachine } from '../src/internal/session-machine'

/**
 * # 🔴 720 · R71 — a stop the APP forces records its word as the app's act
 *
 * ⚑ **The ruling, verbatim** (`709` F-1): *"A stop the APP forces (`forceEnd` on a Stop or a Close)
 * records its word as the app's act, never as the provider's."*
 *
 * ⛔ **What it replaces.** Since `709` (R43) a `turn` row is the PROVIDER's word — except for three
 * endings this machine writes where no provider has spoken: `forceEnd` (Claude's Stop after its
 * receipt, every Close), `failTurn` (a turn we could not start) and a fatal error. ⚠️ All three
 * went into the ledger as the same bare `{type:'turn', state}` a provider's own word takes, so no
 * reader could tell *Claude said it stopped* from *we stopped listening*. `709` measured the first
 * case on a live Claude Stop: the receipt beats the result, so the recorded word is the app's.
 *
 * ⚑ **The carrier is `wordOf: 'this-app'`** on the turn event — present on the machine's own three
 * endings, absent on every word a provider said. ⚠️ Absent also means *a row written before 720*:
 * nothing is backfilled (`HO-029` §2.2).
 *
 * | § | where | what |
 * |---|---|---|
 * | 1 | the machine | its three endings carry the mark; `completeTurn` never does |
 * | 2 | the schema | the mark survives the parse every wire crossing takes |
 * | 3 | the Fake | a Close is the app's word; a Stop of a live turn is the double's own |
 */

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

function aTurnIsOpen(): { m: SessionMachine; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = []
  const m = new SessionMachine((event) => events.push(event))
  m.markStarting()
  m.sessionStarted(REF, 'started')
  m.beginTurn()
  return { m, events }
}

const turns = (events: readonly RuntimeEvent[]): RuntimeEvent[] =>
  events.filter((event) => event.type === 'turn')

describe('720 · R71 §1 — the machine marks the endings it writes itself', () => {
  it('🔴 `forceEnd` (a Stop after its receipt, every Close) is the app’s word', () => {
    const { m, events } = aTurnIsOpen()
    m.forceEnd()
    expect(turns(events)).toEqual([{ type: 'turn', state: 'interrupted', wordOf: 'this-app' }])
  })

  it('🔴 …with no ask before it too — a Close asks nothing and still ends the turn', () => {
    const { m, events } = aTurnIsOpen()
    m.forceEnd(false)
    expect(turns(events)).toEqual([{ type: 'turn', state: 'interrupted', wordOf: 'this-app' }])
  })

  it('🔴 `failTurn` — a turn WE could not start — is the app’s word, whichever it says', () => {
    const unasked = aTurnIsOpen()
    unasked.m.failTurn('turn/start refused')
    expect(turns(unasked.events)).toEqual([{ type: 'turn', state: 'failed', wordOf: 'this-app' }])
    const asked = aTurnIsOpen()
    asked.m.requestInterrupt()
    asked.m.failTurn('turn/start refused')
    expect(turns(asked.events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app' },
    ])
  })

  it('🔴 a fatal error’s terminal is the app’s word — the provider said nothing, it died', () => {
    const plain = aTurnIsOpen()
    plain.m.fatalError('the provider process exited')
    expect(turns(plain.events)).toEqual([{ type: 'turn', state: 'failed', wordOf: 'this-app' }])
    // ⚑ R71's first clause: a Cancel latched, then the stream died — `interrupted`, and still ours.
    const cancelled = aTurnIsOpen()
    cancelled.m.requestInterrupt()
    cancelled.m.fatalAfterReportedError()
    expect(turns(cancelled.events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app' },
    ])
  })

  it.each(['completed', 'failed', 'interrupted'] as const)(
    '⚑ CONTROL · the provider’s own `%s` carries no mark — asked or not',
    (word) => {
      for (const ask of [false, true]) {
        const { m, events } = aTurnIsOpen()
        if (ask) m.requestInterrupt()
        m.completeTurn(word, 'turn failed: boom')
        const [turn] = turns(events)
        expect(turn).toMatchObject({ type: 'turn', state: word })
        expect(turn).not.toHaveProperty('wordOf')
      }
    },
  )
})

describe('720 · R71 §2 — the mark survives the parse every wire crossing takes', () => {
  it('🔴 `runtimeEventSchema` keeps `wordOf` — the schema is not strict, so an undeclared key is DROPPED', () => {
    const forced = { type: 'turn', state: 'interrupted', wordOf: 'this-app' }
    expect(runtimeEventSchema.parse(forced)).toEqual(forced)
  })

  it('⚑ …and the parse still strips a key the schema does not name, on the same event', () => {
    const planted = { type: 'turn', state: 'interrupted', wordOf: 'this-app', notAField: 1 }
    expect(runtimeEventSchema.parse(planted)).toEqual({
      type: 'turn',
      state: 'interrupted',
      wordOf: 'this-app',
    })
  })

  it('⚑ …and a mark naming anyone else is refused rather than carried', () => {
    expect(
      runtimeEventSchema.safeParse({ type: 'turn', state: 'interrupted', wordOf: 'the-provider' })
        .success,
    ).toBe(false)
  })
})

describe('720 · R71 §3 — through a runtime', () => {
  async function aFakeTurn(): Promise<{
    handle: Awaited<ReturnType<FakeRuntime['start']>>
    events: RuntimeEvent[]
    pump: Promise<void>
  }> {
    const handle = await new FakeRuntime().start({ cwd: '/tmp/x', providerHome: '/tmp/x-home' })
    const events: RuntimeEvent[] = []
    const pump = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    await handle.send('hello')
    // ⚑ The Fake holds its turn open on a card — the live turn a Close has to end.
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
    return { handle, events, pump }
  }

  it('🔴 a Close mid-turn is the app’s word', async () => {
    const { handle, events, pump } = await aFakeTurn()
    await handle.close()
    await pump
    expect(turns(events)).toEqual([{ type: 'turn', state: 'interrupted', wordOf: 'this-app' }])
  })
})
