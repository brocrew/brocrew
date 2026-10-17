import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { joinsARun } from '../src/renderer/src/lib/tool-runs'
import {
  A_PERSON_ADDRESSED,
  OUTGOING_STATE_WORD,
  outgoingCard,
  STATUS_LEAD,
  TOOK_ON_WORD,
  type OutgoingCardReading,
  type OutgoingCardWords,
} from '../src/renderer/src/lib/outgoing-card'
import { tookOnForPerson } from '../src/main/runtime/agent-tool-answer-words'
import { pieceLine } from '../src/shared/piece-called'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 UI-003 · a request its conversation took on for the person, drawn as a card
 *
 * ⚑ **F038** — `take_on_work` drew only as a line in the tool run. ⚑ **What the card says**: *BroBot
 * took on · W1.7 · for you*, the piece's title above its brief. The door writes the piece's
 * `work_given` (`givenBy: null`, the one row only it writes) into THIS ledger, and the fold lands it
 * on the call — so the card draws the whole brief, where the call's arguments are cut at 200.
 *
 * ⛔ **Every negative here is paired with the same fold one fact over** — the row and none, a
 * person's row and a conversation's, a refusal and a success — because a card that said nothing
 * would pass every absence.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 1 | the receipt the card reads is the tool's own sentence | — |
 * | 2 | the call is recognised and leaves the tool run | a session never told its tools' names |
 * | 3 | the card's words, whole brief from the row, in either order | a conversation's give, a refusal, a cut, a run that ended |
 * | 4 | the finishing reply goes to *you*, with no receipt | its give out of view, an error |
 * | 5 | the piece's status line stands on the card until the reply | another piece's line |
 * | 6 | a row lands on the take-on that wrote it, by its title | a dead take-on, a pair with one title |
 */

const here = dirname(fileURLToPath(import.meta.url))

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const CODEX = { prefix: '', separator: '__' }

const inventory = (naming = CLAUDE): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming,
    declared: {
      server: 'brobot',
      tools: [
        { name: 'take_on_work', description: '', parameters: [] },
        { name: 'give_work', description: '', parameters: [] },
        { name: 'reply_to_parent', description: '', parameters: [] },
      ],
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, args: Record<string, unknown>, name = 'mcp__brobot__take_on_work') =>
  ({ type: 'tool_call', id, name, summary: JSON.stringify(args).slice(0, 200) }) as TranscriptEvent

