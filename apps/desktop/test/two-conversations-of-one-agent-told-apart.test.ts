import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
} from '../src/shared/question-contracts'
import { describe, expect, it } from 'vitest'
import {
  namesakeSays,
  namesakesIn,
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
} from '../src/shared/questions'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { agentName, type AgentIdentity } from '../src/shared/runtime-ipc'

// Rows are built by the real fold (personsQueueView) over host-shaped doubles named by the real
// agentName, so a namesake line is what the queue draws beside each row.

const AT = 1_700_000_000_000

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
  identity('critic-g', 'Bob'),
]

const RUNS_AS: Readonly<Record<string, string>> = {
  sess_grace: 'boss-g',
  sess_ada: 'pm-g',
  sess_hal: 'hal-g',
  sess_ivy: 'hal-g',
  'sess_bob-of-grace': 'worker-g',
  'sess_bob-of-ada': 'worker-g',
  'sess_bob-of-hal': 'worker-g',
  'sess_bob-of-ivy': 'worker-g',
  'sess_the-other-bob': 'critic-g',
}

const NAME = (sessionId: string): string => agentName(RUNS_AS[sessionId] ?? null, ROSTER)

const GRACES_BOB = 'sess_bob-of-grace'
const ADAS_BOB = 'sess_bob-of-ada'
const HALS_BOB = 'sess_bob-of-hal'
const IVYS_BOB = 'sess_bob-of-ivy'

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

function linesOf(rows: readonly PersonsQueueRow[]): ReadonlyMap<string, string> {
  return new Map([...namesakesIn(rows)].map(([key, one]) => [key, namesakeSays(one)]))
}

const keys = (rows: readonly PersonsQueueRow[]): string[] => rows.map((row) => row.key)

const ANOTHER = 'Bob has another conversation asking you something too'
const TWO_OTHERS = 'Bob has 2 other conversations asking you something too'
const THREE_OTHERS = 'Bob has 3 other conversations asking you something too'
const WAITED_LONGER = `${ANOTHER}; this conversation reached you first.`
const THE_NEWER = `${ANOTHER}; this conversation reached you second.`
const EACH_OPENS_ITS_OWN = `${ANOTHER}; each row opens its own conversation.`

describe('two parents’ Bobs, each parked on a permission', () => {
  const twoBobs = (): readonly PersonsQueueRow[] =>
    look({
      decisions: [parked(ADAS_BOB, 'req_ada', 160_000), parked(GRACES_BOB, 'req_grace', 100_000)],
    })

  it('each row says there is another, and which reached you first — the two lines differ', () => {
    const rows = twoBobs()
    const [older, newer] = keys(rows)
    const lines = linesOf(rows)
    expect(lines.get(older!)).toBe(WAITED_LONGER)
    expect(lines.get(newer!)).toBe(THE_NEWER)
    expect(lines.get(older!)).not.toBe(lines.get(newer!))
    expect(lines.size).toBe(2)
  })

  it('the order is the stamp’s, not the order the look listed them in', () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_grace', 160_000), parked(ADAS_BOB, 'req_ada', 100_000)],
    })
    const lines = linesOf(rows)
    expect(lines.get(`${ADAS_BOB}:req_ada`)).toBe(WAITED_LONGER)
    expect(lines.get(`${GRACES_BOB}:req_grace`)).toBe(THE_NEWER)
  })

  it('one Bob alone: no line', () => {
    const rows = look({ decisions: [parked(GRACES_BOB, 'req_grace', 100_000)] })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you'])
    expect(linesOf(rows)).toEqual(new Map())
  })

  it('a Bob and an Ada, two names: no line on either', () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_grace', 100_000), parked('sess_ada', 'req_a', 160_000)],
    })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Ada waiting on you'])
    expect(linesOf(rows)).toEqual(new Map())
  })

  it('ONE Bob conversation holding TWO requests: two rows, and not namesakes of each other', () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_1', 100_000), parked(GRACES_BOB, 'req_2', 160_000)],
    })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
    expect(new Set(rows.map((row) => row.sessionId))).toEqual(new Set([GRACES_BOB]))
    expect(linesOf(rows)).toEqual(new Map())
  })
})

describe('a third row, from another Bob conversation', () => {
  it('`others` counts CONVERSATIONS: “another”, not “2 other” — and a conversation waits since its EARLIEST row', () => {
    const rows = look({
      decisions: [
        parked(GRACES_BOB, 'req_1', 100_000),
        parked(ADAS_BOB, 'req_a', 200_000),
        parked(GRACES_BOB, 'req_2', 400_000),
      ],
    })
    expect(keys(rows)).toEqual([`${GRACES_BOB}:req_1`, `${ADAS_BOB}:req_a`, `${GRACES_BOB}:req_2`])
    const lines = linesOf(rows)
    expect([...lines.keys()].sort()).toEqual(keys(rows).sort())
    expect(lines.get(`${GRACES_BOB}:req_1`)).toBe(WAITED_LONGER)
    expect(lines.get(`${GRACES_BOB}:req_2`)).toBe(WAITED_LONGER)
    expect(lines.get(`${ADAS_BOB}:req_a`)).toBe(THE_NEWER)
  })
})

