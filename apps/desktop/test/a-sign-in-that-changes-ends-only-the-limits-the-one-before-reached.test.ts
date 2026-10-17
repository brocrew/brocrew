import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { resourcesRoot } from '../src/main/resources/resources'
import type { ProviderAuthOps } from '../src/main/runtime/provider-homes'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 13a0ab52 — a Claude sign-in that changes ends the limits the sign-in before reached, and ONLY those
 *
 * ⚑ The commit's own three tests (`a-usage-limit-is-named-and-waited-out.test.ts` §4) reach the
 * change through ONE door — a send refused for a moved sign-in — and only with walls recorded well
 * before it. This file pins what they leave open:
 *
 *  - §1 · the store: `providerLimitsSeen(now, signInChangedAt)` over a real SQLite ledger — the
 *    key is the PROVIDER (read off the wall's own sentence), a wall in the very instant of the
 *    change stays, and the drop happens BEFORE the fold.
 *  - §2 · the host, on §4's harness: the same-instant boundary through the host's own clock, and the
 *    gestures in this app — a key saved or removed, a re-copy, a sign-in — that do NOT end a wall,
 *    paired with the outside change that does.
 *  - §3 · the other door, `reopenOnARenewedSignIn`: a conversation killed by a sign-in renewed
 *    elsewhere ends the old walls and what waited goes — paired with a death on the same sign-in,
 *    and on a missing one, that end nothing.
 *
 * 🔒 Fake values only: a provider double, scripted SDK frames, a fake machine login (a plain test
 * string) and stubbed key and auth seams. Nothing reads `~/.claude`, a Keychain, or a real key.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A Claude wall as `normalize.ts` words a `rejected`. */
const claudeWall = (window: string, resetsAt: number): string =>
  `claude is rate-limited (${window}) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`
/** ⚑ A Claude approach as `normalize.ts` words an `allowed_warning`. */
const claudeApproach = (window: string, resetsAt: number): string =>
  `claude is approaching its rate limit (${window}); resets ${new Date(resetsAt).toISOString()}`
/** ⚑ A Codex wall as `codex/normalize.ts` words one. */
const codexWall = (resetsAt: number): string =>
  `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`

/** ⚑ A window: the one surface a person's words come through. */
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

/** ⛔ Bounded: four seconds, then a named failure — never a hang. */
const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const aMoment = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

describe('13a0ab52 · a sign-in that changes ends only the limits the sign-in before reached', () => {
  describe('§1 · the store: `providerLimitsSeen` with when each provider’s sign-in changed', () => {
    let dir: string
    let db: AppDatabase
    let store: SessionStore

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-signin-walls-store-'))
      db = openDatabase(join(dir, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
    })

    afterEach(() => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    /** ⚑ The instant the host saw the sign-in change. Fixed, so every boundary is exact. */
    const CHANGED = Date.UTC(2026, 9, 5, 9, 0)
    const NOW = CHANGED + 60_000
    const RESETS = CHANGED + 2 * 86_400_000

    let walls = 0
    /** ⚑ A wall recorded at an exact instant, in a conversation of its own. */
    function wallAt(
      said: string,
      at: number,
      recordedIn: { provider: Provider; profileId: string } = {
        provider: 'claude',
        profileId: 'default',
      },
    ): void {
      const id = `sess_wall_${String(++walls)}`
      store.create({ id, cwd: dir, approvalMode: 'ask', ...recordedIn })
      store.append(id, 0, { type: 'error', message: said, fatal: false }, at)
    }

    /** ⚑ What stands, as `provider:window`, sorted — the fold's key, so two rows are two walls. */
    const standing = (signInChangedAt?: ReadonlyMap<Provider, number>): string[] =>
      store
        .providerLimitsSeen(NOW, signInChangedAt)
        .rows.map((one) => `${one.provider}:${one.window}`)
        .sort()

    it('🔴 a wall a millisecond older than the change is dropped; one in the very same instant stays', () => {
      wallAt(claudeWall('five_hour', RESETS), CHANGED)
      wallAt(claudeWall('seven_day', RESETS), CHANGED - 1)
      expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
      expect(standing(new Map<Provider, number>([['claude', CHANGED]]))).toEqual([
        'claude:five_hour',
      ])
      // ⚑ A dropped wall is not an unreadable row, and the ledger count is still the query's.
      const walk = store.providerLimitsSeen(NOW, new Map<Provider, number>([['claude', CHANGED]]))
      expect(walk.rowsUnread).toBe(0)
      expect(walk.ledgers).toBe(2)
    })

    it('⛔ the key is the provider: another provider’s older wall is not dropped, either way round', () => {
      wallAt(claudeWall('seven_day', RESETS), CHANGED - 1)
      wallAt(codexWall(RESETS), CHANGED - 1, { provider: 'codex', profileId: 'default' })
      expect(standing(new Map<Provider, number>([['claude', CHANGED]]))).toEqual([
        'codex:rate_limit_reached',
      ])
      expect(standing(new Map<Provider, number>([['codex', CHANGED]]))).toEqual([
        'claude:seven_day',
      ])
      expect(
        standing(
          new Map<Provider, number>([
            ['claude', CHANGED],
            ['codex', CHANGED],
          ]),
        ),
      ).toEqual([])
    })

    it('⚑ the provider is the wall’s own, read off its sentence — not its conversation’s, and not divided by profile', () => {
      // ⚑ The map is keyed by provider alone (`ReadonlyMap<Provider, number>`): every Claude profile
      // runs on the Mac's one Keychain login, so a wall another profile recorded is the same
      // sign-in's, and the change ends it too.
      wallAt(claudeWall('five_hour', RESETS), CHANGED - 1, {
        provider: 'claude',
        profileId: 'work',
      })
      // ⚑ A Claude sentence in a Codex conversation is Claude's wall; a Codex sentence in a Claude
      // conversation is Codex's.
      wallAt(claudeWall('seven_day', RESETS), CHANGED - 1, {
        provider: 'codex',
        profileId: 'default',
      })
      wallAt(codexWall(RESETS), CHANGED - 1, { provider: 'claude', profileId: 'default' })
      expect(standing()).toEqual([
        'claude:five_hour',
        'claude:seven_day',
        'codex:rate_limit_reached',
      ])
      expect(standing(new Map<Provider, number>([['claude', CHANGED]]))).toEqual([
        'codex:rate_limit_reached',
      ])
    })

    it('🔴 a wall recorded after the change by a life that began before it is the login before’s', () => {
      const life = (id: string, launchedAt: number, wall: string, wallAt: number): void => {
        store.create({
          id,
          cwd: dir,
          approvalMode: 'ask',
          provider: 'claude',
          profileId: 'default',
        })
        store.append(id, 0, { type: 'launched' }, launchedAt)
        store.append(id, 1, { type: 'error', message: wall, fatal: false }, wallAt)
      }
      // ⚑ A turn started on the old login fails after the switch: its wall is the old account's.
      life('sess_old_life', CHANGED - 60_000, claudeWall('five_hour', RESETS), CHANGED + 1_000)
      // ⚑ A life that began after the change ran on the new login: its wall stands.
      life('sess_new_life', CHANGED + 500, claudeWall('seven_day', RESETS), CHANGED + 2_000)
      expect(standing()).toEqual(['claude:five_hour', 'claude:seven_day'])
      expect(standing(new Map<Provider, number>([['claude', CHANGED]]))).toEqual([
        'claude:seven_day',
      ])
      // ⚑ A ledger written before launch rows says no life: its wall is judged by its own time.
      wallAt(claudeWall('opus', RESETS), CHANGED + 3_000)
      expect(standing(new Map<Provider, number>([['claude', CHANGED]]))).toEqual([
        'claude:opus',
        'claude:seven_day',
      ])
    })

    it('⛔ no map, or an empty one: nothing is dropped', () => {
      wallAt(claudeWall('five_hour', RESETS), CHANGED - 1)
      wallAt(claudeWall('seven_day', RESETS), CHANGED - 3_600_000)
      wallAt(codexWall(RESETS), CHANGED - 1, { provider: 'codex', profileId: 'default' })
      const all = ['claude:five_hour', 'claude:seven_day', 'codex:rate_limit_reached']
      expect(standing()).toEqual(all)
      expect(standing(undefined)).toEqual(all)
      expect(standing(new Map<Provider, number>())).toEqual(all)
    })

    it('🔴 dropped BEFORE the fold: the old sign-in’s `stopped` no longer hides the new one’s `about-to-stop`', () => {
      wallAt(claudeWall('five_hour', RESETS), CHANGED - 1)
      wallAt(claudeApproach('seven_day', RESETS), CHANGED + 1)
      // ⛔ The control: with no change, the `stopped` wall outranks the approach and hides it.
      expect(store.providerLimitsSeen(NOW).rows.map((one) => one.standing)).toEqual(['stopped'])
      const rows = store.providerLimitsSeen(
        NOW,
        new Map<Provider, number>([['claude', CHANGED]]),
      ).rows
      expect(rows.map((one) => [one.window, one.standing])).toEqual([
        ['seven_day', 'about-to-stop'],
      ])
    })
  })

  describe('§2 · the host, on §4’s harness', () => {
    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let handles: FakeSessionHandle[]
    /** ⚑ The host's clock: real time, unless a test pins one instant. */
    let pinned: number | null
    /** 🔒 The keys a person "saved" — the moment, never a value. */
    let keys: Map<Provider, number>
    const window = new RecordingSink(sinkOwnerId({ id: 1 }))

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-signin-walls-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-signin-walls-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
      handles = []
      pinned = null
      keys = new Map()
      const issued = new FakeProviderSessions()
      let counter = 0
      const usable = { state: 'usable', login: 'account', expiresAt: null } as const
      // 🔒 The credential gestures, stubbed: nothing opens a browser or touches a provider home.
      const providerAuth: ProviderAuthOps = {
        credentialHome: (provider, profileId) =>
          join(userData, 'provider-homes', profileId, provider),
        check: async () => usable,
        reprovision: async () => 'replaced' as const,
        signIn: async () => ({
          authUrl: 'http://127.0.0.1:9/never-opened',
          completed: Promise.resolve({ success: true, state: usable }),
          cancel: async () => {},
        }),
        bringTheKeyToItsHomes: async () => null,
        replaceARefusedCopy: async () => 'not-tried',
      }
      host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        resourcesRoot: () => resourcesRoot(userData),
        createRuntime: (provider: Provider) =>
          new ProviderDouble(provider, handles, issued, anOpenGate()),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${String(++counter)}`,
        commandListWaitMs: 200,
        afterALimitResetsMs: 20,
        now: () => pinned ?? Date.now(),
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        providerAuth,
        // 🔒 A key store that keeps no key: `read` answers none, so every launch stays on the
        // (fake) login, and nothing here is a credential.
        apiKeys: {
          status: (provider) => ({
            provider,
            set: keys.has(provider),
            setAt: keys.get(provider) ?? null,
            inUse: keys.has(provider),
          }),
          set: (provider) => {
            keys.set(provider, Date.now())
            return null
          },
          remove: (provider) => keys.delete(provider),
          read: () => null,
        },
      })
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    })

    const turns = (id: string): string[] =>
      store
        .events(id)
        .flatMap((entry) => (entry.event.type === 'user_turn' ? [entry.event.text] : []))

    /** ⚑ A Claude conversation that has answered once and is idle, with its handle — before any wall. */
    async function anIdleConversationAndItsHandle(): Promise<{
      id: string
      handle: FakeSessionHandle
    }> {
      const { sessionId } = await host.createSession(
        { provider: 'claude', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.send(sessionId, 'the first thing', window)
      await waitFor(
        () => store.events(sessionId).some((entry) => entry.event.type === 'turn'),
        'the first turn to end',
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { id: sessionId, handle: handles.at(-1)! }
    }

    let walls = 0
    /** ⚑ A wall a conversation of its own recorded, at an exact instant. */
    function aWallAt(said: string, at: number, provider: Provider = 'claude'): void {
      const id = `sess_wall_${String(++walls)}`
      store.create({ id, provider, cwd: root, approvalMode: 'ask', profileId: 'default' })
      store.append(id, 0, { type: 'error', message: said, fatal: false }, at)
    }

    /** ⚑ §4's: the Mac's Claude sign-in moves on under these handles (`checkSignIn` says so). */
    function theSignInMovesOnUnder(...moved: FakeSessionHandle[]): void {
      for (const handle of moved) {
        Object.defineProperty(handle, 'checkSignIn', {
          value: async () => true,
          configurable: true,
        })
      }
    }

    const standing = (): string[] =>
      host
        .limitsForAPerson()
        .rows.map((one) => `${one.provider}:${one.window}`)
        .sort()

    it('🔴 through the host’s own clock: a wall in the very instant the sign-in changed stays, one a millisecond older is gone', async () => {
      const other = await anIdleConversationAndItsHandle()
      await aMoment()
      const changed = Date.now()
      const resets = changed + 60_000
      aWallAt(claudeWall('five_hour', resets), changed)
      aWallAt(claudeWall('seven_day', resets), changed - 1)
      aWallAt(codexWall(resets), changed - 1, 'codex')
      expect(standing()).toEqual([
        'claude:five_hour',
        'claude:seven_day',
        'codex:rate_limit_reached',
      ])
      // ⚑ The change is noted at the host's `now`, pinned to the instant the newest wall carries.
      pinned = changed
      theSignInMovesOnUnder(other.handle)
      // ⚑ A person's words on the moved sign-in: held for its reopen, and the change is noted as they are.
      await host.send(other.id, 'hello again', window)
      await aMoment()
      pinned = null
      // ⚑ The same instant stays (`wall.at < changed`, strictly); the older one is the sign-in
      // before's; Codex's is not Claude's sign-in at all.
      expect(standing()).toEqual(['claude:five_hour', 'codex:rate_limit_reached'])
    })

    it('⛔ a key saved or removed, a re-copy, a sign-in in this app: the walls still hold — the Mac’s login moving under a conversation ends them', async () => {
      const held = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      aWallAt(claudeWall('five_hour', Date.now() + 60_000), Date.now())
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      await aMoment()
      // ⚑ Every gesture that moves what Claude runs on from INSIDE this app
      // (`providerLoginChanged`): a conversation already running keeps the login it started with.
      expect((await host.setApiKey('claude', 'test-value-not-a-key')).refused).toBeUndefined()
      await host.removeApiKey('claude')
      expect(await host.reprovisionProviderAuth('claude', 'default')).toBe('replaced')
      expect((await host.signInProvider('claude', 'default')).success).toBe(true)
      await aMoment()
      expect(standing()).toEqual(['claude:five_hour'])
      expect(host.whyWhatIsHeldWaits(held.id)).toContain('Claude’s usage limit is reached')
      expect(turns(held.id)).toEqual(['the first thing'])
      // ⚑ The pair: the Mac's login moves under a running conversation — and the old wall ends.
      theSignInMovesOnUnder(held.handle, other.handle)
      // ⚑ A person's words on the moved sign-in: held for its reopen, and the change is noted as they are.
      await host.send(other.id, 'hello again', window)
      await waitFor(
        () => turns(held.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once the Mac’s sign-in changed',
      )
      expect(standing()).toEqual([])
    })
  })

  describe('§3 · the reopen door: a conversation killed by a sign-in renewed elsewhere', () => {
    /** ⚑ `a-conversation-reopens-on-a-renewed-sign-in.test.ts`' query double, as it is there. */
    class FakeQuery {
      private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
      private readonly buffer: SDKMessage[] = []
      private done = false

      emit(message: SDKMessage): void {
        if (this.resolve) {
          const resolve = this.resolve
          this.resolve = null
          resolve({ value: message, done: false })
          return
        }
        this.buffer.push(message)
      }

      end(): void {
        this.done = true
        if (this.resolve) {
          const resolve = this.resolve
          this.resolve = null
          resolve({ value: undefined as never, done: true })
        }
      }

      async interrupt(): Promise<void> {}
      async setPermissionMode(): Promise<void> {}
      close(): void {
        this.end()
      }

      [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
        return this.cli.over({
          next: (): Promise<IteratorResult<SDKMessage>> => {
            const queued = this.buffer.shift()
            if (queued) return Promise.resolve({ value: queued, done: false })
            if (this.done) return Promise.resolve({ value: undefined as never, done: true })
            return new Promise((resolve) => {
              this.resolve = resolve
            })
          },
        })
      }

      readonly cli = new TheCliAnswersInOrder()
    }

    const frame = (value: Record<string, unknown>): SDKMessage => value as unknown as SDKMessage
    const REVOKED = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

    let dir: string
    let cwd: string
    let db: AppDatabase
    let ledger: SessionStore
    let host: RuntimeHost
    /** ⚑ What the provider has "on disk": every id a `system/init` announced. */
    let announced: Set<string>
    let launches: { fq: FakeQuery; options: Options }[]
    /** 🔒 The fake machine login — a test string, or `null` for missing or expired. */
    let machineLogin: string | null
    const sink = new RecordingSink(sinkOwnerId({ id: 1 }))

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-signin-walls-door-'))
      cwd = join(dir, 'cwd')
      mkdirSync(cwd, { recursive: true })
      db = openDatabase(join(dir, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      ledger = createSessionStore(db)
      announced = new Set()
      launches = []
      machineLogin = 'test-token-at-launch'
      let counter = 0
      host = new RuntimeHost({
        store: ledger,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(dir, 'exports'),
        createRuntime: () =>
          new ClaudeRuntime(
            (params) => {
              const fq = new FakeQuery()
              launches.push({ fq, options: params.options })
              fq.cli.listen(params.prompt)
              return fq as never
            },
            async (sessionId) => announced.has(sessionId),
            () => machineLogin,
            async () => machineLogin,
          ),
        prepareProviderHome: (which) => {
          const home = join(dir, 'homes', which)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (which) => join(dir, 'homes', which),
        resolveCwd: () => cwd,
        newSessionId: () => `sess_door_${String(++counter)}`,
        readProviderConfig: (_which, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    const eventsOf = (sessionId: string): TranscriptEvent[] =>
      ledger.events(sessionId).map((entry) => entry.event)
    const turns = (sessionId: string): string[] =>
      eventsOf(sessionId).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

    /** ⚑ A Claude conversation one turn in and idle, on the login of its launch. */
    async function anIdleClaude(): Promise<{ id: string; fq: FakeQuery; providerId: string }> {
      const before = launches.length
      const { sessionId } = await host.createSession(
        { provider: 'claude', approvalMode: 'auto', cwd },
        sink,
      )
      await host.send(sessionId, 'the first thing', sink)
      await waitFor(() => launches.length === before + 1, 'its launch')
      const fq = launches[before]!.fq
      const providerId = `provider-${sessionId}`
      announced.add(providerId)
      fq.emit(frame({ type: 'system', subtype: 'init', session_id: providerId, cwd }))
      fq.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
      await waitFor(
        () => eventsOf(sessionId).some((event) => event.type === 'turn'),
        'the first turn to end',
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { id: sessionId, fq, providerId }
    }

    /**
     * ⚑ The measured shape (D-004): mid-turn, `change` runs as another Claude on the Mac renewing
     * does, then the CLI's `authentication_failed` kills the child (`auth_stale`).
     */
    async function killedMidTurn(
      killed: { id: string; fq: FakeQuery },
      change: () => void,
    ): Promise<void> {
      await host.send(killed.id, 'run the long job', sink)
      change()
      killed.fq.emit(
        frame({
          type: 'assistant',
          message: {
            role: 'assistant',
            model: '<synthetic>',
            content: [{ type: 'text', text: REVOKED }],
          },
          error: 'authentication_failed',
        }),
      )
      await waitFor(
        () =>
          eventsOf(killed.id).some((event) => event.type === 'status' && event.state === 'errored'),
        'the conversation to die on the revoked sign-in',
      )
    }

    /** ⚑ Two conversations, a wall after their turns, and the app's words held for it. */
    async function heldBehindAWall(): Promise<{
      killed: { id: string; fq: FakeQuery; providerId: string }
      held: { id: string; fq: FakeQuery; providerId: string }
    }> {
      const killed = await anIdleClaude()
      const held = await anIdleClaude()
      // ⚑ Recorded after both turns completed, so no completed turn retracts it.
      const id = 'sess_wall'
      ledger.create({ id, provider: 'claude', cwd, approvalMode: 'ask', profileId: 'default' })
      ledger.append(
        id,
        0,
        { type: 'error', message: claudeWall('five_hour', Date.now() + 60_000), fatal: false },
        Date.now(),
      )
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(held.id)).toContain('Claude’s usage limit is reached')
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      await aMoment()
      return { killed, held }
    }

    it('🔴 a renewed sign-in: the conversation it killed reopens on it, the old wall ends, and what waited goes at once', async () => {
      const { killed, held } = await heldBehindAWall()
      await killedMidTurn(killed, () => {
        machineLogin = 'test-token-renewed-elsewhere'
      })
      await waitFor(
        () =>
          eventsOf(killed.id).some(
            (event) => event.type === 'reopened' && event.because === 'the-sign-in-was-renewed',
          ),
        'the killed conversation to reopen on the renewed sign-in',
      )
      // ⚑ The door noted the change before it reopened: the wall the old sign-in reached is gone.
      expect(host.limitsForAPerson().rows).toEqual([])
      // ⚑ …and the words held for it go now — on the held conversation reopened on the new login —
      // not at the reset a minute out.
      await waitFor(
        () => turns(held.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once the sign-in was renewed',
      )
      expect(host.whyWhatIsHeldWaits(held.id)).toBeNull()
      expect(launches.some((one) => one.options.resume === killed.providerId)).toBe(true)
    })

    it('⛔ the pair — killed on the SAME sign-in: no reopen, the wall still holds, the words still wait', async () => {
      const { killed, held } = await heldBehindAWall()
      await killedMidTurn(killed, () => {})
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(launches).toHaveLength(2)
      expect(eventsOf(killed.id).some((event) => event.type === 'reopened')).toBe(false)
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      expect(host.whyWhatIsHeldWaits(held.id)).toContain('Claude’s usage limit is reached')
      expect(turns(held.id)).toEqual(['the first thing'])
    })

    it('⛔ killed with the sign-in missing or expired: nothing says it changed, and the wall still holds', async () => {
      const { killed, held } = await heldBehindAWall()
      await killedMidTurn(killed, () => {
        machineLogin = null
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(launches).toHaveLength(2)
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      expect(host.whyWhatIsHeldWaits(held.id)).toContain('Claude’s usage limit is reached')
      expect(turns(held.id)).toEqual(['the first thing'])
    })
  })
})
