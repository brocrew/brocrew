import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isProxy } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  RequestBroker,
  publishedOffer,
  type AgentToolset,
  type FakeSessionHandle,
  type PermissionDecision,
  type RuntimeEvent,
  type StartOptions,
  type UserInputQuestion,
  type UserInputResponse,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { answerFor, attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  noPositiveSays,
  permissionDecisionFor,
  permissionOffer,
} from '../src/renderer/src/lib/permission-offer'
import { createPersonsQueue, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import {
  whatThisAnswerDoes,
  type AttentionDecision,
} from '../src/renderer/src/lib/user-input-offer'
import {
  NOTHING_NAMED_THE_WORK,
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type LedgerWalkKind,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
  aPersonsSince,
} from '../src/shared/questions'
import type { ChannelRefusal } from '@brobot2/runtime'
import {
  DEFAULT_PROFILE_ID,
  type CreatedSession,
  type RuntimeCommand,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 476's instrument: what every compact answer promises, what crosses, and what actually lands.
 *
 * The important join is deliberately in this order:
 *
 * `RuntimeEvent -> attentionQueue -> createPersonsQueue (Vue deep ref) -> answerFor ->
 * structuredClone -> executeRuntimeCommand -> SQLite ledger + FakeRuntime broker/tool effect`.
 *
 * This is not an Electron process boundary: native `structuredClone` is applied to the command at
 * the exact point Electron would clone it, but the main-side runtime is the repo's FakeRuntime. The
 * existing live smoke owns the process boundary, and the adapter suites own real Claude/Codex
 * translations; this fixture makes the renderer/clone/host join deterministic.
 * ⛔ **That sentence used to end here**: *"`every-answer-and-what-it-actually-did.test.ts` owns
 * the four permission attempts: on this pre-473 base each reaches the real clone and fails there,
 * so none can honestly enter this host fixture yet."* ⚑ **`473` landed and the bar it names was
 * met**, and nothing came back to move the permissions in — so the one join that carries a
 * permission answer from a surface to a `user_decision` row went unmeasured for eleven
 * dispatches. 🔴 **487 §4 is that measurement**, on the one card that could not be answered at
 * all until this dispatch.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true

  constructor(readonly ownerId: string) {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(): void {}
}

/** Keeps the fake handles and app tools so the assertion can observe the other side of the host. */
class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    sessions: FakeProviderSessions,
    private readonly handles: FakeSessionHandle[],
    private readonly toolsets: AgentToolset[],
  ) {
    super(provider, { sessions })
  }

  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    if (options.agentTools !== undefined) this.toolsets.push(options.agentTools)
    return handle
  }
}

function walked<Row>(
  rows: readonly Row[],
  walk: LedgerWalkKind = 'every-conversation-that-routed',
): LedgerWalk<Row> {
  return { rows, walk, ledgers: Math.max(1, rows.length), rowsUnread: 0 }
}

function routingFor(request: AttentionRequest, because: ChannelRefusal | null): RoutedRequest {
  return {
    requestId: request.requestId,
    askedBy: request.sessionId,
    parent: 'sess_parent',
    // ⚑ **611 · the arm, and the fixture picks it from the refusal it was handed** — see
    // `WhereARequestWent`.
    went:
      because === null
        ? { is: 'the-parent', to: 'the-parent' }
        : { is: 'the-person-the-channel-left-it-with', to: 'a-person', because },
    at: 10,
    state: 'open',
    endedAt: null,
    escalatedAt: because === null ? 20 : null,
  }
}

function questionFor(request: AttentionRequest): PersonsQuestion {
  const routed = routingFor(request, null)
  return {
    request: routed,
    // ⚑ **611 · when it became a person's** — every row here is escalated, which is what
    // `routingFor(…, null)` stamps.
    aPersonsSince: aPersonsSince(routed),
    // ⚑ **602 · every row here is a LIVE attention row turned into a queue row**, which only a
    // provider-raised request can be — see `HowItWasRaised`.
    raisedBy: 'the-provider',
    // ⚑ **619 · a provider-raised question is answered on its card** — `whatTheAskerOffered`
    // returns `null` for every row this suite builds.
    offered: null,
    asked: null,
    chain: {
      links: [{ waiting: request.sessionId, requestId: request.requestId, on: 'sess_parent' }],
      endsWithAPerson: true,
    },
    reading: {
      hops: [{ waiting: request.sessionId, on: null }],
      unfollowable: false,
    },
    sentence: `${request.sessionId} waiting on you`,
    work: [],
    // ⚑ **474 · these rows name no work, so the honest answer is the one `aboutTheWork` returns
    // for a `question_asked` that carried no `taskId`.** ⛔ Written rather than omitted: the field
    // is required, and a fixture that filled it with an arm the ledger did not say would make
    // every answer below assert against work nobody assigned.
    about: NOTHING_NAMED_THE_WORK,
  }
}

