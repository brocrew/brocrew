import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { drawsAsACard } from '../src/renderer/src/lib/draws-as-a-card'
import { inACard } from '../src/renderer/src/lib/from-outside'
import { joinsARun, transcriptRows } from '../src/renderer/src/lib/tool-runs'
import {
  AN_UNNAMED_RECIPIENT,
  NEW_BRIEF_MARK,
  outgoingCard,
  type OutgoingCardReading,
  type OutgoingCardWords,
} from '../src/renderer/src/lib/outgoing-card'
import type { AgentIdentity, TranscriptEvent, WorkSentEvent } from '../src/shared/runtime-ipc'
import type { WorkEdge } from '../src/shared/who-called-whom'

/**
 * # 🔴 D-047 · a new brief given with `update_work` draws as a card
 *
 * ⚑ **`9aa04094`** — an `update_work` call that carried a new brief draws like a give: the agent it
 * went to, the piece's label, *New brief*, the piece's title and the WHOLE new brief, off the
 * `work_sent` row (`as: 'rebriefed'`) its conversation keeps. ⚑ A call is matched to its row by its
 * piece (id or label) AND its brief. ⛔ Any other `update_work` — a status, a title, a close — and a
 * call whose row is not there (an older ledger, a refused call, the moment before the row) keeps the
 * tool row it always drew. ⚑ One predicate, `drawsAsACard`, is what the transcript, `inACard`,
 * `joinsARun` and a refusal's receipt all ask.
 *
 * ⛔ **Every negative is paired with the same fold one fact over.**
 *
 * | § | subject | ⛔ paired with |
 * |---|---|---|
 * | 1 | a brief call and its row: a card, in both arrival orders, whole | the same call with no row: a tool row |
 * | 2 | which `update_work` is a candidate at all | a status-only call, a title-only call, a session never told its tools |
 * | 3 | which row a call takes | a row for another piece, a call whose brief was cut out of its arguments |
 * | 4 | every surface asks one predicate | a refusal's receipt, printed on its notice only when no card prints it |
 */

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const CODEX = { prefix: '', separator: '__' }

const inventory = (naming = CLAUDE): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming,
    declared: {
      server: 'brobot',
      tools: [
        { name: 'give_work', description: '', parameters: [] },
        { name: 'update_work', description: '', parameters: [] },
      ],
    },
    published: null,
  }) as unknown as TranscriptEvent

const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Make the rail say what the card says'
const FIRST_BRIEF = 'The rail and the card disagree. Find why.'
/** ⚑ A new brief well past the 200 characters a call's arguments are cut at — plain words, no escapes. */
const NEW_BRIEF =
  'Use the second table, not the first one, and say which rows moved and why they moved. '
    .repeat(5)
    .trim()
const ANOTHER_BRIEF = 'Leave the tables alone; look at the cache instead.'

/** ⚑ The provider's tool row: the arguments as JSON, cut at 200 as both adapters cut them. */
const call = (
  id: string,
  args: Record<string, unknown>,
  name = 'mcp__brobot__update_work',
): TranscriptEvent => {
  const whole = JSON.stringify(args)
  return {
    type: 'tool_call',
    id,
    name,
    summary: whole.length > 200 ? `${whole.slice(0, 200)}…` : whole,
  } as TranscriptEvent
}

