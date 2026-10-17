import { describe, expect, it } from 'vitest'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import { derivePieces, type PieceRow } from '../src/shared/tasks'

/**
 * # 🔴 F080 review (484) — a stop's asker belongs to the wake it cut, in a ledger written before F080
 *
 * A wake recorded before F080 has no `turn` row: it is `status: working`, then `idle`, and the fold
 * ends it on that `idle` (D-013). The F080 review found a person's stop of one such wake carried over
 * and named that person on the NEXT wake, which ended by itself — and fixed it in both arms: the
 * `startedBy` row's (pinned in `a-stop-cuts-the-drive…` §2) and this older one's, which nothing
 * pinned.
 *
 * ⚑ Each case has its control one fact over: the same two wakes in a ledger written since F080.
 */

let ordinal = 0
let clock = 7_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const assigned: TranscriptEvent = {
  type: 'work_given',
  piece: 'work_7',
  label: 'W1.7',
  parent: 'work_root_ayo',
  givenBy: 'sess_ayo',
  title: 'Build the index',
  brief: 'build the index',
}
const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
// ⚑ **F097 · the giver's note opens the turn**: one a person's own words opened would leave the work
// waiting on them at its end, and these drives are about who STOPPED them, not about who wrote.
const aTurnOpens: TranscriptEvent = {
  type: 'user_turn',
  text: 'build the index',
  attribution: 'app_authored',
  relayedFrom: 'sess_ayo',
  says: 'note',
}
const aPersonStops: TranscriptEvent = { type: 'work_interrupted', by: 'a-person' }

const theTask = (entries: TranscriptEvent[]): PieceRow => {
  ordinal = 0
  clock = 7_000_000
  const found = derivePieces('sess_camille', entries.map(row), { backgroundWakesIt: true })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

const theBriefsTurn: TranscriptEvent[] = [assigned, aTurnOpens, working, turnEnds, idle]

describe('484 · a stop names the wake it cut, and never the next — in a ledger written before F080', () => {
  it('🔴 a person stops a wake with no turn row; the next such wake ends by itself and names nobody', () => {
    // ⚑ The wake as a ledger before F080 holds it: `working`, the ask, then `idle` — no `turn`.
    const stopped = [...theBriefsTurn, working, aPersonStops, idle]
    const first = theTask(stopped)
    // ⚑ The premise: the stop is the person's, on the wake it cut.
    expect(first).toMatchObject({ state: 'stalled', stalledBy: { by: 'a-person' } })

    const next = theTask([...stopped, working, idle])
    expect(next.state).toBe('stalled')
    expect(next.stalledBecause).toBe('turn_ended')
    expect(next.stalledBy, 'the person’s stop was carried onto a wake it never cut').toBeNull()
    expect(next.stalledAt ?? 0).toBeGreaterThan(first.stalledAt ?? Number.POSITIVE_INFINITY)
  })

  it('⚑ the control — the same two wakes written since F080, each on its own `turn` row', () => {
    const aWake = (end: TranscriptEvent): TranscriptEvent[] => [
      { type: 'provider_turn' },
      working,
      ...(end.type === 'work_interrupted' ? [end] : []),
      {
        type: 'turn',
        state: end.type === 'work_interrupted' ? 'interrupted' : 'completed',
        ...(end.type === 'work_interrupted' ? { wordOf: 'this-app' as const } : {}),
        startedBy: 'the-provider',
      },
      idle,
    ]
    const stopped = [...theBriefsTurn, ...aWake(aPersonStops)]
    expect(theTask(stopped)).toMatchObject({
      stalledBecause: 'turn_interrupted',
      stalledBy: { by: 'a-person' },
    })
    const next = theTask([...stopped, ...aWake(turnEnds)])
    expect(next).toMatchObject({ stalledBecause: 'turn_ended', stalledBy: null })
  })
})
