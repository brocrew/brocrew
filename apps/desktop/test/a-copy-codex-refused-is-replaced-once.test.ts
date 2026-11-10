import type { RuntimeHostDeps } from '../src/main/runtime/host-dependencies'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { UserTurnEvent } from '../src/shared/human-answer-contracts'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  withProviderHomeLock,
  FakeRuntime,
  type FakeSessionHandle,
  type ResumeOptions,
  type RuntimeEvent,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import { CodexRefusedItsSignInError, codexCopyIdentityIn } from '@brobot2/runtime/codex'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  DEFAULT_PROFILE_ID,
  createProviderAuthOps,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import type { CodexSignIn } from '../src/main/providers/codex/types'
import { ITS_OWNER_RUNNING_AGAIN_DRIVES_IT, derivePieces } from '../src/shared/tasks'
import {
  applyEvent,
  createTranscript,
  REOPENED_ON_A_RENEWED_SIGN_IN,
} from '../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { neutralHostDeps } from './lib/host-fixture'

// Fictional sign-ins are compared by digest so failures never print their contents.

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

type CopiedSignIn = ReturnType<typeof codexCopyIdentityIn>

const digestOf = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const signInAt = (path: string): string => digestOf(readFileSync(path))

const signIn = (account: string, token: string, refreshed: string): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: account, access_token: token, refresh_token: `refresh-${token}` },
    last_refresh: refreshed,
  })
const DEAD = signIn('acct-fictional-a', 'DEAD', '2026-10-08T22:00:00Z')
const THE_COMPUTERS = signIn('acct-fictional-a', 'COMPUTER', '2026-10-09T02:35:11Z')
const BROBOTS_OWN = signIn('acct-fictional-a', 'BROBOT', '2026-10-09T02:54:01Z')
const BROBOTS_OWN_BEFORE = signIn('acct-fictional-a', 'BROBOT-BEFORE', '2026-10-07T09:00:00Z')
const ANOTHER_ACCOUNT = signIn('acct-fictional-b', 'OTHER', '2026-10-08T22:00:00Z')

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'owner:1'
  readonly alive = true
  readonly errors: TranscriptEvent[] = []
  working = 0
  send(message: RuntimeEventMessage): void {
    if (message.event.type === 'error') this.errors.push(message.event)
    if (message.event.type === 'status' && message.event.state === 'working') this.working += 1
  }
  sendLiveness(): void {}
}

const says = (handle: FakeSessionHandle, error: RuntimeEvent): void =>
  (handle as unknown as { push(event: RuntimeEvent): void }).push(error)
const REFUSED = { type: 'error', message: 'refused', fatal: false, cause: 'auth' } as const

class StandInCodex extends FakeRuntime {
  readonly handles: FakeSessionHandle[] = []
  constructor(
    private readonly accepts: () => ReadonlySet<string>,
    private readonly starts: string[],
  ) {
    super('codex')
  }
  failsOtherwise = false
  refusesBeforeCodexIsAsked = false
  asItRefuses: () => void = () => {}
  checksItsSignIn: () => Promise<boolean> = async () => false
  readonly turnModes: TurnMode[] = []
  readonly sent: string[] = []
  /** The thread retains its input across a reopen; carrying on adds no message to it. */
  private readonly retained = new Map<string, string>()
  readonly answeredInputs: string[] = []
  carriedOn = 0
  asItCarriesOn: () => void = () => {}
  carryOnIsHeldOpen = false
  carryOnIsRefusedAtOnce = false
  aStopMeetsTheRefusal = false
  cannotCarryOn = false
  asItStarts: () => void = () => {}
  asItResumes: (handle: FakeSessionHandle) => void = () => {}
  private openTurn: { refuse: (loginRefused?: boolean) => void; answer: () => void } | null = null
  refuseTheOpenTurn(loginRefused = true): void {
    const end = this.openTurn
    this.openTurn = null
    end?.refuse(loginRefused)
  }
  answerTheOpenTurn(): void {
    const end = this.openTurn
    this.openTurn = null
    end?.answer()
  }
  private taken(providerHome: string): CopiedSignIn {
    const beganOn = codexCopyIdentityIn(providerHome)
    const held = signInAt(join(providerHome, 'auth.json'))
    this.starts.push(held)
    if (this.failsOtherwise) throw new Error('the program did not start')
    if (this.refusesBeforeCodexIsAsked) {
      throw new AuthUnavailableError('codex', 'Codex auth.json has insecure permissions.')
    }
    if (!this.accepts().has(held)) {
      this.asItRefuses()
      throw new CodexRefusedItsSignInError('Your Codex sign-in has expired.', beganOn)
    }
    this.asItStarts()
    return beganOn
  }
  private kept(handle: FakeSessionHandle, beganOn: CopiedSignIn): FakeSessionHandle {
    const inside = handle as unknown as {
      machine: {
        beginTurn(): number | null
        completeTurn(
          state: 'completed' | 'failed',
          why?: string,
          a?: undefined,
          b?: undefined,
          c?: object,
        ): void
      }
      push(event: RuntimeEvent): void
    }
    const refused = (loginRefused = true): void =>
      inside.machine.completeTurn('failed', 'simulated refusal', undefined, undefined, {
        ...(loginRefused ? { loginRefused: true } : {}),
      })
    const answered = (): void => {
      this.answeredInputs.push(this.retained.get(handle.ref.sessionId) ?? '')
      inside.push({ type: 'assistant_message', text: 'answered' })
      inside.machine.completeTurn('completed')
    }
    const stop = handle.interrupt.bind(handle)
    Object.assign(handle, {
      interrupt: async () => {
        if (this.aStopMeetsTheRefusal && this.openTurn !== null) this.refuseTheOpenTurn()
        else await stop()
      },
      checkSignIn: () => this.checksItsSignIn(),
      signInCopyAtLaunch: () => beganOn,
      // A turn of words, as the test says it goes: refused on its sign-in before doing anything,
      // refused after a word of a reply, left open to be refused later, or answered. ⚑ As Codex's
      // adapter does, the turn begins as it is handed over and goes on after the call returns.
      send: async (text: string) => {
        this.sent.push(text)
        this.retained.set(handle.ref.sessionId, text)
        const mode = this.turnModes.shift() ?? 'answered'
        inside.machine.beginTurn()
        if (mode === 'held-open') {
          this.openTurn = { refuse: refused, answer: answered }
          return
        }
        setTimeout(() => {
          if (mode === 'stopped-on-a-limit') {
            inside.machine.completeTurn('failed', 'usage limit', undefined, undefined, {
              limit: { provider: 'codex', resetsAt: Date.now() + 3_600_000 },
            })
          } else if (mode === 'refused') refused()
          else if (mode === 'refused-after-a-word') {
            inside.push({ type: 'assistant_delta', text: 'Let me' })
            refused()
          } else answered()
        }, 0)
      },
      ...(this.cannotCarryOn
        ? {}
        : {
            carryOn: async () => {
              this.carriedOn += 1
              this.asItCarriesOn()
              inside.machine.beginTurn()
              if (this.carryOnIsRefusedAtOnce) refused()
              else if (this.carryOnIsHeldOpen) this.openTurn = { refuse: refused, answer: answered }
              else setTimeout(answered, 0)
            },
          }),
    })
    this.handles.push(handle)
    return handle
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const beganOn = this.taken(options.providerHome)
    return this.kept(await super.start(options), beganOn)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const beganOn = this.taken(options.providerHome)
    const handle = this.kept(await super.resume(ref, options), beganOn)
    this.asItResumes(handle)
    return handle
  }
}

type TurnMode = 'refused' | 'refused-after-a-word' | 'held-open' | 'stopped-on-a-limit' | 'answered'

class AClaude extends FakeRuntime {
  constructor(private readonly kept: FakeSessionHandle[]) {
    super('claude')
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.kept.push(handle)
    return handle
  }
}

