import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  whoDidIt,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
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
import type { RuntimeEvent } from '@brobot2/runtime'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **477 · who did it** — HO-029 §2, landed.
 *
 * > ⛔ §2.1: *"The actor is recorded by whoever performs the act, at the moment it happens. Never
 * > inferred afterwards, never derived from position, never reconstructed from what else was
 * > happening."*
 * >
 * > ⛔ §2.2: *"Do not backfill, and do not smooth the discontinuity. Every event written before
 * > this answers unknown, and the digest must keep saying so."*
 *
 * ## ⛔ What was measured, and where the scope came from
 *
 * ⚠️ **`463` F1 found the digest saying *"1 request was answered by a person"* about a question a
 * parent AGENT had answered, and `465` narrowed the sentence because the row genuinely did not
 * know.** ⚑ This file is the other half: the row knows now.
 *
 * 🔴 **The scope is DERIVED and §3 is the derivation, executable.** The rule is *a durable row
 * that ends a wait on somebody's decision, written at a door that has already established who the
 * decider is.* ⛔ Over the twenty-three app-written event types that was exactly two —
 * `user_decision` and `proposal_ended`, which D-016 took out with proposals — and §3 states, per
 * type, why each of the others is left alone. ⚠️ **An act performed by the engine has an actor
 * too**, and *the app itself* is one of this vocabulary's answers rather than an omission.
 *
 * ## ⚑ The instruments are production doors, never hand-built rows
 *
 * ⛔ **Except where a hand-built row IS the subject.** §1's whole point is a window holding one row
 * written before this app recorded an actor and one written after, so the old row is planted —
 * that population cannot be produced any other way, and producing it by deleting a field would be
 * a fixture built with the code under test.
 *
 * ⚑ The provider is a double, every directory is temporary, and no live app, port or provider is
 * touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const srcDir = join(here, '../src')

const HOUR = 3_600_000
const FROM = 1_800_000_000_000
const TO = FROM + 12 * HOUR
const INSIDE = FROM + 6 * HOUR
/**
 * ⚑ **D-016 · the window after it**, because the digest is ONE window over every conversation an
 * agent of this app holds: §1's second reading gets a window of its own.
 */
const NEXT_TO = TO + 12 * HOUR
const INSIDE_NEXT = TO + 6 * HOUR

