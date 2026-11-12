import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { waitFor } from './lib/f093-host'
import { REQUEST_STATES } from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentToolset, FakeSessionHandle, UserInputResponse } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { mailboxOf } from '../src/shared/mailbox'
import { REQUEST_IS_OPEN, deriveRoutedRequests } from '../src/shared/questions'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { ProviderDouble } from './lib/provider-double'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('396 · nothing waits on somebody looking', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  /**
   * ⛔ **`over` exists for the crash tests and nothing else** (`354`'s paragraph, `394`'s reuse).
   * `live-hosts.ts` identifies a ledger by OBJECT, so a second host sharing this one's store finds
   * every session in `workRunningElsewhere` and excludes it from the startup repair — which is an
   * exclusion, not a crash. ⚑ §2 uses BOTH, because the difference between them is the thing the
   * `running` half of the sweep is for.
   */
  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-looking-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-looking-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    claimed.add(sessionId)
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** ⚑ The caller a PM's own tools present — `agent-tools.ts`'s `agentCallerId`, spelled once. */
  const asPm = (pm: string): { ownerId: string } => ({ ownerId: `agent:${pm}` })

  /** One capability, changed and nothing else. */

  /** The latest provider status stays idle when later app receipts are written. */
  const quiet = (sessionId: string): boolean => {
    const last = ledger(sessionId)
      .reverse()
      .find((event) => event.type === 'status')
    return last?.type === 'status' && last.state === 'idle'
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is `give_work`, and its brief is the child's first turn** — where
   * `spawn_agent` started a child that had been sent nothing. ⛔ So that the pair stands where a
   * spawn left it — both idle, the child holding no open work and no card routed from it — the brief
   * runs unattended (`auto`, which a child takes from its giver), the child answers it, and only
   * then does each conversation go back to `ask`, from its next turn. ⚠️ Nobody claims the child on
   * the way: its sink is the one a give leaves, which is what §1 is about.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile, host, 'auto')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = latestHandle()
    await waitFor(() => quiet(worker), 'the brief’s turn to end')
    const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'the work is done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await waitFor(
      () =>
        ledger(pm).some(
          (event) => event.type === 'user_turn' && event.text.includes('the work is done'),
        ) && quiet(pm),
      'the answer to reach the pm, and its turn to end',
    )
    await host.setApprovalMode(pm, 'ask', window)
    await host.setApprovalMode(worker, 'ask', THE_APP_ITSELF)
    // ⚑ **The premise, asserted**: nothing open, nothing routed, and nobody has claimed the child.
    expect(store.openPiecesOf(worker)).toEqual([])
    expect(store.routedRequestsOf(worker)).toEqual([])
    expect(claimed.has(worker)).toBe(false)
    return { pm, pmProfile, worker, pmTools, workerHandle }
  }

  /**
   * ⚑ **Raise a question on the child exactly as its provider would**, and wait for the app to have
   * DECIDED where it goes — `394`'s helper, and its two waits for its reason: without the first, a
   * routing that never happened and a request that never reached the ledger fail identically.
   */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
    extra: { secret?: boolean } = {},
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false, extra)
    await waitFor(
      () => ledger(child).some((event) => event.type === 'user_input_request'),
      `the request ${raised.id} to reach ${child}'s ledger`,
    )
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Answer the open card so the turn runs to its own terminal (`379`'s helper). */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  /** Two notes to the child: the first starts a turn that parks on a card, so the second is held. */
  const aNoteHeldBehindAnother = async ({
    pmProfile,
    worker,
    pmTools,
    workerHandle,
  }: {
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }): Promise<void> => {

    const first = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'first',
      kind: 'note',
    })
    expect(first.outcome).toBe('ok')
    await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
    const held = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'second',
      kind: 'note',
    })
    expect(held.delivery, JSON.stringify(held)).toBe('queued')
  }

  describe('the flush is not under an attention gate', () => {
    it('a message held for a child NOBODY is watching goes out when its turn ends', async () => {
      // No window, a busy child, a held message — and the turn ends through the provider rather
      // than through a person, so no sink is ever attached.
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aNoteHeldBehindAnother({ pmProfile, worker, pmTools, workerHandle })

      // Nobody has ever looked at this conversation.
      expect(claimed.has(worker)).toBe(false)
      expect(window.messages.some((one) => one.sessionId === worker)).toBe(false)

      // The turn ends through the parent: answering the card would mean attaching a window. What
      // the flush keys on is `status: 'idle'`, whatever produced it.
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out to a child nobody is watching',
      )
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toContain('sent')
      // …and still nobody looked.
      expect(window.messages.some((one) => one.sessionId === worker)).toBe(false)
    })

    it('…and when the window that WAS watching has gone — the other half of the same gate', async () => {
      const { pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const ghost = new RecordingSink('webContents:9')
      host.claimSession(worker, ghost)
      claimed.add(worker)
      await aNoteHeldBehindAnother({ pmProfile, worker, pmTools, workerHandle })
      const card = await cardOn(worker)
      // The window goes before the turn ends, so every `deliver` after this takes the dead-sink
      // branch.
      ghost.alive = false
      await host.respondPermission(worker, card, { outcome: 'allow' }, ghost)
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out after the window went',
      )
      const seen = ghost.messages.length
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toContain('sent')
      // Nothing reached the departed window, which is what the gate is still for.
      expect(ghost.messages.length).toBe(seen)
    })

    it('the flush does not overtake the status that triggered it', async () => {
      // Measured on the wire, because the ledger takes ordinals in order whatever the send order.
      const { pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      claimed.add(worker)
      await aNoteHeldBehindAnother({ pmProfile, worker, pmTools, workerHandle })
      await letTheTurnFinish(worker)
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out',
      )
      const sent = window.messages
        .filter((one) => one.sessionId === worker)
        .map((one) => one.ordinal)
      // The flush really did publish onto this wire.
      expect(sent.length).toBeGreaterThan(4)
      expect([...sent].sort((left, right) => left - right)).toEqual(sent)
    })
  })

  describe('the request a crash left open', () => {
    it('a launch settles it, and the refusal NAMES the ending rather than the id', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      // ⚑ **The premise**: nothing has ended it, so the ledger reads `open` — which is exactly what
      // a live wait reads, and is why no fold can be the repair.
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open'])

      // ⛔ **A SECOND store object is what makes this a crash**: `live-hosts.ts` compares ledgers by
      // object identity, so this host believes nothing is running — which is what a fresh process
      // believes, and the reason the sweep is safe there.
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded'])

      const refused = await callOn(agentToolsFor(next, pm), 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'question-has-already-ended',
        permanence: 'permanent',
        retryable: false,
        detail: { state: 'stranded' },
      })
      // ⛔ **Nothing was sent.** The repair records a fact; it does not answer on anybody's behalf.
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(false)
    })

    it('⛔ `running` is honoured — and that is what keeps `394`’s rail REACHABLE', async () => {
      // 🔴 **Two claims in one test because they are one mechanism.**
      //
      //  1. A second host over the SAME ledger object finds the conversation in
      //     `workRunningElsewhere` and must NOT strand a request the first host is still holding —
      //     `settleOrphanRuns`' rule, third venue.
      //  2. ⚠️ **And that case is now the only demonstration of
      //     `the-conversation-that-asked-has-gone`**, which `394` reached through the crash this
      //     dispatch repaired. ⛔ A rail nothing reaches passes vacuously; this is what makes it
      //     reachable, and it is stated here so nobody deletes the rail as dead.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)

      // ⚠️ **Constructed and NOT resumed into.** `reserve` refuses a session another live host is
      // running — which is `265`'s rail doing its job — and the sweep is a constructor act, so the
      // construction is the whole of what this test needs.
      const beside = buildHost()
      // ⛔ **Still `open`** — the first host is running it, so this launch left it exactly as it was.
      expect(beside.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['open'])
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)

      const refused = await callOn(agentToolsFor(beside, pm), 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'the-conversation-that-asked-has-gone',
        permanence: 'permanent',
        retryable: false,
      })
    })

    it('a second launch writes nothing more — the sweep is idempotent', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const first = buildHost(createSessionStore(db, tick))
      await first.resumeSession(pm, window)
      const afterOne = ledger(worker).filter((event) => event.type === 'request_stranded').length
      expect(afterOne).toBe(1)
      // The second launch folds the row the first wrote and finds the request closed.
      buildHost(createSessionStore(db, tick))
      expect(ledger(worker).filter((event) => event.type === 'request_stranded').length).toBe(1)
    })

    it('TWO open requests in one conversation are both settled', async () => {
      // The sweep takes `max(ordinal) + 1` per row; a reading hoisted out of the loop would write
      // two rows at one ordinal, which the unique index refuses, and the launch would repair
      // nothing.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const first = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])
      const second = await childAsks(worker, workerHandle, 'which region?', ['eu', 'us'])
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open', 'open'])

      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.requestId)).toEqual([first.id, second.id])
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded', 'stranded'])
      // ⚑ **Two rows at two ordinals**, said as the fact the collision would have broken rather
      // than left to the state assertion above.
      const written = store
        .events(worker)
        .filter((entry) => entry.event.type === 'request_stranded')
        .map((entry) => entry.ordinal)
      expect(written).toHaveLength(2)
      expect(new Set(written).size).toBe(2)
    })

    it('⚑ a conversation that never routed anything is not read at all', async () => {
      // ⚠️ **A negative with a search shape**: the sweep's candidate query asks for
      // `type = 'request_routed'`, so a person's own conversation — which has no parent and
      // therefore no channel — is never a candidate. ⛔ The control is that the sweep DID run in
      // this test, which the second half asserts.
      const alone = await personOpens('nobody-spawned-me')
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)

      const next = buildHost(createSessionStore(db, tick))
      expect(ledger(alone).some((event) => event.type === 'request_stranded')).toBe(false)
      expect(ledger(worker).filter((event) => event.type === 'request_stranded').length).toBe(1)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded'])
    })
  })

  describe('list_questions', () => {
    /**
     * ⛔ **A child that asks while its parent is NOT LIVE** — the whole of `394` §6.2.
     *
     * The routing row is written whatever the parent's state, deliberately, because a durable row
     * that waited on somebody being there to read it would be lost exactly when the parent went
     * first. ⚑ **D-017 · R1 — and `deliverQuestion` no longer returns silently when the parent has
     * no slot**: the question STARTS the parent that has stopped, and it is told.
     */
    const askedWithNobodyHome = async (): Promise<{
      pm: string
      worker: string
      asked: { id: string; answered: Promise<UserInputResponse> }
    }> => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.close(pm, window)
      claimed.delete(pm)
      expect(host.sessionIds).not.toContain(pm)
      const asked = await childAsks(worker, workerHandle)
      // ⚑ **The premise, asserted**: the question travelled, and the parent that had stopped was
      // started for it and TOLD it.
      expect(store.routedRequestsOf(worker)[0]).toMatchObject({
        went: { is: 'the-parent', to: 'the-parent' },
      })
      await waitFor(
        () =>
          ledger(pm).some(
            (event) => event.type === 'user_turn' && event.text.includes('which branch?'),
          ),
        'the question to start the parent and reach it as words',
      )
      return { pm, worker, asked }
    }

    it('🔴 a parent that was not running when its child asked can find the question AND answer it', async () => {
      const { pm, worker, asked } = await askedWithNobodyHome()
      await host.resumeSession(pm, window)
      claimed.add(pm)
      const tools = agentToolsFor(host, pm)

      const listed = await callOn(tools, 'list_questions')
      expect(listed.outcome).toBe('ok')
      const rows = listed.questions as Record<string, unknown>[]
      expect(rows.map((one) => one.question)).toEqual([asked.id])
      expect(rows[0]).toMatchObject({ asked_by: worker, state: 'open', answerable_by_you: true })
      // 🔴 **The words, and they are what makes this a door rather than a list.** An id alone names a
      // thing the caller still cannot act on: `answer_question` takes one entry per PART.
      expect(String(rows[0]?.words)).toContain('part q0')
      expect(String(rows[0]?.words)).toContain('main')

      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['dev'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      await expect(asked.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
    })

    it('⛔ the words are the SAME words a live parent is sent — two paths, one string', async () => {
      // ⚠️ **Not compared against `questionText` called a second time**, which would be a fixture
      // built with the helper under test. ⛔ The control is the OTHER path: a parent that WAS live
      // receives the question as an ordinary turn, and what it received is what the reader hands
      // back.
      const live = await aPmAndItsWorker()
      const liveAsked = await childAsks(live.worker, live.workerHandle)
      // ⚑ **D-016 · the turn that carries the QUESTION** — the parent's ledger also holds the turns
      // its piece's answer came back in.
      const theQuestion = (event: TranscriptEvent): boolean =>
        event.type === 'user_turn' && event.text.includes('which branch?')
      await waitFor(
        () => ledger(live.pm).some(theQuestion),
        'the question to reach the live parent as words',
      )
      const delivered = ledger(live.pm).find(theQuestion)
      if (delivered === undefined || delivered.type !== 'user_turn') throw new Error('no turn')
      const rows = (await callOn(agentToolsFor(host, live.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(rows.find((one) => one.question === liveAsked.id)?.words).toBe(delivered.text)
    })

    it('🔴 a PERMISSION lists and carries NO words — and the `because` narrowing is what does it', async () => {
      // 🔴 **ONE thing stands between a parent and a permission's text, and this is it.**
      //
      // ⛔ **A secret is a `user_input_request` WITH a prompt and parts** that the channel refuses —
      // the same shape a Codex `item/permissions/requestApproval` arrives in, told apart by a field
      // rather than by a type. ⚑ `questionsRaisedIn` hands its words back happily, which the second
      // assertion below states rather than leaves implied; the `because` gate is what does not.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const secret = await childAsks(worker, workerHandle, 'the token?', [], { secret: true })
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions as Record<
        string,
        unknown
      >[]
      const row = rows.find((one) => one.question === secret.id)
      // ⛔ **It LISTS**, which is `394` §2 unchanged: a reader that dropped it would make the
      // refusal below unreachable and the census permanently blind.
      expect(row).toMatchObject({
        state: 'open',
        answerable_by_you: false,
        because: 'a-secret-only-a-person-can-type',
        words: null,
      })
      // ⛔ **And the store DID have the words** — the premise that makes `words: null` a gate rather
      // than an absence. ⚠️ Without this line the assertion above would pass just as well if the
      // reader had simply failed to find the request.
      expect(store.questionsRaisedIn(worker).get(secret.id)?.prompt).toBe('the token?')
      // ⚑ **And it is still refused BY NAME**, so the caller is told what it named rather than that
      // there is nothing there.
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: secret.id,
          answers: [{ part: 'q0', answer: ['hunter2'] }],
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'a-person-answers-this-one' })
    })

    it('⛔ …and a permission CARD has no words to leak — the shape, which is NOT a second gate', async () => {
      // ⚠️ **This test used to claim it was the other half of a pair, and it is not.** `396` wrote a
      // mutation row widening `selectQuestionsRaised` to admit `permission_request` and the row
      // SURVIVED: that event carries `kind`, `action` and `detail` and has neither `prompt` nor
      // `questions`, so the widened query returns SQL `NULL`s and the reader skips a row it cannot
      // read. ⛔ The `type` filter is `053`'s narrow read, not a gate — the row was removed and both
      // docblocks were corrected.
      //
      // ⚑ **What this still measures is worth keeping**: a permission card LISTS, so the refusal
      // stays reachable and `permissionShaped` stays informative, and it carries no words.
      const { pm, worker } = await aPmAndItsWorker()
      await host.send(worker, 'a long piece of work', asPm(pm))
      await cardOn(worker)
      await waitFor(
        () => store.routedRequestsOf(worker).length > 0,
        'the permission card to be routed',
      )
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions as Record<
        string,
        unknown
      >[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ because: 'a-permission-decision', words: null })
      expect(store.questionsRaisedIn(worker).size).toBe(0)
    })

    it('⚠️ a stranded question lists with its ending, and the line SPELLS OUT what that means', async () => {
      // ⛔ **A word cannot carry `stranded`**: a reader told only that would as likely conclude its
      // child had gone away, which is the wrong thing to do about a conversation it can ask again.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const tool = agentToolsFor(next, pm).tools.find((one) => one.name === 'list_questions')
      const answered = await tool!.call({ state: 'all' })
      const listed = (answered.structured ?? {}) as Record<string, unknown>
      expect((listed.questions as Record<string, unknown>[])[0]?.state).toBe('stranded')
      expect(answered.text).toContain('the app restarted while it was waiting')
      expect(answered.text).toContain('nothing is waiting on you')
    })

    it('⛔ a caller sees only its OWN family — the entitlement is the lookup, and it takes no argument', async () => {
      // ⚑ **Structural rather than checked** (`394`'s rule): `me` is minted by the toolset from the
      // session it was built for, and `list_questions` advertises no argument that names a
      // conversation — so there is no id a caller could spell to reach somebody else's family.
      const mine = await aPmAndItsWorker()
      const theirs = await aPmAndItsWorker()
      const asked = await childAsks(theirs.worker, theirs.workerHandle)
      const rows = (await callOn(agentToolsFor(host, mine.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(rows).toEqual([])
      // ⚑ **The paired positive**: the row exists and the OTHER parent can see it, so the empty
      // answer above is an entitlement rather than a reader that finds nothing.
      const theirRows = (await callOn(agentToolsFor(host, theirs.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(theirRows.map((one) => one.question)).toEqual([asked.id])
      const definition = agentToolsFor(host, mine.pm).tools.find(
        (one) => one.name === 'list_questions',
      )
      // ⚑ What it takes chooses how much of its own family's questions is listed, never whose.
      expect(Object.keys(definition?.input ?? {})).toEqual(['state', 'limit'])
    })

    it('⚠️ a request id REPEATED across a resume reads the LIVE question’s words', async () => {
      // ⛔ **`394` §5's finding, met at a second door.** A request id is unique per PROVIDER SESSION
      // and a resumed conversation is a new one, so one ledger holds `ui_1` twice — and a reader
      // keyed by id has to say which. ⚑ Ordinal order, last wins, which is the same rule
      // `answerQuestion` takes: the live request is the only one anybody can answer.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const before = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])
      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      const after = await childAsks(worker, latestHandle(), 'which region?', ['eu', 'us'])
      // ⚑ **The premise, asserted rather than assumed**: they really do share an id.
      expect(after.id).toBe(before.id)

      // ⚑ Every question, the ended ones too: an ended duplicate is what this guards against.
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions', { state: 'all' }))
        .questions as Record<string, unknown>[]
      // 🔴 **675 · ONE entry for the id, the live one** (`661` F2). ⛔ This listed
      // `['abandoned', 'open']` until `675`, and the abandoned entry carried the LIVE question's words
      // (the last row wins in `questionsRaisedIn`) — an entry no call can reach, since the answer
      // door takes the last row for an id, wearing words that were never its own.
      expect(rows.map((one) => one.state)).toEqual(['open'])
      // 🔴 **The live row's words are the live question's**, which is what the caller acts on.
      expect(String(rows[0]?.words)).toContain('which region?')
      expect(String(rows[0]?.words)).not.toContain('which branch?')
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: after.id,
          answers: [{ part: 'q0', answer: ['eu'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('⚑ a conversation nobody has asked anything gets a sentence, not an empty list to interpret', async () => {
      const { pm } = await aPmAndItsWorker()
      const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'list_questions')
      const answered = await tool!.call({})
      expect(answered.structured).toMatchObject({ outcome: 'ok', questions: [] })
      expect(answered.text).toBe('no conversation you started has asked you anything')
    })
  })

  describe('after the app comes back', () => {
    it('the stranding survives a relaunch, because it is a ROW rather than a decision', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const atTheStranding = next.questionsVisibleTo(pm)
      expect(atTheStranding.map((one) => one.state)).toEqual(['stranded'])

      // Derived again from the ledger alone, by a third host.
      const third = buildHost(createSessionStore(db, tick))
      await third.resumeSession(pm, window)
      expect(third.questionsVisibleTo(pm)).toEqual(atTheStranding)
      // …and the fold agrees when it is handed the raw ledger, which is the replayed path.
      expect(deriveRoutedRequests(worker, store.events(worker)).map((one) => one.state)).toEqual([
        'stranded',
      ])
    })

    it('a message flushed to an unwatched child is in the ledger the next launch reads', async () => {
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aNoteHeldBehindAnother({ pmProfile, worker, pmTools, workerHandle })
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out',
      )
      await host.closeAll()

      // The constructor's sweep finds nothing to repair: the message already ended as `sent`,
      // not the `abandoned` a crash writes.
      buildHost(createSessionStore(db, tick))
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual(['sent'])
    })

    it('a question answered through `list_questions` reads `answered` to the next launch', async () => {
      const { pm, worker } = await askedThenAnswered()
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['answered'])
      // …and the launch did not strand it: an answered request is not open.
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)
    })

    const askedThenAnswered = async (): Promise<{
      pm: string
      worker: string
      asked: { id: string; answered: Promise<UserInputResponse> }
    }> => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.close(pm, window)
      claimed.delete(pm)
      const asked = await childAsks(worker, workerHandle)
      await host.resumeSession(pm, window)
      claimed.add(pm)
      const tools = agentToolsFor(host, pm)
      const rows = (await callOn(tools, 'list_questions')).questions as Record<string, unknown>[]
      expect(rows[0]?.question).toBe(asked.id)
      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['main'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      return { pm, worker, asked }
    }
  })

  describe('the request states', () => {
    it('every request state is reachable or accounted for, and only `open` is answerable', () => {
      expect(REQUEST_STATES.filter((state) => REQUEST_IS_OPEN[state])).toEqual(['open'])
      expect(REQUEST_STATES).toContain('stranded')
      expect(REQUEST_IS_OPEN.stranded).toBe(false)
    })
  })
})
