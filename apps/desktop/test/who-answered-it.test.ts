import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  type PermissionItem,
  type TranscriptState,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  WHO_DID_IT,
  WHO_DID_IT_SAYS,
  didIt,
  nothingRecordsWho,
  whoAnsweredIt,
  type ActedBy,
} from '../src/shared/who-did-it'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { waitFor } from './lib/f093-host'
import { ProviderDouble, anOpenGate } from './lib/provider-double'
import { callOn } from './helpers/call-tool'

/**
 * Who answered it: a person can only have answered a permission, but a question may have been
 * answered by a parent agent, and the Requests surface says which.
 *
 *  - The row: the same event type, answered at a window and by a parent agent, records two words.
 *  - The fold: the actor reaches the card off the row that set the outcome, and a card a teardown
 *    settled carries no actor.
 *  - The words: the vocabulary's sentences, the sentence for a row with no actor (the digest
 *    composes the same one), and the conversation id kept off the card.
 *
 * The one planted population is a row written before the app recorded an actor. The provider is a
 * double and every directory is temporary.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000
const FROM = 1_800_000_000_000
const TO = FROM + 12 * HOUR
const INSIDE = FROM + 6 * HOUR

describe('503 · who answered it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let counter: number
  let handles: FakeSessionHandle[]
  let window: RecordingSink
  let ordinals: Map<string, number>

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-503-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-503-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = INSIDE
    counter = 0
    handles = []
    ordinals = new Map()
    const sessions = new FakeProviderSessions()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, sessions, anOpenGate()),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_503_${String(++counter)}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:503')
    // ⚑ **D-016** — the two projects this file placed its conversations in (`who`, `old`) went with
    // projects; the digest reads one window, and §3's is planted with the one conversation it reads.
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  const decisionsIn = (sessionId: string): TranscriptEvent[] =>
    store
      .events(sessionId)
      .map(({ event }) => event)
      .filter((event) => event.type === 'user_decision')

  const opened = async (profileId: string): Promise<string> => {
    const created = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return created.sessionId
  }

  const liveHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('the conversation received no provider handle')
    return handle
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // the actor is on the row
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the row', () => {
    it('🔴 a PERSON answers a permission and a PARENT AGENT answers a question — two words, one event type', async () => {
      // ⛔ **The divergence, and it is the PO's whole reason.** A permission can only ever have
      // been answered by a person; a routed question can have been answered by the parent. Both
      // write `user_decision`, so a surface reading only one of the two doors would report a word
      // it had never seen vary.

      // ── a person, at a permission card, through the window door
      const asking = await opened('person')
      const card = liveHandle().simulatePermission('perm_1', {
        action: 'Bash',
        detail: 'run: ls',
        availableDecisions: ['allow', 'deny'],
      })
      expect(await host.respondPermission(asking, 'perm_1', { outcome: 'allow' }, window)).toEqual({
        outcome: 'taken',
      })
      await expect(card).resolves.toMatchObject({ outcome: 'allow' })
      expect(decisionsIn(asking)).toEqual([
        { type: 'user_decision', requestId: 'perm_1', outcome: 'allow', by: { who: 'a-person' } },
      ])

      // ── a parent agent, at its worker's routed question, through the agent door
      // ⚑ **D-016** — the worker is started by a give: its brief is its first turn.
      const worker0 = await opened('worker')
      await host.close(worker0, window)
      const parent = await opened('parent')
      const spawned = await callOn(agentToolsFor(host, parent), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Raise the question',
        brief: 'raise the question whose answerer is under test',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      const worker = spawned.agent as string
      const asked = liveHandle().simulateUserInput('Which database?', ['Postgres', 'SQLite'])
      await waitFor(
        () =>
          store
            .events(worker)
            .some(({ event }) => event.type === 'request_routed' && event.requestId === asked.id),
        'the worker question to route to its parent',
      )
      const answered = await host.answerQuestion(
        { questionId: asked.id, answers: [{ part: 'q0', answer: ['Postgres'] }] },
        { ownerId: `agent:${parent}` },
      )
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      expect(decisionsIn(worker)).toEqual([
        {
          type: 'user_decision',
          requestId: asked.id,
          outcome: 'answered',
          // ⚑ **The parent's SESSION id**, which is the arm's own rule — a reader joins the row to
          // that conversation's ledger rather than having to know how a caller id is spelled.
          by: { who: 'an-agent', agent: parent },
        },
      ])

      // 🔴 **The two words differ**, which is the measurement: without this the pair above would be
      // two spellings of whatever the last door happened to write.
      const words = [decisionsIn(asking), decisionsIn(worker)].map(
        (rows) => (rows[0] as { by?: ActedBy }).by?.who,
      )
      expect(words).toEqual(['a-person', 'an-agent'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the fold — the item says what the row says, and nothing more
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the fold', () => {
    const CARD: TranscriptEvent = {
      type: 'permission_request',
      id: 'req_1',
      kind: 'command',
      action: 'Bash',
      detail: 'run: ls',
      scope: {
        cwd: '/work',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    } as never

    const QUESTION: TranscriptEvent = {
      type: 'user_input_request',
      id: 'ui_1',
      prompt: 'AskUserQuestion',
      questions: [{ id: 'q0', prompt: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
    } as never

    const fold = (...events: TranscriptEvent[]): TranscriptState => {
      const state = createTranscript()
      for (const event of events) applyEvent(state, event)
      return state
    }

    const permissionIn = (state: TranscriptState): PermissionItem => {
      const item = state.items.find((one) => one.kind === 'permission')
      expect(item, 'the fold built no permission card').toBeDefined()
      return item as PermissionItem
    }

    const questionIn = (state: TranscriptState): UserInputItem => {
      const item = state.items.find((one) => one.kind === 'userInput')
      expect(item, 'the fold built no question card').toBeDefined()
      return item as UserInputItem
    }

    it('⛔ the actor arrives with the outcome, on both card kinds', () => {
      const permission = permissionIn(
        fold(CARD, {
          type: 'user_decision',
          requestId: 'req_1',
          outcome: 'deny',
          by: { who: 'a-person' },
        } as never),
      )
      expect(permission.outcome).toBe('deny')
      expect(permission.by).toEqual({ who: 'a-person' })

      const question = questionIn(
        fold(QUESTION, {
          type: 'user_decision',
          requestId: 'ui_1',
          outcome: 'answered',
          by: { who: 'an-agent', agent: 'sess_parent' },
        } as never),
      )
      expect(question.answered).toBe('answered')
      expect(question.by).toEqual({ who: 'an-agent', agent: 'sess_parent' })
    })

    it('🔴 a row written before `477` leaves the field absent — and the card still says it was answered', () => {
      // ⛔ **The one population no door can produce**, planted for that reason (HO-029 §2.2).
      const permission = permissionIn(
        fold(CARD, { type: 'user_decision', requestId: 'req_1', outcome: 'allow' } as never),
      )
      expect(permission.outcome).toBe('allow')
      expect(permission.by).toBeUndefined()
      // ⚑ …and the surface has a sentence for exactly this, rather than a blank.
      expect(whoAnsweredIt(permission.by)).toBe('Nothing in the ledger records who answered it')
    })

    it('⛔ a card a TEARDOWN settled carries no actor and no ledger gap — it is a third population', () => {
      // 🔴 **The distinction the cards are keyed on.** `settled`/`answered` is true of a card
      // nobody ever answered; drawing either arm over it would be this app stating something that
      // is not true of it. ⚠️ Through the real door — `markReadOnly` — and not by hand.
      const state = fold(CARD, QUESTION)
      markReadOnly(state, 'settled when this conversation was last open')
      const permission = permissionIn(state)
      const question = questionIn(state)
      expect(permission.note).toBe('settled when this conversation was last open')
      expect(permission.outcome).toBeNull()
      expect(permission.by).toBeUndefined()
      expect(question.answered).toBeNull()
      expect(question.by).toBeUndefined()
    })

    it('⚠️ a second decision on the same request cannot leave the first one’s actor behind', () => {
      // ⛔ **`by` is assigned whether or not the row names anybody**, which is `whoCancelledIt`'s
      // own rule one subject over. Written conditionally, a card would keep an actor from a row
      // that has been superseded by one that names nobody — the app attributing a decision to
      // somebody the ledger does not.
      const state = fold(CARD, {
        type: 'user_decision',
        requestId: 'req_1',
        outcome: 'allow',
        by: { who: 'a-person' },
      } as never)
      expect(permissionIn(state).by).toEqual({ who: 'a-person' })
      applyEvent(state, {
        type: 'user_decision',
        requestId: 'req_1',
        outcome: 'deny',
      } as never)
      expect(permissionIn(state).outcome).toBe('deny')
      expect(permissionIn(state).by).toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the words
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the words', () => {
    it('⛔ every member of the vocabulary gets a clause, and it is the vocabulary’s own sentence', () => {
      for (const word of WHO_DID_IT) {
        const actor = (
          word === 'an-agent' ? { who: word, agent: 'sess_x' } : { who: word }
        ) as ActedBy
        const said = whoAnsweredIt(actor)
        expect(said, word).toBe(`by ${WHO_DID_IT_SAYS[word]}`)
        // ⚑ Never a blank, and never the word `undefined` — which is what indexing the table with
        // a word this build has no sentence for produces.
        expect(said, word).not.toContain('undefined')
      }
      // ⚑ **The control**: the clause is capable of differing between members, so the loop is a
      // measurement rather than a shape check.
      expect(new Set(WHO_DID_IT.map((word) => whoAnsweredIt({ who: word } as ActedBy))).size).toBe(
        WHO_DID_IT.length,
      )
    })

    it('🔴 the conversation’s id stays on the Events tab and off the card', () => {
      // ⛔ **`413 §4`, restated in `describe-event.ts`**: *"the id is printed HERE and nowhere a
      // person reads"*. ⚑ Two phrasings over one vocabulary, and the difference between them IS
      // the rule — so both are asserted, in the same cell, where they diverge.
      const actor: ActedBy = { who: 'an-agent', agent: 'sess_the_parent' }
      expect(whoAnsweredIt(actor)).toBe('by an agent')
      expect(whoAnsweredIt(actor)).not.toContain('sess_the_parent')
      expect(didIt(actor)).toBe('sess_the_parent')
      // …and the Events tab really does draw it, so this is a claim about the product.
      expect(
        describeEvent({
          type: 'user_decision',
          requestId: 'req_1',
          outcome: 'allow',
          by: actor,
        } as never),
      ).toContain('sess_the_parent')
    })

    it('⛔ `465`’s sentence has ONE source of bytes, and the digest composes it from there', async () => {
      // ⚑ **The card and the digest describe the same population.** Two composers would be two
      // chances to disagree about the fact this app has to be most careful with.
      expect(whoAnsweredIt(undefined)).toBe(nothingRecordsWho('answered', 1))
      expect(whoAnsweredIt(undefined)).toBe('Nothing in the ledger records who answered it')

      // 🔴 **The digest, driven — a window holding only rows written before `477`.**
      store.create({
        id: 'sess_old',
        provider: 'codex',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'sess_old',
      })
      at('sess_old', INSIDE, {
        type: 'user_decision',
        requestId: 'req_before_477',
        outcome: 'allow',
      } as never)
      const digest = distil(store.digestWindow(FROM, TO), (id) => id.replace('sess_', ''))
      const line = digest.lines.find((one) => one.kind === 'request-answered')
      expect(line, 'the digest drew no answered line').toBeDefined()
      expect(line!.text).toContain(nothingRecordsWho('answered', 1))
      // ⚠️ …and the plural arm is the digest's and not the card's, so the shared builder is
      // genuinely shared rather than a constant with one reader.
      expect(nothingRecordsWho('answered', 2)).toBe(
        'Nothing in the ledger records who answered them',
      )
    })

    it('⚠️ a word off a replayed ledger this build has no sentence for is said as itself, never `undefined`', () => {
      // ⛔ **The boundary is the LEDGER, not the wire** — `isProposalEnding`'s reason, and
      // `isWhoDidIt`'s: `TranscriptEvent` is `JSON.parse`d and cast with no schema, so a row
      // written by a build whose vocabulary has moved reaches a reader as a word it does not know.
      const later = { who: 'a-kind-a-later-build-wrote' } as unknown as ActedBy
      expect(whoAnsweredIt(later)).toBe('by a-kind-a-later-build-wrote')
      // 🔴 **And the Events tab, which has drawn this value since `477`** and would have printed
      // the string `undefined` for such a row until this dispatch.
      expect(didIt(later)).toBe('a-kind-a-later-build-wrote')
      expect(didIt(later)).not.toContain('undefined')
    })
  })
})
