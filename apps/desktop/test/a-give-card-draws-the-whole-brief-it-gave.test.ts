import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  outgoingCard,
  readItWholeIn,
  type OutgoingCardReading,
  type OutgoingCardWords,
} from '../src/renderer/src/lib/outgoing-card'
import type { AgentIdentity, TranscriptEvent, WorkSentEvent } from '../src/shared/runtime-ipc'
import type { WorkEdge } from '../src/shared/who-called-whom'

/**
 * # 🔴 D-047 · a give card draws the WHOLE title and brief it gave
 *
 * ⚑ **`71709f76`** — the giver's own ledger keeps a `work_sent` row of each give, written before the
 * call answers. The fold lands it on the `give_work` call, pairing by TITLE (the give mints its
 * piece, so the arguments name none), and the card draws the row's title and brief whole — no cut,
 * no press to read it elsewhere. ⚑ The give's receipt (*"W1.2 given to …"*) settles which row is the
 * call's own (`settleTheGive`). ⛔ A call with no row of its own — a ledger written before D-047, or
 * a row the fold could not place on one call — draws exactly as before: the arguments, cut at 200,
 * and UI-011's press to the helper's conversation.
 *
 * ⛔ **Every negative is paired with the same fold one fact over**, because a card that never drew
 * the row would pass every absence.
 *
 * | § | subject | ⛔ paired with |
 * |---|---|---|
 * | 1 | the row lands with the call first and with the row first; whole title and brief | no row: cut, and the press |
 * | 2 | which call a row lands on | two same-title gives in flight, a sub-agent's give, a call before the page |
 * | 3 | a replayed row is a trust boundary | each guard, beside the good row |
 * | 4 | the answer settles which row is the call's own — the retry of a stopped give | a refusal, an error, and the plain order |
 */

const CLAUDE = { prefix: 'mcp__', separator: '__' }

const INVENTORY = {
  type: 'tool_inventory',
  naming: CLAUDE,
  declared: {
    server: 'brobot',
    tools: [{ name: 'give_work', description: '', parameters: [] }],
  },
  published: null,
} as unknown as TranscriptEvent

/** ⚑ The conversation the piece went to — Ayo's. */
const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'

const TITLE = 'Make the rail say what the card says'
/** ⚑ A brief well past the 200 characters a call's arguments are cut at. */
const LONG_BRIEF =
  'The rail and the card disagree about an agent. Find why and make them agree, then say what you changed. '.repeat(
    6,
  )

const ARGS = {
  definition_of_done: 'The requested result and its checks are recorded.',
  profile: 'dev',
  title: TITLE,
  brief: LONG_BRIEF,
}

/** ⚑ The provider's tool row: the arguments as JSON, cut at 200 as both adapters cut them. */
const call = (
  id: string,
  args: Record<string, unknown> = ARGS,
  over: Record<string, unknown> = {},
): TranscriptEvent => {
  const whole = JSON.stringify(args)
  return {
    type: 'tool_call',
    id,
    name: 'mcp__brobot__give_work',
    summary: whole.length > 200 ? `${whole.slice(0, 200)}…` : whole,
    ...over,
  } as TranscriptEvent
}

const result = (id: string, summary: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

/** ⚑ `give_work`'s own receipt, as `a-piece-given-is-a-card.test.ts` §1 pins it. */
const receipt = (label: string): string =>
  `${label} given to Ayo (dev); it went to Ayo straight away.`

/** ⚑ The giver's own row of a give — `RuntimeHost.noteWhatItGave`'s seven keys. */
const sent = (over: Partial<WorkSentEvent> = {}): WorkSentEvent => ({
  type: 'work_sent',
  piece: 'work_12',
  label: 'W1.2',
  as: 'given',
  to: OWNER,
  title: TITLE,
  brief: LONG_BRIEF,
  ...over,
})

const interrupted = { type: 'turn', state: 'interrupted' } as TranscriptEvent

/** ⚑ The cast's reading: W1.2 went to Ayo, in `OWNER`. */
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
  callId = 'c1',
  gaveOut: readonly WorkEdge[] | null = GAVE_OUT,
): OutgoingCardReading => {
  const item = tool(state, callId)
  expect(item.outgoing, 'the call was not recognised').toBeDefined()
  return outgoingCard(item, item.outgoing as OutgoingCardWords, IDS, new Set(), gaveOut)
}

const cardOf = (
  events: readonly TranscriptEvent[],
  callId = 'c1',
  gaveOut: readonly WorkEdge[] | null = GAVE_OUT,
): OutgoingCardReading => cardIn(fold(events), callId, gaveOut)

