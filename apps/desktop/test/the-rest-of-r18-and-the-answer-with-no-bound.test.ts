import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../src/main/resources/resources'
import { exchangePreviewLines } from '../src/shared/last-exchange'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 676 — the rest of R18, and the answer with no bound
 *
 * ⚑ **`671` closed R18 on the five walks it was given and named what it did not reach** (its F1–F4).
 * Each section here is one of them, measured through the host's own doors over real SQLite and real
 * migrations, with a clean database as the control.
 *
 * | § | finding | what this file pins |
 * |---|---|---|
 * | 1 | **F2** | ⛔ gone with D-016: document registration and the per-project task number it read |
 * | 2 | **F4** | `answer_question`'s free text over `REPLY_SUMMARY_LIMIT` is refused before anything is recorded; a label and an answer at the bound are untouched |
 * | 3 | **F1** | `list_tasks` and the wait read behind the Team plates and the rail ANSWER over a torn row and carry the count; a notice push still fires |
 * | 4 | **F3** | an agent's card counts the rows its two ledger reads passed over, and only those |
 * | 5 | **the wider search** | four more statements that RAISED on one torn row — the next launch, a reopen, every agent's question doors, the limit band — now answer |
 *
 * ⛔ **What this file does NOT claim**: that any renderer DRAWS a count. The surfaces are the
 * frontend's (`676` §5.1); this is what main hands them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/**
 * ⚑ **`394`'s double**: a test has to BE the provider to raise a provider's question, so every
 * handle is kept. Its registry is shared so every launch's toolset can be reached.
 */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
}

/** A row the ledger cannot parse — the whole of what "torn" means here. */
const TORN = '{not json'