function onlyPersonFor(request: AttentionRequest, because: ChannelRefusal): PersonsDecision {
  const routed = routingFor(request, because)
  if (routed.went.is !== 'the-person-the-channel-left-it-with') {
    throw new Error('the only-person fixture lost its refusal')
  }
  const reading = decisionReading(request.sessionId, (sessionId) => sessionId)
  return {
    request: { ...routed, went: routed.went },
    reading,
    sentence: readingSentence(reading),
    says: 'something only a person can settle',
    work: [],
  }
}

describe('476 · every compact answer that reaches the host, plus the blocked permission split', () => {
  let dir: string
  let cwd: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  let handles: FakeSessionHandle[]
  let toolsets: AgentToolset[]
  let counter: number
  let clock: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-every-answer-'))
    cwd = mkdtempSync(join(tmpdir(), 'brobot2-every-answer-cwd-'))
    db = openDatabase(join(dir, 'ledger.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, () => clock++)
    handles = []
    toolsets = []
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new WatchingRuntime(provider, sessions, handles, toolsets),
      // Test-owned, isolated paths. Nothing here names or reads a real provider home.
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'isolated-runtime-homes', profileId ?? DEFAULT_PROFILE_ID, provider),
      providerHomePath: (provider, profileId) =>
        join(dir, 'isolated-runtime-homes', profileId ?? DEFAULT_PROFILE_ID, provider),
      resolveCwd: (_sessionId, requested) => requested ?? cwd,
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink('webContents:476')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  const execute = (command: RuntimeCommand): Promise<unknown> =>
    executeRuntimeCommand(host, sink, structuredClone(command))

  const open = async (
    provider: Provider = 'codex',
  ): Promise<{ session: CreatedSession; handle: FakeSessionHandle; tools: AgentToolset }> => {
    const session = (await execute({
      kind: 'createSession',
      provider,
      profileId: DEFAULT_PROFILE_ID,
      approvalMode: 'ask',
      cwd,
    })) as CreatedSession
    const handle = handles.at(-1)
    const tools = toolsets.at(-1)
    if (handle === undefined || tools === undefined) throw new Error('the fake launch was not seen')
    return { session, handle, tools }
  }

  const recordFrom = (session: CreatedSession): SessionRecord => {
    const record = createSessionRecord(session.sessionId)
    record.meta = session
    record.phase = 'open'
    for (const message of sink.messages) {
      if (message.sessionId === session.sessionId)
        applyEvent(record.control, message.event, message.at)
    }
    return record
  }

  const attentionFor = (session: CreatedSession, requestId: string): AttentionRequest => {
    const request = attentionQueue([recordFrom(session)], () => 'waiting')[0]
    if (request === undefined || request.requestId !== requestId) {
      throw new Error(`the renderer did not derive ${requestId}`)
    }
    return request
  }

  /**
   * `createPersonsQueue` stores `world` in Vue's deep `ref`. Reading the answer back from its view
   * is therefore the exact proxy shape that reaches RuntimeScreen's settle handler.
   */
  const proxiedDecision = (
    request: AttentionRequest,
    choose: (decision: AttentionDecision) => boolean,
  ): AttentionDecision => {
    const queue = createPersonsQueue()
    const isTravelledQuestion =
      request.kind === 'question' &&
      request.limit === null &&
      request.decisions.some((decision) => decision.kind === 'answer')
    const questions = isTravelledQuestion
      ? walked([questionFor(request)])
      : walked<PersonsQuestion>([])
    const decisions =
      request.kind === 'permission'
        ? walked([onlyPersonFor(request, 'a-permission-decision')])
        : request.kind === 'question' && !isTravelledQuestion
          ? walked([onlyPersonFor(request, 'a-consent-with-nothing-to-answer')])
          : walked<PersonsDecision>([])
    const world: PersonsQueueWorld = {
      held: new Set([request.sessionId]),
      answerable: new Map([[request.key, request]]),
      answeredFromHere: new Set(),
      now: clock,
      lastLookAnswered: { questions: true, decisions: true },
    }
    queue.supply(questions, decisions, world, {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
    })
    const row = queue.view.value?.rows.find((one) => one.key === request.key)
    expect(row?.kind).toBe(isTravelledQuestion ? 'a-question' : 'a-decision')
    const decision = row?.answers.find(choose)
    if (decision === undefined) throw new Error(`no requested answer on ${request.key}`)
    expect(isProxy(decision), 'the decision did not pass through Vue deep reactivity').toBe(true)
    return decision
  }

  const eventsOf = <K extends TranscriptEvent['type']>(
    sessionId: string,
    type: K,
  ): Extract<TranscriptEvent, { type: K }>[] =>
    store
      .events(sessionId)
      .map((entry) => entry.event)
      .filter((event): event is Extract<TranscriptEvent, { type: K }> => event.type === type)

  const assertDecisionRow = (
    sessionId: string,
    requestId: string,
    outcome: Extract<TranscriptEvent, { type: 'user_decision' }>['outcome'],
  ): void => {
    expect(eventsOf(sessionId, 'user_decision')).toEqual([
      // 🔴 **477 · every answer that reaches the host through this boundary is a PERSON's, and the
      // row now says so.** ⛔ `toEqual` and not `toMatchObject`: this is `476`'s exact-row
      // assertion, and an actor recorded on some answers and not others would pass a partial
      // match. ⚑ `a-person` is derived from the window sink `executeRuntimeCommand` was given —
      // there is no field on `RuntimeCommand` through which the renderer could have stated it.
      { type: 'user_decision', requestId, outcome, by: { who: 'a-person' } },
    ])
  }

  const answerThroughBoundary = async (
    request: AttentionRequest,
    decision: AttentionDecision,
  ): Promise<void> => {
    const answer = answerFor(decision)
    let command: RuntimeCommand
    if ('permission' in answer) {
      command = {
        kind: 'respondPermission',
        sessionId: request.sessionId,
        requestId: request.requestId,
        decision: answer.permission,
      }
    } else {
      command = {
        kind: 'respondUserInput',
        sessionId: request.sessionId,
        requestId: request.requestId,
        response: answer.userInput,
      }
    }

    // 🔴 The measurement point. No JSON laundering and no `toRaw`: Electron uses structured clone.
    const carried = structuredClone(command)
    expect(isProxy(carried)).toBe(false)
    await executeRuntimeCommand(host, sink, carried)
  }

  const waitUntilPublished = async (
    sessionId: string,
    type: TranscriptEvent['type'],
  ): Promise<void> =>
    waitFor(
      () => store.events(sessionId).some((entry) => entry.event.type === type),
      `${type} in ${sessionId}`,
    )

  describe('question answers', () => {
    it.each([
      {
        label: 'Current',
        copy: 'the agent is given “Current” as the answer',
        response: { kind: 'answer', answers: { q0: 'Current' } } as const,
        outcome: 'answered' as const,
      },
      {
        label: 'Previous',
        copy: 'the agent is given “Previous” as the answer',
        response: { kind: 'answer', answers: { q0: 'Previous' } } as const,
        outcome: 'answered' as const,
      },
      {
        label: 'Reject',
        copy: 'the request is declined and the agent is told nothing was answered',
        response: { kind: 'reject' } as const,
        outcome: 'rejected' as const,
      },
    ])(
      '$label: copy, exact row, ledger, and FakeRuntime response are observed',
      async ({ label, copy, response, outcome }) => {
        const { session, handle } = await open()
        const raised = handle.simulateUserInput('Which history?', ['Current', 'Previous'])
        await waitUntilPublished(session.sessionId, 'user_input_request')
        const request = attentionFor(session, raised.id)
        const decision = proxiedDecision(request, (candidate) => candidate.label === label)

        expect(whatThisAnswerDoes(decision)).toBe(copy)
        expect(answerFor(decision)).toEqual({ userInput: response })
        await answerThroughBoundary(request, decision)

        // `executeRuntimeCommand` returned only after this SQLite row was appended.
        assertDecisionRow(session.sessionId, request.requestId, outcome)
        // The promise is FakeRuntime's broker. Real adapter translations are asserted separately.
        await expect(raised.answered).resolves.toEqual(response)
      },
    )
  })

  /**
   * FakeRuntime's public injector always creates one question. This reaches the same private broker
   * and event queue its injector uses, changing only the question list to the real consent shape.
   */
  const simulateConsent = (
    handle: FakeSessionHandle,
    id: string,
  ): { id: string; answered: Promise<UserInputResponse> } => {
    const seam = handle as unknown as {
      push(event: RuntimeEvent): void
      askedQuestions: Map<string, readonly UserInputQuestion[]>
      userInputs: RequestBroker<UserInputResponse>
    }
    const questions: UserInputQuestion[] = []
    seam.push({ type: 'user_input_request', id, prompt: 'Approve this?', questions })
    seam.askedQuestions.set(id, questions)
    return { id, answered: seam.userInputs.register(id) }
  }

  describe('a request with no questions', () => {
    it.each([
      {
        label: 'Approve',
        // ⚑ **478 · this fixture raises a consent with NEITHER discriminator** — no `permission`,
        // no `consent` — which is exactly the population `477` rules on: a row written before the
        // field existed. ⛔ So the sentence is the GAP one, and that gap is reachable through the
        // real fold rather than only through a hand-built decision.
        copy:
          'the request is approved with no answer, and this window cannot say what ' +
          'else that does',
        response: { kind: 'answer', answers: {} } as const,
        outcome: 'answered' as const,
      },
      {
        label: 'Reject',
        copy: 'the request is declined and the agent is told nothing was answered',
        response: { kind: 'reject' } as const,
        outcome: 'rejected' as const,
      },
    ])(
      '$label: copy, person-only row, ledger, and FakeRuntime response are observed',
      async ({ label, copy, response, outcome }) => {
        const { session, handle } = await open()
        const raised = simulateConsent(handle, `consent_${session.sessionId}`)
        await waitUntilPublished(session.sessionId, 'user_input_request')
        const request = attentionFor(session, raised.id)
        const decision = proxiedDecision(request, (candidate) => candidate.label === label)

        expect(whatThisAnswerDoes(decision)).toBe(copy)
        expect(answerFor(decision)).toEqual({ userInput: response })
        await answerThroughBoundary(request, decision)

        assertDecisionRow(session.sessionId, request.requestId, outcome)
        await expect(raised.answered).resolves.toEqual(response)
      },
    )
  })

  // 🔴 743 · re-aimed — `739` F-1, ruled by the PM: *"a surface that offers the choices offers ALL of
  // them … Neither is card-only while the other is not."* It pinned the grant card-only.
  it('🔴 the wholesale allow_all choice is on the person’s row too — after the row, under its warning', async () => {
    const { session } = await open('claude')
    await execute({ kind: 'send', sessionId: session.sessionId, text: 'run an opaque command' })
    await waitUntilPublished(session.sessionId, 'permission_request')
    const published = eventsOf(session.sessionId, 'permission_request')[0]
    if (published === undefined) throw new Error('the provider did not publish its card')
    expect(published.scope.availableDecisions).toContain('allow_all_for_session')

    const request = attentionFor(session, published.id)
    const words = ['Allow', 'Deny', 'Cancel', 'Allow every Bash call for this conversation']
    expect(request.decisions.map((decision) => decision.label)).toEqual(words)
    expect(request.decisions.at(-1)).toEqual(
      expect.objectContaining({
        decision: { outcome: 'allow_all_for_session' },
        warns: expect.stringContaining('Covers any Bash command for this conversation'),
      }),
    )

    const throughQueue = createPersonsQueue()
    const world: PersonsQueueWorld = {
      held: new Set([request.sessionId]),
      answerable: new Map([[request.key, request]]),
      answeredFromHere: new Set(),
      now: clock,
      lastLookAnswered: { questions: true, decisions: true },
    }
    throughQueue.supply(
      walked([]),
      walked([onlyPersonFor(request, 'a-permission-decision')]),
      world,
      {
        travel: () => {},
        settle: () => {},
        takeOver: () => {},
        open: () => {},
      },
    )
    const row = throughQueue.view.value?.rows[0]
    expect(row?.answers.map((decision) => decision.label)).toEqual(words)
    expect(row?.answers.at(-1)).toEqual(request.decisions.at(-1))
  })

  /**
   * 🔴 **487 §1.3 · a refusal that appears and cannot settle is `469` again** (`483`'s repair 1).
   *
   * ## ⛔ The card these presses are made on
   *
   * ⚠️ **The one `483` traced as reachable**: a Codex command approval whose requested permission
   * profile this app cannot display, so `commandScope` withholds every positive. Until 487 it
   * published `availableDecisions: []` and **no surface could answer it at all** — the offer is
   * what every surface builds its controls from, and there was nothing in it.
   *
   * ⚑ **Raised through the double's own {@link FakeSessionHandle.simulatePermission}**, whose
   * offer goes through the same `publishedOffer` every real producer uses; the exact shape the
   * Codex adapter emits for this branch is pinned in `codex-runtime.test.ts`'s producer census.
   *
   * ## 🔴 Three surfaces, because a press is not a payload
   *
   * `the-press-that-cloned-nothing.test.ts` states the bound this closes: *"A surface that
   * reaches `respondPermission` without going through `answerFor` is covered by neither, and
   * needs its own press."* ⛔ Home and the person's queue go through `answerFor`; the card does
   * not, and each is driven here from the offer that surface actually builds.
   *
   * ⚠️ **What each arm is, precisely** — so no arm is mistaken for more than it proves:
   *
   *  - **Home** — `attentionQueue` builds the row, `answerFor` builds the payload. `RuntimeScreen`
   *    `decideFromOverview` does exactly this pair and nothing else.
   *  - **the person's queue** — the same payload, off a decision read back out of the real
   *    `createPersonsQueue`, so it is a Vue `Proxy` when it reaches the clone (`473`).
   *  - **the card** — `permissionOffer(...).row` is the card's own `offered` computed, and
   *    `permissionDecisionFor` is its own `decide()`. ⛔ **The component is not mounted here** —
   *    no harness in this repo runs a mounted component against a real ledger — so the two lines
   *    that make this the card's press are asserted against its source below, and the painted
   *    half lives in `test/dom/what-a-card-says-a-press-does.dom.test.ts`.
   */
  describe('487 · the withheld-positive card, refused from each surface, into the ledger', () => {
    const WITHHELD = 'req_withheld'

    /** The fail-closed card on a real session, with the provider still holding the call. */
    const raiseIt = async (): Promise<{
      session: CreatedSession
      request: AttentionRequest
      answered: Promise<PermissionDecision>
    }> => {
      const { session, handle } = await open('codex')
      const answered = handle.simulatePermission(WITHHELD, {
        action: 'setup',
        detail: 'setup && curl http://x',
        // ⚑ **No positive at all** — `publishedOffer` adds the floor, and that is the whole of
        // what 487 changed about this card.
        availableDecisions: [],
        noPositiveBecause: 'could-not-describe-the-grant',
      })
      await waitUntilPublished(session.sessionId, 'permission_request')
      const published = eventsOf(session.sessionId, 'permission_request')[0]
      if (published === undefined) throw new Error('the double did not publish its card')
      expect(published.scope.availableDecisions).toEqual(publishedOffer([]))
      return { session, request: attentionFor(session, WITHHELD), answered }
    }

    it.each([{ outcome: 'deny' as const }, { outcome: 'cancel' as const }])(
      '🔴 Home: $outcome is drawn on the withheld card, and lands in the ledger',
      async ({ outcome }) => {
        const { session, request, answered } = await raiseIt()
        // ⛔ **The refusals are the whole row, and the sentence says why.**
        expect(request.decisions.map((one) => one.label)).toEqual(['Deny', 'Cancel'])
        expect(request.noPositive).toBe(noPositiveSays('could-not-describe-the-grant'))

        const decision = request.decisions.find(
          (one) => one.kind === 'permission' && one.decision.outcome === outcome,
        )
        if (decision === undefined) throw new Error(`Home drew no ${outcome}`)
        await answerThroughBoundary(request, decision)

        assertDecisionRow(session.sessionId, WITHHELD, outcome)
        // 🔴 **And the provider was actually answered** — a ledger row over a call the far side
        // is still holding is `469`'s defect wearing a green test.
        expect(await answered).toEqual({ outcome })
      },
    )

    it.each([{ outcome: 'deny' as const }, { outcome: 'cancel' as const }])(
      '🔴 the person’s queue: $outcome survives the deep ref, the clone and the host',
      async ({ outcome }) => {
        const { session, request, answered } = await raiseIt()
        const decision = proxiedDecision(
          request,
          (one) => one.kind === 'permission' && one.decision.outcome === outcome,
        )
        // ⛔ **The row says it too**, because this is the surface a spawned child's card is
        // reached from and HO-030 §2 forbids a sentence that is true on one surface only.
        await answerThroughBoundary(request, decision)

        assertDecisionRow(session.sessionId, WITHHELD, outcome)
        expect(await answered).toEqual({ outcome })
      },
    )

    it.each([{ outcome: 'deny' as const }, { outcome: 'cancel' as const }])(
      '🔴 the card: $outcome, built the way `PermissionCard` builds it, lands in the ledger',
      async ({ outcome }) => {
        const { session, request, answered } = await raiseIt()
        const published = eventsOf(session.sessionId, 'permission_request')[0]
        if (published === undefined) throw new Error('no card')
        // ⚑ The card's own two lines: its `offered` computed, and its `decide()`.
        const row = permissionOffer(published.scope.availableDecisions, published.action).row
        expect(row).toEqual(['deny', 'cancel'])
        const carried = structuredClone({
          kind: 'respondPermission' as const,
          sessionId: request.sessionId,
          requestId: request.requestId,
          decision: permissionDecisionFor(outcome),
        })
        expect(isProxy(carried)).toBe(false)
        await executeRuntimeCommand(host, sink, carried)

        assertDecisionRow(session.sessionId, WITHHELD, outcome)
        expect(await answered).toEqual({ outcome })
      },
    )

    it('⛔ …and the positives are still refused, with NOTHING written (487)', async () => {
      const { session, request } = await raiseIt()
      // 🔴 **The control that makes the six presses above mean something** (standing rule 3): the
      // same card, one fact over, and the gate is exactly as strict as it was. ⛔ If the floor had
      // been applied to `allowed` rather than to the offer, this would settle.
      for (const outcome of ['allow', 'allow_for_session', 'allow_all_for_session'] as const) {
        await expect(
          executeRuntimeCommand(host, sink, {
            kind: 'respondPermission',
            sessionId: request.sessionId,
            requestId: request.requestId,
            decision: { outcome },
          }),
        ).resolves.toEqual({
          outcome: 'refused',
          // ⛔ **The reason, not just the refusal** — `not-pending` would also answer `refused`
          // and would mean the card had already been settled by an earlier line of this test.
          reason: 'that is not one of the responses this request offers',
          stillOpen: false,
        })
      }
      expect(eventsOf(session.sessionId, 'user_decision')).toEqual([])
      // ⚑ **And the card is still live**, which is what `stillOpen: false` above does NOT say:
      // that field is about the REQUEST the answer was sent to, and a refused positive must leave
      // a person able to refuse it afterwards.
      await executeRuntimeCommand(host, sink, {
        kind: 'respondPermission',
        sessionId: request.sessionId,
        requestId: request.requestId,
        decision: { outcome: 'deny' },
      })
      assertDecisionRow(session.sessionId, WITHHELD, 'deny')
    })

    it('⚑ the card really does build its press this way, in its own source (487)', () => {
      // ⛔ **The join the arm above cannot make on its own.** `the-bridge-that-clones-nothing`'s
      // §9 asserts the producer; this asserts the pair — the offer it renders and the payload it
      // sends — so an arm that stopped standing in for the card would be visible here.
      const card = readFileSync(
        join(here, '../src/renderer/src/components/PermissionCard.vue'),
        'utf8',
      )
      expect(card).toContain('permissionOffer(scope.value.availableDecisions')
      expect(card).toContain('permissionDecisionFor(outcome)')
      expect(card).toContain('v-for="outcome in offered"')
    })
  })
})