const result = (id: string, summary: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

const RECEIPT = 'W1.2 · its new brief went to Ayo straight away.'

/** ⚑ The giver's own row of a new brief — `RuntimeHost.noteWhatItGave` in `updateWork`. */
const rebriefed = (over: Partial<WorkSentEvent> = {}): WorkSentEvent => ({
  type: 'work_sent',
  piece: 'work_12',
  label: 'W1.2',
  as: 'rebriefed',
  to: OWNER,
  title: TITLE,
  brief: NEW_BRIEF,
  ...over,
})

/** ⚑ A new brief for W1.2, named by its label. */
const BRIEF_ARGS = { piece: 'W1.2', brief: NEW_BRIEF }

const GAVE_OUT: WorkEdge[] = [
  {
    piece: 'work_12',
    label: 'W1.2',
    title: TITLE,
    from: 'sess_giver',
    fromIdentity: 'brobot',
    to: OWNER,
    toIdentity: 'dev',
    state: 'working',
    givenAt: 0,
    endedAt: null,
  },
]

const IDS = [
  { id: 'aid:brobot', slug: 'brobot', displayName: 'BroBot' },
  { id: 'aid:dev', slug: 'dev', displayName: 'Ayo' },
] as unknown as AgentIdentity[]

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

const cardIn = (
  state: TranscriptState,
  callId = 'u1',
  gaveOut: readonly WorkEdge[] | null = null,
): OutgoingCardReading => {
  const item = tool(state, callId)
  expect(item.outgoing, 'the call was not recognised').toBeDefined()
  return outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, new Set(), gaveOut)
}

/** ⚑ The new brief its row put on the call — `null` where none landed, `undefined` where not a candidate. */
const rebriefOn = (state: TranscriptState, callId: string) => {
  const words = tool(state, callId).outgoing
  return words?.tool === 'update_work' ? words.rebriefed : undefined
}

/** ⚑ Is the call a member of a tool run, as `TranscriptView` draws the rows. */
const inARun = (state: TranscriptState, callId: string): boolean =>
  transcriptRows(state.items).some(
    (row) => row.kind === 'run' && row.calls.some((one) => one.callId === callId),
  )

/* ============================================================================================= */

describe('§1 · a new brief and its row draw as a card', () => {
  it('🔴 the call first, then its row: *to Ayo · W1.2 · New brief*, the title, the WHOLE new brief, not cut', () => {
    const state = fold([inventory(), call('u1', BRIEF_ARGS), rebriefed(), result('u1', RECEIPT)])
    expect(rebriefOn(state, 'u1')).toEqual({
      piece: 'work_12',
      label: 'W1.2',
      title: TITLE,
      brief: NEW_BRIEF,
      to: OWNER,
    })
    expect(NEW_BRIEF.length).toBeGreaterThan(200)
    const card = cardIn(state, 'u1', GAVE_OUT)
    expect(card).toMatchObject({
      tool: 'update_work',
      recipient: 'Ayo',
      mark: NEW_BRIEF_MARK,
      piece: 'W1.2',
      title: TITLE,
      body: NEW_BRIEF,
      bodyIsCut: false,
      wholeBrief: null,
    })
    expect(NEW_BRIEF_MARK).toBe('New brief')
    expect(card.where?.conversation).toBe(OWNER)
    const item = tool(state, 'u1')
    expect(drawsAsACard(item)).toBe(true)
    expect(joinsARun(item)).toBe(false)
  })

  it('🔴 the row FIRST, then its call — claimed by it: the same card', () => {
    const state = fold([inventory(), rebriefed(), call('u1', BRIEF_ARGS), result('u1', RECEIPT)])
    expect(state.outgoingAhead).toHaveLength(0)
    const card = cardIn(state)
    expect(card.body).toBe(NEW_BRIEF)
    expect(card.bodyIsCut).toBe(false)
    expect(card.mark).toBe(NEW_BRIEF_MARK)
    expect(card.piece).toBe('W1.2')
    expect(drawsAsACard(tool(state, 'u1'))).toBe(true)
  })

  it('⚑ while the call runs its landed row already draws — sending; ⚑ no cast read: *another agent*, and the row’s `to` opens', () => {
    const state = fold([inventory(), call('u1', BRIEF_ARGS), rebriefed()])
    const card = cardIn(state)
    expect(card.state).toBe('sending')
    expect(card.body).toBe(NEW_BRIEF)
    expect(card.recipient).toBe(AN_UNNAMED_RECIPIENT)
    expect(card.where?.conversation).toBe(OWNER)
  })

  it('⛔ a brief call whose row is not there (an older ledger) stays the tool row it always was — the row, one fact over, makes it a card', () => {
    const old = fold([inventory(), call('u1', BRIEF_ARGS), result('u1', RECEIPT)])
    expect(rebriefOn(old, 'u1')).toBeNull()
    const item = tool(old, 'u1')
    expect(drawsAsACard(item)).toBe(false)
    expect(inACard(item)).toBe(false)
    expect(joinsARun(item)).toBe(true)
    expect(inARun(old, 'u1')).toBe(true)

    const landed = fold([inventory(), call('u1', BRIEF_ARGS), rebriefed(), result('u1', RECEIPT)])
    expect(inACard(tool(landed, 'u1'))).toBe(true)
    expect(inARun(landed, 'u1')).toBe(false)
  })

  it('⛔ the new brief does not land on the give card above it — that card keeps the brief it first gave', () => {
    const give = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: TITLE,
      brief: FIRST_BRIEF,
    }
    const state = fold([
      inventory(),
      call('g1', give, 'mcp__brobot__give_work'),
      rebriefed({ as: 'given', brief: FIRST_BRIEF }),
      result('g1', 'W1.2 given to Ayo (dev); it went to Ayo straight away.'),
      call('u1', BRIEF_ARGS),
      rebriefed(),
      result('u1', RECEIPT),
    ])
    expect(cardIn(state, 'g1').body).toBe(FIRST_BRIEF)
    expect(cardIn(state, 'u1').body).toBe(NEW_BRIEF)
  })
})

