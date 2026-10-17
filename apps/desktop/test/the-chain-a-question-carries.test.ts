import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHAIN_HOP_LIMIT,
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type PersonsDecision,
  type PersonsQuestion,
  type LedgerWalk,
  type LedgerWalkKind,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
} from '../src/shared/questions'
import {
  DID_WORDS,
  KIND_WORDS,
  personsQueueView as foldPersonsQueue,
  type PersonsQueueDid,
  type PersonsQueueHop,
  type PersonsQueueRow,
  type PersonsQueueWorld,
} from '../src/renderer/src/lib/persons-queue'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'

/**
 * 🔴 **613 · the chain a question carries** — `HO-088` §6, and the word it asked for that the walk
 * does not establish.
 *
 * ## ⛔ What the ruling asked for, and what is drawn instead
 *
 * ⚑ **`HO-088` §6:** *"When a question reaches him, it carries its chain — **Ali asked · Ada could
 * not answer · BroBot could not answer** — which is the shape the escalated-approval card already
 * has."* ⚠️ **The SHAPE is built exactly as ruled.** 🔴 **The VERB is not**, and the refusal is not
 * this dispatch's: `persons-queue.ts`'s own `WHY_ITS_YOURS` has said since `403` —
 *
 * > ⛔ ***"has not answered", never "cannot answer"*** — *the second is an inability the walk never
 * > establishes. A parent whose deadline elapsed may still answer (escalating ends nothing, and
 * > `REQUEST_IS_OPEN` is what admits the row at all).*
 *
 * ⛔ **So §2 is that sentence made enforceable**, over the vocabulary rather than over one string.
 *
 * ## ⚠️ And the two causes `613` §4.1 asked about cannot be confused, by construction
 *
 * ⛔ **A hop carries two names and nothing else** — see `ChainHop`. ⚑ What decides whether a
 * conversation is IN the chain is `RuntimeHost.questionsForAPerson`'s `openQuestionOf`, which reads
 * `REQUEST_IS_OPEN[one.state] && one.because === null` — 🔴 **so a request the CHANNEL refused is
 * unreachable as an intermediate hop.** §3 pins that conjunct by name, because it is the whole
 * reason one word is honest for every hop of a chain.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const QUEUE = join(HERE, '../src/renderer/src/lib/persons-queue.ts')
const HOST = join(HERE, '../src/main/runtime/runtime-host.ts')

const NAME = (id: string): string => id.replace('sess_', '')

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_Ada',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 31_000,
    ...over,
  }
}

/** One `PersonsQuestion` exactly as `RuntimeHost.questionsForAPerson` builds one. */
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

