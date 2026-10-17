import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type {
  AgentToolset,
  ModelChoice,
  ProviderRuntimeContext,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  HandedPath,
  QueuedMessageEvent,
  RuntimeChangeMessage,
  RuntimeEventMessage,
  TranscriptEvent,
  UnqueuedMessageEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 689 — four small things main owes the window
 *
 * ⚑ **Each is a moment the window says something stale or does something a person did not ask
 * for, and each has its cause in main.** Measured through the host's own doors, over real SQLite
 * and real migrations, each with the control the brief names beside it.
 *
 * | § | from | what this file pins |
 * |---|---|---|
 * | 1 | **`673` F-7** | a holder that ENDS announces `work` — after its task reads the ending — and one holding no open work does not |
 * | 2 | **`687` inbox 3** | the launch sweep's ending carries the held row's ATTACHMENTS, and a message with none carries no key |
 * | 3 | **`685` H1** | a FAILED probe already cached is asked once more when a person asks; one that succeeded stays cached, and a fresh failure is not asked twice |
 * | 4 | **`685` H2** | ONE provider's list is its own door, and asking it makes no home for the other |
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

describe('689 · four small things main owes the window', () => {
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
  let announced: RuntimeChangeMessage[]
  /**
   * ⚑ **What the parent's Work tab would have read at the instant each `work` was announced** —
   * `638` §3's measurement, taken INSIDE the announcement, because *after* is exactly the moment
   * that cannot tell an announcement before the write from one after it.
   */
  let sawWhenAnnounced: { state: string; stalledBecause: string | null }[]
  let watching: { parent: string; piece: string } | null
  /** ⚑ **Every model list a provider was asked for**, as `profile/provider` — one per child. */
  let listed: string[]
  /** The `profile/provider` lists that fail when asked, until a test clears them. */
  let failing: Set<string>
  const tick = (): number => clock++
  const homes = (): string => join(userData, 'provider-homes')

  class Watching extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions: issued })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) handed.push(options.agentTools)
      handles.push(handle)
      return handle
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) handed.push(options.agentTools)
      handles.push(handle)
      return handle
    }
    override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
      const answer = await super.listModels(context)
      const asked = `${basename(dirname(context.providerHome))}/${this.provider}`
      listed.push(asked)
      if (failing.has(asked)) throw new Error(`${asked} could not be reached`)
      return answer
    }
  }

  /**
   * ⚑ One host over a store. ⛔ **A SECOND store object over the same file** is what the launch
   * sweep needs to see a held message as stranded — `live-hosts.ts` knows a ledger by its object
   * (`687` §5, `a-next-launch-test-needs-its-own-store-object`).
   */
  function buildHost(over: SessionStore): RuntimeHost {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Watching(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(homes(), profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(homes(), provider),
      // ⚑ The app's rule: a profile IS its folder, and BroBot's is always listed.
      listProfiles: () => [
        'brobot',
        ...(existsSync(homes()) ? readdirSync(homes()).filter((one) => one !== 'brobot') : []),
      ],
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      announce: (message) => {
        announced.push(message)
        if (message.what !== 'work' || watching === null) return
        const { parent, piece } = watching
        const row = store.piecesGivenBy(parent).find((one) => one.piece === piece)
        sawWhenAnnounced.push({
          state: row?.state ?? 'absent',
          stalledBecause: row?.stalledBecause ?? null,
        })
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-689-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-689-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_890_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    announced = []
    sawWhenAnnounced = []
    watching = null
    listed = []
    failing = new Set()
    hosts = []
    host = buildHost(store)
    window = new RecordingSink('webContents:1')
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return ((await tool.call(args)).structured ?? {}) as Record<string, unknown>
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** Every row of one type, as the store replays it. */
  const rowsOf = <Type extends TranscriptEvent['type']>(
    sessionId: string,
    type: Type,
  ): Extract<TranscriptEvent, { type: Type }>[] =>
    ledger(sessionId).filter(
      (event): event is Extract<TranscriptEvent, { type: Type }> => event.type === type,
    )

  const heldSaying = (sessionId: string, text: string): QueuedMessageEvent | undefined =>
    rowsOf(sessionId, 'message_queued').find((event) => event.text === text)
  const endingSaying = (sessionId: string, text: string): UnqueuedMessageEvent | undefined =>
    rowsOf(sessionId, 'message_unqueued').find((event) => event.text === text)

  const said = (): string[] => announced.map((one) => one.what)
  const saidWork = (): number => announced.filter((one) => one.what === 'work').length

  /**
   * ⚑ A PM in a window and a worker its give started, holding one piece of OPEN work the PM gave
   * it — its turn (the brief, D-016) parked on the card the fake provider asks every turn to pass.
   */
  const aWorkerHoldingOpenWork = async (): Promise<{
    pm: string
    worker: string
    workerHandle: FakeSessionHandle
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief: 'build the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = handles.at(-1)
    if (workerHandle === undefined) throw new Error('the give started no provider')
    const workerTools = theToolsetJustHandedOut()
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'permission_request'),
      'the worker’s turn to park on its card',
    )
    const piece = store.piecesOwnedBy(worker).find((one) => one.state === 'working')
    if (piece === undefined) throw new Error('the give opened no piece')
    return { pm, worker, workerHandle, workerTools, piece: piece.piece, label: piece.label }
  }

  /* ═════════════════ §1 · 673 F-7 — a holder that ENDS says its work moved ═════════════════════════ */

  describe('§1 · `673` F-7 — a holder that ENDS announces `work`, after its task reads the ending', () => {
    it('🔴 a CLOSE of a conversation holding open work announces `work` — and a window re-reading at that instant reads the ending', async () => {
      const { pm, worker, piece } = await aWorkerHoldingOpenWork()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      watching = { parent: pm, piece }
      announced.length = 0

      await host.close(worker, surface)

      // ⛔ **The premise** — the ending moved the row a parent's Work tab draws. ⚑ **D-016c · by
      // the turn it interrupted**, not by being a stop: the worker was parked on its card, so the
      // cause is that turn's.
      const row = store.piecesGivenBy(pm).find((one) => one.piece === piece)
      expect(row?.state).toBe('stalled')
      expect(row?.stalledBecause).toBe('turn_interrupted')
      // 🔴 **THE MEASUREMENT** — the ending said so, on the subject that tab re-reads on.
      expect(said(), 'the ending announced no work').toContain('work')
      // ⚑ **And AFTER the terminal rows** — every `work` it announced was made when the row already
      // read the interrupted turn, so a window that re-read on it cannot fetch the old word. ⚠️ The
      // PUMP is what orders it: the provider's terminal `turn` and `status: ended` land before the
      // teardown begins, so no order inside the teardown can break this — a row that moved the
      // announcement to the top of the teardown survived for that reason (the `689` table's
      // docstring).
      expect(sawWhenAnnounced.length).toBeGreaterThan(0)
      for (const one of sawWhenAnnounced) {
        expect(one, 'announced before the interrupted turn was in the ledger').toEqual({
          state: 'stalled',
          stalledBecause: 'turn_interrupted',
        })
      }
    })

    it('🔴 a holder whose STREAM FAILS announces `work` too — the ending is the teardown’s, not the Close button’s', async () => {
      const { pm, worker, workerHandle, piece } = await aWorkerHoldingOpenWork()
      watching = { parent: pm, piece }
      announced.length = 0

      workerHandle.simulateError('the provider stream ended unexpectedly', true)
      // ⚑ `conversations` is announced by the same synchronous stretch of the teardown, one line
      // above — so once it has arrived there is nothing left for `work` to wait for.
      await waitFor(() => said().includes('conversations'), 'the teardown to finish')

      // ⚑ **D-016c · the cause is the TURN's**: the fatal error ends the turn it cut before the
      // conversation's own terminal status, and a stop is never a cause.
      const row = store.piecesGivenBy(pm).find((one) => one.piece === piece)
      expect(row?.state).toBe('stalled')
      expect(row?.stalledBecause).toBe('turn_ended')
      expect(said(), 'a failed stream announced no work').toContain('work')
      void worker
    })

    it('⚑ THE CONTROL: an ending of a conversation holding NO work announces `conversations` and no `work`', async () => {
      const mine = await personOpens('pm')
      announced.length = 0

      await host.close(mine, window)

      // ⚑ **The channel is live in this harness** — the negative below is about `work`, not a
      // silence.
      expect(said(), 'the ending announced nothing at all').toContain('conversations')
      expect(saidWork(), 'an ending with no work announced work').toBe(0)
    })

    it('⚑ …nor does one whose only work is ANSWERED — it is in the ledger, and closed', async () => {
      const { worker, workerTools, label } = await aWorkerHoldingOpenWork()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      const replied = await call(workerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'built',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // ⛔ **The premise**: work in the ledger, and none of it open.
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
      expect(store.piecesOwnedBy(worker)[0]?.state).toBe('answered')
      announced.length = 0

      await host.close(worker, surface)

      expect(said(), 'the ending announced nothing at all').toContain('conversations')
      expect(saidWork(), 'an ending over closed work announced work').toBe(0)
    })
  })

  /* ═════════════════ §2 · 687 inbox 3 — a crashed message comes back with its files ═════════════════ */

  describe('§2 · `687` inbox 3 — the launch sweep carries the held row’s ATTACHMENTS onto the ending it writes', () => {
    /** Busy `sessionId` on a turn parked at its card, then hold `text` behind it. */
    const heldBehindATurn = async (
      sessionId: string,
      text: string,
      attached: HandedPath[],
    ): Promise<void> => {
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider for that conversation')
      await host.send(sessionId, `keep busy before ${text}`, window)
      await waitFor(() => handle.status() !== 'idle', 'a turn to hold behind')
      expect((await host.queueMessage(sessionId, text, window, attached)).outcome).toBe('queued')
    }

    it('🔴 a message held with FILES is offered back with them — and one held with none carries no `attachments` key', async () => {
      const withFiles = await personOpens('pm')
      const path = join(realpathSync(root), 'the-brief.md')
      writeFileSync(path, 'x')
      const attached: HandedPath[] = [
        { path, kind: 'file', outsideCwd: false },
        { path: realpathSync(root), kind: 'directory', outsideCwd: false },
      ]
      await heldBehindATurn(withFiles, 'read these', attached)
      // ⚑ **THE CONTROL, through the same sweep**: a person's held words with nothing attached.
      const without = await personOpens('worker')
      await heldBehindATurn(without, 'nothing attached', [])
      // ⛔ **The premise** — the held rows carry what they were queued with.
      expect(heldSaying(withFiles, 'read these')?.attachments).toEqual(attached)
      expect(heldSaying(without, 'nothing attached')).not.toHaveProperty('attachments')

      // ⚑ **The next launch** — a second host over a SECOND store object (see `buildHost`).
      buildHost(createSessionStore(db, tick))

      const ending = endingSaying(withFiles, 'read these')
      expect(ending?.reason).toBe('abandoned')
      expect(ending?.detail).toBe('the app stopped while this message was still waiting to be sent')
      // 🔴 **THE MEASUREMENT** — the ending is what a window that paged past the queueing rebuilds
      // the row from, and it is what *Put it back in the composer* hands back.
      expect(ending?.attachments).toEqual(attached)
      // ⚑ **Absent, never empty** — the writer's own rule, so a conversation that never attaches
      // anything keeps the ledger it had.
      const bare = endingSaying(without, 'nothing attached')
      expect(bare?.reason).toBe('abandoned')
      expect(bare).not.toHaveProperty('attachments')
    })
  })

  /** ⚑ How many times `profile/provider`'s list has been asked — one per child spawned for it. */
  const asked = (key: string): number => listed.filter((one) => one === key).length

  /** ⚑ A profile that HAS run on Claude — its folder exists, and it has no Codex home. */
  const aProfileThatHasRun = async (slug: string): Promise<void> => {
    const id = await personOpens(slug)
    await host.close(id, window)
    expect(existsSync(join(homes(), slug, 'claude'))).toBe(true)
  }

  /** ⚑ An identity a person made, with no folder: it has never run (`682`'s own shape). */
  const anAgentThatHasNeverRun = (slug: string, provider: Provider | null): void => {
    expect(
      store.createAgentIdentity({ slug, displayName: null, provider }, { by: 'a-person' }),
    ).not.toBeNull()
  }

  /* ═════════════════ §3 · 685 H1 — a failed probe is asked again when a person asks ═══════════════ */

  describe('§3 · `685` H1 — a cached FAILURE is asked once more when a person asks', () => {
    it('🔴 one failed probe does not stand for the life of the app — the next ask asks again, and gets the list', async () => {
      await aProfileThatHasRun('developer')
      failing.add('developer/claude')
      const first = await host.providerModels('developer', 'claude')
      expect(first).toMatchObject({ ok: false, reason: 'refused' })
      expect(asked('developer/claude')).toBe(1)
      failing.clear()

      const again = await host.providerModels('developer', 'claude')

      // 🔴 **THE MEASUREMENT** — a new child, and the list it answered.
      expect(asked('developer/claude')).toBe(2)
      expect(again.ok, JSON.stringify(again)).toBe(true)
      // ⚑ Cached now, and a success: the next ask spawns nothing.
      await host.providerModels('developer', 'claude')
      expect(asked('developer/claude')).toBe(2)
    })

    it('⚑ THE CONTROLS: a probe that SUCCEEDED stays cached, and a failure this very ask produced is not asked twice', async () => {
      await aProfileThatHasRun('developer')
      failing.add('developer/claude')
      /** ⚑ Both providers' lists for the profile, each through the one-provider door. */
      const both = () =>
        Promise.all([
          host.providerModels('developer', 'claude'),
          host.providerModels('developer', 'codex'),
        ])

      await both()
      // ⛔ **A fresh failure is asked ONCE** — asking again at once would spend a second child on
      // an answer a moment old (the Save door's own round-two rule).
      expect(asked('developer/claude')).toBe(1)
      expect(asked('developer/codex')).toBe(1)

      await both()
      // ⚑ **An answer that SUCCEEDED is a value, not a question** — no child for it.
      expect(asked('developer/codex')).toBe(1)
      // …while the failure, cached now, was asked once more.
      expect(asked('developer/claude')).toBe(2)
    })

    it('⚑ asks in the same tick share ONE child — over a failure already cached, and over one still being asked', async () => {
      await aProfileThatHasRun('developer')
      failing.add('developer/claude')
      // ⛔ **Nothing cached, two asks at once**: the second meets the first's probe IN FLIGHT, which
      // is fresh — so it takes that answer rather than asking again (`689`'s review).
      await Promise.all([
        host.providerModels('developer', 'claude'),
        host.providerModels('developer', 'claude'),
      ])
      expect(asked('developer/claude')).toBe(1)
      // ⛔ **A failure cached and settled, two asks at once**: ONE of them asks again and the other
      // joins it — each forgets only the promise it awaited, never a probe still running.
      await Promise.all([
        host.providerModels('developer', 'claude'),
        host.providerModels('developer', 'claude'),
      ])
      expect(asked('developer/claude')).toBe(2)
    })

    it('⛔ …and an ask already in flight when the quit starts does not ask again either', async () => {
      await aProfileThatHasRun('developer')
      failing.add('developer/codex')
      const first = await host.providerModels('developer', 'codex')
      rmSync(join(homes(), 'developer', 'codex'), { recursive: true, force: true })
      failing.clear()

      // ⚑ **Asked BEFORE the quit** — it passes the door, and meets the quit while it waits on the
      // cached failure it is about to ask again.
      const inFlight = host.providerModels('developer', 'codex')
      const closing = host.closeAll()
      const during = await inFlight
      await closing

      expect(during).toEqual(first)
      expect(asked('developer/codex')).toBe(1)
      expect(existsSync(join(homes(), 'developer', 'codex')), 'a quit laid down a home').toBe(false)
    })

    it('⛔ once a quit has started, a cached FAILURE is handed back as it is — never asked again, and no home laid down', async () => {
      await aProfileThatHasRun('developer')
      failing.add('developer/codex')
      const first = await host.providerModels('developer', 'codex')
      expect(first).toMatchObject({ ok: false, reason: 'refused' })
      rmSync(join(homes(), 'developer', 'codex'), { recursive: true, force: true })
      failing.clear()

      const closing = host.closeAll()
      const during = await host.providerModels('developer', 'codex')
      await closing

      // ⚑ **The same answer, not `closing`** — a quit hands back what it has (070).
      expect(during).toEqual(first)
      expect(asked('developer/codex')).toBe(1)
      expect(existsSync(join(homes(), 'developer', 'codex')), 'a quit laid down a home').toBe(false)
    })
  })

  /* ═════════════════ §4 · 685 H2 — the press asks ONE provider ══════════════════════════════════════ */

  describe('§4 · `685` H2 — one provider’s list is its own door, and asking it makes no home for the other', () => {
    it('🔴 the one-provider DOOR asks Claude ALONE for a Claude agent — no Codex home appears in its folder', async () => {
      // ⚑ **The read the window's list door asks through** (`modelList` → `theListFor`).
      await aProfileThatHasRun('developer')
      expect(store.setAgentProvider('developer', 'claude')).toBe(true)
      const codexHome = join(homes(), 'developer', 'codex')
      expect(existsSync(codexHome)).toBe(false)
      const before = listed.length

      const list = await host.providerModels('developer', 'claude')

      expect(list.ok, JSON.stringify(list)).toBe(true)
      // 🔴 **THE MEASUREMENT** — one child, for the provider named, and nothing made for the other.
      expect(listed.slice(before)).toEqual(['developer/claude'])
      expect(existsSync(codexHome), 'asking Claude made a Codex home').toBe(false)
    })

    it('⚑ an agent that has never run is answered from BroBot’s home — for the provider named, marked, and its own folder never made', async () => {
      anAgentThatHasNeverRun('scout', 'codex')
      const before = listed.length

      const list = await host.providerModels('scout', 'codex')

      expect(list).toMatchObject({ ok: true, standIn: 'brobot' })
      expect(listed.slice(before)).toEqual(['brobot/codex'])
      expect(existsSync(join(homes(), 'scout')), 'asking created the agent’s folder').toBe(false)
    })

    it('⚑ a name with no identity row is `no-profile` — nothing is asked and nothing is made', async () => {
      const before = listed.length

      expect(await host.providerModels('typing', 'claude')).toEqual({
        ok: false,
        reason: 'no-profile',
      })

      expect(listed.slice(before)).toEqual([])
      expect(existsSync(join(homes(), 'typing'))).toBe(false)
    })

    // ⚑ **D-049 · the window asks one provider's list through the list door** (`modelList`), which
    // asks this read for that provider and no other.
    it('⚑ over the WIRE: the window’s command reaches the door, and a provider the app does not have is refused at it', async () => {
      await aProfileThatHasRun('developer')
      const before = listed.length

      const list = await executeRuntimeCommand(host, window, {
        kind: 'modelList',
        profileId: 'developer',
        provider: 'claude',
      })

      expect(list).toMatchObject({ provider: 'claude', notAsked: null })
      expect(listed.slice(before)).toEqual(['developer/claude'])
      await expect(
        executeRuntimeCommand(host, window, {
          kind: 'modelList',
          profileId: 'developer',
          provider: 'gemini',
        } as never),
      ).rejects.toThrow()
      expect(listed.slice(before)).toEqual(['developer/claude'])
    })

    it('⚑ once a quit has started, a list nobody has asked for is refused rather than spawned — and no home is laid down', async () => {
      await aProfileThatHasRun('developer')
      const closing = host.closeAll()
      await expect(host.providerModels('developer', 'codex')).rejects.toThrow(/shutting down/)
      await closing
      expect(asked('developer/codex')).toBe(0)
      expect(existsSync(join(homes(), 'developer', 'codex')), 'a quit laid down a home').toBe(false)
    })

    it('⛔ …and it reads no store to say so — the database may already be closed', async () => {
      // ⛔ Before `689`'s review the stand-in question read `agent_identity` FIRST, so a read still
      // asking once the connection had closed was told the connection was closed.
      await aProfileThatHasRun('developer')
      await host.providerModels('developer', 'claude')
      await host.closeAll()
      db.close()

      await expect(host.providerModels('developer', 'codex')).rejects.toThrow(/shutting down/)
      expect(await host.providerModels('developer', 'claude')).toMatchObject({ ok: true })
    })
  })
})
