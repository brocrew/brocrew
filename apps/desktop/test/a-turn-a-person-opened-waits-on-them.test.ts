import { describe, expect, it } from 'vitest'
import { TASK_IS_OPEN, aStallItsGiverCanBeToldOf, derivePieces } from '../src/shared/tasks'
import type { PieceRow, TaskState } from '../src/shared/tasks'
import type {
  PersistedEventInfo,
  TranscriptEvent,
  UserTurnPart,
  WorkGivenEvent,
} from '../src/shared/runtime-ipc'

/** The ledger keeps person waits through notes and clears them when the work is driven or ended. */

let ordinal = 0
let clock = 9_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const THE_GIVER = 'sess_giver'

const given = (piece = 'work_1', label = 'W1.1', givenBy: string | null = THE_GIVER) =>
  ({
    type: 'work_given',
    piece,
    label,
    parent: 'work_root',
    givenBy,
    title: `the work ${label}`,
    brief: `do ${label}`,
  }) satisfies WorkGivenEvent

const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }

/** ⚑ Words a person typed into the conversation: a turn with no authorship at all. */
const aPersonWrites = (text = 'is it done?'): TranscriptEvent => ({ type: 'user_turn', text })
/** ⚑ The giver's brief, as the host writes it: its words, carried, and the piece it gives. */
const theBrief = (piece = 'work_1', label = 'W1.1'): TranscriptEvent => ({
  type: 'user_turn',
  text: 'do it',
  attribution: 'app_authored',
  relayedFrom: THE_GIVER,
  piece,
  label,
})
/** ⚑ The giver's own message — a note, or a follow-up naming the piece it drives. */
const theGiverWrites = (says: 'note' | 'follow-up', drives?: string): TranscriptEvent => ({
  type: 'user_turn',
  text: 'how is it going?',
  attribution: 'app_authored',
  relayedFrom: THE_GIVER,
  says,
  ...(drives === undefined ? {} : { drives }),
})

/** The fold's rows by piece, and the moment each ledger row was written, by its place. */
const fold = (
  events: TranscriptEvent[],
  options: { backgroundWakesIt?: boolean } = {},
): { rows: Map<string, PieceRow>; at: (index: number) => number } => {
  ordinal = 0
  clock = 9_000_000
  const entries = events.map(row)
  const rows = derivePieces('sess_eli', entries, options)
  return {
    rows: new Map(rows.map((one) => [one.piece, one])),
    at: (index) => entries[index]?.at ?? Number.NaN,
  }
}

const pieceIn = (rows: Map<string, PieceRow>, piece = 'work_1'): PieceRow => {
  const found = rows.get(piece)
  if (found === undefined) throw new Error(`the fold has no piece ${piece}`)
  return found
}

const noStall = { stalledBecause: null, stalledAt: null, stalledBy: null }
const WAITS: TaskState = 'waiting-on-the-person-who-wrote'

