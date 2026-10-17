import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SessionRef } from '../src/index'
import { SessionMachine } from '../src/internal/session-machine'

/**
 * # 🔴 F080 — a wake's Stop, its refused login, and the message that joins it, in the machine
 *
 * `session-machine.test.ts` pins each ending of a burst, and of a turn that joined one, taken
 * alone. These are the crossings it does not reach:
 *
 *  - §1 · a Stop asked of a wake belongs to the message that joins it (`beginTurn` takes the
 *    latch): its fault, and its message that never left, end `interrupted` — and the latch is spent
 *    on that turn, never left for the next wake;
 *  - §2 · a refused login that ends a wake (F076) says so on the wake's own row, unless a Stop was
 *    asked first;
 *  - §3 · what opens no provider turn: the tail of a stopped turn, a session closing;
 *  - §4 · a result the adapter names as the open turn's ends it over a Stop's debt (the replacement
 *    `sendInterrupting` opens), where the machine's own guess would have absorbed it;
 *  - §5 · with no adapter attribution (Codex, the double), a turn that joined a wake still ends as
 *    the provider's — after the wake's own terminal is absorbed.
 */

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

function active() {
  const events: RuntimeEvent[] = []
  const m = new SessionMachine((event) => events.push(event))
  m.markStarting()
  m.sessionStarted(REF, 'started')
  return { m, events }
}

const turnRows = (events: readonly RuntimeEvent[]) => events.filter((e) => e.type === 'turn')
const providerTurns = (events: readonly RuntimeEvent[]) =>
  events.filter((e) => e.type === 'provider_turn').length
const lastStatus = (events: readonly RuntimeEvent[]) =>
  events.filter((e) => e.type === 'status').at(-1)

describe('§1 · a Stop asked of a wake is the Stop of the message that joins it', () => {
  it('🔴 the joined message never left: it ends `interrupted`, marked — the wake does not run on', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.requestInterrupt()
    m.beginTurn()
    m.failTurn('could not apply the queued settings: refused', { neverSent: true })
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
    ])
    expect(m.hasProviderWork, 'a stopped wake was resumed').toBe(false)
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'idle' })
  })

  it('⚑ the control — no Stop asked: the same message leaves the wake running, with its reason said', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    m.failTurn('could not apply the queued settings: refused', { neverSent: true })
    expect(turnRows(events)).toEqual([])
    expect(m.hasProviderWork).toBe(true)
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'working' })
  })

  it('🔴 a fault after the join ends it `interrupted`, marked — the Stop was asked of the same loop', () => {
    const asked = active()
    asked.m.noteProviderWork()
    asked.m.requestInterrupt()
    asked.m.beginTurn()
    asked.m.fatalError('the provider stream ended unexpectedly')
    expect(turnRows(asked.events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
    ])

    // ⚑ The control: nothing asked, the same fault is a failure.
    const notAsked = active()
    notAsked.m.noteProviderWork()
    notAsked.m.beginTurn()
    notAsked.m.fatalError('the provider stream ended unexpectedly')
    expect(turnRows(notAsked.events)).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app', startedBy: 'the-provider' },
    ])
  })

  it('⛔ the latch is spent on the turn that joined — the next wake a fault ends was asked nothing', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.requestInterrupt()
    m.beginTurn()
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    m.noteProviderWork()
    expect(providerTurns(events)).toBe(2)
    m.fatalError('the provider stream ended unexpectedly')
    expect(turnRows(events).map((e) => e.type === 'turn' && e.state)).toEqual([
      'completed',
      'failed',
    ])
  })

  it('⛔ …and spent by a Stop that ended the wake itself', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.requestInterrupt()
    m.forceEnd()
    // ⚑ The stopped wake's own terminal arrives and pays the debt the Stop left.
    m.completeTurn('interrupted')
    m.noteProviderWork()
    expect(providerTurns(events)).toBe(2)
    m.fatalError('the provider stream ended unexpectedly')
    expect(turnRows(events).map((e) => e.type === 'turn' && e.state)).toEqual([
      'interrupted',
      'failed',
    ])
  })

  it('⛔ a Stop asked with nothing running latches nothing', () => {
    const { m, events } = active()
    m.requestInterrupt()
    m.noteProviderWork()
    m.fatalError('the provider stream ended unexpectedly')
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app', startedBy: 'the-provider' },
    ])
  })
})