describe('three and four Bobs, across both populations', () => {
  it('three — a question passed up and two permissions: reached you first · second of 3 · last', () => {
    const rows = look({
      questions: [passedUp(GRACES_BOB, 'req_q', 100_000)],
      decisions: [parked(ADAS_BOB, 'req_d', 200_000), parked(HALS_BOB, 'req_h', 300_000)],
    })
    expect(rows.map((row) => row.kind)).toEqual(['a-question', 'a-decision', 'a-decision'])
    expect(keys(rows)).toEqual([`${GRACES_BOB}:req_q`, `${ADAS_BOB}:req_d`, `${HALS_BOB}:req_h`])
    expect(rows.map((row) => row.chain[0]?.name)).toEqual(['Bob', 'Bob', 'Bob'])
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      `${TWO_OTHERS}; this conversation reached you first.`,
      `${TWO_OTHERS}; this conversation reached you second of 3.`,
      `${TWO_OTHERS}; this conversation reached you last.`,
    ])
    for (const key of keys(rows)) expect(lines.get(key)).not.toMatch(/wait/i)
  })

  it('four — the middle two say their place: 2 of 4, 3 of 4', () => {
    const rows = look({
      decisions: [
        parked(IVYS_BOB, 'req_ivy', 400_000),
        parked(HALS_BOB, 'req_hal', 300_000),
        parked(ADAS_BOB, 'req_ada', 200_000),
        parked(GRACES_BOB, 'req_grace', 100_000),
      ],
    })
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      `${THREE_OTHERS}; this conversation reached you first.`,
      `${THREE_OTHERS}; this conversation reached you second of 4.`,
      `${THREE_OTHERS}; this conversation reached you third of 4.`,
      `${THREE_OTHERS}; this conversation reached you last.`,
    ])
  })
})

describe('a look that cannot rank them says there are two, and no order', () => {
  it('a stamp that did not cross — one Bob’s question has no instant: “each row opens its own”', () => {
    const rows = look({
      questions: [passedUp(ADAS_BOB, 'req_q', null, 'sess_ada')],
      decisions: [parked(GRACES_BOB, 'req_d', 100_000)],
    })
    expect(rows.map((row) => row.blockedSinceIs)).toEqual(['routed', 'not-recorded'])
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
  })

  it('two alike — both Bobs parked in the same millisecond: no order to say', () => {
    const rows = look({
      decisions: [parked(GRACES_BOB, 'req_g', 100_000), parked(ADAS_BOB, 'req_a', 100_000)],
    })
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
  })

  it('one row of a conversation unstamped — that conversation has no “since”, so the group has no order', () => {
    const rows = look({
      questions: [passedUp(GRACES_BOB, 'req_q', null)],
      decisions: [parked(GRACES_BOB, 'req_d', 100_000), parked(ADAS_BOB, 'req_a', 200_000)],
    })
    expect(rows.map((row) => row.blockedSince)).toEqual([100_000, 200_000, null])
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
      EACH_OPENS_ITS_OWN,
    ])
  })
})

describe('a namesake is the ASKER’s name, read as a person reads it', () => {
  it('two identities a person NAMED alike read one word — and are namesakes', () => {
    const rows = look({
      decisions: [
        parked(GRACES_BOB, 'req_g', 100_000),
        parked('sess_the-other-bob', 'req_o', 160_000),
      ],
    })
    expect(rows.map((row) => row.sentence)).toEqual(['Bob waiting on you', 'Bob waiting on you'])
    const lines = linesOf(rows)
    expect(keys(rows).map((key) => lines.get(key))).toEqual([WAITED_LONGER, THE_NEWER])
  })

  it('a Bob who is a LATER hop of Hal’s chain is not a namesake of the Bob who asked', () => {
    const rows = look({
      questions: [passedUp('sess_hal', 'req_q', 100_000, ADAS_BOB)],
      decisions: [parked(GRACES_BOB, 'req_d', 160_000)],
    })
    expect(rows.map((row) => row.chain.map((hop) => hop.name))).toEqual([
      ['Hal', 'Bob', 'you'],
      ['Bob', 'you'],
    ])
    expect(linesOf(rows)).toEqual(new Map())
  })
})
