import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ **The Keychain is NEVER read by this file** — standing rule 6: *"never read, copy or write a
 * credential: … a keychain entry."* ⚑ Every `security` call in the module graph lands HERE, and is
 * answered by the arm a test set: the launch's non-blocking `execFile` through its callback, as
 * Node answers, and the blocking `execFileSync` the library falls back to at once. ⚑ An unarmed
 * call throws AND is counted — the product swallows some throws as *"no login"*, so the count is
 * what makes a rig that forgot to arm it fail (`afterEach`) rather than pass on the wrong reading. ⚑ Codex's transport spawns through the same
 * module with no seam, so its ONE failing spawn is armed here too; every other spawn is real.
 */
const armed = vi.hoisted(() => ({
  spawn: null as null | (() => unknown),
  keychain: null as null | (() => string),
  keychainAsked: 0,
  /** ⚑ `security` calls nobody armed — must stay 0; `afterEach` says so. */
  unarmed: 0,
  /** ⚑ A read of THIS path fails; every other read is the real one. Always a temp path. */
  readFails: null as null | { readonly path: string; readonly error: () => Error },
}))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (...args: unknown[]): unknown => {
      const next = armed.spawn
      armed.spawn = null
      return next === null ? (real.spawn as (...given: unknown[]) => unknown)(...args) : next()
    },
    execFileSync: (file: unknown, ...rest: unknown[]): unknown => {
      if (file === 'security') {
        if (armed.keychain === null) {
          armed.unarmed++
          throw new Error('this test never reads the Keychain')
        }
        armed.keychainAsked++
        return armed.keychain()
      }
      return (real.execFileSync as (...given: unknown[]) => unknown)(file, ...rest)
    },
    execFile: (file: unknown, ...rest: unknown[]): unknown => {
      if (file === 'security') {
        if (armed.keychain === null) {
          armed.unarmed++
          throw new Error('this test never reads the Keychain')
        }
        armed.keychainAsked++
        const answer = rest.at(-1) as (error: unknown, stdout: string, stderr: string) => void
        const keychain = armed.keychain
        setImmediate(() => {
          let read: { stdout: string } | { error: unknown }
          try {
            read = { stdout: keychain() }
          } catch (error) {
            read = { error }
          }
          if ('error' in read) answer(read.error, '', '')
          else answer(null, read.stdout, '')
        })
        return {}
      }
      return (real.execFile as (...given: unknown[]) => unknown)(file, ...rest)
    },
  }
})
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    readFileSync: (path: unknown, ...rest: unknown[]): unknown => {
      const fails = armed.readFails
      if (fails !== null && path === fails.path) throw fails.error()
      return (real.readFileSync as (...given: unknown[]) => unknown)(path, ...rest)
    },
  }
})

import {
  AuthUnavailableError,
  ClaudeRuntime,
  CodexRuntime,
  FakeProviderSessions,
  createSpawnTransportFactory,
  probeCodexAuthInHome,
  provisionCodexAuth,
  reprovisionCodexAuth,
  ResumeError,
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
import { executeRuntimeCommand, withoutItsClassName } from '../src/main/runtime/ipc'
import { prepareProviderHome } from '../src/main/runtime/provider-homes'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { readableError } from '../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
} from '../../../packages/runtime/test/fixtures/a-spawn-that-failed'

