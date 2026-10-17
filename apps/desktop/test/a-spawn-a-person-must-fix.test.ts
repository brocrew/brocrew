import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚑ **Codex's transport spawns through `node:child_process` with no seam**, so the ONE spawn a test
 * wants to fail is armed here; every other spawn in the module graph reaches the real function —
 * §0's measurement among them.
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
  spawnNoWaitClearsOf,
  transientSetupFailureOf,
} from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import { aSpawnRefusedAfterItsPipes } from '../../../packages/runtime/test/fixtures/a-spawn-that-failed'

/**
 * # 🔴 710 · R51 — a spawn a person must fix has a permanent word of its own
 *
 * ⚑ **PM ruling R51** (`707` F-2), whole: *"A Claude spawn whose binary is missing (`ENOENT` after
 * its pipes), or any spawn errno that no wait can clear, is refused with a permanent, non-retryable
 * word that says what is wrong in words. It is never a broken tool, never `ok`, and never borrows the
 * retryable shortage word. It mirrors the wake's permanent `that-conversation-could-not-be-resumed`."*
 *
 * ⛔ **What `spawn_agent` answered on `main` (`ed0b52b7`)**: nothing — the tool THREW, which both
 * adapters turn into *"spawn_agent failed: spawn /…/claude ENOENT"*, `isError`, the host's path in
 * it (`aLaunchThatDidNotStart` returned `null` for every code a person has to fix, and
 * `launchedOrSaid` rethrew it). ⚑ **The errors below are the ADAPTERS' OWN**, made by the real
 * `ClaudeRuntime` over the SDK's real `query()` and the real `CodexRuntime` over its real transport,
 * each handed a spawn that failed in the shape Node gives it — the pipes-made shape measured in
 * `705` (`the-errno-a-resume-carries.test.ts` §0), the thrown-at-once shape measured in §0 here.
 *
 * ⚑ **D-016 · `spawn_agent` is gone, and `give_work` is the door that starts a conversation**: the
 * same launch classifier answers it, so every section below asks a give the PM has no conversation
 * with `worker` for.
 *
 * ⚑ **The mirror is the wake's own, and it already holds**: a resume whose binary is gone answers
 * `that-conversation-could-not-be-resumed` (`a-shortage-that-clears-by-itself.test.ts` §2b), because
 * both adapters wrap a resume's spawn errno in a `ResumeError` — so the launch's new word never
 * reaches a wake.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ The new word — spelled here as a string, so `main` (which has no such word) can run this file. */
const CANNOT_RUN = 'agent-could-not-be-started'
const SHORTAGE = 'agent-could-not-start-just-now'

/** The shape Node throws AT ONCE for a spawn it will not defer — `new ErrnoException(err, 'spawn')`. */
const thrownAtOnce = (code: string): Error =>
  Object.assign(new Error(`spawn ${code}`), { code, syscall: 'spawn' })

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

