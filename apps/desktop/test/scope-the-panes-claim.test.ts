import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  NOTHING_OPEN_HEAD,
  PANEL_EMPTY_WORDS,
  panelEmptyWords,
  sessionPanel,
} from '../src/renderer/src/lib/session-panel'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { personsQueueView, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import {
  NOTHING_NAMED_THE_WORK,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type HowItWasRaised,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
  aPersonsSince,
} from '../src/shared/questions'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **602 · the pane may only claim what it looked at, and nothing may send a person to a card
 * that does not exist** — `589`'s repair 3, `HO-082` §4.3.
 *
 * ## ⛔ The defect, in the two sentences a person read
 *
 * ⚠️ **A worker that calls `ask_parent` writes `question_asked` into its OWN ledger.**
 * `transcript.ts` folds that row into a NOTICE — *"asked about Task #1"* (*"asked about W1.1"*
 * since D-016) — and draws no card. So:
 *
 * | surface | what it said | what was true |
 * |---|---|---|
 * | the conversation pane | *"No permissions, questions or proposals **have been raised here**"* | a question had been raised here, two lines above, by this app |
 * | the person's queue, top line | *"This takes you to the card; **the card is where you answer**"* | there is no card, in this window or any other |
 * | the person's queue, row | *"its card is not in the part on screen — **open it to answer**"* | same |
 *
 * ## 🔴 Why `591` did not close it, which §1 of the brief asked first
 *
 * ⛔ **`591` made a question outlive its clock** (`HO-082` §2) — the five-minute bound then
 * bounded the worker's tool call and nothing else, and `608` removed that too (`HO-084` §4).
 * ⚑ That is about a question's LIFETIME. ⚠️ **These three
 * sentences are about what a surface COUNTED**, and `591` touched neither `session-panel.ts` nor
 * `persons-queue.ts` nor `attention.ts`.
 *
 * ## ⚑ What this file pins, and the split `589` priced
 *
 * ⛔ **Literal AND meaning.** §2 reads the exact words a person sees (`169` §2's rule); §3 and §4
 * read the PROPERTY — that no claim about cards is made over a row that has none — through the
 * fold, with a planted control on each so the comparison can fail.
 *
 * ⚠️ **§1 goes through the real store and the real host**, because the whole repair rests on one
 * fact being readable at all: which ROW raised a request. A fixture that handed the word in would
 * pin the renderer and prove nothing about where the word comes from.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
/** ⚑ The drizzle folder, as every store-backed suite in this directory names it. */
const MIGRATIONS = join(HERE, '..', 'src', 'main', 'db', 'migrations')

const FROM = 1_760_000_000_000
const NAME = (id: string): string => id.replace('sess_', '')

/* ───────────────────────────────────────────────────────────────── §1 · through the real store */

describe('§1 · which row raised it, read off the ledger', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let counter: number
  const ordinals = new Map<string, number>()
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-602-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-602-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, MIGRATIONS)
    clock = FROM + 60_000
    counter = 0
    ordinals.clear()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions: new FakeProviderSessions() }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const conversation = (id: string, parentSessionId?: string): void => {
    store.create({
      id,
      provider: 'codex',
      cwd: join(root, id),
      approvalMode: 'ask',
      profileId: `profile-${id}`,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
  }

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  /**
   * ⚑ **D-016 · a piece `giver` gave `owner`, written the way the give writes it** — the `work` row
   * and the owner's `work_given` together, through the store's own `recordGive`, under the giver's
   * root. Returns the piece's label.
   */
  const given = (giver: string, owner: string, piece: string, when: number): string => {
    const parent = store.rootOf(giver)
    if (parent === null) throw new Error(`${giver} owns no root`)
    const number = store.numberUnder(parent.piece)
    const label = `${parent.label}.${String(number)}`
    const ordinal = ordinals.get(owner) ?? 0
    ordinals.set(owner, ordinal + 1)
    const fields = {
      piece,
      parent: parent.piece,
      givenBy: giver,
      title: 'the trip',
      brief: 'plan the trip',
    }
    store.recordGive(
      { ...fields, number, owner, folder: null, inputs: [] },
      ordinal,
      { type: 'work_given', ...fields, label },
      when,
    )
    return label
  }

  /**
   * 🔴 **The two rows a person's queue can hold, planted side by side** — standing rule 12's
   * *plant TWO*, and standing rule 3's *the same call one fact over*.
   *
   * ⛔ **Same routing, same escalation, one difference**: which event raised the request. ⚑ That is
   * the only thing `HowItWasRaised` may depend on, so a reader that had gone on inferring it from
   * `piece` would answer identically here and differently the day a provider row carries one.
   */
  it('🔴 an `ask_parent` row reads `this-app` and a provider row reads `the-provider`', () => {
    conversation('sess_parent')
    conversation('sess_worker', 'sess_parent')
    const label = given('sess_parent', 'sess_worker', 'work_1', FROM + 1)
    // ⚑ **The app's own row** — `ask_parent` writes this, and only this, with a `piece`.
    at('sess_worker', FROM + 2, {
      type: 'question_asked',
      requestId: 'req_app',
      piece: 'work_1',
      label,
      prompt: 'which hotel?',
      questions: [{ id: 'answer', prompt: 'which hotel?', options: [] }],
    })
    at('sess_worker', FROM + 3, {
      type: 'request_routed',
      requestId: 'req_app',
      to: 'the-parent',
      parent: 'sess_parent',
    })
    at('sess_worker', FROM + 4, { type: 'request_escalated', requestId: 'req_app' })
    // ⚑ **The provider's own row**, routed the same way. ⛔ It carries no `piece` and never can.
    at('sess_worker', FROM + 5, {
      type: 'user_input_request',
      id: 'req_provider',
      prompt: 'which region?',
      questions: [{ id: 'q1', prompt: 'which region?', options: [{ label: 'eu' }] }],
    })
    at('sess_worker', FROM + 6, {
      type: 'request_routed',
      requestId: 'req_provider',
      to: 'the-parent',
      parent: 'sess_parent',
    })
    at('sess_worker', FROM + 7, { type: 'request_escalated', requestId: 'req_provider' })

    const raised = store.questionsRaisedIn('sess_worker')
    // ⚑ **The premise, asserted**: both rows really are in this ledger, so the two readings below
    // are of a state that exists rather than of an empty map.
    expect([...raised.keys()].sort()).toEqual(['req_app', 'req_provider'])
    expect(raised.get('req_app')?.raisedBy).toBe('this-app')
    expect(raised.get('req_provider')?.raisedBy).toBe('the-provider')
    // ⛔ **And the two differ**, which is what makes either reading a measurement
    // (`a-positive-assertion-must-differ-from-the-default`).
    expect(raised.get('req_app')?.raisedBy).not.toBe(raised.get('req_provider')?.raisedBy)

    // 🔴 **…and the word survives to the person's reader**, which is where `474`'s edge fell out.
    const walked = host.questionsForAPerson()
    const byId = new Map(walked.rows.map((row) => [row.request.requestId, row.raisedBy]))
    expect(byId.get('req_app')).toBe('this-app')
    expect(byId.get('req_provider')).toBe('the-provider')
  })

  /**
   * ⚠️ **The third arm is not a default and is reachable** — a routed request whose raising row is
   * not in this generation's ledger. ⛔ `nothing-says` is *this app cannot tell*, and every
   * sentence then keeps what it would have said anyway.
   */
  it('⚠️ a routing with no raising row reads `nothing-says`, not `this-app`', () => {
    conversation('sess_orphan')
    at('sess_orphan', FROM + 1, {
      type: 'request_routed',
      requestId: 'req_orphan',
      to: 'the-parent',
      parent: 'sess_parent',
    })
    at('sess_orphan', FROM + 2, { type: 'request_escalated', requestId: 'req_orphan' })
    // ⚑ The premise: the raising row really is absent.
    expect(store.questionsRaisedIn('sess_orphan').has('req_orphan')).toBe(false)
    const rows = host.questionsForAPerson().rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.raisedBy).toBe('nothing-says')
  })
})