/* ============================================================================================= */

describe('§2 · which update_work is a candidate at all', () => {
  it('🔴 recognised on Claude and on Codex, by the names the session was handed', () => {
    for (const [naming, name] of [
      [CLAUDE, 'mcp__brobot__update_work'],
      [CODEX, 'brobot__update_work'],
    ] as const) {
      const state = fold([inventory(naming), call('u1', BRIEF_ARGS, name)])
      expect(tool(state, 'u1').outgoing).toEqual({ tool: 'update_work', rebriefed: null })
    }
    // ⛔ THE CONTROL — a session never told its tools' names recognises nothing, row or not.
    const blind = fold([call('u1', BRIEF_ARGS), rebriefed(), result('u1', RECEIPT)])
    expect(tool(blind, 'u1').outgoing).toBeUndefined()
    expect(joinsARun(tool(blind, 'u1'))).toBe(true)
  })

  it('⛔ a status-only update_work is no candidate: a tool row that joins a run — a brief call beside it with its row is a card', () => {
    const state = fold([
      inventory(),
      call('s1', { piece: 'W1.2', status: 'half way' }),
      result('s1', 'W1.2 · status set.'),
      call('t1', { piece: 'W1.2', title: 'A better title' }),
      result('t1', 'W1.2 · retitled.'),
      call('u1', BRIEF_ARGS),
      rebriefed(),
      result('u1', RECEIPT),
    ])
    for (const id of ['s1', 't1']) {
      const item = tool(state, id)
      expect(item.outgoing, id).toBeUndefined()
      expect(drawsAsACard(item), id).toBe(false)
      expect(joinsARun(item), id).toBe(true)
      expect(inARun(state, id), id).toBe(true)
    }
    expect(drawsAsACard(tool(state, 'u1'))).toBe(true)
    expect(inARun(state, 'u1')).toBe(false)
  })

  it('⛔ a status-only call never takes a new brief’s row — that row waits for the brief call that wrote it', () => {
    const state = fold([
      inventory(),
      call('s1', { piece: 'W1.2', status: 'half way' }),
      rebriefed(),
      call('u1', BRIEF_ARGS),
      result('s1', 'W1.2 · status set.'),
      result('u1', RECEIPT),
    ])
    expect(tool(state, 's1').outgoing).toBeUndefined()
    expect(rebriefOn(state, 'u1')).toMatchObject({ brief: NEW_BRIEF })
  })
})