describe('710 · R51 — a spawn a person must fix', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  /** ⚑ The HOST's own step failing — `prepareProviderHome`, which every launch runs first. */
  let homeFails: (() => Error) | undefined
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-710-r51-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-710-r51-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_100_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    homeFails = undefined
    armed.next = null
    host = new RuntimeHost({
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    armed.next = null
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

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

  /** ⚑ Claude: the SDK's real `query()`, on the adapter's own spawn seam. */
  const claudeStartOver = async (child: () => unknown): Promise<Error> => {
    const produced = await new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      () => child() as never,
    )
      .start({ cwd: root, providerHome: join(root, 'claude-home-710'), approvalMode: 'auto' })
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
      createSpawnTransportFactory('/nonexistent/brobot2-710/codex'),
    )
      .start({ cwd: root, providerHome: join(root, 'codex-home-710'), approvalMode: 'auto' })
      .then(
        () => new Error('codex start RESOLVED a handle'),
        (thrown: unknown) => thrown,
      )
    expect(produced).toBeInstanceOf(Error)
    return produced as Error
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // §0 · the shape Node gives a spawn it refuses at once — measured, not assumed
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§0 · what Node stamps on a spawn it refuses', () => {
    /**
     * ⚑ **The reader's `syscall` rule rests on this**: a spawn Node refuses AT ONCE is thrown with
     * `syscall: 'spawn'`, one it defers carries `'spawn <file>'` (`705` §0) — both begin `spawn`.
     * ⚑ A path through a regular FILE is `ENOTDIR` — the packaged app's binary left inside
     * `app.asar`, `claude-child.ts`' own note — and nothing runs: there is no program to start.
     */
    it('⚑ a program under a regular file is ENOTDIR, thrown at once, and its syscall is a spawn', () => {
      const aFile = join(root, 'app.asar')
      writeFileSync(aFile, 'not a directory')
      let thrown: unknown = null
      try {
        const child = spawn(join(aFile, 'claude'), [], { stdio: 'ignore' })
        child.on('error', () => {})
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown).toMatchObject({ code: 'ENOTDIR', syscall: 'spawn' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the word, and what it says
  // ───────────────────────────────────────────────────────────────────────────────

  const CANNOT_RUNS = [
    {
      name: 'Claude, the binary not there after its pipes',
      code: 'ENOENT',
      make: () => claudeStartOver(() => aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude').child),
    },
    {
      name: 'Claude, a binary it may not run, after its pipes',
      code: 'EACCES',
      make: () => claudeStartOver(() => aSpawnRefusedAfterItsPipes('EACCES', '/x/claude').child),
    },
    {
      name: 'Claude, the packaged binary left inside app.asar — ENOTDIR, thrown at once',
      code: 'ENOTDIR',
      make: () =>
        claudeStartOver(() => {
          throw thrownAtOnce('ENOTDIR')
        }),
    },
    {
      name: 'Claude, a file that is not a program — ENOEXEC, thrown at once',
      code: 'ENOEXEC',
      make: () =>
        claudeStartOver(() => {
          throw thrownAtOnce('ENOEXEC')
        }),
    },
    {
      name: 'Codex, the binary not there after its pipes',
      code: 'ENOENT',
      make: () => codexStartOver(() => aSpawnRefusedAfterItsPipes('ENOENT', '/x/codex').child),
    },
    {
      name: 'Codex, a binary it may not run, after its pipes',
      code: 'EACCES',
      make: () => codexStartOver(() => aSpawnRefusedAfterItsPipes('EACCES', '/x/codex').child),
    },
    {
      name: 'Codex, EPERM thrown at once',
      code: 'EPERM',
      make: () =>
        codexStartOver(() => {
          throw thrownAtOnce('EPERM')
        }),
    },
  ] as const

  describe.each(CANNOT_RUNS)('§1 · $name', ({ code, make }) => {
    it('🔴 give_work answers the permanent word — never a broken tool, never ok', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await spawnWorker(pm)
      expect(theRefusal(refused)).toEqual({
        outcome: 'refused',
        rail: CANNOT_RUN,
        permanence: 'until-a-person-changes-it',
        retryable: false,
        remedy: null,
      })
      // ⚑ the closed reason is the errno's own code — by TYPE, never the provider's text or path
      expect(refused.detail).toEqual({ profile: 'worker', because: code })
      expect(JSON.stringify(refused)).not.toContain('/x/')
    })

    it('🔴 it says what is wrong in words, and that waiting will not help', async () => {
      const produced = await make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const said = String((await spawnWorker(pm)).reason)
      expect(said).toContain('Starting it again will not help until a person has looked')
      expect(said).toContain('this machine could not run its provider’s program')
      // ⛔ never the shortage word's promise
      expect(said).not.toMatch(/in a moment|usually clears/)
    })
  })

  /**
   * 🔴 **Moved out of §2's controls by `710`'s second review**: on `main` its first call threw, so
   * it is R51's — the same call, once a person has put the program back, starts it.
   */
  describe('§1b · standing rule 3', () => {
    it('🔴 standing rule 3 — the same call, once a person has put the program back, starts it', async () => {
      const produced = await CANNOT_RUNS[0].make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      expect((await spawnWorker(pm)).rail).toBe(CANNOT_RUN)
      gate.startFails = undefined
      const started = await spawnWorker(pm)
      expect(started.outcome, JSON.stringify(started)).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the controls — where the two readings diverge
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · the controls', () => {
    // ⚑ **Only the word** (review of `710`): the arm order alone would hide a permanent reader that
    // answered a shortage too, so *"the two readers never both answer"* is §3's bound, not this arm's.
    it('⚑ a shortage keeps the retryable word', async () => {
      const produced = await claudeStartOver(() => {
        throw Object.assign(new Error('spawn /x/claude ENOMEM'), {
          code: 'ENOMEM',
          syscall: 'spawn /x/claude',
        })
      })
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      expect((await spawnWorker(pm)).rail).toBe(SHORTAGE)
    })

    // 🔴 since `716` (R66) — RED on `main` from then on, so no longer a control.
    it('🔴 a person’s code the HOST met, not a spawn’s, is not called a program that could not run', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = () =>
        Object.assign(new Error('EACCES: permission denied, mkdir'), {
          code: 'EACCES',
          syscall: 'mkdir',
        })
      // 🔴 **716 · R66 — it was a broken tool until `716`** (`710` F-1): now R51's permanent word too,
      // and ⚑ this arm's own claim still holds — its sentence is a FOLDER's, never the program's
      // (`what-a-person-must-fix-said-once.test.ts` §1 owns the rest).
      const refused = await spawnWorker(pm)
      expect(refused.rail).toBe(CANNOT_RUN)
      expect(String(refused.reason)).toContain('folder')
      expect(String(refused.reason)).not.toContain('program')
    })

    it('⚑ a sign-in the machine does not have keeps `agent-did-not-start`', async () => {
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      expect((await spawnWorker(pm)).rail).toBe('agent-did-not-start')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · the reader, over the shapes it is handed
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§3 · `spawnNoWaitClearsOf` — the nearest code decides, and only a spawn answers', () => {
    const errno = (code: string, syscall: string): Error =>
      Object.assign(new Error(`${syscall} ${code}`), { code, syscall })

    // ⛔ **§3 is the reader's own, and ⛔ rather than 🔴** (review of `710`): the reader is new in
    // `710`, so on `main` these cannot run at all — their only RED there is the missing export. R51's
    // behavioural RED is §1 and §4.
    it('⛔ the shape §0 measured is read as its code', () => {
      const aFile = join(root, 'app.asar')
      writeFileSync(aFile, 'not a directory')
      let thrown: unknown = null
      try {
        spawn(join(aFile, 'claude'), [], { stdio: 'ignore' }).on('error', () => {})
      } catch (error) {
        thrown = error
      }
      expect(spawnNoWaitClearsOf(thrown)).toBe('ENOTDIR')
    })

    it('⛔ a spawn’s person code answers its code — deferred, thrown at once, or synchronous', () => {
      expect(spawnNoWaitClearsOf(errno('ENOENT', 'spawn /x/claude'))).toBe('ENOENT')
      expect(spawnNoWaitClearsOf(errno('ENOTDIR', 'spawn'))).toBe('ENOTDIR')
      expect(spawnNoWaitClearsOf(errno('ENOENT', 'spawnSync /x/claude'))).toBe('ENOENT')
      // ⚑ …through a wrapper that carries it as its cause — Codex's transport refusal
      const wrapped = new Error('codex app-server failed to spawn', {
        cause: errno('EACCES', 'spawn /x/codex'),
      })
      expect(spawnNoWaitClearsOf(wrapped)).toBe('EACCES')
    })

    it('⛔ bounds: a shortage, a host’s own errno, a code-less error, and a nearer non-spawn code', () => {
      expect(spawnNoWaitClearsOf(errno('EMFILE', 'spawn /x/claude'))).toBeNull()
      expect(transientSetupFailureOf(errno('EMFILE', 'spawn /x/claude'))).toBe('EMFILE')
      expect(spawnNoWaitClearsOf(errno('EACCES', 'mkdir'))).toBeNull()
      expect(
        spawnNoWaitClearsOf(new Error('Native CLI binary for darwin-arm64 not found')),
      ).toBeNull()
      // ⚠️ the NEAREST code decides: a host `open` wrapping a spawn's is the host's
      const nearer = Object.assign(new Error('open', { cause: errno('ENOENT', 'spawn /x') }), {
        code: 'EACCES',
        syscall: 'open',
      })
      expect(spawnNoWaitClearsOf(nearer)).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §4 · standing rule 8.4 — what a PERSON sees at it
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§4 · what a person reads in the transcript', () => {
    const noticesOf = (sessionId: string): string[] => {
      const state = createTranscript()
      for (const event of events(sessionId)) applyEvent(state, event)
      return state.items
        .filter((item): item is NoticeItem => item.kind === 'notice')
        .map((item) => item.text)
    }

    /**
     * ⚑ **What a person sees at this limit**: a row that says somebody has to change something, and
     * the model's own account of it — and a row a person CAN clear, by putting the program back
     * (§2's standing-rule-3 arm). ⛔ On `main` the row said the tool broke.
     */
    it('🔴 the refusal row says somebody has to change it, and that retrying will not help', async () => {
      const produced = await CANNOT_RUNS[4].make()
      const pm = await aPmThatMaySpawn()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      await spawnWorker(pm)
      const row = noticesOf(pm).find((text) => text.startsWith('refused: give_work'))
      expect(row).toBe(
        `refused: give_work · ${CANNOT_RUN} · until somebody changes it · retrying will not help`,
      )
    })
  })
})
