import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { DID_WORDS, usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
} from '../../src/shared/questions'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import {
  contrast,
  mount,
  paintedBackground,
  parseColor,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * 🔴 **613 · the chain a question carries, where a person meets it** (`HO-088` §6).
 *
 * ## ⛔ Why these claims are DOM claims
 *
 * ⚑ **Three of them cannot be read off the fold.** ⚠️ *A hop's name element still holds the name
 * and nothing else* is about what a test one directory up reads back; *the act is announced with a
 * space in front of it* is about a text node Vue's whitespace pass very nearly removed — measured
 * on this dispatch's first run, where `innerText` read `worker-7asked`; and *the act is quieter
 * than the name* is a painted colour, which `a-scoped-class-matches-nothing-in-another-component`
 * forbids asserting as a class.
 *
 * ⛔ **And the limit is drawn here** (`613` §4.2) because rule 8.4 asks what a person SEES at one:
 * nine names, no `you`, and the sentence that says the walk stopped.
 */

const NOW = 1_700_000_000_000
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const NAME = (id: string): string => id.replace('sess_', '')

;(window as unknown as { api?: unknown }).api = {
  runtime: {
    agentIdentities: async (): Promise<AgentIdentities> => ({
      identities: [],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    }),
    setCapabilities: async () => null,
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
  },
}

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_Ada',
    went: { is: 'the-parent', to: 'the-parent' },
    at: NOW,
    state: 'open',
    endedAt: null,
    escalatedAt: NOW - 600_000,
    ...over,
  }
}

function asked(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
  openQuestionOf: (sessionId: string) => RoutedRequest | null = () => null,
): PersonsQuestion {
  const request = routed(over)
  const chain = escalationChain(request, openQuestionOf)
  return {
    request,
    // ⚑ **611 · when it became a person's** — every row of this fixture is escalated, which is
    // what `routed`'s default stamps. See `PersonsQuestion.aPersonsSince`.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'the-provider',
    // ⚑ **619 · a provider-raised question is answered on its card** — see `whatTheAskerOffered`.
    offered: null,
    asked: null,
  }
}

