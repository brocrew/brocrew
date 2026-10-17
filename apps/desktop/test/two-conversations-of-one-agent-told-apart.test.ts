import { describe, expect, it } from 'vitest'
import {
  personsQueueView,
  type PersonsQueueRow,
  type PersonsQueueWorld,
} from '../src/renderer/src/lib/persons-queue'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type ChainReading,
  type LedgerWalk,
  type LedgerWalkKind,
  type PersonsDecision,
  type PersonsQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
} from '../src/shared/questions'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { agentName, type AgentIdentity } from '../src/shared/runtime-ipc'

/**
 * # 🔴 737 · Draw 2, second half — two conversations of one agent, told apart (`734` F-2)
 *
 * ⚑ **The finding, verbatim** (`734` §4 F-2): *"Two rows that both read "Bob waiting on you"
 * (§1.7). Each row has its conversation (`PersonsQueueRow.sessionId`), so the drawing can tell them
 * apart — the words are yours."* ⚑ **R41**: *"every identity a person reads is NAMED (`agentName`),
 * never by slug, and never by a folder."* ⚠️ So since `734` two parents' Bobs are one word on a
 * person's queue, and `profile-already-live` is keyed per parent (and project): two live
 * conversations of one identity are ordinary (`the-queue-names-agents-not-folders.test.ts` §1.7).
 *
 * | § | the look | 🔴 subject (RED on `main` 92209678) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 1 | two Bobs, each parked on a permission | the earlier conversation says it reached you first, the later that it reached you second | one Bob; a Bob and an Ada; one Bob conversation holding TWO requests |
 * | 2 | …and a third row from another Bob conversation | `others` counts CONVERSATIONS (one), and a conversation waits since its EARLIEST row | — |
 * | 3 | three and four Bobs, across both populations | *reached you first* / *second of 3* / *last*; *second of 4* and *third of 4* — and no line says *wait* | — |
 * | 4 | a look that cannot rank them | a stamp that did not cross, two alike, or one row of a conversation unstamped → *each row opens its own conversation* | — |
 * | 5 | what is a namesake at all | two identities a person NAMED alike read one word, and are namesakes | a Bob who is a LATER hop of someone else's chain; readings with no hops |
 *
 * ⚑ **Every row is built by the REAL fold** — `personsQueueView` over `PersonsQuestion` and
 * `PersonsDecision` doubles shaped as `RuntimeHost` sends them, their names
 * made by the REAL `agentName` over an identity roster, as `734`'s host names a conversation. ⛔ No
 * `PersonsQueueRow` is typed here.
 *
 * ⚠️ **What `main` draws instead**: nothing. `persons-queue.ts` has no `namesakesIn` and neither
 * `PersonsQueue.vue` nor `ProjectWorkspace.vue` draws a line beside the name, so the two rows read
 * identically but for their age. ⚑ {@link linesOf} is what the queue draws beside each row, read
 * through the module's own two functions — and on a tree that has neither it answers the empty map,
 * which IS `main`'s drawing: so a subject fails there on the WORDS, never on a missing export, and a
 * control's *no line* is a measurement on this tree and `main`'s drawing on that one.
 *
 * ⚠️ **The new exports are reached by a dynamic `import()`**, never a static named one, so this file
 * loads on `main` and its controls run there. The engine's half — each line drawn whole beside its
 * row, outside the chain, on Home and on the project band — is
 * `test/dom/two-conversations-of-one-agent-told-apart.dom.test.ts`.
 */

/* ------------------------------------------------------------------ the roster and the names */

const AT = 1_700_000_000_000

/** ⚑ One identity as the roster carries it — `734`'s Grace, Ada and Bob, and a second Bob. */
function identity(slug: string, displayName: string | null): AgentIdentity {
  return {
    id: `aid:${slug}`,
    slug,
    displayName,
    createdAt: AT,
    createdBy: null,
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {} as AgentIdentity['chosen'],
    provider: null,
    externalMcpServerIds: [],
  }
}

const ROSTER: readonly AgentIdentity[] = [
  identity('boss-g', 'Grace'),
  identity('pm-g', 'Ada'),
  identity('hal-g', 'Hal'),
  identity('worker-g', 'Bob'),
  // ⚑ **A second identity a person NAMED alike** — §5's subject: the queue reads the name, and two
  // agents a person called *Bob* are one word on it.
  identity('critic-g', 'Bob'),
]