/** A window sink: `aPersonIsBehindIt` is what the person's answer door reads (`340`, `349`). */
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
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the scope, derived — and a reason for every row left alone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **The census `477` is scoped by, as data.** ⛔ `records` is the verdict; the string is the
   * reason, and it is what the response document states per row.
   *
   * ⚠️ **Keyed by `Exclude<TranscriptEvent, RuntimeEvent>['type']`, so a new app-written event is
   * a compile error here** — the roster device `transcript.test.ts` uses, one question over. ⛔ A
   * durable act that nobody classified is the thing this dispatch exists to stop.
   */
  const ACTOR_CENSUS: Readonly<
    Record<Exclude<TranscriptEvent, RuntimeEvent>['type'], { records: boolean; because: string }>
  > = {
    worker_registered: {
      records: false,
      because:
        'a binding fact written by this app with the conversation; its actual starter is the parent recorded in the same transaction',
    },
    // ── it records one, and did before 477 ────────────────────────────────────────────────────
    user_turn: {
      records: true,
      because: '`attribution` + `relayedFrom`, written by whoseWordsTheseAre at the door (413)',
    },
    work_given: {
      records: true,
      because: '`givenBy` — the conversation that gave the piece; its owner is the ledger it is in',
    },
    work_taken_back: { records: true, because: '`by` — the conversation that took the piece back' },
    work_retitled: {
      records: true,
      because: '`by` — the giver or the owner that titled the piece',
    },
    work_status_set: {
      records: true,
      because: '`by` — the giver or the owner that set the piece’s status line',
    },
    work_rebriefed: {
      records: true,
      because: '`by` — the giver that rewrote the brief; no verb writes the row yet',
    },
    work_closed: {
      records: true,
      because: '`by` — the conversation that closed the piece; no verb writes the row yet',
    },
    work_interrupted: {
      records: true,
      because: '`by` plus `agent` — the precedent this vocabulary reuses',
    },
    message_sent: { records: true, because: '`onBehalfOfAPerson`, derived off the sending slot' },
    // ── 477 ───────────────────────────────────────────────────────────────────────────────────
    user_decision: {
      records: true,
      because: '477 · `by` — five writers, two kinds of actor, one row',
    },
    instruction_changed: {
      records: true,
      because: 'The writing conversation and snapshotted author are bound by the host.',
    },
    instruction_settled: {
      records: true,
      because:
        '582 · `by` — a person at the sheet, a person’s own save superseding it, or the launch sweep; four actors and one word, which is 477’s finding carried across rather than re-learned',
    },
    mcp_server_request_settled: {
      records: true,
      because: '`by` — a person at Waiting on you, or a person’s own registration superseding it',
    },
    // ── left alone, and why ───────────────────────────────────────────────────────────────────
    mcp_server_requested: {
      records: false,
      because:
        'the actor is WHICH LEDGER it is in — only the conversation that asked can write one — and `requestedBy` names the identity behind it',
    },
    instruction_proposed: {
      records: false,
      because:
        '582 · the actor is WHICH LEDGER it is in — only the conversation that asked can write one — and `proposedBy` names the identity behind it',
    },
    // ── left alone, and why ───────────────────────────────────────────────────────────────────
    work_replied: {
      records: false,
      because:
        'the actor is WHICH LEDGER it is in — only the conversation that holds the piece can reply, and the giver’s `user_turn` carries `relayedFrom`',
    },
    question_asked: {
      records: false,
      because:
        'the actor is WHICH LEDGER it is in — only the conversation holding the work can ask',
    },
    work_sent: {
      records: false,
      because:
        'D-047 · the actor is WHICH LEDGER it is in — only the conversation that gave the piece, or gave it a new brief, writes one',
    },
    tool_refused: {
      records: false,
      because: 'the actor is WHICH LEDGER it is in, and `rail` names which rule refused',
    },
    reply_undelivered: {
      records: false,
      because: 'the act is an absence — nobody was there — and the replier is the ledger owner',
    },
    // ⚑ **723** — the provider did not answer an ask; the row names WHOSE, as the ask's own row does,
    // because another ask can land between the two.
    stop_unanswered: {
      records: true,
      because: '723 · `by` plus `agent` — the asker of the ask the provider did not answer',
    },
    // ⚑ **D-042** — 682's `model_choice_set_aside` went, with the stand-in re-judge that wrote it:
    // no launch sets a person's choice aside any more (R1 names and records each conversation's
    // pair), so there is no row left to classify.
    work_reconciliation: {
      records: false,
      because: 'an app-written receipt of its reminder or escalation, not a new act by a caller',
    },
    work_recovery: {
      records: false,
      because: 'an app-written observation of the existing sign-in recovery, not a new request',
    },
    work_stall_told: {
      records: false,
      because:
        '`how` already splits the actors: the app pushed it, or the piece’s own wake or question set it right',
    },
    request_routed: {
      records: false,
      because: 'the router is this app and there is one classifier; the asker is the ledger owner',
    },
    request_escalated: {
      records: false,
      because:
        'a deadline sweep, one writer, one possible author — a `by` here would have exactly one value',
    },
    request_stranded: {
      records: false,
      because: 'the launch sweep, one writer; the event TYPE is the actor',
    },
    work_restarted: {
      records: false,
      because: 'the launch sweep, one writer; its one field names the pieces it stalled, not who',
    },
    // ⚠️ **673 · not recorded, and that is a gap stated rather than a design claimed**: the row is
    // for the task fold, and who reopened — a person's Reopen or a parent's wake — is not written on it.
    // ⚑ **T-002 · D-004 records ONE actor**: `because` (`the-sign-in-was-renewed`, and
    // `the-sign-in-moved-on`) says this app reopened it by itself. A person's Reopen and a wake still
    // name nobody, so `false` stands.
    reopened: {
      records: false,
      because:
        '673 · the host row the task fold unwinds on; a person’s Reopen and a wake are not recorded here (`because` names only the app’s own reopens: on a renewed sign-in, and on the current sign-in for what waited)',
    },
    // Its sentence names the agent that restored it; it has no field of its own for who.
    restored_from_archive: {
      records: false,
      because:
        'one writer, the host, when an agent restores an archived conversation; `saying` is a sentence for a person that names the agent, not a field a reader can attribute by',
    },
    // ⚑ **D-017 · R4** — the launch marker the question fold keys on; `reopened`'s answer beside it.
    launched: {
      records: false,
      because:
        'D-017 · R4 · one writer, the host at every start and reopen, and the event TYPE is the actor (this app launched the provider); who caused the start is on the row that carried it, as for `reopened`',
    },
    // ⚑ **D-017 · R10** — a replacement at each end: nobody chose it; the app found it.
    replaced_by: {
      records: false,
      because:
        'D-017 · R10 · one writer, the host, when a start finds the conversation can never be reopened — nobody chose it, and the delivery that found it is recorded on its own row, with its authorship',
    },
    replaces: {
      records: false,
      because:
        'D-017 · R10 · `replaced_by`’s other end, the same writer in the same act; the new conversation’s own start rows carry who it serves',
    },
    request_interrupted: {
      records: false,
      because:
        '397 chose the actor on the NEIGHBOURING `work_interrupted` row and said so — reversing that is not this dispatch',
    },
    // ⚑ **D-009** — the asker withdrawing its own question: the ledger it lands in IS the actor's.
    question_withdrawn: {
      records: false,
      because:
        'written only by the asker itself, into its own ledger: the conversation holding the row is who did it, and a field would be a second copy of that',
    },
    // ⚑ **D-009** — nobody acted: the recipient's conversation ended, and `recipient` names it.
    question_recipient_ended: {
      records: false,
      because:
        'an ending, not an act: the app writes it when the conversation it names ended, and whoever ended that one is recorded where it ended',
    },
    question_ended_with_its_piece: {
      records: false,
      because:
        'an ending, not an act: the app writes it when a piece ended, and whoever ended the piece is recorded on that row',
    },
    user_command: {
      records: false,
      because:
        'the type MEANS a person pressed a control; it is gated on `mayControl` and silent for every commanded gesture',
    },
    memory_note: {
      records: false,
      because:
        'an observation the app makes of a directory any session in the profile can write — naming one would be a guess',
    },
    memory_loaded: { records: false, because: 'a launch fact about the app’s own prompt assembly' },
    message_queued: {
      records: false,
      because:
        'the act is a transmission, and 413 already ruled its authorship: `work` + `relayedFrom`, with `attribution` deliberately stripped',
    },
    message_unqueued: {
      records: false,
      because:
        'F1 — the `cancelled` arm HAS two kinds of actor and records neither; left alone with the measurement in the response, not closed here',
    },
  }

  it('⛔ every app-written durable event is classified, and the one that changed is the one derived', () => {
    // ⚑ **Two until D-016**, which took `proposal_ended` out with proposals.
    const changed = Object.entries(ACTOR_CENSUS)
      .filter(([, one]) => one.because.startsWith('477'))
      .map(([type]) => type)
      .sort()
    expect(changed).toEqual(['user_decision'])
    // ⛔ **Every row owes a reason, whichever way it went.** ⚠️ A `records: false` with no sentence
    // is an omission nobody decided about, which is the shape HO-029 §2.1 is written against.
    for (const [type, one] of Object.entries(ACTOR_CENSUS)) {
      expect(one.because.length, type).toBeGreaterThan(20)
    }
    // ⚑ **And the one 477 touched really does carry it in the TYPE**, asserted through a value the
    // compiler checks rather than through the census's own opinion of itself.
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
  // §5 · the doors (the four ways a proposal stopped waiting went with proposals at D-016)
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

  it('⛔ a PERMISSION answered from a window records the person — the fourth of the five writers', async () => {
    const opened = await host.createSession(
      {
        provider: 'claude',
        profileId: 'permission-side',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    // ⚑ **The double parks its first turn on a permission card**, which is how a real `ask` session
    // reaches `respondPermission` — the door `465` §2 could not tell apart from the agent's.
    await host.send(opened.sessionId, 'hello', window)
    await waitFor(
      () => window.messages.some((one) => one.event.type === 'permission_request'),
      'the permission card',
    )
    await host.respondPermission(opened.sessionId, 'turn_1_perm', { outcome: 'allow' }, window)
    expect(rowsOf(opened.sessionId, 'user_decision')).toEqual([
      {
        type: 'user_decision',
        requestId: 'turn_1_perm',
        outcome: 'allow',
        by: { who: 'a-person' },
      },
    ])
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · no schema change, stated rather than inferred
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ nothing here is a schema change — no migration, no column, and clean-base is owed nothing', () => {
    // ⛔ **The column, under four spellings, with a positive control.** ⚠️ A named absence is only
    // as strong as its search shape.
    const schema = readFileSync(join(srcDir, 'main/db/schema.ts'), 'utf8')
    for (const spelling of ['actedBy', 'acted_by', 'whoDidIt', 'who_did_it']) {
      expect(schema, spelling).not.toContain(spelling)
    }
    // ⚑ The control: the column the new field actually lives INSIDE, which the census can see.
    expect(schema).toContain("text('payload', { mode: 'json' })")
    // 🔴 **500 · and over every migration, which is what makes the claim survive a later one.**
    // ⛔ *No migration, whichever number it carries, writes this column* — which is what `477`
    // actually promised. ⚑ Since D-016 that is `0000_the_tree.sql` and whatever lands after it.
    const everyMigration = readdirSync(migrationsDir)
      .filter((one) => one.endsWith('.sql'))
      .map((one) => readFileSync(join(migrationsDir, one), 'utf8'))
    expect(everyMigration.length).toBeGreaterThan(0)
    for (const sql of everyMigration) {
      for (const spelling of ['acted_by', 'who_did_it']) {
        expect(sql, spelling).not.toContain(spelling)
      }
    }

    // 🔴 **`clean-base` is owed nothing, and that is a decision rather than an omission.** ⛔ Its
    // census is over the literals passed as `join(userData, …)` — a PATH census — and a key inside
    // an `events.payload` JSON object adds none. ⚠️ Asserted here so the sentence is a test rather
    // than a claim in a response document.
    const written = [
      join(srcDir, 'shared/who-did-it.ts'),
      join(srcDir, 'main/runtime/runtime-host.ts'),
      join(srcDir, 'main/db/session-store.ts'),
    ]
    for (const file of written) {
      const source = readFileSync(file, 'utf8')
      for (const line of source.split('\n')) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
        expect(line, file).not.toMatch(/join\(\s*userData/)
      }
    }
  })
})