const result = (id: string, summary: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

const TITLE = 'Test shared memory'
/** ⚑ A brief well past the 200 the arguments are cut at. */
const BRIEF =
  `${'Check that two agents of one profile see the same notes, and that a third does not. '.repeat(4)}`.trim()

/** ⚑ The door's own row: the piece, taken on for the person (`givenBy: null`). */
const takenOn = (
  piece = 'work_7',
  label = 'W1.7',
  givenBy: string | null = null,
  title = TITLE,
): TranscriptEvent =>
  ({
    type: 'work_given',
    piece,
    label,
    parent: 'work_1',
    givenBy,
    title,
    brief: BRIEF,
  }) as unknown as TranscriptEvent

/** ⚑ The receipt as `take_on_work` writes it. */
const TOOK = (label = 'W1.7', title = TITLE) =>
  `Took on ${label} · ${title}, under W1, your conversation’s own work. Nobody was sent anything; when it is done, finish it with reply_to_parent naming ${label}.`.slice(
    0,
    200,
  )

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const tool = (state: TranscriptState, callId: string): ToolItem => {
  const found = state.items.find(
    (item): item is ToolItem & (typeof state.items)[number] =>
      item.kind === 'tool' && item.callId === callId,
  )
  expect(found, `no tool row for ${callId}`).toBeDefined()
  return found as ToolItem
}

const cardOf = (events: readonly TranscriptEvent[], callId = 'c1'): OutgoingCardReading => {
  const item = tool(fold(events), callId)
  expect(item.outgoing, 'the call was not recognised').toBeDefined()
  return outgoingCard(item, item.outgoing as OutgoingCardWords, null, new Set())
}

const ARGS = { title: TITLE, brief: BRIEF }

describe('§1 · the receipt this card reads is the tool’s own sentence', () => {
  it('🔴 `take_on_work` still words its receipt the way the card reads it', () => {
    const source = readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8')
    expect(source).toContain('tookOnForPerson(taken.label, taken.root)')
    expect(tookOnForPerson('W1.7', 'W1')).toBe('Took on W1.7 under W1 for the person.')
    expect(pieceLine('W1.7', TITLE)).toBe(`W1.7 · ${TITLE}`)
  })
})

describe('§2 · the call is recognised and leaves the tool run', () => {
  it('🔴 on Claude and on Codex, by the names the session was handed', () => {
    for (const [naming, name] of [
      [CLAUDE, 'mcp__brobot__take_on_work'],
      [CODEX, 'brobot__take_on_work'],
    ] as const) {
      const item = tool(fold([inventory(naming), call('c1', ARGS, name)]), 'c1')
      expect(item.outgoing).toEqual({ tool: 'take_on_work', taken: null })
      expect(joinsARun(item)).toBe(false)
    }
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row', () => {
    const item = tool(fold([call('c1', ARGS), takenOn(), result('c1', TOOK())]), 'c1')
    expect(item.outgoing).toBeUndefined()
    expect(joinsARun(item)).toBe(true)
  })
})

describe('§3 · the card: who took on what, for whom, with its whole brief', () => {
  it('reads the current parent receipt and retains the recorded title', () => {
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      takenOn(),
      result('c1', tookOnForPerson('W1.7', 'W1') + ' The giver was told.'),
    ])
    expect(card.state).toBe('taken-on')
    expect(card.piece).toBe('W1.7')
    expect(card.title).toBe(TITLE)
    expect(card.body).toBe(BRIEF)
  })

  it('the current short receipt keeps the card and obtains its title from the recorded request', () => {
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      takenOn(),
      result(
        'c1',
        'Took on W1.7. Nobody was sent anything; when it is ready to hand back, finish it with reply_to_parent naming W1.7.',
      ),
    ])
    expect(card.state).toBe('taken-on')
    expect(card.piece).toBe('W1.7')
    expect(card.title).toBe(TITLE)
    expect(card.body).toBe(BRIEF)
    expect(card.receipt).toBeNull()
  })

  it('🔴 the row after the call: *took on · W1.7 · for you*, the title, the WHOLE brief, no receipt', () => {
    const card = cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())])
    expect(card.state).toBe('taken-on')
    expect(card.joiner).toBe(TOOK_ON_WORD)
    expect(card.recipient).toBe('')
    expect(card.piece).toBe('W1.7')
    expect(OUTGOING_STATE_WORD[card.state]).toBe(`for ${A_PERSON_ADDRESSED}`)
    expect(card.title).toBe(TITLE)
    expect(card.body).toBe(BRIEF)
    expect(BRIEF.length).toBeGreaterThan(200)
    expect(card.bodyIsCut).toBe(false)
    expect(card.receipt).toBeNull()
  })

  it('🔴 the row BEFORE the call is claimed by it — the same card', () => {
    const card = cardOf([inventory(), takenOn(), call('c1', ARGS), result('c1', TOOK())])
    expect(card.state).toBe('taken-on')
    expect(card.body).toBe(BRIEF)
    expect(card.piece).toBe('W1.7')
  })

  it('⛔ a piece a CONVERSATION gave lands on no take-on — the person’s row, one fact over, does', () => {
    const given = cardOf([
      inventory(),
      call('c1', ARGS),
      takenOn('work_8', 'W1.8', 'sess_giver'),
      result('c1', TOOK()),
    ])
    // ⚑ Only the receipt names the piece; the brief is the arguments' excerpt, and says it was cut.
    expect(given.piece).toBe('W1.7')
    expect(given.body).not.toBe(BRIEF)
    expect(given.bodyIsCut).toBe(true)
    const mine = cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())])
    expect(mine.body).toBe(BRIEF)
  })

  it('⛔ a refusal says only its sender, with the receipt under it — a success beside it says *took on*', () => {
    const refused = cardOf([
      inventory(),
      call('c1', ARGS),
      result('c1', 'refused (no-work-of-your-own): this conversation holds no work of its own.'),
    ])
    expect(refused.state).toBe('answered')
    expect(refused.joiner).toBe('')
    expect(refused.piece).toBeNull()
    expect(refused.receipt).toContain('refused')
    const took = cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())])
    expect(took.joiner).toBe(TOOK_ON_WORD)
    expect(took.receipt).toBeNull()
  })

  it('⚑ while it runs it is *taking it on*; a run that ended first *did not finish*', () => {
    const running = cardOf([inventory(), call('c1', ARGS)])
    expect(running.state).toBe('taking-on')
    expect(running.joiner).toBe('')
    expect(OUTGOING_STATE_WORD[running.state]).toBe('taking it on…')
    // ⚑ The run ended before the call answered: its card says so, never *taking it on*.
    const interrupted = { type: 'turn', state: 'interrupted' } as TranscriptEvent
    const ended = cardOf([inventory(), call('c1', ARGS), interrupted])
    expect(tool(fold([inventory(), call('c1', ARGS), interrupted]), 'c1').unfinished).toBe(true)
    expect(ended.state).toBe('did-not-finish')
  })

  it('⛔ a receipt whose label is not one reads as the receipt, never as a piece taken on', () => {
    const odd = cardOf([
      inventory(),
      call('c1', ARGS),
      result('c1', `Took on W0 · ${TITLE}, under W0.`),
    ])
    expect(odd.state).toBe('answered')
    expect(odd.receipt).toContain('Took on W0')
    // ⚑ The pair: the tool's own sentence with a real label, and no row, is taken on.
    const fine = cardOf([inventory(), call('c1', ARGS), result('c1', TOOK('W1.9'))])
    expect(fine.state).toBe('taken-on')
    expect(fine.piece).toBe('W1.9')
    expect(fine.bodyIsCut).toBe(true)
  })

  it('⛔ a call that ERRORED or never answered after its row landed is not *took on* — the answered one beside it is', () => {
    const errored = cardOf([
      inventory(),
      call('c1', ARGS),
      takenOn(),
      result('c1', 'the piece could not be kept', false),
    ])
    expect(errored.state).toBe('failed')
    expect(errored.joiner).toBe('')
    expect(errored.receipt).toBe('the piece could not be kept')
    const interrupted = { type: 'turn', state: 'interrupted' } as TranscriptEvent
    const ended = cardOf([inventory(), call('c1', ARGS), takenOn(), interrupted])
    expect(ended.state).toBe('did-not-finish')
    expect(ended.joiner).toBe('')
    const took = cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())])
    expect(took.state).toBe('taken-on')
    expect(took.joiner).toBe(TOOK_ON_WORD)
  })

  it('🔴 a landed row makes it *taken on* whatever its receipt says — the same receipt without the row does not', () => {
    const landed = cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', 'ok')])
    expect(landed.state).toBe('taken-on')
    expect(landed.piece).toBe('W1.7')
    expect(cardOf([inventory(), call('c1', ARGS), result('c1', 'ok')]).state).toBe('answered')
  })

  it('⛔ a title cut in the arguments is not drawn as the title — a whole one is', () => {
    const long = { title: 'A long title '.repeat(20).trim(), brief: BRIEF }
    expect(JSON.stringify(long).length).toBeGreaterThan(200)
    expect(cardOf([inventory(), call('c1', long), result('c1', TOOK())]).title).toBeNull()
    expect(cardOf([inventory(), call('c1', ARGS), result('c1', TOOK())]).title).toBe(TITLE)
  })

  it('⛔ a replayed row with no brief lands on no card — its receipt and the arguments speak', () => {
    const noBrief = { ...(takenOn() as unknown as Record<string, unknown>) }
    delete noBrief.brief
    const card = cardOf([
      inventory(),
      call('c1', ARGS),
      noBrief as unknown as TranscriptEvent,
      result('c1', TOOK()),
    ])
    expect(card.piece).toBe('W1.7')
    expect(card.body).not.toBe('')
    expect(card.bodyIsCut).toBe(true)
    expect(cardOf([inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())]).body).toBe(
      BRIEF,
    )
  })
})