/* ============================================================================================= */

describe('§3 · which row a call takes', () => {
  it('⛔ a row for ANOTHER piece does not land — the row for this piece, one fact over, does', () => {
    const other = fold([
      inventory(),
      call('u1', BRIEF_ARGS),
      rebriefed({ piece: 'work_13', label: 'W1.3' }),
      result('u1', RECEIPT),
    ])
    expect(rebriefOn(other, 'u1')).toBeNull()
    expect(drawsAsACard(tool(other, 'u1'))).toBe(false)
    const own = fold([inventory(), call('u1', BRIEF_ARGS), rebriefed(), result('u1', RECEIPT)])
    expect(rebriefOn(own, 'u1')).not.toBeNull()
  })

  it('⚑ a call that names its piece by id takes its row as one that names it by label does', () => {
    const byId = fold([
      inventory(),
      call('u1', { piece: 'work_12', brief: NEW_BRIEF }),
      rebriefed(),
      result('u1', RECEIPT),
    ])
    expect(rebriefOn(byId, 'u1')).toMatchObject({ label: 'W1.2', brief: NEW_BRIEF })
  })

  it('⛔ a call whose brief was cut out of its arguments is not recognised, and its parked row does NOT land on the next new brief of that piece', () => {
    // ⚑ A long title first: the 200-character summary ends inside it, before the `brief` key.
    const longTitle = 'A title long enough to fill the arguments before the brief '.repeat(5).trim()
    const cutOut = { piece: 'W1.2', title: longTitle, brief: NEW_BRIEF }
    const parked = rebriefed({ title: longTitle })
    const before: TranscriptEvent[] = [
      inventory(),
      call('u1', cutOut),
      parked,
      result('u1', RECEIPT),
    ]
    const first = fold(before)
    expect(tool(first, 'u1').outgoing).toBeUndefined()
    expect(first.outgoingAhead).toHaveLength(1)

    // ⛔ A later new brief of the SAME piece, with other words: it takes nothing that is not its own…
    const next = fold([
      ...before,
      call('u2', { piece: 'W1.2', brief: ANOTHER_BRIEF }),
      result('u2', RECEIPT),
    ])
    expect(rebriefOn(next, 'u2')).toBeNull()
    expect(drawsAsACard(tool(next, 'u2'))).toBe(false)
    // …and its own row, when it comes, lands on it, with its own words.
    const own = fold([
      ...before,
      call('u2', { piece: 'W1.2', brief: ANOTHER_BRIEF }),
      rebriefed({ brief: ANOTHER_BRIEF }),
      result('u2', RECEIPT),
    ])
    expect(cardIn(own, 'u2').body).toBe(ANOTHER_BRIEF)

    // ⚑ The pair: a later call whose brief IS the parked one's (a retry of it) takes it.
    const retry = fold([...before, call('u2', BRIEF_ARGS), result('u2', RECEIPT)])
    expect(rebriefOn(retry, 'u2')).toMatchObject({ brief: NEW_BRIEF })
  })

  it('⛔ a replayed rebriefed row with no piece id, or a label never spelled, lands nowhere — the good row beside each does', () => {
    for (const [why, row] of [
      ['an empty piece', rebriefed({ piece: '' })],
      ['a label never spelled', rebriefed({ label: 'W01' })],
      ['an empty to', rebriefed({ to: '' })],
    ] as const) {
      const state = fold([inventory(), call('u1', BRIEF_ARGS), row, result('u1', RECEIPT)])
      expect(rebriefOn(state, 'u1'), why).toBeNull()
    }
    const good = fold([inventory(), call('u1', BRIEF_ARGS), rebriefed(), result('u1', RECEIPT)])
    expect(rebriefOn(good, 'u1')).not.toBeNull()
  })
})

/* ============================================================================================= */