/**
 * # 🔴 710 · R52 — a shortage at a person's own New Conversation is a person's sentence
 *
 * ⚑ **PM ruling R52** (`707` F-3), whole: *"When the machine runs short as a person starts a
 * conversation, they read a sentence that says what happened and what they can do (a
 * `SessionUnavailable` reason the launcher already draws). ⛔ Never the raw errno, never the SDK's
 * `TypeError`, never a conversation that looks started and never ran, and (standing rule 8.4) never
 * *"try again in a moment"*."*
 *
 * ⛔ **What a person read on `main` (`ed0b52b7`)**, in the launcher's *"The launch didn't start"*
 * box — `NewConversation.vue` draws the host's message verbatim, less Electron's wrapper
 * (`readableError`):
 *
 * | where the launch ran short | what they read |
 * |---|---|
 * | the provider's own spawn | *"spawn /…/claude EMFILE"* — or Codex's *"codex app-server failed to spawn: spawn … EMFILE"* |
 * | the provider home's lock | *"EMFILE: too many open files, open '…/claude.lock'"*, the home's path in it |
 * | the Keychain read, no process slot | *"Your machine Claude login is missing or its token has expired… then try again."* — a sign-in to fix, about a login that was fine |
 * | the Codex sign-in copy | *"personal Codex auth.json not found at …"* — a credential to fix, about a file that was there |
 *
 * ⚑ **The same shortage, four texts, depending on which call met it first** — and the last two are
 * FALSE. The fix is one sentence for all four: the reads that swallowed a shortage throw it
 * (`auth.ts`), and the launch turns whatever errno it meets into its own refusal, by the code.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * ⚑ Spelled here, so `main` (which has no such sentence) can run this file. ⚑ **Two**, because what
 * a person can do depends on what ran short (review of `710`): `EMFILE` is BroBot's OWN table of
 * open files, which closing another app does not touch; the machine's files, process slots and
 * memory are shared. ⚑ **D-017b · nothing in the window closes one conversation any more**, so the
 * gesture that frees BroBot's own files is a quit and a reopen, and a conversation is carried on by
 * the message sent to it.
 */
const THE_SENTENCE =
  'This conversation did not open: this machine ran short of open files, processes or memory as its agent was starting. Close an app you are not using, or quit and reopen BroCrew, then start it again.'
const FOR_EMFILE =
  'This conversation did not open: BroCrew had too many files open to start its agent. Quit and reopen BroCrew, then start it again.'
const FOR_A_REOPEN_EMFILE =
  'This conversation did not continue: BroCrew had too many files open to start its agent. Quit and reopen BroCrew, then send it your message again.'

/** What `security` looks like to `execFileSync` when no process slot is left — `spawnSync`'s errno. */
const aSecurityThatCouldNotStart = (): never => {
  throw Object.assign(new Error('spawnSync security EAGAIN'), {
    errno: -35,
    code: 'EAGAIN',
    syscall: 'spawnSync security',
    path: 'security',
    spawnargs: ['find-generic-password'],
  })
}

/** What `security` looks like when the login is simply not there — exit 44, and no errno at all. */
const aKeychainWithNoLogin = (): never => {
  throw Object.assign(new Error('Command failed: security find-generic-password'), { status: 44 })
}

/** ⚠️ `defaultKeychainReader` answers `null` off macOS before it asks, so a Keychain arm pins it. */
const realPlatform = process.platform
const theKeychainAnswers = (answer: () => string): void => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  armed.keychain = answer
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

