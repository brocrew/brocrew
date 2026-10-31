import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { replyText, workAnswered, workUndriven } from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  A_PERSON_MUST_ACT,
  A_PERSON_MUST_ACT_SENTENCE,
  TASK_IS_OPEN,
  TASK_OUTCOMES,
  TASK_STALL_CAUSES,
  TASK_STATES,
  UNDRIVEN_SENTENCES,
  derivePieces,
  isAWorkReport,
  undrivenSentence,
  type TaskState,
  type WorkReport,
} from '../src/shared/tasks'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import {
  WORK_STATE_WORD,
  personsMark,
  personsPart,
  workReading,
} from '../src/renderer/src/lib/work-report'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **406 · finished, and finished with a question** — HO-019 §2's property, and the two defects
 * that stood between it and a person.
 *
 * ⚑ The PO's words, quoted in the brief that asked for this:
 *
 * > ⚑ **A person must be able to tell, AT A GLANCE AND WITHOUT READING, the difference between
 * > *finished and needs nothing from me* and *finished and needs a decision*.**
 * >
 * > ⛔ **What must not happen is a rail row reading `done` with no visible difference when a
 * > decision is waiting.**
 *
 * ## ⛔ There was no row. That is the first thing this file measures.
 *
 * ⚠️ **`TaskRow` never crossed IPC and no surface drew one** — the transcript declines a row for
 * `task_replied` twice over (*"what a task is FOR is a board"*), and the board does not exist.
 * ⛔ What a person actually met was the reply's WORDS, arriving in the parent's transcript through
 * `queueMessage` as a plain `user_turn` — **drawn as their own bubble, under `You`**. `214` removed
 * 12,646 messages that rendered injected material as *"You"* and `278` built `ContinuationEntry`
 * so the go-ahead would not be one more; `393` and `400`/`404` shipped two more after both.
 *
 * ## ⚑ So the row is the turn, and it gains an authorship and a subject
 *
 * ⛔ **One spread writes both keys** — `attribution: 'app_authored'` and `work` — so a turn can
 * never carry the facts under the person's name, nor the authorship with the go-ahead's entry.
 * ⚠️ **And it rides the HELD path too**, because a parent with two children is busy exactly when
 * one of them finishes.
 *
 * ## 🔴 Where the brief is wrong, measured here rather than asserted at it
 *
 * ⛔ §2 of the brief says the flag *"crosses several states and does not only qualify `done`"*.
 * **Half true, and the false half is the first one** — see §1. `needsUserAction === true` occurs
 * in exactly ONE state, and it is the FALSE value that crosses states and means two different
 * things depending on which.
 *
 * ⚑ **D-016 · the tree** — a task is a PIECE now, given with `give_work` (whose brief is the
 * worker's first turn) and answered with `reply_to_parent` naming it; a report carries the piece's
 * id and LABEL (`W1.2`, what a person quotes), its `owner`, and the ids of the resources a reply
 * handed in, where it carried a task id, a number, `assignedTo` and one document.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools.** The only double is the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')
const rendererRoot = join(here, '../src/renderer/src')

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

/** ⛔ **Comment-stripped**, so a census reads what the code does and not what a docblock says. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every file under a root, as `{ path, text }` — the census shape `404` uses. */
function filesUnder(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(entry)) {
        out.push({
          path: relative(root, full).replaceAll('\\', '/'),
          text: readFileSync(full, 'utf8'),
        })
      }
    }
  }
  walk(root)
  return out
}

