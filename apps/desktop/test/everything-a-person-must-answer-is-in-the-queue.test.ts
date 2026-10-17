import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attentionQueue } from '../src/renderer/src/lib/attention'
import {
  KIND_WORDS,
  personsQueueView,
  type PersonsQueueKind,
} from '../src/renderer/src/lib/persons-queue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { applyEvent, isAwaitingAnswer } from '../src/renderer/src/lib/transcript'
import { decisionReading, readingSentence, type LedgerWalkKind } from '../src/shared/questions'
import type { CreatedSession, RuntimeEvent } from '../src/shared/runtime-ipc'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'

/**
 * 🔴 **EVERYTHING THIS APP CAN BE WAITING ON A PERSON FOR APPEARS IN THE QUEUE** (446 §4).
 *
 * ## ⛔ The defect this is the assertion for, and it had two green gates over it
 *
 * A proposal card with Approve and No must place the conversation in the attention queue. The
 * attention panel cannot say “Nothing is waiting” while the conversation and composer imply
 * ongoing tool work; the visible decision is waiting on the person.
 *
 * ⚑ **`441` and `434` were each right in isolation.** `434` folded the queue over the two
 * populations that existed when it was written; `441` argued against reusing the question channel
 * on three measurable grounds and was right about all three. ⛔ **What nobody built was the seam**,
 * and nothing was red, because completeness was a property no test asked about.
 *
 * ## ⚑ So this asks about completeness, and it DERIVES the list rather than typing it
 *
 * ⛔ **`never-name-a-count-of-surfaces-in-a-brief` applies to a test as much as to a brief**, and a
 * roster typed here would go stale exactly the way the panel's own *"Questions, permissions, running
 * agents and the checklist appear here"* sentence did — at `250`, at `258`, at `446`, at `506` and
 * again at `577`, which found it short of `workflows`; each time because something had started
 * appearing that it did not name.
 *
 * **Three rosters, three derivations, and none of them is a literal in this file:**
 *
 * | roster | derived from | what goes red |
 * |---|---|---|
 * | the CARD kinds a person must answer | a source census over `isAwaitingAnswer`'s own body | a fourth item kind that waits, with no fixture, no counter, no panel row or no live row |
 * | the QUEUE populations | `Record<PersonsQueueKind, …>` — the compiler | a fourth `PersonsQueueKind` that `personsQueueView` cannot place |
 * | the main-side READERS | every `RuntimeCommandKind` matching `…ForAPerson` | a fourth reader the screen never polls |
 *
 * ⚠️ **`isAwaitingAnswer` is the honest first roster and not a convenient one.** It is the ONE
 * predicate this app asks for *is this card still waiting on somebody* — `recountPending` reads it,
 * `sessionPanel` reads it, `attentionQueue` reads it, and `transcript-window.ts`' carry reads it —
 * and its own docblock says it lives outside the component precisely so a test can hold it. ⛔ A
 * fifth kind of card that waits and is not in that predicate is invisible to this file, which is a
 * declared limit rather than a silent one: it would also be invisible to every surface in the app,
 * which is a different and larger bug than the one this test is about.
 */

/** A card of each kind, keyed by the item kind `isAwaitingAnswer` admits. */
const A_CARD_OF_EACH_KIND: Readonly<Record<string, RuntimeEvent>> = {
  permission: {
    type: 'permission_request',
    id: 'req_perm',
    kind: 'command',
    action: 'Bash',
    detail: 'rm -rf /tmp/build',
    scope: {
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny'],
      underDisclosed: false,
    },
  } as RuntimeEvent,
  userInput: {
    type: 'user_input_request',
    id: 'req_ask',
    prompt: 'Which colour?',
    questions: [{ id: 'q1', prompt: 'Pick a colour', options: [{ label: 'Red' }] }],
  } as RuntimeEvent,
}

/**
 * 🔴 **The roster, read out of the predicate's own source** — every `item.kind === '<x>'` that
 * {@link isAwaitingAnswer} tests.
 *
 * ⛔ **Prose is stripped BEFORE the census asserts**, which is this repository's own rule
 * (`a-source-census-must-strip-prose-before-it-asserts`): the body carries a `441` comment naming
 * `TranscriptView` and a compaction, and a regex over the raw text would count whatever a future
 * comment happened to quote. ⚑ The control below plants a kind in a comment and proves the strip
 * removes it, so *"stripped"* is measured rather than claimed.
 */
function kindsThatWait(source: string): string[] {
  const body = source.slice(source.indexOf('export function isAwaitingAnswer'))
  const fn = body.slice(0, body.indexOf('\n}\n') + 2)
  const code = fn
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  return [...code.matchAll(/item\.kind === '([a-zA-Z]+)'/g)].map((match) => match[1]!)
}