/** ⚑ Which identity each conversation runs under — the host's `identityOf`, as a table. */
const RUNS_AS: Readonly<Record<string, string>> = {
  sess_grace: 'boss-g',
  sess_ada: 'pm-g',
  sess_hal: 'hal-g',
  sess_ivy: 'hal-g',
  // ⚑ **Grace's Bob, Ada's Bob, Hal's Bob and Ivy's Bob** — four live conversations of ONE identity.
  'sess_bob-of-grace': 'worker-g',
  'sess_bob-of-ada': 'worker-g',
  'sess_bob-of-hal': 'worker-g',
  'sess_bob-of-ivy': 'worker-g',
  'sess_the-other-bob': 'critic-g',
}

/** ⚑ R41 — a conversation is its agent's NAME, by `agentName`, never its slug and never a folder. */
const NAME = (sessionId: string): string => agentName(RUNS_AS[sessionId] ?? null, ROSTER)

const GRACES_BOB = 'sess_bob-of-grace'
const ADAS_BOB = 'sess_bob-of-ada'
const HALS_BOB = 'sess_bob-of-hal'
const IVYS_BOB = 'sess_bob-of-ivy'

/* ------------------------------------------------------------------ the wire's three rows */

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_grace',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 10_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
    ...over,
  }
}

/** ⚑ A permission its asker parked on — `RuntimeHost.decisionsForAPerson`'s row, stamped `at`. */
function parked(askedBy: string, requestId: string, at: number): PersonsDecision {
  const request: RequestOnlyAPersonCanSettle = {
    ...routed({ requestId, askedBy, at }),
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
  }
  const reading = decisionReading(request.askedBy, NAME)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says: 'a command or file approval, which is a person’s to give',
    work: [],
  }
}

/**
 * ⚑ A question its parent did not answer, passed up to a person — `questionsForAPerson`'s row.
 * ⚠️ `escalatedAt: null` is the row whose stamp did not cross (`blockedSinceIs: 'not-recorded'`).
 */
function passedUp(
  askedBy: string,
  requestId: string,
  escalatedAt: number | null,
  parent = 'sess_grace',
): PersonsQuestion {
  const request = routed({ requestId, askedBy, parent, escalatedAt })
  const chain = escalationChain(request, () => null)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'the-provider',
    offered: null,
    asked: null,
  }
}

/** ⚑ The world nothing is answerable in and every look has answered. */
const WORLD: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map(),
  now: 600_000,
  lastLookAnswered: { questions: true, decisions: true },
  answeredFromHere: new Set<string>(),
}

const walked = <Row>(
  rows: readonly Row[],
  walk: LedgerWalkKind = 'every-conversation-that-routed',
): LedgerWalk<Row> => ({ rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 })

/** ⚑ The REAL fold over one look — the rows both surfaces draw, oldest-blocked first. */
function look(
  over: {
    questions?: readonly PersonsQuestion[]
    decisions?: readonly PersonsDecision[]
  } = {},
): readonly PersonsQueueRow[] {
  const view = personsQueueView(walked(over.questions ?? []), walked(over.decisions ?? []), WORLD)
  expect(view, 'the fold drew no view').not.toBeNull()
  return view!.rows
}

/* ------------------------------------------------------------------ what the queue draws */

/** ⚑ `persons-queue.ts`, read at the moment of asking — see the header on why not statically. */
const since737 = (): Promise<typeof import('../src/renderer/src/lib/persons-queue')> =>
  import('../src/renderer/src/lib/persons-queue')

/**
 * ⚑ **The line the queue draws beside each row, by row key** — the two surfaces' own expression
 * (`namesakeSays(namesakesIn(rows).get(key))`), over the WHOLE look. ⚠️ On a tree whose module has
 * neither function the queue draws no such line for any row, and this answers the empty map.
 */
async function linesOf(rows: readonly PersonsQueueRow[]): Promise<ReadonlyMap<string, string>> {
  const queue = (await since737()) as Partial<Awaited<ReturnType<typeof since737>>>
  const { namesakesIn, namesakeSays } = queue
  if (namesakesIn === undefined || namesakeSays === undefined) return new Map()
  return new Map([...namesakesIn(rows)].map(([key, one]) => [key, namesakeSays(one)]))
}