describe('406 · finished, and finished with a question', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-finished-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-finished-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
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

  const entries = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const ledger = (sessionId: string): TranscriptEvent[] =>
    entries(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
    ledger(sessionId).filter(
      (event): event is Extract<TranscriptEvent, { type: 'user_turn' }> =>
        event.type === 'user_turn',
    )

  /**
   * A PM, a worker, and one piece of work already given — `373`'s helper. ⚑ **D-016** — the give
   * starts the worker, and the brief is its first turn; `task` is the piece's LABEL, which is what a
   * reply names, and `piece` its id.
   */
  const workWasGiven = async (
    text = 'the work',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    task: string
    piece: string
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const siblings = [`worker-${String(nth)}-a`, `worker-${String(nth)}-b`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    // ⚑ Any agent may give work to any agent this app holds (D-014), so the PM needs no grant here.
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: siblings[0],
      title: 'The work this dispatch is about',
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const piece = store.piecesOwnedBy(worker).at(-1)
    if (piece === undefined) throw new Error('no piece was recorded')
    return { pm, worker, pmTools, task: piece.label, piece: piece.piece }
  }

  const reply = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    callOn(agentToolsFor(host, sessionId), 'reply_to_parent', args)

  /** A report as the wire carries one — the shape the renderer is handed. */
  const report = (over: Partial<WorkReport> = {}): WorkReport => ({
    piece: 'work_1',
    label: 'W1.3',
    state: 'answered',
    outcome: 'done',
    ...over,
  })

  const at = (event: TranscriptEvent, when = 1_000): PersistedEventInfo =>
    ({ sessionId: 'sess_1', ordinal: 1, at: when, event }) as PersistedEventInfo

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · what `needs_user_action` actually is — measured, because the brief inferred it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the flag, derived rather than restated', () => {
    it('🔴 `true` reaches exactly ONE state, and the brief says it crosses several', async () => {
      // ⛔ **The brief's §2**: *"so this flag crosses several states and does not only qualify
      // `done`."* ⚑ The second half is true and the first is not, and the difference matters
      // because §4 asks every state to render correctly: `true` is only ever `answered`.
      const reached = new Set<TaskState>()
      for (const outcome of TASK_OUTCOMES) {
        const { worker, task } = await workWasGiven(`work for ${outcome}`)
        const done = await reply(worker, {
          piece: task,
          outcome,
          summary: `it went ${outcome}`,
          needs_user_action: true,
        })
        expect(done.outcome, JSON.stringify(done)).toBe('ok')
        const row = store.piecesOwnedBy(worker).find((one) => one.label === task)
        expect(row?.needsUserAction).toBe(true)
        reached.add(row?.state as TaskState)
      }
      // 🔴 **One state for all THREE outcomes** — so the second half of the brief's sentence is
      // right (`blocked` and `failed` carry it too) and the first half is wrong.
      expect([...reached]).toEqual(['answered'])
    })

    it('⛔ every other state is `false` BY CONSTRUCTION, and the fold is what makes it so', () => {
      // ⚠️ **Over the fold rather than over a live host**, because the claim is about paths a live
      // run cannot all reach: the only writer is the `work_replied` branch, and it settles to
      // `answered`. ⛔ A test that drove three states through a provider would measure three
      // samples; this measures the transition table.
      const given = (id: string, label: string): TranscriptEvent => ({
        type: 'work_given',
        piece: id,
        label,
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'The work',
        brief: 'the work',
        messageId: `msg_${id}`,
      })
      const rows = derivePieces('sess_worker', [
        at(given('work_w', 'W1.1'), 1),
        at(
          { type: 'message_unqueued', messageId: 'msg_work_w', reason: 'sent', text: 'the work' },
          2,
        ),
        at({ type: 'turn', state: 'completed' }, 3),
        at(given('work_x', 'W1.2'), 4),
        at(
          {
            type: 'message_unqueued',
            messageId: 'msg_work_x',
            reason: 'cancelled',
            text: 'the work',
          },
          5,
        ),
      ])
      expect(rows.map((row) => [row.state, row.needsUserAction])).toEqual([
        ['stalled', false],
        ['withdrawn', false],
      ])
    })

    it('🔴 `false` means two different things and the STATE is what carries the difference', () => {
      // ⛔ **§4's *"`null` is not `false`"*, landing on the meaning rather than on the type.** The
      // row's boolean is never null; what may not exist is an agent having SAID anything, and that
      // absence is carried by the state — `PieceRow.needsUserAction`'s own docblock.
      expect(personsPart(report({ state: 'answered' }))).toBe('asked-nothing')
      expect(personsPart(report({ state: 'stalled', outcome: undefined }))).toBe('nobody-has-said')
      expect(personsPart(report({ needsUserAction: true }))).toBe('must-act')
      // ⚑ And the mark is drawn for exactly one of the three.
      expect(personsMark(report({ needsUserAction: true }))).toBe(A_PERSON_MUST_ACT)
      expect(personsMark(report({ state: 'answered' }))).toBeNull()
      expect(personsMark(report({ state: 'stalled', outcome: undefined }))).toBeNull()
    })

    it('⛔ a value the wire should not carry is refused, not read as truthy', () => {
      // 🔴 **Reachable rather than defensive.** `toPersistedEvents` CASTS, and `read-bundle.ts`
      // validates an imported entry as `z.object({ type: z.string().min(1) }).passthrough()` and
      // writes it verbatim — so `false`, `0` and `"no"` are bytes somebody can hand this app.
      for (const planted of [false, 0, 'no', 'yes', null]) {
        const bogus = { ...report(), needsUserAction: planted } as unknown as WorkReport
        expect(personsPart(bogus), `a planted ${JSON.stringify(planted)} was read as a claim`).toBe(
          'asked-nothing',
        )
      }
      // ⚑ The paired positive, so the sweep above is a statement about the guard and not about a
      // function that always answers the same thing.
      expect(personsPart(report({ needsUserAction: true }))).toBe('must-act')
    })

    it('🔴 the claim needs the STATE too, and the first version read the flag alone', () => {
      // ⛔ **`needsUserAction === true` can only be written by the `work_replied` branch**, which
      // settles to `answered` — so a report carrying it in any other state did not come from this
      // app's fold, and honouring it would draw *a person has to act* on work nothing has
      // answered. ⚠️ Found in review: `WorkFacts` justified a layout decision on an invariant its
      // own reader did not enforce.
      for (const state of TASK_STATES.filter((one) => one !== 'answered')) {
        const off = report({ state, outcome: undefined, needsUserAction: true })
        expect(personsPart(off), `a ${state} report claimed a person must act`).toBe(
          'nobody-has-said',
        )
        expect(personsMark(off)).toBeNull()
      }
      expect(personsMark(report({ needsUserAction: true }))).toBe(A_PERSON_MUST_ACT)
    })

    it('⛔ a `work` that is not a report SHAPE never reaches the row at all', () => {
      // 🔴 **The one thing nothing checked.** Three fields have a guard of their own; `taskId` and
      // `number` were PRINTED, so a `work: "hello"` on an imported ledger passed `!== undefined`,
      // reached the row and drew *Task #undefined*. ⚑ **D-016** — the printed pair is `piece` and
      // `label` now, and the shape is asked of them.
      for (const planted of [
        'hello',
        42,
        null,
        [],
        {},
        { piece: 't' },
        { piece: 1, label: 'W1.1', state: 's' },
        { piece: 't', label: 1, state: 's' },
      ]) {
        expect(isAWorkReport(planted), `${JSON.stringify(planted)} was admitted`).toBe(false)
      }
      expect(isAWorkReport(report())).toBe(true)
      // ⚑ Structural, not exhaustive: a state this app has never heard of is still a REPORT, and
      // the reading's own fallbacks are what answer for it.
      expect(isAWorkReport({ piece: 't', label: 'W1.1', state: 'sideways' })).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the two reports, and the invariants they hold by construction
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what a parent is told, as facts', () => {
    // ⚑ **506 · the conversation the work is with is on the row now**, and the compiler is what
    // says so: widening the two constructors' `Pick` made every fixture here a type error rather
    // than a silently short report.
    // ⚑ **D-016** — a piece: its id, its label and its owner.
    const task = { piece: 'work_9', label: 'W1.4', owner: 'sess_child' }

    it('⛔ a reply reports `answered` and never the row it was handed', () => {
      // ⚠️ **`deliverReply` is given the piece as it was BEFORE the reply** — the lookup found it
      // open — so copying `PieceRow.state` would put `working` on a report about an answer.
      const made = workAnswered(task, { outcome: 'done', needsUserAction: false }, [])
      expect(made).toEqual({
        piece: 'work_9',
        label: 'W1.4',
        owner: 'sess_child',
        state: 'answered',
        outcome: 'done',
      })
      // ⛔ **Absent, never `false`** — `TaskRepliedEvent`'s own shape, and what makes absence mean
      // *the agent said no* rather than *this app forgot*.
      expect(Object.hasOwn(made, 'needsUserAction')).toBe(false)
      // 🔴 **510 · this line USED to mean *the field is refused from the contract*, and it now
      // means *this reply registered no document*.** ⚠️ It stayed green through the change, which
      // is why it is re-pointed rather than left: an assertion that keeps passing while meaning
      // something new is `a-corrected-anchor-keeps-a-verdict-it-never-earned` in test form. ⛔ The
      // paired positive is two tests down; without it this arm passes on a build where the field
      // was never added. ⚑ **D-016 · a document is a RESOURCE now** — this reply handed in none.
      expect(Object.hasOwn(made, 'resources')).toBe(false)
      expect(Object.hasOwn(made, 'stalledBecause')).toBe(false)
    })

    it('⚑ the claim rides it, and every field on a report is one a row READS', () => {
      const made = workAnswered(task, { outcome: 'blocked', needsUserAction: true }, [])
      expect(made.needsUserAction).toBe(true)
      expect(made.outcome).toBe('blocked')
      // ⛔ **`to` and `documentId` were on this contract and nothing rendered either** (from the
      // review). A dead field on a DURABLE wire type is written into every parent's ledger for
      // ever, and the next reader has to decide whether the missing consumer is an omission or a
      // ruling. ⚑ Both facts are in `replyText`'s own words, on the very row this describes.
      //
      // 🔴 **506 and 510 · both are back now, and the rule above is why rather than despite.** The
      // removal argument was a CONDITION — *nothing rendered it* — and each field has its reader:
      // `where-the-work-is.ts` is what a person presses to reach the conversation, and
      // `the-document-a-report-names.ts` is what a person presses to READ the answer. ⚠️ Neither
      // is recoverable from the sentence beside it, which `work-report.ts` forbids by name.
      //
      // ⚑ **This census is the NULL arm** — a reply whose summary was the whole answer. The arm
      // that carries one is the test below, and the two together are what make either meaningful.
      // ⚑ **D-016** — `assignedTo` is `owner`, and the piece's id and label are what `taskId` and
      // `number` were.
      expect(Object.keys(made).sort()).toEqual([
        'label',
        'needsUserAction',
        'outcome',
        'owner',
        'piece',
        'state',
      ])
      expect(Object.keys(workUndriven(task, 'turn_ended')).sort()).toEqual([
        'label',
        'owner',
        'piece',
        'stalledBecause',
        'state',
      ])
    })

    it('🔴 510 · a reply WITH a resource carries it, and a stall structurally cannot', () => {
      // ⛔ **The paired positive for the two absences above.** Without it, every `resources`
      // assertion in this file passes on a build where `510` was never written. ⚑ **D-016** — a
      // reply's files are RESOURCES, carried by id.
      const made = workAnswered(task, { outcome: 'done', needsUserAction: false }, ['res_1'])
      expect(made.resources).toEqual(['res_1'])
      expect(Object.keys(made).sort()).toEqual([
        'label',
        'outcome',
        'owner',
        'piece',
        'resources',
        'state',
      ])
      // 🔴 **The asymmetry with `owner`, asserted rather than argued.** `506` had to put the
      // conversation on BOTH constructors; a resource can only ever be on one, because
      // `resources` reach a `PieceRow` through the `work_replied` branch alone and that branch
      // settles the row to `answered` — which `TASK_IS_OPEN` excludes, so the fold drops it from
      // `open` and `stall` returns on a row `open` no longer holds. ⚑ `workUndriven` therefore
      // takes no such argument at all, and this is the line that would notice if it grew one.
      expect(TASK_IS_OPEN.answered).toBe(false)
      for (const cause of TASK_STALL_CAUSES)
        expect(Object.hasOwn(workUndriven(task, cause), 'resources'), cause).toBe(false)
    })

    it('⛔ a notice reports `stalled` WITH its cause, and never an outcome', () => {
      for (const cause of TASK_STALL_CAUSES) {
        const made = workUndriven(task, cause)
        expect(made.state).toBe('stalled')
        expect(made.stalledBecause).toBe(cause)
        // ⚑ `PieceRow.stalledBecause`'s invariant — *non-null if and only if `stalled`* — held here
        // the way the fold holds it: by construction, because these two are the only writers.
        expect(Object.hasOwn(made, 'outcome')).toBe(false)
        expect(Object.hasOwn(made, 'needsUserAction')).toBe(false)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the parent's own ledger — the row a person reads
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the turn that carries the reply', () => {
    it('🔴 an idle parent gets a turn marked as BroBot’s and carrying the facts', async () => {
      const { pm, worker, task, piece } = await workWasGiven()
      const done = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'I wrote the migration',
        needs_user_action: true,
      })
      expect(done.delivered).toBe('sent')
      const turns = turnsIn(pm)
      const carried = turns.at(-1)
      expect(carried?.attribution).toBe('app_authored')
      expect(carried?.work).toEqual({
        piece,
        label: task,
        // ⚑ **506 · the conversation that did the work, on the wire the parent reads.** ⛔ The id
        // was on this turn already, as `relayedFrom` (`439`) — but that field says *whose WORDS
        // these are*, and the undriven notice one test down may not carry it. This one is the
        // SUBJECT and is on both halves.
        owner: worker,
        state: 'answered',
        outcome: 'done',
        needsUserAction: true,
      })
      // ⛔ **The words are unchanged and are the same string `replyText` composes** — the facts are
      // beside the sentence, never instead of it.
      expect(carried?.text).toContain('I wrote the migration')
      expect(carried?.text).toContain(A_PERSON_MUST_ACT_SENTENCE)
    })

    it('⛔ the PERSON’s own turn carries neither, and that is the pairing', async () => {
      // ⚠️ **The control that makes the assertion above mean something.** A host that stamped every
      // turn `app_authored` would pass the test above and would be the defect with the sign
      // flipped: the person's words drawn as BroBot's.
      const { pm } = await workWasGiven()
      await host.send(pm, 'a sentence a person typed', window)
      const mine = turnsIn(pm).at(-1)
      expect(mine?.text).toBe('a sentence a person typed')
      expect(mine?.attribution).toBeUndefined()
      expect(mine?.work).toBeUndefined()
    })

    it('⛔ a reply that said nothing about a person carries no key at all', async () => {
      const { pm, worker, task } = await workWasGiven()
      await reply(worker, { piece: task, outcome: 'done', summary: 'nothing else needed' })
      const carried = turnsIn(pm).at(-1)
      expect(carried?.work?.outcome).toBe('done')
      // 🔴 **Absent, and the row must read it as *the agent said no* rather than as *nobody has
      // said*** — see §1. A `false` here would be this app inventing a claim.
      expect(Object.hasOwn(carried?.work ?? {}, 'needsUserAction')).toBe(false)
    })

    it('🔴 the UNDRIVEN notice carries one too, and it is the other half of the surface', async () => {
      // ⛔ **A reply and a notice are one surface to a reader** — both are *what happened to work
      // this conversation gave out*, and until `406` only the words differed: both arrived as the
      // person's own bubble. ⚑ Driven through the real trigger, which is the CHILD's own `status`
      // event, and never by calling the push.
      const { pm, worker } = await workWasGiven()
      // ⛔ **496 · ended by the PERSON, and the swap is the ruling** (HO-034 §1). ⚠️ This test needs
      // an ending that lands on a turn IN FLIGHT — `turn_interrupted` is the whole assertion — and a
      // turn in flight in this app is one parked on somebody's permission card, which is the one
      // state an agent's ending is now refused for. ⚑ **It is the same teardown**: `endAgent`
      // escalates to `THE_APP_ITSELF` and calls exactly this, so the push, its cause and its timing
      // are written by the same code. ⚠️ **The window CLAIMS it first**, which is `203`'s rail
      // honoured rather than dodged: a spawned child is nobody's until somebody takes it over.
      host.claimSession(worker, window)
      await host.close(worker, window)
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text.includes('is not being worked on')),
        'the parent to be told nothing is driving the work',
      )
      const told = turnsIn(pm).find((turn) => turn.text.includes('is not being worked on'))
      expect(told?.attribution).toBe('app_authored')
      expect(told?.work?.state).toBe('stalled')
      // ⚠️ **The cause is measured rather than assumed, and `404`'s de-duplicator means the parent
      // is told ONCE — with the cause that was true at the moment it was told.** ⛔ Which is the
      // whole point of the report being a SNAPSHOT: it says what the parent was actually sent.
      //
      // 🔴 **D-016c · `turn_interrupted`, and this is a real behaviour change rather than a
      // re-spelling** (`609` had made it the conversation's ending). ⛔ At the moment `close()`
      // writes the `turn` row, the child is still parked on its permission card — an OPEN routing
      // only a person can settle — so the composition reads `waiting-on-a-person` and
      // {@link stalledWithACause} refuses the notice. ⚑ The teardown then strands that request and
      // writes the session's ending, the composition lets go, and the cause on the stalled row is
      // the interrupted turn's: a stop moves no piece (`05`: an agent is never dead), so the ending
      // re-words nothing.
      //
      // ⚠️ **The parent is still told, exactly once**, and it is told the turn's own fact. ⛔ What
      // D-016c changed is WHICH cause the parent is sent, not whether it is sent.
      expect(told?.work?.stalledBecause).toBe('turn_interrupted')
      // 🔴 **506 · and it names the conversation the work is with, which is the half that had
      // nothing.** ⛔ The answered reply has carried this id since `439`, as `carriedFor`; a stall
      // carries no `carriedFor` and must not — the child said nothing, so no words came from it —
      // and the id reached a parent's screen only inside the sentence. ⚑ Now both halves of one
      // surface carry it as a FACT, which is what `where-the-work-is.ts` presses on.
      expect(told?.work?.owner).toBe(worker)
      // ⚠️ **The paired NEGATIVE, and it is the distinction the field exists for.** `carriedFor`
      // says *whose WORDS these are*; this notice is BroBot's sentence about a child that wrote
      // none, so `relayedFrom` stays absent while `work.owner` is present.
      expect(told?.relayedFrom).toBeUndefined()
      expect(store.piecesOwnedBy(worker).at(-1)?.stalledBecause).toBe('turn_interrupted')
      // ⛔ **No outcome and no claim** — nothing has replied, so an absent claim here means
      // *nobody has said* rather than *the agent said no*.
      expect(Object.hasOwn(told?.work ?? {}, 'outcome')).toBe(false)
      expect(Object.hasOwn(told?.work ?? {}, 'needsUserAction')).toBe(false)
    })

    it('⛔ the child’s OWN ledger is untouched: no report, and still no transcript row', async () => {
      // ⚠️ **`393`'s ruling is not widened.** The child's transcript draws nothing for
      // `work_replied` because the tool call that produced it is already on screen; this dispatch
      // is about the PARENT's ledger, where there is nothing else at all.
      const { worker, task } = await workWasGiven()
      await reply(worker, { piece: task, outcome: 'done', summary: 'done' })
      expect(turnsIn(worker).some((turn) => turn.work !== undefined)).toBe(false)
      const state = createTranscript()
      for (const entry of entries(worker)) applyEvent(state, entry.event, entry.at)
      expect(state.items.some((item) => item.kind === 'workReport')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the busy parent — the branch that would have dropped it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a reply to a parent that is mid-turn', () => {
    it('🔴 the HELD row carries the report, and so does the turn it becomes', async () => {
      const { pm, worker, task } = await workWasGiven()
      // ⛔ **A real running turn on the parent**, so `queueMessage` takes the branch that holds.
      await host.send(pm, 'keep the parent busy', window)
      const before = ledger(pm).filter((event) => event.type === 'message_queued').length
      const done = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'held then sent',
        needs_user_action: true,
      })
      expect(done.delivered, JSON.stringify(done)).toBe('held')
      const queued = ledger(pm).filter((event) => event.type === 'message_queued')
      expect(queued.length).toBe(before + 1)
      const held = queued.at(-1)
      expect(held?.type === 'message_queued' ? held.work?.needsUserAction : null).toBe(true)
      // ⚑ **And it survives the flush**, which is the half a report living only on the event would
      // have lost: the turn is built from the mailbox record, not from the queue-time row.
      // ⚠️ The double parks its turn on a permission card; answering it is what lets the turn
      // reach a terminal, which is the boundary the flush hangs off.
      await host.respondPermission(pm, 'turn_1_perm', { outcome: 'allow' }, window)
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text.includes('held then sent')),
        'the held reply to flush',
      )
      const flushed = turnsIn(pm).find((turn) => turn.text.includes('held then sent'))
      expect(flushed?.attribution).toBe('app_authored')
      expect(flushed?.work?.needsUserAction).toBe(true)
      expect(flushed?.work?.label).toBe(task)
    })

    it('🔴 the app going away holding a reply leaves it WAITING, and the turn the next start makes of it still knows what it is', async () => {
      // ⛔ **The branch a quit takes.** ⚑ **D-017 · R3 moved it**: `closeAll` used to abandon what
      // a conversation was holding, and the property here was that the ENDING kept the report. A
      // quit is a stop now and ends nothing it held — the `message_queued` row stays open, with the
      // report on it, and the next start rebuilds the message from that row and sends it first. ⚑
      // So the property moves with it: the row that waits keeps the report, and so does the turn
      // it becomes, or it is redrawn as the person's own.
      const { pm, worker, task } = await workWasGiven()
      await host.send(pm, 'keep the parent busy', window)
      const held = await reply(worker, {
        piece: task,
        outcome: 'blocked',
        summary: 'held when the app went away',
        needs_user_action: true,
      })
      expect(held.delivered, JSON.stringify(held)).toBe('held')
      await host.closeAll()
      // ⛔ **No ending at the quit** — the held row waits, and it still carries the report.
      const waiting = ledger(pm)
        .filter((event) => event.type === 'message_queued')
        .at(-1)
      const waitingId = waiting?.type === 'message_queued' ? waiting.messageId : null
      expect(waiting?.type === 'message_queued' ? waiting.work?.needsUserAction : null).toBe(true)
      expect(
        ledger(pm).filter(
          (event) => event.type === 'message_unqueued' && event.messageId === waitingId,
        ),
      ).toEqual([])

      // ⚑ **The next launch, and the next start** — the held reply goes first.
      host = buildHost()
      await host.resumeSession(pm, window)
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text.includes('held when the app went away')),
        'the reply the quit left to go at the next start',
      )
      const flushed = turnsIn(pm).find((turn) => turn.text.includes('held when the app went away'))
      expect(flushed?.attribution).toBe('app_authored')
      expect(flushed?.work?.needsUserAction).toBe(true)
      expect(flushed?.work?.label).toBe(task)
    })

    it('⛔ a message a PERSON queued carries no report, on both rows', async () => {
      const { pm } = await workWasGiven()
      await host.send(pm, 'keep the parent busy', window)
      const outcome = await host.queueMessage(pm, 'the person typed this', window)
      expect(outcome.outcome).toBe('queued')
      const held = ledger(pm)
        .filter((event) => event.type === 'message_queued')
        .at(-1)
      expect(held?.type === 'message_queued' ? held.work : 'missing').toBeUndefined()
      await host.respondPermission(pm, 'turn_1_perm', { outcome: 'allow' }, window)
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text === 'the person typed this'),
        'the queued message to flush',
      )
      const flushed = turnsIn(pm).find((turn) => turn.text === 'the person typed this')
      expect(flushed?.attribution).toBeUndefined()
      expect(flushed?.work).toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the fold, and what the row becomes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the transcript item', () => {
    const foldOf = (events: TranscriptEvent[]) => {
      const state = createTranscript()
      events.forEach((event, index) => applyEvent(state, event, 1_000 + index))
      return state
    }

    it('🔴 a turn carrying a report is a work row and NEVER the person’s bubble', () => {
      const state = foldOf([
        { type: 'user_turn', text: 'a person typed this' },
        { type: 'user_turn', text: 'W1.3 …', attribution: 'app_authored', work: report() },
      ])
      expect(state.items.map((item) => item.kind)).toEqual(['user', 'workReport'])
      const row = state.items[1]
      expect(row?.kind === 'workReport' ? row.report.outcome : null).toBe('done')
      // ⛔ **A turn, because it IS one** — `045` opens a turn row from this event and from nothing
      // else, and the provider really received the words.
      expect(state.changes.turn).toBe(2)
    })

    it('⛔ an app-authored turn with nothing to report is still the go-ahead’s entry', () => {
      // ⚠️ **The pairing.** A fold that read the ATTRIBUTION to pick the entry would draw the
      // go-ahead as a work row with no facts; one that read the subject and forgot the
      // authorship would draw a reply as the person's. Both arms are asserted.
      const state = foldOf([{ type: 'user_turn', text: 'Go ahead.', attribution: 'app_authored' }])
      expect(state.items.map((item) => item.kind)).toEqual(['continuation'])
    })

    it('🔴 a `work` that is not a report SHAPE folds to the person’s row, not to a broken one', () => {
      // ⛔ **The predicate is tested one section up; this is the FOLD asking it.** ⚠️ Found by the
      // row verifier: a mutation swapping `isAWorkReport` back to `!== undefined` survived,
      // because every assertion about the shape was about the function and none about the caller.
      for (const planted of ['hello', 42, null, { piece: 't' }]) {
        const state = foldOf([
          { type: 'user_turn', text: 'a person typed this', work: planted as never },
        ])
        expect(
          state.items.map((item) => item.kind),
          JSON.stringify(planted),
        ).toEqual(['user'])
      }
      const queued = foldOf([
        { type: 'message_queued', messageId: 'm', text: 'x', work: 'hello' as never },
      ])
      const row = queued.items[0]
      expect(row?.kind === 'queued' ? row.report : 'missing').toBeUndefined()
    })

    it('⛔ a HELD report is a queued row that knows what it is', () => {
      const state = foldOf([
        { type: 'message_queued', messageId: 'msg_1', kind: 'work', text: 'held', work: report() },
      ])
      const row = state.items[0]
      expect(row?.kind).toBe('queued')
      expect(row?.kind === 'queued' ? row.report?.piece : null).toBe('work_1')
    })

    it('🔴 an ENDING with no beginning still rebuilds a report row, not the person’s', () => {
      // ⛔ **`054` pages the transcript**, so a window can hold `message_unqueued` without ever
      // seeing the `message_queued` — and the fold has a branch for exactly that. ⚠️ Found in
      // review: without the report on the ENDING that rebuild drew an app-authored reply under
      // `You`, which is the defect this dispatch exists to remove, on the one path that never
      // sees the row it repaired.
      const state = foldOf([
        {
          type: 'message_unqueued',
          messageId: 'msg_1',
          reason: 'abandoned',
          text: 'W1.3 …',
          work: report(),
        },
      ])
      const row = state.items[0]
      expect(row?.kind).toBe('queued')
      expect(row?.kind === 'queued' ? row.report?.piece : null).toBe('work_1')
      // ⚑ The control: the same ending with no report rebuilds the person's own row.
      const mine = foldOf([
        { type: 'message_unqueued', messageId: 'msg_2', reason: 'abandoned', text: 'I typed this' },
      ])
      const plain = mine.items[0]
      expect(plain?.kind === 'queued' ? plain.report : 'missing').toBeUndefined()
    })

    it('⛔ the row is visible in BOTH modes, and hiding it would be the whole defect', () => {
      const state = foldOf([
        { type: 'user_turn', text: 'W1.3 …', attribution: 'app_authored', work: report() },
      ])
      const row = state.items[0]
      if (row === undefined) throw new Error('nothing folded')
      for (const mode of ['normal', 'debug'] as const) {
        expect(isVisibleIn(mode, row), `hidden in ${mode}`).toBe(true)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the words a row renders, enumerated from the vocabulary and not from the brief
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the reading', () => {
    it('⛔ every `TaskState` has a word, and none of them is the next state’s', () => {
      // ⚠️ **Looped over `TASK_STATES`, never over a literal list** — §4 of the brief, and
      // `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
      const words = TASK_STATES.map((state) => WORK_STATE_WORD[state])
      expect(words.filter((word) => word.length > 0)).toHaveLength(TASK_STATES.length)
      expect(new Set(words).size).toBe(TASK_STATES.length)
    })

    it('🔴 two `done` rows differ by the mark and by NOTHING else', () => {
      // ⛔ **HO-019 §2's pair, at the projection layer.** The DOM file measures the same two rows
      // on a real screen; this is the half that says the difference is not a re-hue.
      const quiet = workReading(report())
      const loud = workReading(report({ needsUserAction: true }))
      expect(quiet.word).toBe('answered')
      expect(quiet.outcome).toBe('done')
      expect(loud.outcome).toBe('done')
      expect(quiet.mark).toBeNull()
      expect(loud.mark).toBe(A_PERSON_MUST_ACT)
      expect({ ...quiet, mark: null }).toEqual({ ...loud, mark: null })
    })

    it('⛔ a stall’s glance is its CAUSE, from the one table, and never a second prose line', () => {
      // 🔴 **The photograph's ruling** — a pill may restate what the prose says; a second prose
      // line may not. ⚑ `undrivenSentence`'s words, so the pill and the message the parent was
      // sent give one account of one observation.
      const stalled = workReading(
        report({ state: 'stalled', outcome: undefined, stalledBecause: 'app_restarted' }),
      )
      expect(stalled.word).toBe(undrivenSentence('app_restarted'))
      expect(stalled.word).toBe('the app restarted while it was open')
      expect(stalled.outcome).toBeNull()
      // ⛔ **The state word is the FALLBACK, not the answer** — a stall with no cause on the wire
      // still reads as something true.
      expect(workReading(report({ state: 'stalled', outcome: undefined })).word).toBe(
        'not being worked on',
      )
      expect(workReading(report()).word).toBe('answered')
    })

    it('⛔ a state and a cause this app has never heard of render, and do not throw', () => {
      // 🔴 **`undrivenSentence` calls `.replace` on the lookup and would THROW.** Its other two
      // callers read a value the fold produced; this one reads a wire, and an imported `.brobot`
      // bundle is written through `.passthrough()`.
      const bogus = report({
        state: 'sideways' as TaskState,
        outcome: 'sideways' as never,
        stalledBecause: 'the-sun-went-out' as never,
      })
      const reading = workReading(bogus)
      expect(reading.word).toBe('in a state this app has not been taught')
      expect(reading.outcome).toBeNull()
      // 🔴 **A PROTOTYPE key, and it is the input both guards were written for and admitted**
      // (from the review). `'constructor' in UNDRIVEN_SENTENCES` is `true`, and
      // `UNDRIVEN_SENTENCES['constructor']` is a FUNCTION — `.replace` on it throws inside a
      // `computed` and takes the row with it. ⛔ `WORK_STATE_WORD['toString']` is a function too,
      // which is neither `null` nor `undefined`, so the `??` fallback could not fire either.
      for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
        const inherited = workReading(
          report({ state: key as TaskState, outcome: undefined, stalledBecause: key as never }),
        )
        expect(inherited.word, `a ${key} state`).toBe('in a state this app has not been taught')
        const stalled = workReading(
          report({ state: 'stalled', outcome: undefined, stalledBecause: key as never }),
        )
        expect(stalled.word, `a ${key} cause`).toBe('not being worked on')
      }
      // ⚑ The paired positive: the same fields with real values all resolve.
      const real = workReading(
        report({ state: 'stalled', outcome: 'failed', stalledBecause: 'turn_ended' }),
      )
      expect(real.word).toBe(undrivenSentence('turn_ended'))
      expect(real.outcome).toBe('failed')
    })

    // ⚑ **D-016** — the LABEL is what a person quotes now (there is no *Task #N*).
    it('⚑ the heading is the LABEL a person quotes and never an id', () => {
      const reading = workReading(report({ label: 'W1.12', piece: 'work_deadbeef' }))
      expect(reading.heading).toBe('W1.12')
      expect(reading.heading).not.toContain('work_')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · one vocabulary — the claim said once, in three registers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the claim, and the tables behind it', () => {
    it('🔴 the mark, the sentence and the raw stream are one string', () => {
      expect(A_PERSON_MUST_ACT).toBe('a person has to act')
      expect(A_PERSON_MUST_ACT_SENTENCE).toBe('a person has to act before this can go further')
      // ⛔ **The words a parent AGENT is sent** — `393`'s pin, unchanged, and it is what makes the
      // composition above load-bearing rather than decorative.
      // ⚑ **D-016 · commit 7 · R3 — the holder by its name** (the host passes
      // `whatToCallTheConversation` of the piece's owner), never its id.
      const sentence = replyText(
        { label: 'W1.2', title: 'The work' },
        'Ada',
        { outcome: 'done', summary: 's', needsUserAction: true },
        [],
        // ⚑ No new brief of the piece was held for its holder as it answered.
        false,
      )
      expect(sentence).toContain('That agent said a person has to act before this can go further.')
      // ⚑ **And the raw event stream**, which used to say `needs a person` — a third spelling of
      // one claim, and the surface a debugger joins to the row.
      const raw = describeEvent({
        type: 'work_replied',
        piece: 'work_1',
        outcome: 'done',
        summary: 's',
        resources: [],
        needsUserAction: true,
      })
      expect(raw).toContain(A_PERSON_MUST_ACT)
      expect(raw).not.toContain('needs a person')
      // ⚑ **And the turn's own line names the piece it is about** (from the review — the clause had
      // no assertion). ⛔ Nothing else off the report is printed: the outcome and the mark are on
      // the row a person reads, and `work_replied` already carries them in the child's stream.
      const turn = describeEvent({
        type: 'user_turn',
        text: 'W1.3 …',
        attribution: 'app_authored',
        work: report(),
      })
      expect(turn).toContain('work_1')
      expect(turn).toContain('(This app wrote it)')
      expect(turn).not.toContain('done')
      expect(describeEvent({ type: 'user_turn', text: 'a person typed this' })).not.toContain('·')
    })

    it('⛔ the stall sentences are ONE table, and the renderer reads it rather than copying it', () => {
      // 🔴 **`400`'s rule with a third caller** — the move to `shared/` is what made the third
      // possible, and a copy in the renderer is the thing this census exists to catch.
      const words = filesUnder(rendererRoot).filter((file) =>
        Object.values(UNDRIVEN_SENTENCES).some((sentence) =>
          codeOnly(file.text).includes(sentence),
        ),
      )
      expect(words.map((file) => file.path)).toEqual([])
      // ⚑ Non-vacuous: the sentences really are findable where they live.
      expect(codeOnly(readFileSync(join(sharedRoot, 'tasks.ts'), 'utf8'))).toContain(
        UNDRIVEN_SENTENCES.app_restarted,
      )
    })

    it('⛔ exactly two places build a report, and they are the two the app tells a parent from', () => {
      // ⚑ **Every builder is in the search** — a builder the regex could not see would let a third
      // FILE arrive unseen (`a-negative-is-only-as-strong-as-the-search-shape`, found by `661`'s
      // review). ⛔ D-016c deleted `661`'s third, `workWaiting`, with the corrections it built.
      const builders = filesUnder(mainRoot)
        .filter((file) => /workAnswered\(|workUndriven\(/.test(codeOnly(file.text)))
        .map((file) => file.path)
        .sort()
      expect(builders).toEqual(['runtime/reply-rails.ts', 'runtime/runtime-host.ts'])
      // ⛔ **And exactly one expression writes the authorship**, so a turn cannot carry the facts
      // under the person's name. Two sites, because a held reply flushes through a second publish.
      const source = codeOnly(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      // ⚠️ **Read as PUBLISH BLOCKS rather than as a line count**, because the claim is about what
      // travels together: a `user_turn` that mentions the subject must mention the authorship in
      // the same object literal. ⛔ A count of two literals would have gone green on a host that
      // wrote the two keys in two statements.
      const turns = source
        .split("type: 'user_turn',")
        .slice(1)
        // ⛔ **BRACE-MATCHED, and the two cheaper cuts are both recorded because both were
        // wrong.** An `indexOf('})')` cut every block short of the line it exists to read — a
        // conditional spread ends `: {})`. A cut at the first line whose trim is exactly `})`
        // then ran 1,372 characters past `endPlanMode`'s ONE-LINE publish into unrelated code.
        // ⚑ Counting braces from inside the literal is the only cut right for both, and the
        // assertions below pin that it stopped where it should.
        .map((chunk) => {
          let depth = 1
          for (let at = 0; at < chunk.length; at++) {
            if (chunk[at] === '{') depth += 1
            else if (chunk[at] === '}') depth -= 1
            if (depth === 0) return chunk.slice(0, at + 1)
          }
          return chunk
        })
      // ⛔ **FOUR publishers of a turn, and the count is asserted so a fifth has to come past
      // this line.** `endPlanMode`'s go-ahead, the idle `send`, `runSendInterrupting`, and the
      // flush. ⚠️ A report delivered through the third would be silently unmarked — it is not
      // reachable from `deliverReply` or `tellOneParent` today, and this is where that stops
      // being an accident.
      // 🔴 **D-027 · and the fifth came past it: the flush's turn of several** — one `user_turn`
      // for every held message it delivers together, each message a part. ⚑ A held report rides its
      // own part's authorship (`...one.queued.authorship`), as it rides the one-message turn's.
      // ⚑ The sixth: a turn that carries on after a repaired sign-in. It hands over no words, so it
      // can carry no report.
      expect(turns).toHaveLength(6)
      const carrying = turns.filter((block) => block.includes('carriesOn: true'))
      expect(carrying).toHaveLength(1)
      expect(carrying[0]).not.toContain('work')
      const several = turns.filter((block) => block.includes('parts:'))
      expect(several).toHaveLength(1)
      expect(several[0]).toContain('...one.queued.authorship,')
      expect(several[0]).toContain(
        'humanInitiated: went.some((one) => one.queued.authorship.humanInitiated === true),',
      )
      // ⛔ **The cut is asserted, because a census that reads too much is green for the wrong
      // reason.** No block may reach the next publish or the end of a method.
      const assertClosedPublisher = (block: string): void => {
        // ⚠️ **Non-empty lines**, because `codeOnly` leaves a blank line where every stripped
        // comment was — a raw line count is a count of this file's docblocks.
        const said = block.split('\n').filter((line) => line.trim().length > 0)
        // ⚑ **D-016 · commit 6 · R4 — one line more**: the flush's turn carries what its held words
        // drive (`drives`), so its block is eight lines, and the bound sits one above it.
        // ⚑ **D-027 · the turn of several is eleven**: its `parts` map spells each part as the
        // one-message turn is spelled, under the joined text — so its own bound sits one above
        // eleven, and it is the ONE block that bound is given to (asserted above).
        // ⚑ **And one line more in both**: the flush's turn says whether its words asked for the
        // turn before to be stopped (`askedForTheStop`).
        const bound = block.includes('parts:') ? 14 : 10
        expect(
          said.length,
          `a publish block ran on: ${said.join(' / ').slice(0, 90)}`,
        ).toBeLessThan(bound)
        expect(block.endsWith('}')).toBe(true)
        expect(block).not.toContain('publishOurs')
      }
      turns.forEach(assertClosedPublisher)
      expect(() => assertClosedPublisher(`${several[0]}\nthis.publishOurs({})`)).toThrow()
      // ⚑ **413 · the pair is STILL written by one expression, and the expression moved.**
      // ⛔ `406` marked each producer by hand and named a fourth it had not marked; `410` then
      // counted the residue live and only one of the two it found was that fourth. ⚠️ So no
      // publish block writes `work:` at all any more — {@link RuntimeHost.whoseWordsTheseAre} is
      // the one writer, and every door spreads what it returns.
      expect(turns.filter((block) => block.includes('work:'))).toHaveLength(0)
      const writes = source.slice(source.indexOf('export function whoseWordsTheseAre'))
      const body = writes.slice(0, writes.indexOf('\n}'))
      expect(body).toContain(
        "    attribution: 'app_authored',\n    ...(report === undefined ? {} : { work: report }),",
      )
      // ⛔ **And there is exactly one of it**, which is what makes *"one writer"* a fact rather
      // than a sentence in a comment.
      expect(source.split('export function whoseWordsTheseAre')).toHaveLength(2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · what this must NOT become
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · the grammar, kept', () => {
    it('🔴 neither new component spends the amber attention ramp', () => {
      // ⛔ **The status grammar is settled: only a question and a permission may summon
      // attention, and amber means frozen, waiting for a human.** A finished task that raised a
      // decision is neither. ⚠️ Asserted by NAME over the whole `--waiting` family, because
      // `--waiting-text-label` and `--waiting-pill-border` are how `PersonsQueue` spends it.
      for (const name of ['WorkReportEntry.vue', 'WorkFacts.vue']) {
        const source = readFileSync(join(rendererRoot, 'components', name), 'utf8')
        const spent = codeOnly(source).match(/--waiting[a-z-]*/g) ?? []
        expect(spent, `${name} reaches ${spent.join(', ')}`).toEqual([])
        // ⚑ And `--auto`, the one token this app keeps for a single meaning.
        expect(codeOnly(source)).not.toContain('--auto')
      }
    })

    it('⛔ neither new component opens a live region', () => {
      // ⚠️ **v2.5.1 removed six `role="alert"` sites and an unconditional live region**, and its
      // own changelog rules the case: *"Completed work … does not open a sheet, move focus, create
      // a toast, or create an attention badge simply because their state changed."*
      for (const name of ['WorkReportEntry.vue', 'WorkFacts.vue']) {
        const source = readFileSync(join(rendererRoot, 'components', name), 'utf8')
        for (const forbidden of ['role="alert"', 'role="status"', 'aria-live', ':role=']) {
          expect(codeOnly(source), `${name} declares ${forbidden}`).not.toContain(forbidden)
        }
      }
    })

    it('⛔ the person’s queue gains no row, and cannot: it reads REQUESTS', () => {
      // 🔴 **`401`/`403`'s queue is built from routed requests**, and a work report is neither a
      // question nor a permission. ⚠️ Asserted as an import census rather than as an empty list,
      // because an empty list is what a broken plant also produces
      // (`brobot2-ssr-tests-pass-vacuously`).
      const queue = codeOnly(readFileSync(join(rendererRoot, 'lib/persons-queue.ts'), 'utf8'))
      for (const forbidden of ['WorkReport', 'work-report', 'needsUserAction', 'workReport']) {
        expect(queue, `the queue reaches ${forbidden}`).not.toContain(forbidden)
      }
      // ⚑ Non-vacuous: it really does read the other population.
      expect(queue).toContain('PersonsDecision')
    })

    it('⛔ a routed question is STILL unmarked, and that is a finding rather than a slip', () => {
      // 🔴 **The third producer of an injected turn** — `routeRequest` (394) delivers a child's
      // question to its parent as `THE_APP_ITSELF`, and it still renders as the person's own
      // bubble. ⚠️ **Marking it without building its entry would render a question under the
      // go-ahead's authorship line (*"sent for you"*), which is false**; giving it an answerable
      // entry is `401`/`403`'s channel and a design nobody has specified.
      //
      // ⛔ **Pinned so the next reader finds it here rather than on a screen**, and so that a
      // future fix has to come past this assertion and say what it decided.
      const host = codeOnly(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      const routing = host.slice(host.indexOf('private async deliverQuestion'))
      const call = routing.slice(0, routing.indexOf('publishOurs'))
      expect(call).toContain('THE_APP_ITSELF')
      expect(call).not.toContain('workAnswered')
      expect(call).not.toContain('app_authored')
    })
  })
})