const TRANSCRIPT_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/lib/transcript.ts', import.meta.url)),
  'utf8',
)

const SCREEN_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
  'utf8',
)

function recordWith(sessionId: string, events: readonly RuntimeEvent[]): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: `/Users/alex/work/${sessionId}`,
    profileId: 'default',
  } as CreatedSession
  record.phase = 'open'
  for (const event of events) applyEvent(record.control, event, 1_000)
  return record
}

describe('§4 · the roster is derived from the predicate, not typed here', () => {
  it('🔴 every kind `isAwaitingAnswer` admits has a fixture in this file, and no kind is invented', () => {
    const kinds = kindsThatWait(TRANSCRIPT_SOURCE)
    // ⛔ **A positive floor first.** A census that found nothing would pass every assertion below
    // vacuously, which is the exact shape `316` was measured going wrong.
    expect(kinds.length).toBeGreaterThan(0)
    expect([...kinds].sort()).toEqual(Object.keys(A_CARD_OF_EACH_KIND).sort())
    // ⚑ **And the question card is really in there**, so this file cannot pass by the predicate
    // having quietly lost a card.
    expect(kinds).toContain('userInput')
  })

  it('⚠️ the census strips prose — a kind named only in a comment is NOT counted', () => {
    // ⛔ **The control plants TWO** (standing rule 12): one in a block comment and one in a line
    // comment, because a strip that handled only one would read as working.
    const planted = `
export function isAwaitingAnswer(item: TranscriptItem): boolean {
  /* item.kind === 'blockPlanted' — prose */
  if (item.kind === 'permission') return item.outcome === null
  // item.kind === 'linePlanted' — also prose
  return false
}
`
    expect(kindsThatWait(planted)).toEqual(['permission'])
  })
})

describe('§4 · every card a person must answer reaches every surface that counts them', () => {
  it.each(Object.keys(A_CARD_OF_EACH_KIND))(
    '🔴 a waiting %s is counted, panelled and listed live — none of the three may miss it',
    (kind) => {
      const record = recordWith('sess_1', [A_CARD_OF_EACH_KIND[kind]!])
      const state = record.control
      const waiting = state.items.filter(isAwaitingAnswer)
      // ⚑ The fixture really did land as a waiting card — or everything below is vacuous.
      expect(waiting).toHaveLength(1)
      expect(waiting[0]!.kind).toBe(kind)

      // 1 · the O(1) counter `attentionQueue` gates on, and the rail badge reads.
      const counted = state.pending.permissions + state.pending.questions
      expect(counted).toBe(1)

      // The panel lists the item and counts it as blocked on the person, withholding the
      // empty paragraph. Its heading names all three populations, so omitting a kind from the
      // count would make the sentence false as well as the gate wrong.
      const panel = sessionPanel(state)
      expect(panel.waiting).toBe(1)
      expect(panel.empty).toBe(false)

      // 3 · the cross-conversation queue lists it, with an answer on it. ⛔ `106`: a row that can
      //     name no gesture is a control that cannot act.
      const live = attentionQueue([record], () => 'waiting')
      expect(live).toHaveLength(1)
      expect(live[0]!.decisions.length).toBeGreaterThan(0)
    },
  )

  it('⚑ and all of them at once — the counts are sums and not a first-match', () => {
    const record = recordWith('sess_all', Object.values(A_CARD_OF_EACH_KIND))
    const kinds = Object.keys(A_CARD_OF_EACH_KIND).length
    expect(record.control.items.filter(isAwaitingAnswer)).toHaveLength(kinds)
    expect(record.control.pending.permissions + record.control.pending.questions).toBe(kinds)
    expect(sessionPanel(record.control).waiting).toBe(kinds)
    expect(attentionQueue([record], () => 'waiting')).toHaveLength(kinds)
  })

  it('⛔ and a card that STOPPED waiting leaves all three — the negative, so the sum is not a constant', () => {
    const record = recordWith('sess_gone', [A_CARD_OF_EACH_KIND.userInput!])
    applyEvent(record.control, { type: 'request_resolved', id: 'req_ask' })
    expect(record.control.items.filter(isAwaitingAnswer)).toHaveLength(0)
    expect(record.control.pending.questions).toBe(0)
    expect(sessionPanel(record.control).waiting).toBe(0)
    expect(attentionQueue([record], () => 'waiting')).toHaveLength(0)
  })
})