/** ⛔ `403`'s population: a request the CHANNEL refused, so it never travelled. */
function onlyAPersons(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): PersonsDecision {
  // ⚑ **611 · the ARM, spelled once** — `RequestOnlyAPersonCanSettle` narrows `went` to the arm
  // that CARRIES a refusal, and `RoutedRequest` allows all three.
  const request: RequestOnlyAPersonCanSettle = {
    ...routed({ escalatedAt: null, ...over }),
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

const WORLD: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map<string, AttentionRequest>(),
  now: 91_000,
  lastLookAnswered: { questions: true, decisions: true },
  answeredFromHere: new Set<string>(),
}

function walked<Row>(
  rows: readonly Row[] | null,
  walk: LedgerWalkKind = 'every-conversation-that-routed',
): LedgerWalk<Row> | null {
  return rows === null ? null : { rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }
}

function rowsOf(
  questions: readonly PersonsQuestion[] | null,
  decisions: readonly PersonsDecision[] | null = [],
): readonly PersonsQueueRow[] {
  const view = foldPersonsQueue(walked(questions), walked(decisions), WORLD)
  return view?.rows ?? []
}

/**
 * ⚑ **A ladder of parents, each waiting on the next** — the only input that reaches
 * {@link CHAIN_HOP_LIMIT}. ⛔ **Built deeper than the bound and never AT it**: a fixture sized from
 * the constant moves with the constant and cannot pin it
 * (`a-bound-written-as-the-constant-cannot-pin-it`).
 */
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

/** ⚑ The chain as a reader sees it: one `name did` clause per participant. */
function drawn(chain: readonly PersonsQueueHop[]): string[] {
  return chain.map((hop) => (hop.did === null ? hop.name : `${hop.name} ${DID_WORDS[hop.did]}`))
}

/**
 * ⛔ **Comments and strings-in-docblocks stripped before anything is asserted about CODE** —
 * `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ This file's own docblock quotes both
 * forbidden phrasings, so a raw-text census here would fire on the argument for the rule.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// §1 · the act, on every participant, derived from the hop it came from
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · what each participant did', () => {
  /**
   * 🔴 **`HO-088` §6's own run, as the app draws it** — BroBot created Ada, Ada created Ali, Ali
   * asked. ⛔ Ada is itself waiting on BroBot, which is the only thing that puts BroBot in the
   * chain at all: see `questionsForAPerson`'s `openQuestionOf` — *the question this conversation
   * RAISED, not the ones raised AT it*.
   */
  it('🔴 Ali asked · Ada has not answered · BroBot has not answered · you', () => {
    const rows = rowsOf([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_Ada' }, (id) =>
        id === 'sess_Ada'
          ? routed({ requestId: 'req_2', askedBy: 'sess_Ada', parent: 'sess_BroBot' })
          : null,
      ),
    ])
    expect(drawn(rows[0]!.chain)).toEqual([
      'Ali asked',
      'Ada has not answered',
      'BroBot has not answered',
      'you',
    ])
  })

  /**
   * ⛔ **`did` is null for exactly one participant, and it is the one that is not a
   * conversation** — see `PersonsQueueHop.did`. ⚠️ **Both directions over both
   * populations**, because two fields describing one participant are free to disagree the day
   * either is derived a second way.
   */
  it('⛔ null iff you — in both directions, across every population', () => {
    const rows = rowsOf(
      [
        asked({ requestId: 'req_1', askedBy: 'sess_Ali' }, (id) =>
          id === 'sess_Ada'
            ? routed({ requestId: 'req_2', askedBy: 'sess_Ada', parent: 'sess_BroBot' })
            : null,
        ),
      ],
      [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_Ali' })],
    )
    expect(rows).toHaveLength(2)
    const hops = rows.flatMap((row) => row.chain)
    // ⚑ **The planted control the biconditional needs**: a run in which no hop is `you` at all
    // would satisfy both halves vacuously, so the count is asserted first.
    expect(hops.filter((hop) => hop.you)).toHaveLength(2)
    expect(hops.filter((hop) => hop.did === null)).toHaveLength(2)
    for (const hop of hops) expect(hop.did === null).toBe(hop.you)
  })

  /**
   * 🔴 **What the FIRST participant did, per population** — both of them asked. ⚑ D-016 took the
   * third population (proposals) out, and with it the one first participant that did not ask.
   */
  it('🔴 a question and a permission both ASKED', () => {
    const rows = rowsOf(
      [asked({ requestId: 'req_1', askedBy: 'sess_Ali' })],
      [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_Ali' })],
    )
    const first = new Map(rows.map((row) => [row.kind, row.chain[0]!.did]))
    expect(first.get('a-question')).toBe('asked')
    expect(first.get('a-decision')).toBe('asked')
    // ⛔ **Exhaustive, so a fourth population cannot reach a person without deciding what its
    // asker did** — `NOUN_OF_KIND`'s property, asserted over the same key set.
    expect([...first.keys()].sort()).toEqual([...Object.keys(KIND_WORDS)].sort())
  })

  /**
   * ⚠️ **§4.3 · an EMPTY reading gives an empty chain, and never a bare `you`** —
   * `persons-queue.ts`'s own rule, which this dispatch had to keep true while adding a field to
   * every hop. ⛔ Unreachable from `escalationChain` and legal on the wire.
   */
  it('⛔ an empty reading draws no hops at all, and no act', () => {
    const rows = rowsOf([
      {
        ...asked({ requestId: 'req_1', askedBy: 'sess_Ali' }),
        reading: { hops: [], unfollowable: false },
      },
    ])
    expect(rows[0]!.chain).toEqual([])
    expect(drawn(rows[0]!.chain)).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §2 · the word the walk establishes, and the two it does not
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · “has not answered”, never “could not answer”', () => {
  /**
   * 🔴 **The ruling asked for a word this app had already refused** — `WHY_ITS_YOURS`, `403`.
   * ⛔ Asserted over the WHOLE vocabulary and not over one string, so the refusal survives a
   * fourth act arriving with a friendlier verb.
   *
   * ⚑ **With the positive control the negative needs** (rule 34.2): the same predicate is shown
   * firing on the ruling's own words, one line down.
   */
  it('🔴 no word this surface draws claims an inability', () => {
    const NEVER = /could not answer|cannot answer|couldn’t answer|refused to answer/i
    const vocabulary = [...Object.values(DID_WORDS), ...Object.values(KIND_WORDS)]
    expect(vocabulary.length).toBeGreaterThan(3)
    for (const word of vocabulary) expect(NEVER.test(word), word).toBe(false)
    // ⛔ **The control.** `HO-088` §6's own phrasing, which is what this predicate exists to keep
    // out of the vocabulary above — a grep that cannot find a hit it is shown is a broken grep.
    expect(NEVER.test('Ada could not answer')).toBe(true)
  })

  /**
   * ⛔ **The claim the act DOES make, and it is the one the row already makes about the
   * population.** ⚠️ Asserted as an identity rather than as two spellings: `WHY_ITS_YOURS`'
   * escalated sentence and the hop's word are one claim about silence said at two scales, and a
   * hop that said something stronger than its own row would be two answers on one card.
   */
  it('⛔ the hop’s word is the row’s claim, said of one participant', () => {
    expect(DID_WORDS['has-not-answered']).toBe('has not answered')
    expect(KIND_WORDS['a-question']).toContain('nobody above has answered')
  })

  /**
   * ⚑ **Every act has a word** — exhaustive over the vocabulary, which is what stops a member
   * reaching a person as `undefined`.
   */
  it('⚑ the vocabulary is closed and every member is drawable', () => {
    const acts: readonly PersonsQueueDid[] = ['asked', 'has-not-answered']
    expect([...Object.keys(DID_WORDS)].sort()).toEqual([...acts].sort())
    for (const act of acts) expect(DID_WORDS[act].length).toBeGreaterThan(3)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §3 · why one word is true of every hop: a channel refusal cannot be one
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the two causes cannot be confused, because only one can reach a chain', () => {
  /**
   * 🔴 **`613` §4.1's question, answered from the code.** ⛔ *Declined* and *the door refused* are
   * two different facts, and **a hop cannot carry either**: `ChainHop` is two names. ⚑ What makes
   * one word honest for every hop is that the walk's own lookup admits only questions whose
   * answer is still the conversation ABOVE's to give — so a request the channel refused is an
   * `a-decision` row with a one-hop chain and never a link in somebody else's.
   *
   * ## ⚠️ 611 · the conjunct is spelled by the DESTINATION now, and it excludes one arm more
   *
   * ⛔ **It was `one.because === null`**, which was *nothing refused it* — and that was the same
   * set while a refusal was the only way to be a person's. ⚑ `HO-088` §2 gave a second way: an
   * asker may ADDRESS its question to a person, with nothing refused. ⚠️ **Walking through one of
   * those would draw its parent as a conversation that *has not answered* about a question that
   * parent was never asked** — which is this section's own confusion arriving from the other side.
   *
   * ⚑ **So the narrowing is `one.went.to === 'the-parent'`**, and it is both shorter and truer
   * than the null-check it replaces: it names what the walk needs rather than what did not happen.
   *
   * ⚠️ **Asserted on the conjunct BY NAME** (standing rule 5), stripped of prose first, and with
   * the control that shows the predicate firing when the conjunct is gone.
   */
  it("🔴 the walk admits only questions the PARENT owes — `one.went.to === 'the-parent'`", () => {
    const host = withoutComments(readFileSync(HOST, 'utf8'))
    const at = host.indexOf('questionsForAPerson(): LedgerWalk<PersonsQuestion>')
    expect(at).toBeGreaterThan(0)
    const body = host.slice(at, host.indexOf('\n  }\n', at))
    const FILTER = /REQUEST_IS_OPEN\[one\.state\] && one\.went\.to === 'the-parent'/
    expect(FILTER.test(body)).toBe(true)
    // ⛔ **The control**: the same predicate over the same body with the conjunct removed.
    expect(FILTER.test(body.replace(" && one.went.to === 'the-parent'", ''))).toBe(false)
    // 🔴 **611 · and the ARM it newly excludes, asserted as behaviour rather than as source.**
    // ⛔ A question its asker addressed to a person is ONE hop ending at you — walking to its
    // parent would name a conversation this app never asked.
    const addressed = asked({
      requestId: 'req_x',
      askedBy: 'sess_Ali',
      parent: 'sess_Ada',
      went: { is: 'the-person-the-asker-named', to: 'a-person' },
      escalatedAt: null,
    })
    expect(addressed.reading.hops).toHaveLength(1)
    expect(addressed.reading.hops[0]?.on).toBeNull()
  })

  /**
   * ⛔ **And the consequence, drawn.** A permission is its own row with its own one-hop chain; it
   * is not a participant in the escalated row's. ⚠️ Both rows are folded in one view, which is the
   * only place the two could ever have been confused.
   */
  it('⛔ a refused request is its own row, not a hop in somebody else’s', () => {
    const rows = rowsOf(
      [asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_Ada' })],
      [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_Ada' })],
    )
    const escalated = rows.find((row) => row.kind === 'a-question')!
    const decision = rows.find((row) => row.kind === 'a-decision')!
    expect(drawn(escalated.chain)).toEqual(['Ali asked', 'Ada has not answered', 'you'])
    expect(drawn(decision.chain)).toEqual(['Ada asked', 'you'])
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §4 · the limit, and what a person meets at it
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · a chain at CHAIN_HOP_LIMIT', () => {
  /**
   * 🔴 **§4.2 · a chain at the bound is a real state a person can meet, and it is drawn.**
   *
   * ⛔ **Pinned with an independent literal.** `CHAIN_HOP_LIMIT` is 8 and the drawn chain is NINE
   * participants — the asker plus one answerer per link — and writing that as `CHAIN_HOP_LIMIT + 1`
   * would move with the constant and pin nothing
   * (`a-bound-written-as-the-constant-cannot-pin-it`).
   *
   * ## ⚠️ Rule 8.4 · what a person SEES at this limit
   *
   * ⚑ **Nine names, every one of them a conversation, and NO `you`** — followed by *the chain
   * above this could not be followed*. 🔴 **The row is still answerable**: it is the asker's card a
   * person is taken to, and the limit costs them the name of who to chase rather than the ability
   * to clear the row. ⛔ That is why this is a test and not a finding.
   */
  it('🔴 nine participants, none of them you, and the walk says it stopped', () => {
    const rows = rowsOf([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_lead-1' }, ladder(20)),
    ])
    const row = rows[0]!
    expect(row.chain).toHaveLength(9)
    expect(row.unfollowable).toBe(true)
    expect(row.chain.filter((hop) => hop.you)).toEqual([])
    expect(row.chain.filter((hop) => hop.did === null)).toEqual([])
    expect(drawn(row.chain)[0]).toBe('Ali asked')
    expect(drawn(row.chain).slice(1)).toEqual(
      Array.from({ length: 8 }, (_, n) => `lead-${String(n + 1)} has not answered`),
    )
  })

  /**
   * ⚑ **The literal above is a bound and not a coincidence** — a ladder one rung shorter ENDS, and
   * the chain that ends carries the person. ⛔ Without this the nine could be any number the
   * fixture happened to produce (`a-positive-assertion-must-differ-from-the-default`).
   */
  it('⚑ the nine comes from the BOUND, not from the fixture', () => {
    // ⛔ **Twice as deep, and the same nine.** The ladder decides nothing above the bound.
    const deeper = rowsOf([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_lead-1' }, ladder(40)),
    ])
    expect(deeper[0]!.chain).toHaveLength(9)
    // ⚑ **And a ladder BELOW the bound ends** — a different length and a person at the end of it,
    // which is what makes the nine above a bound rather than the only answer this fold gives.
    const shallow = rowsOf([
      asked({ requestId: 'req_1', askedBy: 'sess_Ali', parent: 'sess_lead-1' }, ladder(4)),
    ])
    const row = shallow[0]!
    expect(row.unfollowable).toBe(false)
    expect(row.chain.at(-1)).toEqual({ name: 'you', you: true, did: null })
    expect(row.chain).toHaveLength(7)
    expect(CHAIN_HOP_LIMIT).toBeGreaterThan(4)
  })

  /**
   * ⛔ **The module says the limit once**, so the ladder above is the only thing that decides how
   * long a chain gets. ⚠️ A renderer that re-imposed a length would be a second bound free to
   * disagree with the walk's.
   */
  it('⛔ the renderer imposes no length of its own', () => {
    const queue = withoutComments(readFileSync(QUEUE, 'utf8'))
    expect(queue).not.toContain('CHAIN_HOP_LIMIT')
    expect(queue).not.toMatch(/\.slice\(0,\s*\d+\)/)
  })
})
