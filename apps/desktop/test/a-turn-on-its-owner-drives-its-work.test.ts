import { describe, expect, it } from 'vitest'
import {
  ITS_OWNER_RUNNING_AGAIN_DRIVES_IT,
  TASK_STALL_CAUSES,
  derivePieces,
  type PieceRow,
} from '../src/shared/tasks'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-005 · F019 — a turn starting on an owner puts its work back to `working`.**
 *
 * ⚑ Measured by BroBot (F019, 2026-09-25): Ayo held #13 and waited on three helpers. When the last
 * one replied, its task closed BEFORE its reply reached Ayo, so #13 read `stalled` again — and the
 * reply starting Ayo's next turn pushed BroBot *"Task #13 with Ayo is not being worked on"*, at the
 * one moment it was. #13 read `stalled` until Ayo replied, a minute later.
 *
 * ⚑ The fold is the one source every reader composes from: the stall notice (decided on the owner's
 * own `turn`/`status` rows), `list_tasks`, and a person's queue. So the fold is where it is fixed.
 *
 * ⚑ **D-016** — a task is a PIECE now: #13 is `W1.13`, given with `work_given` in the owner's
 * ledger, and the fold is `derivePieces`.
 */

let ordinal = 0
let clock = 5_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const assigned: TranscriptEvent = {
  type: 'work_given',
  piece: 'work_13',
  label: 'W1.13',
  parent: 'work_root',
  givenBy: 'sess_brobot',
  title: 'the report',
  brief: 'write the report',
}
const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
// ⚑ **F097 · the giver's note opens the turn**: one a person's own words opened would leave the work
// waiting on them at its end, and these turns are about what drives the work, not about who wrote.
const aTurnOpens = (text: string): TranscriptEvent => ({
  type: 'user_turn',
  text,
  attribution: 'app_authored',
  relayedFrom: 'sess_brobot',
  says: 'note',
})

