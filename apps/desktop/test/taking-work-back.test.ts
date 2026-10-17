import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, parametersOf } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import {
  TOOL_REFUSALS,
  refuseTool,
  toolRemedyOf,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { stillHeld } from '../src/shared/mailbox'
import { pieceLine } from '../src/shared/piece-called'
import { TASK_IS_OPEN, TASK_STATES, derivePieces } from '../src/shared/tasks'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

const waitFor = async (ready: () => boolean, what: string, tries = 200): Promise<void> => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (ready()) return
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
 * 🔴 **A gate on the PROVIDER's own `send`, so `HostedSession.flushing` can be held open.**
 *
 * ⛔ **`that-work-is-being-sent` is the one rail in this dispatch that refuses for a condition which
 * CLEARS, and the only instant it exists in is between `runFlush` taking the head out of the mailbox
 * and the provider accepting the words.** ⚠️ Racing that instant with a timer is the flake this
 * repo does not ship; holding it open is deterministic and lets the remedy be WALKED — the same
 * call, once it has settled, landing on the other arm of the same verb.
 */
class SendGate {
  private open: (() => void) | null = null
  private blocked: Promise<void> | null = null
  private announce: (() => void) | null = null
  /** Resolves the moment a flush actually reaches the gate — never a guess that it has. */
  arrived: Promise<void> = Promise.resolve()

  hold(): void {
    this.blocked = new Promise<void>((resolve) => {
      this.open = resolve
    })
    this.arrived = new Promise<void>((resolve) => {
      this.announce = resolve
    })
  }

  async pass(): Promise<void> {
    const blocked = this.blocked
    if (blocked === null) return
    this.announce?.()
    await blocked
  }

  release(): void {
    this.open?.()
    this.open = null
    this.blocked = null
  }
}

/** `373`'s double, with `415`'s toolset capture and this dispatch's gate on the way out. */
class ToolWatchingRuntime extends FakeRuntime {
  // ⚠️ **`held` and not `gate`, because `FakeRuntime` already has a private of that name** — two
  // separate declarations of one private name are a compile error, which is the double telling this
  // test that it was about to shadow a field the double uses for its own launch gate.
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    private readonly held: SendGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return this.gated(handle)
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return this.gated(handle)
  }
  /**
   * ⛔ **The gate goes on the handle the HOST holds**, not on a subclass method: `runFlush` calls
   * `session.handle.send`, so that is the only boundary at which `HostedSession.flushing` is open.
   */
  private gated<T extends { send: (text: string) => Promise<void> }>(handle: T): T {
    const waiting = this.held
    const sent = handle.send.bind(handle)
    return Object.assign(handle, {
      send: async (text: string): Promise<void> => {
        await waiting.pass()
        return sent(text)
      },
    })
  }
}

/**
 * 🔴 **429 · taking work back, and never handing it over twice** (HO-023 §5 + §4.3).
 *
 * ## ⛔ The two rulings are one mechanism, and the PO put them in this order deliberately
 *
 * **HO-023 §4.3:** *"`withdraw_task` … composes with the fifth property exactly right: withdraw then
 * reassign is legitimate; reassign without withdrawing is the duplicate."*
 *
 * ⚑ **Build the verb and the refusal together, or the refusal is a trap and the verb is a hole.**
 * ⛔ Ship the refusal alone and a parent refused `agent-already-has-work-open` on a task nothing will
 * ever answer has no act at all. ⛔ Ship the verb alone and withdrawing becomes optional, so the
 * duplicate goes on being admitted.
 *
 * ## ⚠️ The measurement this closes, and the half `415` could not reach
 *
 * **`415` §6.3, live, on Claude, to the millisecond** — a PM was told its task had stalled, called
 * `list_tasks`, said *"Resending the work"*, called `message_agent`, **and the worker's reply for
 * that very task landed one millisecond later.** The re-send became a second task with the first
 * one's text.
 *
 * 🔴 **`415`'s rail reads the RECEIVER's state, so at the instant a reply lands it is silent**: the
 * slot is free and the identical retry is admitted. ⚠️ **And `425`'s remedy for that rail said
 * *wait*** — which is the arm that walks a model into exactly this. ⛔ So the window this dispatch
 * closes is the one that OPENS when the work ends, and the word `425` shipped had to change with it.
 *
 * ## ⛔ Where standing rule 3's pairs live
 *
 * Every refusal here is shown beside the same call one fact over ADMITTED: §2's answered task beside
 * a withdrawn one and beside a question, §3's closed task beside an open one, and §4's whole
 * sequence, which is the acceptance the brief names.
 *
 * ## ⚑ D-016 · what the tree kept of this, and what it took
 *
 * ⚑ **Work is given with `give_work`, and a task is a PIECE**, named by its label (`W1.2`) or id.
 * ⛔ A message carries no work any more, so the re-send of answered work that §2 refused is a NEW
 * give by ruling — the same words as new work — and `message_agent`'s refusal naming the reply went
 * with the kind that sent work. ⚑ **What stayed is the verb**: `withdraw_task {piece}` takes a
 * piece back (now telling its holder), and it still refuses an answered piece by name. ⚑ **And the
 * rail the verb freed a caller from is the STALL RULE now** (`its-work-has-stalled`), which took
 * the one-open-task rail's place with the same remedy word.
 */