/* ------------------------------------------------------------------ §4 · the finishing reply */

const SUMMARY = 'Two agents of one profile see the same notes; a third does not. Done.'

const replyCall = (id: string) =>
  ({
    type: 'tool_call',
    id,
    name: 'mcp__brobot__reply_to_parent',
    summary: JSON.stringify({ piece: 'W1.7', outcome: 'done', summary: SUMMARY }),
  }) as TranscriptEvent

const replied = (resources: string[] = ['res_notes']): TranscriptEvent =>
  ({
    type: 'work_replied',
    piece: 'work_7',
    outcome: 'done',
    summary: SUMMARY,
    resources,
  }) as unknown as TranscriptEvent

const RECEIPT =
  'W1.7 answered · it was a person’s own request, so the reply went to no other conversation — tell them here.'

describe('§4 · the finishing reply: *to you · W1.7 · done*, its summary and its files — and nothing to the model', () => {
  it('🔴 a reply to a piece taken on goes to *you*, under its label and outcome, with its summary and files, and no receipt', () => {
    const card = cardOf(
      [
        inventory(),
        call('c1', ARGS),
        takenOn(),
        result('c1', TOOK()),
        replyCall('c2'),
        replied(),
        result('c2', RECEIPT),
      ],
      'c2',
    )
    expect(card.tool).toBe('reply_to_parent')
    expect(card.recipient).toBe(A_PERSON_ADDRESSED)
    expect(card.facts?.heading).toBe('W1.7')
    expect(card.facts?.outcome).toBe('done')
    expect(card.body).toBe(SUMMARY)
    expect(card.resources).toEqual(['res_notes'])
    expect(card.receipt).toBeNull()
  })

  it('⛔ the same reply with its give out of view names *its parent* and *Piece*, and prints the receipt — it may be anyone’s', () => {
    const card = cardOf([inventory(), replyCall('c2'), replied(), result('c2', RECEIPT)], 'c2')
    expect(card.recipient).not.toBe(A_PERSON_ADDRESSED)
    expect(card.facts?.heading).toBe('Piece')
    expect(card.receipt).toBe(RECEIPT)
  })

  it('⛔ a reply to the person whose call ERRORED prints what the tool said', () => {
    const card = cardOf(
      [
        inventory(),
        call('c1', ARGS),
        takenOn(),
        result('c1', TOOK()),
        replyCall('c2'),
        replied(),
        result('c2', 'the reply could not be kept', false),
      ],
      'c2',
    )
    expect(card.recipient).toBe(A_PERSON_ADDRESSED)
    expect(card.state).toBe('failed')
    expect(card.receipt).toBe('the reply could not be kept')
  })
})

