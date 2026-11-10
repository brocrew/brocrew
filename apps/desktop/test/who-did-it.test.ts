import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { RuntimeHost, THE_APP_ITSELF, whoDidIt } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { WHO_STOPPED_IT } from '../src/shared/how-work-stopped'
import {
  THE_APP_DID_IT,
  WHO_DID_IT,
  WHO_DID_IT_SAYS,
  didIt,
  isWhoDidIt,
  whoDidItSays,
  type ActedBy,
} from '../src/shared/who-did-it'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { RecordingSink, neutralHostDeps } from './lib/host-fixture'

/**
 * Who did it: the actor is recorded by whoever performs the act, at the moment it happens, and a
 * row written before the app recorded an actor stays without one; the digest keeps saying so.
 *
 * The instruments are production doors. The one exception is the old row, which is planted
 * because today's code cannot produce it. The provider is a double and every directory is
 * temporary.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000
const FROM = 1_800_000_000_000
const TO = FROM + 12 * HOUR
const INSIDE = FROM + 6 * HOUR
/** The window after it: the digest is one window over every conversation. */
const NEXT_TO = TO + 12 * HOUR
const INSIDE_NEXT = TO + 6 * HOUR

/** Keep the provider handles, so a card can be raised through the real path. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

describe('477 · who did it', () => {
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
  /** ⚑ A second launch over the same store — the one moment at which nothing is running. */
  let buildHost: () => RuntimeHost

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-477-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-477-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = INSIDE
    counter = 0
    handles = []
    ordinals = new Map()
    const sessions = new FakeProviderSessions()
    store = createSessionStore(db, tick)
    buildHost = () =>
      new RuntimeHost({
        store,
        ...neutralHostDeps(() => userData),
        createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, sessions),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_477_${String(++counter)}`,
        now: tick,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    host = buildHost()
    window = new RecordingSink('webContents:477')
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

  const conversation = (id: string): void => {
    store.create({
      id,
      provider: 'codex',
      cwd: root,
      approvalMode: 'ask',
      profileId: id,
    })
  }

  const callOn = async (
    tools: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    // ⛔ **Bounded, and it reports rather than hangs** (standing rule 13).
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const digestOf = (from: number, to: number): ReturnType<typeof distil> =>
    distil(store.digestWindow(from, to), (id) => id.replace('sess_', ''))

  const said = (kind: string, from = FROM, to = TO): string => {
    const line = digestOf(from, to).lines.find((one) => one.kind === kind)
    if (line === undefined) throw new Error(`no ${kind} line in [${from}, ${to})`)
    return line.text
  }

  const rowsOf = (sessionId: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    store
      .events(sessionId)
      .map(({ event }) => event)
      .filter((event) => event.type === type)

  /** A person answers a provider card, through the door a window uses. */
  const aPersonAnswers = async (label: string): Promise<string> => {
    const opened = await host.createSession(
      {
        provider: 'claude',
        profileId: `person-${label}`,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('the conversation received no provider handle')
    const asked = handle.simulateUserInput('Which database?', ['Postgres', 'SQLite'])
    const taken = await host.respondUserInput(
      opened.sessionId,
      asked.id,
      { kind: 'answer', answers: { q0: ['Postgres'] } },
      window,
    )
    expect(taken, JSON.stringify(taken)).toEqual({ outcome: 'taken' })
    await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    return opened.sessionId
  }

  /** A parent agent answers the routed question of a worker it gave work to — `463`'s own path. */
  const anAgentAnswers = async (label: string): Promise<{ worker: string; parent: string }> => {
    const seeded = await host.createSession(
      {
        provider: 'claude',
        profileId: `worker-${label}`,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    await host.close(seeded.sessionId, window)
    const parent = await host.createSession(
      {
        provider: 'claude',
        profileId: `parent-${label}`,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const given = await callOn(agentToolsFor(host, parent.sessionId), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: `worker-${label}`,
      title: 'raise the question',
      brief: 'raise the question whose answerer is under test',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = handles.at(-1)
    if (workerHandle === undefined) throw new Error('the worker received no provider handle')
    const asked = workerHandle.simulateUserInput('Which database?', ['Postgres', 'SQLite'])
    await waitFor(
      () =>
        store
          .events(worker)
          .some(({ event }) => event.type === 'request_routed' && event.requestId === asked.id),
      'the worker question to route to its parent',
    )
    const answered = await host.answerQuestion(
      { questionId: asked.id, answers: [{ part: 'q0', answer: ['Postgres'] }] },
      { ownerId: `agent:${parent.sessionId}` },
    )
    expect(answered.ok, JSON.stringify(answered)).toBe(true)
    await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    return { worker, parent: parent.sessionId }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · both arms, in one window — HO-029 §2.2
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 an OLD row says nobody is recorded and a NEW one names the actor — in the same digest', async () => {
    // ⛔ **The old population, planted.** ⚠️ It is the ONE thing in this file that may not come from
    // a door: a row written before this app recorded an actor cannot be produced by today's code,
    // and manufacturing one by deleting the field afterwards would be a fixture built out of the
    // thing under test.
    conversation('sess_old')
    at('sess_old', INSIDE, { type: 'user_decision', requestId: 'req_before_477', outcome: 'allow' })

    // ⚑ **The new population, through the production person door.**
    const answered = await aPersonAnswers('both-arms')
    expect(rowsOf(answered, 'user_decision')).toEqual([
      {
        type: 'user_decision',
        requestId: expect.any(String) as unknown as string,
        outcome: 'answered',
        by: { who: 'a-person' },
      },
    ])

    // 🔴 **Both clauses, each about its own population, in one sentence.** ⛔ Two requests, one
    // named actor, one silence — and the silence is counted off the SILENT rows. A sentence that
    // said *"Nothing in the ledger records who answered them"* about both would have lent the old
    // row's absence to the new one; one that dropped the clause would have lent the new row's
    // person to the old one. Neither is drawn.
    expect(said('request-answered')).toBe(
      '2 requests were answered. Who answered: 1 · a person. Nothing in the ledger records who answered it.',
    )

    // ⛔ **And a window holding ONLY old rows composes `465`'s sentence byte for byte.** ⚑ HO-029
    // §2.2: *"it will go on being right for them for ever."* The sentence is not retired; it is
    // scoped to the population it was written about. ⚑ D-016 · in the NEXT window, which holds
    // only this row.
    conversation('sess_only_old')
    at('sess_only_old', INSIDE_NEXT, {
      type: 'user_decision',
      requestId: 'r1',
      outcome: 'answered',
    })
    expect(said('request-answered', TO, NEXT_TO)).toBe(
      '1 request was answered. Nothing in the ledger records who answered it.',
    )
  })

  it('⚠️ nothing rewrites a row that predates this — the old one is still short a key after a replay', async () => {
    conversation('sess_old')
    at('sess_old', INSIDE, { type: 'user_decision', requestId: 'req_before_477', outcome: 'allow' })
    await aPersonAnswers('both-arms')

    // ⛔ **Read back off the store, not out of the object that was appended** — a backfill would
    // happen on the write path or on the read path, and this asks the read path.
    const old = rowsOf('sess_old', 'user_decision')[0]
    expect(Object.keys(old as unknown as Record<string, unknown>).sort()).toEqual([
      'outcome',
      'requestId',
      'type',
    ])
    expect(old).not.toHaveProperty('by')
    // ⚑ **The vocabulary's own phrasing for it, so a surface cannot invent a different one.**
    expect(didIt(undefined)).toBe('nobody this ledger records')
    for (const word of WHO_DID_IT) expect(didIt(undefined)).not.toContain(WHO_DID_IT_SAYS[word])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a model cannot claim it — to `onBehalfOfAPerson`'s standard
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ there is no argument on the one tool that settles a request, and the TYPE says so', async () => {
    const opened = await host.createSession(
      {
        provider: 'claude',
        profileId: 'claimant',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const tools = agentToolsFor(host, opened.sessionId)
    const answer = tools.tools.find((one) => one.name === 'answer_question')
    if (answer === undefined) throw new Error('the host did not hand the provider answer_question')

    // 🔴 **The advertised set, whole.** ⛔ `477` gave this tool the `satisfies` device the other
    // five settlers already had, so this list and `AnswerQuestionArguments` are one declaration —
    // an actor argument added to either is a BUILD failure and never reaches this assertion.
    //
    // ⚑ **679 · `asked_by` joined it, and it names the ASKER, never the actor.** ⛔ It selects which
    // of the questions routed to the caller is being answered — two children's session-local ids can
    // be one string (`675` F-b) — and the answerer is still derived from the caller alone.
    // ⚠️ `answered_by` stays in the refused family below; `asked_by` is its opposite end.
    // ⚑ **D-009** — `cannot_answer` says WHY there is no answer, never who gave it.
    // ⚑ `interrupt` says whether the asker's turn is stopped for it, never who answered.
    expect(Object.keys(answer.input).sort()).toEqual([
      'answers',
      'asked_by',
      'cannot_answer',
      'interrupt',
      'question',
    ])

    // ⛔ **The negative, over every tool and with its search shape named** (standing rule 4): not
    // *"there is no `by`"* but *"there is no key from the family a claim would have to arrive in"*.
    const ACTOR_SHAPED = [
      'by',
      'as',
      'actor',
      'author',
      'caller',
      'decided_by',
      'answered_by',
      'on_behalf_of',
      'person',
      'human',
      'identity',
      'speaker',
      'session_id',
      'conversation_id',
    ]
    const everyArgument = tools.tools.flatMap((one) => Object.keys(one.input))
    for (const word of ACTOR_SHAPED) expect(everyArgument).not.toContain(word)
    // ⚑ **The positive control that proves the census can see anything at all** — a key that IS
    // advertised, on the tool under test.
    expect(everyArgument).toContain('question')
  })

  it('⛔ the fold takes a Caller and the union refuses a disagreeing pair — three compile errors', () => {
    // ⛔ **The host method has no field for it.** `answerQuestion`'s first parameter is the model's
    // arguments; a caller that tried to state who answered is an excess property.
    void (() =>
      host.answerQuestion(
        // @ts-expect-error — there is no actor field on what a model sends.
        { questionId: 'q', answers: [], by: { who: 'a-person' } },
        { ownerId: 'agent:sess_477_1' },
      ))

    // ⛔ **The union refuses *the asker named it* over no work's cousin**: a person with a
    // conversation beside them.
    // @ts-expect-error — `agent` exists only on the `an-agent` arm.
    const impossible: ActedBy = { who: 'a-person', agent: 'sess_477_1' }
    void impossible
    // @ts-expect-error — and the agent arm cannot be spelled without the conversation.
    const alsoImpossible: ActedBy = { who: 'an-agent' }
    void alsoImpossible

    // ⚑ **Three refusals prove nothing without a construction that still works** (`465`'s rule).
    const real: ActedBy = { who: 'an-agent', agent: 'sess_477_1' }
    expect(didIt(real)).toBe('sess_477_1')
    expect(didIt({ who: 'a-person' })).toBe('a person')
  })

  it('🔴 whoDidIt reads the caller and nothing else — three positive tests, and the residue is named', () => {
    expect(whoDidIt(THE_APP_ITSELF)).toEqual({ who: 'the-app-itself' })
    expect(whoDidIt({ ownerId: 'agent:sess_477_1' })).toEqual({
      who: 'an-agent',
      agent: 'sess_477_1',
    })
    expect(whoDidIt({ ownerId: 'webContents:3' })).toEqual({ who: 'a-person' })
    // 🔴 **The fourth word, reached.** ⛔ `THE_APP_ITSELF`'s own docblock names the next caller
    // mint — *"tomorrow the MCP tool a PM would spawn agents through … gets its own prefix"* — and
    // this is what a row would say about it. ⚠️ Without the member, one of the three arms above
    // becomes a fall-through and inherits it, which is `413` §3's measured defect and is exactly
    // how `recordTheAsk` still spells the same question one row over.
    expect(whoDidIt({ ownerId: 'mcp:planner' })).toEqual({ who: 'a-caller-this-app-cannot-name' })
    // ⛔ **An empty suffix names no window and no conversation**, which is `aWindowIsAsking`'s and
    // `sessionSpeakingAs`' shared rule, asserted here because the fold depends on both.
    expect(whoDidIt({ ownerId: 'webContents:' })).toEqual({ who: 'a-caller-this-app-cannot-name' })
    expect(whoDidIt({ ownerId: 'agent:' })).toEqual({ who: 'a-caller-this-app-cannot-name' })
    // ⚑ **The app arm is ONE value in the tree**, so a mutation on it is visible to every writer.
    expect(whoDidIt(THE_APP_ITSELF)).toBe(THE_APP_DID_IT)
  })

  it('the Events tab names the person who answered a decision', () => {
    const decision: Extract<TranscriptEvent, { type: 'user_decision' }> = {
      type: 'user_decision',
      requestId: 'r',
      outcome: 'allow',
      by: { who: 'a-person' },
    }
    expect(describeEvent(decision)).toContain('a person')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the vocabulary, reused — and the one word that is new
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⚑ 501 · one vocabulary short of this one, and it used to be a hand-written second list', () => {
    // ⛔ **`WHO_ASKED_IT_TO_STOP` was `['a-person', 'an-agent']`, written out by hand** beside the
    // derived list below, because `recordTheAsk` spelled its own two words. ⚑ `501` retired it:
    // that writer asks `whoDidIt` and refuses the app, so what `WorkInterruptedEvent.by` can hold
    // IS {@link WHO_STOPPED_IT} — by construction, for every member this list gains later too.
    //
    // 🔴 **The complement is ONE word now and it was two.** ⛔ The second was
    // `a-caller-this-app-cannot-name`, which the retired vocabulary had no home for — so the
    // writer spelled that caller `a-person`, which is `413` §3's dangerous default in a durable
    // row. ⚠️ This assertion going back to two members is that defect returning.
    expect(
      WHO_DID_IT.filter((word) => !(WHO_STOPPED_IT as readonly string[]).includes(word)),
    ).toEqual(['the-app-itself'])
    // 🔴 **494 · DERIVED from this one, and that is what let `501` retire the other.** ⛔ A stop
    // reading has two producers — `work_interrupted.by` and {@link UserDecisionEvent.by} — and
    // both now name an actor out of this list minus the one member neither can put there.
    // ⚠️ `mayAnswerAsAHuman` refuses {@link THE_APP_ITSELF} for the one, and `recordTheAsk`
    // returns without a row for the other; both rails are exercised in
    // `the-act-this-app-knows-the-author-of.test.ts` §4.
    expect([...WHO_STOPPED_IT]).toEqual(WHO_DID_IT.filter((word) => word !== 'the-app-itself'))
    // ⚑ **Every member owns a sentence**, so a new one is a compile error rather than a blank
    // space on a surface.
    expect(Object.keys(WHO_DID_IT_SAYS).sort()).toEqual([...WHO_DID_IT].sort())
    for (const word of WHO_DID_IT) expect(WHO_DID_IT_SAYS[word].length).toBeGreaterThan(0)
    // ⛔ **A word off a ledger this build's vocabulary has moved past prints as ITSELF.** ⚠️ The
    // boundary is the ledger and not the wire: a `TranscriptEvent` is `JSON.parse`d and cast, and
    // `undefined` in a digest sentence is the confident claim criterion 18 exists to prevent.
    expect(isWhoDidIt('a-person')).toBe(true)
    expect(isWhoDidIt('a-word-from-the-future')).toBe(false)
    expect(whoDidItSays('a-word-from-the-future')).toBe('a-word-from-the-future')
    expect(whoDidItSays('a-person')).toBe('a person')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // the doors
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 the agent door records the answering CONVERSATION, not a word', async () => {
    const { worker, parent } = await anAgentAnswers('both-arms')
    expect(rowsOf(worker, 'user_decision')).toEqual([
      {
        type: 'user_decision',
        requestId: expect.any(String) as unknown as string,
        outcome: 'answered',
        // ⛔ **The SESSION id and not the `agent:` caller id** — `WorkInterruptedEvent.agent`'s own
        // rule, so a reader can join this row to that conversation's ledger.
        by: { who: 'an-agent', agent: parent },
      },
    ])
    expect(said('request-answered')).toBe('1 request was answered. Who answered: 1 · an agent.')
  })

  it('⛔ a question THIS APP holds records its answerer at BOTH its doors — the other two writers', async () => {
    // ⚑ **A worker holding work, which is what `ask_parent` needs**: the question is a tool call
    // this app holds open, not a card any provider has, so it reaches the two branches a
    // provider-raised question never does.
    const seeded = await host.createSession(
      {
        provider: 'claude',
        profileId: 'held-worker',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    await host.close(seeded.sessionId, window)
    const pm = await host.createSession(
      {
        provider: 'claude',
        profileId: 'held-pm',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    const pmTools = agentToolsFor(host, pm.sessionId)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'held-worker',
      title: 'migrate the schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = agentToolsFor(host, worker)

    // ⛔ **Started and NOT awaited** — `ask_parent` holds the worker's turn open until the answer
    // is sent, so awaiting it here is a deadlock and that is the mechanism rather than a quirk.
    const asking = callOn(workerTools, 'ask_question', {
      who_answers: 'the-parent',
      piece: given.label,
      question: 'postgres or sqlite?',
      options: ['postgres', 'sqlite'],
    })
    // ⛔ **`because === null` is the filter, and leaving it out is a real trap** — the worker's
    // first turn, the brief, parks on a PERMISSION card, `394` routes that to the parent too, and
    // the answer door refuses it BY NAME. ⚑ A helper that took the last row would
    // fail for a reason that has nothing to do with what this measures.
    const questionsOn = (parent: string): { requestId: string }[] =>
      host
        .questionsWaitingOn(parent)
        .filter((one) => one.request.went.is === 'the-parent')
        .map((one) => one.request)
    await waitFor(
      () => questionsOn(pm.sessionId).length > 0,
      "the worker's question to reach its parent",
    )
    const waiting = questionsOn(pm.sessionId).at(-1)
    if (waiting === undefined) throw new Error('no question is waiting on the parent')
    const answered = await host.answerQuestion(
      // ⚑ **`answer` and not `q0`** — an `ask_parent` question is composed by this app rather than
      // by a provider, and `questionText` names the part it offers.
      { questionId: waiting.requestId, answers: [{ part: 'answer', answer: ['postgres'] }] },
      { ownerId: `agent:${pm.sessionId}` },
    )
    expect(answered.ok, JSON.stringify(answered)).toBe(true)
    await asking
    // 🔴 **The branch where the app HOLDS the question**, which no provider card reaches — and it
    // records the parent's conversation exactly as the forwarded branch does.
    expect(rowsOf(worker, 'user_decision')).toEqual([
      {
        type: 'user_decision',
        requestId: waiting.requestId,
        outcome: 'answered',
        by: { who: 'an-agent', agent: pm.sessionId },
      },
    ])

    // ⚑ **And the same question shape answered by a PERSON.** ⛔ `respondUserInput`'s held branch
    // is the only door a person has for an `ask_parent` that reached them — `437`'s bound was
    // derived from a chain whose last step is *a person answers*, and `608` removed the bound and
    // not the chain — and it is the fifth writer.
    const second = callOn(workerTools, 'ask_question', {
      who_answers: 'the-parent',
      piece: given.label,
      question: 'one more?',
      options: ['yes', 'no'],
    })
    await waitFor(
      () => rowsOf(worker, 'question_asked').length === 2,
      'the second question to be recorded',
    )
    const asked = rowsOf(worker, 'question_asked')[1]
    if (asked === undefined || asked.type !== 'question_asked')
      throw new Error('no second question')
    // ⛔ **The window has to OWN the conversation to answer for a person**, which is
    // `mayAnswerAsAHuman`'s third conjunct and not a detail of this fixture: a worker a give
    // started is nobody's until somebody takes it over, and `465`'s own gate is what that predicate is for.
    // ⚑ Taking it over is the gesture a person makes before answering from the queue.
    host.claimSession(worker, window)
    const taken = await host.respondUserInput(
      worker,
      asked.requestId,
      { kind: 'answer', answers: { answer: ['yes'] } },
      window,
    )
    expect(taken, JSON.stringify(taken)).toEqual({ outcome: 'taken' })
    await second
    expect(rowsOf(worker, 'user_decision').at(-1)).toEqual({
      type: 'user_decision',
      requestId: asked.requestId,
      outcome: 'answered',
      by: { who: 'a-person' },
    })
  })
})