describe('F097 · a turn a person opened leaves the work waiting on them', () => {
  // The brief's turn, ended, then the person writes and that turn ends with the piece still open.
  const answeredThePerson: TranscriptEvent[] = [
    given(),
    working,
    theBrief(),
    turnEnds,
    idle,
    working,
    aPersonWrites(),
    turnEnds,
    idle,
  ]

  it('🔴 the headline: open, no cause, no notice for its giver, and when its turn answered them', () => {
    const { rows, at } = fold(answeredThePerson)
    const piece = pieceIn(rows)
    expect(piece.state).toBe(WAITS)
    expect(piece).toMatchObject({ ...noStall, endedAt: null, giver: THE_GIVER })
    expect(TASK_IS_OPEN[piece.state]).toBe(true)
    // ⛔ No stall, so nothing its giver is owed: the giver keeps reading the holder as working on it.
    expect(aStallItsGiverCanBeToldOf(piece)).toBe(false)
    // ⚑ The moment is the turn row's own — the end of the turn that answered the person.
    expect(piece.answeredAPersonAt).toBe(at(7))
  })

  it('⛔ THE CONTROL — a turn the giver’s words opened stalls as it always did', () => {
    // The brief's own turn, ended with the piece open.
    const afterTheBrief = pieceIn(fold([given(), working, theBrief(), turnEnds, idle]).rows)
    expect(afterTheBrief).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(afterTheBrief).not.toHaveProperty('answeredAPersonAt')
    const afterANote = pieceIn(
      fold([given(), working, theGiverWrites('note'), turnEnds, idle]).rows,
    )
    expect(afterANote).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(afterANote).not.toHaveProperty('answeredAPersonAt')
    const afterAFollowUp = pieceIn(
      fold([...answeredThePerson, working, theGiverWrites('follow-up', 'work_1'), turnEnds, idle])
        .rows,
    )
    expect(afterAFollowUp).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(afterAFollowUp).not.toHaveProperty('answeredAPersonAt')
    // ⚑ This app's own words: a reply carried to it, about work it gave out.
    const carried = pieceIn(
      fold([
        given(),
        working,
        {
          type: 'user_turn',
          text: 'the reply',
          attribution: 'app_authored',
          relayedFrom: 'sess_helper',
          work: {
            piece: 'work_child',
            label: 'W1.1.1',
            state: 'answered',
          },
        } as TranscriptEvent,
        turnEnds,
      ]).rows,
    )
    expect(carried).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('keeps the original person wait through two notes, including a note naming the piece', () => {
    const first = fold(answeredThePerson)
    const notes = [theGiverWrites('note'), theGiverWrites('note', 'work_1')]
    const events = [...answeredThePerson]
    for (const note of notes) {
      events.push(working, note)
      const mid = pieceIn(fold(events).rows)
      expect(mid).toMatchObject({ state: WAITS, ...noStall, answeredAPersonAt: first.at(7) })
      events.push(turnEnds, idle)
      const ended = pieceIn(fold(events).rows)
      expect(ended).toMatchObject({ state: WAITS, ...noStall, answeredAPersonAt: first.at(7) })
      expect(aStallItsGiverCanBeToldOf(ended)).toBe(false)
    }
  })

  it('restores the original wait if a queued personal reply is cancelled during a note turn', () => {
    const reply: TranscriptEvent = {
      type: 'message_queued',
      messageId: 'msg_reply',
      kind: 'notice',
      text: 'the reply',
    }
    const note: TranscriptEvent = {
      type: 'message_queued',
      messageId: 'msg_note',
      kind: 'notice',
      text: 'standing rule',
      attribution: 'app_authored',
      relayedFrom: THE_GIVER,
      says: 'note',
    }
    const ended = fold([
      ...answeredThePerson,
      reply,
      note,
      working,
      theGiverWrites('note'),
      turnEnds,
      idle,
      { type: 'message_unqueued', messageId: 'msg_reply', reason: 'cancelled', text: 'the reply' },
    ])
    expect(pieceIn(ended.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: ended.at(7) })
  })

  it.each([
    ['work message', theBrief()],
    ['follow-up', theGiverWrites('follow-up', 'work_1')],
    ['new brief', { ...theBrief(), text: 'the revised brief' }],
    [
      'child reply',
      {
        type: 'user_turn',
        text: 'the child finished',
        attribution: 'app_authored',
        relayedFrom: 'sess_child',
        drives: 'work_1',
        work: { piece: 'work_child', label: 'W1.1.1', state: 'answered' },
      },
    ],
  ] as const)('clears a person wait after notes when a %s drives the piece', (_name, message) => {
    const prefix: TranscriptEvent[] = [
      ...answeredThePerson,
      working,
      theGiverWrites('note'),
      turnEnds,
      idle,
    ]
    if (_name === 'new brief') {
      prefix.push({
        type: 'work_rebriefed',
        piece: 'work_1',
        by: THE_GIVER,
        brief: 'the revised brief',
      })
    }
    const mid = pieceIn(fold([...prefix, working, message as TranscriptEvent]).rows)
    expect(mid).toMatchObject({ state: 'working', ...noStall })
    expect(mid).not.toHaveProperty('answeredAPersonAt')
    const ended = pieceIn(
      fold([...prefix, working, message as TranscriptEvent, turnEnds, idle]).rows,
    )
    expect(ended).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(ended).not.toHaveProperty('answeredAPersonAt')
  })

  it('does not let a batched note override a substantive follow-up about the waiting piece', () => {
    const event: TranscriptEvent = {
      type: 'user_turn',
      text: 'note and follow-up',
      parts: [theGiverWrites('note'), theGiverWrites('follow-up', 'work_1')].map((one) => {
        if (one.type !== 'user_turn') throw new Error('expected a message')
        return one
      }),
    }
    const ended = pieceIn(fold([...answeredThePerson, working, event, turnEnds, idle]).rows)
    expect(ended).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('keeps other pieces waiting when a batch includes an unnamed note and a follow-up about one piece', () => {
    const batch: TranscriptEvent = {
      type: 'user_turn',
      text: 'note and other work',
      parts: [
        {
          text: 'standing rule',
          attribution: 'app_authored',
          relayedFrom: THE_GIVER,
          says: 'note',
        },
        {
          text: 'continue W1.2',
          attribution: 'app_authored',
          relayedFrom: THE_GIVER,
          says: 'follow-up',
          drives: 'work_2',
        },
      ],
    }
    const after = fold([
      given('work_2', 'W1.2'),
      ...answeredThePerson,
      working,
      batch,
      turnEnds,
      idle,
    ])
    expect(pieceIn(after.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: after.at(8) })
    expect(pieceIn(after.rows, 'work_2').state).toBe('stalled')
  })

  it('lets the person’s own words drive a piece even when batched with a named note', () => {
    const batch: TranscriptEvent = {
      type: 'user_turn',
      text: 'note and person',
      parts: [
        {
          text: 'standing rule',
          attribution: 'app_authored',
          relayedFrom: THE_GIVER,
          says: 'note',
          drives: 'work_1',
        },
        { text: 'Use the first option.' },
      ],
    }
    const prefix = [...answeredThePerson, working, batch]
    expect(pieceIn(fold(prefix).rows).state).toBe('working')
    const ended = fold([...prefix, turnEnds, idle])
    expect(pieceIn(ended.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: ended.at(11) })
  })

  it('establishes the person wait when the only queued delivery is an informational note', () => {
    const queued: TranscriptEvent = {
      type: 'message_queued',
      messageId: 'msg_note',
      kind: 'notice',
      text: 'standing rule',
      attribution: 'app_authored',
      relayedFrom: THE_GIVER,
      says: 'note',
    }
    const prefix = [given(), working, aPersonWrites(), queued, turnEnds, idle]
    const first = fold(prefix)
    expect(pieceIn(first.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: first.at(4) })
    const ended = fold([
      ...prefix,
      { type: 'message_unqueued', messageId: 'msg_note', reason: 'sent', text: 'standing rule' },
      working,
      theGiverWrites('note'),
      turnEnds,
      idle,
    ])
    expect(pieceIn(ended.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: first.at(4) })
  })

  it.each([
    [
      'reply',
      { type: 'work_replied', piece: 'work_1', outcome: 'done', summary: 'done', resources: [] },
      'answered',
    ],
    ['take-back', { type: 'work_taken_back', piece: 'work_1', by: THE_GIVER }, 'withdrawn'],
    ['close', { type: 'work_closed', piece: 'work_1', by: THE_GIVER }, 'closed'],
  ] as const)('clears the wait after notes when a %s ends the piece', (_name, event, state) => {
    const ended = pieceIn(
      fold([
        ...answeredThePerson,
        working,
        theGiverWrites('note'),
        turnEnds,
        idle,
        event as TranscriptEvent,
      ]).rows,
    )
    expect(ended.state).toBe(state)
    expect(ended).not.toHaveProperty('answeredAPersonAt')
    expect(TASK_IS_OPEN[ended.state]).toBe(false)
  })

  it('keeps the wait on a note relaying prose, but drives it on a recorded personal answer', () => {
    const prose = { ...theGiverWrites('note'), text: 'The person answered yes.' }
    const kept = pieceIn(fold([...answeredThePerson, working, prose, turnEnds, idle]).rows)
    expect(kept).toMatchObject({ state: WAITS, answeredAPersonAt: fold(answeredThePerson).at(7) })
    const answer: TranscriptEvent = {
      type: 'user_turn',
      text: 'yes',
      attribution: 'app_authored',
      appNotice: 'an-answer-to-a-question',
      relayedFrom: THE_GIVER,
      says: 'note',
    }
    const mid = pieceIn(fold([...answeredThePerson, working, answer]).rows)
    expect(mid.state).toBe('working')
    expect(mid).not.toHaveProperty('answeredAPersonAt')
    const ended = fold([...answeredThePerson, working, answer, turnEnds, idle])
    expect(pieceIn(ended.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: ended.at(11) })
  })

  it('clears a wait when the owner explicitly works the piece during a note turn', () => {
    const status: TranscriptEvent = {
      type: 'work_status_set',
      piece: 'work_1',
      by: 'sess_eli',
      line: 'Implementing the answer',
    }
    const prefix = [...answeredThePerson, working, theGiverWrites('note'), status]
    expect(pieceIn(fold(prefix).rows).state).toBe('working')
    expect(pieceIn(fold([...prefix, turnEnds, idle]).rows)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
  })

  it('⚑ the person’s next message drives it, and that turn’s end leaves it waiting on them again', () => {
    const { rows: mid } = fold([...answeredThePerson, working, aPersonWrites('and now?')])
    expect(pieceIn(mid)).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(mid)).not.toHaveProperty('answeredAPersonAt')
    const { rows, at } = fold([
      ...answeredThePerson,
      working,
      aPersonWrites('and now?'),
      turnEnds,
      idle,
    ])
    expect(pieceIn(rows).state).toBe(WAITS)
    // ⚑ Since the LATER turn: the person owes it their words from that moment.
    expect(pieceIn(rows).answeredAPersonAt).toBe(at(11))
  })

  it('⚑ the giver’s follow-up drives it; that turn was the giver’s, so its end stalls it', () => {
    const { rows: mid } = fold([
      ...answeredThePerson,
      working,
      theGiverWrites('follow-up', 'work_1'),
    ])
    expect(pieceIn(mid)).toMatchObject({ state: 'working', ...noStall })
    // ⛔ A follow-up naming ANOTHER piece does not drive this one: it keeps waiting on the person.
    const { rows: elsewhere } = fold([
      given('work_2', 'W1.2'),
      ...answeredThePerson,
      working,
      theGiverWrites('follow-up', 'work_2'),
      turnEnds,
      idle,
    ])
    expect(pieceIn(elsewhere).state).toBe(WAITS)
    expect(pieceIn(elsewhere, 'work_2')).toMatchObject({ state: 'stalled' })
  })

  it('⚑ a turn of several messages waits on the person when ANY of them is a person’s own', () => {
    const batch = (parts: readonly UserTurnPart[]): TranscriptEvent =>
      ({
        type: 'user_turn',
        text: parts.map((one) => one.text).join('\n\n'),
        parts,
      }) as TranscriptEvent
    const theGiversPart: UserTurnPart = {
      text: 'the note',
      attribution: 'app_authored',
      relayedFrom: THE_GIVER,
      says: 'note',
    }
    const withAPerson = pieceIn(
      fold([given(), working, batch([theGiversPart, { text: 'me too' }]), turnEnds]).rows,
    )
    expect(withAPerson.state).toBe(WAITS)
    // ⛔ The control: two of the giver's own, and no person among them, stalls.
    const withoutOne = pieceIn(
      fold([given(), working, batch([theGiversPart, theGiversPart]), turnEnds]).rows,
    )
    expect(withoutOne).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⛔ …but a piece another author’s message NAMES in that turn is that author’s: a brief or a follow-up delivered with a person’s words still stalls', () => {
    const batch = (parts: readonly UserTurnPart[]): TranscriptEvent =>
      ({
        type: 'user_turn',
        text: parts.map((one) => one.text).join('\n\n'),
        parts,
      }) as TranscriptEvent
    // W1.2's brief, held while W1.1's turn ran, goes out with the person's words in one turn.
    const theBriefOfW2: UserTurnPart = {
      text: 'do W1.2',
      attribution: 'app_authored',
      relayedFrom: THE_GIVER,
      piece: 'work_2',
      label: 'W1.2',
    }
    const { rows } = fold([
      given(),
      working,
      theBrief(),
      turnEnds,
      idle,
      given('work_2', 'W1.2'),
      working,
      batch([theBriefOfW2, { text: 'how is it going?' }]),
      turnEnds,
    ])
    // The person's words named nothing, so they drove W1.1 and it waits on them…
    expect(pieceIn(rows).state).toBe(WAITS)
    // …and W1.2 was the giver's brief: its end stalls it, and its giver is told.
    expect(pieceIn(rows, 'work_2')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    expect(aStallItsGiverCanBeToldOf(pieceIn(rows, 'work_2'))).toBe(true)

    // A follow-up naming W1.1, delivered with the person's words: W1.1's turn was the giver's.
    const theFollowUp: UserTurnPart = {
      text: 'how is W1.1 going?',
      attribution: 'app_authored',
      relayedFrom: THE_GIVER,
      says: 'follow-up',
      drives: 'work_1',
    }
    const named = pieceIn(
      fold([
        given(),
        working,
        theBrief(),
        turnEnds,
        idle,
        working,
        batch([theFollowUp, { text: 'hello' }]),
        turnEnds,
      ]).rows,
    )
    expect(named).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⚑ a person’s reply held while the agent is busy drives the piece; taken back, it waits on them again from the first moment', () => {
    const theReplyHeld: TranscriptEvent = {
      type: 'message_queued',
      messageId: 'msg_reply',
      kind: 'notice',
      text: 'use postgres',
    } as TranscriptEvent
    // W1.1 waits on the person (since row 7); then the giver's follow-up about W1.2 runs, and the
    // person replies meanwhile.
    const busyWithW2: TranscriptEvent[] = [
      ...answeredThePerson,
      given('work_2', 'W1.2'),
      working,
      theGiverWrites('follow-up', 'work_2'),
      theReplyHeld,
    ]
    const { rows: held, at } = fold(busyWithW2)
    // ⚑ The reply is held, so the piece waits on nothing: working, and not since anything.
    expect(pieceIn(held)).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(held)).not.toHaveProperty('answeredAPersonAt')
    // ⚑ The running turn's end leaves both held for the reply, which names no piece and so will
    // drive every one (D-005a).
    const { rows: ended } = fold([...busyWithW2, turnEnds, idle])
    expect(pieceIn(ended)).toMatchObject({ state: 'working', ...noStall })
    expect(pieceIn(ended, 'work_2')).toMatchObject({ state: 'working', ...noStall })
    // ⛔ The reply is taken back: W1.1 waits on the person again — since the turn that answered
    // them — and W1.2 stalls on the giver's turn that ended with it.
    const { rows: takenBack } = fold([
      ...busyWithW2,
      turnEnds,
      idle,
      {
        type: 'message_unqueued',
        messageId: 'msg_reply',
        reason: 'cancelled',
        text: 'use postgres',
      },
    ])
    expect(pieceIn(takenBack).state).toBe(WAITS)
    expect(pieceIn(takenBack).answeredAPersonAt).toBe(at(7))
    expect(pieceIn(takenBack, 'work_2')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    // ⚑ The reply goes out: its turn drives the piece, and its end waits on the person again, now.
    const sent = fold([
      ...busyWithW2,
      turnEnds,
      idle,
      { type: 'message_unqueued', messageId: 'msg_reply', reason: 'sent', text: 'use postgres' },
      working,
      aPersonWrites('use postgres'),
      turnEnds,
    ])
    expect(pieceIn(sent.rows).state).toBe(WAITS)
    expect(pieceIn(sent.rows).answeredAPersonAt).toBe(sent.at(18))
    // ⛔ The control: a held message of the giver's own is no reply, and moves nothing.
    const { rows: theGivers } = fold([
      ...answeredThePerson,
      { ...theReplyHeld, attribution: 'app_authored', relayedFrom: THE_GIVER } as TranscriptEvent,
    ])
    expect(pieceIn(theGivers).state).toBe(WAITS)
  })

  it('⚑ a person’s other ways of speaking count — the plan go-ahead, an answer carried — and an imported line does not', () => {
    const goAhead = { type: 'user_turn', text: 'Go ahead.', attribution: 'app_authored' } as const
    const anAnswer = {
      type: 'user_turn',
      text: 'yes',
      attribution: 'app_authored',
      appNotice: 'an-answer-to-a-question',
      relayedFrom: 'sess_somebody',
    } as const
    for (const [what, words] of [
      ['the go-ahead', goAhead],
      ['an answer carried', anAnswer],
    ] as const) {
      const ended = pieceIn(fold([given(), working, words as TranscriptEvent, turnEnds]).rows)
      expect(ended.state, what).toBe(WAITS)
    }
    const imported = pieceIn(
      fold([
        given(),
        working,
        { type: 'user_turn', text: 'old words', attribution: 'provider_transcript' },
        turnEnds,
      ]).rows,
    )
    expect(imported).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⛔ every other ending is its giver’s to hear: a stop, a stop asked for, a usage limit, a refused sign-in', () => {
    const endsWith = (...ending: TranscriptEvent[]): PieceRow =>
      pieceIn(fold([given(), working, aPersonWrites(), ...ending]).rows)
    expect(endsWith({ type: 'turn', state: 'interrupted' })).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_interrupted',
    })
    // ⚑ A stop the provider finished anyway: still the person's ask riding on the turn's own word.
    expect(endsWith({ type: 'work_interrupted', by: 'a-person' }, turnEnds)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
      stalledBy: { by: 'a-person' },
    })
    expect(
      endsWith({
        type: 'turn',
        state: 'failed',
        limit: { provider: 'claude', resetsAt: 99_000_000 },
      } as TranscriptEvent),
    ).toMatchObject({ state: 'stalled', stalledBecause: 'provider_limited' })
    expect(
      endsWith({ type: 'turn', state: 'failed', loginRefused: true } as TranscriptEvent),
    ).toMatchObject({ state: 'stalled', stalledBecause: 'login_refused' })
    // ⚑ A failed turn with neither is the turn ending on its own, as `completed` is.
    expect(endsWith({ type: 'turn', state: 'failed' }).state).toBe(WAITS)
  })

  it('⚑ a piece a PERSON gave still waits on the person who asked, whoever opened the turn', () => {
    const taken = pieceIn(
      fold([given('work_1', 'W1.1', null), working, aPersonWrites(), turnEnds]).rows,
    )
    expect(taken.state).toBe<TaskState>('waiting-on-the-person-who-asked')
    expect(taken).not.toHaveProperty('answeredAPersonAt')
  })

  it('⚑ the queue’s hold keeps whose words opened the turn, for the ending it puts off', () => {
    const queued: TranscriptEvent = {
      type: 'message_queued',
      messageId: 'msg_1',
      kind: 'notice',
      text: 'later',
    } as TranscriptEvent
    const held = [given(), working, aPersonWrites(), queued, turnEnds, idle]
    // ⚑ A message waiting will drive it, so the turn's end holds it: still working.
    expect(pieceIn(fold(held).rows)).toMatchObject({ state: 'working', ...noStall })
    // ⚑ The message leaves unsent: the held ending is written — the person's turn's, so the wait.
    const { rows, at } = fold([
      ...held,
      {
        type: 'message_unqueued',
        messageId: 'msg_1',
        reason: 'abandoned',
        text: 'later',
      } as TranscriptEvent,
    ])
    expect(pieceIn(rows).state).toBe(WAITS)
    expect(pieceIn(rows).answeredAPersonAt).toBe(at(6))
    // ⛔ The control: the same hold under the giver's turn stalls when it is let go.
    const underTheGiver = pieceIn(
      fold([
        given(),
        working,
        theGiverWrites('note'),
        queued,
        turnEnds,
        idle,
        {
          type: 'message_unqueued',
          messageId: 'msg_1',
          reason: 'abandoned',
          text: 'later',
        } as TranscriptEvent,
      ]).rows,
    )
    expect(underTheGiver).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('keeps person-given work held for a queued note after cancelling the substantive reply', () => {
    const prefix: TranscriptEvent[] = [
      given('work_1', 'W1.1', null),
      working,
      aPersonWrites(),
      { type: 'message_queued', messageId: 'msg_reply', kind: 'notice', text: 'later' },
      {
        type: 'message_queued',
        messageId: 'msg_note',
        kind: 'notice',
        text: 'standing rule',
        attribution: 'app_authored',
        relayedFrom: THE_GIVER,
        says: 'note',
      },
      turnEnds,
      idle,
      { type: 'message_unqueued', messageId: 'msg_reply', reason: 'cancelled', text: 'later' },
    ]
    const held = pieceIn(fold(prefix).rows)
    expect(held).toMatchObject({ state: 'working', ...noStall })
    expect(held).not.toHaveProperty('answeredAPersonAt')
    const released = pieceIn(
      fold([
        ...prefix,
        {
          type: 'message_unqueued',
          messageId: 'msg_note',
          reason: 'cancelled',
          text: 'standing rule',
        },
      ]).rows,
    )
    expect(released.state).toBe('waiting-on-the-person-who-asked')
    expect(released).not.toHaveProperty('answeredAPersonAt')
  })

  it.each([
    ['helper', THE_GIVER, WAITS],
    ['person', null, 'working'],
  ] as const)(
    'releases a %s-given background hold according to its note queue',
    (_name, giver, state) => {
      const prefix: TranscriptEvent[] = [
        given('work_1', 'W1.1', giver),
        working,
        aPersonWrites(),
        {
          type: 'background_work',
          running: [{ id: 'bg_1', description: 'npm run build' }],
          source: 'test',
        },
        turnEnds,
        idle,
        given('work_2', 'W1.2'),
        working,
        theBrief('work_2', 'W1.2'),
        {
          type: 'message_queued',
          messageId: 'msg_note',
          kind: 'notice',
          text: 'standing rule',
          attribution: 'app_authored',
          relayedFrom: THE_GIVER,
          says: 'note',
        },
        { type: 'background_work', ended: { id: 'bg_1', outcome: 'completed' }, source: 'test' },
      ]
      const released = fold(prefix, { backgroundWakesIt: true })
      const piece = pieceIn(released.rows)
      expect(piece).toMatchObject({ state, ...noStall })
      expect(piece).not.toHaveProperty('inTheBackground')
      if (giver === null) {
        expect(piece).not.toHaveProperty('answeredAPersonAt')
        const unqueued = pieceIn(
          fold(
            [
              ...prefix,
              {
                type: 'message_unqueued',
                messageId: 'msg_note',
                reason: 'cancelled',
                text: 'standing rule',
              },
            ],
            { backgroundWakesIt: true },
          ).rows,
        )
        expect(unqueued.state).toBe('waiting-on-the-person-who-asked')
      } else {
        expect(piece.answeredAPersonAt).toBe(released.at(prefix.length - 1))
      }
    },
  )

  it('keeps a helper background hold through a note and establishes its personal wait on release', () => {
    const prefix: TranscriptEvent[] = [
      given(),
      working,
      aPersonWrites(),
      {
        type: 'background_work',
        running: [{ id: 'bg_1', description: 'npm run build' }],
        source: 'test',
      },
      turnEnds,
      idle,
      working,
      theGiverWrites('note'),
    ]
    expect(pieceIn(fold(prefix, { backgroundWakesIt: true }).rows)).toMatchObject({
      state: 'working',
      inTheBackground: ['npm run build'],
    })
    const finished: TranscriptEvent = {
      type: 'background_work',
      ended: { id: 'bg_1', outcome: 'completed' },
      source: 'test',
    }
    const released = fold([...prefix, finished], { backgroundWakesIt: true })
    expect(pieceIn(released.rows)).toMatchObject({
      state: WAITS,
      answeredAPersonAt: released.at(8),
    })
    const ended = fold([...prefix, finished, turnEnds, idle], { backgroundWakesIt: true })
    expect(pieceIn(ended.rows)).toMatchObject({ state: WAITS, answeredAPersonAt: released.at(8) })
  })

  it('⚑ the background’s hold keeps it too, and a wake goes on with the turn before it', () => {
    const running: TranscriptEvent = {
      type: 'background_work',
      running: [{ id: 'bg_1', description: 'npm run build' }],
      source: 'test',
    } as TranscriptEvent
    const finished: TranscriptEvent = {
      type: 'background_work',
      ended: { id: 'bg_1', outcome: 'completed' },
      source: 'test',
    } as TranscriptEvent
    const heldForIt = [given(), working, aPersonWrites(), running, turnEnds, idle]
    expect(pieceIn(fold(heldForIt, { backgroundWakesIt: true }).rows)).toMatchObject({
      state: 'working',
      inTheBackground: ['npm run build'],
    })
    // ⚑ The background ends: the held ending is written, the person's turn's.
    const released = fold([...heldForIt, finished], { backgroundWakesIt: true })
    expect(pieceIn(released.rows).state).toBe(WAITS)
    // ⚑ Its provider wakes it and the wake ends with the work open: a wake has no words of its own,
    // so it goes on from the turn the person's words opened — still waiting on them.
    const theWake: TranscriptEvent[] = [
      working,
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      idle,
    ]
    const afterTheWake = fold([...heldForIt, finished, ...theWake], { backgroundWakesIt: true })
    expect(pieceIn(afterTheWake.rows).state).toBe(WAITS)
    expect(pieceIn(afterTheWake.rows).answeredAPersonAt).toBe(afterTheWake.at(8))
    // ⛔ The control: a wake after the giver's turn stalls the work, as it always did.
    const afterTheGivers = pieceIn(
      fold(
        [given(), working, theGiverWrites('note'), running, turnEnds, idle, finished, ...theWake],
        { backgroundWakesIt: true },
      ).rows,
    )
    expect(afterTheGivers).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⚑ each piece keeps whose words last drove it: a wake after the giver’s brief for ANOTHER piece leaves this one waiting on the person', () => {
    // W1.1 waits on the person; then W1.2's brief runs, names only W1.2, and ends with it open.
    const thenW2: TranscriptEvent[] = [
      ...answeredThePerson,
      given('work_2', 'W1.2'),
      working,
      theBrief('work_2', 'W1.2'),
      turnEnds,
      idle,
    ]
    const before = fold(thenW2).rows
    expect(pieceIn(before).state).toBe(WAITS)
    expect(pieceIn(before, 'work_2')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    // ⚑ A wake — its provider's own turn, and a ledger's older shape with no turn row — drives
    // every piece; at its end each is judged by the words that last drove it: W1.1 the person's,
    // W1.2 the giver's.
    for (const [shape, wake] of [
      [
        'a turn its provider started',
        [working, { type: 'turn', state: 'completed', startedBy: 'the-provider' }, idle],
      ],
      ['an older ledger’s wake', [working, idle]],
    ] as const) {
      const after = fold([...thenW2, ...(wake as readonly TranscriptEvent[])]).rows
      expect(pieceIn(after).state, shape).toBe(WAITS)
      expect(pieceIn(after, 'work_2'), shape).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_ended',
      })
    }
  })

  it('⚑ a wake that was due and never ran — its session ended on a refused sign-in — stalls on that sign-in', () => {
    const running: TranscriptEvent = {
      type: 'background_work',
      running: [{ id: 'bg_1', description: 'npm run build' }],
      source: 'test',
    } as TranscriptEvent
    const finished: TranscriptEvent = {
      type: 'background_work',
      ended: { id: 'bg_1', outcome: 'completed' },
      source: 'test',
    } as TranscriptEvent
    const ended = pieceIn(
      fold(
        [
          given(),
          working,
          aPersonWrites(),
          running,
          turnEnds,
          idle,
          finished,
          { type: 'status', state: 'errored', loginRefused: true } as TranscriptEvent,
        ],
        { backgroundWakesIt: true },
      ).rows,
    )
    expect(ended).toMatchObject({ state: 'stalled', stalledBecause: 'login_refused' })
  })

  it('⚑ a launch leaves it waiting, and a replacement stalls it as it stalls every open piece', () => {
    const launched = pieceIn(
      fold([...answeredThePerson, { type: 'work_restarted', pieces: ['work_1'] }]).rows,
    )
    expect(launched.state).toBe(WAITS)
    const replaced = pieceIn(
      fold([...answeredThePerson, { type: 'replaced_by', sessionId: 'sess_eli_2' }]).rows,
    )
    expect(replaced).toMatchObject({ state: 'stalled', stalledBecause: 'could_not_be_reopened' })
    expect(replaced).not.toHaveProperty('answeredAPersonAt')
  })

  it('⛔ a reply ends it, as it ends every open piece', () => {
    const answered = pieceIn(
      fold([
        ...answeredThePerson,
        working,
        aPersonWrites('send it back'),
        { type: 'work_replied', piece: 'work_1', outcome: 'done', summary: 'done', resources: [] },
        turnEnds,
      ] as TranscriptEvent[]).rows,
    )
    expect(answered.state).toBe<TaskState>('answered')
    expect(answered).not.toHaveProperty('answeredAPersonAt')
  })
})