describe('710 · R52 — a person whose machine ran short', () => {
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
  /** ⚑ …or the REAL one, over this test's own userData, with a temp Codex source. */
  let theRealHome = false
  /** ⚑ A model probe that fails the way this returns — the launcher's model field's door. */
  let probeFails: (() => Error) | undefined
  let codexSource: string
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-710-r52-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-710-r52-root-'))
    // ⛔ A temp file standing where a credential would — never `~/.codex/auth.json`.
    codexSource = join(root, 'not-a-credential-auth.json')
    writeFileSync(codexSource, '{"a":"test value, not a credential"}')
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_100_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    homeFails = undefined
    theRealHome = false
    probeFails = undefined
    armed.spawn = null
    armed.keychain = null
    armed.keychainAsked = 0
    armed.unarmed = 0
    armed.readFails = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const double = new ProviderDouble(provider, handles, issued, gate)
        const fails = probeFails
        if (fails !== undefined) double.listModels = () => Promise.reject(fails())
        return double
      },
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        if (homeFails !== undefined) throw homeFails()
        if (theRealHome) {
          return await prepareProviderHome(
            userData,
            { profileId: profileId ?? 'default', provider },
            // ⛔ the one seam that keeps a credential out: the copy reads a TEMP file
            {
              provisionCodexAuth: (home) =>
                provisionCodexAuth(home, { sourceAuthPath: codexSource }),
            },
          )
        }
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
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    // ⛔ a `security` call nobody armed is a rig that read nothing it meant to
    expect(armed.unarmed, 'a `security` call nobody armed').toBe(0)
    armed.spawn = null
    armed.keychain = null
    armed.readFails = null
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A person's New Conversation — the launcher's door, answered as the launcher reads it. */
  const aPersonStarts = async (provider: Provider = 'claude'): Promise<string> => {
    const refused = await executeRuntimeCommand(host, window, {
      kind: 'createSession',
      provider,
      cwd: root,
      approvalMode: 'auto',
      profileId: 'worker',
    }).then(
      () => null,
      (error: unknown) => error,
    )
    if (refused === null) return 'it started'
    // ⚑ What crosses the wire, and what the launcher then strips — `registerRuntimeIpc`'s own
    // `withoutItsClassName`, Electron's `${name}: ${message}`, and `readableError`.
    const crossed = withoutItsClassName(refused) as Error
    return readableError(
      new Error(
        `Error invoking remote method 'runtime:command': ${crossed.name}: ${crossed.message}`,
      ),
    )
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
    return produced as Error
  }

  /** ⚑ Codex: the real transport and start; a command that does not exist, in case it is unarmed. */
  const codexStartOver = async (child: () => unknown): Promise<Error> => {
    armed.spawn = child
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

  const noRawText = (said: string): void => {
    for (const leak of [
      'EMFILE',
      'EAGAIN',
      'ENOMEM',
      'spawn',
      '/x/',
      'TypeError',
      '.lock',
      'auth.json',
    ]) {
      expect(said, `the person read "${leak}"`).not.toContain(leak)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the provider's own spawn ran short
  // ───────────────────────────────────────────────────────────────────────────────

  const AT_THE_SPAWN = [
    {
      name: 'Claude, a spawn EMFILE',
      reads: FOR_EMFILE,
      make: () => claudeStartOver(() => aSpawnThatRanOutOf('EMFILE', '/x/claude').child),
    },
    {
      name: 'Claude, a spawn EAGAIN after its pipes',
      reads: THE_SENTENCE,
      make: () => claudeStartOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/claude').child),
    },
    {
      name: 'Codex, a spawn EMFILE',
      reads: FOR_EMFILE,
      make: () => codexStartOver(() => aSpawnThatRanOutOf('EMFILE', '/x/codex').child),
    },
    {
      name: 'Codex, a spawn EAGAIN after its pipes',
      reads: THE_SENTENCE,
      make: () => codexStartOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex').child),
    },
  ] as const

  describe.each(AT_THE_SPAWN)('§1 · $name', ({ make, reads }) => {
    it('🔴 the launcher reads what happened and what to do — never the errno', async () => {
      const produced = await make()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const said = await aPersonStarts()
      expect(said).toBe(reads)
      noRawText(said)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the launch ran short BEFORE its provider — the home, and the two sign-in reads
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · before the provider was asked', () => {
    it('🔴 the provider home’s lock — no descriptor left to open it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      homeFails = () =>
        Object.assign(
          new Error("EMFILE: too many open files, open '/x/provider-homes/claude.lock'"),
          {
            code: 'EMFILE',
            syscall: 'open',
            path: '/x/provider-homes/claude.lock',
          },
        )
      const said = await aPersonStarts()
      expect(said).toBe(FOR_EMFILE)
      noRawText(said)
    })

    it('🔴 the Keychain read with no process slot left is the shortage, not a login to fix', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      theRealHome = true
      theKeychainAnswers(aSecurityThatCouldNotStart)
      const said = await aPersonStarts('claude')
      // ⛔ Measured on `main`: *"Your machine Claude login is missing or its token has expired…"*
      expect(said).toBe(THE_SENTENCE)
      expect(said).not.toMatch(/login|sign/i)
      expect(armed.keychainAsked).toBeGreaterThan(0)
    })

    it('⚑ control: a Keychain with no login still says the login — that one IS a person’s to fix', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      theRealHome = true
      theKeychainAnswers(aKeychainWithNoLogin)
      const said = await aPersonStarts('claude')
      expect(said).toContain('Claude login is missing or its token has expired')
      expect(armed.keychainAsked).toBeGreaterThan(0)
    })

    it('🔴 the Codex sign-in copy with no descriptor left is the shortage, not a missing credential', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      theRealHome = true
      armed.readFails = {
        path: codexSource,
        error: () =>
          Object.assign(new Error(`EMFILE: too many open files, open '${codexSource}'`), {
            code: 'EMFILE',
            syscall: 'open',
            path: codexSource,
          }),
      }
      const said = await aPersonStarts('codex')
      // ⛔ Measured on `main`: *"personal Codex auth.json not found at <that path>"*
      expect(said).toBe(FOR_EMFILE)
      noRawText(said)
    })

    it('⚑ control: a Codex sign-in that is genuinely not there still says so', async () => {
      await expect(
        provisionCodexAuth(mkdtempSync(join(root, 'home-')), {
          sourceAuthPath: join(root, 'no-such-auth.json'),
        }),
      ).rejects.toBeInstanceOf(AuthUnavailableError)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · the other caller of this door keeps its own word
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **`give_work` launches through the same `createSession`** when the giver has no conversation
   * with that agent yet (D-016: it took `spawn_agent`'s place), and a model is told a WORD, not a
   * person's sentence: the errno rides along as the refusal's cause, so its classifier still reads
   * the code. ⚠️ Where the rule-3 pair diverges from R52: a sentence for a person, a word for a model.
   */
  describe('§3 · give_work, through the same door, still answers its retryable word', () => {
    const aPmThatMayGive = async (): Promise<string> => {
      await host.close(
        (
          await host.createSession(
            { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
            window,
          )
        ).sessionId,
        window,
      )
      const { sessionId: pm } = await host.createSession(
        { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
        window,
      )
      return pm
    }

    it('⚑ a give whose start ran short — the word, and its code as the closed reason', async () => {
      const produced = await AT_THE_SPAWN[0].make()
      const pm = await aPmThatMayGive()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      const refused = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'agent-could-not-start-just-now',
        retryable: true,
        detail: { profile: 'worker', because: 'EMFILE' },
      })
    })

    it('🔴 a Keychain read with no process slot left is the retryable word, not a sign-in', async () => {
      const pm = await aPmThatMayGive()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      theRealHome = true
      theKeychainAnswers(aSecurityThatCouldNotStart)
      const refused = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })
      // ⛔ Measured on `main`: `agent-did-not-start` · `provider-sign-in-or-config-unusable`
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'agent-could-not-start-just-now',
        detail: { profile: 'worker', because: 'EAGAIN' },
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §4 · what a person sees at it, and the controls
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§4 · standing rule 8.4, and what is NOT a shortage', () => {
    it('🔴 the sentence is the reason’s, and it says what happened and what a person can do', () => {
      expect(describeUnavailable('machine-ran-short')).toBe(THE_SENTENCE)
      expect(describeUnavailable('machine-ran-short', { shortage: 'EAGAIN' })).toBe(THE_SENTENCE)
      expect(describeUnavailable('machine-ran-short', { shortage: 'EMFILE' })).toBe(FOR_EMFILE)
      expect(THE_SENTENCE).toContain('ran short of open files, processes or memory')
      expect(THE_SENTENCE).toContain('Close an app you are not using, or quit and reopen BroCrew')
      // ⚑ `EMFILE` is BroBot's own table: another app closing frees none of it (review of `710`)
      expect(FOR_EMFILE).not.toContain('Close an app')
      expect(FOR_EMFILE).toContain('Quit and reopen BroCrew')
      // ⚑ **D-017b** — no sentence sends a person to close a conversation: there is no such press.
      for (const said of [THE_SENTENCE, FOR_EMFILE, FOR_A_REOPEN_EMFILE]) {
        expect(said).not.toMatch(/close a conversation|or a conversation you are not using/i)
      }
      // ⛔ standing rule 8.4: a person told to wait would wait at a row they cannot clear
      for (const said of [THE_SENTENCE, FOR_EMFILE, FOR_A_REOPEN_EMFILE]) {
        expect(said).not.toMatch(/in a moment|try again/i)
      }
    })

    it('🔴 nothing looks started — no row, and the same start works once it has cleared', async () => {
      const produced = await AT_THE_SPAWN[0].make()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.startFails = () => produced
      expect(await aPersonStarts()).toBe(FOR_EMFILE)
      // ⚑ `recordedOne` reads a row whether or not it has a provider ref — `find` hides a ref-less
      // row, which is exactly the one a start that looked started and never ran would leave.
      expect(store.recordedOne('sess_1')).toBeNull()
      gate.startFails = undefined
      expect(await aPersonStarts()).toBe('it started')
    })

    it('⚑ control: a sign-in the machine does not have keeps its own words', async () => {
      gate.startFails = () => new AuthUnavailableError('claude', 'signed out')
      expect(await aPersonStarts()).toBe('signed out')
    })

    it('⚑ control: a failure that is not a shortage passes through as it came', async () => {
      gate.startFails = () => new Error('the disk said no')
      expect(await aPersonStarts()).toBe('the disk said no')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §5 · the same shortage at the other doors a person reads — review of `710`
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **Found by `710`'s review, and one of them `710` made worse**: the Keychain read now THROWS a
   * shortage (§2), and two person doors passed a throw through bare — a Reopen, and the launcher's
   * model field — so a person read *"spawnSync security EAGAIN"* where `main` had shown a (false)
   * login sentence. ⚑ And the Reopen already showed a spawn's errno bare on `main` (*"resume setup
   * failed: spawn … EMFILE"*); the sign-in check the launcher ran after every failed start showed
   * Codex's, with the binary's path. Each now says the shortage. ⚑ **725 · `716` F-1**: the launcher
   * no longer runs that check after a start main refused as `machine` — the refusal already said it
   * (`NewConversation.theCheckCanSayMore`); it still runs after an unworded failure, and on a press.
   */
  describe('§5 · a Reopen, the model field and the sign-in check say it too', () => {
    const claudeResumeOver = async (child: () => unknown): Promise<Error> => {
      const produced = await new ClaudeRuntime(
        undefined,
        async () => true,
        undefined,
        undefined,
        () => child() as never,
      )
        .resume(
          { provider: 'claude', sessionId: 'sess_710', cwd: root, rotation: 0 },
          { providerHome: join(root, 'claude-home-710') },
        )
        .catch((thrown: unknown) => thrown)
      expect(produced).toBeInstanceOf(ResumeError)
      return produced as Error
    }

    const aPersonReopens = async (sessionId: string): Promise<string> => {
      const refused = await executeRuntimeCommand(host, window, { kind: 'resume', sessionId }).then(
        () => null,
        (error: unknown) => error,
      )
      if (refused === null) return 'it reopened'
      const crossed = withoutItsClassName(refused) as Error
      return readableError(
        new Error(
          `Error invoking remote method 'runtime:command': ${crossed.name}: ${crossed.message}`,
        ),
      )
    }

    const aClosedConversation = async (): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.close(sessionId, window)
      return sessionId
    }

    it('🔴 a person’s Reopen, its agent’s spawn out of descriptors — the reopen’s own sentence', async () => {
      const closed = await aClosedConversation()
      const produced = await claudeResumeOver(() => aSpawnThatRanOutOf('EMFILE', '/x/claude').child)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.resumeFails = () => produced
      const said = await aPersonReopens(closed)
      // ⛔ Measured on `main`: *"resume setup failed: spawn /x/claude EMFILE"*
      expect(said).toBe(FOR_A_REOPEN_EMFILE)
      noRawText(said)
    })

    it('⚑ control: a Reopen the provider refused for another reason keeps its own words', async () => {
      const closed = await aClosedConversation()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      gate.resumeFails = () => new Error('the provider said no')
      expect(await aPersonReopens(closed)).toBe('the provider said no')
    })

    it('🔴 the model field, a Keychain read with no process slot left — said, never the errno', async () => {
      await aClosedConversation()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      theRealHome = true
      theKeychainAnswers(aSecurityThatCouldNotStart)
      const said = await host.providerModels('worker', 'claude')
      // ⛔ On `main`: the login sentence, about a login that was fine; on `710`'s first cut: the errno
      expect(said).toEqual({
        ok: false,
        reason: 'refused',
        detail: 'this machine ran short of open files, processes or memory',
      })
    })

    it('🔴 the model field, the probe’s own spawn out of descriptors — said, never the errno', async () => {
      await aClosedConversation()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      probeFails = () =>
        Object.assign(new Error('spawn /x/claude EMFILE'), {
          code: 'EMFILE',
          syscall: 'spawn /x/claude',
        })
      // ⚑ `EMFILE` is BroBot's own table — the refusal's sentence says so, and so does this clause
      // (second review): one shortage, one attribution, on one screen.
      expect(await host.providerModels('worker', 'claude')).toEqual({
        ok: false,
        reason: 'refused',
        detail: 'BroCrew had too many files open',
      })
    })

    it('⚑ control: a probe the provider refused for another reason keeps the provider’s words', async () => {
      await aClosedConversation()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      probeFails = () => new Error('the provider said no')
      expect(await host.providerModels('worker', 'claude')).toEqual({
        ok: false,
        reason: 'refused',
        detail: 'the provider said no',
      })
    })

    it('🔴 the Codex sign-in check after a failed start — the shortage, never the errno or the binary’s path', async () => {
      const home = mkdtempSync(join(root, 'codex-check-'))
      armed.spawn = () => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex').child
      const state = await probeCodexAuthInHome(
        createSpawnTransportFactory('/nonexistent/brobot2-710/codex'),
        home,
        home,
      )
      expect(state.state).toBe('unknown')
      const reason = state.state === 'unknown' ? state.reason : ''
      // ⛔ On `main`: *"could not start Codex …: codex app-server failed to spawn: spawn /x/codex EAGAIN"*
      expect(reason).toBe(
        'This machine ran short of open files, processes or memory, so Codex could not be started to ask about this profile’s sign-in.',
      )
      expect(reason).not.toMatch(/EAGAIN|spawn \/|\/x\//)
    })

    it('🔴 …and out of BroBot’s own descriptors, it says whose table ran short', async () => {
      const home = mkdtempSync(join(root, 'codex-check-'))
      armed.spawn = () => aSpawnThatRanOutOf('EMFILE', '/x/codex').child
      const state = await probeCodexAuthInHome(
        createSpawnTransportFactory('/nonexistent/brobot2-710/codex'),
        home,
        home,
      )
      const reason = state.state === 'unknown' ? state.reason : ''
      expect(reason).toBe(
        'BroCrew had too many files open to start Codex and ask about this profile’s sign-in.',
      )
    })

    it('⚑ control: a Codex that could not be started for another reason keeps saying why', async () => {
      const home = mkdtempSync(join(root, 'codex-check-'))
      armed.spawn = () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/codex').child
      const state = await probeCodexAuthInHome(
        createSpawnTransportFactory('/nonexistent/brobot2-710/codex'),
        home,
        home,
      )
      const reason = state.state === 'unknown' ? state.reason : ''
      expect(reason).toContain('could not start Codex to ask about this profile')
      expect(reason).toContain('ENOENT')
    })
  })
})

/**
 * # 🔴 716 · `710` F-4 — *Copy my machine sign-in*, under a shortage
 *
 * ⛔ **What a person read until `716`**: the source read's catch-all — *"personal Codex auth.json not
 * found at … — sign in with the codex CLI first, then try again"*, a sign-in to redo, about a file
 * that was there — or, from the lock and the temp file, which never had a catch, Node's errno whole,
 * with a path (`716`'s map). ⚑ The read rethrows a shortage now, as the launch's copy has since
 * `710`, and `RuntimeHost.reprovisionProviderAuth` says it once, by the code, for every place the
 * copy can meet it. ⛔ The source is always a temp file — never `~/.codex/auth.json`.
 */
describe('716 · `710` F-4 — a re-copy the machine ran short for', () => {
  let userData: string
  let db: AppDatabase
  let recopyFails: (() => Error) | null

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-f4-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    recopyFails = null
    armed.readFails = null
  })
  afterEach(() => {
    armed.readFails = null
    vi.restoreAllMocks()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** A host whose re-copy fails the way `recopyFails` says — the door, over a fake credential op. */
  const aHostWhoseRecopy = (): RuntimeHost =>
    new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => {
        throw new Error('no launch in this section')
      },
      prepareProviderHome: () => join(userData, 'home'),
      providerHomePath: () => join(userData, 'home'),
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_f4',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
      providerAuth: {
        credentialHome: (provider, profileId) => join(userData, 'homes', profileId, provider),
        check: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
        reprovision: async () => {
          if (recopyFails !== null) throw recopyFails()
          return 'replaced' as const
        },
        signIn: async () => {
          throw new Error('no sign-in in this section')
        },
        bringTheKeyToItsHomes: async () => null,
        replaceARefusedCopy: async () => 'not-tried',
      },
    })

  it('🔴 the source read RETHROWS a shortage — not *"auth.json not found … sign in"*', async () => {
    const source = join(userData, 'not-a-credential-auth.json')
    writeFileSync(source, '{"a":"test value, not a credential"}')
    const home = join(userData, 'profile-home')
    mkdirSync(home, { recursive: true })
    armed.readFails = {
      path: source,
      error: () => Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' }),
    }
    const thrown = await reprovisionCodexAuth(home, { sourceAuthPath: source }).catch(
      (error: unknown) => error,
    )
    expect(thrown).not.toBeInstanceOf(AuthUnavailableError)
    expect((thrown as { code?: unknown }).code).toBe('EMFILE')
  })

  it('⚑ control — a source that is not there is still *"not found"*, with the way to fix it', async () => {
    const home = join(userData, 'profile-home')
    mkdirSync(home, { recursive: true })
    await expect(
      reprovisionCodexAuth(home, { sourceAuthPath: join(userData, 'absent-auth.json') }),
    ).rejects.toThrow(/auth\.json not found at .* — sign in with the codex CLI first/)
  })

  it.each([
    [
      'EMFILE',
      'Your machine sign-in was not copied: BroCrew had too many files open. Quit and reopen BroCrew, then copy it again.',
    ],
    [
      'ENFILE',
      'Your machine sign-in was not copied: this machine ran short of open files, processes or memory. Close an app you are not using, or quit and reopen BroCrew, then copy it again.',
    ],
  ])('🔴 the door says a %s in a person’s words — whichever step met it', async (code, said) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    recopyFails = () =>
      Object.assign(new Error(`${code}: open '/x/codex.lock'`), { code, syscall: 'open' })
    const host = aHostWhoseRecopy()
    const failure = await host.reprovisionProviderAuth('codex', 'work').catch((e: Error) => e)
    expect((failure as Error).message).toBe(said)
    expect(((failure as Error).cause as { code?: unknown }).code).toBe(code)
    await host.closeAll()
  })

  it('⚑ control — anything else reaches the window as its own words', async () => {
    recopyFails = () => new Error('providerHome is a symlink: /x')
    const host = aHostWhoseRecopy()
    await expect(host.reprovisionProviderAuth('codex', 'work')).rejects.toThrow(
      'providerHome is a symlink: /x',
    )
    expect(await host.reprovisionProviderAuth('codex', 'work').catch(() => 'refused')).toBe(
      'refused',
    )
    recopyFails = null
    expect(await host.reprovisionProviderAuth('codex', 'work')).toBe('replaced')
    await host.closeAll()
  })
})