/** ⚑ What the call's own row put on it — `null` where none landed. */
const givenOn = (state: TranscriptState, callId: string) => {
  const words = tool(state, callId).outgoing
  expect(words?.tool).toBe('give_work')
  return words?.tool === 'give_work' ? words.given : undefined
}

/* ============================================================================================= */

describe('§1 · the row lands on its call, and the card draws it whole', () => {
  it('🔴 the call first, then its row, then its answer — the whole title and brief, not cut, and no press to read it elsewhere', () => {
    const state = fold([INVENTORY, call('c1'), sent(), result('c1', receipt('W1.2'))])
    expect(givenOn(state, 'c1')).toEqual({
      label: 'W1.2',
      title: TITLE,
      brief: LONG_BRIEF,
      to: OWNER,
    })
    const card = cardIn(state)
    expect(LONG_BRIEF.length).toBeGreaterThan(200)
    expect(card).toMatchObject({
      tool: 'give_work',
      recipient: 'Ayo',
      state: 'sent',
      piece: 'W1.2',
      title: TITLE,
      body: LONG_BRIEF,
      bodyIsCut: false,
      wholeBrief: null,
      receipt: null,
    })
    expect(card.where?.conversation).toBe(OWNER)
  })

  it('🔴 the row FIRST, then its call — claimed by it: the same card', () => {
    const state = fold([INVENTORY, sent(), call('c1'), result('c1', receipt('W1.2'))])
    expect(state.outgoingAhead).toHaveLength(0)
    const card = cardIn(state)
    expect(card.body).toBe(LONG_BRIEF)
    expect(card.bodyIsCut).toBe(false)
    expect(card.wholeBrief).toBeNull()
    expect(card.title).toBe(TITLE)
    expect(card.piece).toBe('W1.2')
    expect(card.state).toBe('sent')
  })

  it('⚑ while the call still runs, its landed row is already drawn whole', () => {
    const card = cardOf([INVENTORY, call('c1'), sent()])
    expect(card.state).toBe('sending')
    expect(card.body).toBe(LONG_BRIEF)
    expect(card.bodyIsCut).toBe(false)
  })

  it('⛔ AN OLD LEDGER (no row) draws exactly as before — the arguments cut at 200, and the press to the helper’s conversation', () => {
    const old = cardOf([INVENTORY, call('c1'), result('c1', receipt('W1.2'))])
    expect(old.bodyIsCut).toBe(true)
    expect(old.body).not.toBe(LONG_BRIEF)
    expect(LONG_BRIEF.startsWith(old.body ?? '∅')).toBe(true)
    expect((old.body ?? '').length).toBeLessThan(200)
    expect(old.wholeBrief).toEqual({
      conversation: OWNER,
      label: 'W1.2',
      said: readItWholeIn('Ayo'),
    })
    expect(old.title).toBe(TITLE)
    expect(old.piece).toBe('W1.2')
    expect(old.state).toBe('sent')
    expect(old.where?.conversation).toBe(OWNER)
    // ⚑ The pair, one fact over: the row, and none of that.
    const whole = cardOf([INVENTORY, call('c1'), sent(), result('c1', receipt('W1.2'))])
    expect(whole.bodyIsCut).toBe(false)
    expect(whole.wholeBrief).toBeNull()
  })

  it('🔴 a title the arguments cut is drawn whole from the row — ⛔ with no row it is not drawn at all', () => {
    const longTitle = 'A title long enough that the arguments cannot carry it whole '
      .repeat(5)
      .trim()
    const args = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: longTitle,
      brief: 'short',
    }
    expect(JSON.stringify(args).length).toBeGreaterThan(200)
    const row = sent({ title: longTitle, brief: 'short' })
    for (const events of [
      [INVENTORY, call('c1', args), row, result('c1', receipt('W1.2'))],
      [INVENTORY, row, call('c1', args), result('c1', receipt('W1.2'))],
    ]) {
      const card = cardOf(events)
      expect(card.title).toBe(longTitle)
      expect(card.body).toBe('short')
      expect(card.bodyIsCut).toBe(false)
    }
    expect(cardOf([INVENTORY, call('c1', args), result('c1', receipt('W1.2'))]).title).toBeNull()
  })

  it('⚑ where the cast has not read the edge, the press opens the row’s `to` — ⛔ with no row and no edge, there is none', () => {
    const withRow = cardOf(
      [INVENTORY, call('c1'), sent(), result('c1', receipt('W1.2'))],
      'c1',
      null,
    )
    expect(withRow.where?.conversation).toBe(OWNER)
    const without = cardOf([INVENTORY, call('c1'), result('c1', receipt('W1.2'))], 'c1', null)
    expect(without.where).toBeNull()
    expect(without.wholeBrief).toBeNull()
  })
})

/* ============================================================================================= */