describe('§4 · every surface asks one predicate', () => {
  it('🔴 drawsAsACard, inACard and a run agree on every call — a give, a new brief with and without its row, a status line', () => {
    const state = fold([
      inventory(),
      call(
        'g1',
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'dev',
          title: TITLE,
          brief: FIRST_BRIEF,
        },
        'mcp__brobot__give_work',
      ),
      result('g1', 'W1.2 given to Ayo (dev); it went to Ayo straight away.'),
      call('u1', BRIEF_ARGS),
      rebriefed(),
      result('u1', RECEIPT),
      call('u2', { piece: 'W1.2', brief: ANOTHER_BRIEF }),
      result('u2', RECEIPT),
      call('s1', { piece: 'W1.2', status: 'half way' }),
      result('s1', 'W1.2 · status set.'),
    ])
    const expected: Record<string, boolean> = { g1: true, u1: true, u2: false, s1: false }
    for (const [id, card] of Object.entries(expected)) {
      const item = tool(state, id)
      expect(drawsAsACard(item), id).toBe(card)
      expect(inACard(item), id).toBe(card)
      expect(joinsARun(item), id).toBe(!card)
    }
  })

  it('⚑ drawsAsACard reads the words alone: no words, no card; a new brief with no row, no card; with its row, or any other call of ours, a card', () => {
    expect(drawsAsACard({})).toBe(false)
    expect(drawsAsACard({ outgoing: { tool: 'update_work', rebriefed: null } })).toBe(false)
    expect(
      drawsAsACard({
        outgoing: {
          tool: 'update_work',
          rebriefed: { piece: 'work_12', label: 'W1.2', title: TITLE, brief: 'b', to: OWNER },
        },
      }),
    ).toBe(true)
    expect(drawsAsACard({ outgoing: { tool: 'give_work', given: null } })).toBe(true)
    expect(drawsAsACard({ outgoing: { tool: 'take_on_work', taken: null } })).toBe(true)
  })

  it('🔴 a REFUSED new brief has no row, so its notice prints the refusal — ⛔ a refused give, a card, leaves its receipt to the card', () => {
    const RAIL = 'the-giver-briefs-and-closes-a-piece'
    const refusal = (tool: string, rail: string): TranscriptEvent =>
      ({
        type: 'tool_refused',
        tool,
        rail,
        permanence: 'permanent',
        retryable: false,
        remedy: null,
      }) as unknown as TranscriptEvent
    /** ⚑ The notice a refusal of this tool drew — `refused: <tool> · <rail> · …`. */
    const notices = (state: TranscriptState, of: string): NoticeItem[] =>
      state.items.filter(
        (item): item is NoticeItem & (typeof state.items)[number] =>
          item.kind === 'notice' && item.text.startsWith(`refused: ${of} · `),
      )

    const brief = fold([
      inventory(),
      call('u1', { piece: 'W1.2', brief: 'x' }),
      refusal('update_work', RAIL),
      result(
        'u1',
        `refused (${RAIL}): only the conversation that gave a piece gives it a new brief.`,
      ),
    ])
    expect(drawsAsACard(tool(brief, 'u1'))).toBe(false)
    expect(notices(brief, 'update_work').map((one) => one.told)).toEqual([
      'only the conversation that gave a piece gives it a new brief.',
    ])

    const GIVE_RAIL = 'no-such-profile'
    const give = fold([
      inventory(),
      call(
        'g1',
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'nobody',
          title: 't',
          brief: 'b',
        },
        'mcp__brobot__give_work',
      ),
      refusal('give_work', GIVE_RAIL),
      result('g1', `refused (${GIVE_RAIL}): no agent is called nobody.`),
    ])
    expect(drawsAsACard(tool(give, 'g1'))).toBe(true)
    const given = notices(give, 'give_work')
    expect(given).toHaveLength(1)
    const [notice] = given
    expect(notice?.told).toBeUndefined()
  })
})