describe('§2 · a refused login that ends a wake (F076)', () => {
  it('🔴 the wake’s own row says so, and so does the session’s ending', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.fatalAfterReportedError({ loginRefused: true })
    expect(turnRows(events)).toEqual([
      {
        type: 'turn',
        state: 'failed',
        wordOf: 'this-app',
        startedBy: 'the-provider',
        loginRefused: true,
      },
    ])
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'errored', loginRefused: true })
  })

  it('⚑ a Stop asked first is the wake’s word: `interrupted`, and no login on the row', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.requestInterrupt()
    m.fatalAfterReportedError({ loginRefused: true })
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
    ])
    // ⚑ The session's ending still names the login: it is what ended the session.
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'errored', loginRefused: true })
  })

  it('🔴 a turn that joined a wake ends on the login as the provider’s turn', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    m.fatalAfterReportedError({ loginRefused: true })
    expect(turnRows(events)).toEqual([
      {
        type: 'turn',
        state: 'failed',
        wordOf: 'this-app',
        loginRefused: true,
        startedBy: 'the-provider',
      },
    ])
  })

  it('⚑ the control — an ordinary turn the login ends carries no mark', () => {
    const { m, events } = active()
    m.beginTurn()
    m.fatalAfterReportedError({ loginRefused: true })
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app', loginRefused: true },
    ])
  })
})

describe('§3 · what opens no turn of the provider’s', () => {
  it('⛔ the tail of a stopped turn is not a wake — until its terminal has come', () => {
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.noteProviderWork()
    expect(providerTurns(events), 'the stopped turn’s tail opened a provider turn').toBe(0)
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'idle' })
    // ⚑ Its own terminal pays the debt, silently…
    const before = events.length
    m.completeTurn('interrupted')
    expect(events.slice(before)).toEqual([])
    // ⚑ …and content after it IS the provider starting a turn by itself.
    m.noteProviderWork()
    expect(providerTurns(events)).toBe(1)
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'working' })
  })

  it('⛔ a session that is closing opens none', () => {
    const { m, events } = active()
    expect(m.beginClose()).toBe(true)
    m.noteProviderWork()
    expect(providerTurns(events)).toBe(0)
    expect(m.hasProviderWork).toBe(false)
  })
})

describe('§4 · the open turn’s own result ends it over a Stop’s debt', () => {
  it('🔴 named by the adapter: the replacement ends on it, unmarked', () => {
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    expect(m.hasActiveTurn).toBe(false)
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app' },
      { type: 'turn', state: 'completed' },
    ])
    expect(lastStatus(events)).toEqual({ type: 'status', state: 'idle' })
  })

  it('⚑ the control — unattributed, the machine’s guess absorbs it as the stopped turn’s', () => {
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.completeTurn('completed')
    expect(m.hasActiveTurn).toBe(true)
    expect(turnRows(events)).toHaveLength(1)
  })

  it('⛔ named as NOT the open turn’s, it pays the debt — and the next one that names none ends nothing', () => {
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.completeTurn('interrupted', undefined, undefined, 'not-the-open-turn')
    m.completeTurn('completed', undefined, undefined, 'not-the-open-turn')
    expect(m.hasActiveTurn).toBe(true)
    expect(turnRows(events)).toHaveLength(1)
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    expect(turnRows(events).at(-1)).toEqual({ type: 'turn', state: 'completed' })
  })
})

describe('§5 · unattributed (Codex, the double), a turn that joined a wake', () => {
  it('🔴 absorbs the wake’s own terminal, then ends on its own — as the provider’s turn', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    m.completeTurn('completed')
    expect(m.hasActiveTurn, 'the wake’s terminal ended the message that joined it').toBe(true)
    expect(turnRows(events)).toEqual([])
    m.completeTurn('completed')
    expect(turnRows(events)).toEqual([
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    ])
    expect(providerTurns(events)).toBe(1)
  })

  it('⚑ the control — a turn opened with no wake ends on its first terminal, unmarked', () => {
    const { m, events } = active()
    m.beginTurn()
    m.completeTurn('completed')
    expect(turnRows(events)).toEqual([{ type: 'turn', state: 'completed' }])
  })
})