/* ──────────────────────────────────────────────────────── §2 · the pane, literal and meaning */

/** The conversation `589` photographed: a worker holding an open `ask_parent` question. */
function paneOverAnAppQuestion(): ReturnType<typeof createTranscript> {
  const state = createTranscript()
  applyEvent(state, {
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.1',
    parent: 'work_root',
    givenBy: 'sess_pm',
    title: 'the trip',
    brief: 'plan the trip',
  } as unknown as TranscriptEvent)
  applyEvent(state, {
    type: 'question_asked',
    requestId: 'req_1',
    piece: 'work_1',
    label: 'W1.1',
    prompt: 'which hotel?',
    questions: [{ id: 'answer', prompt: 'which hotel?', options: [] }],
  } as unknown as TranscriptEvent)
  return state
}

describe('§2 · the pane says what it walked', () => {
  /**
   * ⛔ **The retired claim, and the reason it is named as a string rather than described.** A
   * heading that denies RAISING is false in this state whatever else it says, and this is the one
   * assertion in the file that would have gone red on the day the defect shipped.
   */
  const DENIES_RAISING = 'have been raised here'

  it('🔴 a question raised here, and the heading does not deny it', () => {
    const state = paneOverAnAppQuestion()
    const panel = sessionPanel(state)
    // ⚑ **The premise, measured, so the claim below is about this state**: the app DREW the
    // question in this conversation — as a notice, which is why the column counts nothing.
    expect(JSON.stringify(state.items)).toContain('asked about W1.1')
    expect(panel.waiting).toBe(0)
    expect(panel.empty).toBe(true)

    const head = panelEmptyWords(panel).head
    expect(head).not.toContain(DENIES_RAISING)
    // ⛔ **The planted control**: the sentence that shipped DOES contain it, so the assertion above
    // is capable of failing (`a-positive-assertion-must-differ-from-the-default`).
    expect(`No permissions, questions or proposals ${DENIES_RAISING}`).toContain(DENIES_RAISING)
  })

  it('⚑ …on every arm, because the heading is shared', () => {
    for (const arm of Object.values(PANEL_EMPTY_WORDS)) {
      expect(arm.head).not.toContain(DENIES_RAISING)
    }
    // ⚑ The floor, so an emptied table would not pass this vacuously.
    expect(Object.values(PANEL_EMPTY_WORDS).length).toBeGreaterThan(4)
  })

  it('⚠️ the literal a person reads', () => {
    expect(NOTHING_OPEN_HEAD).toBe('No permissions or questions are on a card here')
  })

  /**
   * 🔴 **The MEANING half: the noun the heading scopes itself with is the app's own noun for this
   * population** — and it is read out of the other surface rather than typed twice.
   *
   * ⛔ **`492`'s one word, two claims, on one screen** — pointed at deliberately. The queue tells a
   * person to *open the card*; the pane says nothing is *on a card*. If either surface renamed the
   * thing, one of them would be describing a population the other has no word for.
   */
  it('🔴 the heading scopes itself with the word the queue uses for the same thing', () => {
    const queue = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/PersonsQueue.vue', import.meta.url)),
      'utf8',
    )
    // ⛔ Comments stripped first — this file's own subject is quoted in that component's prose
    // (`a-source-census-must-strip-prose-before-it-asserts`).
    const code = queue.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toContain('card')
    // ⚑ …and the strip really removed prose, so the positive above is not a read of comments.
    expect(queue.length).toBeGreaterThan(code.length)
    expect(NOTHING_OPEN_HEAD).toContain('card')
  })
})

