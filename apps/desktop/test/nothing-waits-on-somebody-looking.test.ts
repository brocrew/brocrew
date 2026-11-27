import { newConversationGive } from './lib/give-fixture'
import { permissionCardOn } from './helpers/permission-card-on'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime/testing'
import { waitFor } from './lib/f093-host'
import { REQUEST_STATES } from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentToolset } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
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
import { nativeQuestionOn } from './helpers/native-question'
import { callOn } from './helpers/call-tool'

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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** ⚑ The caller a PM's own tools present — `agent-tools.ts`'s `agentCallerId`, spelled once. */
  const asPm = (pm: string): { ownerId: string } => ({ ownerId: `agent:${pm}` })

  /** The latest provider status stays idle when later app receipts are written. */
  const quiet = (sessionId: string): boolean => {
    const last = ledger(sessionId)
      .reverse()
      .find((event) => event.type === 'status')
    return last?.type === 'status' && last.state === 'idle'
  }

  const aPmAndItsWorker = async (
    keepPieceOpen = false,
  ): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
    aboutPiece: { piece: string; label: string }
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile, host, 'auto')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(
      pmTools,
      'give_work',
      newConversationGive(
        workerProfile,
        'the work this dispatch is about',
        'the work this dispatch is about',
      ),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = latestHandle()
    await waitFor(() => quiet(worker), 'the brief’s turn to end')
    const { piece, label } = store.workByLabel(given.label as string)!
    if (!keepPieceOpen) {
      const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
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
      expect(store.openPiecesOf(worker)).toEqual([])
    }
    await host.setApprovalMode(pm, 'ask', window)
    await host.setApprovalMode(worker, 'ask', THE_APP_ITSELF)
    expect(store.routedRequestsOf(worker)).toEqual([])
    expect(claimed.has(worker)).toBe(false)
    return { pm, pmProfile, worker, pmTools, workerHandle, aboutPiece: { piece, label } }
  }

  const cardOn = permissionCardOn(ledger)

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
    worker,
    pmTools,
    workerHandle,
    ordinary = false,
  }: {
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
    ordinary?: boolean
  }): Promise<void> => {
    if (ordinary) workerHandle.holdNextTurn()
    const first = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'first',
      kind: 'note',
    })
    expect(first.outcome).toBe('ok')
    await waitFor(
      () => workerHandle.status() === (ordinary ? 'working' : 'waiting_permission'),
      'the child’s first turn',
    )
    const held = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'second',
      kind: 'note',
    })
    expect(held.delivery, JSON.stringify(held)).toBe('queued')
  }

  const nativeQuestion = nativeQuestionOn(ledger)

  /** A provider's own question is the person's: no agent's answer_question reaches it. */
  const anAgentCannotAnswer = async (on: RuntimeHost, pm: string, question: string) => {
    expect(
      await callOn(agentToolsFor(on, pm), 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['main'] }],
      }),
    ).toMatchObject({
      outcome: 'refused',
      rail: 'no-question-by-that-name',
      permanence: 'permanent',
      retryable: false,
    })
  }

  const childAsks = async (child: string): Promise<{ id: string }> => {
    const asked = await callOn(agentToolsFor(host, child), 'ask_question', {
      who_answers: 'an-agent',
      agent: store.parentOf(child),
      question: 'which branch?',
      options: ['main', 'dev'],
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return { id: asked.question as string }
  }

  describe('the flush is not under an attention gate', () => {
    it('a message held for a child NOBODY is watching goes out when its turn ends', async () => {
      // No window, a busy child, a held message — and the turn ends through the provider rather
      // than through a person, so no sink is ever attached.
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aNoteHeldBehindAnother({ worker, pmTools, workerHandle, ordinary: true })

      // Nobody has ever looked at this conversation.
      expect(claimed.has(worker)).toBe(false)
      expect(window.messages.some((one) => one.sessionId === worker)).toBe(false)

      // The parent Stops ordinary work. The provider’s idle event triggers the flush.
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
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const ghost = new RecordingSink('webContents:9')
      host.claimSession(worker, ghost)
      claimed.add(worker)
      await aNoteHeldBehindAnother({ worker, pmTools, workerHandle })
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
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      claimed.add(worker)
      await aNoteHeldBehindAnother({ worker, pmTools, workerHandle })
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
    it('a launch strands the native question, and the agent cannot answer it', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await nativeQuestion(worker, workerHandle)
      // ⚑ **The premise**: nothing has ended it, so the ledger reads `open` — which is exactly what
      // a live wait reads, and is why no fold can be the repair.
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open'])

      // ⛔ **A SECOND store object is what makes this a crash**: `live-hosts.ts` compares ledgers by
      // object identity, so this host believes nothing is running — which is what a fresh process
      // believes, and the reason the sweep is safe there.
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['stranded'])

      await anAgentCannotAnswer(next, pm, asked.id)
      // ⛔ **Nothing was sent.** The repair records a fact; it does not answer on anybody's behalf.
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(false)
    })

    it('a second host leaves a running native question open without exposing an agent answer route', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await nativeQuestion(worker, workerHandle)

      // ⚠️ **Constructed and NOT resumed into.** `reserve` refuses a session another live host is
      // running — which is `265`'s rail doing its job — and the sweep is a constructor act, so the
      // construction is the whole of what this test needs.
      const beside = buildHost()
      // ⛔ **Still `open`** — the first host is running it, so this launch left it exactly as it was.
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open'])
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)

      await anAgentCannotAnswer(beside, pm, asked.id)
    })

    it('a second launch writes nothing more — the sweep is idempotent', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await nativeQuestion(worker, workerHandle)
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
      const first = await nativeQuestion(worker, workerHandle, 'which branch?', ['main', 'dev'])
      const second = await nativeQuestion(worker, workerHandle, 'which region?', ['eu', 'us'])
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open', 'open'])

      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(store.routedRequestsOf(worker).map((one) => one.requestId)).toEqual([
        first.id,
        second.id,
      ])
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual([
        'stranded',
        'stranded',
      ])
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
      const { worker, workerHandle } = await aPmAndItsWorker()
      await nativeQuestion(worker, workerHandle)

      buildHost(createSessionStore(db, tick))
      expect(ledger(alone).some((event) => event.type === 'request_stranded')).toBe(false)
      expect(ledger(worker).filter((event) => event.type === 'request_stranded').length).toBe(1)
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['stranded'])
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
      asked: { id: string }
    }> => {
      const { pm, worker } = await aPmAndItsWorker()
      await host.close(pm, window)
      claimed.delete(pm)
      expect(host.sessionIds).not.toContain(pm)
      const asked = await childAsks(worker)
      // ⚑ **The premise, asserted**: the question travelled, and the parent that had stopped was
      // started for it and TOLD it.
      expect(store.routedRequestsOf(worker)[0]).toMatchObject({
        parent: pm,
        went: { is: 'the-agent-the-asker-named', to: 'an-agent' },
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
      expect(String(rows[0]?.words)).toContain('which branch?')
      expect(String(rows[0]?.words)).toContain('Part id "answer": choose one:')
      expect(String(rows[0]?.words)).toContain('main')

      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'answer', answer: ['dev'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(store.theDecisionOn(worker, asked.id)?.outcome).toBe('answered')
    })

    it('the live question and listing retain the same content and answering address', async () => {
      // Compare what both doors actually returned; their surrounding conversation envelopes differ.
      const live = await aPmAndItsWorker()
      const liveAsked = await childAsks(live.worker)
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
      const listed = rows.find((one) => one.question === liveAsked.id)
      expect(listed).toMatchObject({
        asked_by: live.worker,
        state: 'open',
        answerable_by_you: true,
      })
      for (const words of [delivered.text, String(listed?.words)]) {
        const lines = words.split('\n')
        expect(lines).toContain('which branch?')
        expect(lines.filter((line) => line.startsWith('Part id '))).toEqual([
          'Part id "answer": choose one:',
        ])
        expect(lines.filter((line) => /^\s+- /.test(line))).toEqual(['    - main', '    - dev'])
      }
      const address = host.addressOf(live.worker)
      expect(delivered.text).toContain(`asks you ${liveAsked.id} in your conversation`)
      expect(delivered.text).toContain(`Use asked_by ${address} with this question id.`)
      expect(listed?.words).toContain(`quoting ${liveAsked.id} with asked_by ${address}.`)
    })

    it('lists a secret request for the task giver without its words and refuses an answer', async () => {
      const { pm, worker, workerHandle, aboutPiece } = await aPmAndItsWorker(true)
      await host.send(worker, 'continue this piece', asPm(pm), [], { aboutPiece })
      await cardOn(worker)
      const secret = await nativeQuestion(worker, workerHandle, 'the token?', [], { secret: true })
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions as Record<
        string,
        unknown
      >[]
      const row = rows.find((one) => one.question === secret.id)
      expect(row).toMatchObject({
        state: 'open',
        answerable_by_you: false,
        because: 'a-secret-only-a-person-can-type',
        words: null,
      })
      // The ledger has the words, so the null in the listing exercises the person-only route.
      expect(store.questionsRaisedIn(worker).get(secret.id)?.prompt).toBe('the token?')
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: secret.id,
          answers: [{ part: 'answer', answer: ['hunter2'] }],
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'a-person-answers-this-one' })
    })

    it.each([true, false])(
      'keeps the permission card with the person and lists it for the giver only on a named task (%s)',
      async (namedTask) => {
        const { pm, worker, aboutPiece } = await aPmAndItsWorker(namedTask)
        await host.send(worker, 'continue', asPm(pm), [], namedTask ? { aboutPiece } : {})
        const card = await cardOn(worker)
        await waitFor(
          () => host.decisionsForAPerson().rows.some((row) => row.request.requestId === card),
          'the permission card to reach the person',
        )
        const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions
        expect(rows).toEqual(
          namedTask
            ? [
                expect.objectContaining({
                  question: card,
                  because: 'a-permission-decision',
                  words: null,
                }),
              ]
            : [],
        )
        expect(store.questionsRaisedIn(worker).size).toBe(0)
      },
    )

    it('⛔ a caller sees only its OWN family — the entitlement is the lookup, and it takes no argument', async () => {
      // ⚑ **Structural rather than checked** (`394`'s rule): `me` is minted by the toolset from the
      // session it was built for, and `list_questions` advertises no argument that names a
      // conversation — so there is no id a caller could spell to reach somebody else's family.
      const mine = await aPmAndItsWorker()
      const theirs = await aPmAndItsWorker()
      const asked = await childAsks(theirs.worker)
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
      await nativeQuestion(worker, workerHandle)
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const atTheStranding = store.routedRequestsOf(worker)
      expect(atTheStranding.map((one) => one.state)).toEqual(['stranded'])

      // Derived again from the ledger alone, by a third host.
      const third = buildHost(createSessionStore(db, tick))
      await third.resumeSession(pm, window)
      expect(store.routedRequestsOf(worker)).toEqual(atTheStranding)
      // …and the fold agrees when it is handed the raw ledger, which is the replayed path.
      expect(deriveRoutedRequests(worker, store.events(worker)).map((one) => one.state)).toEqual([
        'stranded',
      ])
    })

    it('a message flushed to an unwatched child is in the ledger the next launch reads', async () => {
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await aNoteHeldBehindAnother({ worker, pmTools, workerHandle, ordinary: true })
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () =>
          mailboxOf(store.events(worker)).some(
            (one) => one.text === 'second' && one.ending === 'sent',
          ),
        'the held message to go out',
      )
      await host.closeAll()

      // The constructor's sweep finds nothing to repair: the message already ended as `sent`,
      // not the `abandoned` a crash writes.
      buildHost(createSessionStore(db, tick))
      expect(mailboxOf(store.events(worker)).map(({ text, ending }) => ({ text, ending }))).toEqual(
        [
          { text: 'the work this dispatch is about', ending: 'sent' },
          { text: 'second', ending: 'sent' },
        ],
      )
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
      asked: { id: string }
    }> => {
      const { pm, worker } = await aPmAndItsWorker()
      await host.setApprovalMode(worker, 'auto', THE_APP_ITSELF)
      await host.close(pm, window)
      claimed.delete(pm)
      const asked = await childAsks(worker)
      await host.resumeSession(pm, window)
      claimed.add(pm)
      const tools = agentToolsFor(host, pm)
      const rows = (await callOn(tools, 'list_questions')).questions as Record<string, unknown>[]
      expect(rows[0]?.question).toBe(asked.id)
      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'answer', answer: ['main'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      await waitFor(
        () =>
          quiet(worker) &&
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('answer: main'),
          ),
        'the answer turn to reach the worker and finish',
      )
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