describe('§2 · which call a row lands on', () => {
  it('🔴 two gives in flight with different titles each take their own row', () => {
    const other = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: 'Then the second table',
      brief: `${LONG_BRIEF}!`,
    }
    const state = fold([
      INVENTORY,
      call('c1'),
      call('c2', other),
      sent(),
      sent({ piece: 'work_13', label: 'W1.3', title: other.title, brief: other.brief }),
      result('c1', receipt('W1.2')),
      result('c2', receipt('W1.3')),
    ])
    expect(cardIn(state, 'c1')).toMatchObject({ piece: 'W1.2', body: LONG_BRIEF, bodyIsCut: false })
    expect(cardIn(state, 'c2')).toMatchObject({
      piece: 'W1.3',
      body: other.brief,
      bodyIsCut: false,
    })
  })

  it('⛔ two parallel gives of ONE title — the rows land on neither, and both draw their arguments as before', () => {
    const second = { ...ARGS, brief: `${LONG_BRIEF}!` }
    const state = fold([
      INVENTORY,
      call('c1'),
      call('c2', second),
      sent(),
      sent({ piece: 'work_13', label: 'W1.3', brief: second.brief }),
      result('c1', receipt('W1.2')),
      result('c2', receipt('W1.3')),
    ])
    expect(givenOn(state, 'c1')).toBeNull()
    expect(givenOn(state, 'c2')).toBeNull()
    expect(state.outgoingAhead).toHaveLength(0)
    for (const [id, label] of [
      ['c1', 'W1.2'],
      ['c2', 'W1.3'],
    ] as const) {
      const card = cardIn(state, id)
      expect(card.bodyIsCut, id).toBe(true)
      expect(card.piece, id).toBe(label)
    }
  })

  it('⛔ a sub-agent’s give takes its row and lands it nowhere — the conversation’s own give, one title over, takes its own', () => {
    const nestedArgs = {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: 'The helper’s own give',
      brief: 'the helper’s brief',
    }
    const withChild = (rows: TranscriptEvent[]): TranscriptState =>
      fold([
        INVENTORY,
        { type: 'tool_call', id: 'task', name: 'Agent', summary: '{}' } as TranscriptEvent,
        {
          type: 'sub_agent',
          agentId: 'agent-1',
          phase: 'started',
          parentToolCallId: 'task',
          title: 'a helper',
        } as TranscriptEvent,
        call('c1'),
        call('nested', nestedArgs, { parentToolCallId: 'task' }),
        ...rows,
      ])
    // ⛔ The row is the sub-agent's: it lands on no card, and is not held for a later call.
    const child = withChild([
      sent({ piece: 'work_19', label: 'W1.9', title: nestedArgs.title, brief: nestedArgs.brief }),
    ])
    expect(givenOn(child, 'c1')).toBeNull()
    expect(child.outgoingAhead).toHaveLength(0)
    // ⚑ The pair: the conversation's own row, beside the same sub-agent call, lands on its call.
    const own = withChild([sent()])
    expect(givenOn(own, 'c1')).toMatchObject({ label: 'W1.2', brief: LONG_BRIEF })
  })

  it('⛔ a row whose call is before the page is cleared at that call’s answer — a later give of the same title does not wear it', () => {
    const state = fold([
      INVENTORY,
      sent(),
      result('before-the-page', receipt('W1.2')),
      call('c1'),
      result('c1', receipt('W1.2')),
    ])
    expect(state.outgoingAhead).toHaveLength(0)
    expect(givenOn(state, 'c1')).toBeNull()
    expect(cardIn(state).bodyIsCut).toBe(true)
    // ⚑ The pair: with no answer from a call out of view, the same call claims the row.
    const claimed = fold([INVENTORY, sent(), call('c1'), result('c1', receipt('W1.2'))])
    expect(cardIn(claimed).body).toBe(LONG_BRIEF)
  })

  it('⛔ a `rebriefed` row lands on no give card — the give card keeps the brief it gave', () => {
    const state = fold([
      INVENTORY,
      call('c1'),
      sent(),
      result('c1', receipt('W1.2')),
      sent({ as: 'rebriefed', brief: 'a new brief, given later' }),
    ])
    expect(cardIn(state).body).toBe(LONG_BRIEF)
    // ⚑ The pair: a `rebriefed` row as the only row is not a give's either — the call draws its args.
    const only = fold([
      INVENTORY,
      call('c1'),
      sent({ as: 'rebriefed', brief: 'a new brief, given later' }),
      result('c1', receipt('W1.2')),
    ])
    expect(givenOn(only, 'c1')).toBeNull()
    expect(cardIn(only).bodyIsCut).toBe(true)
  })
})