/* ─────────────────────────────────────────────────────── §3 · the fold from raised to card */

describe('§3 · what raised it decides whether there is a card', () => {
  /**
   * 🔴 **UI-009 · a question this app raised IS its card** on the person's queue (`QuestionCard`),
   * and every other way a question is raised keeps the row that sends a person to a card — ⛔ the
   * unknown included, which is not folded into this app's.
   */
  it('⛔ every way a question can be raised has an answer, and they are not all the same', () => {
    const every: HowItWasRaised[] = ['nothing-says', 'the-provider', 'this-app']
    const card = (raisedBy: HowItWasRaised): boolean =>
      view([asked(raisedBy)])?.rows[0]?.question !== null
    expect(every.filter(card)).toEqual(['this-app'])
  })

  /**
   * ⛔ **Rule 20's question, asked of this category**: *what is it ABOUT*, not *where does it come
   * from*. ⚠️ The ternary in `questionsRaisedIn` is exhaustive only because the statement above it
   * admits exactly two event types — ⛔ **so a third type added to that `WHERE` would land on
   * `the-provider` silently**, and this is what refuses it.
   */
  it('🔴 the statement that feeds the word admits exactly the two types it can name', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/main/db/session-store.ts', import.meta.url)),
      'utf8',
    )
    // ⚠️ **671 · the filter moved INSIDE the subquery that guards the payload** (R18), so the
    // clause now closes that subquery before `ORDER BY` — re-aimed to the new shape, and still
    // the one statement that ends this way.
    const clause = /AND type IN \(([^)]*)\)\)\s*\n\s*ORDER BY ordinal`/.exec(source)
    expect(clause, 'the questions-raised statement moved or was re-worded').not.toBeNull()
    const types = (clause?.[1] ?? '')
      .split(',')
      .map((one) => one.trim().replace(/^'|'$/g, ''))
      .sort()
    expect(types).toEqual(['question_asked', 'user_input_request'])
    // ⚑ …and the app's row is named by the branch that maps it, so renaming the event without
    // re-reading this branch is red rather than quiet.
    expect(source).toContain("row.type === 'question_asked' ? 'this-app' : 'the-provider'")
  })
})

/* ──────────────────────────────────────────────────── §4 · the queue sends nobody to nothing */

const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: Math.max(rows.length, 1),
  rowsUnread: 0,
})

function asked(raisedBy: HowItWasRaised, requestId = 'req_1'): PersonsQuestion {
  const request: RoutedRequest = {
    requestId,
    askedBy: 'sess_worker',
    parent: 'sess_pm',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 31_000,
  }
  const chain = escalationChain(request, () => null)
  return {
    request,
    // ⚑ **611 · when it became a person's** — see PersonsQuestion.aPersonsSince.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy,
    // ⚑ **619 · `602`'s own suite, and its rows offer nothing to press** — since UI-009 such a
    // row is its card, answered in the box.
    offered: null,
    asked: null,
  }
}

function world(over: Partial<PersonsQueueWorld> = {}): PersonsQueueWorld {
  return {
    held: new Set<string>(),
    answerable: new Map<string, AttentionRequest>(),
    now: 91_000,
    lastLookAnswered: { questions: true, decisions: true },
    answeredFromHere: new Set<string>(),
    ...over,
  }
}

function view(questions: readonly PersonsQuestion[], over: Partial<PersonsQueueWorld> = {}) {
  return personsQueueView(WALK(questions), WALK<PersonsDecision>([]), world(over))
}

describe('§4 · the row says why there is nothing to press', () => {
  const HELD = { held: new Set(['sess_worker']) }

  /**
   * 🔴 **The defect, and the same call one fact over** (standing rule 3). ⛔ Both rows are routed,
   * escalated, open and in a conversation this window HOLDS; the only difference is what raised
   * them. ⚑ **UI-009** — this app's is its own card on the row, and sends nobody anywhere.
   */
  it('🔴 a question this app raised is its card here — and a provider’s, one fact over, is sent to its card', () => {
    const ours = view([asked('this-app')], HELD)?.rows[0]
    expect(ours?.question).not.toBeNull()
    expect(ours?.noAnswerHere).toBeNull()
    expect(view([asked('the-provider')], HELD)?.rows[0]?.noAnswerHere).toBe('not-in-this-window')
  })

  it('⚠️ …and it needs no take-over, which also promises a card', () => {
    // ⛔ Nobody holds it: the answer for a provider row is `not-yours-yet`, whose sentence says
    // *its card cannot be answered from here yet* — a promise of a card that exists later.
    expect(view([asked('the-provider')])?.rows[0]?.noAnswerHere).toBe('not-yours-yet')
    expect(view([asked('this-app')])?.rows[0]?.noAnswerHere).toBeNull()
  })

  it('⚑ an unknown keeps the sentence it would have had, and claims nothing', () => {
    expect(view([asked('nothing-says')], HELD)?.rows[0]?.noAnswerHere).toBe('not-in-this-window')
    expect(view([asked('nothing-says')])?.rows[0]?.noAnswerHere).toBe('not-yours-yet')
  })

  /**
   * 🔴 **The other population may never reach the new arm, and the reason is not symmetry.**
   *
   * ⛔ **A `PersonsDecision` is a request that did NOT travel** — the provider raised it in the
   * asker's own conversation and `transcript.ts` drew its card there.
   * ⚠️ **So *open it to answer* is a true instruction for every row of it**, and a widening
   * that let it say otherwise would take a working control away from one population to fix another
   * (`an-entitlement-widening-must-be-opt-in-at-the-call-site`, pointed the other way).
   */
  it('🔴 a decision always has a card, whoever is holding the conversation', () => {
    const decision: PersonsDecision = (() => {
      const request: RequestOnlyAPersonCanSettle = {
        requestId: 'req_d',
        askedBy: 'sess_worker',
        parent: 'sess_pm',
        went: {
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because: 'a-permission-decision',
        },
        at: 1_000,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
      }
      return {
        request,
        // ⚑ **611 · when it became a person's** — see PersonsQuestion.aPersonsSince.
        aPersonsSince: aPersonsSince(request),
        reading: decisionReading('sess_worker', NAME),
        sentence: readingSentence(decisionReading('sess_worker', NAME)),
        says: 'a command or file approval, which is a person’s to give',
        work: [],
      } as PersonsDecision
    })()
    for (const held of [true, false]) {
      const mixed = personsQueueView(
        WALK<PersonsQuestion>([]),
        WALK([decision]),
        world(held ? { held: new Set(['sess_worker']) } : {}),
      )
      // ⚑ **The premise**: the row really is in the view.
      expect(mixed?.rows).toHaveLength(1)
      for (const row of mixed?.rows ?? []) {
        expect(row.question).toBeNull()
        expect(row.noAnswerHere).toBe(held ? 'not-in-this-window' : 'not-yours-yet')
      }
    }
  })

  /**
   * ⛔ **A live row keeps its answers** — and ⚑ **UI-009** a question this app raised, which can
   * never have a live projection (`question_asked` makes no attention item), is its card even
   * where one is planted: the card is the one way it is answered.
   */
  it('⛔ a live row keeps its answers, and this app’s question stays its card', () => {
    const live: AttentionRequest = {
      key: 'sess_worker:req_1',
      sessionId: 'sess_worker',
      requestId: 'req_1',
      itemId: 'item_1',
      kind: 'userInput',
      where: 'worker',
      hasACommander: false,
      provider: 'claude',
      sent: false,
      decisions: [{ value: 'yes', label: 'Yes', tone: 'primary' }],
      limit: null,
      noPositive: null,
      refused: null,
    } as unknown as AttentionRequest
    const theirs = view([asked('the-provider')], {
      ...HELD,
      answerable: new Map([['sess_worker:req_1', live]]),
    })?.rows[0]
    expect(theirs?.noAnswerHere).toBeNull()
    expect(theirs?.answers).toHaveLength(1)
    const ours = view([asked('this-app')], {
      ...HELD,
      answerable: new Map([['sess_worker:req_1', live]]),
    })?.rows[0]
    expect(ours?.question).not.toBeNull()
    expect(ours?.answers).toEqual([])
  })
})

// ⚑ **§5 is retired with what it measured** — UI-009 (F052) took the line above the rows out:
// *"Nobody above them has answered. This takes you to the card…"* explained the machinery.

/* ───────────────────────────────────────────── §6 · what the OTHER queue can see, measured */

describe('§6 · the live attention queue cannot see this question at all', () => {
  /**
   * ⚠️ **Measured rather than argued, and NOT repaired here** — the brief's §6 says to name it and
   * ask. ⛔ `attentionQueue` walks pending `permission` and `userInput` ITEMS, and
   * `question_asked` makes none — so a conversation frozen on an `ask_parent` call contributes
   * nothing to it. 🔴 **`AttentionQueue.vue` then draws *"No conversation this window is running is
   * frozen on a permission or a question"*** over a conversation that is frozen on exactly that.
   * ⚑ Reported in `602`'s response; this case pins the read, not the sentence.
   */
  it('⚠️ a conversation holding an open `ask_parent` question contributes no attention row', () => {
    const record = createSessionRecord('sess_worker')
    record.phase = 'open'
    for (const event of [
      {
        type: 'work_given',
        piece: 'work_1',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'the trip',
        brief: 'plan the trip',
      },
      {
        type: 'question_asked',
        requestId: 'req_1',
        piece: 'work_1',
        label: 'W1.1',
        prompt: 'which hotel?',
        questions: [{ id: 'answer', prompt: 'which hotel?', options: [] }],
      },
    ]) {
      applyEvent(record.transcript, event as unknown as TranscriptEvent)
    }
    // ⚑ **The premise**: the question really is in this record's transcript.
    expect(JSON.stringify(record.transcript.items)).toContain('asked about W1.1')
    expect(attentionQueue([record], () => 'working')).toEqual([])
    // ⛔ **The paired positive** — a provider question in the same record DOES produce a row, so
    // the empty above is a fact about this population and not about the fixture.
    applyEvent(record.transcript, {
      type: 'user_input_request',
      id: 'req_2',
      prompt: 'which region?',
      questions: [{ id: 'q1', prompt: 'which region?', options: [{ label: 'eu' }] }],
    } as unknown as TranscriptEvent)
    expect(attentionQueue([record], () => 'working').map((one) => one.requestId)).toEqual(['req_2'])
  })
})
