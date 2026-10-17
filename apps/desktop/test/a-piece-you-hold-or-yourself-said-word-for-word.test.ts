import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { sameLocalDay } from '../src/shared/local-time'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'

/**
 * 🔴 **W4.154 · F089–F091 — the words a model reads, WORD FOR WORD** (`52872cc0`, `8e0773c3`).
 *
 * The devs' own tests compare these refusals with the functions and constants that build them
 * (`aTakeBackOfAPieceYouHold(label)`, `A_CONVERSATION_CANNOT_INTERRUPT_ITSELF`), so a sentence
 * reworded in its builder still passes them, and `the-act-inside-the-cut` pins only each act. Here
 * every sentence is written out, so its whole meaning is pinned:
 *
 *  - §1 · F089 · `withdraw_task` on a piece the caller holds — open; ended each way (answered, taken
 *    back, closed), and read days later; on its own root; and on a name it neither holds nor gave.
 *  - §2 · F090 · `update_work` from the owner of a piece taken back while its give still waited
 *    (whose row names nobody) — close, new brief and title — and the words as the model reads them.
 *  - §3 · F091 · `interrupt_agent` naming itself — its id, a piece it holds open and once ended, its
 *    own root — and a piece it GAVE, which names its holder, never itself.
 *
 * Real host, real SQLite ledger, real migrations, over `FakeRuntime` — the harness of
 * `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`, cut to what this needs.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const DAY_MS = 86_400_000

const THE_GUESS =
  'that is not a piece you gave (or, when the call names an agent, not one you gave that agent), so nothing was done. list_tasks lists the open pieces you gave out, and with state: "all" the ended ones too; the name may belong to another conversation, or to nothing at all.'
const NOT_ITSELF =
  'that is this conversation: a conversation cannot interrupt itself, so nothing was interrupted. Stop your own work yourself, or name another agent to interrupt.'

/** F089 · an open piece the caller holds, whole. */
const anOpenHeldPiece = (label: string): string =>
  `to hand it back finished, call reply_to_parent; to ask about it, call ask_question naming it: ${label} is a piece you hold, not one you gave, so nothing was taken back. withdraw_task takes back only a piece you gave.`

/** F089 · an ended piece the caller holds, whole; `how` is the clause after "it has already ended:". */
const anEndedHeldPiece = (label: string, how: string): string =>
  `stop work on that piece; no further reply is owed. ${label} is a piece you hold, not one you gave, and it has already ended: ${how}, so there was nothing left to take back.`

/** F089 · the caller's own root, whole. */
const itsOwnRoot = (label: string): string =>
  `ask a person with ask_question naming it, and answer the person here when it is done: ${label} is this conversation’s own work, from a person, so nothing was taken back. withdraw_task takes back only a piece you gave.`

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

