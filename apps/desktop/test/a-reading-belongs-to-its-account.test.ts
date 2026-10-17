import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle, type SessionAccount } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { providerUsageFile, readKeptUsage, writeKeptUsage } from '../src/main/provider-usage-file'
import {
  AN_ACCOUNT_ID,
  type KeptAccounts,
  providerAccountsFile,
  readKeptAccounts,
  writeKeptAccounts,
} from '../src/main/provider-accounts-file'
import { APP_STATE_FILES, NOT_STATE } from '../src/main/recovery/state-files'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # A usage reading belongs to the account it was read on
 *
 * Claude Code says which account a conversation is signed in to (`SessionHandle.account`); Codex's
 * sign-in tag is already of its account. Each reading the host keeps carries that account as an id
 * of the app's own, so a reading is never compared, warned about or shown against another account's.
 *
 *  - **§1 · the account decides before the login** — a login renewed on the same account keeps its
 *    readings, in one run and across a restart; another account's reading replaces them.
 *  - **§2 · account not known behaves as before** — the sign-in tag decides.
 *  - **§3 · a restart keeps the stamps.**
 *  - **§4 · the email stays in one file** — no log line, tool answer, window message or other file
 *    in the data folder carries it, and a recovery copy does not carry that file.
 *
 * ⚑ Fake readings and a made-up account only: no provider, credential or network is touched.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

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

const HOUR = 60 * 60_000
const WEEK = 7 * 24 * HOUR
const ONE = 'a1'.repeat(16)
const OTHER = 'b2'.repeat(16)
const EMAIL = 'canary.person@account.test'
const ORGANIZATION = 'Canary Organization Ltd'
const ACCOUNT_A: SessionAccount = { email: EMAIL, organization: ORGANIZATION }
const ACCOUNT_B: SessionAccount = { email: 'someone.else@account.test' }
/** The same email in another organization: another account. */
const ACCOUNT_A_AT_WORK: SessionAccount = { email: EMAIL, organization: 'Another Organization' }

