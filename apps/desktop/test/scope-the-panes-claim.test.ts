import { visibleCopy } from './lib/visible-copy'
import type {
  HowItWasRaised,
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
} from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
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
  aPersonsSince,
} from '../src/shared/questions'
import { fixtureProviderConfig, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', 'src', 'main', 'db', 'migrations')

const FROM = 1_760_000_000_000
const NAME = (id: string): string => id.replace('sess_', '')

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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions: new FakeProviderSessions() }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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

  it('🔴 an `ask_parent` row reads `this-app` and a provider row reads `the-provider`', () => {
    conversation('sess_parent')
    conversation('sess_worker', 'sess_parent')
    const label = given('sess_parent', 'sess_worker', 'work_1', FROM + 1)
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
    expect([...raised.keys()].sort()).toEqual(['req_app', 'req_provider'])
    expect(raised.get('req_app')?.raisedBy).toBe('this-app')
    expect(raised.get('req_provider')?.raisedBy).toBe('the-provider')
    expect(raised.get('req_app')?.raisedBy).not.toBe(raised.get('req_provider')?.raisedBy)

    const walked = host.questionsForAPerson()
    const byId = new Map(walked.rows.map((row) => [row.request.requestId, row.raisedBy]))
    expect(byId.get('req_app')).toBe('this-app')
    expect(byId.get('req_provider')).toBe('the-provider')
  })

  it('⚠️ a routing with no raising row reads `nothing-says`, not `this-app`', () => {
    conversation('sess_orphan')
    at('sess_orphan', FROM + 1, {
      type: 'request_routed',
      requestId: 'req_orphan',
      to: 'the-parent',
      parent: 'sess_parent',
    })
    at('sess_orphan', FROM + 2, { type: 'request_escalated', requestId: 'req_orphan' })
    expect(store.questionsRaisedIn('sess_orphan').has('req_orphan')).toBe(false)
    const rows = host.questionsForAPerson().rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.raisedBy).toBe('nothing-says')
  })
})

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
  const DENIES_RAISING = 'have been raised here'

  it('🔴 a question raised here, and the heading does not deny it', () => {
    const state = paneOverAnAppQuestion()
    const panel = sessionPanel(state)
    expect(JSON.stringify(state.items)).toContain('asked about W1.1')
    expect(panel.waiting).toBe(0)
    expect(panel.empty).toBe(true)

    const head = panelEmptyWords(panel).head
    expect(head).not.toContain(DENIES_RAISING)
    expect(`No permissions, questions or proposals ${DENIES_RAISING}`).toContain(DENIES_RAISING)
  })

  it('⚑ …on every arm, because the heading is shared', () => {
    for (const arm of Object.values(PANEL_EMPTY_WORDS)) {
      expect(arm.head).not.toContain(DENIES_RAISING)
    }
    expect(Object.values(PANEL_EMPTY_WORDS).length).toBeGreaterThan(4)
  })

  it('⚠️ the literal a person reads', () => {
    expect(NOTHING_OPEN_HEAD).toBe('No permissions or questions are on a card here')
  })

  it('🔴 the heading scopes itself with the word the queue uses for the same thing', () => {
    const queue = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/PersonsQueue.vue', import.meta.url)),
      'utf8',
    )
    const withoutProse = (source: string): string =>
      source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const phrase = 'Its card is open in this window too.'
    const readsQueueCard = (source: string): boolean =>
      visibleCopy('PersonsQueue.vue', source).some(
        (said) => said.origin === 'text' && said.text.includes(phrase),
      )
    expect(readsQueueCard(queue)).toBe(true)
    const changedWords = queue.replace(phrase, phrase.replace('card', 'item'))
    expect(changedWords).not.toBe(queue)
    expect(readsQueueCard(changedWords)).toBe(false)
    const code = withoutProse(queue)
    expect(code).toContain(phrase)
    const decorated = queue.replace('<template>', '<template>\n<!-- comment-only-card-word -->')
    expect(decorated).not.toBe(queue)
    expect(readsQueueCard(decorated)).toBe(true)
    expect(decorated).toContain('comment-only-card-word')
    expect(withoutProse(decorated)).not.toContain('comment-only-card-word')
    expect(withoutProse(decorated)).toContain(phrase)
    expect(withoutProse(queue.replace(phrase, ''))).not.toContain(phrase)
    expect(NOTHING_OPEN_HEAD).toContain('card')
  })
})

describe('§3 · what raised it decides whether there is a card', () => {
  it('⛔ every way a question can be raised has an answer, and they are not all the same', () => {
    const every: HowItWasRaised[] = ['nothing-says', 'the-provider', 'this-app']
    const card = (raisedBy: HowItWasRaised): boolean =>
      view([asked(raisedBy)])?.rows[0]?.question !== null
    expect(every.filter(card)).toEqual(['this-app'])
  })

  it('🔴 the statement that feeds the word admits exactly the two types it can name', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/main/db/session-store.ts', import.meta.url)),
      'utf8',
    )
    const clause = /AND type IN \(([^)]*)\)\)\s*\n\s*ORDER BY ordinal`/.exec(source)
    expect(clause, 'the questions-raised statement moved or was re-worded').not.toBeNull()
    const types = (clause?.[1] ?? '')
      .split(',')
      .map((one) => one.trim().replace(/^'|'$/g, ''))
      .sort()
    expect(types).toEqual(['question_asked', 'user_input_request'])
    expect(source).toContain("row.type === 'question_asked' ? 'this-app' : 'the-provider'")
  })
})

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
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy,
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

  it('🔴 a question this app raised is its card here — and a provider’s, one fact over, is sent to its card', () => {
    const ours = view([asked('this-app')], HELD)?.rows[0]
    expect(ours?.question).not.toBeNull()
    expect(ours?.noAnswerHere).toBeNull()
    expect(view([asked('the-provider')], HELD)?.rows[0]?.noAnswerHere).toBe('not-in-this-window')
  })

  it('⚠️ …and it needs no take-over, which also promises a card', () => {
    expect(view([asked('the-provider')])?.rows[0]?.noAnswerHere).toBe('not-yours-yet')
    expect(view([asked('this-app')])?.rows[0]?.noAnswerHere).toBeNull()
  })

  it('⚑ an unknown keeps the sentence it would have had, and claims nothing', () => {
    expect(view([asked('nothing-says')], HELD)?.rows[0]?.noAnswerHere).toBe('not-in-this-window')
    expect(view([asked('nothing-says')])?.rows[0]?.noAnswerHere).toBe('not-yours-yet')
  })

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
      expect(mixed?.rows).toHaveLength(1)
      for (const row of mixed?.rows ?? []) {
        expect(row.question).toBeNull()
        expect(row.noAnswerHere).toBe(held ? 'not-in-this-window' : 'not-yours-yet')
      }
    }
  })

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

describe('§6 · the live attention queue cannot see this question at all', () => {
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
    expect(JSON.stringify(record.transcript.items)).toContain('asked about W1.1')
    expect(attentionQueue([record], () => 'working')).toEqual([])
    applyEvent(record.transcript, {
      type: 'user_input_request',
      id: 'req_2',
      prompt: 'which region?',
      questions: [{ id: 'q1', prompt: 'which region?', options: [{ label: 'eu' }] }],
    } as unknown as TranscriptEvent)
    expect(attentionQueue([record], () => 'working').map((one) => one.requestId)).toEqual(['req_2'])
  })
})
