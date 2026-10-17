import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import { SessionMachine } from '../src/internal/session-machine'
import type { SessionRef } from '../src/session-ref'

/**
 * # 🔴 F084 · what a stop ended rides the stopped turn's ending — and no other
 *
 * ⚑ `SessionMachine.noteWhatTheStopEnded(of, ids)` is how both adapters say which commands a stop
 * ended: the ending of turn `of` carries them as `endedCommands`. ⛔ Only while `of` is still the open
 * turn — a pass that answers after its turn's ending was written has no row left to say it on, and
 * must never be said on the next turn's (the stale-stop guard). ⚑ A turn the provider started by
 * itself (a burst) keeps its own list, said on the burst's ending on every path that ends it — or
 * taken by a turn of ours that joins it.
 *
 * Every negative is read beside the positive it differs from by one fact.
 */

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

function anActiveMachine(): {
  m: SessionMachine
  endings: () => Extract<RuntimeEvent, { type: 'turn' }>[]
} {
  const events: RuntimeEvent[] = []
  const m = new SessionMachine((event) => events.push(event))
  m.markStarting()
  m.sessionStarted(REF, 'started')
  return {
    m,
    endings: () =>
      events.filter(
        (event): event is Extract<RuntimeEvent, { type: 'turn' }> => event.type === 'turn',
      ),
  }
}

describe('F084 · the commands a stop ended, on the stopped turn’s ending', () => {
  it('🔴 noted for the open turn, they ride its ending — once each, in the order noted', () => {
    const { m, endings } = anActiveMachine()
    const id = m.beginTurn()
    if (id === null) throw new Error('no turn')
    expect(m.openTurnId).toBe(id)
    m.requestInterrupt()
    m.noteWhatTheStopEnded(id, ['exec-waited'])
    // ⚑ The second pass names the waited one again, and one more: each is said once.
    m.noteWhatTheStopEnded(id, ['exec-waited', 'exec-late'])
    m.completeTurn('interrupted')
    expect(endings()).toEqual([
      { type: 'turn', state: 'interrupted', endedCommands: ['exec-waited', 'exec-late'] },
    ])
    expect(m.openTurnId).toBeNull()
  })

  it('⛔ a stop that ended nothing adds nothing to the ending — not even an empty list', () => {
    const { m, endings } = anActiveMachine()
    const id = m.beginTurn()
    if (id === null) throw new Error('no turn')
    m.requestInterrupt()
    m.noteWhatTheStopEnded(id, [])
    m.completeTurn('interrupted')
    expect(endings()).toEqual([{ type: 'turn', state: 'interrupted' }])
  })

  it('⚑ every way a turn ends carries them: a forced end, and a turn this app failed', () => {
    const forced = anActiveMachine()
    const one = forced.m.beginTurn()
    if (one === null) throw new Error('no turn')
    forced.m.noteWhatTheStopEnded(one, ['toolu_fg'])
    forced.m.forceEnd()
    expect(forced.endings()).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', endedCommands: ['toolu_fg'] },
    ])

    const failed = anActiveMachine()
    const two = failed.m.beginTurn()
    if (two === null) throw new Error('no turn')
    failed.m.noteWhatTheStopEnded(two, ['exec-1'])
    failed.m.failTurn('this app could not start it')
    expect(failed.endings()).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app', endedCommands: ['exec-1'] },
    ])
  })

  /**
   * ⛔ **The stale-stop case**: a pass that finishes after its turn's ending was written — and a
   * next turn has begun — names the OLD turn. It must land nowhere.
   */
  it('🔴 a pass that answers after its turn ended is never said on the next turn', () => {
    const { m, endings } = anActiveMachine()
    const stopped = m.beginTurn()
    if (stopped === null) throw new Error('no turn')
    m.requestInterrupt()
    m.completeTurn('interrupted')
    const next = m.beginTurn()
    if (next === null) throw new Error('no next turn')
    expect(next).not.toBe(stopped)
    m.noteWhatTheStopEnded(stopped, ['exec-late'])
    m.completeTurn('completed')
    expect(endings()).toEqual([
      { type: 'turn', state: 'interrupted' },
      { type: 'turn', state: 'completed' },
    ])
  })

  it('⚑ the paired positive: the same note, naming the turn that IS open, is said on its ending', () => {
    const { m, endings } = anActiveMachine()
    const stopped = m.beginTurn()
    if (stopped === null) throw new Error('no turn')
    m.requestInterrupt()
    m.completeTurn('interrupted')
    const next = m.beginTurn()
    if (next === null) throw new Error('no next turn')
    m.noteWhatTheStopEnded(next, ['exec-late'])
    m.completeTurn('interrupted')
    expect(endings().at(-1)).toEqual({
      type: 'turn',
      state: 'interrupted',
      endedCommands: ['exec-late'],
    })
  })

  it('⛔ with no turn and no burst open, a note goes nowhere — and the next turn does not inherit it', () => {
    const { m, endings } = anActiveMachine()
    m.noteWhatTheStopEnded(1, ['exec-x'])
    m.noteWhatTheStopEnded('the-burst', ['exec-y'])
    m.beginTurn()
    m.completeTurn('completed')
    expect(endings()).toEqual([{ type: 'turn', state: 'completed' }])
  })
})

