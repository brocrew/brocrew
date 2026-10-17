import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import {
  AuthUnavailableError,
  ClaudeRuntime,
  CodexRuntime,
  FakeProviderSessions,
  createSpawnTransportFactory,
} from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { CodexUnavailableError } from '../src/main/runtime/codex-binary'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
} from '../../../packages/runtime/test/fixtures/a-spawn-that-failed'

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
const SHORTAGE = 'agent-could-not-start-just-now'

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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ A PM a person opened, which may start `worker` — an identity a person opened once, so it exists. */
  const aPmThatMaySpawn = async (): Promise<string> => {
    await host.close(await personOpens('worker'), window)
    return personOpens('pm')
  }

  /** ⚑ **D-016 · `give_work` is the door that starts a conversation now** — `worker` has none with the PM. */
  const spawnWorker = (pm: string): Promise<Record<string, unknown>> =>
    callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work',
    })

  const theRefusal = (payload: Record<string, unknown>): Record<string, unknown> => ({
    outcome: payload.outcome,
    rail: payload.rail,
    permanence: payload.permanence,
    retryable: payload.retryable,
    remedy: payload.remedy,
  })

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
    it('🔴 give_work answers the retryable word — while this holds, retryable, the same call again', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(theRefusal(refused)).toEqual({
        outcome: 'refused',
        rail: SHORTAGE,
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'make-the-same-call-when-this-settles',
      })
      // ⚑ the closed reason is the errno's own code — by TYPE, never by the provider's text
      expect(refused.detail).toEqual({ profile: 'worker', because: code })
      // ⛔ …and it never says a person must fix something — the word `agent-did-not-start` carries
      expect(String(refused.reason)).not.toContain('a person must fix')
      expect(String(refused.reason)).toContain('Make the same call again in a moment')
    })

    it('⚑ standing rule 3 — the same call, once the shortage has cleared, starts it', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      expect((await spawnWorker(pm)).rail).toBe(SHORTAGE)
      gate.startFails = undefined
      const started = await spawnWorker(pm)
      expect(started.outcome, JSON.stringify(started)).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the controls — a real *never* keeps the permanent word
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · a real never keeps its permanent word', () => {
    const PERMANENT = {
      outcome: 'refused',
      rail: 'agent-did-not-start',
      permanence: 'until-a-person-changes-it',
      retryable: false,
      remedy: null,
    }

    it('⚑ a sign-in the machine does not have', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      const refused = await spawnWorker(pm)
      expect(theRefusal(refused)).toEqual(PERMANENT)
      expect(refused.detail).toEqual({
        profile: 'worker',
        because: 'its-sign-in-is-unusable',
        provider: 'claude',
      })
    })

    // 🔴 **716 · R67 — one word for a missing program**: it was `agent-did-not-start` until `716`, and
    // is R51's `agent-could-not-be-started` now, as Claude's is (`what-a-person-must-fix-said-once`
    // §1) — so this arm is RED on `main` from `716` on, and no longer a control. ⚑ Still permanent and
    // still never the shortage word, which is what it was here for.
    it('🔴 a provider binary this build cannot run', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new CodexUnavailableError('Codex isn’t available in this build.')
      const refused = await spawnWorker(pm)
      expect(theRefusal(refused)).toEqual({ ...PERMANENT, rail: 'agent-could-not-be-started' })
      expect(refused.detail).toEqual({ profile: 'worker', because: 'provider-binary-unavailable' })
    })
  })

  /**
   * 🔴 **710 · R51 — these two were §2's controls, and they are RED on `main` now**: a code a person
   * has to fix is never the shortage word, and since `710` it is not a broken tool either — the tool
   * threw on `main`; R51 gives it a permanent word of its own (`a-spawn-a-person-must-fix.test.ts`,
   * which owns the rest). ⚑ Moved out of the controls by `710`'s review, so §2 holds only arms that
   * pass on `main`.
   */
  describe('§2c · 710 · R51 — a spawn errno a person must fix has its permanent word', () => {
    const CANNOT_RUN = 'agent-could-not-be-started'

    it('🔴 a spawn errno a PERSON has to fix is never the shortage word — it is R51’s permanent one', async () => {
      const produced = await claudeStartOver(() => {
        throw Object.assign(new Error('spawn /x/claude ENOTDIR'), {
          code: 'ENOTDIR',
          syscall: 'spawn /x/claude',
        })
      })
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(refused.rail).toBe(CANNOT_RUN)
      expect(refused.retryable).toBe(false)
    })

    it('🔴 …on Codex too, where the binary is not there after its pipes', async () => {
      const produced = await codexStartOver(
        () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/codex').child,
      )
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(refused.rail).toBe(CANNOT_RUN)
      expect(refused.retryable).toBe(false)
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
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('agent-could-not-be-started')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · standing rule 8.4 — what a PERSON sees at it
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§3 · what a person reads in the transcript', () => {
    const noticesOf = (sessionId: string): string[] => {
      const state = createTranscript()
      for (const event of events(sessionId)) applyEvent(state, event)
      return state.items
        .filter((item): item is NoticeItem => item.kind === 'notice')
        .map((item) => item.text)
    }

    it('🔴 the refusal row says it lasts only while the reason does, and that the same call may work', async () => {
      const produced = await SHORTAGES[3].make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      await spawnWorker(pm)
      const row = noticesOf(pm).find((text) => text.startsWith('refused: give_work'))
      expect(row).toBe(
        `refused: give_work · ${SHORTAGE} · only while the reason lasts · retrying may work · there is nothing to change — the same call again, once that has settled`,
      )
    })

    it('⚑ control: the permanent word’s row still says somebody has to change it', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      await spawnWorker(pm)
      const row = noticesOf(pm).find((text) => text.startsWith('refused: give_work'))
      expect(row).toBe(
        'refused: give_work · agent-did-not-start · until somebody changes it · retrying will not help',
      )
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
      const refused = await spawnWorker(pm)
      expect(theRefusal(refused)).toEqual({
        outcome: 'refused',
        rail: SHORTAGE,
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'make-the-same-call-when-this-settles',
      })
      expect(refused.detail).toEqual({ profile: 'worker', because: 'EMFILE' })
      homeFails = undefined
      expect((await spawnWorker(pm)).outcome).toBe('ok')
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
      const refused = await callOn(pm, 'message_agent', wake)
      expect(theRefusal(refused)).toEqual({
        outcome: 'refused',
        rail: 'that-conversation-could-not-be-woken-just-now',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'make-the-same-call-when-this-settles',
      })
      expect(refused.detail).toEqual({ agent: worker, because: 'EMFILE' })
      homeFails = undefined
      expect(await callOn(pm, 'message_agent', wake)).toMatchObject({
        outcome: 'ok',
        agent: worker,
      })
    })
  })
})