const theTask = (entries: TranscriptEvent[]): PieceRow => {
  ordinal = 0
  clock = 5_000_000
  const found = derivePieces('sess_ayo', entries.map(row))[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

/** ⚑ Ayo is given #13, works on it, and its turn ends with #13 open: `stalled`, `turn_ended`. */
const handedOutAndEnded: TranscriptEvent[] = [
  assigned,
  working,
  aTurnOpens('write the report'),
  turnEnds,
  idle,
]

describe('D-005 · a turn starting on the owner drives the work it already holds', () => {
  it('the premise: its turn ended with the work open, so it reads stalled', () => {
    expect(theTask(handedOutAndEnded)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('🔴 on Claude’s order — `status: working` BEFORE the turn’s `user_turn` — it is working at the status', () => {
    // ⚑ The owner's `status` row is the one the stall notice is decided on; on Claude it lands
    // first, so the work has to read `working` there and not one row later.
    expect(theTask([...handedOutAndEnded, working])).toMatchObject({
      state: 'working',
      stalledBecause: null,
      stalledAt: null,
      stalledBy: null,
    })
  })

  it('🔴 on Codex’s order — `user_turn` first — it is working at the turn', () => {
    expect(theTask([...handedOutAndEnded, aTurnOpens('Dara replied')])).toMatchObject({
      state: 'working',
      stalledBecause: null,
    })
  })

  it('and when that turn ends without a reply, it stalls again — at that ending', () => {
    const task = theTask([...handedOutAndEnded, working, aTurnOpens('Dara replied'), turnEnds])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    // ⚑ The later ending, not the first — nothing is latched across a turn that worked on it.
    expect(task.stalledAt).toBe(5_000_000 + 8 * 1_000)
  })

  it('⛔ a message that never went out stays stalled: the owner never got the work', () => {
    const neverSent: TranscriptEvent[] = [
      { ...assigned, messageId: 'msg_13' } as TranscriptEvent,
      {
        type: 'message_unqueued',
        messageId: 'msg_13',
        reason: 'abandoned',
        text: 'write the report',
      } as TranscriptEvent,
      working,
      aTurnOpens('something else'),
    ]
    expect(theTask(neverSent)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'message_never_sent',
    })
  })

  // ⚑ **D-016c · a stop moves no piece** (`05`: an agent is never dead): the turn's own ending
  // decided it, and neither the conversation's ending nor its reopen re-words that.
  it('⛔ an ended conversation keeps its turn’s stall, a reopen moves nothing, and then its turn drives it', () => {
    const ended: TranscriptEvent[] = [...handedOutAndEnded, { type: 'status', state: 'ended' }]
    const theTurnsStall = theTask(handedOutAndEnded)
    expect(theTask(ended)).toEqual(theTurnsStall)
    expect(theTask([...ended, { type: 'reopened' }])).toEqual(theTurnsStall)
    // ⚑ …and the reopened turn drives it.
    expect(theTask([...ended, { type: 'reopened' }, working])).toMatchObject({ state: 'working' })
  })

  // ⚑ **T-002 · `1005 M9`**: a ledger written before `673` has no `reopened` row, and existing
  // ledgers fold the new way. Its first `working` drives the work all the same.
  it('⚑ an old ledger with no `reopened` row: the `working` drives it', () => {
    const ended: TranscriptEvent[] = [...handedOutAndEnded, { type: 'status', state: 'ended' }]
    expect(theTask([...ended, working])).toMatchObject({ state: 'working', stalledBecause: null })
  })

  // ⚑ **T-002 · `1005 M8`**: all three stall fields go together. Who asked the LAST turn to stop is
  // not true of the turn now driving the work, and `list_tasks` prints it beside `working`.
  it('⛔ a driven task no longer names who asked the turn before it to stop', () => {
    const askedAndStopped: TranscriptEvent[] = [
      assigned,
      working,
      aTurnOpens('write the report'),
      { type: 'work_interrupted', by: 'a-person' } as TranscriptEvent,
      { type: 'turn', state: 'interrupted' },
      idle,
    ]
    expect(theTask(askedAndStopped)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_interrupted',
      stalledBy: { by: 'a-person', asker: null },
    })
    expect(theTask([...askedAndStopped, working])).toMatchObject({
      state: 'working',
      stalledBy: null,
    })
  })

  // ⚑ **D-017 · R10**: `could_not_be_reopened` is final, since nothing runs the old conversation
  // again (a replacement took its place). ⛔ **D-016c** removed the stop's own cause: a stop moves
  // no piece, so the turn's cause stands and its owner running again drives it.
  it('⚑ the record is closed: every stall cause is decided, and the two that are not driven say so', () => {
    expect(Object.keys(ITS_OWNER_RUNNING_AGAIN_DRIVES_IT).sort()).toEqual(
      [...TASK_STALL_CAUSES].sort(),
    )
    expect(
      TASK_STALL_CAUSES.filter((cause) => !ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]).sort(),
    ).toEqual(['could_not_be_reopened', 'message_never_sent'])
  })
})

/**
 * 🔴 **D-005a · F019's fix check — answers waiting in the owner's queue are driving it.**
 *
 * ⚑ Measured by BroBot (2026-09-27, task #25): both helpers answered while their owner was
 * mid-turn, so the answers waited in its queue. Its turn ended with no helper work open; the fold
 * stalled the work and the giver was told *"not being worked on"* about 10 s before those answers
 * started the owner's next turn.
 */
describe('D-005a · a message waiting in the owner’s queue holds its turn’s stall', () => {
  const queued = (messageId: string): TranscriptEvent =>
    ({ type: 'message_queued', messageId, kind: 'notice', text: 'the notes' }) as TranscriptEvent
  const unqueued = (
    messageId: string,
    reason: 'sent' | 'cancelled' | 'retracted' | 'abandoned',
  ): TranscriptEvent =>
    ({ type: 'message_unqueued', messageId, reason, text: 'the notes' }) as TranscriptEvent
  /** ⚑ Ayo holds #13 and is mid-turn when a helper's answer arrives. */
  const midTurn: TranscriptEvent[] = [assigned, working, aTurnOpens('write the report')]

  it('the premise: with nothing queued, the turn’s end stalls it', () => {
    expect(theTask([...midTurn, turnEnds, idle])).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('🔴 an answer waiting in its queue at the turn’s end: still working, through to the turn it starts', () => {
    const held = [...midTurn, queued('msg_a'), turnEnds, idle]
    // ⚑ The two rows the stall notice is decided on — `turn` and `status` — both read working.
    expect(theTask(held)).toMatchObject({ state: 'working', stalledBecause: null })
    const woken = [...held, unqueued('msg_a', 'sent'), working, aTurnOpens('the notes')]
    expect(theTask(woken)).toMatchObject({ state: 'working', stalledBecause: null })
    // ⚑ …and that turn ending with nothing queued stalls it, at that ending.
    expect(theTask([...woken, turnEnds, idle])).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
      stalledAt: 5_000_000 + 10 * 1_000,
    })
  })

  it('⛔ the queue empties with nothing sent: the held stall is written then, never lost', () => {
    for (const reason of ['cancelled', 'retracted', 'abandoned'] as const) {
      const task = theTask([...midTurn, queued('msg_a'), turnEnds, idle, unqueued('msg_a', reason)])
      expect(task, reason).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
      // ⚑ At the moment nothing will drive it: the unqueue, the seventh row.
      expect(task.stalledAt, reason).toBe(5_000_000 + 7 * 1_000)
    }
  })

  it('⚑ one of two leaving unsent is not the queue emptying', () => {
    const two = [...midTurn, queued('msg_a'), queued('msg_b'), turnEnds, idle]
    expect(theTask([...two, unqueued('msg_a', 'retracted')])).toMatchObject({ state: 'working' })
    expect(
      theTask([...two, unqueued('msg_a', 'retracted'), unqueued('msg_b', 'abandoned')]),
    ).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⚑ a stopped turn keeps who asked, when its held stall is written later', () => {
    const task = theTask([
      ...midTurn,
      queued('msg_a'),
      { type: 'work_interrupted', by: 'a-person' } as TranscriptEvent,
      { type: 'turn', state: 'interrupted' },
      idle,
      unqueued('msg_a', 'retracted'),
    ])
    expect(task).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_interrupted',
      stalledBy: { by: 'a-person', asker: null },
    })
  })

  // ⚑ **D-016c · a stop moves no piece**: work held for its queue stays held through the ending and
  // the reopen (the stop hands the message on to the next start, D-017 · R3), and the held stall is
  // written only when that queue empties with nothing sent.
  it('⛔ an ending drives nothing: the held stall is kept under it and a reopen, and written when the queue empties', () => {
    const ended = [
      ...midTurn,
      queued('msg_a'),
      turnEnds,
      { type: 'status', state: 'ended' },
    ] as TranscriptEvent[]
    expect(theTask(ended)).toMatchObject({ state: 'working', stalledBecause: null })
    const reopened = [...ended, { type: 'reopened' } as TranscriptEvent]
    expect(theTask(reopened)).toMatchObject({ state: 'working', stalledBecause: null })
    expect(theTask([...reopened, unqueued('msg_a', 'abandoned')])).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('⛔ an unnamed queued row pairs with nothing, so it holds nothing', () => {
    const unnamed = { type: 'message_queued', text: 'old' } as TranscriptEvent
    expect(theTask([...midTurn, unnamed, turnEnds, idle])).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })
})