describe('676 · the rest of R18, and the answer with no bound', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handed, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-676-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-676-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_760_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    claimed.clear()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      structured: (answered.structured ?? {}) as Record<string, unknown>,
      text: answered.text,
    }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * A PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is a give, and it is the one verb that hands work over**: the brief is the
   * child's first turn — parked on the Fake's card, since the PM is in `ask` — and the piece it wrote
   * comes back as `task`, where a spawn started the child idle and a `work` message minted a task.
   */
  const aPmAndItsWorker = async (
    brief = 'build it',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    workerHandle: FakeSessionHandle
    task: { readonly piece: string; readonly label: string }
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: brief,
      brief,
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    return {
      pm,
      worker: given.structured.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      workerHandle: latestHandle(),
      task: { piece: given.structured.piece as string, label: given.structured.label as string },
    }
  }

  /** The fake provider parks every turn on a card; a person allowing it lets the turn end. */
  const claimed = new Set<string>()
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const turns = (): number => ledger(sessionId).filter((event) => event.type === 'turn').length
    const before = turns()
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (asked === undefined) throw new Error('no permission request on the ledger')
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, asked.id, { outcome: 'allow' }, window)
    await waitFor(() => turns() > before, 'the turn to end')
  }

  /** ⛔ A torn row of `type`, planted in `sessionId`'s active generation past anything written. */
  const plantTorn = (sessionId: string, type: string, ordinal: number): void => {
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    ).run(`evt_torn_${sessionId}_${String(ordinal)}`, sessionId, ordinal, type, TORN, tick())
  }

  /* ═══════════════════════ §1 · F2 — gone with D-016 ══════════════════════════════════════════════ */

  // ⛔ **D-016 · §1 went with its subject.** It measured `selectTaskNumberInProject` — the project's
  // task number a document registration read — answering over a torn assignment, and the
  // registration's `no-such-task` carrying `rows_unread`. ⚑ Documents became a reply's resources,
  // kept by `reply_to_parent` and named by no project number, and projects went with them: there is
  // no registration to raise and no project sequence to read.

  /* ═══════════════════ §2 · F4 — the answer is bounded: refused over it, never cut ═══════════════ */

  describe('§2 · F4 — `answer_question`’s own words over the family’s bound are refused before anything is recorded', () => {
    /** ⚑ The worker's own question about its own piece — the HELD branch (`437`/`591`). */
    const workerAsks = async (workerTools: AgentToolset, piece: string): Promise<string> => {
      const asked = await call(workerTools, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'what should it say?',
      })
      expect(asked.structured.outcome, JSON.stringify(asked.structured)).toBe('ok')
      return asked.structured.question as string
    }

    const answerTurns = (worker: string): string[] =>
      ledger(worker)
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'user_turn' }> =>
            event.type === 'user_turn' && event.text.includes('answered the question you asked'),
        )
        .map((event) => event.text)

    /** ⛔ Nothing recorded: no decision on the question in its asker's ledger. */
    const decisionsOn = (worker: string, question: string): number =>
      ledger(worker).filter(
        (event) => event.type === 'user_decision' && event.requestId === question,
      ).length

    it('⚑ THE CONTROL: an answer AT the bound is taken and arrives whole, and no part is reported unsent', async () => {
      const { worker, pmTools, workerTools, task } = await aPmAndItsWorker()
      const question = await workerAsks(workerTools, task.piece)
      const words = 'y'.repeat(1280)
      const answered = await call(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: [words] }],
      })
      expect(answered.structured.outcome, JSON.stringify(answered.structured)).toBe('ok')
      expect(answered.structured.not_asked).toEqual([])
      // ⚑ **D-016 · commit 7 · R3** — the asker named by the piece it owns, where it printed its id.
      // ⚑ Held behind a turn parked on a person's card, which an answer's stop never cuts.
      const asker = host.nameByItsWork(worker)
      // ⚑ W4.134 — in full once, then by its name alone.
      const again = host.whatToCallTheConversation(worker)
      // ⚑ What it waits for is said once: the person's answer its turn is stopped on, then why the
      // stop was not asked of that turn.
      const waits = host.whyWhatIsHeldWaits(worker)
      expect(waits).toMatch(/^Its turn is stopped until a person answers its request to use Bash/)
      expect(answered.text).toBe(
        `Your answer is held for ${asker}. ${waits ?? ''} The turn ${again} is running was not interrupted: stopping it would answer for the person it waits on.`,
      )
      // ⚑ **HELD while the worker is busy** — a notice, never work (`591`); its turn ending flushes it.
      await letTheTurnFinish(worker)
      await waitFor(() => answerTurns(worker).length > 0, 'the answer to reach the worker')
      expect(answerTurns(worker)[0]).toContain(`answer: ${words}`)
    })

    it('🔴 HELD branch: ONE unit over is refused with the length, the limit and what to do — nothing is recorded, and the same caller answers again', async () => {
      const { worker, pmTools, workerTools, task } = await aPmAndItsWorker()
      const question = await workerAsks(workerTools, task.piece)
      // ⛔ **The literal 1281**, never `REPLY_SUMMARY_LIMIT + 1` — a test that spells the constant
      // moves with it and pins nothing (`a-bound-written-as-the-constant-cannot-pin-it`).
      const refused = await call(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['e'.repeat(1281)] }],
      })
      expect(refused.structured.outcome, JSON.stringify(refused.structured)).toBe('refused')
      expect(refused.structured).toMatchObject({
        rail: 'answer-too-long',
        retryable: true,
        remedy: 'shorten-the-answer-or-put-the-long-form-in-a-file',
        detail: { question, argument: 'answers', limit: 1280, was: 1281 },
      })
      expect(refused.text).toContain(
        'shorten your answer, or put the long form in a file and name its full path in your answer',
      )
      expect(refused.text).toContain('1281 units long and an answer may carry at most 1280')
      expect(refused.text).toContain('the question is still waiting for your answer')
      expect(decisionsOn(worker, question)).toBe(0)

      // ⚑ **THE PAIR**: the same question, answered again within the bound, is taken whole.
      const answered = await call(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['see /tmp/the-long-form.md'] }],
      })
      expect(answered.structured.outcome, JSON.stringify(answered.structured)).toBe('ok')
      expect(decisionsOn(worker, question)).toBe(1)
      await letTheTurnFinish(worker)
      await waitFor(() => answerTurns(worker).length > 0, 'the answer to reach the worker')
      expect(answerTurns(worker)).toHaveLength(1)
      expect(answerTurns(worker)[0]).toContain('answer: see /tmp/the-long-form.md')
      expect(answerTurns(worker)[0]).not.toContain('e'.repeat(1280))
    })

    it('⚠️ units are UTF-16 units: a character of TWO counts as two', async () => {
      const { pmTools, workerTools, task } = await aPmAndItsWorker()
      const question = await workerAsks(workerTools, task.piece)
      const words = `${'w'.repeat(1279)}😀`
      expect(words.length).toBe(1281)
      const refused = await call(pmTools, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: [words] }],
      })
      expect(refused.structured).toMatchObject({ rail: 'answer-too-long', detail: { was: 1281 } })
    })

    it('🔴 PROVIDER branch: a long typed answer is refused and the provider is handed nothing; a chosen LABEL is not counted', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ **A label longer than the bound**, which only a provider can offer — `ask_question`
      // refuses offered options past it. ⛔ It is the asker's words and must match by exact string.
      const long = 'L'.repeat(1400)
      const raise = async (): Promise<{ id: string; answered: Promise<unknown> }> => {
        const raised = workerHandle.simulateUserInput('which?', [long, 'short'], false, {
          allowOther: true,
        })
        await waitFor(
          () =>
            ledger(worker).some(
              (event) => event.type === 'request_routed' && event.requestId === raised.id,
            ),
          `the routing of ${raised.id}`,
        )
        return raised
      }

      const typed = await raise()
      let handed = false
      void typed.answered.then(() => (handed = true))
      const free = await call(pmTools, 'answer_question', {
        question: typed.id,
        answers: [{ part: 'q0', answer: ['v'.repeat(3000)] }],
      })
      expect(free.structured).toMatchObject({
        outcome: 'refused',
        rail: 'answer-too-long',
        detail: { argument: 'answers', limit: 1280, was: 3000 },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(handed).toBe(false)
      expect(decisionsOn(worker, typed.id)).toBe(0)
      // ⚑ …and the same request takes a shorter answer, whole.
      const short = await call(pmTools, 'answer_question', {
        question: typed.id,
        answers: [{ part: 'q0', answer: ['v'.repeat(1280)] }],
      })
      expect(short.structured.outcome, JSON.stringify(short.structured)).toBe('ok')
      const given = (await typed.answered) as { answers: Record<string, string[]> }
      expect(given.answers.q0).toEqual(['v'.repeat(1280)])

      const chose = await raise()
      const label = await call(pmTools, 'answer_question', {
        question: chose.id,
        answers: [{ part: 'q0', answer: [long] }],
      })
      expect(label.structured.outcome, JSON.stringify(label.structured)).toBe('ok')
      expect(label.structured.not_asked).toEqual([])
      const chosen = (await chose.answered) as { answers: Record<string, string[]> }
      expect(chosen.answers.q0).toEqual([long])
    })

    it('🔴 the bound is on the WHOLE answer: ten strings of 1,280 are refused as 12,800 (`676` review)', async () => {
      const { worker, pmTools, workerTools, task } = await aPmAndItsWorker()
      const question = await workerAsks(workerTools, task.piece)
      // ⛔ **Bounding each string** let this through as a 12,800-unit turn — `ask_question`'s
      // *"an unbounded list defeats the one bound this door applies"*.
      const refused = await call(pmTools, 'answer_question', {
        question,
        answers: [
          { part: 'answer', answer: Array.from({ length: 10 }, (_, i) => String(i).repeat(1280)) },
        ],
      })
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: 'answer-too-long',
        detail: { was: 12800, limit: 1280 },
      })
      expect(decisionsOn(worker, question)).toBe(0)
    })

    it('⛔ a part the question never asked does not reach the asker, is not counted, and is named in `not_asked`', async () => {
      const { worker, pmTools, workerTools, task } = await aPmAndItsWorker()
      const question = await workerAsks(workerTools, task.piece)
      const answered = await call(pmTools, 'answer_question', {
        question,
        answers: [
          { part: 'answer', answer: ['yes'] },
          { part: 'bogus', answer: ['b'.repeat(1281)] },
        ],
      })
      expect(answered.structured.outcome, JSON.stringify(answered.structured)).toBe('ok')
      expect(answered.structured.not_asked).toEqual(['bogus'])
      expect(answered.text).toContain(
        'except bogus: its question does not ask about that part, so it was not sent',
      )
      await letTheTurnFinish(worker)
      await waitFor(() => answerTurns(worker).length > 0, 'the answer to reach the worker')
      const turn = answerTurns(worker)[0] ?? ''
      expect(turn).toContain('answer: yes')
      expect(turn).not.toContain('bogus')
    })

    it('⚠️ a BLANK string is not the answerer’s words: not counted, and a choice beside it is still ONE choice (`676` review)', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which?', ['A', 'B'], false, {
        allowOther: true,
      })
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        `the routing of ${raised.id}`,
      )
      const answered = await call(pmTools, 'answer_question', {
        question: raised.id,
        answers: [{ part: 'q0', answer: ['A', ' '.repeat(1300)] }],
      })
      expect(answered.structured.outcome, JSON.stringify(answered.structured)).toBe('ok')
      expect(answered.structured.not_asked).toEqual([])
      const given = (await raised.answered) as { answers: Record<string, string[]> }
      expect(given.answers.q0).toEqual(['A', ''])
    })
  })

  /* ═══════════════════════ §3 · F1 — the other composed readers carry the count ═══════════════════ */

  describe('§3 · F1 — every composed reader that meets a torn row says so, or its docblock says why it cannot', () => {
    /**
     * The two readers `676` gave a count, read through the host's own doors. ⚑ **D-016** took
     * `list_projects`, the first of them; the PM's `list_tasks` reads the same work given out
     * (`you_gave`) through the same wait reads, and carries the same `rows_unread`.
     */
    const twoCounts = async (pmTools: AgentToolset): Promise<Record<string, unknown>> => {
      const listed = await call(pmTools, 'list_tasks', {})
      return {
        listTasks: listed.structured.rows_unread,
        platesAndRail: host.whatEachConversationIsWaitingOn().rowsUnread,
      }
    }

    it('⚑ THE CONTROL: on a clean database both carry 0, and list_tasks says nothing about it', async () => {
      const { pmTools } = await aPmAndItsWorker()
      expect(await twoCounts(pmTools)).toEqual({ listTasks: 0, platesAndRail: 0 })
      expect((await call(pmTools, 'list_tasks', {})).text).not.toContain('could not be read')
    })

    it('🔴 a torn QUESTION row in the holder’s ledger: only the wait reads meet it — both ANSWER and both count it', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      plantTorn(worker, 'user_input_request', 90_000)
      // ⛔ **Until `676` both skipped it with a warning and nothing else**: the plate read *waiting
      // on nothing* and `list_projects` (the reader D-016 deleted) claimed to have read every row.
      expect(await twoCounts(pmTools)).toEqual({ listTasks: 1, platesAndRail: 1 })
      const listed = await call(pmTools, 'list_tasks', {})
      expect(listed.structured.outcome).toBe('ok')
      // 🔴 **Said to the model in `list_tasks`' own words**, not only in a log.
      expect(listed.text).toContain("1 row of this app's record could not be read")
      expect(listed.structured.you_gave as unknown[]).toHaveLength(1)
    })

    it('⚑ a torn ASSIGNMENT is met by the task read AND by the wait read’s scan — and is one row', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      // ⚠️ **In the WORKER's own ledger**, so the PM's `piecesGivenBy` fold meets it and the wait
      // read's scan meets it too — two reads of one answer, one `(ledger, ordinal)`. ⚑ D-016: the
      // row that writes a piece down is `work_given`, where it was `task_assigned`.
      plantTorn(worker, 'work_given', 90_000)
      expect((await call(pmTools, 'list_tasks', {})).structured.rows_unread).toBe(1)
    })

    it('⚑ a torn REPLY row is met by the task read alone — and counted there', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      // ⚠️ **`work_replied` is a type no wait read selects**, so the one read that meets it is the
      // piece fold over the worker's ledger — which is what makes this the piece read's count alone.
      // ⚑ **D-016** — `list_projects`' NAMED arm (one project asked for by name) went with it, and
      // the reply row is `work_replied`, where it was `task_replied`.
      plantTorn(worker, 'work_replied', 90_000)
      expect((await call(pmTools, 'list_tasks', {})).structured.rows_unread).toBe(1)
    })

    it('🔴 a torn LAST WORDS row is said as unreadable — it neither raises nor is quoted as silence (`676` review)', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // The preview-bearing interrupted-turn notice still reads the last exchange.
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      await waitFor(
        () => ledger(pm).some((event) => event.type === 'work_stall_told'),
        'the notice',
      )
      // ⚑ **D-012 · re-aimed from `614`'s last words to the last EXCHANGE**, whose answer half is
      // the same read of the same rows.
      expect(store.lastExchange(worker).answer).toMatchObject({ text: expect.any(String) })
      db.prepare(
        `UPDATE events SET payload = ? WHERE session_id = ? AND type = 'assistant_message'`,
      ).run(TORN, worker)
      // ⛔ **Until `676`'s review this RAISED**, and the stall notice quoting it was lost whole.
      expect(store.lastExchange(worker).answer).toEqual({ unreadable: true })
      expect(
        exchangePreviewLines('Ada', store.lastExchange(worker), () => 'Pam').join(' '),
      ).toContain('could not be read')
    })

    it('⛔ a NOTICE push carries no count by design — and a torn row does not stop it firing', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // ⚠️ **The torn question row hides a wait from the composition** (`671` F5), so the work
      // reads undriven when the turn ends — and the parent IS told, which is the push answering.
      plantTorn(worker, 'user_input_request', 90_000)
      // This existing giver band reports an observed interruption, even with unread waits.
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      await waitFor(
        () => ledger(pm).some((event) => event.type === 'work_stall_told'),
        'the giver to be told its work is not being driven',
      )
      // ⚑ **The person's reading of the same composition counts it** — where the push's docblock
      // points instead of a count (`RuntimeHost.oneWaitReadPerAnswer`).
      expect(host.stalledWorkForAPerson().rowsUnread).toBe(1)
    })
  })

  /* ═══════════════════════ §4 · F3 — the card counts what its reads passed over ═════════════════ */

  describe('§4 · F3 — an agent card counts the rows its two ledger reads could not read', () => {
    const plantAsk = (sessionId: string, ordinal: number, payload: string): void => {
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'work_interrupted', ?, ?)`,
      ).run(`evt_ask_${String(ordinal)}`, sessionId, ordinal, payload, tick())
    }
    const readable = JSON.stringify({ type: 'work_interrupted', by: 'a-person' })

    it('⚑ THE CONTROL: a readable ask answers and the card counts 0 — a readable NON-ask after it is not a row it passed over', async () => {
      const worker = await personOpens('worker')
      plantAsk(worker, 90_001, readable)
      // ⚠️ **A readable `allow` is one of the read's two TYPES and not an ask** — it is skipped by
      // the outcome filter, not for being unreadable, and must not be counted.
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES ('evt_allow', ?, 0, 90002, 'user_decision', ?, ?)`,
      ).run(
        worker,
        JSON.stringify({
          type: 'user_decision',
          requestId: 'r1',
          outcome: 'allow',
          by: 'a-person',
        }),
        tick(),
      )
      const card = host.agentCard(worker, window, worker)
      expect(card?.lastAskToStop?.by).toBe('a-person')
      expect(card?.rowsUnread).toBe(0)
    })

    it('🔴 a torn ask and NO readable one: the card says nobody asked — and that it passed one over', async () => {
      const worker = await personOpens('worker')
      plantAsk(worker, 90_001, TORN)
      const card = host.agentCard(worker, window, worker)
      expect(card?.lastAskToStop).toBeNull()
      expect(card?.rowsUnread).toBe(1)
    })

    it('🔴 a torn ask NEWER than the readable one: the card answers with the older one AND says it passed one over', async () => {
      const worker = await personOpens('worker')
      plantAsk(worker, 90_001, readable)
      plantAsk(worker, 90_002, TORN)
      const card = host.agentCard(worker, window, worker)
      expect(card?.lastAskToStop?.by).toBe('a-person')
      // ⛔ **Until `676` this was silent** (`671` F3): the answer may be older than the truth.
      expect(card?.rowsUnread).toBe(1)
    })

    it('⚠️ a torn ask OLDER than the readable one is a row the read never met, and is not counted', async () => {
      const worker = await personOpens('worker')
      plantAsk(worker, 90_001, TORN)
      plantAsk(worker, 90_002, readable)
      expect(host.agentCard(worker, window, worker)?.rowsUnread).toBe(0)
    })

    it('🔴 a torn row in the LAST ENDED TURN’s rows is counted — and get_agent_status hands the model the count', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      await letTheTurnFinish(worker)
      expect(host.agentCard(worker, window, worker)?.rowsUnread).toBe(0)
      expect((await call(pmTools, 'get_agent_status', { agent: worker })).text).not.toContain(
        'could not be read',
      )
      // ⚑ The `turn` row that closed it, torn: `lastEndedTurn` folds that turn's rows.
      db.prepare(`UPDATE events SET payload = ? WHERE session_id = ? AND type = 'turn'`).run(
        TORN,
        worker,
      )
      expect(host.agentCard(worker, window, worker)?.rowsUnread).toBe(1)
      const status = await call(pmTools, 'get_agent_status', { agent: worker })
      expect(status.structured.outcome).toBe('ok')
      expect((status.structured.agent as { rowsUnread: number }).rowsUnread).toBe(1)
      // ⚑ **…and in the words both readers of a card read** (`676`, after `675` landed).
      expect(status.text).toContain('1 row of its record could not be read')
    })
  })

  /* ═══════════════════ §5 · the wider search — four statements that RAISED ═══════════════════════ */

  describe('§5 · the wider search: the statements it measured raising on one torn row now answer', () => {
    // ⚑ **The four per-conversation reads over `workflow_run`/`sub_agent` rows `676` listed as still
    // unguarded were guarded by `697`** — see §6 below; this section is the ones `676` fixed.
    it('🔴 A · a torn ROUTING anywhere: list_questions answers and counts it, and the answer door refuses by name', async () => {
      const { pm, pmTools } = await aPmAndItsWorker()
      const clean = await call(pmTools, 'list_questions', {})
      expect(clean.structured.outcome).toBe('ok')
      expect(clean.structured.rows_unread).toBe(0)
      expect(clean.text).not.toContain('could not be read')
      // ⛔ **Until `676` every agent's `list_questions` and `answer_question` RAISED on this row**
      // (measured): the routing scan evaluates `$.parent` on every routing in the database.
      plantTorn(await personOpens('reviewer'), 'request_routed', 90_000)
      expect(() => host.questionsWaitingOn(pm)).not.toThrow()
      const listed = await call(pmTools, 'list_questions', {})
      expect(listed.structured.outcome).toBe('ok')
      expect(listed.structured.rows_unread).toBe(1)
      // ⚑ **…and in its words** (`676`, after `675` landed).
      expect(listed.text).toContain(
        "1 row of this app's record could not be read, so a question may be missing",
      )
      const answered = await call(pmTools, 'answer_question', {
        question: 'ui_nobody',
        answers: [{ part: 'q0', answer: ['x'] }],
      })
      expect(answered.structured.outcome, JSON.stringify(answered.structured)).toBe('refused')
    })

    it('🔴 B · a torn QUEUED message in any conversation: the next launch still starts', async () => {
      const one = await personOpens('reviewer')
      await host.close(one, window)
      plantTorn(one, 'message_queued', 90_000)
      // ⛔ **Until `676` this constructor RAISED** — the stranded-message sweep runs at launch.
      expect(() => buildHost()).not.toThrow()
    })

    it('⛔ B · a torn ENDING leaves the messages queued BEFORE it alone, settles one queued AFTER it, and a readable ledger is settled (control)', async () => {
      const held = await personOpens('reviewer')
      const plain = await personOpens('writer')
      const later = await personOpens('editor')
      for (const id of [held, plain, later]) await host.close(id, window)
      // ⚑ **D-030 · a crash's lives, not a stop's**: the launch keeps what a life its row says
      // ended handed on, and settles only what a crash cut — which writes no terminal, so each row
      // is put back to what a crash leaves.
      for (const id of [held, plain, later]) {
        db.prepare(`UPDATE provider_session SET status = 'idle' WHERE id = ?`).run(id)
      }
      const queue = (sessionId: string, ordinal: number, messageId: string): void => {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, 'message_queued', ?, ?)`,
        ).run(
          `evt_q_${messageId}`,
          sessionId,
          ordinal,
          JSON.stringify({ type: 'message_queued', messageId, text: 'held words' }),
          tick(),
        )
      }
      queue(held, 90_000, 'msg_held')
      plantTorn(held, 'message_unqueued', 90_001)
      queue(plain, 90_000, 'msg_plain')
      // ⚑ **`676`'s review**: an ending is written after its own queue row, so a torn one cannot
      // have ended a message queued LATER — and blocking that one would hold it for good.
      queue(later, 90_000, 'msg_before')
      plantTorn(later, 'message_unqueued', 90_001)
      queue(later, 90_002, 'msg_after')
      buildHost()
      const endings = (sessionId: string): number =>
        ledger(sessionId).filter((event) => event.type === 'message_unqueued').length
      // ⚑ The control: a stranded message with a readable ledger is settled at launch.
      expect(endings(plain)).toBe(1)
      // ⛔ A torn ending cannot say which message it ended, so nothing is written over it.
      expect(endings(held)).toBe(0)
      const settled = ledger(later).filter(
        (event): event is Extract<TranscriptEvent, { type: 'message_unqueued' }> =>
          event.type === 'message_unqueued',
      )
      expect(settled.map((event) => event.messageId)).toEqual(['msg_after'])
    })

    it('🔴 C · a torn row of ANY type in a conversation: it still reopens (control: a clean one does)', async () => {
      const clean = await personOpens('reviewer')
      await host.close(clean, window)
      await expect(host.resumeSession(clean, window)).resolves.toBeDefined()
      const torn = await personOpens('writer')
      await host.close(torn, window)
      // ⛔ **Until `676` this reopen RAISED**: the grant it restores reads every row for `attachments`.
      plantTorn(torn, 'turn', 90_000)
      await expect(host.resumeSession(torn, window)).resolves.toBeDefined()
    })

    it('🔴 E · a torn limit CLEAR: the band answers, counts it, and the wall stays standing', async () => {
      const one = await personOpens('reviewer')
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES ('evt_wall', ?, 0, 90000, 'error', ?, ?)`,
      ).run(
        one,
        JSON.stringify({
          type: 'error',
          message: 'claude is rate-limited (five_hour) — the turn may stall until it resets',
          fatal: false,
        }),
        tick(),
      )
      const clean = host.limitsForAPerson()
      expect(clean.rows).toHaveLength(1)
      expect(clean.rowsUnread).toBe(0)
      plantTorn(one, 'provider_limit_clear', 90_001)
      // ⛔ **Until `676` this RAISED** whenever a wall stood; ⚑ and a torn clear must not RETRACT it —
      // a guarded payload has no window, which the fold reads as *the provider as a whole*.
      const torn = host.limitsForAPerson()
      expect(torn.rows).toHaveLength(1)
      expect(torn.rowsUnread).toBe(1)
    })
  })

  /* ═══════════ §6 · 697 — the four reads `676` §5 listed, guarded and counted ═══════════════════ */

  /**
   * 🔴 **697 · `676` §5 — `selectWorkflowOutput`, `selectWorkflowAgentTask`, `selectWorkflowAgentIds`
   * and `selectSubAgentReported`.** ⛔ Each read the payload bare, so one torn `workflow_run` or
   * `sub_agent` row made that conversation's own workflow-output and child doors RAISE — a person's
   * click, and every poll of an open viewer. ⚑ Driven through the host's own doors; each arm first
   * with a clean control, then one torn row placed where the read meets it.
   */
  describe('§6 · 697 — a torn run or sub-agent row: the door answers, and says how many it could not read', () => {
    /** ⚑ A READABLE row, written the way the ledger holds one — the payload is the event. */
    const plantRow = (
      sessionId: string,
      type: string,
      ordinal: number,
      event: Record<string, unknown>,
    ): void => {
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        `evt_row_${sessionId}_${String(ordinal)}`,
        sessionId,
        ordinal,
        type,
        JSON.stringify({ type, ...event }),
        tick(),
      )
    }
    const aRun = (sessionId: string, ordinal: number): void =>
      plantRow(sessionId, 'workflow_run', ordinal, {
        taskId: 'wf1',
        outputFile: join(root, 'no-such-output.md'),
        agents: [{ agentId: 'agent_a' }],
      })

    it('🔴 A · the workflow output: a newer torn run row is counted, an older one is not, a torn turn is not', async () => {
      const s = await personOpens('reviewer')
      aRun(s, 80_000)
      const clean = host.readWorkflowOutput(s, 'wf1')
      // ⚑ The control's answer, whatever the file read says of a path that is not there.
      expect(clean).toMatchObject({ ok: false, rowsUnread: 0 })
      const reason = clean.ok ? null : clean.reason
      expect(reason).not.toBe('no-output') // the ledger DID name an output
      // ⛔ **Until `697` this RAISED** (`SqliteError: malformed JSON`).
      plantTorn(s, 'workflow_run', 90_000)
      expect(host.readWorkflowOutput(s, 'wf1')).toEqual({ ok: false, reason, rowsUnread: 1 })
      // ⚑ Older than the answer: a row the DESC read never met — not counted.
      plantTorn(s, 'workflow_run', 70_000)
      plantTorn(s, 'turn', 95_000)
      expect(host.readWorkflowOutput(s, 'wf1')).toEqual({ ok: false, reason, rowsUnread: 1 })
    })

    it('🔴 B · a run ONLY torn rows describe: no output, and every one of them counted', async () => {
      const s = await personOpens('reviewer')
      // ⚑ The clean control: a run nothing reported — `no-output`, and nothing passed over.
      expect(host.readWorkflowOutput(s, 'wf1')).toEqual({
        ok: false,
        reason: 'no-output',
        rowsUnread: 0,
      })
      plantTorn(s, 'workflow_run', 80_000)
      plantTorn(s, 'workflow_run', 90_000)
      expect(host.readWorkflowOutput(s, 'wf1')).toEqual({
        ok: false,
        reason: 'no-output',
        rowsUnread: 2,
      })
    })

    it('🔴 C · a workflow agent’s transcript and its run’s journal answer over a torn run row', async () => {
      const s = await personOpens('reviewer')
      aRun(s, 80_000)
      const transcript = host.readChildWork(s, { part: 'transcript', agentId: 'agent_a' })
      const journal = host.readChildWork(s, { part: 'journal', taskId: 'wf1' })
      expect(transcript.rowsUnread).toBe(0)
      expect(journal.rowsUnread).toBe(0)
      plantTorn(s, 'workflow_run', 90_000)
      // ⛔ **Until `697` both RAISED**; ⚑ the same answers now, one row counted each.
      expect(host.readChildWork(s, { part: 'transcript', agentId: 'agent_a' })).toEqual({
        ...transcript,
        rowsUnread: 1,
      })
      expect(host.readChildWork(s, { part: 'journal', taskId: 'wf1' })).toEqual({
        ...journal,
        rowsUnread: 1,
      })
      // ⚑ And a torn row OLDER than the answer: the agent's lookup walks back from the newest and
      // stops at its answer, so it never meets that row — still 1; the roster read meets every
      // run row, so it counts both — 2. One fact apart, two answers.
      plantTorn(s, 'workflow_run', 70_000)
      expect(host.readChildWork(s, { part: 'transcript', agentId: 'agent_a' }).rowsUnread).toBe(1)
      expect(host.readChildWork(s, { part: 'journal', taskId: 'wf1' }).rowsUnread).toBe(2)
    })

    it('🔴 D · a plain sub-agent: a torn sub_agent row does not unmake a readable report, and is counted only beside a no', async () => {
      const s = await personOpens('reviewer')
      plantRow(s, 'sub_agent', 90_000, { agentId: 'sub_b', status: 'started' })
      const clean = host.readChildWork(s, { part: 'transcript', agentId: 'sub_b' })
      expect(clean.rowsUnread).toBe(0)
      expect(clean).not.toMatchObject({ reason: 'unknown-agent' }) // the ledger reported it
      // ⛔ **Until `697` this RAISED**: the LIMIT 1 read with no ORDER met the older torn row first.
      plantTorn(s, 'sub_agent', 80_000)
      expect(host.readChildWork(s, { part: 'transcript', agentId: 'sub_b' })).toEqual({
        ...clean,
        rowsUnread: 0, // ⚑ a yes proven by a readable row — no torn row can take it back
      })
      // ⚑ …and an agent NO readable row reports: `unknown-agent`, with the torn row counted.
      expect(host.readChildWork(s, { part: 'transcript', agentId: 'sub_nobody' })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 1,
      })
    })

    it('⚑ E · the live channel over the same rows answers too — warned, not counted, and not raised', async () => {
      const s = await personOpens('reviewer')
      // ⚑ The clean control: what the channel answers over a ledger with nothing torn in it.
      const clean = await host.readChildState(s, 'agent_a', window)
      plantTorn(s, 'workflow_run', 80_000)
      plantTorn(s, 'sub_agent', 90_000)
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // ⛔ **Until `697` this RAISED**; ⚑ the same answer now, with no count on it (its type has
        // none — the transcript read carries it for the same ledger)…
        expect(await host.readChildState(s, 'agent_a', window)).toEqual(clean)
        // ⚑ …and both rows WARNED, by ordinal — a torn row is never quieter for having been skipped.
        const said = warned.mock.calls.map((call) => String(call[0]))
        for (const ordinal of ['80000', '90000']) {
          expect(said.some((line) => line.includes(`ordinal ${ordinal} is not JSON`))).toBe(true)
        }
      } finally {
        warned.mockRestore()
      }
    })
  })
})