describe('§4 · every population of the person’s queue can be placed in it', () => {
  /**
   * ⛔ **A `Record` over the vocabulary, so the compiler is the census.** A fourth
   * {@link PersonsQueueKind} does not compile until somebody has said what a row of it looks like,
   * and the assertion then proves `personsQueueView` can actually place one.
   */
  /**
   * ⚑ **453 · the ordinary walk around a fixture list** — `personsQueueView` takes a `LedgerWalk`
   * per population now, and every case here means *a walk that opened a ledger and dropped
   * nothing*.
   */
  const walked = <Row>(
    rows: readonly Row[],
    walk: LedgerWalkKind = 'every-conversation-that-routed',
  ) => ({
    rows,
    walk,
    ledgers: Math.max(rows.length, 1),
    rowsUnread: 0,
  })

  const ONE_OF_EACH: Record<PersonsQueueKind, () => ReturnType<typeof personsQueueView>> = {
    'a-question': () =>
      personsQueueView(
        walked([
          {
            request: {
              requestId: 'req_q',
              askedBy: 'sess_w',
              parent: 'sess_p',
              at: 1_000,
              state: 'open',
              escalatedAt: 2_000,
              went: { is: 'the-parent', to: 'the-parent' },
            },
            // ⚑ **611 · the moment it became a person's** — the deadline's stamp here, which is
            // what `RuntimeHost.questionsForAPerson` copies onto the row.
            aPersonsSince: 2_000,
            chain: [],
            reading: decisionReading('sess_w', (id) => id),
            sentence: readingSentence(decisionReading('sess_w', (id) => id)),
            work: [],
            // ⚑ **D-017 · R6 — spelled as the host serves them.** The row's offer is read now
            // whoever holds the asker, so a fixture that left it out would be read as an offer with
            // nothing in it. ⚠️ A provider raised this one, so its card was drawn and it offers
            // nothing to press from the row (`whatTheAskerOffered` is this app's questions only).
            raisedBy: 'the-provider',
            offered: null,
            asked: null,
          },
        ] as never),
        walked([]),
        WORLD,
      ),
    'a-decision': () =>
      personsQueueView(
        walked([]),
        walked([
          {
            request: {
              requestId: 'req_d',
              askedBy: 'sess_w',
              parent: null,
              at: 1_000,
              state: 'open',
              escalatedAt: null,
              because: 'permission-shaped',
            },
            reading: decisionReading('sess_w', (id) => id),
            sentence: readingSentence(decisionReading('sess_w', (id) => id)),
            says: 'a command or file approval, which is a person’s to give',
            work: [],
          },
        ] as never),
        WORLD,
      ),
  }

  const WORLD = {
    held: new Set<string>(),
    answerable: new Map(),
    now: 60_000,
    lastLookAnswered: { questions: true, decisions: true },
    /** ⚑ **468 · this window has answered nothing.** */
    answeredFromHere: new Set<string>(),
  }

  it.each(Object.keys(ONE_OF_EACH) as PersonsQueueKind[])(
    '🔴 a %s row is placed, counted once and says which instant its age is',
    (kind) => {
      const view = ONE_OF_EACH[kind]()
      expect(view).not.toBeNull()
      expect(view!.count).toBe(1)
      expect(view!.rows[0]!.kind).toBe(kind)
      // ⛔ **Every row says WHICH instant its number is** (434), and `not-recorded` would mean the
      // fixture's stamp never crossed — which would make the ordering assertion below vacuous.
      expect(view!.rows[0]!.blockedSinceIs).not.toBe('not-recorded')
      // ⚑ **And the heading names this population in the singular**, which is the derived sentence
      // rather than a branch: a kind with no noun cannot reach here at all.
      expect(view!.heading).toMatch(/^A [a-z]+ is waiting on you$/)
      expect(view!.announcement).not.toBe('')
    },
  )
})