/** ⚑ The rows' keys, in the queue's order. */
const keys = (rows: readonly PersonsQueueRow[]): string[] => rows.map((row) => row.key)

/**
 * ⚑ The words, verbatim ONCE — rule 5 pins each by `namesakeSays` in its subject. ⚑ The place is the
 * CONVERSATION's: when its earliest row reached you, on the clock the list sorts by (`byBlockedSince`).
 */
const ANOTHER = 'Bob has another conversation asking you something too'
const TWO_OTHERS = 'Bob has 2 other conversations asking you something too'
const THREE_OTHERS = 'Bob has 3 other conversations asking you something too'
const WAITED_LONGER = `${ANOTHER}; this conversation reached you first.`
const THE_NEWER = `${ANOTHER}; this conversation reached you second.`
const EACH_OPENS_ITS_OWN = `${ANOTHER}; each row opens its own conversation.`

/* ------------------------------------------------------------------ §1 */

describe('§1 · two parents’ Bobs, each parked on a permission', () => {
  /** ⚑ Grace's Bob parked first; Ada's Bob a minute later. */
  const twoBobs = (): readonly PersonsQueueRow[] =>
    look({
      decisions: [parked(ADAS_BOB, 'req_ada', 160_000), parked(GRACES_BOB, 'req_grace', 100_000)],
    })

  it('⚑ PIN — the premise: both rows read “Bob waiting on you”, one chain each, and only the conversation and the age differ', () => {
    const rows = twoBobs()
    expect(keys(rows)).toEqual([`${GRACES_BOB}:req_grace`, `${ADAS_BOB}:req_ada`])
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
    // ⛔ **The chain is the host's and stays so** — the name alone, the act beside it, then you.
    for (const row of rows) {
      expect(row.chain).toEqual([
        { name: 'Bob', you: false, did: 'asked' },
        { name: 'you', you: true, did: null },
      ])
    }
    expect(rows.map((row) => row.sessionId)).toEqual([GRACES_BOB, ADAS_BOB])
    expect(rows.map((row) => row.blockedSince)).toEqual([100_000, 160_000])
  })

  it('🔴 each row says there is another, and which reached you first — the two lines differ', async () => {
    const rows = twoBobs()
    const [older, newer] = keys(rows)
    const lines = await linesOf(rows)
    // ⛔ On `main` there is no line beside either row: the two read the same.
    expect(lines.get(older!)).toBe(WAITED_LONGER)
    expect(lines.get(newer!)).toBe(THE_NEWER)
    expect(lines.get(older!)).not.toBe(lines.get(newer!))
    expect(lines.size).toBe(2)

    // ⚑ rule 5 — the module's own function, over the module's own reading of the look.
    const { namesakesIn, namesakeSays } = await since737()
    const found = namesakesIn(rows)
    expect(found.get(older!)).toEqual({ name: 'Bob', others: 1, rank: 1 })
    expect(found.get(newer!)).toEqual({ name: 'Bob', others: 1, rank: 2 })
    expect(lines.get(older!)).toBe(namesakeSays({ name: 'Bob', others: 1, rank: 1 }))
    expect(lines.get(newer!)).toBe(namesakeSays({ name: 'Bob', others: 1, rank: 2 }))
  })

  it('🔴 …and the order is the stamp’s, not the order the look listed them in', async () => {
    // ⚑ Ada's Bob parked FIRST this time: the line follows the stamp, whichever reader found it.
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_grace', 160_000), parked(ADAS_BOB, 'req_ada', 100_000)],
    })
    const lines = await linesOf(rows)
    expect(lines.get(`${ADAS_BOB}:req_ada`)).toBe(WAITED_LONGER)
    expect(lines.get(`${GRACES_BOB}:req_grace`)).toBe(THE_NEWER)
  })

  it('⚑ THE CONTROL — one Bob alone: no line', async () => {
    const rows = look({ decisions: [parked(GRACES_BOB, 'req_grace', 100_000)] })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you'])
    expect(await linesOf(rows)).toEqual(new Map())
  })

  it('⚑ THE CONTROL — a Bob and an Ada, two names: no line on either', async () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_grace', 100_000), parked('sess_ada', 'req_a', 160_000)],
    })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Ada waiting on you'])
    expect(await linesOf(rows)).toEqual(new Map())
  })

  it('⚑ THE CONTROL — ONE Bob conversation holding TWO requests: two rows, and not namesakes of each other', async () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_1', 100_000), parked(GRACES_BOB, 'req_2', 160_000)],
    })
    // ⚑ The premise: two rows, one conversation, one name.
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
    expect(new Set(rows.map((row) => row.sessionId))).toEqual(new Set([GRACES_BOB]))
    expect(await linesOf(rows)).toEqual(new Map())
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · …and a third row, from another Bob conversation', () => {
  it('🔴 `others` counts CONVERSATIONS: “another”, not “2 other” — and a conversation waits since its EARLIEST row', async () => {
    // ⚑ Grace's Bob holds two requests (at 100 s and at 400 s); Ada's Bob one, at 200 s.
    const rows = look({
      decisions: [
        parked(GRACES_BOB, 'req_1', 100_000),
        parked(ADAS_BOB, 'req_a', 200_000),
        parked(GRACES_BOB, 'req_2', 400_000),
      ],
    })
    expect(keys(rows)).toEqual([`${GRACES_BOB}:req_1`, `${ADAS_BOB}:req_a`, `${GRACES_BOB}:req_2`])
    const lines = await linesOf(rows)
    // ⛔ On `main`, three rows that read the same and nothing beside any of them.
    expect([...lines.keys()].sort()).toEqual(keys(rows).sort())
    // ⚑ Grace's Bob reached you at 100 s — BOTH its rows say it reached you first, the later one too, though it
    // arrived after Ada's Bob's: the line is about the CONVERSATION.
    expect(lines.get(`${GRACES_BOB}:req_1`)).toBe(WAITED_LONGER)
    expect(lines.get(`${GRACES_BOB}:req_2`)).toBe(WAITED_LONGER)
    expect(lines.get(`${ADAS_BOB}:req_a`)).toBe(THE_NEWER)

    const { namesakesIn } = await since737()
    expect([...namesakesIn(rows).values()].map((one) => one.others)).toEqual([1, 1, 1])
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · three and four Bobs, across both populations', () => {
  it('🔴 three — a question passed up and two permissions: reached you first · second of 3 · last', async () => {
    const rows = look({
      // ⚑ Grace's Bob asked, Grace did not answer, and it came to you at 100 s.
      questions: [passedUp(GRACES_BOB, 'req_q', 100_000)],
      decisions: [parked(ADAS_BOB, 'req_d', 200_000), parked(HALS_BOB, 'req_h', 300_000)],
    })
    expect(rows.map((row) => row.kind)).toEqual(['a-question', 'a-decision', 'a-decision'])
    expect(keys(rows)).toEqual([`${GRACES_BOB}:req_q`, `${ADAS_BOB}:req_d`, `${HALS_BOB}:req_h`])
    expect(rows.map((row) => row.chain[0]?.name)).toEqual(['Bob', 'Bob', 'Bob'])
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      `${TWO_OTHERS}; this conversation reached you first.`,
      `${TWO_OTHERS}; this conversation reached you second of 3.`,
      `${TWO_OTHERS}; this conversation reached you last.`,
    ])
    // 🔴 **737 review · the line says where a conversation ranks, never that it waited.**
    for (const key of keys(rows)) expect(lines.get(key)).not.toMatch(/wait/i)

    // ⚑ rule 5.
    const { namesakeSays } = await since737()
    expect(keys(rows).map((key) => lines.get(key))).toEqual(
      [1, 2, 3].map((rank) => namesakeSays({ name: 'Bob', others: 2, rank })),
    )
  })

  it('🔴 four — the middle two say their place: 2 of 4, 3 of 4', async () => {
    const rows = look({
      decisions: [
        parked(IVYS_BOB, 'req_ivy', 400_000),
        parked(HALS_BOB, 'req_hal', 300_000),
        parked(ADAS_BOB, 'req_ada', 200_000),
        parked(GRACES_BOB, 'req_grace', 100_000),
      ],
    })
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      `${THREE_OTHERS}; this conversation reached you first.`,
      `${THREE_OTHERS}; this conversation reached you second of 4.`,
      `${THREE_OTHERS}; this conversation reached you third of 4.`,
      `${THREE_OTHERS}; this conversation reached you last.`,
    ])
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · a look that cannot rank them says there are two, and no order', () => {
  it('🔴 a stamp that did not cross — one Bob’s question has no instant: “each row opens its own”', async () => {
    const rows = look({
      questions: [passedUp(ADAS_BOB, 'req_q', null, 'sess_ada')],
      decisions: [parked(GRACES_BOB, 'req_d', 100_000)],
    })
    // ⚑ The premise: the unstamped row sorts last and says it has no time.
    expect(rows.map((row) => row.blockedSinceIs)).toEqual(['routed', 'not-recorded'])
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
    const { namesakesIn, namesakeSays } = await since737()
    expect([...namesakesIn(rows).values()].map((one) => one.rank)).toEqual([null, null])
    expect(lines.get(keys(rows)[0]!)).toBe(namesakeSays({ name: 'Bob', others: 1, rank: null }))
  })

  it('🔴 two alike — both Bobs parked in the same millisecond: no order to say', async () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_g', 100_000), parked(ADAS_BOB, 'req_a', 100_000)],
    })
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
  })

  it('🔴 one row of a conversation unstamped — that conversation has no “since”, so the group has no order', async () => {
    // ⚑ Grace's Bob: a permission at 100 s AND a question whose stamp did not cross; Ada's Bob at
    // 200 s. ⛔ Ranking Grace's Bob by its one stamp would claim an order the look cannot support.
    const rows = look({
      questions: [passedUp(GRACES_BOB, 'req_q', null)],
      decisions: [parked(GRACES_BOB, 'req_d', 100_000), parked(ADAS_BOB, 'req_a', 200_000)],
    })
    expect(rows.map((row) => row.blockedSince)).toEqual([100_000, 200_000, null])
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
  })
})