/* ------------------------------------------------------------------ §5 · its status line */

const status = (line: string, piece = 'work_7'): TranscriptEvent =>
  ({ type: 'work_status_set', piece, line, by: 'sess_1' }) as unknown as TranscriptEvent

describe('§5 · a status line set on the piece stands on its take-on card — until the reply', () => {
  const TOOK_IT = [inventory(), call('c1', ARGS), takenOn(), result('c1', TOOK())]

  it('🔴 the newest line stands, under the lead the card writes', () => {
    const card = cardOf([...TOOK_IT, status('Running test 2 of 5'), status('Running test 3 of 5')])
    expect(card.status).toBe('Running test 3 of 5')
    expect(STATUS_LEAD).toBe('Status:')
  })

  it('⛔ a line set on ANOTHER piece does not land here — this piece’s, one fact over, does', () => {
    expect(cardOf([...TOOK_IT, status('Checking W1.8', 'work_8')]).status).toBeNull()
    expect(cardOf([...TOOK_IT, status('Checking W1.7')]).status).toBe('Checking W1.7')
  })

  it('⛔ the reply that finishes it takes the line away — its summary is the last word', () => {
    const before = cardOf([...TOOK_IT, status('Almost there'), replyCall('c2')])
    expect(before.status).toBe('Almost there')
    const after = cardOf([
      ...TOOK_IT,
      status('Almost there'),
      replyCall('c2'),
      replied(),
      result('c2', RECEIPT),
    ])
    expect(after.status).toBeNull()
  })

  it('⚑ a line set while the row still waits ahead of its call is on the card the call claims', () => {
    const card = cardOf([
      inventory(),
      takenOn(),
      status('Starting'),
      call('c1', ARGS),
      result('c1', TOOK()),
    ])
    expect(card.state).toBe('taken-on')
    expect(card.status).toBe('Starting')
    // ⛔ The pair: a line on ANOTHER piece while the row waits ahead stays off this card.
    const other = cardOf([
      inventory(),
      takenOn(),
      status('Elsewhere', 'work_8'),
      call('c1', ARGS),
      result('c1', TOOK()),
    ])
    expect(other.status).toBeNull()
  })
})

