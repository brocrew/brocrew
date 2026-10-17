import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { resourcesRoot } from '../src/main/resources/resources'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  readSignInChanges,
  SIGN_IN_CHANGES_FILE,
  signInChangesIn,
  writeSignInChanges,
} from '../src/main/sign-in-changes'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # F095 · W4.172's rest — the kept moment, the look, and the receipt
 *
 * ⚑ `a-usage-limit-is-named-and-waited-out.test.ts` §4 holds, notices a switch, keeps it across a
 * restart and says the receipt — on the 10-minute look, through the host, with one life asked.
 * What it does not reach:
 *
 *  - **§1 · the file of moments, read and written on its own** (`sign-in-changes.ts`). The host
 *    catches whatever the file does, so only a pure call sees it: a folder the write must not make,
 *    a temporary a failed write must not leave, a corrupt file read as no change without a throw,
 *    Codex's moment, and only a real moment taken.
 *  - **§2 · a moment set aside at the launch is dropped from the file too.** The ahead-of-clock
 *    case asserts only the rows; a launch that set it aside and left it in the file passed.
 *  - **§3 · the look asks only a life that could find a change.** ⛔ Not one older than the last
 *    change noted, ⛔ not one already marked moved, ⛔ and not once the quit has begun. Each was
 *    removable: the look still found the switch a look or two later, or the quit's own clearing hid
 *    it.
 *  - **§4 · the receipt says the look's own interval.** Every receipt assertion ran on the
 *    10-minute default, so a sentence that always said 10 minutes passed.
 *
 * ⛔ Fake values only: a provider double, no login; every data folder is a `mkdtemp` folder.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('F095 · W4.172’s rest', () => {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the file of moments
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the file of moments, on its own', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-sign-in-changes-'))
    })
    afterEach(() => {
      vi.restoreAllMocks()
      rmSync(dir, { recursive: true, force: true })
    })

    it('⛔ a write into a folder that is gone fails, and does not bring the folder back', () => {
      const gone = join(dir, 'gone')
      expect(() =>
        writeSignInChanges(
          join(gone, SIGN_IN_CHANGES_FILE),
          new Map<Provider, number>([['claude', 1]]),
        ),
      ).toThrow()
      expect(existsSync(gone)).toBe(false)
      // ⚑ The control: into a folder that is there, the same write goes and reads back.
      const file = join(dir, SIGN_IN_CHANGES_FILE)
      writeSignInChanges(file, new Map<Provider, number>([['claude', 1]]))
      expect(readSignInChanges(file).get('claude')).toBe(1)
    })

    it('⛔ a write whose rename fails leaves no temporary behind — one that goes leaves only the file', () => {
      // ⛔ A folder, with something in it, at the file's own name: the rename onto it fails.
      const file = join(dir, SIGN_IN_CHANGES_FILE)
      mkdirSync(file)
      writeFileSync(join(file, 'inside'), 'x')
      expect(() => writeSignInChanges(file, new Map<Provider, number>([['claude', 1]]))).toThrow()
      expect(readdirSync(dir)).toEqual([SIGN_IN_CHANGES_FILE])

      // ⚑ The control: with the way clear, the write goes, and nothing but the file is left.
      rmSync(file, { recursive: true, force: true })
      writeSignInChanges(file, new Map<Provider, number>([['claude', 1]]))
      expect(readdirSync(dir)).toEqual([SIGN_IN_CHANGES_FILE])
      expect(readSignInChanges(file).get('claude')).toBe(1)
    })

    it('⛔ a file that is not JSON is no change seen, said, and not thrown — a file not there is said by nothing', () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const file = join(dir, SIGN_IN_CHANGES_FILE)
      // ⚑ The control: no file is no change, and no sentence.
      expect(readSignInChanges(file).size).toBe(0)
      expect(warned).not.toHaveBeenCalled()

      writeFileSync(file, 'not json')
      expect(() => readSignInChanges(file)).not.toThrow()
      expect(readSignInChanges(file).size).toBe(0)
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('could not be read'))
    })

    it('🔴 Codex’s moment is kept and read, beside Claude’s', () => {
      const file = join(dir, SIGN_IN_CHANGES_FILE)
      writeSignInChanges(
        file,
        new Map<Provider, number>([
          ['claude', 1_700_000_000_000],
          ['codex', 1_700_000_001_234],
        ]),
      )
      const read = readSignInChanges(file)
      expect(read.get('codex')).toBe(1_700_000_001_234)
      expect(read.get('claude')).toBe(1_700_000_000_000)
    })

    it('⛔ only a real moment is taken: zero, a negative and a string are none — a positive number is one', () => {
      const file = join(dir, SIGN_IN_CHANGES_FILE)
      writeFileSync(
        file,
        JSON.stringify({ version: 1, changed: { claude: 0, codex: '1700000000000' } }),
      )
      expect(readSignInChanges(file).size).toBe(0)
      writeFileSync(file, JSON.stringify({ version: 1, changed: { claude: -5 } }))
      expect(readSignInChanges(file).size).toBe(0)
      // ⚑ The control: the same file with real moments reads both.
      writeFileSync(file, JSON.stringify({ version: 1, changed: { claude: 5, codex: 7 } }))
      const read = readSignInChanges(file)
      expect(read.get('claude')).toBe(5)
      expect(read.get('codex')).toBe(7)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2–§4 · on a host
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2–§4 · on a host', () => {
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

    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let handles: FakeSessionHandle[]
    let issued: FakeProviderSessions
    let counter = 0
    const window = new RecordingSink(sinkOwnerId({ id: 1 }))

    /** ⚑ This test's host on this test's store, the moments kept in its data folder. */
    function aHost(more: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}): RuntimeHost {
      return new RuntimeHost({
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
        signInChanges: signInChangesIn(userData),
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        ...more,
      })
    }

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-f095-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-f095-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
      handles = []
      issued = new FakeProviderSessions()
      counter = 0
      host = aHost()
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

    const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
      const deadline = Date.now() + 4_000
      while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    const aMoment = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

    /** ⚑ A Claude conversation that has answered once and is idle, with its provider's handle. */
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

    /** ⚑ A Claude conversation started and given nothing yet, with its provider's handle. */
    async function aConversationNotYetAnswered(): Promise<{
      id: string
      handle: FakeSessionHandle
    }> {
      const { sessionId } = await host.createSession(
        { provider: 'claude', approvalMode: 'auto', cwd: root },
        window,
      )
      return { id: sessionId, handle: handles.at(-1)! }
    }

    /** ⚑ A wall a conversation of its own recorded, as the adapter words it. */
    let walls = 0
    function anotherWall(said: string): void {
      const id = `sess_wall_${String(++walls)}`
      store.create({ id, provider: 'claude', cwd: root, approvalMode: 'ask', profileId: 'default' })
      store.append(id, 0, { type: 'error', message: said, fatal: false }, Date.now())
    }
    const claudeWall = (resetsAt: number): string =>
      `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${new Date(resetsAt).toISOString()}`

    /** ⚑ The Mac's Claude sign-in moves on under these handles: each `checkSignIn` says so. */
    function theSignInMovesOnUnder(...moved: FakeSessionHandle[]): void {
      for (const handle of moved) {
        Object.defineProperty(handle, 'checkSignIn', {
          value: async () => true,
          configurable: true,
        })
      }
    }

    /** ⚑ A handle whose sign-in reads as `reads` says, each ask counted. */
    function itsSignInReads(
      handle: FakeSessionHandle,
      reads: { moved: boolean; asked: number },
    ): void {
      Object.defineProperty(handle, 'checkSignIn', {
        value: async () => {
          reads.asked += 1
          return reads.moved
        },
        configurable: true,
      })
    }

    /**
     * ⚑ Every life this runtime starts or resumes reads the sign-in as `lives.reads` says AT ITS
     * START — so a test can begin one life on a sign-in that reads differently from the lives
     * before it, with no moment in which it reads as they do.
     */
    function eachLifeReadsAsItsStartSays(
      lives: { reads: { moved: boolean; asked: number } },
      runtime: ProviderDouble,
    ): ProviderDouble {
      const reading = (handle: FakeSessionHandle): FakeSessionHandle => {
        itsSignInReads(handle, lives.reads)
        return handle
      }
      const start = runtime.start.bind(runtime)
      const resume = runtime.resume.bind(runtime)
      runtime.start = async (options) => reading(await start(options))
      runtime.resume = async (ref, options) => reading(await resume(ref, options))
      return runtime
    }

    // ── §2 · the launch's read ─────────────────────────────────────────────────────────────

    it('⛔ §2 · a kept moment still ahead of the clock is set aside and dropped from the file — a moment behind it stays', async () => {
      await host.closeAll()
      const file = join(userData, SIGN_IN_CHANGES_FILE)
      const behind = Date.now() - 60_000
      writeSignInChanges(
        file,
        new Map<Provider, number>([
          ['claude', Date.now() + 86_400_000],
          ['codex', behind],
        ]),
      )
      anotherWall(claudeWall(Date.now() + 60_000))
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        host = aHost()
      } finally {
        warned.mockRestore()
      }
      // ⚑ Set aside: the wall holds.
      expect(host.limitsForAPerson().rows).toHaveLength(1)
      // ⛔ …and gone from the file, so the next launch does not set it aside again forever.
      const kept = readSignInChanges(file)
      expect(kept.has('claude')).toBe(false)
      // ⚑ The control: the file was rewritten, not emptied — the moment behind the clock is kept.
      expect(kept.get('codex')).toBe(behind)
    })

    // ── §3 · whom the look asks ────────────────────────────────────────────────────────────

    it('⛔ §3 · the look never asks a life older than the last change noted — it asks the newer one, which finds the switch', async () => {
      await host.closeAll()
      host = aHost({ lookAtTheLimitAgainMs: 60 })
      // ⚑ A and B begin on the first sign-in; the switch is reported by B, and noted.
      const a = await anIdleConversationAndItsHandle()
      const b = await anIdleConversationAndItsHandle()
      // ⚑ A holds the sign-in before too, and would say so — every ask of it counted.
      const aReads = { moved: true, asked: 0 }
      itsSignInReads(a.handle, aReads)
      // ⚑ Work in the background holds the reopen a person's words would make, so this send only
      // reports the switch: nothing goes in on it.
      b.handle.simulateBackgroundWork()
      theSignInMovesOnUnder(b.handle)
      await host.send(b.id, 'hello again', window)
      await aMoment()
      // ⚑ C begins on the new sign-in, which then reaches a limit; the app's words for C wait.
      const c = await anIdleConversationAndItsHandle()
      await aMoment()
      anotherWall(claudeWall(Date.now() + 60_000))
      expect(
        (await host.queueMessage(c.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      expect(host.whyWhatIsHeldWaits(c.id)).toContain('Claude’s usage limit is reached')
      // ⚠️ Not reset here: nothing in this app asks A at all — its mailbox is empty, so no flush
      // does — so every ask counted from the switch on is a look's.

      // ⚑ The sign-in moves again, under C, and nobody sends anything: a look finds it…
      theSignInMovesOnUnder(c.handle)
      await waitFor(
        () => turns(c.id).some((text) => text.includes('the app has news for it')),
        'the held words to go once a look found the switch under C',
      )
      // ⛔ …and never asked A, which could only have reported the change already noted.
      expect(aReads.asked).toBe(0)
    })

    it('⛔ §3 · the look never asks a life already marked moved — so a newer life is asked, and its switch is found', async () => {
      const shared = { moved: false, asked: 0 }
      const lives = { reads: shared }
      const hours = (count: number): number => count * 3_600_000
      await host.closeAll()
      host = aHost({
        lookAtTheLimitAgainMs: 60,
        createRuntime: (provider: Provider) =>
          eachLifeReadsAsItsStartSays(
            lives,
            new ProviderDouble(provider, handles, issued, anOpenGate()),
          ),
      })
      // ⚑ The loop guard's case (`a-usage-limit-is-named-and-waited-out.test.ts`): a change is
      // noted, a limit is reached after it, and `held` is reopened for what waits — and its new
      // life reads as moved at once, so it is marked moved with no change noted.
      const held = await anIdleConversationAndItsHandle()
      const other = await anIdleConversationAndItsHandle()
      // ⚑ Work in the background holds the reopen a person's words would make, so this send only
      // reports the switch: nothing goes in on it.
      other.handle.simulateBackgroundWork()
      shared.moved = true
      await host.send(other.id, 'hello again', window)
      await aMoment()
      anotherWall(claudeWall(Date.now() + hours(5)))
      await aMoment()
      expect(
        (await host.queueMessage(held.id, 'the app has news for it', THE_APP_ITSELF)).outcome,
      ).toBe('queued')
      await waitFor(
        () => store.events(held.id).some((entry) => entry.event.type === 'reopened'),
        'the reopen',
      )
      await waitFor(
        () => (host.whyWhatIsHeldWaits(held.id) ?? '').includes('moments ago'),
        'the loop guard to hold it',
      )
      expect(host.limitsForAPerson().rows).toHaveLength(1)

      // ⚑ D begins after all that, on a sign-in that reads as current.
      const dReads = { moved: false, asked: 0 }
      lives.reads = dReads
      await aConversationNotYetAnswered()
      dReads.asked = 0
      // ⚑ The control: the looks ask D — the newest life, not the older one marked moved — and
      // while it reads as current nothing changes.
      await waitFor(() => dReads.asked >= 2, 'the looks to ask D')
      expect(host.limitsForAPerson().rows).toHaveLength(1)

      // 🔴 The sign-in moves under D: the next look finds it, and the old limit stops holding.
      dReads.moved = true
      await waitFor(
        () => host.limitsForAPerson().rows.length === 0,
        'a look to find the switch under D',
      )
    })

    it('⛔ §3 · once the quit has begun, a look asks no conversation — before it, the same look does', async () => {
      const { handle } = await aConversationNotYetAnswered()
      const reads = { moved: false, asked: 0 }
      itsSignInReads(handle, reads)
      const inside = host as unknown as {
        noticeAMovedSignIn(provider: Provider): Promise<void>
        launches: { closeAdmission(): void }
      }
      // ⚑ The control: a look asks the one running conversation.
      await inside.noticeAMovedSignIn('claude')
      expect(reads.asked).toBe(1)
      // ⛔ The quit begins (its first line, `closeAll`'s): the same look asks nothing.
      inside.launches.closeAdmission()
      await inside.noticeAMovedSignIn('claude')
      expect(reads.asked).toBe(1)
    })

    // ── §4 · the receipt ───────────────────────────────────────────────────────────────────

    /** ⚑ What the receipt says for the app's words held at a limit, on a host looking every `ms`. */
    async function theReceiptOnALookOf(ms: number): Promise<string> {
      await host.closeAll()
      host = aHost({ lookAtTheLimitAgainMs: ms })
      const { id } = await anIdleConversationAndItsHandle()
      anotherWall(claudeWall(Date.now() + 60_000))
      expect((await host.queueMessage(id, 'the app has news for it', THE_APP_ITSELF)).outcome).toBe(
        'queued',
      )
      return host.whyWhatIsHeldWaits(id) ?? ''
    }

    it('🔴 §4 · the receipt says the look’s own interval: every minute, in the singular, on a look of 60 ms', async () => {
      const said = await theReceiptOnALookOf(60)
      expect(said).toContain(
        'which it asks at least every 1 minute while something waits; and within 1 minute when a Claude conversation here completes a turn.',
      )
      expect(said).not.toContain('10 minutes')
    })

    it('🔴 §4 · …and rounded up to whole minutes: a look of 130 seconds is said as 3 minutes', async () => {
      const said = await theReceiptOnALookOf(130_000)
      expect(said).toContain(
        'which it asks at least every 3 minutes while something waits; and within 3 minutes when a Claude conversation here completes a turn.',
      )
      expect(said).not.toContain('10 minutes')
    })
  })
})