describe('a usage reading belongs to the account it was read on', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  let handles: FakeSessionHandle[]
  let clock: number
  let counter = 0
  let lastSession = ''

  const keptAccounts = () => ({
    read: () => readKeptAccounts(providerAccountsFile(userData)),
    write: (accounts: KeptAccounts) => writeKeptAccounts(providerAccountsFile(userData), accounts),
  })
  const hostOn = (accountsKept = keptAccounts()): RuntimeHost => {
    const issued = new FakeProviderSessions()
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
      now: () => clock,
      usageKept: {
        read: () => readKeptUsage(providerUsageFile(userData)),
        write: (usage) => writeKeptUsage(providerUsageFile(userData), usage),
      },
      accountsKept,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-usage-account-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    handles = []
    clock = Date.UTC(2026, 9, 7, 21, 0)
    host = hostOn()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const pump = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  }
  /** A conversation launched on the sign-in tagged `tag`, whose provider names `account`. */
  const openOn = async (
    tag: string | null,
    account: SessionAccount | null | undefined,
    provider: Provider = 'claude',
  ): Promise<FakeSessionHandle> => {
    lastSession = (await host.createSession({ provider, cwd: userData }, window)).sessionId
    const handle = handles.at(-1)!
    Object.assign(handle, { signInTag: () => tag, account: () => account })
    return handle
  }
  const reading = async (
    handle: FakeSessionHandle,
    readings: { window: string; usedPercent: number | null; resetsAt: number | null }[],
  ): Promise<void> => {
    handle.simulateProviderUsage(readings)
    await pump()
  }
  const weekly = (usedPercent: number) => [
    { window: 'seven_day', usedPercent, resetsAt: clock + WEEK },
  ]
  const fiveHours = (usedPercent: number) => [
    { window: 'five_hour', usedPercent, resetsAt: clock + HOUR },
  ]
  const windows = (provider: Provider = 'claude') =>
    host.providerUsage()[provider].map((one) => one.window)
  const limits = () => host.limitsForAPerson().rows
  const keptReadings = (provider: Provider = 'claude') =>
    readKeptUsage(providerUsageFile(userData)).readings[provider]
  const restart = async (): Promise<void> => {
    await host.closeAll()
    clock += 25 * 60_000
    host = hostOn()
  }

  describe('§1 · the account decides before the login', () => {
    it('🔴 a later conversation on another account replaces what is held, and the earlier one’s figures are not taken', async () => {
      const earlier = await openOn(ONE, ACCOUNT_A)
      await reading(earlier, weekly(82))
      expect(limits()).toHaveLength(1)
      clock += 1_000
      await reading(await openOn(OTHER, ACCOUNT_B), fiveHours(3))
      const now = readKeptAccounts(providerAccountsFile(userData)).claude
      expect(now).toMatchObject({ email: ACCOUNT_B.email })
      expect(windows()).toEqual(['five_hour'])
      expect(limits()).toEqual([])
      await reading(earlier, weekly(83))
      expect(windows()).toEqual(['five_hour'])
      expect(limits()).toEqual([])
      // ⛔ …nor does it say the computer is back on the account before.
      expect(readKeptAccounts(providerAccountsFile(userData)).claude).toEqual(now)
    })

    it('🔴 a login renewed on the same account keeps the account’s readings, and they still warn', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      clock += 1_000
      await reading(await openOn(OTHER, ACCOUNT_A), fiveHours(10))
      expect(windows()).toEqual(['seven_day', 'five_hour'])
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
    })

    it('🔴 the same, across a restart: the renewed login confirms what the account’s last run kept', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      await restart()
      expect(limits()).toEqual([])
      await reading(await openOn(OTHER, ACCOUNT_A), fiveHours(10))
      expect(windows()).toEqual(['seven_day', 'five_hour'])
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
    })

    it('⛔ another account after a restart: what was kept goes, though nobody saw the sign-in move', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      await restart()
      await reading(await openOn(OTHER, ACCOUNT_B), fiveHours(3))
      expect(windows()).toEqual(['five_hour'])
      expect(limits()).toEqual([])
    })

    it('⛔ a figure another Codex account left out is not taken from this one’s reading', async () => {
      await reading(await openOn(ONE, undefined, 'codex'), [
        { window: 'a 7-day window', usedPercent: 30, resetsAt: clock + WEEK },
      ])
      clock += 1_000
      // A profile on another account names the same window, and not when it resets.
      await reading(await openOn(OTHER, undefined, 'codex'), [
        { window: 'a 7-day window', usedPercent: 3, resetsAt: null },
      ])
      expect(host.providerUsage().codex).toEqual([
        { window: 'a 7-day window', usedPercent: 3, resetsAt: null, at: clock },
      ])
      expect(keptReadings('codex')).toEqual([
        { window: 'a 7-day window', usedPercent: 3, resetsAt: null, at: clock, account: OTHER },
      ])
    })
  })

  describe('§1b · the Mac’s login found moved under readings of a known account', () => {
    /** An older conversation's turn gate found the Mac's login moved since `lifeSince`. */
    const theLoginMoved = (lifeSince: number): void => {
      ;(
        host as unknown as { aSignInChanged(provider: Provider, lifeSince: number): void }
      ).aSignInChanged('claude', lifeSince)
    }

    it('🔴 a renewal: they are held in doubt, warn no more, and the same account’s next reading confirms them', async () => {
      const startedAt = clock
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      clock += 60_000
      const renewed = await openOn(OTHER, ACCOUNT_A)
      theLoginMoved(startedAt)
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 82, unconfirmed: true }])
      expect(limits()).toEqual([])
      await reading(renewed, fiveHours(10))
      expect(windows()).toEqual(['seven_day', 'five_hour'])
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
    })

    it('⛔ a switch: the other account’s first reading clears them', async () => {
      const startedAt = clock
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      clock += 60_000
      const switched = await openOn(OTHER, ACCOUNT_B)
      theLoginMoved(startedAt)
      await reading(switched, fiveHours(3))
      expect(windows()).toEqual(['five_hour'])
      expect(limits()).toEqual([])
    })

    it('⛔ a login whose account is not said settles nothing in their favour: they go', async () => {
      const startedAt = clock
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      clock += 60_000
      const unsaid = await openOn(OTHER, null)
      theLoginMoved(startedAt)
      await reading(unsaid, fiveHours(3))
      expect(windows()).toEqual(['five_hour'])
    })

    it('⚑ readings of no known account are forgotten at once, as before there were accounts', async () => {
      const startedAt = clock
      await reading(await openOn(ONE, null), weekly(82))
      clock += 60_000
      theLoginMoved(startedAt)
      expect(host.providerUsage().claude).toEqual([])
    })
  })

  describe('§2 · account not known behaves as before', () => {
    it('⚑ the sign-in decides: the same one after a restart counts again, another one’s readings go', async () => {
      await reading(await openOn(ONE, null), weekly(82))
      await restart()
      await reading(await openOn(ONE, null), fiveHours(10))
      expect(windows()).toEqual(['seven_day', 'five_hour'])
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
      await restart()
      await reading(await openOn(OTHER, null), fiveHours(4))
      expect(windows()).toEqual(['five_hour'])
    })

    it('⚑ an account not yet said on the same login is that login’s, and the reading keeps its stamp', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      const id = keptReadings()[0]?.account
      expect(id).toMatch(AN_ACCOUNT_ID)
      // A second conversation on the same login, whose CLI has not answered yet.
      await reading(await openOn(ONE, undefined), [
        { window: 'seven_day', usedPercent: 84, resetsAt: null },
      ])
      expect(keptReadings()).toEqual([
        { window: 'seven_day', usedPercent: 84, resetsAt: clock + WEEK, at: clock, account: id },
      ])
    })

    it('⚑ a window first named before the account is said, on the same login, is the account’s', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      const id = keptReadings()[0]?.account
      await reading(await openOn(ONE, undefined), fiveHours(10))
      expect(keptReadings().map((one) => one.account)).toEqual([id, id])
    })

    it('⛔ a reading on a login nobody can name takes no account’s stamp', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      await reading(await openOn(null, null), [
        { window: 'seven_day', usedPercent: 84, resetsAt: null },
      ])
      expect(keptReadings()[0]).not.toHaveProperty('account')
    })

    it('⚑ no account is kept when no conversation named one', async () => {
      await reading(await openOn(ONE, null), weekly(82))
      expect(keptReadings()[0]).not.toHaveProperty('account')
      expect(readKeptAccounts(providerAccountsFile(userData))).toEqual({})
    })
  })

  describe('§3 · a restart keeps the stamps', () => {
    it('🔴 each kept reading names its account by an id of the app’s own, and the next run reads both back', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      const kept = readKeptAccounts(providerAccountsFile(userData)).claude
      expect(kept).toEqual({ id: expect.any(String), email: EMAIL, organization: ORGANIZATION })
      expect(kept?.id).toMatch(AN_ACCOUNT_ID)
      expect(keptReadings()).toMatchObject([{ window: 'seven_day', account: kept?.id }])
      await restart()
      expect(keptReadings()).toMatchObject([{ window: 'seven_day', account: kept?.id }])
      // The same account in the next run keeps the same id.
      await reading(await openOn(OTHER, ACCOUNT_A), fiveHours(10))
      expect(readKeptAccounts(providerAccountsFile(userData)).claude?.id).toBe(kept?.id)
      expect(keptReadings().map((one) => one.account)).toEqual([kept?.id, kept?.id])
    })

    it('⚑ another account gets another id, and so does the same email in another organization', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(10))
      const first = readKeptAccounts(providerAccountsFile(userData)).claude?.id
      clock += 1_000
      await reading(await openOn(OTHER, ACCOUNT_A_AT_WORK), weekly(12))
      const atWork = readKeptAccounts(providerAccountsFile(userData)).claude?.id
      expect(atWork).toMatch(AN_ACCOUNT_ID)
      expect(atWork).not.toBe(first)
      expect(windows()).toEqual(['seven_day'])
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 12 }])
    })
  })

  describe('§4 · the email stays in one file', () => {
    /** Every file under `folder`, as bytes. */
    const filesIn = (folder: string): { path: string; bytes: Buffer }[] =>
      readdirSync(folder).flatMap((name) => {
        const path = join(folder, name)
        return statSync(path).isDirectory()
          ? filesIn(path)
          : [{ path: relative(userData, path), bytes: readFileSync(path) }]
      })

    it('🔴 no log line, tool answer or window message carries it, and the data folder holds it in one file', async () => {
      const said: unknown[] = []
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          said.push(args)
        }),
      )
      try {
        const handle = await openOn(ONE, ACCOUNT_A)
        await reading(handle, weekly(82))
        await reading(await openOn(OTHER, ACCOUNT_A), fiveHours(10))
        const tool = agentToolsFor(host, lastSession).tools.find(
          (one) => one.name === 'list_profiles',
        )!
        const answer = await tool.call({})
        await restart()
        await reading(await openOn(OTHER, ACCOUNT_A), fiveHours(12))
        const shownToAll = JSON.stringify(host.providerUsage())
        await host.closeAll()
        // ⚑ Nor the id readings are stamped with: step 1 shows nothing new.
        const id = readKeptAccounts(providerAccountsFile(userData)).claude?.id
        expect(id).toMatch(AN_ACCOUNT_ID)
        for (const [what, words] of [
          ['the tool answer', JSON.stringify(answer)],
          ['the window', JSON.stringify(window.messages)],
          ['the usage the window and agents read', shownToAll],
          ['the log', JSON.stringify(said)],
        ] as const) {
          expect(words, what).not.toContain(EMAIL)
          expect(words, what).not.toContain(ORGANIZATION)
          expect(words, what).not.toContain(id)
        }
        const holding = filesIn(userData)
          .filter(({ bytes }) => bytes.includes(EMAIL) || bytes.includes(ORGANIZATION))
          .map(({ path }) => path)
        expect(holding).toEqual(['provider-accounts.json'])
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    })

    it('⛔ a write that fails says so without a word of what it held', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        await host.closeAll()
        host = hostOn({
          read: () => ({}),
          write: () => {
            throw new Error('the disk is full')
          },
        })
        await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
        expect(warned).toHaveBeenCalled()
        expect(JSON.stringify(warned.mock.calls)).not.toContain(EMAIL)
      } finally {
        warned.mockRestore()
      }
    })

    it('⛔ a recovery copy does not carry the file that holds it', () => {
      expect(APP_STATE_FILES.map((file) => file.name)).not.toContain('provider-accounts.json')
      expect(NOT_STATE.map((file) => file.name)).toContain('provider-accounts.json')
    })

    it('⚑ the id is not made from the email: the same account, named afresh, gets another id', async () => {
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      const first = readKeptAccounts(providerAccountsFile(userData)).claude?.id
      rmSync(providerAccountsFile(userData))
      rmSync(providerUsageFile(userData))
      await restart()
      await reading(await openOn(ONE, ACCOUNT_A), weekly(82))
      const second = readKeptAccounts(providerAccountsFile(userData)).claude?.id
      expect(second).toMatch(AN_ACCOUNT_ID)
      expect(second).not.toBe(first)
    })
  })
})
