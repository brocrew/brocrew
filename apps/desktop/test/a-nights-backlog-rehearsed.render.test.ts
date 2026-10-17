import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNEL_REFUSALS,
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { REGISTER_WORDS } from '../src/renderer/src/lib/digest'
import { CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import {
  LOOK_EVERY_MS,
  personsQueueView,
  usePersonsQueue,
  type PersonsQueueKind,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import {
  WHAT_COMES_AFTER_IS_NOT_OURS,
  whatThisAnswerDoes,
  type AttentionDecision,
} from '../src/renderer/src/lib/user-input-offer'
import {
  DIGEST_REGISTERS,
  claimedLine,
  observedLine,
  type DigestLine,
  type DigestRegister,
} from '../src/shared/digest'
import { PERMANENCE_SAID, RAIL_PERMANENCES } from '../src/shared/refusals'
import { pieceLine, theOwnerOf } from '../src/shared/piece-called'
import {
  agentName,
  type CreatedSession,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { TASK_OUTCOMES, TASK_STALL_CAUSES, UNDRIVEN_SENTENCES } from '../src/shared/tasks'

/**
 * 🔴 **463 · a night's backlog, rehearsed from the readers** (HO-024's second exit half).
 *
 * Plant one member of every closed roster used by the person-readers and digest, then ask the
 * shipped SQLite readers, host projections, and renderer folds what a person sees. Loops use
 * exported vocabularies, so a new shape, outcome, cause, permanence, or register adds a case
 * or fails instead of silently passing.
 *
 * ⚠️ The provider is a double and every directory is temporary. No live app or provider is run.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const FROM = 1_800_000_000_000
const TO = FROM + 12 * 60 * 60 * 1_000

/**
 * ⚑ **The parts of the night** — the rehearsal's own partition of the backlog, one group of
 * conversations per closed roster. ⚠️ **D-016 · they were projects, and the digest was one card per
 * project.** There are no projects now and the digest is ONE card over every agent's conversation,
 * so a part is only the name this file gives a group of conversations; `plans` went with proposals.
 */
const NIGHT_PARTS = ['reports', 'operations', 'waiting', 'tools', 'unreadable', 'rumour'] as const
type NightPart = (typeof NIGHT_PARTS)[number]

type Criterion16Verdict = 'yes' | 'no' | 'partly'

/**
 * 🔴 **463's criterion-16 table, RE-RUN — by 466, 475, 480 and 483, with the verdicts moved.**
 *
 * ⛔ **463 scored 1 yes · 3 partly · 3 no and wrote the missing sentence for each row.** Through
 * 480, `missing` meant the sentence still owed before a row could pass. ⚑ **483 changes only that
 * ruled meaning:** after HO-030 accepts Operations' named gap as the ceiling, `null` means the
 * criterion owes no unaccepted sentence — not that the ledger can suddenly say the gap's facts.
 *
 * 🔴 **483 re-reads current main as 7 yes · 0 partly · 0 no.** The product fact did not move:
 * `operations` remains short by four sentences no reader shaped like this one can build — the
 * rows that leave work undriven name no work — and the digest says so in a
 * `work-without-an-ending` gap. ⚑ **HO-030 §1 explicitly accepts that named gap as criterion 16's
 * ceiling**, so the verdict moves while the gap and the exact unavailable sentence stay asserted
 * below. This is a ruling applied to the rehearsal, not a claim that the ledger grew an edge.
 *
 * ⚠️ **`rumour` is neither 466's nor 475's** — `465` owns the false *"answered by a person"*
 * observation (463 F1, criterion 18), and what was left of it was a durable field
 * `UserDecisionEvent` did not have.
 *
 * 🔴 **477 · HO-029 §1 retracted the bucket that held it and the field landed.** `480` can score
 * that work without grading its own construction: the durable answer names an agent and the
 * grouped line says *"Who answered: 1 · an agent."* ⛔ Requiring that grouped line to enumerate
 * the exact question and conversation would invent a stricter criterion than 463 used, and would
 * contradict the same grouped-line rule under which `waiting` is already `yes`.
 */
const CRITERION_16: Readonly<
  Record<NightPart, { readonly verdict: Criterion16Verdict; readonly missing: string | null }>
> = {
  reports: { verdict: 'yes', missing: null },
  operations: {
    // ⚑ **466 closed the refusal half and the withdrawal's number; `475` closed one of the five
    // stall causes and made the other four a NAMED gap rather than a silence.**
    //
    // 🔴 **The division is about what a row NAMES, not about what a read costs.**
    // `message_never_sent` is written by `message_unqueued`, whose row names the held message —
    // and `work_given` names the same one, so the pair says WHICH work. ⛔ The other four are
    // written by `turn`, `turn`, `status` and `replaced_by`, and none of those rows names a piece
    // (D-016: `work_restarted` names its pieces now): which work each stalled is `derivePieces`'
    // answer, reached by folding a whole conversation rather than a window. ⚠️ So selecting `status` would close none of them, and
    // the cost ruling `438` wrote about it never had to be argued with.
    // ⚑ **483 · HO-030 §1 accepts this named `work-without-an-ending` gap as the ceiling.** The
    // unavailable causal sentence is still pinned by the fixture's gap and transcript negatives;
    // `missing` means what remains before the ruled criterion, not every fact the ledger lacks.
    verdict: 'yes',
    missing: null,
  },
  waiting: {
    // 🔴 **475 · closed.** ⚑ 466 closed the five request reasons and `437`'s task edge. ⚠️ `463`'s
    // third clause — *"three project shapes were proposed"* — went with proposals at D-016.
    verdict: 'yes',
    missing: null,
  },
  tools: { verdict: 'yes', missing: null },
  unreadable: { verdict: 'yes', missing: null },
  // 🔴 **480 · moved.** 477 closed 463's actual missing sentence: the durable row records
  // `{who:'an-agent', agent:<the PM conversation>}` and the digest names the actor kind. The
  // grouped digest does not enumerate instance ids, and no other `yes` row is held to that rule.
  rumour: { verdict: 'yes', missing: null },
}

/** Hard-coded consequence oracle: these words are compared with, not derived from, the formatter. */
const CRITERION_20 = {
  'a-question': {
    sessionId: 'sess_waiting_provider_question',
    chain: ['sess_waiting_provider_question', 'sess_waiting_parent', 'you'],
    work: [{ label: 'W40.13' }],
    effects: [
      'the agent is given “Current” as the answer',
      'the agent is given “Previous” as the answer',
      'the request is declined and the agent is told nothing was answered',
    ],
  },
  'a-decision': {
    sessionId: 'sess_waiting_decisions',
    chain: ['sess_waiting_decisions', 'you'],
    work: [{ label: 'W40.10' }],
    // 🔴 **480 · all four narrow outcomes, in the source-derived offer order.** The live matrix
    // supplies the adapter/IPC fact; this rehearsal pins the words its synthetic row renders.
    effects: [
      'the agent may do this once',
      // ⚑ 736 · R94 — the CLI's own rule for the ask, no longer *"the same thing again"*.
      'the agent may do this, and what the provider’s own rule for it covers, for this conversation',
      'the agent is refused this one thing',
      'the whole turn is asked to stop, and this request is refused',
    ],
  },
} as const satisfies Readonly<
  Record<
    PersonsQueueKind,
    {
      readonly sessionId: string
      readonly chain: readonly string[]
      readonly work: readonly { readonly label: string }[]
      readonly effects: readonly string[]
    }
  >
>

const REFUSAL_CASE = {
  permanent: { tool: 'give_work', rail: 'no-such-profile' },
  'until-a-person-changes-it': { tool: 'give_work', rail: 'spawning-disabled' },
  'while-this-holds': { tool: 'reply_to_parent', rail: 'summary-too-long' },
} as const satisfies Readonly<
  Record<(typeof RAIL_PERMANENCES)[number], { readonly tool: string; readonly rail: string }>
>

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

/** Keep the provider handles so the criterion-18 case can be raised through the real host door. */
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

/** ⚑ **D-016 · the one giver of this night's planted work**, and the root it gives it from. */
const GIVER = { conversation: 'sess_brobot', root: 'work_brobot', label: 'W40' } as const

describe("463 · a night's backlog, rehearsed", () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let sessionCounter: number
  let handles: FakeSessionHandle[]
  let providerSessions: FakeProviderSessions
  let window: RecordingSink
  let ordinals: Map<string, number>

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-463-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-463-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = FROM + 6 * 60 * 60 * 1_000
    sessionCounter = 0
    handles = []
    providerSessions = new FakeProviderSessions()
    ordinals = new Map()
    store = createSessionStore(db, tick)
    // ⛔ Construct before planting open work: the host's launch repair is itself an ending writer.
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, providerSessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_live_${String(++sessionCounter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:463')
  })

  afterEach(async () => {
    usePersonsQueue().forget()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const conversation = (id: string, provider: 'codex' | 'claude' = 'codex'): void => {
    store.create({
      id,
      provider,
      // A person's chain names the conversation's AGENT since `734` (R41), and the cwd basename
      // only where there is none. Give each synthetic conversation a distinct folder anyway, so a
      // non-empty-but-ambiguous "who" cannot satisfy criterion 20 on either arm.
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

  /**
   * ⚑ **D-016 · every piece of this night is given by ONE giver, under its root** — `W40`, a root
   * number no conversation of this night is handed, so no label here names two pieces. ⚠️ The giver
   * holds no ledger of its own here: the owner's `work_given` is the row every reader folds.
   */
  const assign = (
    id: string,
    piece: string,
    number: number,
    title: string,
    when: number,
    messageId?: string,
  ): void => {
    at(id, when, {
      type: 'work_given',
      piece,
      label: `${GIVER.label}.${String(number)}`,
      parent: GIVER.root,
      givenBy: GIVER.conversation,
      title,
      brief: `work ${piece}`,
      ...(messageId === undefined ? {} : { messageId }),
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
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const renderQueue = (): Promise<string> =>
    renderToString(createSSRApp({ render: () => h(PersonsQueue as never, { floating: true }) }))

  const recordFromHistory = (sessionId: string): SessionRecord => {
    const history = host.latestHistory(sessionId)
    const record = createSessionRecord(sessionId)
    record.meta = {
      sessionId,
      provider: 'codex',
      cwd: join(root, sessionId),
      profileId: `profile-${sessionId}`,
    } as CreatedSession
    record.phase = 'open'
    for (const entry of history.entries) {
      applyEvent(record.control, entry.event, entry.at, entry.ordinal)
    }
    return record
  }

  const readTranscript = async (
    sessionId: string,
  ): Promise<{
    readonly history: ReturnType<RuntimeHost['latestHistory']>
    readonly html: string
    /**
     * ⚑ **`587` · the folded items, because the HTML stopped being the whole of the transcript.**
     * A settled tool row is now a member of a collapsed run and its receipt is rendered only when
     * somebody opens it — so a claim about what this app KEEPS has to be read off the item, and a
     * claim about what a closed transcript SHOWS has to be read off the HTML. They were one
     * assertion and they are two facts.
     */
    readonly items: readonly TranscriptItem[]
  }> => {
    const history = host.latestHistory(sessionId)
    const transcript = createTranscript()
    for (const entry of history.entries) {
      applyEvent(transcript, entry.event, entry.at, entry.ordinal)
    }
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(TranscriptView as never, {
            items: transcript.items,
            mode: 'normal',
            who: 'Codex',
            hasOlder: history.hasOlder,
            turnAligned: history.turnAligned,
          }),
      }),
    )
    return { history, html, items: transcript.items }
  }

  /** The production parent-agent path that the digest later calls a person's answer. */
  const plantAgentAnswer = async (): Promise<{
    pm: string
    worker: string
    requestId: string
    label: string
  }> => {
    const seeded = await host.createSession(
      {
        provider: 'claude',
        profileId: 'rumour-worker',
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    await host.close(seeded.sessionId, window)

    // ⚑ **D-017 · R19 — the PM runs `auto`, so the turn the travelling question opens in it parks on
    // no card.** ⛔ The double parks every `ask` turn on one, and the PM is a conversation nobody
    // spawned, so that card would now be a PERSON's — a request in a night whose every queue
    // population is planted by name below. ⚠️ The worker inherits `auto` (HO-036) and still asks:
    // a question is not a permission, and it still travels to the PM. ⚑ The PM's turn then ENDS,
    // which the digest reports (waited for below, so it reads it every time).
    const opened = await host.createSession(
      {
        provider: 'claude',
        profileId: 'rumour-pm',
        approvalMode: 'auto',
        cwd: root,
      },
      window,
    )
    // ⚑ D-016 · the give starts the worker, and its brief is its first turn.
    const given = await callOn(agentToolsFor(host, opened.sessionId), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'rumour-worker',
      title: 'raise the question',
      brief: 'raise the question whose answer provenance is under test',
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
      'the worker question to route',
    )
    const answered = await host.answerQuestion(
      {
        questionId: asked.id,
        answers: [{ part: 'q0', answer: ['Postgres'] }],
      },
      { ownerId: `agent:${opened.sessionId}` },
    )
    expect(answered.ok, JSON.stringify(answered)).toBe(true)
    await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    await waitFor(
      () => store.events(opened.sessionId).some(({ event }) => event.type === 'turn'),
      'the turn the travelling question opened in the PM to end',
    )
    return { pm: opened.sessionId, worker, requestId: asked.id, label: given.label as string }
  }

  /** Plant every reader-derived population and every task/refusal ending before the first read. */
  const plantNight = (): void => {
    // Every task outcome — these are agent claims, and the digest must retain all three separately.
    for (const [index, outcome] of TASK_OUTCOMES.entries()) {
      const id = `sess_report_${outcome}`
      conversation(id)
      assign(id, `work_${outcome}`, index + 1, `the ${outcome} report`, FROM + 100 + index * 10)
      at(id, FROM + 101 + index * 10, {
        type: 'work_replied',
        piece: `work_${outcome}`,
        outcome,
        summary: `${outcome} report from the night`,
        resources: [],
      })
    }

    // Every non-terminal way work becomes stalled, plus the second terminal piece state.
    for (const [index, cause] of TASK_STALL_CAUSES.entries()) {
      const id = `sess_stall_${cause}`
      const piece = `work_stall_${cause}`
      // ⚑ A provider that wakes its conversation when background work ends, for the cause that
      // needs one: a Codex turn's end over background work stalls the work there and then.
      conversation(id, cause === 'background_stopped' ? 'claude' : 'codex')
      const messageId = cause === 'message_never_sent' ? `msg_${cause}` : undefined
      // ⚠️ The title names no cause: the digest's lines are asserted to carry none below.
      const title = `operations work ${String(index + 1)}`
      assign(id, piece, index + 4, title, FROM + 1_000 + index * 10, messageId)
      const endingAt = FROM + 1_001 + index * 10
      switch (cause) {
        case 'turn_ended':
          at(id, endingAt, { type: 'turn', state: 'failed' })
          break
        case 'turn_interrupted':
          at(id, endingAt, { type: 'turn', state: 'interrupted' })
          break
        case 'app_restarted':
          // ⚑ D-016 · the row names the pieces the restart stalled.
          at(id, endingAt, { type: 'work_restarted', pieces: [piece] })
          break
        case 'message_never_sent':
          at(id, endingAt, {
            type: 'message_unqueued',
            messageId,
            reason: 'abandoned',
            text: `work ${piece}`,
          })
          break
        case 'could_not_be_reopened':
          // ⚑ D-017 · R10 — its provider no longer had it, and a new conversation took its place.
          at(id, endingAt, { type: 'replaced_by', sessionId: `sess_replacing_${cause}` })
          break
        case 'background_stopped':
          // ⚑ Its turn ended over background work, and its conversation's end took that work with it.
          at(id, endingAt, {
            type: 'background_work',
            running: [{ id: 'bg_stopped', description: 'a long build' }],
            source: 'test',
          })
          at(id, endingAt, { type: 'turn', state: 'completed' })
          at(id, endingAt, { type: 'status', state: 'ended' })
          break
        case 'provider_limited':
          // ⚑ F074 — its provider refused the turn for its usage limit, and the ending says so.
          at(id, endingAt, {
            type: 'turn',
            state: 'failed',
            limit: { provider: 'claude', window: 'five_hour', resetsAt: endingAt + 3_600_000 },
          })
          break
        case 'login_refused':
          // ⚑ F076 — its provider refused the turn on a login this Mac had moved on from.
          at(id, endingAt, { type: 'turn', state: 'failed', loginRefused: true })
          break
        case 'billing_refused':
          // Its provider would not bill the account of the key the turn ran on.
          at(id, endingAt, { type: 'turn', state: 'failed', billingRefused: true, onAKey: true })
          break
        default:
          cause satisfies never
      }
    }
    conversation('sess_withdrawn')
    assign('sess_withdrawn', 'work_withdrawn', 20, 'the work taken back', FROM + 1_100)
    at('sess_withdrawn', FROM + 1_101, {
      type: 'work_taken_back',
      piece: 'work_withdrawn',
      by: GIVER.conversation,
    })

    // Every refusal permanence. The digest groups these and retains only the newest tool/rail.
    conversation('sess_refusals')
    for (const [index, permanence] of RAIL_PERMANENCES.entries()) {
      const refusal = REFUSAL_CASE[permanence]
      at('sess_refusals', FROM + 1_200 + index, {
        type: 'tool_refused',
        tool: refusal.tool,
        rail: refusal.rail,
        permanence,
        retryable: permanence === 'while-this-holds',
        remedy: null,
      })
    }

    // All five request shapes which never enter the question channel.
    conversation('sess_waiting_decisions')
    assign('sess_waiting_decisions', 'work_decisions', 10, 'run the tests', FROM + 1_900)
    at('sess_waiting_decisions', FROM + 2_050, {
      type: 'permission_request',
      id: 'req_decision_0',
      kind: 'command',
      action: 'Bash',
      detail: 'pnpm run test',
      scope: {
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
        underDisclosed: false,
      },
    })
    for (const [index, because] of CHANNEL_REFUSALS.entries()) {
      at('sess_waiting_decisions', FROM + 2_100 + index * 30, {
        type: 'request_routed',
        requestId: `req_decision_${String(index)}`,
        to: 'a-person',
        because,
        parent: 'sess_waiting_parent',
      })
    }

    // One app-authored question names one piece while its conversation holds two open pieces.
    conversation('sess_waiting_question')
    assign('sess_waiting_question', 'work_exact', 11, 'pick the database', FROM + 1_910)
    assign('sess_waiting_question', 'work_other', 12, 'the other work', FROM + 1_911)
    at('sess_waiting_question', FROM + 2_155, {
      type: 'question_asked',
      requestId: 'req_exact',
      piece: 'work_exact',
      label: 'W40.11',
      prompt: 'Which database?',
      questions: [
        {
          id: 'answer',
          prompt: 'Which database?',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }],
        },
      ],
    })
    at('sess_waiting_question', FROM + 2_156, {
      type: 'request_routed',
      requestId: 'req_exact',
      to: 'the-parent',
      parent: 'sess_waiting_parent',
    })
    at('sess_waiting_question', FROM + 2_300, {
      type: 'request_escalated',
      requestId: 'req_exact',
    })

    // The provider-raised sibling supplies the real question card used for criterion 20.
    conversation('sess_waiting_provider_question')
    assign(
      'sess_waiting_provider_question',
      'work_provider_question',
      13,
      'pick the release',
      FROM + 1_912,
    )
    at('sess_waiting_provider_question', FROM + 2_160, {
      type: 'user_input_request',
      id: 'req_provider',
      prompt: 'Which release?',
      questions: [
        {
          id: 'release',
          prompt: 'Which release?',
          options: [{ label: 'Current' }, { label: 'Previous' }],
        },
      ],
    })
    at('sess_waiting_provider_question', FROM + 2_161, {
      type: 'request_routed',
      requestId: 'req_provider',
      to: 'the-parent',
      parent: 'sess_waiting_parent',
    })
    at('sess_waiting_provider_question', FROM + 2_301, {
      type: 'request_escalated',
      requestId: 'req_provider',
    })

    // The part of a Codex tool answer 457 made readable. The digest reads neither row.
    conversation('sess_tool_answer')
    at('sess_tool_answer', FROM + 3_010, {
      type: 'tool_call',
      id: 'call_list_agents',
      name: 'brobot__list_agents',
      summary: 'list the agents',
    })
    at('sess_tool_answer', FROM + 3_011, {
      type: 'tool_result',
      id: 'call_list_agents',
      summary: 'sess_child · worker · blocked: schema mismatch',
      ok: true,
    })

    // `rowsUnread > 0` on the actual candidate walk, with good rows still landing beside it.
    const tornQueueOrdinal = ordinals.get('sess_waiting_decisions') ?? 0
    ordinals.set('sess_waiting_decisions', tornQueueOrdinal + 1)
    db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ev_torn_queue',
      'sess_waiting_decisions',
      tornQueueOrdinal,
      'request_routed',
      '{"type":"request_rou',
      FROM + 2_500,
      null,
      0,
    )

    // A digest-eligible row no digest reader can parse.
    conversation('sess_unreadable')
    db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('ev_torn_digest', 'sess_unreadable', 0, 'turn', '{"type":"tur', FROM + 3_100, null, 0)
  }

  it('reads digest, then queue, then attempts only the transcripts the digest could not replace', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const agentAnswer = await plantAgentAnswer()
    // Corrupt rows only after the real host path has answered; otherwise SQLite's JSON
    // extraction rejects the routing query before there is an answer to rehearse.
    plantNight()
    const readingOrder: string[] = []

    // ── First read: digest ──────────────────────────────────────────────────────────────────
    readingOrder.push('digest')
    const reading = host.digest(FROM, TO)
    const digest = reading.digest
    // 🔴 **483 · the verdicts, re-run on current main after HO-030 §1.** Every part meets the ruled
    // ceiling; Operations still carries the named gap asserted later in this same fixture.
    for (const name of NIGHT_PARTS) {
      const scored = CRITERION_16[name]
      // ⚑ **The pair, so neither half can drift**: a `yes` owes no sentence and anything else
      // owes one. A row scored `yes` with a sentence still on it would be a closed finding that
      // reads as open, and the reverse is a finding with nothing a reader can act on.
      expect(scored.missing === null).toBe(scored.verdict === 'yes')
    }
    expect(NIGHT_PARTS.filter((one) => CRITERION_16[one].verdict === 'yes')).toEqual([
      'reports',
      'operations',
      'waiting',
      'tools',
      'unreadable',
      'rumour',
    ])
    expect(NIGHT_PARTS.filter((one) => CRITERION_16[one].verdict === 'no')).toEqual([])
    // 🔴 **483 · the CEILING moved by ruling, not by an invented fact.** HO-030 §1 accepts the
    // named Operations gap. The gap assertions below still fail if the digest stops disclosing it,
    // so `[]` here cannot silently turn acceptance into erasure.
    expect(NIGHT_PARTS.filter((one) => CRITERION_16[one].verdict === 'partly')).toEqual([])

    // 🔴 **734 · each worker by its AGENT's name** (R41, `732` F-1) — read off the roster rather
    // than typed, because the name is the one this app gave the identity. ⛔ Until `734` the digest
    // said the conversation's folder, which each of these fixtures names after its id.
    const agentOf = (id: string): string => {
      const identity = store.identityOf(id)
      expect(identity, id).not.toBeNull()
      return agentName(identity?.profileSlug ?? null, store.agentIdentities())
    }
    const [failed, blocked, done] = ['failed', 'blocked', 'done'].map((one) =>
      agentOf(`sess_report_${one}`),
    )
    expect(new Set([failed, blocked, done]).size).toBe(3)

    // ⚑ **D-016 · ONE card over every agent's conversation.** Every part of the night is on it, so
    // each line counts across the parts: 3 reports + 7 operations + 3 waiting + 1 tools + 2 rumour
    // conversations spoke (`unreadable`'s only row could not be read). ⚑ **D-016c · one operations
    // conversation fewer**: a stop is no stall cause, so the night plants one stalled piece per
    // cause of five. ⚑ **One more since `background_stopped`**: one stalled piece per cause of six.
    // ⚑ **And one more since F074's `provider_limited`**: one per cause of seven.
    // ⚑ **And one more since F076's `login_refused`**: one per cause of eight.
    // And one more for `billing_refused`: one per cause of nine.
    // 🔴 **466 · the malformed `request_routed` row 463 planted for the QUEUE is in this window**,
    // so the digest discloses it too — the same damaged row, counted by a third reader. ⛔
    // `the-record-is-torn` outranks `it-says-what-happened` deliberately: with lines drawn it
    // changes no sentence, and with none it is the arm that forbids the false one.
    expect(digest).toMatchObject({ sessions: 20 })
    expect(
      digest.lines.map(({ register, kind, count, text, saidBy }) => ({
        register,
        kind,
        count,
        text,
        saidBy,
      })),
    ).toEqual([
      {
        register: 'observed',
        kind: 'work-handed-out',
        // 3 in reports, 9 in operations (`provider_limited`, `login_refused` and `billing_refused`
        // are one more each), 4 in waiting —
        // and (D-016) the rumour worker's, which
        // it is now GIVEN to start it, at the night's newest moment.
        count: 18,
        text: `18 pieces of work were handed out — the most recent is ${pieceLine(agentAnswer.label, 'raise the question')}, to ${agentOf(agentAnswer.worker)}.`,
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'work-taken-back',
        count: 1,
        text: `1 piece of work was taken back by whoever gave it — the most recent is ${pieceLine('W40.20', 'the work taken back')}.`,
        saidBy: null,
      },
      // 🔴 **475 · the one stall cause a windowed row-reader can attribute.** `message_unqueued`
      // joined the read because its row NAMES the held message and `work_given` names the same
      // one — the only edge of the five — not because it was cheaper than `status`.
      {
        register: 'observed',
        kind: 'work-not-sent',
        count: 1,
        text: `1 held message carrying work was not sent — the most recent carried ${pieceLine('W40.7', 'operations work 4')}.`,
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'question-travelled',
        // ⚑ 2 in waiting, 1 in rumour.
        count: 3,
        text: '3 questions travelled to a parent.',
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'decision-raised',
        // ⚑ One per channel refusal (the loop above), so the count moves with the vocabulary — `728`
        // added `a-server-asks-the-person` and a literal 5 went stale.
        count: CHANNEL_REFUSALS.length,
        text:
          `${String(CHANNEL_REFUSALS.length)} requests came up that only a person can settle: ` +
          CHANNEL_REFUSALS.map((because) => `1 · ${CHANNEL_REFUSAL_SENTENCES[because]}`).join(
            '; ',
          ) +
          '.',
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'question-escalated',
        count: 2,
        text: '2 questions ran past a deadline and reached a person.',
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'request-answered',
        count: 1,
        // 🔴 **477 · this night's answer came through the PRODUCTION agent door**
        // (`host.answerQuestion`, with the PM's own caller), so the row records an actor and the
        // line names its KIND. ⛔ Still `observed` and still `saidBy: null` — the line says what a
        // durable row carries, which is `465`'s requirement and is what makes naming an actor
        // legitimate here where it was a rumour before.
        text: '1 request was answered. Who answered: 1 · an agent.',
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'work-restarted',
        count: 1,
        text: 'The app restarted while 1 conversation still held work nobody had finished; that work is stalled until somebody drives it.',
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'tool-refused',
        count: 3,
        // ⚑ **627 · the three clauses are LOOKED UP** (`HO-096` §2.4). ⛔ Spelled out, this line
        // pinned a clause `627` replaced because a person had to decode it — and it is the surface
        // that draws the word with NO rail beside it, which is what ruled out the shorter wordings.
        text:
          '3 tool calls were refused — the most recent was reply_to_parent, by the rail summary-too-long. ' +
          `How long each is expected to hold: 1 · ${PERMANENCE_SAID.permanent}; ` +
          `1 · ${PERMANENCE_SAID['until-a-person-changes-it']}; ` +
          `1 · ${PERMANENCE_SAID['while-this-holds']}.`,
        saidBy: null,
      },
      {
        register: 'observed',
        kind: 'turn-ended',
        // ⚑ Operations' failed and interrupted turns, and (D-017 · R19) the rumour PM's own, which
        // runs `auto` now (see `plantAgentAnswer`) and so ends instead of parking on a card.
        // ⚑ D-016 · and two more completed: the rumour worker's BRIEF, which is a turn, and the PM's
        // turn on the stall notice that brief's ending (with no reply) sent it.
        // ⚑ F074 · one more `failed`: the turn its provider refused for the usage limit.
        // ⚑ F076 · and one more: the turn its provider refused on a login this Mac moved on from.
        // And one more: the turn its provider would not bill.
        count: 9,
        text: '9 turns ended — 4 completed, 4 failed, 1 interrupted.',
        saidBy: null,
      },
      // 🔴 **466 · 437's task edge, drawn.** The app-authored question says which work it is
      // about and the digest threw it away; 463's missing sentence for `waiting` ends
      // *"and 'Which database?' was about task #2"*.
      {
        register: 'observed',
        kind: 'question-about-work',
        count: 1,
        text: '1 question says which piece of work it is about — the most recent is W40.11.',
        saidBy: null,
      },
      // ⚑ **Tools** — the answer's SHORT FORM, which is the only durable half (457).
      {
        register: 'observed',
        kind: 'tool-answered',
        count: 1,
        text: '1 call to this app’s own tools came back — the most recent was list_agents answered: sess_child · worker · blocked: schema mismatch.',
        saidBy: null,
      },
      {
        register: 'claimed',
        kind: 'worker-reported',
        count: 1,
        text: `${String(failed)} reported ${pieceLine('W40.3', 'the failed report')} failed — failed report from the night`,
        saidBy: failed,
      },
      {
        register: 'claimed',
        kind: 'worker-reported',
        count: 1,
        text: `${String(blocked)} reported ${pieceLine('W40.2', 'the blocked report')} blocked — blocked report from the night`,
        saidBy: blocked,
      },
      {
        register: 'claimed',
        kind: 'worker-reported',
        count: 1,
        text: `${String(done)} reported ${pieceLine('W40.1', 'the done report')} done — done report from the night`,
        saidBy: done,
      },
    ])
    expect(digest.lines.map((line) => line.text).join('\n')).not.toContain('sess_report_')
    expect(digest.gaps).toEqual([
      {
        kind: 'unverified-outcome',
        count: 3,
        says: '3 outcomes are what a worker reported. Nothing in this app checked one.',
      },
      {
        kind: 'collision-target',
        count: 3,
        says: '3 refusals name the rail and not what it collided with — the target is not recorded anywhere.',
      },
      {
        kind: 'question-without-work',
        // ⚑ The provider's question in `waiting`, and the rumour worker's.
        count: 2,
        says: '2 questions do not say which piece of work it is about.',
      },
      {
        kind: 'open-is-not-waiting',
        // ⚑ The refusals routed above, plus the permission card and the question beside them.
        count: CHANNEL_REFUSALS.length + 2,
        says: `${String(CHANNEL_REFUSALS.length + 2)} requests were raised here and nothing this digest reads ended one. ⚠️ It does not read a conversation stopping, so *open* means no ending in its vocabulary — never that somebody is still waiting.`,
      },
      // 🔴 **475 · the other causes, NAMED rather than omitted** (HO-024 §5.3). ⛔ Fourteen pieces
      // of work were handed out; the three reports, the withdrawal, the never-sent message and
      // (D-016) the restart, whose row now names the pieces it stalled, are the six this card
      // speaks for. The eight left are operations' `W40.4`, `W40.5` and `W40.8` — whose endings
      // are `turn`, `turn` and (D-017 · R10) `replaced_by`, none of which names a piece (D-016c: a
      // stop is no cause, so no `status` row stalls one here) — the four `waiting` handed out and
      // nothing closed, and the rumour worker's, whose brief's turn ended — and (F074) the piece
      // whose turn its provider refused for the usage limit, a `turn` row too — and (F076) the one
      // whose turn failed on a login this Mac moved on from, a `turn` row too — and the one whose
      // turn its provider would not bill, a `turn` row too. ⚑ The count moving when
      // a line is added is the pairing: a fact the card states is not also a fact the card says it
      // cannot state.
      {
        kind: 'work-without-an-ending',
        count: 12,
        says:
          '12 pieces of work were handed out here and nothing this digest reads says what became of one. ' +
          '⚠️ A turn ending, a stop and a conversation replaced because it could not be ' +
          'reopened are what leave work undriven, and none of those rows names a piece of work — so ' +
          'this card can count them and never tell you whose work stopped.',
      },
      // ⚑ **Unreadable** — the torn digest row, and the torn routing planted for the queue.
      {
        kind: 'source-unreadable',
        count: 2,
        says: '2 rows of the record this digest reads could not be read, so part of what happened here is missing from every line above. ⚠️ Nothing records why, and a row this app dropped is a row nothing else here can stand in for.',
      },
    ])
    for (const outcome of TASK_OUTCOMES) {
      expect(digest.lines.some((line) => line.text.includes(`${outcome} report`))).toBe(true)
      expect(store.piecesOwnedBy(`sess_report_${outcome}`)).toEqual([
        expect.objectContaining({ state: 'answered', outcome }),
      ])
    }
    expect(digest.lines.filter((line) => line.kind === 'worker-reported')).toHaveLength(
      TASK_OUTCOMES.length,
    )
    for (const cause of TASK_STALL_CAUSES) {
      expect(store.piecesOwnedBy(`sess_stall_${cause}`)).toEqual([
        expect.objectContaining({ state: 'stalled', stalledBecause: cause }),
      ])
    }
    expect(store.piecesOwnedBy('sess_withdrawn')).toEqual([
      expect.objectContaining({ state: 'withdrawn', outcome: null }),
    ])

    const refusal = digest.lines.find((line) => line.kind === 'tool-refused')
    expect(refusal?.count).toBe(RAIL_PERMANENCES.length)
    expect(refusal?.text).toContain(REFUSAL_CASE[RAIL_PERMANENCES.at(-1)!].rail)
    for (const permanence of RAIL_PERMANENCES.slice(0, -1)) {
      expect(refusal?.text).not.toContain(REFUSAL_CASE[permanence].rail)
    }
    // 🔴 **466 · half of 463's missing Operations sentence is now on the line.** Every permanence
    // in the vocabulary is named, in `PERMANENCE_SAID`'s own words, on the one line that counts
    // the refusals — and the number of refusals is still the count it always was.
    for (const permanence of RAIL_PERMANENCES) {
      expect(refusal?.text).toContain(PERMANENCE_SAID[permanence])
    }
    // ⚑ The paired positive: the withdrawal now names the work, which it never did.
    expect(digest.lines.find((line) => line.kind === 'work-taken-back')?.text).toContain('W40.20')
    // 🔴 **475 · one of the five moved and four did not, and the division is not about cost.**
    // ⛔ `message_never_sent` is the ONLY cause whose event carries an edge to the work — a held
    // message's ending names the message and `work_given` names the same one — so it is the
    // only one a reader of a WINDOW can attribute. ⚠️ The others are written by `turn`, `turn`,
    // `status` and `replaced_by`, and not one of those rows names a piece; which work each stalled
    // is `derivePieces`' answer, reached by folding a whole conversation. ⚑ D-016 · `work_restarted`
    // names its pieces now, and the digest speaks for them.
    expect(digest.lines.find((line) => line.kind === 'work-not-sent')?.text).toContain('W40.7')
    // ⛔ **The cause WORDS are still on no line**, because the digest names the event it watched
    // and never the task-fold's conclusion about it — and `UNDRIVEN_SENTENCES.message_never_sent`
    // asserts a cause two of `abandoned`'s three shapes do not have. See 475's findings.
    const drawnWords = JSON.stringify({ lines: digest.lines, gaps: digest.gaps })
    for (const cause of TASK_STALL_CAUSES) {
      expect(drawnWords).not.toContain(cause)
      expect(drawnWords).not.toContain(UNDRIVEN_SENTENCES[cause])
    }
    expect(digest.lines.find((line) => line.kind === 'decision-raised')?.count).toBe(
      CHANNEL_REFUSALS.length,
    )
    // 🔴 **466 · the negative is now a POSITIVE, which is the finding closed.** 463 asserted
    // that every request reason was lost; each one's own sentence is on the card.
    for (const because of CHANNEL_REFUSALS) {
      expect(drawnWords).toContain(CHANNEL_REFUSAL_SENTENCES[because])
    }
    // ⛔ **Unqualified, and the same spelling `tool_refused` uses.** The ledger holds
    // `brobot__list_agents` on one provider and `mcp__brobot__list_agents` on the other; `317`
    // forbids a provider's name in user-visible text, so neither qualified form may be drawn.
    expect(drawnWords).not.toContain('brobot__')

    // ⚑ **What the read walked** — one window over every agent's conversation, and the two rows
    // it could not read, counted. ⚑ D-016c · one stalled conversation fewer: five causes, not six.
    // ⚑ And one more since `background_stopped`: six causes again, each its own conversation.
    // ⚑ And one more since F074's `provider_limited`: seven. ⚑ And F076's `login_refused`: eight.
    // And `billing_refused`: nine.
    expect(digest.read).toEqual({
      walk: 'one-window-over-every-agents-conversation',
      ledgers: 22,
      rowsUnread: 2,
    })
    // ⚑ **The paired positive**: a window that really did record nothing reads whole and empty —
    // the same host and the same readers, over a stretch this night put nothing in.
    const silent = host.digest(TO, TO + 60_000).digest
    expect(silent).toMatchObject({ sessions: 0, lines: [] })
    expect(silent.read.rowsUnread).toBe(0)

    // Every register is reached from the readers: observed + claimed lines, unknown gaps.
    const registers = new Set<DigestRegister>()
    for (const line of digest.lines) registers.add(line.register)
    if (digest.gaps.length > 0) registers.add('unknown')
    expect([...registers].sort()).toEqual([...DIGEST_REGISTERS].sort())

    const rumour = digest.lines.find((line) => line.kind === 'request-answered')
    expect(rumour).toMatchObject({ register: 'observed', count: 1 })
    // 🔴 **The sentence `465` narrowed, pinned by name in the reading THIS dispatch measured it
    // in.** ⛔ The false clause is asserted absent in both directions — the noun it used to name
    // and the noun a lazy fix would have swapped in — because `463`'s finding says an actorless
    // event must stay actor-unknown rather than acquire a different actor.
    expect(rumour?.text).toBe('1 request was answered. Who answered: 1 · an agent.')
    // ⛔ **`463`'s false sentence is still absent, and so is the noun a lazy fix would have
    // swapped in.** ⚑ *"An agent"* is drawn here because the ROW says so, and the prose shape
    // *"answered by …"* — which read as a claim about a party the row never named — is gone from
    // the vocabulary rather than re-aimed.
    const said = JSON.stringify({ lines: digest.lines, gaps: digest.gaps })
    expect(said).not.toContain('answered by a person')
    expect(said).not.toContain('answered by an agent')
    // ⚠️ **And the absence clause is NOT drawn**, because every answered request in this window
    // records who — `465`'s sentence is scoped to the rows it is true of.
    expect(rumour?.text).not.toContain('Nothing in the ledger records')
    const durableAnswer = store
      .events(agentAnswer.worker)
      .find(
        ({ event }) => event.type === 'user_decision' && event.requestId === agentAnswer.requestId,
      )?.event
    expect(durableAnswer).toEqual({
      type: 'user_decision',
      requestId: agentAnswer.requestId,
      outcome: 'answered',
      // 🔴 **477 · the row this whole part was named for.** ⛔ `463`'s finding was that the
      // worker's question was answered by its own parent agent and *"no row anywhere in this app
      // records that"*. ⚑ This row records it, and it names the PM's conversation — built here
      // from what `give_work`'s caller was, not re-derived from the code under test.
      by: { who: 'an-agent', agent: agentAnswer.pm },
    })
    // ⛔ **The named absence, kept and re-aimed** (standing rule 4): `actor` was the spelling `465`
    // asked about and this row still does not carry it — the field is `by`, and asserting the WHOLE
    // value above is what makes that a measurement rather than a guess at a name.
    expect(durableAnswer).not.toHaveProperty('actor')

    // ── Second read: the one queue, from both readers ────────────────────────────────────────
    readingOrder.push('queue')
    const questions = host.questionsForAPerson()
    const decisions = host.decisionsForAPerson()
    const queue = personsQueueView(questions, decisions, {
      held: new Set(),
      answerable: new Map(),
      now: TO,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    })
    if (queue === null) throw new Error('the queue did not answer')

    expect(questions.rows).toHaveLength(2)
    expect(decisions.rows.map((one) => one.request.went.because).sort()).toEqual(
      [...CHANNEL_REFUSALS].sort(),
    )
    expect(queue.rows).toHaveLength(2 + CHANNEL_REFUSALS.length)
    expect(new Set(queue.rows.map((row) => row.kind))).toEqual(
      new Set<PersonsQueueKind>(['a-question', 'a-decision']),
    )
    expect(queue.rowsDropped).toBe(true)
    expect(queue.mayBeShort).toBe(true)
    expect(questions.rowsUnread).toBe(1)
    expect(decisions.rowsUnread).toBe(1)

    const takenOver: PersonsQueueRow[] = []
    const settled: { readonly row: PersonsQueueRow; readonly answer: AttentionDecision }[] = []
    const sharedQueue = usePersonsQueue()
    const initialWorld = {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now: TO,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    }
    sharedQueue.supply(questions, decisions, initialWorld, {
      travel: () => {},
      takeOver: (row) => takenOver.push(row),
      // ⚑ **557 · a door this fixture does not exercise** — the stalled-work band has its own suite.
      open: () => {},
      settle: (row, answer) => {
        settled.push({ row, answer })
        at(row.sessionId, TO - 20, {
          type: 'user_decision',
          requestId: row.requestId,
          outcome:
            answer.kind === 'permission'
              ? answer.decision.outcome
              : answer.kind === 'reject'
                ? 'rejected'
                : 'answered',
        })
      },
    })
    const shortQueueHtml = await renderQueue()
    expect(shortQueueHtml).toContain('data-cy="persons-queue-rows-dropped"')
    expect(shortQueueHtml).toContain('something waiting on you may be missing')

    const times = queue.rows
      .map((row) => row.blockedSince)
      .filter((at): at is number => at !== null)
    expect(times).toEqual([...times].sort((left, right) => left - right))
    // The ordinary spawned/unowned shape exposes weak point 2: take over, THEN answer.
    const rowsOfKind = (kind: PersonsQueueKind) => queue.rows.filter((row) => row.kind === kind)
    expect(rowsOfKind('a-decision')).toHaveLength(CHANNEL_REFUSALS.length)
    expect(rowsOfKind('a-decision').every((row) => row.noAnswerHere === 'not-yours-yet')).toBe(true)
    // ⚑ **D-017 · R6 — no row draws the queue's answers before the take-over**, and the question THIS
    // APP raised (`req_exact`) is answered whoever holds the asker — the host finds it in the asker's
    // ledger and admits a person by whom it was asked of — ⚑ **UI-009 · on its own card**, which
    // carries its offer now.
    expect(queue.rows.every((row) => row.answers.length === 0)).toBe(true)
    expect(
      queue.rows.find((row) => row.requestId === 'req_exact')?.question?.offered?.options,
    ).toEqual(['Postgres', 'SQLite'])

    // Weak point 2, first act: the largest population offers takeover, not an answer.
    const decisionBefore = rowsOfKind('a-decision').find(
      (row) => row.requestId === 'req_decision_0',
    )
    if (decisionBefore === undefined) throw new Error('the permission decision is absent')
    sharedQueue.takeOver(decisionBefore)
    expect(takenOver.map((row) => row.key)).toEqual([decisionBefore.key])
    expect(
      sharedQueue.view.value?.rows.find((row) => row.key === decisionBefore.key)?.answers,
    ).toEqual([])

    // Second act: after takeover, the live cards are the sole source of the answers on the rows.
    const live = attentionQueue(
      [
        recordFromHistory('sess_waiting_provider_question'),
        recordFromHistory('sess_waiting_decisions'),
      ],
      () => 'waiting on you',
    )
    expect(new Set(live.map((row) => row.kind))).toEqual(
      new Set<AttentionRequest['kind']>(['question', 'permission']),
    )
    const liveWorld = {
      ...initialWorld,
      held: new Set(live.map((row) => row.sessionId)),
      answerable: new Map(live.map((row) => [row.key, row])),
    }
    sharedQueue.supply(questions, decisions, liveWorld, {
      travel: () => {},
      takeOver: (row) => takenOver.push(row),
      // ⚑ **557 · a door this fixture does not exercise** — the stalled-work band has its own suite.
      open: () => {},
      settle: (row, answer) => {
        settled.push({ row, answer })
        at(row.sessionId, TO - 20, {
          type: 'user_decision',
          requestId: row.requestId,
          outcome:
            answer.kind === 'permission'
              ? answer.decision.outcome
              : answer.kind === 'reject'
                ? 'rejected'
                : 'answered',
        })
      },
    })

    // Criterion 20, on one actual row of every kind after the takeover/resupply join.
    const answerableView = sharedQueue.view.value
    if (answerableView === null) throw new Error('the answerable queue did not render')
    const representative = {
      'a-question': answerableView.rows.find((row) => row.requestId === 'req_provider'),
      'a-decision': answerableView.rows.find((row) => row.requestId === 'req_decision_0'),
    } as const satisfies Readonly<Record<PersonsQueueKind, PersonsQueueRow | undefined>>
    // ⚑ **734 · the control's premise**: the parent has no identity, and the askers each have one.
    expect(store.identityOf('sess_waiting_parent')).toBeNull()
    for (const kind of ['a-question', 'a-decision'] as const) {
      expect(store.identityOf(CRITERION_20[kind].sessionId), kind).not.toBeNull()
    }
    for (const kind of ['a-question', 'a-decision'] as const) {
      const row = representative[kind]
      const expected = CRITERION_20[kind]
      expect(row?.sessionId).toBe(expected.sessionId)
      // 🔴 **734 · a conversation with an agent is named by it** (R41, `732` F-1) — the name this
      // app gave the identity, read off the roster. ⚑ One with NO agent keeps what it read before:
      // the question's hand-planted parent, which has no folder either, so its id (the control).
      const drawnAs = (id: string): string => {
        if (id === 'you') return id
        const identity = store.identityOf(id)
        return identity === null ? id : agentName(identity.profileSlug, store.agentIdentities())
      }
      expect(row?.chain.map(({ name }) => name)).toEqual(expected.chain.map(drawnAs))
      expect(row?.chain.map(({ you }) => you)).toEqual(expected.chain.map((name) => name === 'you'))
      // This is exact open-work CONTEXT, not an asserted request→task edge; the negative below is
      // the distinction criterion 20 needs the rehearsal to preserve.
      // ⚑ D-016 · the asker's ROOT first — the work a person gave it — then its open pieces.
      const root = store.rootOf(expected.sessionId)
      expect(root, kind).not.toBeNull()
      expect(row?.work).toEqual([{ label: root?.label }, ...expected.work])
      expect(row?.noAnswerHere).toBeNull()
      expect(row?.answers.map(whatThisAnswerDoes)).toEqual(expected.effects)
    }

    // None of the representative request event families carries a task edge. Their one task
    // only makes the all-open-work context look exact; it cannot establish what the request is about.
    const representativeRequestTypes = new Set([
      'user_input_request',
      'permission_request',
      'request_routed',
    ])
    for (const { sessionId } of Object.values(CRITERION_20)) {
      const requestEvents = store
        .events(sessionId)
        .map(({ event }) => event)
        .filter((event) => representativeRequestTypes.has(event.type))
      expect(requestEvents.length).toBeGreaterThan(0)
      expect(requestEvents.some((event) => 'piece' in event)).toBe(false)
    }

    const exact = questions.rows.find((row) => row.request.requestId === 'req_exact')
    const exactAsk = store
      .events('sess_waiting_question')
      .map(({ event }) => event)
      .find((event) => event.type === 'question_asked' && event.requestId === 'req_exact')
    expect(exactAsk?.type === 'question_asked' ? exactAsk.piece : undefined).toBe('work_exact')
    // ⛔ The reader discards that edge and returns its root and both open pieces, so the UI says
    // it is unrecorded.
    expect(exact?.work.map((work) => work.label)).toEqual([
      store.rootOf('sess_waiting_question')?.label,
      'W40.11',
      'W40.12',
    ])
    const answerableHtml = await renderQueue()
    expect(answerableHtml).toMatch(/W40\.11(?!\d)/)
    // ⚑ **UI-009 (F052) · the question's card names the piece it is about and not the asker's other
    // open work** — *"that conversation is working on …"* was one of the sentences that explained
    // the machinery.
    expect(answerableHtml).not.toMatch(/W40\.12(?!\d)/)
    expect(answerableHtml).toContain('which of it this is about is not recorded')
    // ⚑ **UI-009 · the effect under each answer is a decision's** — on a question the label is the
    // answer, and *"the agent is given … as the answer"* said it twice.
    for (const effect of CRITERION_20['a-decision'].effects) {
      expect(answerableHtml).toContain(effect)
    }
    for (const effect of CRITERION_20['a-question'].effects) {
      expect(answerableHtml).not.toContain(effect)
    }
    expect(answerableHtml).toContain(WHAT_COMES_AFTER_IS_NOT_OURS)
    // ── Only now attempt the transcripts forced by missing digest sentences ─────────────────
    // ⛔ The digest has no transcript action. These ids are known only because this is the fixture;
    // the manual lookup itself is a result, not a successful digest navigation path.
    //
    // 🔴 **480 · three of these five are no longer FORCED, and the reads are kept anyway.** Tools,
    // unreadable and rumour are answered on the card above — asserted there — so what these
    // reads now record is what a transcript ADDS to a digest that already spoke, which is the only
    // way to tell a closed finding from one that merely moved. ⚠️ There is still no route from the
    // digest to any of them; this fixture knows the ids only because it planted them.
    const transcriptQuestions = [
      {
        part: 'operations',
        question: 'Which refusal permanence and which task-ending cause applied?',
        sessions: [
          'sess_refusals',
          ...TASK_STALL_CAUSES.map((cause) => `sess_stall_${cause}`),
          'sess_withdrawn',
        ],
      },
      {
        part: 'waiting',
        question: 'Which five person-only request kinds and exact task were involved?',
        sessions: ['sess_waiting_decisions', 'sess_waiting_question'],
      },
      {
        part: 'tools',
        question: 'What prose did the Codex list_agents tool answer, and what was structured?',
        sessions: ['sess_tool_answer'],
      },
      {
        part: 'unreadable',
        question: 'What happened in the digest row that could not be parsed?',
        sessions: ['sess_unreadable'],
      },
      {
        part: 'rumour',
        question:
          'Which exact conversation answered it, beyond the actor kind the grouped digest names?',
        sessions: [agentAnswer.worker],
      },
    ]
    const transcripts = new Map<string, Awaited<ReturnType<typeof readTranscript>>>()
    for (const forced of transcriptQuestions) {
      expect(forced.question.length).toBeGreaterThan(0)
      for (const sessionId of forced.sessions) {
        readingOrder.push(`manual-transcript:${sessionId}`)
        const read = await readTranscript(sessionId)
        transcripts.set(sessionId, read)
      }
    }
    expect(readingOrder.slice(0, 2)).toEqual(['digest', 'queue'])
    expect(readingOrder.slice(2).every((one) => one.startsWith('manual-transcript:'))).toBe(true)
    expect(transcripts.get('sess_refusals')?.history.entries).toHaveLength(RAIL_PERMANENCES.length)
    expect(transcripts.get('sess_refusals')?.html).toContain(
      // ⚑ **628 · LOOKED UP, for `627`'s reason one clause over** (`HO-096` §2.4). ⛔ This line
      // survived `627`'s sweep because it names a different rail; `HO-095` §3.4 then moved the
      // clause it spelled, and a second literal is a second place for the same fact to go stale.
      `no-such-profile · ${PERMANENCE_SAID.permanent}`,
    )
    expect(transcripts.get('sess_refusals')?.html).toContain(
      'spawning-disabled · until somebody changes it',
    )
    expect(transcripts.get('sess_refusals')?.html).toContain(
      `summary-too-long · ${PERMANENCE_SAID['while-this-holds']}`,
    )
    expect(transcripts.get('sess_stall_turn_ended')?.html).toContain('turn failed')
    expect(transcripts.get('sess_stall_turn_interrupted')?.html).toContain('turn interrupted')
    expect(transcripts.get('sess_stall_message_never_sent')?.html).toContain('not sent')
    // These endings are durable and still transcript-silent, so even manual lookup only partly
    // answers the operations question. ⚑ D-016 · a taking back is one of them: `work_taken_back`
    // draws nothing, and what the owner is told is the notice turn the host sends, not this row.
    for (const id of ['sess_stall_app_restarted', 'sess_withdrawn']) {
      expect(transcripts.get(id)?.history.entries.length).toBeGreaterThan(0)
      expect(transcripts.get(id)?.html).toContain('data-cy="transcript-empty"')
    }
    const decisionTranscript = transcripts.get('sess_waiting_decisions')
    expect(
      decisionTranscript?.history.entries.filter(
        ({ event }) => event.type === 'request_routed' && event.to === 'a-person',
      ),
    ).toHaveLength(CHANNEL_REFUSALS.length)
    for (const because of CHANNEL_REFUSALS) {
      expect(
        decisionTranscript?.history.entries.some(
          ({ event }) =>
            event.type === 'request_routed' && event.to === 'a-person' && event.because === because,
        ),
      ).toBe(true)
      expect(decisionTranscript?.html).not.toContain(because)
    }
    // ⛔ **The summary is what this app KEEPS, and the item is where it is kept** (587). The tool
    // row's receipt used to be in the rendered HTML with `display: none` over it; a collapsed run
    // renders one panel at a time and does not render a closed one at all.
    const answered = transcripts.get('sess_tool_answer')
    expect(
      answered?.items.some(
        (item) => item.kind === 'tool' && item.result?.summary.includes('blocked: schema mismatch'),
      ),
      'the summary is no longer carried on the row at all',
    ).toBe(true)
    // ⚠️ **And the row is on screen** — a run that drew nothing would pass the line above and hide
    // the whole call from a reader.
    expect(answered?.html).toContain('data-cy="tool-run"')
    expect(answered?.html).toContain('list_agents')
    expect(
      transcripts
        .get('sess_tool_answer')
        ?.history.entries.some(({ event }) => 'structured' in event),
    ).toBe(false)
    // The exact edge exists in the handed history and is still absent from the normal transcript.
    expect(
      transcripts
        .get('sess_waiting_question')
        ?.history.entries.some(
          ({ event }) => event.type === 'question_asked' && event.piece === 'work_exact',
        ),
    ).toBe(true)
    expect(transcripts.get('sess_waiting_question')?.html).not.toContain('work_exact')
    expect(transcripts.get('sess_unreadable')?.history.entries).toEqual([])
    expect(transcripts.get('sess_unreadable')?.html).toContain('data-cy="transcript-empty"')
    expect(
      transcripts
        .get(agentAnswer.worker)
        ?.history.entries.some(({ event }) => event.type === 'user_decision'),
    ).toBe(true)
    // ⚑ **D-016 · the worker's brief is a turn now, and the double ECHOES what it was handed** —
    // D-011's direction line, which names the giver's conversation: by the piece it owns since
    // D-016 · commit 7 (R3), and by its id only when it holds none. Those are the provider's own
    // words, not a row this app draws about who answered: every place the page names the PM is
    // inside them, and nothing else on it does — by its work or by its id.
    const rumourRead = transcripts.get(agentAnswer.worker)
    const pmNamed = store.workThatNames(agentAnswer.pm)
    expect(pmNamed, 'the premise: the PM owns work that names it').not.toBeNull()
    const byItsWork = theOwnerOf(pmNamed!)
    const naming = (text: string, name: string): number => text.split(name).length - 1
    const echoed = (name: string): number =>
      (rumourRead?.items ?? []).reduce(
        (sum, item) => sum + (item.kind === 'assistant' ? naming(item.text, name) : 0),
        0,
      )
    expect(echoed(byItsWork), 'the premise: the double echoed the framed brief').toBeGreaterThan(0)
    // Work-label buttons split the markup, not the words a person reads.
    const renderedText = (html: string): string => html.replace(/<[^>]*>/g, '')
    expect(renderedText('the owner of <button>W2</button>')).toBe('the owner of W2')
    expect(rumourRead?.html).toContain('data-brocrew-target="W2"')
    for (const name of [byItsWork, agentAnswer.pm]) {
      expect(naming(renderedText(rumourRead?.html ?? ''), name), name).toBe(echoed(name))
    }

    // Weak point 1: press the pure queue seam on one real derived row of every kind. The injected
    // door writes the same durable ENDINGS, so this measures reader/projection refolds and the
    // pressed surface's lag. It deliberately does NOT claim to exercise RuntimeScreen's IPC door.
    const pressed = Object.values(representative).filter(
      (row): row is PersonsQueueRow => row !== undefined,
    )
    for (const row of pressed) sharedQueue.settle(row, row.answers[0]!)
    expect(settled.map(({ row }) => row.key)).toEqual(pressed.map((row) => row.key))
    const closedKeys = new Set(pressed.map((row) => row.key))
    const sourceAfterPress = personsQueueView(
      host.questionsForAPerson(),
      host.decisionsForAPerson(),
      liveWorld,
    )
    expect(sourceAfterPress?.rows.some((row) => closedKeys.has(row.key))).toBe(false)
    const liveAfterPress = attentionQueue(
      [
        recordFromHistory('sess_waiting_provider_question'),
        recordFromHistory('sess_waiting_decisions'),
      ],
      () => 'waiting on you',
    )
    expect(liveAfterPress.some((row) => closedKeys.has(row.key))).toBe(false)
    // The surface that was pressed still holds the old read until the next look supplies it.
    expect(sharedQueue.view.value?.rows.filter((row) => closedKeys.has(row.key))).toHaveLength(
      pressed.length,
    )
    expect(LOOK_EVERY_MS).toBe(5_000)
    const afterQuestions = host.questionsForAPerson()
    const afterDecisions = host.decisionsForAPerson()
    sharedQueue.supply(afterQuestions, afterDecisions, liveWorld, {
      travel: () => {},
      takeOver: () => {},
      open: () => {},
      settle: () => {},
    })
    expect(sharedQueue.view.value?.rows.some((row) => closedKeys.has(row.key))).toBe(false)

    // Finish the remaining synthetic cards through their one durable ending, then refold all lists.
    for (const row of sharedQueue.view.value?.rows ?? []) {
      at(row.sessionId, TO - 10, {
        type: 'user_decision',
        requestId: row.requestId,
        outcome: row.kind === 'a-question' ? 'answered' : 'deny',
      })
    }
    const fresh = personsQueueView(
      host.questionsForAPerson(),
      host.decisionsForAPerson(),
      initialWorld,
    )
    expect(fresh?.rows).toEqual([])
    // The torn row remains real even after every readable obligation has ended.
    expect(fresh?.rowsDropped).toBe(true)
    expect(
      homeAttention({
        requests: [],
        onlyYou: fresh?.count ?? 0,
        unread: fresh?.mayBeShort ?? true,
      }),
    ).toMatchObject({ total: 0, unread: true, quiet: false, stat: 'Not known' })

    // 🔴 **Weak point 3, isolated — `468` closed it, and D-016 took its subject away** (the demo
    // seed's placeholder rows). ⚑ What stays is the rule under it: nothing waiting is quiet…
    const quiet = homeAttention({ requests: [], onlyYou: 0, unread: false })
    const unreadOnly = homeAttention({ requests: [], onlyYou: 0, unread: true })
    expect(quiet.quiet).toBe(true)
    // ⚠️ **…and a hole in a READ still forbids it** — `086`'s rule is about not knowing.
    expect(unreadOnly.total).toBe(0)
    expect(unreadOnly.quiet).toBe(false)
  })

  it('⛔ the public digest type refuses BOTH rumours now, not just the one the helper stopped', () => {
    // ⚑ **`438`'s half, unchanged** — a claim with no speaker is a rumour and this signature is
    // what stops one being built.
    const helperStopsRumour = (): DigestLine => {
      // @ts-expect-error — the safe helper requires the speaker this rumour omits.
      return claimedLine('stopped-by-helper', 'worker-reported', FROM, 'the work passed')
    }
    expect(helperStopsRumour).toBeTypeOf('function')
    // 🔴 **`465`'s half, and TypeScript compiling this file is the measurement.** ⛔ This dispatch
    // found it going the other way: `observedLine` took ANY line kind, so an agent's own
    // declaration could be built as something the engine watched, and the window drew it.
    const observedRumour = (): DigestLine =>
      observedLine(
        'rumour',
        // @ts-expect-error — `worker-reported` declares only `claimed` in `LINE_REGISTERS`.
        'worker-reported',
        1,
        FROM,
        'worker-a finished #7 and every test passed',
      )
    expect(observedRumour).toBeTypeOf('function')

    // ⛔ **And the interface is a discriminated union now**, so a claimed line with no speaker is
    // not a value an object literal can spell either.
    const speakerless = (): DigestLine => {
      // @ts-expect-error — `ClaimedLine.saidBy` is a required string, not `string | null`.
      const line: DigestLine = {
        id: 'speakerless',
        register: 'claimed',
        kind: 'worker-reported',
        count: 1,
        text: 'the work passed',
        at: FROM,
        saidBy: null,
      }
      return line
    }
    expect(speakerless).toBeTypeOf('function')

    // ⚠️ **The positive controls, because three refusals prove nothing without them** — both legal
    // constructions still compile, still draw, and still disagree about `saidBy` in the one
    // direction that matters.
    const observed = observedLine('observed:turn-ended', 'turn-ended', 4, FROM, '4 turns ended.')
    const claimed = claimedLine(
      'claim:a:1',
      'worker-reported',
      FROM,
      'dev reported W1.1 done',
      'dev',
    )
    expect(Object.hasOwn(REGISTER_WORDS, observed.register)).toBe(true)
    expect(Object.hasOwn(REGISTER_WORDS, claimed.register)).toBe(true)
    expect(observed.saidBy).toBeNull()
    expect(claimed.saidBy).toBe('dev')
  })

  /**
   * 🔴 **`463` F2, fixed in `474` — and this is the case that recorded it.**
   *
   * ⛔ **It used to assert `collided.gaps` was EMPTY**, which is what the defect produced: the fold
   * keyed `routed`, `travelled`, `ended` and `questionsNamingWork` on a bare request id while
   * reading every conversation in one window, so conversation B's answer closed conversation A's
   * request and B's `question_asked` named A's work. ⚠️ **Two honest gaps disappeared**, and the
   * digest is the surface whose whole job is to say what it could not account for.
   *
   * ⚑ **`same-provider-id` is not a contrivance.** Codex's request ids are JSON-RPC ids —
   * `requestKey` renders the first server request of every connection as `number:1` — so two Codex
   * conversations blocked on their first question collide by construction, and Claude's `toolUseID`
   * is *"unique per tool call and scoped to the turn that raised them"*.
   *
   * ⛔ **The control below is the same shape with two DIFFERENT ids**, and it is what makes this a
   * measurement: the collided pair and the control must now produce the same two gaps, and before
   * `474` they produced two different answers from the same facts.
   */
  it('🔴 474 · correlates request facts by conversation AND id, so neither pair hides a gap', () => {
    for (const id of ['sess_collision_a', 'sess_collision_b']) conversation(id)
    at('sess_collision_a', FROM + 10, {
      type: 'request_routed',
      requestId: 'same-provider-id',
      to: 'the-parent',
      parent: 'sess_parent_a',
    })
    at('sess_collision_b', FROM + 11, {
      type: 'question_asked',
      requestId: 'same-provider-id',
      piece: 'work_b',
      prompt: 'named work',
      questions: [{ id: 'answer', prompt: 'named work', options: [] }],
    })
    at('sess_collision_b', FROM + 12, {
      type: 'request_routed',
      requestId: 'same-provider-id',
      to: 'the-parent',
      parent: 'sess_parent_b',
    })
    at('sess_collision_b', FROM + 13, {
      type: 'user_decision',
      requestId: 'same-provider-id',
      outcome: 'answered',
    })
    // ⚑ **D-016 · one window over every conversation**, so the pair and the control are read in
    // two windows that do not overlap — the pair's rows sit before `FROM + 15`, the control's after.
    const collided = distil(store.digestWindow(FROM, FROM + 15), (id) => id)
    // ⛔ **A's routing is unanswered and A's question named no work** — both true, both drawn, and
    // both invisible while B's rows were filed under the same key.
    expect(collided.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'question-without-work', count: 1 }),
        expect.objectContaining({ kind: 'open-is-not-waiting', count: 1 }),
      ]),
    )

    for (const id of ['sess_control_a', 'sess_control_b']) conversation(id)
    at('sess_control_a', FROM + 20, {
      type: 'request_routed',
      requestId: 'id-a',
      to: 'the-parent',
      parent: 'sess_parent_a',
    })
    at('sess_control_b', FROM + 21, {
      type: 'question_asked',
      requestId: 'id-b',
      piece: 'work_b',
      prompt: 'named work',
      questions: [{ id: 'answer', prompt: 'named work', options: [] }],
    })
    at('sess_control_b', FROM + 22, {
      type: 'request_routed',
      requestId: 'id-b',
      to: 'the-parent',
      parent: 'sess_parent_b',
    })
    at('sess_control_b', FROM + 23, {
      type: 'user_decision',
      requestId: 'id-b',
      outcome: 'answered',
    })
    const control = distil(store.digestWindow(FROM + 15, TO), (id) => id)
    expect(control.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'question-without-work', count: 1 }),
        expect.objectContaining({ kind: 'open-is-not-waiting', count: 1 }),
      ]),
    )
    // 🔴 **The comparison, where the two readings USED to diverge** (standing rule 3). ⛔ One pair
    // shares an id and one does not; every other fact about them is identical, so the two answers
    // must be identical too — and a fold that went back to a bare id fails here and nowhere else.
    const said = (one: { gaps: readonly { kind: string; count: number }[] }): string =>
      [...one.gaps]
        .map((gap) => `${gap.kind}:${String(gap.count)}`)
        .sort()
        .join('|')
    expect(said(collided)).toBe(said(control))
  })
})