/** `FakeRuntime` with the toolset each launch was handed captured, so a test can act as that agent. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('W4.154 · F089–F091 · a piece you hold, or yourself, said word for word', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
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
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-held-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-held-words-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_200_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
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

  /** The words a model reads, and the payload beside them. */
  const callWithWords = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await callWithWords(toolset, name, args)).structured

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const aGive = async (
    tools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /** A PM a person opened, and one worker it gave a piece to. */
  const aPmAndItsWorker = async (title: string) => {
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

  /** When the piece `label` that `holder` holds ended — its row's own moment. */
  const endedAt = (holder: string, label: string): number => {
    const at = store.piecesOwnedBy(holder).find((one) => one.label === label)?.endedAt
    if (typeof at !== 'number') throw new Error(`${label} has no moment it ended`)
    return at
  }

  /** A refusal, with its words as the model reads them and as the payload carries them. */
  const expectRefused = (
    said: { structured: Record<string, unknown>; text: string },
    rail: string,
    reason: string,
    what: string,
  ): void => {
    expect(said.structured, what).toMatchObject({
      outcome: 'refused',
      rail,
      permanence: 'permanent',
      retryable: false,
      reason,
    })
    // The rail's sentence as it was, then only the permanence the answer adds.
    expect(reason, what).toMatch(/[.!?]$/)
    expect(said.text, what).toBe(
      `refused (${rail}): ${reason} ${permanenceInWords(rail, 'permanent')}`,
    )
  }

  describe('§1 · F089 · withdraw_task on a piece the caller holds', () => {
    it('🔴 open: the whole sentence — and the giver of the same piece takes it back', async () => {
      const { workerTools, pmTools, label } = await aPmAndItsWorker('the piece')
      const refused = await callWithWords(workerTools, 'withdraw_task', { piece: label })
      expectRefused(refused, 'not-a-piece-you-gave', anOpenHeldPiece(label), label)
      expect(refused.structured.detail).toEqual({ piece: label, label })
      // ⚑ The pair one caller over: the pm gave it, and takes it back.
      const tookBack = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(tookBack.outcome, JSON.stringify(tookBack)).toBe('ok')
    })

    it('🔴 ended — answered by it, taken back by its giver, closed by its giver: each whole, with who and when', async () => {
      const { pm, worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
      await bringIdentityIntoBeing('helper')
      await bringIdentityIntoBeing('reviewer')
      const back = await aGive(pmTools, 'helper', 'the piece taken back')
      const closed = await aGive(pmTools, 'reviewer', 'the piece closed')
      expect(
        (
          await callOn(workerTools, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'done',
          })
        ).outcome,
      ).toBe('ok')
      expect((await callOn(pmTools, 'withdraw_task', { piece: back.label })).outcome).toBe('ok')
      expect(
        (await callOn(pmTools, 'update_work', { piece: closed.label, close: true })).outcome,
      ).toBe('ok')
      const thePm = host.whatToCallTheConversation(pm)
      for (const [holder, named, how] of [
        [worker, label, (at: number) => `you answered it at ${clockTime(at)}`],
        [
          back.agent,
          back.label,
          (at: number) => `it was taken back by ${thePm} at ${clockTime(at)}`,
        ],
        [
          closed.agent,
          closed.label,
          (at: number) => `it was closed by ${thePm} at ${clockTime(at)}`,
        ],
      ] as const) {
        const at = endedAt(holder, named)
        const tools = holder === worker ? workerTools : agentToolsFor(host, holder)
        const refused = await callWithWords(tools, 'withdraw_task', { piece: named })
        expectRefused(refused, 'not-a-piece-you-gave', anEndedHeldPiece(named, how(at)), named)
      }
    })

    it('🔴 read days after it ended: the ending is said with its day, and the detail keeps the ending’s own moment', async () => {
      const { workerTools, worker, label } = await aPmAndItsWorker('the piece')
      expect(
        (
          await callOn(workerTools, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'done',
          })
        ).outcome,
      ).toBe('ok')
      const at = endedAt(worker, label)
      clock += 3 * DAY_MS
      expect(sameLocalDay(at, clock)).toBe(false)
      const said = clockTimeFrom(at, clock)
      expect(said).not.toBe(clockTime(at))
      const refused = await callWithWords(workerTools, 'withdraw_task', { piece: label })
      expectRefused(
        refused,
        'not-a-piece-you-gave',
        anEndedHeldPiece(label, `you answered it at ${said}`),
        label,
      )
      expect(refused.structured.detail).toMatchObject({ label, state: 'answered', at })
    })

    it('🔴 its own root: the whole sentence; a name it neither holds nor gave keeps the guess, whole', async () => {
      const { pm, pmTools, workerTools } = await aPmAndItsWorker('the piece')
      const itsRoot = store.rootOf(pm)?.label
      if (itsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      const ofTheRoot = await callWithWords(pmTools, 'withdraw_task', { piece: itsRoot })
      expectRefused(ofTheRoot, 'not-a-piece-you-gave', itsOwnRoot(itsRoot), itsRoot)
      expect(ofTheRoot.structured.detail).toEqual({ piece: itsRoot, label: itsRoot })
      // ⚑ …and a name that is none of the caller's: the pm's root, named by its worker, and a
      // made-up one — one answer, so a name is no oracle.
      for (const spelled of [itsRoot, 'W99.99']) {
        const refused = await callWithWords(workerTools, 'withdraw_task', { piece: spelled })
        expectRefused(refused, 'not-a-piece-you-gave', THE_GUESS, spelled)
        expect(refused.structured.detail, spelled).toEqual({ piece: spelled })
      }
    })
  })

  describe('§2 · F090 · update_work on an ended piece its caller holds', () => {
    it('🔴 taken back while its give still waited: close, new brief and title are told how and when, by nobody, as the model reads it', async () => {
      const { worker, pmTools, workerTools } = await aPmAndItsWorker('the first piece')
      const waited = await aGive(pmTools, 'worker', 'the piece that never reached it')
      expect(waited.agent).toBe(worker)
      expect((await callOn(pmTools, 'withdraw_task', { piece: waited.label })).outcome).toBe('ok')
      const row = store.piecesOwnedBy(worker).find((one) => one.label === waited.label)
      expect(row?.state).toBe('withdrawn')
      expect(row?.endedBy).toBeNull()
      const at = endedAt(worker, waited.label)
      const words = `stop work on that piece; no further reply is owed. ${waited.label} was taken back at ${clockTime(at)}, so nothing was changed.`
      for (const args of [
        { piece: waited.label, close: true },
        { piece: waited.label, brief: 'again' },
        { piece: waited.label, title: 'mine now' },
      ]) {
        const refused = await callWithWords(workerTools, 'update_work', args)
        expectRefused(refused, 'that-piece-has-ended', words, JSON.stringify(args))
        expect(refused.structured.detail, JSON.stringify(args)).toMatchObject({
          piece: waited.piece,
          label: waited.label,
          state: 'withdrawn',
          at,
          yoursToRetitle: false,
        })
        expect(refused.structured.detail, JSON.stringify(args)).not.toHaveProperty('called')
      }
    })
  })

  describe('§3 · F091 · interrupt_agent naming itself', () => {
    it('🔴 its id, a piece it holds — open, then ended — and its own root: the whole sentence; a piece it gave names its holder, never itself', async () => {
      const { pm, worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
      const itsRoot = store.rootOf(pm)?.label
      if (itsRoot === undefined) throw new Error('a conversation a person opened owns a root')
      const readPiece = host.pieceRecord.bind(host)
      vi.spyOn(host, 'pieceRecord').mockImplementation((caller, named) => {
        const record = readPiece(caller, named)
        const ownRoot = caller === pm && named === itsRoot
        if (!ownRoot || record.is === 'no-piece-by-that-name') return record
        return {
          ...record,
          children: record.children.map((child) => {
            if (child.owner !== worker) return child
            return { ...child, state: 'working' as const }
          }),
        }
      })
      const premise = host.pieceRecord(pm, itsRoot)
      expect(premise.is).not.toBe('no-piece-by-that-name')
      if (premise.is === 'no-piece-by-that-name') throw new Error('the caller owns this root')
      expect(premise.children.find((child) => child.owner === worker)?.state).toBe('working')
      for (const [tools, named, itself] of [
        [workerTools, worker, worker],
        [workerTools, label, worker],
        [pmTools, pm, pm],
        [pmTools, itsRoot, pm],
      ] as const) {
        const said = await callWithWords(tools, 'interrupt_agent', { agent: named, reason: 'stop' })
        const guide =
          named === label
            ? ` ${label} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : named === itsRoot
              ? ` ${itsRoot} is your own piece. Its helpers: Ada (worker) on ${label} (working). Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question. For new work, give_work with its profile. To stop a helper below you, interrupt_agent with its label.`
              : ''
        expectRefused(said, 'that-agent-is-you', NOT_ITSELF + guide, named)
        expect(said.structured.detail, named).toEqual({ agent: itself })
      }
      // ⚑ Once it has ended, its label still names its owner: still this conversation.
      expect(
        (
          await callOn(workerTools, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'done',
          })
        ).outcome,
      ).toBe('ok')
      const ended = await callWithWords(workerTools, 'interrupt_agent', {
        agent: label,
        reason: 'stop',
      })
      expectRefused(
        ended,
        'that-agent-is-you',
        NOT_ITSELF +
          ` ${label} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`,
        `${label}, ended`,
      )
      // ⚑ The pair: the pm names the same label — a piece it gave, whose holder is another.
      const ofTheHolder = await callWithWords(pmTools, 'interrupt_agent', {
        agent: label,
        reason: 'stop',
      })
      expect(ofTheHolder.structured.rail, JSON.stringify(ofTheHolder.structured)).not.toBe(
        'that-agent-is-you',
      )
      expect(ofTheHolder.text).not.toContain('cannot interrupt itself')
    })
  })
})