/* ------------------------------------------------------------------ §5 */

describe('§5 · a namesake is the ASKER’s name, read as a person reads it', () => {
  it('🔴 two identities a person NAMED alike read one word — and are namesakes', async () => {
    // ⚑ `worker-g` and `critic-g` are two agents; a person called both *Bob*. The queue reads the
    // name, so the two rows read the same — and the line is what tells them apart.
    const rows = look({
      decisions: [
        parked(GRACES_BOB, 'req_g', 100_000),
        parked('sess_the-other-bob', 'req_o', 160_000),
      ],
    })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
    const lines = await linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([WAITED_LONGER, THE_NEWER])
  })

  it('⚑ THE CONTROL — a Bob who is a LATER hop of Hal’s chain is not a namesake of the Bob who asked', async () => {
    // ⚑ Hal asked; his parent is Ada's Bob, who has not answered — so *Bob* is on Hal's row, as its
    // second hop. And Grace's Bob parked a permission of his own: two conversations read *Bob*, and
    // only one of them as the ASKER.
    const rows = look({
      questions: [passedUp('sess_hal', 'req_q', 100_000, ADAS_BOB)],
      decisions: [parked(GRACES_BOB, 'req_d', 160_000)],
    })
    expect(rows.map((row) => row.chain.map((hop) => hop.name))).toEqual([
      ['Hal', 'Bob', 'you'],
      ['Bob', 'you'],
    ])
    expect(await linesOf(rows)).toEqual(new Map())
  })

  it('⚑ THE CONTROL — two readings with no hops (the wire type permits one): no name, so no line', async () => {
    // ⚠️ `escalationChain` cannot produce an empty reading, but the wire type can carry one and the
    // fold draws it as an empty chain rather than a bare *you* — so there is no asker to share.
    const empty: ChainReading = { hops: [], unfollowable: false }
    const hopless = (one: PersonsDecision): PersonsDecision => ({ ...one, reading: empty })
    const rows = look({
      decisions: [
        hopless(parked(GRACES_BOB, 'req_g', 100_000)),
        hopless(parked(ADAS_BOB, 'req_a', 160_000)),
      ],
    })
    expect(rows.map((row) => row.chain)).toEqual([[], []])
    expect(await linesOf(rows)).toEqual(new Map())
  })
})