function onlyAPersons(): PersonsDecision {
  // ⚑ **611 · the ARM, spelled once** — `RequestOnlyAPersonCanSettle` narrows `went` to the arm
  // that CARRIES a refusal, and `RoutedRequest` allows all three.
  const request: RequestOnlyAPersonCanSettle = {
    ...routed({ requestId: 'req_p', askedBy: 'sess_Ali', escalatedAt: null }),
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

/** ⚑ A ladder deeper than `CHAIN_HOP_LIMIT` — see the node file for why it is never sized from it. */
function ladder(rungs: number): (sessionId: string) => RoutedRequest | null {
  const open = new Map<string, RoutedRequest>()
  for (let n = 1; n <= rungs; n += 1) {
    open.set(
      `sess_lead-${String(n)}`,
      routed({
        requestId: `req_up_${String(n)}`,
        askedBy: `sess_lead-${String(n)}`,
        parent: `sess_lead-${String(n + 1)}`,
      }),
    )
  }
  return (id) => open.get(id) ?? null
}

function walked<Row>(rows: readonly Row[]): LedgerWalk<Row> {
  return {
    rows,
    walk: 'every-conversation-that-routed',
    ledgers: Math.max(rows.length, 1),
    rowsUnread: 0,
  }
}

const queue = usePersonsQueue()

function supply(
  questions: readonly PersonsQuestion[],
  decisions: readonly PersonsDecision[] = [],
): void {
  queue.supply(
    walked(questions),
    walked(decisions),
    {
      held: new Set<string>(),
      answerable: new Map(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
}

/**
 * ⚠️ **`OverlayHost` draws the summons itself**, so the surface under test is mounted by mounting
 * the host with an empty slot — a second `PersonsQueue` in the slot is not the layout a person has.
 */
const Layer = defineComponent({
  name: 'OverlayUnderTest',
  props: { open: { type: Function as PropType<() => unknown>, required: true } },
  setup: (props) => () => h(OverlayHost, { label: 'A sheet' }, { default: () => [props.open()] }),
})

async function summons(): Promise<Mounted> {
  await page.viewport(1180, 860)
  const m = mount(Layer, { open: () => h('div') }, { width: 10, height: 10 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('§1 · what a person reads on a hop', () => {
  /**
   * 🔴 **`HO-088` §6's shape, on screen.** ⛔ The ruling's own run, with the verb the walk
   * establishes — see `the-chain-a-question-carries.test.ts` §2 for why it is not the ruling's.
   */
  it('🔴 Ali asked → Ada has not answered → BroBot has not answered → you', async () => {
    supply([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_Ada' }, (id) =>
        id === 'sess_Ada'
          ? routed({ requestId: 'req_2', askedBy: 'sess_Ada', parent: 'sess_BroBot' })
          : null,
      ),
    ])
    const m = await summons()
    const clauses = [...m.q('persons-queue-chain-sess_Ali:req_1').children].map((li) =>
      (li as HTMLElement).innerText.trim(),
    )
    expect(clauses).toEqual(['Ali asked', 'Ada has not answered', 'BroBot has not answered', 'you'])
  })

  /**
   * ⛔ **The NAME element still holds the name and nothing else.** ⚑ The chain's own rule since
   * `401` — *what a test reads back out of these is what the host named* — and `613` added a word
   * to the row without moving that: the act is a SIBLING of the marked element, never more text
   * inside it.
   */
  it('⛔ the marked element is still exactly the host’s name', async () => {
    supply([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_Ada' }, (id) =>
        id === 'sess_Ada'
          ? routed({ requestId: 'req_2', askedBy: 'sess_Ada', parent: 'sess_BroBot' })
          : null,
      ),
    ])
    const m = await summons()
    expect(m.all('persons-queue-hop').map((el) => el.innerText.trim())).toEqual([
      'Ali',
      'Ada',
      'BroBot',
    ])
    expect(m.q('persons-queue-you').innerText.trim()).toBe('you')
    for (const el of m.all('persons-queue-hop')) expect(el.innerText).not.toContain('→')
  })

  /**
   * 🔴 **The act is announced with a space in front of it, and that is a text node rather than a
   * margin.** ⛔ **Measured on this dispatch's own first run**: two spans on two source lines
   * render with nothing between them, `innerText` reads `Aliasked`, and that is what a screen
   * reader says. ⚠️ **The margin is invisible to a reader that has no screen**, so the gap exists
   * twice on purpose — see `PersonsQueue.vue`'s note at the `{{ ' ' }}` node.
   */
  it('🔴 the name and the act are separated in the TEXT, not only in the paint', async () => {
    supply([asked({ requestId: 'req_1', askedBy: 'sess_Ali' })])
    const m = await summons()
    const first = m.q('persons-queue-chain-sess_Ali:req_1').children[0] as HTMLElement
    expect(first.innerText).toMatch(/^Ali\s+asked$/)
    expect(first.innerText).not.toContain('Aliasked')
  })

  /**
   * ⚑ **The ARM is on the row, so a reader can tell the acts apart without matching prose** —
   * `data-about`'s rule on this same card. ⛔ **Absent on the person's hop**, which is the null
   * rather than a fourth word: Vue drops an attribute bound to `null`, and a test can ask.
   */
  it('⚑ data-did carries the act, and the person’s hop carries none', async () => {
    supply([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_Ada' }, (id) =>
        id === 'sess_Ada'
          ? routed({ requestId: 'req_2', askedBy: 'sess_Ada', parent: 'sess_BroBot' })
          : null,
      ),
    ])
    const m = await summons()
    const arms = [...m.q('persons-queue-chain-sess_Ali:req_1').children].map((li) =>
      li.getAttribute('data-did'),
    )
    expect(arms).toEqual(['asked', 'has-not-answered', 'has-not-answered', null])
    // ⚑ The words drawn are the shared table's, never a second spelling on this surface.
    expect(m.all('persons-queue-did').map((el) => el.innerText.trim())).toEqual([
      DID_WORDS.asked,
      DID_WORDS['has-not-answered'],
      DID_WORDS['has-not-answered'],
    ])
  })

  /**
   * ⛔ **The act is quieter than the name it is about** — a painted property and not a class.
   * ⚑ Asserted as a comparison against the card behind both, so it survives a token being
   * retuned: what may not change is which of the two a person's eye lands on first.
   */
  it('⛔ the act reads lower-contrast than the name beside it', async () => {
    supply([asked({ requestId: 'req_1', askedBy: 'sess_Ali' })])
    const m = await summons()
    const name = m.all('persons-queue-hop')[0]!
    const act = m.all('persons-queue-did')[0]!
    expect(visible(name)).toBe(true)
    expect(visible(act)).toBe(true)
    const behind = paintedBackground(act)
    // ⛔ **`parseColor` answers `null` for a value it cannot read**, and a `!` here would turn an
    // unreadable colour into a thrown TypeError halfway through a comparison. ⚑ Asserted, so the
    // failure says *this colour could not be read* rather than *undefined is not an object*.
    const inked = parseColor(getComputedStyle(name).color)
    const quiet = parseColor(getComputedStyle(act).color)
    expect(inked).not.toBeNull()
    expect(quiet).not.toBeNull()
    const nameContrast = contrast(inked!, behind)
    const actContrast = contrast(quiet!, behind)
    expect(actContrast).toBeLessThan(nameContrast)
    // ⛔ **And still readable** — quieter is not invisible, which is the failure the comparison
    // above would happily accept on its own.
    expect(actContrast).toBeGreaterThan(2.5)
  })
})

describe('§2 · the limit, where a person meets it', () => {
  /**
   * 🔴 **`613` §4.2 · a chain at `CHAIN_HOP_LIMIT` is a real state and it is drawn.**
   *
   * ⚠️ **Rule 8.4 · what a person sees:** nine participants, every one a conversation, **no
   * `you`**, and the sentence saying the walk did not reach anybody. ⛔ The row is still
   * answerable — the press still opens the asker's conversation — so the limit costs a person the
   * name of who to chase and not the ability to clear the row.
   */
  it('🔴 nine names, none of them you, and the walk says it stopped', async () => {
    supply([
      asked({ requestId: 'req_deep', askedBy: 'sess_Ali', parent: 'sess_lead-1' }, ladder(20)),
    ])
    const m = await summons()
    expect(m.all('persons-queue-hop')).toHaveLength(9)
    expect(m.all('persons-queue-you')).toEqual([])
    const gap = m.q('persons-queue-unfollowable-sess_Ali:req_deep')
    expect(visible(gap)).toBe(true)
    expect(gap.innerText).toContain('could not be followed')
    // ⚑ **And the act is said of every one of the eight above the asker**, so the limit does not
    // quietly drop the word on the hops nobody has an ending for.
    expect(m.all('persons-queue-did')).toHaveLength(9)
  })

  /**
   * ⛔ **Nine clauses fit inside the card they are drawn in** — `.pq-chain` wraps, and a chain at
   * the bound is the longest one this surface can ever be handed. ⚠️ Measured as a rect against
   * the card's, because `overflow: hidden` somewhere above would make a text assertion pass over
   * a chain half of which nobody can see.
   */
  it('⛔ the longest chain stays inside its card', async () => {
    supply([
      asked({ requestId: 'req_deep', askedBy: 'sess_Ali', parent: 'sess_lead-1' }, ladder(20)),
    ])
    const m = await summons()
    const list = m.q('persons-queue-chain-sess_Ali:req_deep').getBoundingClientRect()
    const card = m.q('persons-queue-row-sess_Ali:req_deep').getBoundingClientRect()
    expect(list.right).toBeLessThanOrEqual(card.right + 1)
    expect(list.left).toBeGreaterThanOrEqual(card.left - 1)
    // ⚑ **It WRAPPED rather than fitting on one line** — the state this assertion is about.
    expect(list.height).toBeGreaterThan(30)
  })
})

describe('§3 · the populations that never travelled', () => {
  /**
   * ⛔ **A permission ASKED** draws no middle — `403`: the request never travelled, so there is no
   * parent to name. (⚑ A proposal PROPOSED was the second such population until D-016.)
   */
  it('⛔ a decision is `asked → you`, with nobody invented in between', async () => {
    supply([], [onlyAPersons()])
    const m = await summons()
    const clauses = [...m.q('persons-queue-chain-sess_Ali:req_p').children].map((li) =>
      (li as HTMLElement).innerText.trim(),
    )
    expect(clauses).toEqual(['Ali asked', 'you'])
  })
})
