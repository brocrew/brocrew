import { callOn as callAgentTool } from './helpers/call-agent-tool'
import { format } from 'node:util'
import {
  expectRecordedCannotRun,
  expectTaskKept,
  recordedSendNotices,
  expectRecordedMessageDelivered,
} from './lib/recorded-send'
import {
  newConversationGive,
  giveWorkBeforeProviderStart,
  openPmWithSeededWorker,
} from './lib/give-fixture'
import { personOpener } from './helpers/person-opens-session'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, FakeProviderSessions } from '@brobot2/runtime'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { CodexRuntime, createSpawnTransportFactory } from '@brobot2/runtime/codex'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { CodexUnavailableError } from '../src/main/providers/codex/program'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
} from '../../../packages/runtime/test/fixtures/a-spawn-that-failed'
import { RecordingSink, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'

/**
 * ⚑ **Codex's transport spawns through `node:child_process` with no seam**, so the ONE spawn a test
 * wants to fail is armed here; every other spawn in the module graph reaches the real function.
 */
const armed = vi.hoisted(() => ({ next: null as null | (() => unknown) }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (...args: unknown[]): unknown => {
      const next = armed.next
      armed.next = null
      return next === null ? (real.spawn as (...given: unknown[]) => unknown)(...args) : next()
    },
  }
})

/**
 * # 🔴 707 · R39, extended — a spawn that ran short is not a broken tool
 *
 * ⚑ **PM ruling R39, extended** (`705` F-2): *"`spawn_agent` meets a transient shortage (`EMFILE`)
 * too — it gets the retryable word, never a broken tool."*
 *
 * ⛔ **What `spawn_agent` answered on `main` (`224e1f45`), for a machine that ran short for a
 * moment**: nothing — the tool THREW, which both adapters turn into *"spawn_agent failed: …"*, a
 * broken tool (`657`'s `launchedOrSaid` rethrows what it does not recognise, and it recognised no
 * errno). Claude's pipes-made arm was worse: its start handed back a handle and the spawn said `ok`
 * about a conversation whose CLI never ran. ⚑ **The errors below are the ADAPTERS' OWN**, made by the
 * real `ClaudeRuntime` over the SDK's real `query()` and the real `CodexRuntime` over its real
 * transport, each handed a spawn that failed in the shape Node gives it (measured in `705`,
 * `the-errno-a-resume-carries.test.ts` §0) — and then thrown from the provider's `start`, where the
 * host meets it.
 *
 * ⚑ **D-016 · `spawn_agent` is gone, and `give_work` is the door that starts a conversation**: the
 * same launch classifier answers it, so every section below asks a give.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ The new word — spelled here as a string, so `main` (which has no such word) can run this file. */