/* ------------------------------------------------------------------ §6 · which call a row is for */

describe('§6 · a row lands on the take-on that wrote it — by the title both carry', () => {
  const interrupted = { type: 'turn', state: 'interrupted' } as TranscriptEvent
  const again = { type: 'user_turn', text: 'and another thing' } as TranscriptEvent
  const SECOND = 'Test the rail'

  it('🔴 a take-on whose run died never takes a later one’s row that came ahead of its call', () => {
    const state = fold([
      inventory(),
      call('c1', { title: 'First thing', brief: 'first' }),
      interrupted,
      again,
      takenOn('work_8', 'W1.8', null, SECOND),
      call('c2', { title: SECOND, brief: BRIEF }),
      result('c2', TOOK('W1.8', SECOND)),
      status('Running', 'work_8'),
    ])
    const dead = tool(state, 'c1')
    const deadCard = outgoingCard(dead, dead.outgoing as OutgoingCardWords, null, new Set())
    expect(deadCard.state).toBe('did-not-finish')
    expect(deadCard.piece).toBeNull()
    expect(deadCard.title).toBe('First thing')
    expect(deadCard.status).toBeNull()
    const live = tool(state, 'c2')
    const liveCard = outgoingCard(live, live.outgoing as OutgoingCardWords, null, new Set())
    expect(liveCard.piece).toBe('W1.8')
    expect(liveCard.title).toBe(SECOND)
    expect(liveCard.body).toBe(BRIEF)
    expect(liveCard.status).toBe('Running')
  })

  it('🔴 two taken on in one batch each keep their own row and status — ⛔ two with ONE title land on neither', () => {
    const batch = (second: string) =>
      fold([
        inventory(),
        call('c1', ARGS),
        call('c2', { title: second, brief: BRIEF }),
        takenOn(),
        takenOn('work_8', 'W1.8', null, second),
        result('c1', TOOK()),
        result('c2', TOOK('W1.8', second)),
        status('Running one'),
        status('Running two', 'work_8'),
      ])
    const card = (state: TranscriptState, id: string) => {
      const item = tool(state, id)
      return outgoingCard(item, item.outgoing as OutgoingCardWords, null, new Set())
    }
    const apart = batch(SECOND)
    expect(card(apart, 'c1')).toMatchObject({ piece: 'W1.7', title: TITLE, status: 'Running one' })
    expect(card(apart, 'c2')).toMatchObject({ piece: 'W1.8', title: SECOND, status: 'Running two' })
    expect(card(apart, 'c1').bodyIsCut).toBe(false)
    // ⛔ One title: the arguments cannot tell them apart, so neither row lands — never a guess.
    const alike = batch(TITLE)
    expect(card(alike, 'c1').bodyIsCut).toBe(true)
    expect(card(alike, 'c2').bodyIsCut).toBe(true)
    expect(card(alike, 'c1').piece).toBe('W1.7')
    expect(card(alike, 'c2').piece).toBe('W1.8')
  })

  it('⚑ the title is compared as its door keeps it, trimmed — ⛔ a call that named another title is not the row’s', () => {
    const padded = cardOf([
      inventory(),
      call('c1', { title: `  ${TITLE}  `, brief: BRIEF }),
      takenOn(),
      result('c1', TOOK()),
    ])
    expect(padded.bodyIsCut).toBe(false)
    expect(padded.body).toBe(BRIEF)
    const other = cardOf([
      inventory(),
      call('c1', { title: 'Something else', brief: BRIEF }),
      takenOn(),
      result('c1', TOOK()),
    ])
    expect(other.bodyIsCut).toBe(true)
  })
})
