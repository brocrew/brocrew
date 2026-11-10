import type { AboutWork, RoutedRequest, WorkInHand } from '../src/shared/question-contracts'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { distil } from '../src/main/runtime/digest'
import {
  ABOUT_WORK_SAYS,
  NOTHING_NAMED_THE_WORK,
  aboutTheWork,
  escalationChain,
} from '../src/shared/questions'
import { derivePieces, openWorkOf, workNamed } from '../src/shared/tasks'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { syntheticProviderHome, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'main',
  'db',
  'migrations',
)

const FROM = 1_760_000_000_000
const TO = FROM + 12 * 60 * 60 * 1_000

const COLLIDING = 'number:1'

describe('what a request is about, and whose it is', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-474-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-474-root-'))
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

  const conversation = (id: string): void => {
    store.create({
      id,
      provider: 'codex',
      cwd: join(root, id),
      approvalMode: 'ask',
      profileId: `profile-${id}`,
    })
  }

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  const give = (id: string, piece: string, label: string, when: number): void => {
    at(id, when, {
      type: 'work_given',
      piece,
      label,
      parent: 'work_parents_root',
      givenBy: 'sess_parent',
      title: `work ${piece}`,
      brief: `work ${piece}`,
    })
  }

  /** The label of the root a conversation a person started owns. */
  const rootLabel = (id: string): string => {
    const root = store.rootOf(id)
    if (root === null) throw new Error(`${id} owns no root`)
    return root.label
  }

  const askedAboutWork = (
    id: string,
    requestId: string,
    piece: string,
    label: string,
    when: number,
    parent = 'sess_parent',
  ): void => {
    at(id, when, {
      type: 'question_asked',
      requestId,
      piece,
      label,
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    })
    at(id, when + 1, { type: 'request_routed', requestId, to: 'the-parent', parent })
    at(id, when + 2, { type: 'request_escalated', requestId })
  }

  const providerAsked = (
    id: string,
    requestId: string,
    when: number,
    parent = 'sess_parent',
  ): void => {
    at(id, when, {
      type: 'user_input_request',
      id: requestId,
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    })
    at(id, when + 1, { type: 'request_routed', requestId, to: 'the-parent', parent })
    at(id, when + 2, { type: 'request_escalated', requestId })
  }

  const rowFor = (requestId: string): { about: AboutWork; work: readonly WorkInHand[] } => {
    const found = host.questionsForAPerson().rows.find((one) => one.request.requestId === requestId)
    if (found === undefined) throw new Error(`no person's row for ${requestId}`)
    return { about: found.about, work: found.work }
  }

  describe('§1 · two conversations sharing one provider request id', () => {
    const routed = (over: Partial<RoutedRequest> & { requestId: string; askedBy: string }) => ({
      parent: 'sess_parent',
      went: { is: 'the-parent', to: 'the-parent' } as const,
      at: FROM,
      state: 'open' as const,
      endedAt: null,
      escalatedAt: FROM + 1,
      ...over,
    })

    it('the chain follows a parent whose open question shares the child’s request id', () => {
      const child = routed({ requestId: COLLIDING, askedBy: 'sess_child', parent: 'sess_parent' })
      const parentsOwn = routed({
        requestId: COLLIDING,
        askedBy: 'sess_parent',
        parent: 'sess_grandparent',
      })
      const openIn = new Map<string, RoutedRequest>([['sess_parent', parentsOwn]])
      const collided = escalationChain(child, (id) => openIn.get(id) ?? null)
      expect(collided.links.map((one) => one.waiting)).toEqual(['sess_child', 'sess_parent'])
      expect(collided.endsWithAPerson).toBe(true)

      const distinct = escalationChain(child, (id) =>
        id === 'sess_parent' ? { ...parentsOwn, requestId: 'number:2' } : null,
      )
      expect(distinct.links.map((one) => one.waiting)).toEqual(['sess_child', 'sess_parent'])
      expect(distinct.endsWithAPerson).toBe(true)
    })

    it('a real cycle is still refused, and its two requests have different ids', () => {
      const a = routed({ requestId: 'number:1', askedBy: 'sess_a', parent: 'sess_b' })
      const b = routed({ requestId: 'number:9', askedBy: 'sess_b', parent: 'sess_a' })
      const walked = escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null))
      expect(walked.endsWithAPerson).toBe(false)
      expect(walked.links.map((one) => one.waiting)).toEqual(['sess_a', 'sess_b'])
    })

    it('one conversation’s answer does not close another conversation’s request', () => {
      for (const id of ['sess_open', 'sess_answered']) conversation(id)
      at('sess_open', FROM + 10, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_answered', FROM + 11, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_answered', FROM + 12, {
        type: 'user_decision',
        requestId: COLLIDING,
        outcome: 'answered',
      })
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      const gap = drawn.gaps.find((one) => one.kind === 'open-is-not-waiting')
      expect(gap?.count).toBe(1)
      const travelled = drawn.lines.find((one) => one.kind === 'question-travelled')
      expect(travelled?.count).toBe(2)
    })

    it('one conversation’s named work does not answer another conversation’s gap', () => {
      for (const id of ['sess_unnamed', 'sess_named']) conversation(id)
      at('sess_unnamed', FROM + 10, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_named', FROM + 11, {
        type: 'question_asked',
        requestId: COLLIDING,
        piece: 'work_named',
        label: 'W5.1',
        prompt: 'which database?',
        questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
      })
      at('sess_named', FROM + 12, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      expect(drawn.gaps.find((one) => one.kind === 'question-without-work')?.count).toBe(1)
      expect(drawn.lines.find((one) => one.kind === 'question-about-work')?.count).toBe(1)
    })
  })

  describe('§2 · the edge, carried', () => {
    it('a question that named its work says which work, by the label a person quotes', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      give('sess_worker', 'work_b', 'W5.4', FROM + 11)
      askedAboutWork('sess_worker', 'req_asked', 'work_b', 'W5.4', FROM + 20)

      const row = rowFor('req_asked')
      expect(row.about).toEqual({
        is: 'the-asker-named-it',
        work: { label: 'W5.4' },
      })
      expect(row.work.map((one) => one.label)).toEqual([rootLabel('sess_worker'), 'W5.3', 'W5.4'])
    })

    it('a provider-raised question still says nothing recorded which work it is about', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      give('sess_worker', 'work_b', 'W5.4', FROM + 11)
      askedAboutWork('sess_worker', 'req_asked', 'work_b', 'W5.4', FROM + 20)
      providerAsked('sess_worker', 'number:1', FROM + 30)

      expect(rowFor('number:1').about).toEqual({ is: 'nothing-recorded-it' })
      expect(rowFor('req_asked').about.is).toBe('the-asker-named-it')
    })

    it('a named task nothing answers to is not the same answer as a question that named none', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_ghost', 'work_that_was_never_given', 'W5.9', FROM + 20)
      providerAsked('sess_worker', 'number:1', FROM + 30)

      expect(rowFor('req_ghost').about).toEqual({ is: 'named-work-nothing-answers-to' })
      expect(rowFor('number:1').about).toEqual({ is: 'nothing-recorded-it' })
      expect(new Set(Object.values(ABOUT_WORK_SAYS)).size).toBe(3)
    })

    it('a question about work that has since been handed back ends with it, and its record still names the piece', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_asked', 'work_a', 'W5.3', FROM + 20)
      at('sess_worker', FROM + 40, {
        type: 'work_replied',
        piece: 'work_a',
        outcome: 'done',
        summary: 'shipped',
        resources: [],
      })

      expect(
        store.routedRequestsOf('sess_worker').find((one) => one.requestId === 'req_asked')?.state,
      ).toBe('work-replied')
      expect(
        host.questionsForAPerson().rows.find((one) => one.request.requestId === 'req_asked'),
      ).toBeUndefined()
      expect(store.questionsRaisedIn('sess_worker').get('req_asked')?.piece).toBe('work_a')
    })

    it('the arm is chosen by what was FOUND, never by what the caller named', () => {
      const found = { label: 'W1.7' }
      expect(aboutTheWork('work_a', () => found)).toEqual({ is: 'the-asker-named-it', work: found })
      expect(aboutTheWork('work_a', () => null)).toEqual({ is: 'named-work-nothing-answers-to' })
      let asked = 0
      expect(
        aboutTheWork(null, () => {
          asked += 1
          return found
        }),
      ).toEqual({ is: 'nothing-recorded-it' })
      expect(asked, 'the fold looked for work nothing had named').toBe(0)
      expect(NOTHING_NAMED_THE_WORK).toEqual({ is: 'nothing-recorded-it' })
    })
  })

  describe('§3 · why the edge reached the digest and not the person', () => {
    it('the digest still draws the edge, and still draws no question', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_asked', 'work_a', 'W5.3', FROM + 20)
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      const line = drawn.lines.find((one) => one.kind === 'question-about-work')
      expect(line?.count).toBe(1)
      expect(line?.text).toContain('W5.3')
      expect(JSON.stringify(drawn)).not.toContain('which database?')
    })
  })

  describe('§4 · the transcript projection', () => {
    const ASKED: Extract<TranscriptEvent, { type: 'question_asked' }> = {
      type: 'question_asked',
      requestId: 'req_asked',
      piece: 'work_a',
      label: 'W5.3',
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    }

    const GIVEN: TranscriptEvent = {
      type: 'work_given',
      piece: 'work_a',
      label: 'W5.3',
      parent: 'work_parents_root',
      givenBy: 'sess_parent',
      title: 'migrate the schema',
      brief: 'migrate the schema',
    }

    it('the transcript names the work a question is about', () => {
      const state = createTranscript()
      applyEvent(state, GIVEN)
      applyEvent(state, ASKED)
      expect(state.items).toHaveLength(1)
      const item = state.items[0]
      expect(item?.kind).toBe('notice')
      const text = item?.kind === 'notice' ? item.text : ''
      expect(text).toContain('W5.3')
      expect(text).not.toContain('which database?')
    })

    it('a question whose row carries no label names no piece', () => {
      const state = createTranscript()
      const unlabelled: TranscriptEvent = {
        type: 'question_asked',
        requestId: ASKED.requestId,
        piece: 'work_a',
        prompt: ASKED.prompt,
        questions: ASKED.questions,
      }
      applyEvent(state, unlabelled)
      const item = state.items[0]
      const text = item?.kind === 'notice' ? item.text : ''
      expect(text).toBe('asked about a piece of work')
      expect(text).not.toContain('W5')
      const withIt = createTranscript()
      applyEvent(withIt, ASKED)
      const other = withIt.items[0]
      expect(other?.kind === 'notice' ? other.text : '').not.toBe(text)
    })

    it('the assignment is still ledger-only, and only leaves the label behind', () => {
      const state = createTranscript()
      applyEvent(state, GIVEN)
      expect(state.items).toEqual([])
      expect(state.piecesGiven.get('work_a')).toEqual({
        label: 'W5.3',
        title: 'migrate the schema',
      })
    })
  })

  describe('§5 · `workNamed`, beside the predicate it deliberately does not ask', () => {
    const tasks = (): ReturnType<typeof derivePieces> =>
      derivePieces('sess_worker', [
        {
          ordinal: 0,
          at: FROM,
          event: {
            type: 'work_given',
            piece: 'work_open',
            label: 'W5.1',
            parent: 'work_parents_root',
            givenBy: 'sess_parent',
            title: 'one',
            brief: 'one',
          },
        },
        {
          ordinal: 1,
          at: FROM + 1,
          event: {
            type: 'work_given',
            piece: 'work_done',
            label: 'W5.2',
            parent: 'work_parents_root',
            givenBy: 'sess_parent',
            title: 'two',
            brief: 'two',
          },
        },
        {
          ordinal: 2,
          at: FROM + 2,
          event: {
            type: 'work_replied',
            piece: 'work_done',
            outcome: 'done',
            summary: 'shipped',
            resources: [],
          },
        },
      ] satisfies PersistedEventInfo[])

    it('it finds ENDED work, which `openWorkOf` filters out', () => {
      const rows = tasks()
      expect(openWorkOf(rows).map((one) => one.label)).toEqual(['W5.1'])
      expect(workNamed(rows, 'work_done')).toEqual({ label: 'W5.2' })
      expect(workNamed(rows, 'work_open')).toEqual({ label: 'W5.1' })
      expect(workNamed(rows, 'work_nobody_gave')).toBeNull()
      expect(rows).toHaveLength(2)
    })
  })
})