describe('707 · R39, extended — a spawn that ran short', () => {
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
  let gate: ResumeGate
  /** ⚑ The HOST's own step failing — `prepareProviderHome`, which every launch runs before its provider. */
  let homeFails: (() => Error) | undefined
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        if (homeFails !== undefined) throw homeFails()
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-707-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-707-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_070_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    armed.next = null
    homeFails = undefined
  })

  afterEach(async () => {
    armed.next = null
    vi.restoreAllMocks()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const personOpens = personOpener(() => ({ host, root, window }), 'auto')

  const callOn = (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    callAgentTool(agentToolsFor(host, caller), name, args)

  /** ⚑ A PM a person opened, which may start `worker` — an identity a person opened once, so it exists. */
  const aPmThatMaySpawn = () =>
    openPmWithSeededWorker(personOpens, (id) => host.close(id, window))

  /** ⚑ **D-016 · `give_work` is the door that starts a conversation now** — `worker` has none with the PM. */
  const spawnWorker = (pm: string): Promise<Record<string, unknown>> =>
    giveWorkBeforeProviderStart((name, args) => callOn(pm, name, args))

  const aKeptGive = (result: Record<string, unknown>, reason: string, needsPerson = false) => {
    const receipt = expectRecordedCannotRun(result, 'task', reason, needsPerson)
    expectTaskKept(store, receipt)
    return receipt
  }

  const sendToTheKeptAddress = (pm: string, address: string) =>
    callOn(pm, 'message_agent', { agent: address, text: 'carry on' })

  const shortageWords = (code: string): string =>
    code === 'EMFILE' ? 'BroCrew had too many files open' : 'ran short of open files'

  // ───────────────────────────────────────────────────────────────────────────────
  // the adapters' own errors
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ Claude: the SDK's real `query()`, on the adapter's own spawn seam. ⛔ On `main` its pipes-made
   * arm RESOLVED, so there is no error to hand the host — the producer says so, and that is the red.
   */
  const claudeStartOver = async (child: () => unknown): Promise<Error> => {
    const produced = await new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      () => child() as never,
    )
      .start({ cwd: root, providerHome: join(root, 'claude-home-707'), approvalMode: 'auto' })
      .then(
        async (handle) => {
          await handle.close()
          return new Error('claude start RESOLVED a handle — its CLI never ran')
        },
        (thrown: unknown) => thrown,
      )
    expect(produced).toBeInstanceOf(Error)
    expect((produced as Error).message).not.toContain('RESOLVED a handle')
    return produced as Error
  }

  /** ⚑ Codex: the real transport and start; a command that does not exist, in case it is unarmed. */
  const codexStartOver = async (child: () => unknown): Promise<Error> => {
    armed.next = child
    const produced = await new CodexRuntime(
      createSpawnTransportFactory('/nonexistent/brobot2-707/codex'),
    )
      .start({ cwd: root, providerHome: join(root, 'codex-home-707'), approvalMode: 'auto' })
      .then(
        () => new Error('codex start RESOLVED a handle'),
        (thrown: unknown) => thrown,
      )
    expect(produced).toBeInstanceOf(Error)
    return produced as Error
  }

  const SHORTAGES = [
    {
      name: 'Claude, a spawn EMFILE',
      code: 'EMFILE',
      make: () => claudeStartOver(() => aSpawnThatRanOutOf('EMFILE', '/x/claude').child),
    },
    {
      name: 'Claude, a spawn EAGAIN after its pipes',
      code: 'EAGAIN',
      make: () => claudeStartOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/claude').child),
    },
    {
      name: 'Claude, a spawn ENOMEM thrown at once',
      code: 'ENOMEM',
      make: () =>
        claudeStartOver(() => {
          throw Object.assign(new Error('spawn /x/claude ENOMEM'), {
            code: 'ENOMEM',
            syscall: 'spawn /x/claude',
          })
        }),
    },
    {
      name: 'Codex, a spawn EMFILE',
      code: 'EMFILE',
      make: () => codexStartOver(() => aSpawnThatRanOutOf('EMFILE', '/x/codex').child),
    },
    {
      name: 'Codex, a spawn ENFILE',
      code: 'ENFILE',
      make: () => codexStartOver(() => aSpawnThatRanOutOf('ENFILE', '/x/codex').child),
    },
    {
      name: 'Codex, a spawn EAGAIN after its pipes',
      code: 'EAGAIN',
      make: () => codexStartOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex').child),
    },
  ] as const

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the word, its price, and the retry it asks for
  // ───────────────────────────────────────────────────────────────────────────────

  describe.each(SHORTAGES)('§1 · $name', ({ code, make }) => {
    it('keeps the task, names the shortage, and retains the adapter failure in the log', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      const logged = vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const result = await spawnWorker(pm)
      const kept = aKeptGive(result, shortageWords(code))
      expect(host.sessionIds).not.toContain(kept.recipient.id)
      expect(logged.mock.calls.map((args) => format(...args)).join(' ')).toContain(code)
    })

    it('starts the same conversation when the shortage clears', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const kept = aKeptGive(await spawnWorker(pm), shortageWords(code))
      gate.startFails = undefined
      const started = await sendToTheKeptAddress(pm, kept.recipient.address)
      expect(started).toMatchObject({
        outcome: 'ok',
        receipt: { recipient: { id: kept.recipient.id, address: kept.recipient.address } },
      })
      await waitFor(
        () => host.sessionIds.includes(kept.recipient.id),
        'the same recipient to start',
      )
      const given = events(kept.recipient.id).filter((event) => event.type === 'work_given')
      expect(given).toHaveLength(1)
      expect(given[0]).toMatchObject({ piece: kept.recorded.id })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the controls — a real *never* keeps the permanent word
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · a real never keeps its permanent word', () => {
    it('⚑ a sign-in the machine does not have', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      aKeptGive(await spawnWorker(pm), 'Claude sign-in could not be used', true)
    })

    // 🔴 **716 · R67 — one word for a missing program**: it was `agent-did-not-start` until `716`, and
    // is R51's `agent-could-not-be-started` now, as Claude's is (`what-a-person-must-fix-said-once`
    // §1) — so this arm is RED on `main` from `716` on, and no longer a control. ⚑ Still permanent and
    // still never the shortage word, which is what it was here for.
    it('🔴 a provider binary this build cannot run', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new CodexUnavailableError('Codex isn’t available in this build.')
      aKeptGive(await spawnWorker(pm), 'could not run its provider’s program', true)
    })
  })

  const expectKeptTaskAfterProgramFailure = async (produced: Error) => {
    const pm = await aPmThatMaySpawn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    gate.startFails = () => produced
    aKeptGive(await spawnWorker(pm), 'could not run its provider’s program', true)
  }

  /**
   * 🔴 **710 · R51 — these two were §2's controls, and they are RED on `main` now**: a code a person
   * has to fix is never the shortage word, and since `710` it is not a broken tool either — the tool
   * threw on `main`; R51 gives it a permanent word of its own (`a-spawn-a-person-must-fix.test.ts`,
   * which owns the rest). ⚑ Moved out of the controls by `710`'s review, so §2 holds only arms that
   * pass on `main`.
   */
  describe('§2c · 710 · R51 — a spawn errno a person must fix has its permanent word', () => {
    it('🔴 a spawn errno a PERSON has to fix is never the shortage word — it is R51’s permanent one', async () => {
      const produced = await claudeStartOver(() => {
        throw Object.assign(new Error('spawn /x/claude ENOTDIR'), {
          code: 'ENOTDIR',
          syscall: 'spawn /x/claude',
        })
      })
      await expectKeptTaskAfterProgramFailure(produced)
    })

    it('🔴 …on Codex too, where the binary is not there after its pipes', async () => {
      const produced = await codexStartOver(
        () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/codex').child,
      )
      await expectKeptTaskAfterProgramFailure(produced)
    })
  })

  /**
   * 🔴 **Claude's pipes-made arm, for a failure a PERSON has to fix** — not a control: on `main`
   * Claude's `start()` handed back a handle for it (`ENOENT` reaches the child a tick after `spawn`,
   * with its pipes made), so `spawn_agent` said `ok` about a conversation whose CLI never ran.
   */
  describe('§2b · Claude, a binary that is not there, after its pipes', () => {
    // ⚑ **710 · R51**: refused, and since `710` in a permanent word of its own rather than a thrown
    // errno — `a-spawn-a-person-must-fix.test.ts` §1 owns the word; this arm keeps `707`'s claim.
    it('🔴 the start is refused — never a spawn that says it started', async () => {
      const produced = await claudeStartOver(
        () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude').child,
      )
      await expectKeptTaskAfterProgramFailure(produced)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · standing rule 8.4 — what a PERSON sees at it
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§3 · what a person reads in the transcript', () => {
    const noticesOf = (sessionId: string) => recordedSendNotices(events(sessionId))

    const receiptFor = async (pm: string) => {
      const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'give_work')
      if (tool === undefined) throw new Error('no give_work')
      return tool.call(newConversationGive('worker', 'The work', 'the work'))
    }

    it('records the work for the giver and tells them how to retry its address', async () => {
      const produced = await SHORTAGES[3].make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const answer = await receiptFor(pm)
      const kept = aKeptGive(
        answer.structured as Record<string, unknown>,
        shortageWords(SHORTAGES[3].code),
      )
      expect(events(pm)).toContainEqual(
        expect.objectContaining({
          type: 'work_sent',
          piece: kept.recorded.id,
          to: kept.recipient.id,
        }),
      )
      expect(noticesOf(pm).some((text) => text.startsWith('refused: give_work'))).toBe(false)
      expect(answer.text).toContain(
        `Task ${kept.recorded.taskLabel} is recorded in conversation ${kept.recipient.address} · The work, but it could not start:`,
      )
      expect(answer.text).toContain('send a message to this address to try starting it again.')
      expect(answer.text).not.toContain('Ask the person to fix it')
    })

    it('asks for a person when that person can fix the leading cause', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      const answer = await receiptFor(pm)
      aKeptGive(
        answer.structured as Record<string, unknown>,
        'Claude sign-in could not be used',
        true,
      )
      expect(noticesOf(pm).some((text) => text.startsWith('refused: give_work'))).toBe(false)
      expect(answer.text).toContain('Ask the person to fix it, with request_action.')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §4 · a shortage the HOST met — at both doors, each in its own words
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **The launch's classifier reads a shortage from ANY error now**, and so does the wake's — so a
   * shortage the host met BEFORE any adapter was asked (`prepareProviderHome`, which every launch runs
   * first: `mkdir`, a config write, the copy-once sign-in) is the retryable word at each door, in that
   * door's words. ⚑ **The host's own step, failing** (`707`'s review: the first cut threw it from the
   * provider's `resume`, which no real adapter lets out unwrapped). ⛔ On `main` both were a broken tool.
   */
  describe('§4 · a shortage the host met is the retryable word, at each door in its own words', () => {
    const turnsIn = (sessionId: string): number =>
      events(sessionId).filter((event) => event.type === 'turn').length
    const shortOfDescriptors = (): Error =>
      Object.assign(new Error('EMFILE: too many open files, mkdir'), {
        code: 'EMFILE',
        syscall: 'mkdir',
      })

    it('🔴 give_work — the start’s word', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = shortOfDescriptors
      const kept = aKeptGive(await spawnWorker(pm), shortageWords('EMFILE'))
      homeFails = undefined
      expect(await sendToTheKeptAddress(pm, kept.recipient.address)).toMatchObject({
        outcome: 'ok',
        receipt: { recipient: { id: kept.recipient.id } },
      })
    })

    /**
     * ⚑ **D-017 — the wake is the start the parent's MESSAGE makes** (`resume_agent` and `end_agent`
     * are gone): the worker is stopped by the app, and the parent's `message_agent` starts it — a
     * start that did not happen answered in the wake's own words, with its true reason (R1).
     * ⚑ **D-016** — the give's brief is the worker's first turn, and the follow-up names its piece.
     */
    it('🔴 message_agent to a stopped conversation — the wake’s own word, never the spawn’s', async () => {
      const pm = await aPmThatMaySpawn()
      const spawned = await spawnWorker(pm)
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      const worker = spawned.agent as string
      await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
      expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
      await host.close(worker, THE_APP_ITSELF)
      await waitFor(
        () =>
          ![...host.resumableSessions()].some(
            (row) => row.sessionId === worker && row.running !== 'not-running',
          ),
        'the worker to be over',
      )
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = shortOfDescriptors
      const wake = { agent: worker, text: 'carry on', kind: 'follow-up', piece: spawned.label }
      const failed = await callOn(pm, 'message_agent', wake)
      const kept = expectRecordedCannotRun(failed, 'message', shortageWords('EMFILE'), false)
      expect(kept.recipient.id).toBe(worker)
      expect(store.messagesWaitingIn(worker)).toContainEqual(
        expect.objectContaining({
          messageId: kept.recorded.id,
          text: wake.text,
        }),
      )
      homeFails = undefined
      expect(
        await callOn(pm, 'message_agent', { agent: kept.recipient.address, text: 'ready again' }),
      ).toMatchObject({
        outcome: 'ok',
        receipt: { recipient: { id: worker } },
      })
      await expectRecordedMessageDelivered(() => events(worker), kept.recorded.id, wake.text)
    })
  })
})