describe('a copy of a Codex sign-in that Codex refused is replaced once, by the one refreshed last', () => {
  let userData: string
  let machine: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let codex: StandInCodex
  let accepted: Set<string>
  let starts: string[]
  let pluginAttachments: RuntimeHostDeps['pluginAttachments']
  let claudes: FakeSessionHandle[]
  let writer: { reached: number; answered: number }
  let aSignIn: () => Promise<CodexSignIn>

  const helperHome = () => deriveProviderHome(userData, { profileId: 'farah', provider: 'codex' })
  const ownHome = () =>
    deriveProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider: 'codex' })
  const held = () => signInAt(join(helperHome(), 'auth.json'))
  const accept = (...signIns: string[]) => signIns.forEach((one) => accepted.add(digestOf(one)))
  const digests = (...signIns: string[]) => signIns.map(digestOf)

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-refused-copy-'))
    machine = join(mkdtempSync(join(tmpdir(), 'brobot2-machine-')), 'auth.json')
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    pluginAttachments = undefined
    accepted = new Set()
    starts = []
    claudes = []
    codex = new StandInCodex(() => accepted, starts)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mkdirSync(ownHome(), { recursive: true, mode: 0o700 })
    writeFileSync(join(ownHome(), 'auth.json'), BROBOTS_OWN_BEFORE, { mode: 0o600 })
    let counter = 0
    const seams = {
      machineCodexAuthPath: () => machine,
      claudeAuthHealth: async () => ({ ok: true }),
    }
    const ops = createProviderAuthOps(userData, {
      codexCommand: () => join(userData, 'no-codex-is-run'),
      ...seams,
    })
    writer = { reached: 0, answered: 0 }
    aSignIn = () => Promise.reject(new Error('no sign-in is staged'))
    host = new RuntimeHost({
      store: (store = createSessionStore(db)),
      pluginAttachments: {
        agent(occupied) {
          if (!pluginAttachments) throw new Error('fictional attachments disabled')
          return pluginAttachments.agent(occupied)
        },
      },
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => (provider === 'codex' ? codex : new AClaude(claudes)),
      prepareProviderHome: (provider, profileId) =>
        prepareProviderHome(
          userData,
          { profileId: profileId ?? DEFAULT_PROFILE_ID, provider },
          seams,
        ),
      providerHomePath: (provider, profileId) =>
        deriveProviderHome(userData, { profileId, provider }),
      providerAuth: {
        ...ops,
        signIn: () => aSignIn(),
        replaceARefusedCopy: (...asked) => {
          writer.reached += 1
          return ops.replaceARefusedCopy(...asked).finally(() => (writer.answered += 1))
        },
      },
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dirname(machine), { recursive: true, force: true })
  })

  function aHelperHolding(copy: string): void {
    mkdirSync(helperHome(), { recursive: true, mode: 0o700 })
    writeFileSync(join(helperHome(), 'auth.json'), copy, { mode: 0o600 })
  }
  const brobotsOwnIs = (copy: string) =>
    writeFileSync(join(ownHome(), 'auth.json'), copy, { mode: 0o600 })
  let watching: Sink
  const start = () => {
    watching = new Sink()
    return host.createSession({ provider: 'codex', profileId: 'farah' }, watching)
  }
  const itsTurn = (handle: FakeSessionHandle) => {
    const machine = (
      handle as unknown as {
        machine: {
          beginTurn(): number | null
          completeTurn(state: 'failed', why: string, a: undefined, b: undefined, c: object): void
        }
      }
    ).machine
    return {
      begins: async () => {
        const before = watching.working
        machine.beginTurn()
        await vi.waitFor(() => expect(watching.working).toBeGreaterThan(before))
      },
      isRefusedOnItsLogin: () =>
        machine.completeTurn('failed', 'simulated refusal', undefined, undefined, {
          loginRefused: true,
        }),
    }
  }

  function withPluginSources() {
    const sources: { closed: boolean; reads: number; closes: number }[] = []
    const agent = vi.fn(() => {
      const source = { closed: false, reads: 0, closes: 0 }
      sources.push(source)
      const route = {
        name: 'plugin-fern',
        url: 'http://127.0.0.1:8123/mcp',
        capability: String(sources.length).repeat(64),
      }
      return {
        async read() {
          source.reads++
          if (source.closed) throw new Error('fictional released source')
          return { revision: String(sources.length), servers: [route] }
        },
        async close() {
          source.closed = true
          source.closes++
        },
      }
    })
    pluginAttachments = { agent }
    return { sources, agent }
  }

  it.each(['start', 'resume'] as const)(
    'repeated %s gets a new plugin source after the refused launch releases its source',
    async (mode) => {
      aHelperHolding(DEAD)
      let sessionId: string | undefined
      if (mode === 'resume') {
        accept(DEAD)
        sessionId = (await start()).sessionId
        await host.close(sessionId, watching)
        accepted.clear()
      }
      const { sources, agent } = withPluginSources()
      const fresh = vi.spyOn(codex, 'start'),
        resumed = vi.spyOn(codex, 'resume')
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS)
      const opened =
        mode === 'start' ? await start() : await host.resumeSession(sessionId!, watching)
      expect(starts).toEqual(
        mode === 'start' ? digests(DEAD, THE_COMPUTERS) : digests(DEAD, DEAD, THE_COMPUTERS),
      )
      const counts =
        mode === 'start'
          ? fresh.mock.calls.map(([options]) => options.managedPluginMcp?.length)
          : resumed.mock.calls.map(([, options]) => options.managedPluginMcp?.length)
      expect(counts[0]).toBe(1)
      expect(sources[0]!.reads).toBeGreaterThan(0)
      expect(counts).toEqual([1, 1])
      expect(agent).toHaveBeenCalledTimes(2)
      expect(sources.map((one) => one.closed)).toEqual([true, false])
      expect(sources.map((one) => one.closes)).toEqual([1, 0])
      await host.close(opened.sessionId, watching)
      expect(sources.map((one) => one.closes)).toEqual([1, 1])
    },
  )

  it.each(['ordinary', 'both-refused', 'no-replacement', 'other-error', 'cancelled'] as const)(
    'plugin source cleanup preserves the %s launch outcome',
    async (mode) => {
      const { sources } = withPluginSources()
      aHelperHolding(DEAD)
      if (mode === 'ordinary') accept(DEAD)
      if (mode === 'both-refused' || mode === 'other-error' || mode === 'cancelled')
        writeFileSync(machine, THE_COMPUTERS)
      if (mode === 'other-error') codex.failsOtherwise = true
      if (mode === 'cancelled')
        codex.asItRefuses = () => {
          void host.closeAll()
        }
      if (mode === 'ordinary') {
        const opened = await start()
        expect(sources.map((one) => one.closes)).toEqual([0])
        await host.close(opened.sessionId, watching)
      } else if (mode === 'other-error') {
        await expect(start()).rejects.toThrow('the program did not start')
      } else if (mode === 'cancelled') {
        await expect(start()).rejects.toThrow()
      } else {
        await expect(start()).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
      }
      const attempts = mode === 'both-refused' ? 2 : 1
      expect(starts).toHaveLength(attempts)
      expect(sources).toHaveLength(attempts)
      expect(sources.every((one) => one.reads === 1 && one.closes === 1)).toBe(true)
    },
  )

  describe('at a start', () => {
    it('🔴 a dead copy is replaced by this computer’s, refreshed later, and the start goes through', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS)
      await start()
      expect(starts).toEqual(digests(DEAD, THE_COMPUTERS))
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    it('🔴 BroBot’s own is the one copied when it was refreshed last', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      brobotsOwnIs(BROBOTS_OWN)
      accept(BROBOTS_OWN)
      await start()
      expect(starts).toEqual(digests(DEAD, BROBOTS_OWN))
      expect(held()).toBe(digestOf(BROBOTS_OWN))
    })

    it('⛔ once: the fresh copy refused too, the start is refused and nothing more is copied', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(DEAD, THE_COMPUTERS))
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(DEAD, THE_COMPUTERS, THE_COMPUTERS))
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    it('⛔ a copy newer than this computer’s and BroBot’s own is never overwritten', async () => {
      aHelperHolding(BROBOTS_OWN)
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS)
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(BROBOTS_OWN))
      expect(held()).toBe(digestOf(BROBOTS_OWN))
    })

    it('⛔ a helper on another account is never moved', async () => {
      aHelperHolding(ANOTHER_ACCOUNT)
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS, BROBOTS_OWN_BEFORE)
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(ANOTHER_ACCOUNT))
      expect(held()).toBe(digestOf(ANOTHER_ACCOUNT))
    })

    it('⛔ the same bytes are never copied again, and with none other the refusal stands', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, DEAD)
      rmSync(join(ownHome(), 'auth.json'))
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })

    it('⚑ a copy Codex takes is never replaced', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(DEAD)
      await start()
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })

    it('⛔ a sign-in refused before Codex was asked replaces nothing, with a fresher copy at hand', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(DEAD, THE_COMPUTERS)
      codex.refusesBeforeCodexIsAsked = true
      await expect(start()).rejects.toThrow(/insecure permissions/)
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })

    it('⛔ a start nobody wants any more replaces nothing', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS)
      codex.asItRefuses = () => void host.closeAll()
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
      expect(writer.reached).toBe(0)
    })

    it('⛔ a start that failed for another reason replaces nothing, with a fresher copy at hand', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(DEAD, THE_COMPUTERS)
      codex.failsOtherwise = true
      await expect(start()).rejects.toThrow()
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })

    it('⛔ never while an API key is saved, and never for Claude', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      const seams = { machineCodexAuthPath: () => machine, codexCommand: () => 'no-codex-is-run' }
      const withAKey = createProviderAuthOps(userData, {
        ...seams,
        codexKey: { isSaved: () => true } as never,
      })
      const refused = codexCopyIdentityIn(helperHome())!
      const wanted = (): boolean => true
      expect(await withAKey.replaceARefusedCopy('codex', 'farah', refused, wanted)).toBe(
        'not-tried',
      )
      expect(held()).toBe(digestOf(DEAD))
      const noKey = createProviderAuthOps(userData, seams)
      expect(await noKey.replaceARefusedCopy('claude', 'farah', refused, wanted)).toBe('not-tried')
      expect(held()).toBe(digestOf(DEAD))
      expect(await noKey.replaceARefusedCopy('codex', 'farah', refused, wanted)).toBe(
        'the-computers',
      )
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    it('🔒 what is logged names the profile and where the copy came from, never an account or a token', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, THE_COMPUTERS)
      accept(THE_COMPUTERS)
      await start()
      const logged = vi.mocked(console.warn).mock.calls.flat().map(String).join('\n')
      expect(logged).toContain('farah')
      expect(logged).toContain('this computer’s'.replace('’', "'"))
      expect(logged).not.toMatch(/acct-fictional|DEAD|COMPUTER|BROBOT|refresh-|2026-10/)
    })
  })

  describe('the refusal says what this app does about it', () => {
    const stored = (): { replacesRefusedSignIn?: true; onAKey?: true }[] =>
      (
        db.prepare("SELECT payload FROM events WHERE type = 'error'").all() as { payload: string }[]
      ).map((row) => JSON.parse(row.payload) as { replacesRefusedSignIn?: true; onAKey?: true })

    it('🔴 a Codex sign-in refused: the error says a refused copy is replaced, as shown and as stored', async () => {
      aHelperHolding(DEAD)
      accept(DEAD)
      const sink = new Sink()
      await host.createSession({ provider: 'codex', profileId: 'farah' }, sink)
      says(codex.handles[0]!, REFUSED)
      await vi.waitFor(() => expect(sink.errors).toHaveLength(1))
      expect(sink.errors[0]).toMatchObject({ cause: 'auth', replacesRefusedSignIn: true })
      expect(held()).toBe(digestOf(DEAD))
      expect(stored()).toEqual([expect.objectContaining({ replacesRefusedSignIn: true })])
    })

    it('⛔ a conversation that no longer runs on the copy it was started on says no such thing', async () => {
      aHelperHolding(DEAD)
      accept(DEAD)
      const sink = new Sink()
      await host.createSession({ provider: 'codex', profileId: 'farah' }, sink)
      aHelperHolding(signIn('acct-fictional-a', 'PUT-THERE-SINCE', '2026-10-08T23:00:00Z'))
      says(codex.handles[0]!, REFUSED)
      await vi.waitFor(() => expect(sink.errors).toHaveLength(1))
      expect(sink.errors[0]).toMatchObject({ cause: 'auth' })
      expect(sink.errors[0]).not.toHaveProperty('replacesRefusedSignIn')
      expect(stored().filter((error) => error.replacesRefusedSignIn !== undefined)).toEqual([])
    })

    it('⛔ a refused key, another kind of error, and Claude say no such thing', async () => {
      aHelperHolding(DEAD)
      accept(DEAD)
      const sink = new Sink()
      await host.createSession({ provider: 'codex', profileId: 'farah' }, sink)
      says(codex.handles[0]!, { ...REFUSED, onAKey: true })
      says(codex.handles[0]!, { type: 'error', message: 'the network failed', fatal: false })
      const claude = new Sink()
      await host.createSession({ provider: 'claude', profileId: 'farah' }, claude)
      says(claudes[0]!, REFUSED)
      await vi.waitFor(() => expect(sink.errors.length + claude.errors.length).toBe(3))
      for (const error of [...sink.errors, ...claude.errors]) {
        expect(error).not.toHaveProperty('replacesRefusedSignIn')
      }
      expect(stored().filter((error) => error.replacesRefusedSignIn !== undefined)).toEqual([])
    })
  })

  describe('in a turn', () => {
    async function runningOnACopyThatDiesInATurn(): Promise<void> {
      aHelperHolding(DEAD)
      accept(DEAD)
      await start()
      writeFileSync(machine, THE_COMPUTERS)
      accepted.clear()
      accept(THE_COMPUTERS)
    }

    it('🔴 Codex refuses the copy in a turn: it is replaced, and the conversation reopened on the fresh one', async () => {
      await runningOnACopyThatDiesInATurn()
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    it('⛔ once: the fresh copy refused at the reopen, nothing more is copied and the refusal stands', async () => {
      await runningOnACopyThatDiesInATurn()
      accepted.clear()
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(starts).toEqual(digests(DEAD, THE_COMPUTERS))
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    function theCheckHeldBack(): { asked: () => boolean; answer: () => void } {
      let answer: (() => void) | null = null
      codex.checksItsSignIn = () => new Promise((resolve) => (answer = () => resolve(false)))
      return { asked: () => answer !== null, answer: () => answer?.() }
    }

    it('⛔ a refusal that outlived its conversation replaces nothing', async () => {
      await runningOnACopyThatDiesInATurn()
      const check = theCheckHeldBack()
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => expect(check.asked()).toBe(true))
      await host.closeAll()
      check.answer()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
      expect(writer.reached).toBe(0)
    })

    it('⛔ a copy that changed since it was refused is left alone, with a fresher one at hand', async () => {
      await runningOnACopyThatDiesInATurn()
      const check = theCheckHeldBack()
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => expect(check.asked()).toBe(true))
      const renewed = signIn('acct-fictional-a', 'RENEWED-MEANWHILE', '2026-10-08T23:00:00Z')
      aHelperHolding(renewed)
      check.answer()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(renewed))
    })

    describe('⛔ a copy put there while the turn ran is not the one Codex refused, and is left alone', () => {
      const renewed = signIn('acct-fictional-a', 'PUT-THERE-MEANWHILE', '2026-10-08T23:00:00Z')
      async function refusedAfter(putThere: () => void): Promise<void> {
        await runningOnACopyThatDiesInATurn()
        const turn = itsTurn(codex.handles[0]!)
        await turn.begins()
        putThere()
        turn.isRefusedOnItsLogin()
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(starts).toEqual(digests(DEAD))
        expect(held()).toBe(digestOf(renewed))
      }

      it('in place, as Codex renews its own', async () => {
        await refusedAfter(() => aHelperHolding(renewed))
      })

      it('as another file under the same name, as a person’s re-copy does it', async () => {
        await refusedAfter(() => {
          writeFileSync(join(helperHome(), 'auth.json.new'), renewed, { mode: 0o600 })
          renameSync(join(helperHome(), 'auth.json.new'), join(helperHome(), 'auth.json'))
        })
      })
    })

    it('⛔ a copy put there after this conversation’s Codex was started is not repaired from inside it, even unchanged across a whole turn', async () => {
      await runningOnACopyThatDiesInATurn()
      const another = signIn(
        'acct-fictional-a',
        'PUT-THERE-BEFORE-THE-TURN',
        '2026-10-08T23:00:00Z',
      )
      aHelperHolding(another)
      const turn = itsTurn(codex.handles[0]!)
      await turn.begins()
      turn.isRefusedOnItsLogin()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(another))
    })

    it('⛔ the app closed while the writer waits for the home’s lock replaces nothing', async () => {
      await runningOnACopyThatDiesInATurn()
      let letGo: () => void = () => {}
      const holding = withProviderHomeLock(
        helperHome(),
        () => new Promise<void>((resolve) => (letGo = resolve)),
      )
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => expect(writer.reached).toBe(1))
      expect(writer.answered).toBe(0)
      const closing = host.closeAll()
      await new Promise((resolve) => setTimeout(resolve, 50))
      letGo()
      await holding
      await vi.waitFor(() => expect(writer.answered).toBe(1))
      await closing
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })

    it('⚑ the same turn, begun and refused with the copy untouched between: replaced and reopened', async () => {
      await runningOnACopyThatDiesInATurn()
      const turn = itsTurn(codex.handles[0]!)
      await turn.begins()
      turn.isRefusedOnItsLogin()
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      expect(held()).toBe(digestOf(THE_COMPUTERS))
    })

    it('⛔ with nothing refreshed later, the copy stays and the conversation is not reopened', async () => {
      aHelperHolding(DEAD)
      writeFileSync(machine, DEAD)
      accept(DEAD)
      await start()
      await codex.handles[0]!.runTurnRefusedOnItsLogin()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(starts).toEqual(digests(DEAD))
      expect(held()).toBe(digestOf(DEAD))
    })
  })

  describe('a turn of words refused before it did anything is carried on once the sign-in is repaired, never sent again', () => {
    const MESSAGE = 'Please summarise the open pull requests.'
    const rowsOf = (id: string): TranscriptEvent[] => store.events(id).map((row) => row.event)
    const turnsOf = (id: string): UserTurnEvent[] =>
      rowsOf(id).filter((row): row is UserTurnEvent => row.type === 'user_turn')
    const endingsOf = (id: string): string[] =>
      rowsOf(id).flatMap((row) => (row.type === 'turn' ? [row.state] : []))

    async function aMessageRefused(
      mode: TurnMode,
      beforeTheMessage: () => void = () => {},
    ): Promise<string> {
      aHelperHolding(DEAD)
      accept(DEAD)
      const { sessionId } = await start()
      writeFileSync(machine, THE_COMPUTERS)
      accepted.clear()
      accept(THE_COMPUTERS)
      codex.turnModes.push(mode)
      beforeTheMessage()
      await host.send(sessionId, MESSAGE, watching)
      return sessionId
    }
    const settled = () => new Promise((resolve) => setTimeout(resolve, 150))
    const handedOver = (): string[] =>
      codex.sent.map((text) =>
        text.includes(MESSAGE)
          ? MESSAGE
          : text.includes('A newer message.')
            ? 'A newer message.'
            : text,
      )

    it('🔴 the agent answers the refused message once: nothing is sent again, and one turn with nothing new carries on', async () => {
      const id = await aMessageRefused('refused')
      await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
      await vi.waitFor(() => expect(endingsOf(id)).toEqual(['failed', 'completed']))
      expect(starts).toEqual(digests(DEAD, THE_COMPUTERS))
      expect(handedOver()).toEqual([MESSAGE])
      expect(turnsOf(id).map((turn) => [turn.text, turn.carriesOn ?? false])).toEqual([
        [MESSAGE, false],
        ['', true],
      ])
      expect(turnsOf(id)[1]).toMatchObject({ attribution: 'app_authored' })
      expect(turnsOf(id)[1]).not.toHaveProperty('carriedOnAfterAccountChange')
      expect(rowsOf(id).filter((row) => row.type === 'reopened')).toEqual([
        { type: 'reopened', because: 'the-sign-in-was-renewed', itsCopyWasReplaced: true },
      ])
    })

    it('⛔ once: a turn that carried on and was refused again is not carried on again', async () => {
      codex.carryOnIsHeldOpen = true
      const id = await aMessageRefused('refused')
      await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
      brobotsOwnIs(BROBOTS_OWN)
      accept(BROBOTS_OWN)
      codex.refuseTheOpenTurn()
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS, BROBOTS_OWN)))
      await settled()
      expect(codex.carriedOn).toBe(1)
      expect(handedOver()).toEqual([MESSAGE])
      expect(endingsOf(id)).toEqual(['failed', 'failed'])
    })

    it('⛔ a message that came while the refused turn ran goes instead: nothing is carried on', async () => {
      const id = await aMessageRefused('held-open')
      await host.queueMessage(id, 'A newer message.', watching)
      codex.refuseTheOpenTurn()
      await vi.waitFor(() => expect(handedOver()).toContain('A newer message.'))
      await settled()
      expect(codex.carriedOn).toBe(0)
      expect(handedOver().filter((text) => text === MESSAGE)).toHaveLength(1)
    })

    it('⛔ a refused turn that had begun a reply is not carried on', async () => {
      await aMessageRefused('refused-after-a-word')
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await settled()
      expect(codex.carriedOn).toBe(0)
      expect(handedOver()).toEqual([MESSAGE])
    })

    it('⛔ the app closing as the conversation is reopened carries nothing on', async () => {
      aHelperHolding(DEAD)
      accept(DEAD)
      const { sessionId } = await start()
      writeFileSync(machine, THE_COMPUTERS)
      accepted.clear()
      accept(THE_COMPUTERS)
      codex.turnModes.push('refused')
      codex.asItStarts = () => {
        codex.asItStarts = () => {}
        void host.closeAll()
      }
      await host.send(sessionId, MESSAGE, watching)
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await settled()
      expect(codex.carriedOn).toBe(0)
    })

    it('⛔ a provider that cannot start a turn with nothing new carries nothing on, and nothing is sent again', async () => {
      codex.cannotCarryOn = true
      const id = await aMessageRefused('refused')
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await settled()
      expect(codex.carriedOn).toBe(0)
      expect(handedOver()).toEqual([MESSAGE])
      expect(turnsOf(id)).toHaveLength(1)
      expect(rowsOf(id).filter((row) => row.type === 'reopened')).toEqual([
        { type: 'reopened', because: 'the-sign-in-was-renewed', itsCopyWasReplaced: true },
      ])
    })

    it('⛔ a carrying-on turn refused before its own row is written is not carried on again', async () => {
      codex.carryOnIsRefusedAtOnce = true
      const id = await aMessageRefused('refused')
      brobotsOwnIs(BROBOTS_OWN)
      accept(BROBOTS_OWN)
      await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
      await settled()
      await settled()
      expect(codex.carriedOn).toBe(1)
      expect(handedOver()).toEqual([MESSAGE])
      expect(turnsOf(id).filter((turn) => turn.carriesOn === true).length).toBeLessThanOrEqual(1)
    })

    it('⛔ its sign-in moved to another account by the time it would carry on: nothing is carried on', async () => {
      await aMessageRefused('refused', () => {
        codex.asItStarts = () => {
          codex.asItStarts = () => {}
          codex.checksItsSignIn = async () => true
        }
      })
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await settled()
      expect(codex.carriedOn).toBe(0)
      expect(handedOver()).toEqual([MESSAGE])
    })

    it('⛔ a refused turn reopened on another account’s sign-in carries nothing on, and its reopen asks for the message again', async () => {
      aHelperHolding(DEAD)
      accept(DEAD, ANOTHER_ACCOUNT)
      const { sessionId: id } = await start()
      codex.turnModes.push('held-open')
      await host.send(id, MESSAGE, watching)
      aHelperHolding(ANOTHER_ACCOUNT)
      Object.assign(codex.handles[0]!, { checkSignIn: async () => true })
      codex.refuseTheOpenTurn()
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, ANOTHER_ACCOUNT)))
      await settled()
      expect(held()).toBe(digestOf(ANOTHER_ACCOUNT))
      expect(codex.carriedOn).toBe(0)
      expect(handedOver()).toEqual([MESSAGE])
      expect(rowsOf(id).filter((row) => row.type === 'reopened')).toEqual([
        { type: 'reopened', because: 'the-sign-in-was-renewed' },
      ])
      expect(REOPENED_ON_A_RENEWED_SIGN_IN).toContain('send again')
    })

    it('⛔ its provider’s usage limit holds what this app would start: nothing is carried on', async () => {
      const read = store.providerLimitsSeen.bind(store)
      vi.spyOn(store, 'providerLimitsSeen').mockImplementation((now, since) => ({
        ...read(now, since),
        rows: [
          {
            provider: 'codex',
            window: 'five_hour',
            standing: 'stopped',
            resetsAt: Date.now() + 3_600_000,
            said: 'a stand-in limit',
            at: Date.now(),
          },
        ],
      }))
      await aMessageRefused('refused')
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await settled()
      expect(codex.carriedOn).toBe(0)
    })

    it('⛔ a person’s Stop and send that met the refusal goes instead: nothing is carried on', async () => {
      const id = await aMessageRefused('held-open')
      codex.aStopMeetsTheRefusal = true
      await host.sendInterrupting(id, 'A newer message.', watching)
      await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
      await vi.waitFor(() => expect(handedOver()).toContain('A newer message.'))
      await settled()
      expect(codex.carriedOn).toBe(0)
      expect(handedOver().filter((text) => text === MESSAGE)).toHaveLength(1)
    })

    // Hold the post-reopen sign-in check while queued work changes.
    async function refusedAndCarryingOnWhile(
      meanwhile: (id: string) => Promise<void>,
    ): Promise<string> {
      let id = ''
      let reopened = false
      let checked = false
      codex.asItStarts = () => (reopened = starts.at(-1) === digestOf(THE_COMPUTERS))
      codex.checksItsSignIn = async () => {
        if (!reopened) return false
        reopened = false
        expect(id).not.toBe('')
        codex.checksItsSignIn = async () => false
        await meanwhile(id)
        checked = true
        return false
      }
      id = await aMessageRefused('refused')
      await vi.waitFor(() => expect(checked).toBe(true))
      await settled()
      return id
    }

    it('⛔ a person’s Stop and send while the carrying-on turn checks its sign-in goes instead: nothing is carried on', async () => {
      const theirs: { go?: () => void; sent?: Promise<unknown> } = {}
      await refusedAndCarryingOnWhile(async (id) => {
        codex.checksItsSignIn = () => new Promise((resolve) => (theirs.go = () => resolve(false)))
        theirs.sent = host.sendInterrupting(id, 'A newer message.', watching)
        await vi.waitFor(() => expect(theirs.go).toBeDefined())
        codex.checksItsSignIn = async () => false
      })
      expect(codex.carriedOn).toBe(0)
      theirs.go!()
      await theirs.sent
      await vi.waitFor(() => expect(handedOver()).toContain('A newer message.'))
      expect(codex.carriedOn).toBe(0)
      expect(handedOver().filter((text) => text === MESSAGE)).toHaveLength(1)
    })

    it('⛔ the app quitting while the carrying-on turn checks its sign-in carries nothing on', async () => {
      const card: { asked: boolean; cancelled: boolean; done?: () => void } = {
        asked: false,
        cancelled: false,
      }
      aSignIn = async () => {
        card.asked = true
        let ended: (outcome: Awaited<CodexSignIn['completed']>) => void = () => {}
        // One cancel, however often it is asked for: the quit asks, and so does the sign-in's own end.
        let cancelled: Promise<void> | null = null
        return {
          authUrl: 'http://localhost:1455/fictional',
          completed: new Promise((resolve) => (ended = resolve)),
          cancel: () =>
            (cancelled ??= new Promise<void>((resolve) => {
              card.cancelled = true
              card.done = () => {
                ended({ success: false, state: { state: 'unknown', reason: 'canceled' } })
                resolve()
              }
            })),
        }
      }
      const runsNow = (id: string): boolean =>
        (host as unknown as { runsNow(id: string): boolean }).runsNow(id)
      let quitting: Promise<void> = Promise.resolve()
      await refusedAndCarryingOnWhile(async (id) => {
        void host.signInProvider('codex', DEFAULT_PROFILE_ID).catch(() => {})
        await vi.waitFor(() => expect(card.asked).toBe(true))
        await new Promise((resolve) => setTimeout(resolve, 0))
        quitting = host.closeAll()
        await vi.waitFor(() => expect(card.cancelled).toBe(true))
        expect(runsNow(id)).toBe(true)
      })
      expect(codex.carriedOn).toBe(0)
      card.done!()
      await quitting
    })

    describe('what the ledger cannot say is not "nothing"', () => {
      async function refusedWhile(meanwhile: (id: string) => void): Promise<string> {
        let answer: (() => void) | null = null
        const id = await aMessageRefused('refused')
        codex.checksItsSignIn = () =>
          new Promise((resolve) => {
            codex.checksItsSignIn = async () => false
            answer = () => resolve(false)
          })
        await vi.waitFor(() => expect(answer).not.toBeNull())
        meanwhile(id)
        answer!()
        await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, THE_COMPUTERS)))
        await settled()
        return id
      }

      it('⛔ a row of the refused turn that cannot be read leaves a hole: nothing is carried on', async () => {
        await refusedWhile((id) => {
          const turn = turnsOf(id)
          expect(turn).toHaveLength(1)
          const { ordinal } = store.events(id).find((row) => row.event.type === 'error')!
          db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
            '{ not a row',
            id,
            ordinal,
          )
        })
        expect(codex.carriedOn).toBe(0)
      })

      it('⛔ more rows since the refused message than are read: nothing is carried on', async () => {
        const id = await refusedWhile(() => {
          for (let one = 0; one < 400; one += 1) {
            says(codex.handles[0]!, {
              type: 'context_reading',
              reading: { kind: 'tokens', used: one },
              source: 'a stand-in',
            } as RuntimeEvent)
          }
        })
        expect(rowsOf(id).filter((row) => row.type === 'context_reading')).toHaveLength(400)
        expect(codex.carriedOn).toBe(0)
      })

      it('⛔ the provider said something after its refusal: nothing is carried on', async () => {
        const id = await refusedWhile(() => {
          says(codex.handles[0]!, { type: 'assistant_message', text: 'a late word' })
        })
        expect(rowsOf(id).map((row) => row.type)).toContain('assistant_message')
        expect(codex.carriedOn).toBe(0)
      })

      it('⛔ the provider began a turn by itself after its refusal: nothing is carried on', async () => {
        const id = await refusedWhile(() => {
          says(codex.handles[0]!, { type: 'provider_turn' })
        })
        expect(rowsOf(id).map((row) => row.type)).toContain('provider_turn')
        expect(codex.carriedOn).toBe(0)
      })

      it('⛔ work done after the refusal went unrecorded: nothing is carried on', async () => {
        const id = await refusedWhile(() => {
          // Failed recording must remain distinguishable from an empty ledger.
          vi.spyOn(store, 'append').mockImplementationOnce(() => {
            throw new Error('the disk is full')
          })
          says(codex.handles[0]!, { type: 'assistant_message', text: 'a late word' })
        })
        expect(rowsOf(id).map((row) => row.type)).not.toContain('assistant_message')
        expect(codex.carriedOn).toBe(0)
      })

      it('⚑ the same, with nothing done meanwhile: carried on', async () => {
        await refusedWhile(() => {})
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
      })
    })

    describe('a give refused after the profile changes account', () => {
      async function given(): Promise<{ giver: string; helper: string; piece: string }> {
        aHelperHolding(DEAD)
        accept(DEAD, ANOTHER_ACCOUNT)
        const { sessionId: helper } = await start()
        await host.close(helper, watching)
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        codex.turnModes.push('held-open')
        const result = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'farah',
            title: 'The open pull requests',
            brief: MESSAGE,
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!result.ok) throw new Error(`refused: ${result.refusal.rail}`)
        host.claimSession(result.owner, watching)
        return { giver, helper: result.owner, piece: result.piece }
      }

      function switchAndRefuse(): void {
        aHelperHolding(ANOTHER_ACCOUNT)
        Object.assign(codex.handles.at(-1)!, { checkSignIn: async () => true })
        codex.refuseTheOpenTurn()
      }

      const housekeeping = (
        label: string,
        category: Extract<RuntimeEvent, { type: 'unknown' }>['category'] = 'lifecycle',
      ): Extract<RuntimeEvent, { type: 'unknown' }> => ({
        type: 'unknown',
        provider: 'codex',
        category,
        label,
        raw: { fictional: true },
      })
      const beforeRefusal: readonly RuntimeEvent[] = [
        housekeeping('thread/status/changed'),
        housekeeping('mcpServer/startupStatus/updated'),
        housekeeping('account/rateLimits/read'),
        housekeeping('mcpServer/startupStatus/updated'),
        housekeeping('userMessage', 'echo'),
        housekeeping('userMessage', 'echo'),
        ...Array.from({ length: 10 }, (): RuntimeEvent => ({
          type: 'error',
          message: 'Fictional transient failure.',
          fatal: false,
        })),
        housekeeping('thread/status/changed'),
        { type: 'error', message: 'Fictional refusal.', fatal: false },
      ]
      const emptyTerminals: Extract<RuntimeEvent, { type: 'background_work' }> = {
        type: 'background_work',
        source: 'thread/backgroundTerminals/list',
        running: [],
      }
      const afterReopen: readonly RuntimeEvent[] = [
        housekeeping('remoteControl/status/changed'),
        housekeeping('account/updated'),
        housekeeping('skills/changed'),
        ...Array.from({ length: 5 }, () => housekeeping('mcpServer/startupStatus/updated')),
        housekeeping('thread/status/changed'),
        emptyTerminals,
        housekeeping('thread/goal/cleared'),
        ...Array.from({ length: 4 }, () => housekeeping('mcpServer/startupStatus/updated')),
        housekeeping('account/rateLimits/read'),
        ...Array.from({ length: 5 }, () => housekeeping('mcpServer/startupStatus/updated')),
      ]
      async function heardBeforeRefusal(
        helper: string,
        events: readonly RuntimeEvent[],
      ): Promise<void> {
        const from = store.nextOrdinal(helper)
        for (const event of events) says(codex.handles.at(-1)!, event)
        await vi.waitFor(() =>
          expect(store.eventsFrom(helper, from, 400)).toHaveLength(events.length),
        )
      }
      async function reopenedWithoutCarrying(helper: string): Promise<void> {
        await vi.waitFor(() => expect(starts.at(-1)).toBe(digestOf(ANOTHER_ACCOUNT)))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
        expect(turnsOf(helper).some((turn) => turn.carriesOn === true)).toBe(false)
      }

      it('classified lifecycle and input echoes let an existing conversation carry its give on once', async () => {
        const { helper, giver } = await given()
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed']))
        for (let n = 1; n < 28; n++) {
          await host.send(helper, 'Fictional earlier input.', watching)
          await vi.waitFor(() => expect(endingsOf(helper)).toHaveLength(n + 1))
        }
        const brief = 'Check the fictional release with its housekeeping frames.'
        codex.turnModes.push('held-open')
        const result = await host.giveWork(
          {
            definition_of_done: 'The fictional result is kept.',
            profile: 'farah',
            title: 'The new fictional give',
            brief,
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!result.ok) throw new Error('fictional give refused')
        expect(result.owner).toBe(helper)
        const piece = result.piece
        await vi.waitFor(() => expect(codex.sent).toHaveLength(29))
        await heardBeforeRefusal(helper, beforeRefusal)
        const opened = store.newestOfType?.(helper, 'user_turn')
        if (opened?.event.type !== 'user_turn') throw new Error('fictional give not retained')
        const original = opened.event
        expect(original.parts).toBeUndefined()
        expect(original.piece).toBe(piece)
        const untilEnd = [
          'status',
          'work_given',
          ...beforeRefusal.map((event) => event.type),
          'error',
          'turn',
        ]
        switchAndRefuse()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await vi.waitFor(() => expect(endingsOf(helper).at(-1)).toBe('completed'))
        expect(
          store
            .eventsFrom(helper, opened.ordinal + 1, untilEnd.length)
            .map(({ event }) => event.type),
        ).toEqual(untilEnd)
        expect(codex.sent).toHaveLength(29)
        expect(codex.answeredInputs).toHaveLength(29)
        expect(codex.answeredInputs.at(-1)).toContain(brief)
        expect(codex.sent.filter((text) => text.includes(brief))).toHaveLength(1)
        expect(turnsOf(helper)).toHaveLength(30)
        expect(turnsOf(helper).at(-1)).toMatchObject({
          text: '',
          carriesOn: true,
          carriedOnAfterAccountChange: true,
          drives: piece,
        })
        expect(turnsOf(helper).filter((turn) => turn.carriesOn)).toHaveLength(1)
      })

      it('startup lifecycle and an empty terminal level survive both carry-on rechecks', async () => {
        const { helper, piece } = await given()
        let rechecked = 0
        codex.asItResumes = (handle) => {
          for (const event of afterReopen) says(handle, event)
          codex.checksItsSignIn = async () => {
            rechecked++
            const from = store.nextOrdinal(helper)
            says(handle, housekeeping('mcpServer/startupStatus/updated'))
            says(handle, { ...emptyTerminals, dropped: 0 })
            await vi.waitFor(() =>
              expect(store.eventsFrom(helper, from, 400).length).toBeGreaterThanOrEqual(2),
            )
            return false
          }
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'completed']))
        expect(rechecked).toBeGreaterThan(0)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(1)
        expect(codex.answeredInputs[0]).toContain(MESSAGE)
        expect(turnsOf(helper).at(-1)).toMatchObject({ carriesOn: true, drives: piece, text: '' })
      })

      const notHousekeeping: readonly { name: string; event: RuntimeEvent }[] = [
        { name: 'an unrelated lifecycle label', event: housekeeping('thread/reverted') },
        {
          name: 'tool progress classified as activity',
          event: housekeeping('command/exec/outputDelta', 'activity'),
        },
        { name: 'a non-input echo', event: housekeeping('functionCallOutput', 'echo') },
        {
          name: 'a degraded input echo',
          event: { ...housekeeping('userMessage', 'echo'), degradedFrom: 'tool_call' },
        },
        {
          name: 'an unrecognized frame with a housekeeping label',
          event: housekeeping('thread/status/changed', 'unrecognized'),
        },
        {
          name: 'a degraded tool carrying a housekeeping label',
          event: { ...housekeeping('thread/status/changed'), degradedFrom: 'tool_call' },
        },
        {
          name: 'another provider using the same label',
          event: { ...housekeeping('thread/status/changed'), provider: 'claude' },
        },
        {
          name: 'a new reply fragment',
          event: { type: 'assistant_delta', text: 'Fictional partial output.' },
        },
        {
          name: 'a tool call',
          event: {
            type: 'tool_call',
            id: 'fictional-tool',
            name: 'Read',
            summary: 'Fictional read.',
          },
        },
        {
          name: 'a tool result',
          event: {
            type: 'tool_result',
            id: 'fictional-tool',
            summary: 'Fictional result.',
            ok: true,
          },
        },
        { name: 'an empty terminal level before the refusal', event: emptyTerminals },
      ]
      for (const { name, event } of notHousekeeping) {
        it(`before refusal still rejects ${name}`, async () => {
          const { helper } = await given()
          await heardBeforeRefusal(helper, [event])
          switchAndRefuse()
          await reopenedWithoutCarrying(helper)
        })
      }

      const notStartup: readonly { name: string; event: RuntimeEvent; malformedRunning?: true }[] =
        [
          { name: 'an unrelated lifecycle label', event: housekeeping('thread/reverted') },
          { name: 'a new input echo after the ending', event: housekeeping('userMessage', 'echo') },
          {
            name: 'tool progress classified as activity',
            event: housekeeping('command/exec/outputDelta', 'activity'),
          },
          {
            name: 'a degraded tool carrying a startup label',
            event: { ...housekeeping('skills/changed'), degradedFrom: 'tool_call' },
          },
          {
            name: 'a running terminal',
            event: { ...emptyTerminals, running: [{ id: 'fictional-job' }] },
          },
          { name: 'a malformed terminal level', event: emptyTerminals, malformedRunning: true },
          {
            name: 'an absent terminal level',
            event: { type: 'background_work', source: emptyTerminals.source },
          },
          {
            name: 'an ended terminal job',
            event: { ...emptyTerminals, ended: { id: 'fictional-job', outcome: 'completed' } },
          },
          { name: 'an incomplete empty level', event: { ...emptyTerminals, dropped: 1 } },
          {
            name: 'an empty level from another source',
            event: { ...emptyTerminals, source: 'fictional-other-source' },
          },
          {
            name: 'a new tool result',
            event: {
              type: 'tool_result',
              id: 'fictional-tool',
              summary: 'Fictional result.',
              ok: true,
            },
          },
          { name: 'a provider-started turn', event: { type: 'provider_turn' } },
        ]
      for (const { name, event, malformedRunning } of notStartup) {
        it(`after reopen still rejects ${name}`, async () => {
          const { helper } = await given()
          codex.asItResumes = (handle) => {
            says(handle, event)
            codex.checksItsSignIn = async () => {
              await vi.waitFor(() => expect(rowsOf(helper)).toContainEqual(event))
              if (malformedRunning) {
                const row = store.newestOfType?.(helper, 'background_work')
                if (row === null || row === undefined) throw new Error('fictional level missing')
                db.prepare(
                  `UPDATE events SET payload=json_set(payload, '$.running', json(?))
                  WHERE session_id=? AND generation=0 AND ordinal=?`,
                ).run('{"length":0}', helper, row.ordinal)
              }
              return false
            }
          }
          switchAndRefuse()
          await reopenedWithoutCarrying(helper)
        })
      }

      it('a failed compacting give without loginRefused is not carried on', async () => {
        const { helper } = await given()
        await heardBeforeRefusal(helper, [
          housekeeping('thread/status/changed'),
          { type: 'activity', phase: 'compacting' },
          housekeeping('userMessage', 'echo'),
        ])
        aHelperHolding(ANOTHER_ACCOUNT)
        codex.refuseTheOpenTurn(false)
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(starts.at(-1)).toBe(digestOf(DEAD))
        expect(rowsOf(helper).some((event) => event.type === 'work_recovery')).toBe(false)
      })

      it('housekeeping without a loginRefused ending is still not carried on', async () => {
        const { helper } = await given()
        await heardBeforeRefusal(helper, beforeRefusal)
        aHelperHolding(ANOTHER_ACCOUNT)
        codex.refuseTheOpenTurn(false)
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(starts.at(-1)).toBe(digestOf(DEAD))
      })

      it('the first successful turn answers the retained brief once, without another send', async () => {
        const { helper, piece } = await given()
        const newest = store.newestOfType?.bind(store)
        if (newest === undefined) throw new Error('the fixture must support indexed turn reads')
        const original = newest(helper, 'user_turn')
        if (original?.event.type !== 'user_turn') throw new Error('the give has no retained input')
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'completed']))
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(1)
        expect(codex.answeredInputs[0]).toContain(MESSAGE)
        expect(newest(helper, 'work_given')?.event).toMatchObject({ piece })
        expect(turnsOf(helper)).toEqual([
          original.event,
          {
            type: 'user_turn',
            text: '',
            attribution: 'app_authored',
            carriesOn: true,
            carriedOnAfterAccountChange: true,
            drives: piece,
          },
        ])
        expect(rowsOf(helper).filter((row) => row.type === 'reopened')).toEqual([
          { type: 'reopened', because: 'the-sign-in-was-renewed' },
        ])
      })

      it('a second refusal never carries the brief on again', async () => {
        const { helper } = await given()
        codex.carryOnIsRefusedAtOnce = true
        codex.asItCarriesOn = () => {
          aHelperHolding(DEAD)
          Object.assign(codex.handles.at(-1)!, { checkSignIn: async () => true })
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'failed']))
        await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, DEAD, ANOTHER_ACCOUNT, DEAD)))
        await settled()
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(0)
      })

      it('a give held behind an older turn also answers its retained input once', async () => {
        const { giver, helper } = await given()
        codex.turnModes.push('held-open')
        const next = await host.giveWork(
          {
            definition_of_done: 'The result is recorded.',
            profile: 'farah',
            title: 'The next brief',
            brief: 'Read the fictional release notes.',
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!next.ok) throw new Error(`refused: ${next.refusal.rail}`)
        expect(next.owner).toBe(helper)
        expect(codex.sent).toHaveLength(1)
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(codex.sent).toHaveLength(2))
        switchAndRefuse()
        await vi.waitFor(() =>
          expect(endingsOf(helper)).toEqual(['completed', 'failed', 'completed']),
        )
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(2)
        expect(codex.answeredInputs.at(-1)).toContain('Read the fictional release notes.')
        expect(turnsOf(helper).at(-1)).toMatchObject({
          carriesOn: true,
          drives: next.piece,
          text: '',
        })
      })

      it('a same-text rebrief is still not a first give and is never carried on', async () => {
        const { giver, helper, piece } = await given()
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed']))
        codex.turnModes.push('held-open')
        const changed = await host.updateWork(
          {
            piece,
            title: null,
            status: null,
            on: null,
            brief: MESSAGE,
            close: false,
            resources: [],
          },
          { ownerId: agentCallerId(giver) },
        )
        expect(changed.ok).toBe(true)
        await vi.waitFor(() => expect(codex.sent).toHaveLength(2))
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed', 'failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
      })

      for (const { author, name } of [
        {
          author: 'person',
          name: 'a queued give with an unreadable person subpart never carries the mixed input on',
        },
        {
          author: 'agent note',
          name: 'a queued give with an unreadable agent note subpart never carries the mixed input on',
        },
      ] as const) {
        it(name, async () => {
          const { giver, helper } = await given()
          const brief = 'Read the fictional release notes.'
          const other = 'Words that must not be carried across accounts.'
          codex.turnModes.push('held-open')
          const next = await host.giveWork(
            {
              definition_of_done: 'The result is recorded.',
              profile: 'farah',
              title: 'The next brief',
              brief,
            },
            { ownerId: agentCallerId(giver) },
          )
          if (!next.ok) throw new Error(`refused: ${next.refusal.rail}`)
          expect(next.owner).toBe(helper)
          if (author === 'person') await host.queueMessage(helper, other, watching)
          else
            await host.queueMessage(
              helper,
              other,
              { ownerId: agentCallerId(giver) },
              [],
              'work',
              {},
              'note',
            )
          expect(codex.sent).toHaveLength(1)
          codex.answerTheOpenTurn()
          await vi.waitFor(() => expect(turnsOf(helper).at(-1)?.parts).toHaveLength(2))
          expect(codex.sent).toHaveLength(2)
          expect(codex.sent[1]).toContain(brief)
          expect(codex.sent[1]).toContain(other)
          const newest = store.newestOfType?.bind(store)
          if (newest === undefined) throw new Error('the fixture must support indexed turn reads')
          const opened = newest(helper, 'user_turn')
          if (opened?.event.type !== 'user_turn' || opened.event.parts?.length !== 2) {
            throw new Error('the fixture did not hand over one mixed input')
          }
          expect(opened.event.parts[0]).toMatchObject({ piece: next.piece, text: brief })
          expect(opened.event.parts[1]?.text).toBe(other)
          // The retained input still has both messages. Only the fictional ledger's second part
          // becomes unreadable; its presentation reader drops that part but preserves the key.
          db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
            JSON.stringify({
              ...opened.event,
              parts: opened.event.parts.map((part, at) =>
                at === 1 ? { ...part, text: null } : part,
              ),
            }),
            helper,
            opened.ordinal,
          )
          const sampled = newest(helper, 'user_turn')?.event
          if (sampled?.type !== 'user_turn') throw new Error('the opening row disappeared')
          expect(sampled.parts).toHaveLength(1)
          expect(sampled.text).toContain(other)
          switchAndRefuse()
          await vi.waitFor(() => expect(starts.at(-1)).toBe(digestOf(ANOTHER_ACCOUNT)))
          await settled()
          expect(codex.carriedOn).toBe(0)
          expect(endingsOf(helper)).toEqual(['completed', 'failed'])
          expect(codex.sent).toHaveLength(2)
          expect(turnsOf(helper).some((turn) => turn.carriesOn === true)).toBe(false)
          const transcript = createTranscript()
          for (const event of rowsOf(helper)) applyEvent(transcript, event)
          expect(
            transcript.items.filter((item) => item.kind === 'notice').map((item) => item.text),
          ).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
        })
      }

      it('a give whose refused turn already answered something is not carried on', async () => {
        const { helper } = await given()
        says(codex.handles.at(-1)!, { type: 'assistant_delta', text: 'A partial answer.' })
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      async function waitingToCarryOn(): Promise<{ helper: string; release: () => void }> {
        const { helper } = await given()
        let release: (() => void) | null = null
        codex.asItStarts = () => {
          codex.asItStarts = () => {}
          codex.checksItsSignIn = () =>
            new Promise((resolve) => {
              release = () => resolve(false)
            })
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(release).not.toBeNull())
        return {
          helper,
          release: () => {
            codex.checksItsSignIn = async () => false
            if (release === null) throw new Error('the carry-on check never began')
            release()
          },
        }
      }

      it('a person stops it while the carry-on check waits: nothing is carried on', async () => {
        const { helper, release } = await waitingToCarryOn()
        await host.interrupt(helper, watching)
        release()
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      it('new personal words during the sign-in check replace the refused give', async () => {
        const { helper, release } = await waitingToCarryOn()
        codex.checksItsSignIn = async () => false
        await host.send(helper, 'A newer message.', watching)
        release()
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(2)
        expect(codex.sent[1]).toContain('A newer message.')
      })

      it('a quit while the carry-on check waits: nothing is carried on', async () => {
        const { release } = await waitingToCarryOn()
        const quit = host.closeAll()
        release()
        await quit
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      it('an agent note after an account change is not a give and is not carried on', async () => {
        aHelperHolding(DEAD)
        accept(DEAD, ANOTHER_ACCOUNT)
        const { sessionId: helper } = await start()
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        codex.turnModes.push('held-open')
        await host.queueMessage(
          helper,
          MESSAGE,
          { ownerId: agentCallerId(giver) },
          [],
          'work',
          {},
          'note',
        )
        switchAndRefuse()
        await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, ANOTHER_ACCOUNT)))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })
    })

    describe('its giver', () => {
      async function aBriefRefused(): Promise<{ giver: string; helper: string }> {
        aHelperHolding(DEAD)
        accept(DEAD)
        const { sessionId: helper } = await start()
        await host.close(helper, watching)
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        writeFileSync(machine, THE_COMPUTERS)
        accept(THE_COMPUTERS)
        codex.turnModes.push('refused')
        const given = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'farah',
            title: 'The open pull requests',
            brief: MESSAGE,
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!given.ok) throw new Error(`refused: ${given.refusal.rail}`)
        return { giver, helper: given.owner }
      }
      const toldOfItsWork = (giver: string): number =>
        rowsOf(giver).filter(
          (row) => (row.type === 'user_turn' || row.type === 'message_queued') && 'work' in row,
        ).length

      it('🔒 hears nothing when its helper carried on', async () => {
        const { giver, helper } = await aBriefRefused()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'completed']))
        await settled()
        expect(toldOfItsWork(giver)).toBe(0)
      })

      const SECOND = 'A second brief.'
      // Hold the chosen brief check to distinguish queued work from work already handed over.
      async function aSecondBriefAsItCarriesOn(
        held: 1 | 2,
      ): Promise<{ helper: string; letItGo: () => Promise<void> }> {
        let giver = ''
        let reopened = false
        let briefsCheck: (() => void) | null = null
        let second: Promise<unknown> | null = null
        codex.asItStarts = () => (reopened = starts.at(-1) === digestOf(THE_COMPUTERS))
        codex.checksItsSignIn = async () => {
          if (!reopened) return false
          reopened = false
          expect(giver).not.toBe('')
          let asked = 0
          codex.checksItsSignIn = () =>
            (asked += 1) === held
              ? new Promise((resolve) => (briefsCheck = () => resolve(false)))
              : Promise.resolve(false)
          second = host.giveWork(
            {
              definition_of_done: 'The requested result and its checks are recorded.',
              profile: 'farah',
              title: 'The release notes',
              brief: SECOND,
            },
            { ownerId: agentCallerId(giver) },
          )
          await vi.waitFor(() => expect(briefsCheck).not.toBeNull())
          codex.checksItsSignIn = async () => false
          return false
        }
        const { giver: theGiver, helper } = await aBriefRefused()
        giver = theGiver
        await vi.waitFor(() => expect(briefsCheck).not.toBeNull())
        await settled()
        return {
          helper,
          letItGo: async () => {
            briefsCheck!()
            await second
            await vi.waitFor(() =>
              expect(codex.sent.some((text) => text.includes(SECOND))).toBe(true),
            )
          },
        }
      }

      it('⛔ a second brief already on its way when its helper would carry on: nothing is carried on, the brief goes', async () => {
        const { letItGo } = await aSecondBriefAsItCarriesOn(2)
        expect(codex.carriedOn).toBe(0)
        await letItGo()
        expect(codex.carriedOn).toBe(0)
        expect(handedOver().filter((text) => text === MESSAGE)).toHaveLength(1)
      })

      it('⚑ a second brief not yet decided as its helper carries on waits behind that turn, as behind any turn', async () => {
        const { helper, letItGo } = await aSecondBriefAsItCarriesOn(1)
        expect(codex.carriedOn).toBe(1)
        await letItGo()
        await vi.waitFor(() =>
          expect(endingsOf(helper)).toEqual(['failed', 'completed', 'completed']),
        )
        expect(handedOver().filter((text) => text === MESSAGE)).toHaveLength(1)
        expect(codex.sent.filter((text) => text.includes(SECOND))).toHaveLength(1)
      })

      it('🔒 its helper’s carrying-on turn drives only the piece the refused brief gave, not an older one', async () => {
        aHelperHolding(DEAD)
        accept(DEAD)
        const { sessionId: first } = await start()
        await host.close(first, watching)
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        writeFileSync(machine, THE_COMPUTERS)
        accept(THE_COMPUTERS)
        codex.turnModes.push('held-open', 'refused')
        const older = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'farah',
            title: 'The release notes',
            brief: 'Draft the release notes.',
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!older.ok) throw new Error(`refused: ${older.refusal.rail}`)
        const refused = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'farah',
            title: 'The open pull requests',
            brief: MESSAGE,
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!refused.ok) throw new Error(`refused: ${refused.refusal.rail}`)
        expect(refused.owner).toBe(older.owner)
        codex.carryOnIsHeldOpen = true
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await settled()
        const pieceCalled = (title: string) =>
          derivePieces(older.owner, store.events(older.owner), { provider: 'codex' }).find(
            (row) => row.title === title,
          )
        const theOlder = pieceCalled('The release notes')
        expect(theOlder?.state).toBe('stalled')
        expect(ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[theOlder!.stalledBecause!]).toBe(true)
        expect(pieceCalled('The open pull requests')?.state).toBe('working')
      })

      it('⚑ is told when its helper could not carry on: the control above can see a telling', async () => {
        codex.cannotCarryOn = true
        const { giver } = await aBriefRefused()
        await vi.waitFor(() => expect(toldOfItsWork(giver)).toBeGreaterThan(0))
        expect(codex.carriedOn).toBe(0)
      })
    })
  })
})