/* ============================================================================================= */

describe('§3 · a replayed row is a trust boundary', () => {
  it('⛔ a row whose label is not one, whose `to` is empty, or whose title or brief is not a string lands nowhere — the good row beside each does', () => {
    const bad: readonly [string, TranscriptEvent][] = [
      ['a label never spelled', sent({ label: 'W01' })],
      ['an empty to', sent({ to: '' })],
      ['a brief that is not a string', { ...sent(), brief: 7 } as unknown as TranscriptEvent],
      ['a title that is not a string', { ...sent(), title: null } as unknown as TranscriptEvent],
      ['an `as` this build does not know', { ...sent(), as: 'lent' } as unknown as TranscriptEvent],
    ]
    for (const [why, row] of bad) {
      const state = fold([INVENTORY, call('c1'), row, result('c1', receipt('W1.2'))])
      expect(givenOn(state, 'c1'), why).toBeNull()
      expect(cardIn(state).bodyIsCut, why).toBe(true)
    }
    const good = fold([INVENTORY, call('c1'), sent(), result('c1', receipt('W1.2'))])
    expect(givenOn(good, 'c1')).not.toBeNull()
  })
})

/* ============================================================================================= */

describe('§4 · the answer settles which row is the call’s own', () => {
  const RETRY = {
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'worker',
    title: 'Fix login',
    brief: 'first brief',
  }
  const row = (label: string, brief: string): WorkSentEvent =>
    sent({ piece: `work_${label}`, label, to: 'sess_w', title: 'Fix login', brief })
  const answer = (id: string, label: string): TranscriptEvent =>
    result(id, `${label} given to Ada (worker); it went to Ada straight away.`)
  /** ⚑ A give whose run ended before its answer, its retry of one title, and both rows. */
  const BEFORE: TranscriptEvent[] = [
    INVENTORY,
    call('g1', RETRY),
    interrupted,
    call('g2', RETRY),
    row('W1.2', 'the first give, which went on'),
    row('W1.3', 'the retry'),
  ]

  it('🔴 the retry given W1.3 ends with W1.3’s own row, though W1.2’s landed on it first — the stopped give keeps none', () => {
    // ⚑ Before the answer: the stopped give's row sits on the retry, the retry's own waits ahead.
    const pending = fold(BEFORE)
    expect(givenOn(pending, 'g2')).toMatchObject({ label: 'W1.2' })
    expect(pending.outgoingAhead).toHaveLength(1)

    const state = fold([...BEFORE, answer('g2', 'W1.3')])
    const retry = cardIn(state, 'g2', null)
    expect(retry.piece).toBe('W1.3')
    expect(retry.body).toBe('the retry')
    expect(retry.state).toBe('sent')
    expect(state.outgoingAhead).toHaveLength(0)
    const stopped = cardIn(state, 'g1', null)
    expect(stopped.state).toBe('did-not-finish')
    expect(stopped.piece).toBeNull()
    expect(stopped.body).toBe('first brief')
  })

  it('⛔ a retry whose own row never came gives back the one it wore — its arguments are drawn, under the label its answer names', () => {
    const state = fold([
      INVENTORY,
      call('g1', RETRY),
      interrupted,
      call('g2', RETRY),
      row('W1.2', 'the first give, which went on'),
      answer('g2', 'W1.3'),
    ])
    expect(givenOn(state, 'g2')).toBeNull()
    const card = cardIn(state, 'g2', null)
    expect(card.piece).toBe('W1.3')
    expect(card.body).toBe('first brief')
  })

  it('⛔ a retry that was REFUSED keeps no row — and nor does one that ERRORED', () => {
    const refused = fold([
      ...BEFORE,
      result('g2', 'refused (no-such-profile): no agent is called worker'),
    ])
    expect(givenOn(refused, 'g2')).toBeNull()
    const card = cardIn(refused, 'g2', null)
    expect(card.piece).toBeNull()
    expect(card.body).toBe('first brief')
    expect(card.state).toBe('answered')

    const errored = fold([...BEFORE, result('g2', 'W1.2 given to Ada (worker).', false)])
    expect(givenOn(errored, 'g2')).toBeNull()
    expect(cardIn(errored, 'g2', null).state).toBe('failed')
  })

  it('⚑ the ordinary order — one give, its row, its answer naming it — keeps the row', () => {
    const state = fold([
      INVENTORY,
      call('g1', RETRY),
      row('W1.2', 'the whole brief'),
      answer('g1', 'W1.2'),
    ])
    const card = cardIn(state, 'g1', null)
    expect(card.body).toBe('the whole brief')
    expect(card.piece).toBe('W1.2')
    expect(card.where?.conversation).toBe('sess_w')
  })
})