describe('429 · taking work back', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let gate: SendGate
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, gate),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-429-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-429-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    gate = new SendGate()
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
  })

  afterEach(async () => {
    gate.release()
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** What the PROVIDER was handed — `412`'s instrument, through `FakeSessionHandle`'s echo. */
  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  /**
   * ⛔ **The card nobody has answered yet, LAST first** (429). ⚠️ `415`'s helper took the FIRST
   * `permission_request` on the ledger and waited for *any* `turn` row — which is right exactly once
   * per conversation. ⛔ This file drives several turns on one worker, so the first card is already
   * answered, the wait is already satisfied, and the second turn never ends: `letTheTurnFinish`
   * returns having finished nothing. ⚑ `an-unenumerated-state-counts-as-success`, in a helper.
   */
  const theOpenCard = (sessionId: string): string | null => {
    const rows = ledger(sessionId)
    const settled = new Set(
      rows
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event as { requestId: string }).requestId),
    )
    const open = rows
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event as { id: string }).id)
      .filter((id) => !settled.has(id))
    return open.at(-1) ?? null
  }

  const turnsOn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = turnsOn(sessionId)
    await waitFor(() => theOpenCard(sessionId) !== null, 'a permission card')
    const id = theOpenCard(sessionId)
    if (id === null) throw new Error('no open permission request on the ledger')
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    // ⚑ **A new terminal, not *any* terminal** — the count is what makes this true of THIS turn.
    await waitFor(() => turnsOn(sessionId) > before, 'the turn to reach its own terminal')
  }

  /** ⚑ **D-016 · a give, answered `ok`**, with the piece it wrote down. */
  const aGive = async (
    tools: AgentToolset,
    profile: string,
    title: string,
    brief = title,
  ): Promise<{ agent: string; piece: string; label: string; delivery: unknown }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
      delivery: given.delivery,
    }
  }

  /**
   * A PM in a window with one child of its own, started through the real door — ⚑ **D-016 ·
   * `give_work`, whose brief is the child's first turn**, and that turn parks on the card the Fake
   * raises every turn.
   */
  const aPmAndItsWorker = async (
    title = 'the first piece',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await aGive(pmTools, 'worker', title)
    return {
      pm,
      worker: given.agent,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.piece,
      label: given.label,
    }
  }

  /** ⚑ The worker's pieces, as the fold reads them — raw. */
  const piecesOf = (worker: string) => store.piecesOwnedBy(worker)

  /**
   * ⛔ **Whether the conversation is idle NOW, read off the LAST status row.** ⚠️ `.some()` over the
   * ledger would match an idle from before the turn this test is waiting on — `an-equality-against-
   * a-re-read-of-a-moving-field` one instrument over.
   */
  const isIdle = (sessionId: string): boolean => {
    const last = ledger(sessionId)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /**
   * One piece, given and then ANSWERED — the state `415`'s rail was silent about.
   *
   * ⚠️ **`settle` decides whether the worker is left IDLE or mid-turn**, and both are needed: an
   * idle worker is what the fifth property's window looks like in the measurement, and a busy one is
   * the only way to get a piece whose brief is still HELD.
   */
  const workAlreadyAnswered = async (
    settle = true,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    const made = await aPmAndItsWorker('read the brief and report')
    const replied = await callOn(made.workerTools, 'reply_to_parent', {
      piece: made.label,
      outcome: 'done',
      summary: 'the brief is read',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    expect(piecesOf(made.worker)[0]?.state).toBe('answered')
    if (settle) {
      await letTheTurnFinish(made.worker)
      await waitFor(() => isIdle(made.worker), 'the worker to go idle')
      // ⚠️ **The reply landed BEFORE the turn ended, so nothing stalls** — which is the ordering
      // `derivePieces` relies on and the state the live measurement's retry arrived into.
      expect(piecesOf(made.worker)[0]?.state).toBe('answered')
    }
    return made
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

  /** Prose quotes code, so a census that reads for ABSENCE has to read the code only (`412`). */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the carrier — §2 and §2.1 of the brief
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the reference, advertised and read as one set', () => {
    it('🔴 piece is ADVERTISED on message_agent, optional, and its two readings are described', async () => {
      const { pmTools } = await aPmAndItsWorker()
      const message = pmTools.tools.find((one) => one.name === 'message_agent')
      const parameters = parametersOf(message?.input ?? {})
      // ⚑ **D-016 · `task_id` is `piece`**, and it takes a label or an id.
      const named = parameters.find((one) => one.name === 'piece')
      // ⛔ **Read back out of the JSON SCHEMA a provider is handed, never off the interface.** ⚠️
      // Since `348` both adapters build with `z.looseObject`, so an UNDOCUMENTED argument reaches the
      // handler and changes the behaviour while no model was ever told it exists — `415` §2.4's
      // measurement, and the reason a green behavioural test could not have proved this.
      expect(named, JSON.stringify(parameters.map((one) => one.name))).toBeDefined()
      // ⚑ **Optional, which is the shape a default belongs to.** Required would make every existing
      // caller malformed rather than making one reading explicit.
      expect(named?.required).toBe(false)
      // ⛔ **Both readings are in the description**, because the field means two different things
      // and a sentence naming only one would be advice that is right half the time — ⚑ D-016: a
      // follow-up's, and a note's.
      const said = named?.description ?? ''
      expect(said).toContain('follow-up')
      expect(said).toContain('note')
      expect(said).toContain('list_tasks')
    })

    it('⛔ the advertised set and the keys the handler reads are ONE set, compile-enforced', () => {
      // 🔴 **`415` §2.4's device, and the assertion is over the SOURCE because the guarantee is a
      // type.** ⚠️ A behavioural test cannot see the difference between *documented and read* and
      // *read only*; what can is the `satisfies` that fails to compile when the two disagree, and
      // the constants the handler reads through.
      const tools = sourceOf(join(mainRoot, 'runtime'), 'agent-tools.ts')
      expect(tools).toContain(
        '} satisfies Readonly<Record<keyof MessageAgentArguments, z.ZodType>>',
      )
      expect(tools).toContain(
        "const MESSAGE_PIECE_ARGUMENT = 'piece' satisfies keyof MessageAgentArguments",
      )
      expect(tools).toContain('args[MESSAGE_PIECE_ARGUMENT]')
      // ⚑ **And the same device on the new door**, so the verb this dispatch adds cannot drift
      // either — `satisfies` plus two constants typed as keys of its own interface.
      expect(tools).toContain(
        '} satisfies Readonly<Record<keyof WithdrawTaskArguments, z.ZodType>>',
      )
      expect(tools).toContain(
        "const WITHDRAW_PIECE_ARGUMENT = 'piece' satisfies keyof WithdrawTaskArguments",
      )
      expect(tools).toContain('args[WITHDRAW_PIECE_ARGUMENT]')
    })

    it('🔴 an omitted reference on a FOLLOW-UP is the caller’s fault, and on a note means no piece', async () => {
      // ⛔ **`429` §2.1's decision, re-ruled by D-016**: `MESSAGE_TASK_WHEN_UNSAID` — *an omitted
      // reference means not about any task* — went with the kind that sent work. ⚑ A follow-up adds
      // to a piece the caller gave, so one that names none is MALFORMED, by name; a note may be
      // about no piece at all, and is admitted.
      const { worker, pmTools } = await workAlreadyAnswered()
      const unnamed = await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        text: 'read the brief and report',
      })
      expect(unnamed.outcome, JSON.stringify(unnamed)).toBe('refused')
      expect(unnamed.rail).toBe('malformed-request')
      expect(JSON.stringify(unnamed.detail)).toContain(
        'piece: on a follow-up, send the label or id of a piece you gave that agent',
      )
      const note = await callOn(pmTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'read the brief and report',
      })
      expect(note.outcome, JSON.stringify(note)).toBe('ok')
      // ⚠️ **And neither opened anything**: a message hands nothing over (D-016).
      expect(piecesOf(worker)).toHaveLength(1)
    })

    it('⛔ the reference can never become the piece a message HANDS OVER', () => {
      // 🔴 **`queueMessage` refuses a GIVE by TYPE** — `Omit<TurnFacts, 'giving'> & { readonly
      // giving?: never }` — because *"a caller allowed to name a piece here could make any message
      // claim to hand over work that nothing recorded."* ⚑ The field this dispatch adds is a
      // different claim about a different object, and it must not reach that one. ⚑ **D-016,
      // commit 5** — the rail is spelled once, as `FactsAQueueCarries`, and takes a new brief
      // (`rebriefing`) out beside the give.
      const tools = sourceOf(join(mainRoot, 'runtime'), 'agent-tools.ts')
      const host_ = sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts')
      expect(host_).toContain(
        [
          "type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {",
          '  readonly giving?: never',
          '  readonly rebriefing?: never',
          '}',
        ].join('\n'),
      )
      // ⛔ **`queueMessage`'s own parameter, scoped BY NAME** — `send` takes the same type, and a
      // file-wide match would be satisfied by that neighbour.
      expect(
        /\n {2}queueMessage\(([\s\S]*?)\n {2}\): Promise<QueueOutcome>/.exec(host_)?.[1] ?? '',
      ).toContain('facts: FactsAQueueCarries = {},')
      // ⛔ **The tool never spells it in CODE**, so the value a caller supplied cannot travel on the
      // turn. ⚠️ **Comments stripped first** — this file's own docblock names the field to say it is
      // unreachable, and a raw `toContain` would be the census reading its own prose
      // (`a-source-census-must-strip-prose-before-it-asserts`).
      // ⚠️ **Sentences stripped too, but not a string that IS the name** (`['giving']` spells it):
      // a refusal may say "giving it again" without spelling the field.
      expect(
        codeOnly(tools).replace(/'(?:[^'\\\n]|\\.)*'/g, (literal) =>
          literal === "'giving'" ? literal : "''",
        ),
      ).not.toContain('giving')
      // ⚑ **And the call the tool makes is unchanged in its shape** — the words, the caller, and
      // nothing that gives a piece.
      expect(codeOnly(tools)).toMatch(/host\.queueMessage\(\s*agent,\s*text,\s*by,/)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a message names the piece it is about — HO-023 §5, after D-016
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a message names the piece it is about, and only one the caller gave', () => {
    // ⚑ **D-016** — `429`'s headline here (*the duplicate `415` measured is refused, naming the
    // reply*) went with work sent as a message: `that-task-was-already-answered` is no longer
    // reachable from `message_agent`, and the same words given again are a NEW piece by ruling
    // (§4). ⚑ What the rail named survives on `withdraw_task` (§3, §4).

    it('⚑ …and the same piece one fact over is ADMITTED — as a follow-up, and after a withdrawal', async () => {
      const { worker, pmTools, label } = await workAlreadyAnswered()
      // 🔴 **A follow-up about finished work is HO-020 §2.2's investigate half**, and a rail that
      // refused it would delete the half `415` built the kind for. ⛔ The reference is READ — it has
      // to name a piece this caller gave — and the state is not.
      const asked = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'how did that go?',
        kind: 'follow-up',
        piece: label,
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      expect(piecesOf(worker)).toHaveLength(1)
      expect(asked).not.toHaveProperty('remedy')

      // ⚑ **And the other fact over: a WITHDRAWN piece's work may be given again by ruling** —
      // HO-023 §4.3, *"withdraw then reassign is legitimate"*.
      // ⚠️ **The follow-up went out and started a turn, so the worker is let back to idle first.**
      await letTheTurnFinish(worker)
      await waitFor(() => isIdle(worker), 'the worker to go idle after the follow-up')
      const second = await aGive(pmTools, 'worker', 'a second piece')
      expect(second.agent).toBe(worker)
      const back = await callOn(pmTools, 'withdraw_task', { piece: second.label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      const again = await aGive(pmTools, 'worker', 'a second piece')
      expect(again.agent).toBe(worker)
      expect(piecesOf(worker)).toHaveLength(3)
    })

    it('⛔ a reference that is not a piece you gave THAT agent is one answer, whichever cause', async () => {
      const { worker, pmTools, label } = await workAlreadyAnswered()
      // ⚑ **Two causes, one sentence** — an id this app never minted, and a piece given to a
      // different agent of the caller's own. ⛔ Separating them is how a caller learns which pieces
      // exist, which is the disclosure `no-such-agent` already folds away.
      // ⚑ **D-016 · its own identity, because a give reaches the ONE conversation a giver has with
      // an agent** — a second give to `worker` would reach `worker`. ⛔ Measured, not assumed: the
      // give's own outcome is asserted before its id is used.
      await bringIdentityIntoBeing('helper')
      const other = (await aGive(pmTools, 'helper', 'a second child')).agent
      expect(other).not.toBe(worker)
      for (const [named, why] of [
        ['work_never_minted', 'an id this app never minted'],
        [label, 'the right piece, aimed at the wrong agent'],
      ] as const) {
        const refused = await callOn(pmTools, 'message_agent', {
          kind: 'follow-up',
          agent: other,
          text: 'do this',
          piece: named,
        })
        expect(refused.outcome, `${why}: ${JSON.stringify(refused)}`).toBe('refused')
        expect(refused.rail, why).toBe('not-a-piece-you-gave')
        expect(refused.permanence, why).toBe('permanent')
        expect(refused.remedy, why).toBeNull()
      }
      // ⚑ **The paired positive**: the same label, at the agent it was given to, resolves — so the
      // refusals above are about the PAIR and not about the label being unreadable.
      const resolved = await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        text: 'do this',
        piece: label,
      })
      expect(resolved.outcome, JSON.stringify(resolved)).toBe('ok')
    })

    it('⚠️ a malformed reference is the CALLER’s fault and says so, not the receiver’s', async () => {
      // ⛔ **`340`'s finding — a reason answering with another reason's sentence.** A `piece` that
      // is not a string is a fault in the arguments; answering `not-a-piece-you-gave` would be a
      // sentence about work that was never looked for.
      const { worker, pmTools } = await aPmAndItsWorker()
      const refused = await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        text: 'do this',
        piece: 7,
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      expect(JSON.stringify(refused.detail)).toContain('piece')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the verb — §3 of the brief
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · withdraw_task, and the two arms it has to reach', () => {
    it('🔴 an open task a parent gave is taken back, and a give names its stall no more', async () => {
      const { worker, pmTools, piece, label } = await aPmAndItsWorker('the first piece')
      await letTheTurnFinish(worker)
      await waitFor(() => piecesOf(worker)[0]?.state === 'stalled', 'the work to stall')

      // ⛔ **The trap HO-023 §4.3 names, demonstrated before the verb removes it**: a stalled piece
      // nothing will ever answer. ⚑ A give is not refused over it; its answer names it,
      // with this verb as one of the two acts.
      const named = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and another',
        brief: 'and another',
      })
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      expect(named.stalled).toEqual([label])

      const back = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      expect(back.piece).toBe(piece)
      expect(back.label).toBe(label)
      expect(back.state).toBe('withdrawn')
      // ⚑ **No message was involved on this arm** — the words had already gone out, which is the
      // half `cancelQueuedMessage` could never reach.
      expect(back.tookBackTheMessage).toBe(false)
      expect(piecesOf(worker)[0]?.state).toBe('withdrawn')
      expect(
        piecesOf(worker)
          .filter((one) => TASK_IS_OPEN[one.state])
          .map((one) => one.label),
      ).toEqual([named.label])

      // 🔴 **The remedy, WALKED** — taken back, the piece is named to the next give no more.
      const admitted = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and a third',
        brief: 'and a third',
      })
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
      expect(admitted).not.toHaveProperty('stalled')
      expect(piecesOf(worker)).toHaveLength(3)
    })

    it('⛔ a task whose message is still HELD gives the words back too', async () => {
      // 🔴 **`folding-one-derivation-leaves-its-neighbour`, which is the hazard §3 names by name.**
      // ⚠️ `cancelQueuedMessage` reaches a message in a mailbox; this verb reaches the WORK — and on
      // the arm where both exist it has to do both, or the flush hands a child a turn naming a piece
      // that is already closed.
      const { worker, pmTools, piece } = await workAlreadyAnswered(false)
      // ⚑ The worker is still mid-turn and owes nothing, so the next give is HELD. ⚠️ Its brief's
      // words are not its title: the holder is TOLD the title when the piece is taken back (D-016),
      // and what must never reach the provider is the brief.
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the held piece',
        brief: 'held work',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.delivery, JSON.stringify(given)).toBe('held')
      expect(given).not.toHaveProperty('message')
      const waiting = piecesOf(worker).find((one) => one.state === 'waiting')
      if (waiting === undefined) throw new Error('the second piece was not held')
      expect(waiting.piece).toBe(given.piece)
      expect(waiting.messageId).toMatch(/^msg_/)
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).toEqual([
        waiting.messageId,
      ])

      const back = await callOn(pmTools, 'withdraw_task', { piece: given.label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      // ⚑ **Computed from what happened, never from the branch it hoped to take.**
      expect(back.tookBackTheMessage).toBe(true)
      // ⚠️ **The brief is out of the mailbox** — what is held now is the holder's notice (D-016 ·
      // ruling 8), never the words that were taken back.
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).not.toContain(
        waiting.messageId,
      )
      expect(piecesOf(worker).find((one) => one.piece === waiting.piece)?.state).toBe('withdrawn')
      // ⛔ **And the words never reached the provider**, which is the whole reason the message had
      // to go back with the work.
      await letTheTurnFinish(worker)
      expect(saidToProvider(worker).filter((said) => said.includes('held work'))).toEqual([])
      // ⚠️ **The piece answered earlier is untouched** — a withdrawal reaches one piece by name.
      expect(piecesOf(worker).find((one) => one.piece === piece)?.state).toBe('answered')
    })

    it('⚑ a flush already in flight refuses, and the SAME call once it settles is admitted', async () => {
      const { worker, pmTools } = await workAlreadyAnswered(false)
      const given = await aGive(pmTools, 'worker', 'held work')
      expect(given.delivery, JSON.stringify(given)).toBe('held')
      const waiting = piecesOf(worker).find((one) => one.state === 'waiting')
      if (waiting === undefined) throw new Error('the second piece was not held')

      // ⛔ **The flush is held open at the provider boundary**, which is the only instant this rail
      // exists in — between `runFlush` taking the head out and the words being accepted.
      gate.hold()
      await letTheTurnFinish(worker)
      await gate.arrived

      const refused = await callOn(pmTools, 'withdraw_task', { piece: given.label })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('that-work-is-being-sent')
      // 🔴 **710 · `707` F-1** — the piece it names, by its label (⚑ D-016: where it was the number).
      expect(refused.detail).toMatchObject({ label: given.label })
      expect(refused.permanence).toBe('while-this-holds')
      expect(refused.retryable).toBe(true)
      // 🔴 **The one rail `429` adds that carries an act, and the biconditional is why it must.**
      expect(refused.remedy).toBe('make-the-same-call-when-this-settles')
      // ⚠️ **Nothing was recorded** — the piece is still open and still holds its message.
      expect(piecesOf(worker).find((one) => one.piece === waiting.piece)?.state).toBe('waiting')

      // ⚑ **The remedy, WALKED.** ⛔ The retry does not land where it started: the flush has ended,
      // so the piece is `working` and the verb takes the arm with no mailbox in it.
      gate.release()
      await waitFor(
        () => piecesOf(worker).find((one) => one.piece === waiting.piece)?.state === 'working',
        'the held message to go out',
      )
      const back = await callOn(pmTools, 'withdraw_task', { piece: given.label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      expect(back.tookBackTheMessage).toBe(false)
    })

    it('🔴 an ANSWERED task is refused, and so is a second withdrawal — with different words', async () => {
      const { pmTools, label } = await workAlreadyAnswered()
      // ⛔ **§3.1: not silently withdraw an ANSWERED piece.** *"It is already closed; withdrawing it
      // is a different claim about history."*
      const answered = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(answered.outcome, JSON.stringify(answered)).toBe('refused')
      expect(answered.rail).toBe('that-piece-was-already-answered')
      expect((answered.detail as Record<string, unknown>).answered).toBe('done')
      expect((answered.detail as Record<string, unknown>).label).toBe(label)

      const second = await aGive(pmTools, 'worker', 'a second piece')
      expect((await callOn(pmTools, 'withdraw_task', { piece: second.label })).outcome).toBe('ok')
      const twice = await callOn(pmTools, 'withdraw_task', { piece: second.label })
      expect(twice.outcome, JSON.stringify(twice)).toBe('refused')
      // ⚠️ **A DIFFERENT word from the one above**, because they are different claims about history:
      // a parent told *that was already answered* about work it took back itself would go looking
      // for a reply that does not exist — `340`'s finding.
      expect(twice.rail).toBe('that-piece-was-already-taken-back')
      expect(twice.rail).not.toBe(answered.rail)
      expect(refuseTool('that-piece-was-already-taken-back').reason).not.toBe(
        refuseTool('that-piece-was-already-answered').reason,
      )
    })

    it('⛔ another parent’s task cannot be withdrawn, and the lookup is what refuses', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker('the first piece')

      // ⚑ **A second PM, which can see nothing of the first one's work.** ⛔ The entitlement is the
      // LOOKUP — the pieces the CALLER gave — so there is no label a caller can spell that reaches
      // another parent's piece.
      //
      // 🔴 **549 · which of two rails answers FIRST moved, and the claim did not** (HO-058 §1). ⚑ The
      // lookup is what refuses, which is the sentence this test was always making, and the direct
      // assertion at the bottom is the one that says so without depending on an order.
      await bringIdentityIntoBeing('other-pm')
      const rival = await personOpens('other-pm')
      const rivalTools = theToolsetJustHandedOut()
      const refused = await callOn(rivalTools, 'withdraw_task', { piece: label })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')
      expect(piecesOf(worker)[0]?.state).not.toBe('withdrawn')
      // ⚑ **And the lookup itself, asked directly**, so the claim is about the lookup rather than
      // about the order two rails happen to be in: the rival gave nothing, and the parent that
      // really gave the work did. (⚑ D-016 · `theTaskYouGave`, the predicate this asked, is gone.)
      expect(store.piecesGivenBy(rival).map((one) => one.piece)).not.toContain(piece)
      expect(store.piecesGivenBy(pm).map((one) => one.piece)).toContain(piece)
    })

    it('⚠️ the withdrawal survives a restart, which is what the narrow read is for', async () => {
      const { worker, pmTools, piece, label } = await aPmAndItsWorker('the first piece')
      expect((await callOn(pmTools, 'withdraw_task', { piece: label })).outcome).toBe('ok')

      // 🔴 **Re-derived from the ledger alone**, which is the path every restart takes and the one
      // `selectPieceEvents` decides. ⛔ A `work_taken_back` folded but not SELECTED would read as
      // *that event never happened* — silently, and only here.
      const rebuilt = derivePieces(worker, store.events(worker))
      expect(rebuilt.find((one) => one.piece === piece)?.state).toBe('withdrawn')
      expect(piecesOf(worker).find((one) => one.piece === piece)?.state).toBe('withdrawn')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the composition — §6.4 of the brief, which is the acceptance
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the sequence the brief calls the acceptance', () => {
    it('🔴 assign → answered → withdraw REFUSED naming the reply → the same words given again are NEW work', async () => {
      const { worker, pmTools, label } = await workAlreadyAnswered()

      // ⛔ **Withdrawing it is refused, which is the half `429` §6.4 and §3.1 disagreed about.**
      // ⚠️ The brief's acceptance read *"refused … → withdraw → assign again admitted"*, and §3.1 of
      // the same brief forbids withdrawing an answered piece. ⚑ **§3.1 is right**: the work was done,
      // and taking it back would be a claim about history nobody can act on.
      const cannot = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(cannot.rail, JSON.stringify(cannot)).toBe('that-piece-was-already-answered')
      expect((cannot.detail as Record<string, unknown>).label).toBe(label)

      // ⚑ **The way forward is a DIFFERENT call, which is what `permanent` says**: the same words as
      // NEW work — ⚑ D-016: a new give, which opens a new piece (the re-send `429` refused on
      // `message_agent` went with work sent as a message).
      const fresh = await aGive(pmTools, 'worker', 'read the brief and report')
      expect(fresh.agent).toBe(worker)
      expect(fresh.label).not.toBe(label)
      expect(piecesOf(worker)).toHaveLength(2)
    })

    it('⚑ …and the sequence §0 calls legitimate: a re-give names the stalled original, which is then withdrawn', async () => {
      // 🔴 **HO-023 §4.3, walked end to end**: *"withdraw then reassign is legitimate; reassign
      // without withdrawing is the duplicate."* ⛔ Both halves are in this one test, over the same
      // piece of work. ⚑ The duplicate is not refused: its answer names the stalled
      // original, and taking that back leaves the re-given piece as the one open.
      const { worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
      await letTheTurnFinish(worker)
      await waitFor(() => piecesOf(worker)[0]?.state === 'stalled', 'the piece to stall')

      const duplicate = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the piece',
        brief: 'the piece',
      })
      expect(duplicate.outcome, JSON.stringify(duplicate)).toBe('ok')
      expect(duplicate.agent).toBe(worker)
      expect(duplicate.stalled).toEqual([label])

      expect((await callOn(pmTools, 'withdraw_task', { piece: label })).outcome).toBe('ok')
      const rows = piecesOf(worker)
      expect(rows).toHaveLength(2)
      // ⚠️ **The re-given piece is OPEN, and whether it is `waiting` or `working` is about the
      // receiver's turn rather than about this verb** — pinning either would make this assertion
      // about the fake provider's timing.
      expect(rows.find((one) => one.piece === piece)?.state).toBe('withdrawn')
      expect(rows.filter((one) => TASK_IS_OPEN[one.state]).map((one) => one.label)).toEqual([
        duplicate.label,
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §5 · both readers, and the vocabularies the rails joined
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what the ledger, the person and the raw stream are told', () => {
    it('🔴 the take-back names who took the work back, and its holder is TOLD', async () => {
      const { worker, pm, pmTools, piece, label } = await aPmAndItsWorker('the piece')
      await callOn(pmTools, 'withdraw_task', { piece: label })

      const row = ledger(worker).find((one) => one.type === 'work_taken_back')
      if (row === undefined) throw new Error('no work_taken_back row was written')
      expect((row as { by: string }).by).toBe(pm)

      // ⚑ **D-016 · the row draws nothing — the holder is TOLD instead** (ruling 8): the piece
      // events draw no line of their own, and a notice from this app reaches the conversation that
      // held the work, naming the piece and who took it back.
      const state = createTranscript()
      applyEvent(state, row)
      expect(state.items).toEqual([])
      await waitFor(
        () =>
          ledger(worker).some(
            (one) =>
              (one.type === 'user_turn' || one.type === 'message_queued') &&
              one.appNotice === 'a-piece-taken-back',
          ),
        'the holder to be told',
      )
      const told = ledger(worker).find(
        (one) =>
          (one.type === 'user_turn' || one.type === 'message_queued') &&
          one.appNotice === 'a-piece-taken-back',
      ) as { text: string } | undefined
      expect(told?.text).toContain(`took back ${pieceLine(label, 'the piece')}`)
      // ⚠️ **And the raw stream says the same two facts in its own register.**
      expect(describeEvent(row)).toContain(piece)
      expect(describeEvent(row)).toContain(pm)
    })

    it('⛔ the four rails answer BOTH of `425`’s questions, and the biconditional still holds', () => {
      // 🔴 **`429` §4: every rail added here answers both, in the same commit** — and the exhaustive
      // `Record<ToolRefusal, RefusalRemedy | null>` is what refuses to compile until it does.
      // ⚑ **D-016 renamed three of them** — a task is a piece, and a withdrawal is a take-back.
      const added = [
        'not-a-piece-you-gave',
        'that-piece-was-already-answered',
        'that-piece-was-already-taken-back',
        'that-work-is-being-sent',
      ] as const
      for (const rail of added) {
        expect(TOOL_REFUSALS, rail).toContain(rail)
        const built = refuseTool(rail)
        // ⚑ **A rail carries an act if and only if this app can retry it** — `425`'s property,
        // asserted here over the rails this dispatch adds rather than only over the whole roster.
        expect(toolRemedyOf(rail) !== null, rail).toBe(built.permanence === 'while-this-holds')
        expect(built.retryable, rail).toBe(built.permanence === 'while-this-holds')
        // ⛔ **And every one of them SAYS something of its own** — `374`'s rule that no two rails
        // share a sentence, asserted for the four that are new.
        expect(built.reason.length, rail).toBeGreaterThan(20)
      }
      expect(added.filter((rail) => toolRemedyOf(rail) !== null)).toEqual([
        'that-work-is-being-sent',
      ])
      // ⚠️ **No two members of `TOOL_REFUSALS` say the same thing**, which is the census `347` wrote
      // and the place this dispatch's four new members are most likely to collide.
      const sentences = TOOL_REFUSALS.map((rail) => refuseTool(rail).reason)
      expect(new Set(sentences).size).toBe(TOOL_REFUSALS.length)
    })

    it('⚠️ `withdrawn` is CLOSED in the one table that decides, and it always was', () => {
      // ⛔ **`429` §3 asks whether this is a new state or a new door onto an existing one.** ⚑ It is
      // a new DOOR: the state has been in the vocabulary since `379` and closed in `TASK_IS_OPEN`
      // since `400`. What it did not have was a producer that could reach work already handed over.
      expect(TASK_STATES).toContain('withdrawn')
      expect(TASK_IS_OPEN.withdrawn).toBe(false)
      // ⚑ **D-016, commit 5 · a third closed state, and it is not this one**: `closed` is the giver
      // ending the work itself, where `withdrawn` says this owner no longer owes it.
      expect(
        Object.entries(TASK_IS_OPEN)
          .filter(([, open]) => !open)
          .map(([state]) => state)
          .sort(),
      ).toEqual(['answered', 'closed', 'withdrawn'])
      // ⚑ **Two producers now, and the fold names both** — see `derivePieces` (⚑ D-016: the take-back
      // is `work_taken_back`).
      const fold = sourceOf(join(here, '../src/shared'), 'tasks.ts')
      expect(fold).toContain("if (event.type === 'work_taken_back') {")
      expect(fold).toContain("if (event.reason === 'cancelled') {")
    })
  })
})
