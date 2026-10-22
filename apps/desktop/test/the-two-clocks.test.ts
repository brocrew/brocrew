import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CHAIN_HOP_LIMIT,
  REQUEST_IS_OPEN,
  chainSentence,
  deriveRoutedRequests,
  escalationChain,
} from '../src/shared/questions'
import type { RoutedRequest } from '../src/shared/questions'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **398 · the two clocks, and 612 removed the second** — HO-007 criterion **11**, and the record
 * of BOTH withdrawals.
 *
 * ## ⛔ The count in the name is HISTORY, and it is exact
 *
 * ⚠️ **`612` · the PM's relay caught this file claiming a count it no longer holds** — the defect
 * `a-title-that-names-a-count-the-assertion-never-checks`, which `396` paid for by saying *"a
 * seventh"* over six. ⛔ **There are ZERO clocks in this app now.**
 *
 * ⚑ **The name is kept because both clocks are what this file is the record OF.** `398` shipped
 * two: an idle timeout on a working child, and an escalation deadline on an unanswered question.
 * `HO-018` §2.2 withdrew the first at `400`; `HO-088` §3.1 withdrew the second at `612`. 🔴 **The
 * sections below are the evidence for each withdrawal**, which is a truer subject than either clock
 * ever was — and why this reads as a title rather than as a count of anything live.
 *
 * ## ⛔ It shipped two clocks and HO-018 §2.2 withdrew one of them
 *
 * **HO-007 S4:** *"Unanswered past a timeout, it escalates to the human… The chain is visible end to
 * end — worker waiting on PM, PM waiting on you."* ⚑ `394` routed the questions and `396` gave a
 * parent a reader for them; nothing ever ran out of patience on one until this dispatch.
 *
 * ⛔ **The other clock was criterion 5 — an idle timeout on a WORKING child — and the PO took it
 * back:** *"an idle timeout on a working child is the guess, and your measurement says we cannot
 * pick the number honestly."* ⚠️ **`400` ran the 26 assertions that asserted its state change RED
 * and then removed them**, which is the whole of why this file is half the length it was; what is
 * left is criterion 11's evidence, unchanged.
 *
 * ⚑ **The difference between the two, stated because it is the reason one of them survived.** A
 * question's age is a fact about a row nobody closed. A working child's silence is an ABSENCE of
 * rows, and the number that turns an absence into a verdict is the guess `396` §4 warned about —
 * `353` measured a known-successful compaction silent for 90,829 ms against a maximum of 7,058 ms in
 * the same run.
 *
 * ## ⛔ A deadline was not a timer — and now there is neither
 *
 * ⚑ **The argument this file was built on:** after `app.quit()` no timer, interval or worker in the
 * process runs again, so a window held in memory silently resets every deadline in the app —
 * therefore the deadline was `the row + the window`, stamped at the moment it FELL DUE rather than
 * the moment the app noticed.
 *
 * 🔴 **612 · that argument won and then lost its subject** (HO-088 §3.1). ⛔ **It made the deadline
 * survivable across a crash, which was exactly what made it a CLOCK DECIDING THAT A PARENT FAILED**
 * — durable, unattended, and about something the app never observed. ⚠️ **§2 is now the measurement
 * that there is no decider at all**, by name over four pieces with controls that fire: the argument
 * is kept because the shape it warns about is the shape a replacement would take.
 *
 * ## ⚠️ Where 398's brief was wrong — the long version is in that dispatch's response
 *
 *  - **its §3's table was TWO vocabularies printed as one.** `silent` was a `TaskState`; `stranded`
 *    and `interrupted` are `RequestState`s. *"Do not add a sixth"* had no single referent.
 *  - **it said thirteen criteria were covered.** HO-018 then found three of them specified a
 *    mechanism rather than a property, and amended all three.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
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

/** `394`'s double, with the handles kept — a test has to BE the provider to ask like one. */
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

/**
 * ⛔ **612 · a SPAN THIS SUITE ADVANCES BY, and no longer a window anything reads** (HO-088 §3.1).
 *
 * ⚑ **It said:** *"the window this suite runs at, and it is SHORT on purpose (398 §6) — the only
 * honest way to have a short timeout is for the production path to read the same value a test
 * writes, see §9 for the assertion that it does."* ⚠️ **§9 no longer asserts that**, because there
 * is no production path and no `escalationWindowMs` to inject.
 *
 * 🔴 **What it is for now**: the two tests that advance time keep a NAMED span rather than a bare
 * multiple, so *five of the window this app used to have* stays legible as the thing being waited
 * out. ⛔ **Nothing reads it but this file**, which is the whole claim it can still support.
 */