describe('F084 · a turn the provider started by itself (a burst)', () => {
  it('🔴 a stop that forces a burst’s end names what it ended, on the burst’s own ending', () => {
    const { m, endings } = anActiveMachine()
    m.noteProviderWork('tool_call')
    expect(m.openTurnId).toBeNull()
    m.requestInterrupt()
    m.noteWhatTheStopEnded('the-burst', ['toolu_wake'])
    m.forceEnd()
    expect(endings()).toEqual([
      {
        type: 'turn',
        state: 'interrupted',
        wordOf: 'this-app',
        startedBy: 'the-provider',
        endedCommands: ['toolu_wake'],
      },
    ])
  })

  it('⚑ …and so does the provider’s own ending of it — once: the next burst names nothing', () => {
    const { m, endings } = anActiveMachine()
    m.noteProviderWork('tool_call')
    m.noteWhatTheStopEnded('the-burst', ['toolu_wake'])
    m.completeTurn('interrupted')
    expect(endings().at(-1)).toEqual({
      type: 'turn',
      state: 'interrupted',
      startedBy: 'the-provider',
      endedCommands: ['toolu_wake'],
    })
    m.noteProviderWork('tool_call')
    m.completeTurn('completed')
    expect(endings().at(-1)).toEqual({
      type: 'turn',
      state: 'completed',
      startedBy: 'the-provider',
    })
  })

  it('⛔ a burst nobody stopped ends naming nothing', () => {
    const { m, endings } = anActiveMachine()
    m.noteProviderWork('tool_call')
    m.completeTurn('completed')
    expect(endings()).toEqual([{ type: 'turn', state: 'completed', startedBy: 'the-provider' }])
  })

  it('🔴 a turn of ours that joins the burst takes its list, and says it on its own ending', () => {
    const { m, endings } = anActiveMachine()
    m.noteProviderWork('tool_call')
    m.noteWhatTheStopEnded('the-burst', ['toolu_wake'])
    const joined = m.beginTurn()
    expect(joined).not.toBeNull()
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    expect(endings()).toEqual([
      {
        type: 'turn',
        state: 'completed',
        startedBy: 'the-provider',
        endedCommands: ['toolu_wake'],
      },
    ])
  })

  it('⚑ a message that joined the burst and never left this app gives the list back to the burst', () => {
    const { m, endings } = anActiveMachine()
    m.noteProviderWork('tool_call')
    m.noteWhatTheStopEnded('the-burst', ['toolu_wake'])
    m.beginTurn()
    m.failTurn('its settings could not be applied', { neverSent: true })
    // ⚑ The burst runs on, its row still open — and still holds what its stop ended.
    expect(endings()).toEqual([])
    m.forceEnd()
    expect(endings()).toEqual([
      {
        type: 'turn',
        state: 'interrupted',
        wordOf: 'this-app',
        startedBy: 'the-provider',
        endedCommands: ['toolu_wake'],
      },
    ])
  })

  it('⛔ a note for the burst while a turn of ours is open goes nowhere', () => {
    const { m, endings } = anActiveMachine()
    m.beginTurn()
    m.noteWhatTheStopEnded('the-burst', ['toolu_x'])
    m.completeTurn('completed')
    expect(endings()).toEqual([{ type: 'turn', state: 'completed' }])
  })
})