describe('§4 · actionable reads and the limits display each have a publication lane', () => {
  // Future actionable readers join the same look. The legacy synchronous limits door is the
  // only exception: the window explicitly asks the independent worker display door instead.
  it('the screen calls every actionable `…ForAPerson` verb the wire declares', () => {
    // ⚑ **Read off the zod union that governs the wire**, so this roster is the one the main
    // process actually accepts rather than a list of names typed here.
    //
    // ⚠️ **One member of the union is itself a union**, so the walk recurses rather than assuming
    // every option is an object — a `.map` that took `def.shape.kind` off every one threw on that
    // member, which is the honest version of a census that would otherwise have quietly dropped
    // whatever hid inside it.
    type Node = {
      def: {
        type: string
        shape?: Record<string, Node>
        options?: Node[]
        values?: readonly string[]
      }
    }
    const kindsOf = (node: Node): string[] => {
      if (node.def.options !== undefined) return node.def.options.flatMap(kindsOf)
      const literal = node.def.shape?.kind
      return literal?.def.values === undefined ? [] : [...literal.def.values]
    }
    const every = kindsOf(runtimeCommandSchema as unknown as Node)
    // ⛔ **The whole roster first, so a walk that found three names out of sixty would be visible.**
    expect(every.length).toBeGreaterThan(50)
    const kinds = every.filter((kind) => kind.endsWith('ForAPerson'))
    // ⛔ A positive floor: an empty roster would pass the loop below over nothing.
    expect(kinds.length).toBeGreaterThanOrEqual(5)
    expect(kinds).toContain('limitsForAPerson')
    expect(every).toContain('readLimitsDisplay')
    const look = SCREEN_SOURCE.slice(SCREEN_SOURCE.indexOf('async function lookForWhatIsYours'))
    const body = look.slice(0, look.indexOf('\n}\n') + 2)
    for (const kind of kinds.filter((kind) => kind !== 'limitsForAPerson'))
      expect(body).toContain(`store.${kind}()`)
    // ⚑ **And they go out TOGETHER**, which is `403`'s rule: reads a round trip apart can
    // straddle an answer, and the list is drawn as one queue with one count.
    expect(body).toContain('Promise.all')
  })

  it('the limits display starts without awaiting it and is not a queue population', () => {
    const look = SCREEN_SOURCE.slice(SCREEN_SOURCE.indexOf('async function lookForWhatIsYours'))
    const body = look.slice(0, look.indexOf('\n}\n') + 2)
    expect(body).toContain('void refreshLimitsDisplay(scheduled)')
    expect(body).not.toContain('await refreshLimitsDisplay')
    expect(body).not.toContain('store.limitsForAPerson()')
    expect(body).not.toContain('store.readLimitsDisplay()')
    const refresh = SCREEN_SOURCE.slice(
      SCREEN_SOURCE.indexOf('async function refreshLimitsDisplay'),
    )
    expect(refresh.slice(0, refresh.indexOf('\n}\n') + 2)).toContain('store.readLimitsDisplay()')
    // 🔴 **Second: it is NOT a `PersonsQueueKind`**, and that is the shape decision `533` §2.1
    // argued rather than a gap. ⛔ Three exhaustive tables in `persons-queue.ts` would each have to
    // be given a sentence that is false of a wall — and the FIRST of them is the one the describe
    // above this asserts by name: `heading` matches `/^A [a-z]+ is waiting on you$/`, and nothing
    // is waiting on a person when a provider's window is spent. ⚑ So a limit that arrived as a
    // fourth population would have made this file demand a false sentence.
    // ⚑ **The vocabulary read off an exhaustive `Record<PersonsQueueKind, …>`** — `KIND_WORDS` —
    // so this roster is the compiler's and not a list typed here, which is this file's own rule.
    const populations: readonly string[] = Object.keys(KIND_WORDS)
    expect(populations).not.toContain('a-limit')
    expect(populations).not.toContain('limit')
    // ⚠️ **The paired positive**: the vocabulary really is the two it is, so the negative above
    // is a statement about a list that exists rather than about a name nobody chose.
    expect([...populations].sort()).toEqual(['a-decision', 'a-question'])
  })

  it('⛔ 557 · the fifth reader is in the look and is deliberately NOT a queue population either', () => {
    // 🔴 **Both halves, for `533`'s reason exactly**, on the second thing this queue carries beside
    // its rows rather than as one.
    //
    // ⚠️ **First: it really is conscripted.** `stalledWorkForAPerson` ends in the suffix, so the
    // assertion above already requires `lookForWhatIsYours` to call it — and that assertion would
    // also pass if the verb had been named something else and quietly left out, which is `441`'s
    // defect.
    const look = SCREEN_SOURCE.slice(SCREEN_SOURCE.indexOf('async function lookForWhatIsYours'))
    expect(look.slice(0, look.indexOf('\n}\n') + 2)).toContain('store.stalledWorkForAPerson()')
    // 🔴 **Second: it is NOT a `PersonsQueueKind`.** ⛔ `533`'s own table, re-run against this
    // subject, has TWO false rows rather than one: `WHERE_ITS_SETTLED` and its mixed-list tail both
    // say *card*, and a stall has no card, no request and no answer to send. ⚑ The row the two
    // subjects differ on is `NOUN_OF_KIND` — something IS waiting on a person here — which is why
    // `stalledWorkView`'s docblock argues the shape rather than citing the wall.
    // ⚑ **The vocabulary read off an exhaustive `Record<PersonsQueueKind, …>`** — `KIND_WORDS`.
    const populations: readonly string[] = Object.keys(KIND_WORDS)
    expect(populations).not.toContain('work-stalled')
    expect(populations).not.toContain('a-stall')
    expect([...populations].sort()).toEqual(['a-decision', 'a-question'])
  })
})