const ESCALATE_WINDOW = 3_000

describe('398 · 612 · the two clocks this app had, and the nothing that replaced them', () => {
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
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (
    over: SessionStore = store,
    // ⚑ **612 · `escalate` stood here and is GONE with the deadline** (HO-088 §3.1), and `616`
    // took `proposal` with the hold (HO-093 §2). ⚠️ **There is no window of this kind left to
    // inject**, so the parameter is gone rather than left empty — see §9, which no longer has a
    // sign guard to re-aim.
  ): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-clocks-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-clocks-root-'))
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
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** Move the wall clock forward without pretending anything happened. */
  const waitOutMs = (ms: number): void => {
    clock += ms
  }

  /**
   * 🔴 **612 · `lookForEscalations` stood here and is GONE with the deadline** (HO-088 §3.1).
   *
   * ⛔ **It drove `store.escalationsDue` and wrote what it named through the host's own door.**
   * ⚑ **There is no sweep**, so every test that used it performs the ACT instead: a parent that
   * will not answer calls `pass_question_up` (`611`, HO-088 §3.2) and the question reaches the
   * person carrying the ORIGINAL words.
   *
   * ⚠️ **It answers the PASSER's new request id**, because that is the row a person's queue holds.
   */
  const thePmPassesItUp = async (pm: string, questionId: string): Promise<string> => {
    const passed = await callOn(agentToolsFor(host, pm), 'pass_question_up', {
      question: questionId,
      who_answers: 'a-person',
    })
    expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    return passed.question as string
  }

  // ⛔ **612 · `liveIn` and `writeThrough` stood here and are GONE** (HO-088 §3.1).
  //
  // ⚑ **They were a pair and they went as one.** `liveIn` answered *which sessions may a store-side
  // decision be written into* — the `consider` predicate `escalationsDue` took — and `writeThrough`
  // reached through `publishOurs` so the row carried the ordinal the host would have used: *"a test
  // that appended straight to the store would pass while shipping the collision."*
  //
  // ⚠️ **That split existed because ORDINALS HAVE AN OWNER and a deadline did not.** The store
  // decided and the host wrote. 🔴 **Since `612` there is no decision to write**: every row about a
  // question is appended by the tool call that raised or passed it, through the host's own door,
  // with the ordinal it already owns — so nothing in this file needs to forge one.

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    provider: Provider = 'claude',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  // ⚑ On the provider its conversations will run on: an agent keeps the one it first ran on.
  const bringIdentityIntoBeing = async (
    profileId: string,
    provider: Provider = 'claude',
  ): Promise<void> => {
    const id = await personOpens(profileId, host, provider)
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

  const ledger = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const events = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is a give**, and its brief is the child's first turn — which parks on the
   * Fake's permission card, since the PM is in `ask` and a give runs in its giver's mode. ⚠️ So the
   * child's routed requests hold that card too, and a test reads its QUESTION by its id.
   */
  const aPmAndItsWorker = async (
    provider: Provider = 'claude',
    on: RuntimeHost = host,
  ): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    for (const one of [workerProfile, `${workerProfile}-b`])
      await bringIdentityIntoBeing(one, provider)
    const pm = await personOpens(pmProfile, on, provider)
    const pmTools = agentToolsFor(on, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, pmProfile, worker: given.agent as string, pmTools, workerHandle: latestHandle() }
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const filesUnder = (dir: string): { path: string; text: string }[] => {
    const out: { path: string; text: string }[] = []
    const walk = (at: string, prefix: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, entry.name)
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
        else if (entry.name.endsWith('.ts')) {
          out.push({ path: `${prefix}${entry.name}`, text: readFileSync(full, 'utf8') })
        }
      }
    }
    walk(dir, '')
    return out
  }

  // ⛔ **612 · `aChildAsksItsParent` stood here and is GONE** (HO-088 §3.1). ⚑ It built *"a child
  // that has asked its parent something and is waiting on the answer"*, and it had exactly ONE
  // caller: §9's *the STORE refuses a zero window too, because a hatch one enforcer honours is a
  // hatch*. ⚠️ **That test went with the store's guard**, which went with the sweep that read it —
  // `398 M16` is retired by this dispatch for the same reason and names it.
  //
  // 🔴 **The STATE it built is still reached, in eight tests, inline.** It is not a helper this
  // file stopped needing; it is a helper whose one caller named the removed enforcer, and the
  // places that build the state now do so beside the ACT they are about.

  // ⛔ **612 · `escalatedIds` stood here and is GONE** (HO-088 §3.1). ⚑ It listed *which of a
  // conversation's questions have been escalated, in ledger order*, and the answer is now NONE for
  // every conversation this app will ever write. ⚠️ **The negative is asserted inline where it
  // belongs** — `events(worker).filter(…'request_escalated')` toEqual `[]`, beside the act that
  // reaches the person — rather than through a helper whose name promises a population.

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · 612 · nothing passes while nothing is running, because nothing is waiting to
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · there is no decider, and a launch had nothing to sweep even when there was', () => {
    it('🔴 a question CANNOT survive a launch, which is why there is no launch sweep for it', async () => {
      // ⛔ **The measurement that justifies an absence.** `396`'s `settleStrandedRequests` closes
      // EVERY open routed request at every launch — the provider holding it is gone — so by the time
      // a launch could ask *"has anybody failed to answer this in time?"* there is nothing open to
      // ask it about. ⚑ Shipping a launch sweep anyway would be an option with no acceptance case,
      // and the one record it could ever write would name a person who could not have answered.
      const { worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )

      // A crash, and five windows pass with nothing running.
      waitOutMs(ESCALATE_WINDOW * 5)
      buildHost(createSessionStore(db, tick))

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      // ⛔ **`stranded`, not `open` and not escalated** — the launch wrote the ending, and there was
      // never a window in which an escalation would have meant anything.
      expect(row?.state).toBe('stranded')
      expect(REQUEST_IS_OPEN[row?.state ?? 'open']).toBe(false)
      expect(row?.escalatedAt).toBeNull()
      // ⚑ **612 · and there is nothing left to ask** (HO-088 §3.1). This line read
      // `expect(store.escalationsDue(clock, 1, () => true)).toEqual([])`; the decision function is
      // gone, so the absence is asserted where absences belong — §2's second test, over the source.
    })

    /**
     * 🔴 **612 · THERE IS NO DECIDER** (HO-088 §3.1) — and this is where that is measured.
     *
     * ⛔ **It asserted *nothing in the decider reaches a clock of its own***: a decider that read
     * `Date.now()` would have looked right in every test above, because the clock is injected, and
     * would have been wrong in the one case that mattered. ⚑ **The whole decider went**, so the
     * claim inverts and gets stronger: nothing in this app decides that a question has run out of
     * time, and nothing writes the row that would say so.
     *
     * ⚠️ **Asserted by NAME over the four pieces** (standing rule 4's search shape: a negative
     * names what it could have found), each with a control that fires.
     */
    it('⛔ 612 · nothing in this app decides a question has run out of time', () => {
      const store_ = codeOnly(sourceOf(join(mainRoot, 'db'), 'session-store.ts'))
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const questions_ = codeOnly(sourceOf(sharedRoot, 'questions.ts'))

      // ⛔ **The decision** — the store no longer computes a deadline or builds the row.
      expect(store_).not.toContain('escalationsDue')
      expect(store_).not.toContain("type: 'request_escalated'")
      // ⛔ **The look, the arming and the writer** — all three of the host's halves.
      for (const gone of [
        'watchForEscalation',
        'armEscalationLook',
        'writeWhatIsDue',
        'escalationWindowMs',
      ]) {
        expect(host_, gone).not.toContain(gone)
      }
      // ⛔ **The number**, which is the thing a later dispatch would otherwise re-derive from.
      expect(questions_).not.toContain('ESCALATION_WINDOW_MS')

      // ⚑ **THE CONTROLS, one per file** (rule 34.2): each census really did read a file with
      // something in it, so the four absences are measurements rather than empty reads.
      expect(store_).toContain('questionsAPersonMustAnswer')
      expect(host_).toContain('passQuestionUp')
      expect(questions_).toContain('aPersonsSince')
      // ⛔ **`400` removed the OTHER clock and the absence is still asserted** — HO-018 §2.2
      // withdrew criterion 5, and a `work_quiet` row surviving anywhere would be that retraction
      // half-applied. ⚑ **Two withdrawals, one file, and this is now the whole of both.**
      expect(store_).not.toContain('work_quiet')
      expect(host_).not.toContain('work_quiet')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what "idle" means — and the three things it is not
  // ───────────────────────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · both providers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · both providers', () => {
    for (const provider of ['claude', 'codex'] as const) {
      it(`⛔ ${provider}: a question its parent will not answer reaches a person`, async () => {
        const { pm, worker, workerHandle } = await aPmAndItsWorker(provider)
        expect(store.recordedOne(worker)?.provider).toBe(provider)
        const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
        await waitFor(
          () =>
            events(worker).some(
              (event) => event.type === 'request_routed' && event.requestId === raised.id,
            ),
          'the routing',
        )
        // ⚑ **612 · the PM passes it up** (HO-088 §3.2), because no window does it any more. ⛔ The
        // row in the person's queue is the PM's own, carrying the worker's words — which is what
        // makes *the original words travelled* a property of the ledger rather than a promise.
        const passed = await thePmPassesItUp(pm, raised.id)
        expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
          passed,
        ])
        expect(store.questionsRaisedIn(pm).get(passed)?.prompt).toBe('which region?')
        expect(store.questionsRaisedIn(pm).get(passed)?.passedUpFrom).toBe(raised.id)
      })
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · 612 · criterion 11 — a question reaches a person because somebody DECIDED
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a question reaches a person because somebody decided', () => {
    it('⛔ the paired negative: the PARENT answers it, and nobody else is ever told', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const askedAt =
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.at ?? 0

      const answered = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      // ⚠️ **612 · this advanced five windows and asserted the sweep found nothing** (HO-088
      // §3.1, standing rule 26). ⛔ **There is no window to be inside**, so the claim it was FOR —
      // *a question the parent answered never reaches a person* — is now true by construction and
      // is asserted over time that passes rather than over a deadline that does not.
      clock = askedAt + 5_000_000
      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.state).toBe('answered')
      expect(row?.escalatedAt).toBeNull()
      expect(host.questionsForAPerson().rows).toHaveLength(0)
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
    })

    /**
     * 🔴 **612 · this asserted the stamp's ARITHMETIC and there is no stamp** (HO-088 §3.1,
     * standing rule 26: strip AND re-aim).
     *
     * ⛔ **It read: *the escalation is stamped when it FELL DUE, and is written exactly once*** —
     * looked four windows late, checked the row carried `askedAt + ESCALATE_WINDOW` rather than
     * the moment of the look, then looked again and asserted nothing moved. ⚑ **Every one of
     * those clauses was about a row nothing writes now.**
     *
     * ⚠️ **What replaces it is the strongest form of the same subject**: no elapsed time, of any
     * size, produces one. ⛔ **Asserted over a LONG wait and a live host**, because the defect a
     * removal like this creates is a timer somebody left armed somewhere.
     */
    it('🔴 no amount of elapsed time stamps anything, and nothing is armed to try', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const askedAt =
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.at ?? 0
      expect(askedAt).toBeGreaterThan(0)

      // ⛔ **A thousand of the window this app used to have**, on the host's own clock.
      clock = askedAt + 30_000_000
      // ⚑ **And REAL time too**, because the thing that could still fire is a `setTimeout`
      // somebody left behind — a logical clock would never reach it. ⚠️ Bounded (rule 13): 120 ms
      // is three orders of magnitude more than the 40 ms window every fixture in this repo used.
      await new Promise((resolve) => setTimeout(resolve, 120))

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.escalatedAt).toBeNull()
      expect(row?.state).toBe('open')
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
      expect(host.questionsForAPerson().rows).toEqual([])

      // 🔴 **The POSITIVE CONTROL, and it is the whole of `612`'s §6.2**: the question is still
      // reachable — a parent that will not answer says so, and the person gets it at once.
      // ⚑ D-016 · the parent is read off the store's one parent column.
      const passed = await thePmPassesItUp(store.parentOf(worker) ?? '', raised.id)
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([passed])
      // ⛔ **And it arrived with no stamp**, because nothing escalated: it was addressed there.
      const persons = host.questionsForAPerson().rows[0]
      expect(persons?.request.escalatedAt).toBeNull()
      expect(persons?.request.went.is).toBe('the-person-the-asker-named')
    })

    it('🔴 passing it up does not un-ask it: the parent can still answer, and does', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      // ⚑ **612 · the PM passes it up rather than a window passing** (HO-088 §3.1).
      const passed = await thePmPassesItUp(pm, raised.id)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )

      // ⛔ **And it can STILL answer the one it passed on**, which is the property this test has
      // always been about. ⚠️ `HO-088` §3.1 words it: *"A parent answers the question, or passes
      // it up"* — and doing the second does not spend the first.
      const answered = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const row = store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)
      expect(row?.state).toBe('answered')
      // ⚑ **And the PASSED-UP row is still open**, because it is the PM's own question and nobody
      // answered that one — which is `611`'s ruling that a hop is not a cascade.
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([passed])
    })

    it('🔴 two answers to one question: the FIRST wins and the second is refused BY NAME', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      // ⚑ **612 · no clock puts it in front of anybody**; this test is about the two DOORS, and
      // both are reachable the moment the question is routed.

      // A PERSON answers it on the child, through the door a person has always used. ⚠️ The window
      // has to TAKE THE CONVERSATION OVER first, which is `336`'s rule and not this dispatch's:
      // answering for a person is refused for a session nobody holds.
      host.claimSession(worker, window)
      const ack = await host.respondUserInput(
        worker,
        raised.id,
        { kind: 'answer', answers: { q0: ['eu'] } },
        window,
      )
      expect(ack.outcome).toBe('taken')

      // ⛔ **And the parent, arriving second, is told what it named rather than that it is wrong.**
      const second = await callOn(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['us'] }],
      })
      expect(second.outcome).toBe('refused')
      expect(second.rail).toBe('question-has-already-ended')
      expect((second.detail as { state?: string } | undefined)?.state).toBe('answered')
    })

    it('⛔ a PERMISSION is never escalated, and every refusal shape is the control', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      // ⚑ **D-016 · the give's brief is the turn that raises the card** — no second message needed.
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the worker to raise its permission card',
      )
      await waitFor(
        () => events(worker).some((event) => event.type === 'permission_request'),
        'the card to reach the ledger',
      )
      const routed = store.routedRequestsOf(worker)
      // ⚑ **The control that makes the negative worth anything**: something permission-shaped really
      // did arrive at the channel and really was recorded, with the shape that kept it out.
      expect(routed.length).toBeGreaterThan(0)
      expect(routed.every((one) => one.went.is === 'the-person-the-channel-left-it-with')).toBe(
        true,
      )
      expect(routed.every((one) => one.went.to === 'a-person')).toBe(true)

      // ⚠️ **612 · this drove ten windows and asserted the sweep skipped it** (HO-088 §3.1). ⛔
      // There is no sweep, so what it was FOR is asserted directly: a permission is never in the
      // question queue and never carries a stamp, whatever time passes.
      waitOutMs(30_000_000)
      expect(store.routedRequestsOf(worker).every((one) => one.escalatedAt === null)).toBe(true)
      expect(host.questionsForAPerson().rows).toHaveLength(0)
      // ⛔ **And they are still LISTED.** The rows are not narrowed anywhere, so the census that
      // would catch a provider starting to send permissions here is still an instrument.
      expect(store.routedRequestsOf(worker).length).toBe(routed.length)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the chain
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · worker waiting on PM, PM waiting on you', () => {
    const request = (
      over: Partial<RoutedRequest> & { requestId: string; askedBy: string; parent: string },
    ): RoutedRequest => ({
      went: { is: 'the-parent', to: 'the-parent' },
      at: 1,
      state: 'open',
      endedAt: null,
      escalatedAt: 1,
      ...over,
    })

    it('🔴 a chain of ONE is still a chain, and it reads as HO-007 wrote it', () => {
      const worker = request({ requestId: 'req_1', askedBy: 'sess_worker', parent: 'sess_pm' })
      const chain = escalationChain(worker, () => null)
      expect(chain.endsWithAPerson).toBe(true)
      expect(chain.links).toEqual([{ waiting: 'sess_worker', requestId: 'req_1', on: 'sess_pm' }])
      expect(chainSentence(chain, (id) => id.replace('sess_', ''))).toBe(
        'worker waiting on pm, pm waiting on you',
      )
    })

    it('⛔ a PM blocked on its own question makes the chain longer, in order', () => {
      const worker = request({ requestId: 'req_1', askedBy: 'sess_worker', parent: 'sess_pm' })
      const pm = request({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
      const chain = escalationChain(worker, (id) => (id === 'sess_pm' ? pm : null))
      expect(chain.endsWithAPerson).toBe(true)
      expect(chain.links.map((link) => link.waiting)).toEqual(['sess_worker', 'sess_pm'])
      expect(chainSentence(chain, (id) => id.replace('sess_', ''))).toBe(
        'worker waiting on pm, pm waiting on lead, lead waiting on you',
      )
    })

    it('⛔ a CYCLE is refused, and the sentence does not name a person after it', () => {
      // ⚠️ **Unreachable today** — provenance is written once, inside `createTx`, the child's id is
      // minted before its slot is reserved, and there is no re-parent path. ⛔ **All of that is code
      // that could change, and a walk relying on it would HANG rather than refuse.**
      const a = request({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
      const b = request({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
      const chain = escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null))
      expect(chain.endsWithAPerson).toBe(false)
      expect(chain.links).toHaveLength(2)
      expect(chainSentence(chain, (id) => id)).toContain('could not be followed')
      expect(chainSentence(chain, (id) => id)).not.toContain('waiting on you')
    })

    it('⛔ an absurd chain stops at the bound rather than walking for ever', () => {
      // A fresh conversation at every hop, so `seen` never fires and only the bound can stop it.
      const chain = escalationChain(
        request({ requestId: 'req_0', askedBy: 'sess_0', parent: 'sess_1' }),
        (id) => {
          const nth = Number(id.replace('sess_', ''))
          return request({
            requestId: `req_${String(nth)}`,
            askedBy: `sess_${String(nth)}`,
            parent: `sess_${String(nth + 1)}`,
          })
        },
      )
      expect(chain.links).toHaveLength(CHAIN_HOP_LIMIT)
      expect(chain.endsWithAPerson).toBe(false)
    })

    it('🔴 the live chain, off a real ledger, names the conversations a person sees', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      // ⚑ **612 · the PM passes it up** (HO-088 §3.2) — and the chain below is the PASSER's,
      // which is one hop shorter than the escalated chain this test used to read and is the shape
      // `HO-088` §6 describes: the hop that could not answer is the one that acted.
      const passed = await thePmPassesItUp(pm, raised.id)

      const waiting = host.questionsForAPerson().rows
      expect(waiting).toHaveLength(1)
      const only = waiting[0]
      // ⚠️ **612 · the row is the PASSER's** (HO-088 §3.2), where an escalated row was the child's.
      // ⛔ **So the chain is ONE hop ending at the person** rather than two — the conversation that
      // could not answer is the one that ACTED, which is what `HO-088` §3.1 asked for and what a
      // window passing could never say.
      expect(only?.request.askedBy).toBe(pm)
      expect(only?.request.requestId).toBe(passed)
      expect(only?.chain.links).toEqual([{ waiting: pm, requestId: passed, on: null }])
      expect(only?.chain.endsWithAPerson).toBe(true)
      // ⚑ **The sentence ends at a person**, and it names conversations rather than ids where it can.
      expect(only?.sentence).toContain('waiting on you')
      expect(only?.sentence.split(' waiting on ')).toHaveLength(2)
      // 🔴 **And the ORIGINAL question is still the worker's, open, in the worker's own ledger** —
      // passing up is not a cascade.
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.state).toBe(
        'open',
      )
    })

    it('⛔ the wire carries it: the command answers a person and takes nothing', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      const passed = await thePmPassesItUp(pm, raised.id)

      const { executeRuntimeCommand } = await import('../src/main/runtime/ipc')
      const answered = (await executeRuntimeCommand(host, window, {
        kind: 'questionsForAPerson',
      })) as {
        rows: { request: { requestId: string }; sentence: string }[]
        walk: string
        ledgers: number
      }
      // ⚑ **612 · the row on the wire is the PASSER's** — see §6's chain test.
      expect(answered.rows.map((one) => one.request.requestId)).toEqual([passed])
      expect(answered.rows[0]?.sentence).toContain('waiting on you')
      // ⚑ **453 · and the WALK crosses the wire with it** — see `LedgerWalk`. ⛔ The word and the
      // ledger count are what stop an empty `rows` from being read as *nothing is waiting*.
      expect(answered.walk).toBe('every-conversation-that-routed')
      expect(answered.ledgers).toBeGreaterThan(0)
      // ⚑ **D-046 · and it carries the WORDS** — the question as it was asked, so a window draws it
      // whichever conversation asked it and whether or not it holds that conversation.
      expect(JSON.stringify(answered)).toContain('which region?')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the two vocabularies, kept apart
  // ───────────────────────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · the windows, and the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · 612 · nothing happens on its own, and the act does', () => {
    /**
     * 🔴 **This asserted the OPPOSITE and it is the sharpest inversion in the dispatch**
     * (HO-088 §3.1, standing rule 20: a rule is proven by VIOLATING it).
     *
     * ⛔ **It read: *an unanswered question escalates ON ITS OWN, with nothing in the test pushing
     * it*** — end to end through the real arm, `routeRequest` arming one look, the look asking the
     * store, the store deciding, the host writing. ⚑ **Every link in that chain is gone**, so the
     * test that proved the wiring works now proves there is none.
     *
     * ⚠️ **The window it used was ONE millisecond**, because two clocks were in play; the same
     * shape is kept here so the wait is real time rather than logical time — a `setTimeout`
     * somebody left armed is exactly what this is looking for.
     */
    it('🔴 an unanswered question escalates NEVER, and the pass-up is the control', async () => {
      const on = buildHost(store)
      const { pm, worker, workerHandle } = await aPmAndItsWorker('claude', on)
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      // ⛔ **Real time, bounded** (rule 13): 150 ms is nearly four times the 40 ms window every
      // fixture in this repo used, and 150 000 times the 1 ms this test used to arm.
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(events(worker).filter((event) => event.type === 'request_escalated')).toEqual([])
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === raised.id)?.escalatedAt,
      ).toBeNull()
      expect(on.questionsForAPerson().rows).toEqual([])

      // ⚑ **THE CONTROL, and it is `612`'s whole acceptance case**: the same question, the same
      // host, reaching a person because the PM said so.
      const passed = await callOn(agentToolsFor(on, pm), 'pass_question_up', {
        question: raised.id,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      expect(on.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
        passed.question,
      ])
    })
  })

  describe('§9 · one number, one decision, one order', () => {
    /**
     * ⚠️ **612 · the window this refusal guarded is GONE, and the refusal is not** (HO-088 §3.1).
     * 🔴 **616 · the refusal is gone too, because its LAST window is** (HO-093 §2).
     *
     * ⛔ **`398` asserted `escalate: 0` and `escalate: -1` were refused, with `1` allowed as the
     * control that the rule was about the SIGN.** ⚑ `612` re-aimed it at `proposalBoundMs`, the
     * one number `positiveWindow` still guarded; ⚠️ **`616` removed that number, so `positiveWindow`
     * had no caller and went with it** — a guard nothing calls is not a guard, and the lint error
     * was the honest form of that.
     *
     * 🔴 **Re-aimed a second time rather than deleted** (standing rule 26; `invert-a-defect-assertion-never-delete-it`).
     * ⛔ **What it pins now is the RULE's absence together with its subject's**, so a future
     * deadline cannot be added without somebody noticing there is no guard in front of it —
     * which is exactly what `positiveWindow`'s own docblock asked for before it was removed.
     */
    it('⛔ there is no window left to refuse, and no guard left to refuse it with', () => {
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      // ⛔ **The guard, and both numbers it ever stood in front of.**
      expect(host_).not.toContain('positiveWindow')
      expect(host_).not.toContain('escalationWindowMs')
      expect(host_).not.toContain('proposalBoundMs')
      // ⚑ **THE POSITIVE CONTROL, and it is the distinction rather than a spare string.** ⚠️ This
      // class still resolves three injected numbers — the drain, the interrupt wait and the
      // launch timeout — and none of them is a deadline on somebody ANSWERING; they bound this
      // app's own teardown and launch. ⛔ So *no deadline window is resolved here* is a
      // measurement rather than a reader pointed at a file that moved (standing rule 34.2).
      expect(host_).toContain('deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS')
      expect(host_).toContain('deps.interruptWaitMs ?? DEFAULT_INTERRUPT_WAIT_MS')
      expect(host_).toContain('const defaults = providerDescriptor(provider).launch')
      expect(host_).toContain('fresh: deps.launchTimeoutMs ?? defaults.freshTimeoutMs')
      expect(host_).toContain(
        'resume: resumeOverrides[provider] ?? deps.launchTimeoutMs ?? defaults.resumeTimeoutMs',
      )
    })

    /**
     * 🔴 **612 · ZERO places decide the row, where there used to be exactly one** (HO-088 §3.1).
     *
     * ⛔ **It asserted the literal was built in exactly one file — the store — so the host could
     * not come to a second opinion about when a question had run out of time.** ⚑ Nothing has an
     * opinion now, and the census is the same census with the expected answer moved to `[]`.
     *
     * ⚠️ **The control that plants TWO is kept and re-pointed** (standing rule 12): a literal that
     * really is in two files, so this walk is measured finding more than the first match rather
     * than being believed.
     */
    it('🔴 ZERO places decide the row, and the control shows the walk can see two', () => {
      const writers = (literal: string): string[] =>
        filesUnder(join(here, '../src/main'))
          .filter(({ text }) => codeOnly(text).includes(literal))
          .map(({ path }) => path)
          .sort()
      expect(writers("type: 'request_escalated'")).toEqual([])
      expect(writers('escalationsDue(')).toEqual([])
      // ⚑ **The control that plants TWO**: the routing's own literal really is in more than one
      // file, so the two empties above are measurements rather than a walk that reads nothing.
      expect(writers("'request_routed'")).toEqual([
        // A delete reads it to find who asked a helper in the tree from outside.
        'db/conversation-tree.ts',
        // ⚑ F071 · the fold index's types name it — the routed-request fold reads through it.
        'db/fold-index.ts',
        'db/schema.ts',
        'db/session-store.ts',
        // The read-only worker selects the canonical routed-request candidates.
        'db/window-read-engine.ts',
        // The writer checks whether a projection change can affect routing candidates.
        'db/window-writer-stamp.ts',
        'runtime/digest.ts',
        'runtime/runtime-host.ts',
      ])
    })

    it('⛔ the runtime package never learned the word, and now nothing else knows it either', () => {
      const runtime = filesUnder(join(here, '../../../packages/runtime/src')).map(
        ({ text }) => text,
      )
      expect(runtime.filter((text) => text.includes('request_escalated'))).toHaveLength(0)
      // ⚑ **The control**: the sweep really did read that package, and it is not empty.
      expect(runtime.filter((text) => text.includes('completeTurn')).length).toBeGreaterThan(1)
    })

    it('🔴 a stamp still lands on a question the parent answered a moment earlier', () => {
      // ⛔ **The race two writers USED to create, folded — and the ledgers holding it are real.**
      // The store decided while the row was open and the host wrote a moment later; if the parent
      // answered in between, the stamp arrived at a CLOSED row. ⚠️ Dropping it there would make
      // *"was a person ever told?"* depend on which of two independent writers happened to run
      // first — the answer would be `null` for exactly the escalations that turned out to be
      // unnecessary, which is the population worth counting.
      //
      // Current writers cannot produce this race, but historical ledgers contain the shape
      // and `questionsAPersonMustAnswer` admits it through `escalatedAt`. Test the fold over
      // synthetic entries rather than a host path that can no longer reach it.
      const entries: PersistedEventInfo[] = [
        {
          ordinal: 0,
          at: 10,
          event: { type: 'request_routed', requestId: 'ui_1', to: 'the-parent', parent: 'sess_pm' },
        },
        {
          ordinal: 1,
          at: 20,
          event: { type: 'user_decision', requestId: 'ui_1', outcome: 'answered' },
        },
        { ordinal: 2, at: 15, event: { type: 'request_escalated', requestId: 'ui_1' } },
      ]
      const [row] = deriveRoutedRequests('sess_worker', entries)
      expect(row?.state).toBe('answered')
      expect(row?.escalatedAt).toBe(15)
    })

    it('⛔ the two shared folds still reach nothing — no clock, no store, no timer', () => {
      // 🔴 **494 · `tasks.ts` took its first VALUE import**, so the two modules it can now reach
      // are walked as well. ⛔ *No clock, no store, no timer* is the claim; *every line says
      // `import type`* was the proxy, and a proxy that goes false while its claim stays true is a
      // test that has to be re-derived rather than re-worded. ⚑ **F097 · and its second**, so the
      // module that one reaches is walked too.
      for (const file of [
        'tasks.ts',
        'questions.ts',
        'how-work-stopped.ts',
        'who-did-it.ts',
        'a-persons-own-words.ts',
      ]) {
        const text = sourceOf(sharedRoot, file)
        const imports = [...text.matchAll(/^import .*$/gm)].map((match) => match[0])
        // ⚑ **The value imports are NAMED**, so another one is a red test rather than a widening
        // nobody reviewed — `tasks.ts` reaching the derivation, that module reaching the caller
        // vocabulary its second producer states an actor in, and (F097) `tasks.ts` reading whose
        // words opened a turn the way the host reads it.
        const allowed = [
          "import { whoCancelledIt, type AskToStop } from './how-work-stopped'",
          "import { WHO_DID_IT, WHO_DID_IT_SAYS, type ActedBy, type WhoDidIt } from './who-did-it'",
          "import { aPersonsOwnWords } from './a-persons-own-words'",
        ]
        for (const line of imports) {
          expect(
            line.startsWith('import type ') || allowed.includes(line),
            `${file}: ${line}`,
          ).toBe(true)
        }
        const code = codeOnly(text)
        expect(code, file).not.toContain('Date.now')
        expect(code, file).not.toContain('setTimeout')
      }
    })
  })
})
