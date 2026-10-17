import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, MAX_USAGE_WINDOWS, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  NO_USAGE_KEPT,
  providerUsageFile,
  readKeptUsage,
  writeKeptUsage,
} from '../src/main/provider-usage-file'
import {
  USAGE_NEARS_ITS_LIMIT_AT,
  providerConditions,
  readProviderLimit,
  wallsFromUsage,
} from '../src/shared/provider-limit'
import { readingSays, usageSays } from '../src/renderer/src/lib/usage-limit'
import type { ProviderUsageReading, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # F096 · each provider's usage is kept, told to agents, and warned about near its limit
 *
 * Keep provider usage readings across restarts, expose them to agents and warn when a window
 * passes 80%, so a caller can stop work before reaching the account's limit.
 *
 *  - **§1 · the file** — `<userData>/provider-usage.json`, one reading per provider and window,
 *    checked as it is read.
 *  - **§2 · the host keeps it** — written when a number moves, read again by the next host, and
 *    forgotten when what the provider runs on changes, in this app or on the Mac.
 *  - **§3 · agents read it** — `list_profiles` without a profile carries each provider's readings.
 *  - **§4 · the person is told** — a window at or past 80% is a wall about to stop in the one band
 *    of limits, beside the walls the providers reported.
 *  - **§6 · a reading belongs to the sign-in it was read on** — one kept across a restart is shown
 *    and raises no warning until a conversation reports again: on the same sign-in it counts
 *    again, on another it goes. Within one run, a later conversation on another sign-in replaces
 *    what is held.
 *
 * ⚑ Fake readings only: no provider, credential or network is touched.
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

const WEEK = 7 * 24 * 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the file
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the readings file', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-usage-file-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('🔴 what is written is read back, per provider and window, with the windows seen', () => {
    const file = providerUsageFile(dir)
    expect(file).toBe(join(dir, 'provider-usage.json'))
    const usage = {
      readings: {
        claude: [
          { window: 'seven_day', usedPercent: 34, resetsAt: 2_000_000, at: 1_000 },
          { window: 'five_hour', usedPercent: null, resetsAt: null, at: 1_000 },
        ],
        codex: [{ window: 'a 7-day window', usedPercent: 12.5, resetsAt: 3_000_000, at: 2_000 }],
      },
      seen: {
        claude: [
          { window: 'seven_day', first: 500, last: 1_000 },
          { window: 'five_hour', first: 400, last: 1_000 },
        ],
        codex: [],
      },
    }
    writeKeptUsage(file, usage)
    expect(readKeptUsage(file)).toEqual(usage)
  })

  it('⛔ a missing file, one that is not JSON, and rows that are not readings read as none', () => {
    const file = providerUsageFile(dir)
    expect(readKeptUsage(file)).toEqual(NO_USAGE_KEPT)
    writeFileSync(file, 'not json')
    expect(readKeptUsage(file)).toEqual(NO_USAGE_KEPT)
    writeFileSync(
      file,
      JSON.stringify({
        readings: {
          claude: [
            { window: 'seven_day', usedPercent: 34, resetsAt: 2_000_000, at: 1_000 },
            { window: '', usedPercent: 1, resetsAt: null, at: 1 },
            { window: 'x', usedPercent: -1, resetsAt: null, at: 1 },
            { window: 'y', usedPercent: 1, resetsAt: 'soon', at: 1 },
            { window: 'z', usedPercent: 1, resetsAt: null, at: 0 },
            // ⛔ a time no date can hold: saying it would throw where the band and card say it
            { window: 'far', usedPercent: 99, resetsAt: 9e15, at: 1 },
            { window: 'seven_day', usedPercent: 99, resetsAt: null, at: 5 },
          ],
          codex: 'nothing',
          gemini: [{ window: 'w', usedPercent: 1, resetsAt: null, at: 1 }],
        },
        seen: {
          claude: [
            { window: 'seven_day', first: 1, last: 2 },
            { window: 'backwards', first: 2, last: 1 },
            { window: 'no-time', first: 0, last: 1 },
          ],
          codex: [{ window: '', first: 1, last: 1 }],
        },
      }),
    )
    expect(readKeptUsage(file)).toEqual({
      readings: {
        claude: [{ window: 'seven_day', usedPercent: 34, resetsAt: 2_000_000, at: 1_000 }],
        codex: [],
      },
      seen: { claude: [{ window: 'seven_day', first: 1, last: 2 }], codex: [] },
    })
  })

  it('⛔ no more than sixteen windows a provider are read', () => {
    const file = providerUsageFile(dir)
    writeFileSync(
      file,
      JSON.stringify({
        readings: {
          claude: Array.from({ length: MAX_USAGE_WINDOWS + 4 }, (_, i) => ({
            window: `w${String(i)}`,
            usedPercent: i,
            resetsAt: null,
            at: 1,
          })),
        },
      }),
    )
    expect(readKeptUsage(file).readings.claude).toHaveLength(MAX_USAGE_WINDOWS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2–§4 · on a real host
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2–§4 · on a host', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  let handles: FakeSessionHandle[]
  let clock: number
  let writes: number
  let counter = 0

  const hostOn = (): RuntimeHost => {
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
        write: (usage) => {
          writes += 1
          writeKeptUsage(providerUsageFile(userData), usage)
        },
      },
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-usage-host-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    handles = []
    clock = Date.UTC(2026, 9, 5, 2, 11)
    writes = 0
    host = hostOn()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (provider: Provider = 'claude'): Promise<FakeSessionHandle> => {
    await host.createSession({ provider, cwd: userData }, window)
    return handles.at(-1)!
  }
  const pump = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const reading = async (
    handle: FakeSessionHandle,
    readings: { window: string; usedPercent: number | null; resetsAt: number | null }[],
  ): Promise<void> => {
    handle.simulateProviderUsage(readings)
    await pump()
  }
  const kept = () => readKeptUsage(providerUsageFile(userData)).readings
  const keptSeen = () => readKeptUsage(providerUsageFile(userData)).seen

  describe('§2 · the host keeps the readings across a restart', () => {
    it('🔴 a reading is written when it arrives, and the next host starts with it', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }])
      expect(kept().claude).toEqual([
        { window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK, at: clock },
      ])
      await host.closeAll()

      // ⚑ The restart: a new host over the same data folder. The reading is there with its moment,
      // and marked: no conversation of this run has said whose sign-in it is yet (§6).
      const restarted = hostOn()
      try {
        expect(restarted.providerUsage()).toEqual({
          claude: [
            {
              window: 'seven_day',
              usedPercent: 11,
              resetsAt: clock + WEEK,
              at: clock,
              unconfirmed: true,
            },
          ],
          codex: [],
        })
      } finally {
        await restarted.closeAll()
      }
    })

    it('⚑ a frame that says the same again writes nothing; one that moves a number writes once', async () => {
      const handle = await open()
      const same = [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }]
      await reading(handle, same)
      await reading(handle, same)
      expect(writes).toBe(1)
      await reading(handle, [{ window: 'seven_day', usedPercent: 12, resetsAt: clock + WEEK }])
      expect(writes).toBe(2)
      expect(kept().claude[0]?.usedPercent).toBe(12)
    })

    it('⚑ the quit keeps each reading with the moment it was last received', async () => {
      const handle = await open()
      const same = [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }]
      await reading(handle, same)
      const first = clock
      clock += 60_000
      await reading(handle, same)
      expect(kept().claude[0]?.at).toBe(first)
      await host.closeAll()
      expect(kept().claude[0]?.at).toBe(first + 60_000)
    })

    it('🔴 what the provider runs on changing in this app forgets its readings, in the file too', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }])
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      expect(host.providerUsage().claude).toEqual([])
      expect(kept().claude).toEqual([])
    })

    it('🔴 the Mac’s Claude sign-in moving forgets Claude’s readings, and leaves Codex’s', async () => {
      const before = clock
      const claude = await open('claude')
      const codex = await open('codex')
      await reading(claude, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }])
      await reading(codex, [{ window: 'a 7-day window', usedPercent: 40, resetsAt: clock + WEEK }])
      // ⚑ The sign-in moves; a life starts on the new one; only then does the old life report it.
      clock += 1_000
      const newer = await open('claude')
      clock += 1_000
      ;(
        host as unknown as { aSignInChanged(provider: Provider, lifeSince: number): void }
      ).aSignInChanged('claude', before)
      expect(host.providerUsage().claude).toEqual([])
      expect(host.providerUsage().codex).toHaveLength(1)
      expect(kept()).toMatchObject({ claude: [], codex: [{ window: 'a 7-day window' }] })

      // ⛔ A turn still running on the account before says that account's figures: not kept.
      await reading(claude, [{ window: 'seven_day', usedPercent: 90, resetsAt: clock + WEEK }])
      expect(host.providerUsage().claude).toEqual([])
      expect(kept().claude).toEqual([])
      // ⚑ A life that began on the new sign-in — before this app noticed — is the account now.
      await reading(newer, [{ window: 'seven_day', usedPercent: 3, resetsAt: clock + WEEK }])
      expect(kept().claude).toEqual([
        { window: 'seven_day', usedPercent: 3, resetsAt: clock + WEEK, at: clock },
      ])
    })

    it('⚑ a file that cannot be read starts the host with none, and the host runs on', () => {
      writeFileSync(providerUsageFile(userData), '{ torn')
      const fresh = hostOn()
      expect(fresh.providerUsage()).toEqual({ claude: [], codex: [] })
      void fresh.closeAll()
    })
  })

  describe('§3 · agents read it from list_profiles', () => {
    it('🔴 each provider’s readings, in the payload and in words: used, resets, read at', async () => {
      const handle = await open()
      const me = (await host.createSession({ provider: 'claude', cwd: userData }, window)).sessionId
      const resets = clock + 4 * 24 * 60 * 60 * 1000
      await reading(handle, [
        { window: 'seven_day', usedPercent: 34, resetsAt: resets },
        { window: 'five_hour', usedPercent: 12.4, resetsAt: clock - 1 },
        { window: 'seven_day_opus', usedPercent: null, resetsAt: clock - 1 },
      ])
      const tool = agentToolsFor(host, me).tools.find((one) => one.name === 'list_profiles')!
      const said = await tool.call({})
      const usage = (said.structured as { provider_usage: Record<string, unknown[]> })
        .provider_usage
      expect(usage['codex']).toEqual([])
      expect(usage['claude']).toEqual([
        expect.objectContaining({
          window: 'seven_day',
          limit: 'weekly',
          used_percent: 34,
          reset_since: false,
        }),
        expect.objectContaining({
          window: 'five_hour',
          limit: '5-hour',
          used_percent: 12.4,
          resets_at: expect.any(String),
          reset_since: true,
        }),
        expect.objectContaining({
          window: 'seven_day_opus',
          limit: 'weekly Opus',
          used_percent: null,
          reset_since: true,
        }),
      ])
      const line = said.text
        .split('\n')
        .find((one) => one.startsWith('Claude’s usage') || one.startsWith("Claude's usage"))
      expect(line).toMatch(/^Claude's usage, by its latest readings: weekly 34% used, resets at /)
      expect(line).toContain('5-hour was 12% used before its window reset (read at ')
      expect(line).toContain(
        'weekly Opus: how much was used was not said, and its window has reset since (read at ',
      )
      expect(line).toContain('(read at ')
      expect(said.text).toContain("Codex's usage: no reading yet — it arrives with its next turn.")
    })

    it('⚑ a Codex bucket is named with its window, so a cap on the account’s own is not misread', async () => {
      const handle = await open('codex')
      const me = (await host.createSession({ provider: 'claude', cwd: userData }, window)).sessionId
      await reading(handle, [
        { window: 'a 7-day window', usedPercent: 10, resetsAt: clock + WEEK },
        { window: 'a 7-day window (GPT-5.3-Codex-Spark)', usedPercent: 92, resetsAt: clock + WEEK },
      ])
      const tool = agentToolsFor(host, me).tools.find((one) => one.name === 'list_profiles')!
      const said = await tool.call({})
      expect(said.text).toMatch(
        /Codex's usage, by its latest readings: weekly 10% used, .*; weekly \(GPT-5\.3-Codex-Spark\) 92% used, /,
      )
      const usage = (said.structured as { provider_usage: Record<string, { limit?: string }[]> })
        .provider_usage
      expect(usage['codex']?.map((one) => one.limit)).toEqual([
        'weekly',
        'weekly (GPT-5.3-Codex-Spark)',
      ])
    })
  })

  describe('§4 · the person is told when a window nears its limit', () => {
    const limits = () => host.limitsForAPerson().rows

    it(`🔴 at ${String(USAGE_NEARS_ITS_LIMIT_AT)}% of Claude’s weekly window: a wall about to stop, said as the band says one`, async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 79, resetsAt: clock + WEEK }])
      expect(limits()).toEqual([])
      await reading(handle, [{ window: 'seven_day', usedPercent: 82, resetsAt: clock + WEEK }])
      const [wall] = limits()
      expect(wall).toMatchObject({
        provider: 'claude',
        window: 'seven_day',
        standing: 'about-to-stop',
        resetsAt: clock + WEEK,
      })
      expect(wall?.said).toBe(
        `claude is approaching its rate limit (seven_day) — 82% used, by its latest reading; resets ${new Date(clock + WEEK).toISOString()}`,
      )
      const [condition] = providerConditions(limits(), clock)
      expect(usageSays(condition!, clock)).toMatch(
        /^Claude is near its weekly limit \(82% used\); it resets /,
      )
    })

    it('🔴 Codex’s 7-day window at 90%: the same, in its own words', async () => {
      const handle = await open('codex')
      await reading(handle, [{ window: 'a 7-day window', usedPercent: 90, resetsAt: clock + WEEK }])
      const [wall] = limits()
      expect(wall).toMatchObject({ provider: 'codex', window: 'a 7-day window' })
      expect(
        wall?.said.startsWith(
          'codex is approaching its rate limit — 90% of a 7-day window used, by its latest reading',
        ),
      ).toBe(true)
      const [condition] = providerConditions(limits(), clock)
      expect(usageSays(condition!, clock)).toMatch(/^Codex is near its weekly limit \(90% used\);/)
    })

    it('⛔ a reading whose window has reset since is not a warning', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 95, resetsAt: clock - 1 }])
      expect(limits()).toEqual([])
    })

    it('⛔ a provider that reported work stopped keeps only its own wall', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 95, resetsAt: clock + WEEK }])
      handle.simulateError(
        `claude is rate-limited (five_hour) — the turn may stall until it resets; resets ${new Date(clock + 60_000).toISOString()}`,
        false,
      )
      await pump()
      const rows = limits()
      expect(rows.map((one) => one.standing)).toEqual(['stopped'])
      expect(rows[0]?.window).toBe('five_hour')
    })

    it('⚑ the pure rule: a window the provider’s own wall names keeps the provider’s line', () => {
      const providers: ProviderUsageReading[] = [
        { window: 'seven_day', usedPercent: 92, resetsAt: clock + WEEK, at: clock },
      ]
      const theirs = {
        provider: 'claude' as const,
        window: 'seven_day',
        standing: 'about-to-stop' as const,
        resetsAt: clock + WEEK,
        said: 'claude is approaching its rate limit (seven_day); resets x',
        at: clock,
      }
      expect(wallsFromUsage({ claude: providers }, [theirs], clock)).toEqual([])
      expect(wallsFromUsage({ claude: providers }, [], clock)).toHaveLength(1)
    })

    it('⛔ a Codex bucket’s window makes no warning: the band’s sentence could not name it', () => {
      const bucket: ProviderUsageReading[] = [
        {
          window: 'a 7-day window (GPT-5.3-Codex-Spark)',
          usedPercent: 92,
          resetsAt: clock + WEEK,
          at: clock,
        },
      ]
      expect(wallsFromUsage({ codex: bucket }, [], clock)).toEqual([])
    })

    it('⚑ Codex’s two slots of a length it did not say are one wall, from the fuller', () => {
      const slots: ProviderUsageReading[] = [
        { window: 'its primary window', usedPercent: 95, resetsAt: clock + WEEK, at: clock },
        { window: 'its secondary window', usedPercent: 82, resetsAt: clock + WEEK, at: clock },
      ]
      const walls = wallsFromUsage({ codex: slots }, [], clock)
      expect(walls).toHaveLength(1)
      expect(walls[0]?.said).toContain('95% of this window used')
    })

    it('⚑ a Codex window of a length it did not say is keyed as Codex’s own warning keys it', () => {
      const slot: ProviderUsageReading[] = [
        { window: 'its primary window', usedPercent: 92, resetsAt: clock + WEEK, at: clock },
      ]
      const [ours] = wallsFromUsage({ codex: slot }, [], clock)
      expect(ours?.window).toBe('this window')
      const theirs = readProviderLimit(
        `codex is approaching its rate limit — 95% of this window used; resets ${new Date(clock + WEEK).toISOString()}`,
        clock,
      )!
      expect(wallsFromUsage({ codex: slot }, [theirs], clock)).toEqual([])
    })

    it('⛔ the card says a reading whose window has reset since in the past', () => {
      const reading = {
        window: 'seven_day',
        usedPercent: 95,
        resetsAt: clock - WEEK,
        at: clock - WEEK - 1,
      }
      // The reset is said relative to now, in the past once it has passed.
      expect(readingSays(reading, clock)).toBe('Weekly limit: was 95% used; it reset 7 days ago.')
      expect(readingSays({ ...reading, resetsAt: clock + WEEK }, clock)).toBe(
        'Weekly limit: 95% used; it resets in 7 days.',
      )
    })
  })

  it('⚑ the file is what the host wrote, as JSON a person can read', async () => {
    const handle = await open()
    await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }])
    expect(JSON.parse(readFileSync(providerUsageFile(userData), 'utf8'))).toEqual({
      readings: {
        claude: [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK, at: clock }],
        codex: [],
      },
      seen: { claude: [{ window: 'seven_day', first: clock, last: clock }], codex: [] },
    })
  })

  describe('§5 · which windows arrive, and when — kept through a forget and a restart', () => {
    it('🔴 each window a frame names is noted first and last, and a login change keeps the note', async () => {
      const handle = await open()
      const first = clock
      await reading(handle, [{ window: 'five_hour', usedPercent: 3, resetsAt: clock + 60_000 }])
      clock += 60_000
      await reading(handle, [
        { window: 'five_hour', usedPercent: 3, resetsAt: first + 60_000 },
        { window: 'seven_day', usedPercent: 40, resetsAt: clock + WEEK },
      ])
      expect(host.usageWindowsSeen().claude).toEqual([
        { window: 'five_hour', first, last: clock },
        { window: 'seven_day', first: clock, last: clock },
      ])
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      expect(host.providerUsage().claude).toEqual([])
      expect(keptSeen().claude.map((one) => one.window)).toEqual(['five_hour', 'seven_day'])

      await host.closeAll()
      const restarted = hostOn()
      try {
        expect(restarted.usageWindowsSeen().claude).toEqual([
          { window: 'five_hour', first, last: clock },
          { window: 'seven_day', first: clock, last: clock },
        ])
      } finally {
        await restarted.closeAll()
      }
    })

    it('⚑ a life on an older login still says which windows arrive, though not its figures', async () => {
      const handle = await open()
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      await reading(handle, [{ window: 'seven_day', usedPercent: 40, resetsAt: clock + WEEK }])
      expect(host.providerUsage().claude).toEqual([])
      expect(keptSeen().claude).toEqual([{ window: 'seven_day', first: clock, last: clock }])
    })

    it('⚑ a clock set back keeps first the earliest sight and last the latest', async () => {
      const handle = await open()
      const at = clock
      await reading(handle, [{ window: 'seven_day', usedPercent: 40, resetsAt: at + WEEK }])
      clock = at - 60_000
      await reading(handle, [{ window: 'seven_day', usedPercent: 41, resetsAt: at + WEEK }])
      expect(host.usageWindowsSeen().claude).toEqual([
        { window: 'seven_day', first: at - 60_000, last: at },
      ])
      expect(keptSeen().claude).toEqual([{ window: 'seven_day', first: at - 60_000, last: at }])
    })

    it('⛔ past sixteen windows, a new one takes the place of the one reported longest ago', async () => {
      const handle = await open()
      for (let i = 0; i < MAX_USAGE_WINDOWS; i += 1) {
        await reading(handle, [{ window: `w${String(i)}`, usedPercent: 1, resetsAt: null }])
        clock += 1_000
      }
      // ⚑ w0 is reported again, so w1 is now the one reported longest ago.
      await reading(handle, [{ window: 'w0', usedPercent: 1, resetsAt: null }])
      clock += 1_000
      await reading(handle, [{ window: 'new', usedPercent: 1, resetsAt: null }])
      const windows = host.usageWindowsSeen().claude.map((one) => one.window)
      expect(windows).toHaveLength(MAX_USAGE_WINDOWS)
      expect(windows).toContain('new')
      expect(windows).toContain('w0')
      expect(windows).not.toContain('w1')
    })

    it('🔴 list_profiles says which windows each provider has reported, first and last', async () => {
      const handle = await open()
      const me = (await host.createSession({ provider: 'claude', cwd: userData }, window)).sessionId
      await reading(handle, [{ window: 'seven_day', usedPercent: 40, resetsAt: clock + WEEK }])
      const tool = agentToolsFor(host, me).tools.find((one) => one.name === 'list_profiles')!
      const said = await tool.call({})
      const seen = (said.structured as { usage_windows_seen: Record<string, { window: string }[]> })
        .usage_windows_seen
      expect(seen['claude']).toEqual([
        { window: 'seven_day', first_seen: expect.any(String), last_seen: expect.any(String) },
      ])
      expect(seen['codex']).toEqual([])
    })
  })

  describe('§6 · a reading belongs to the sign-in it was read on', () => {
    const limits = () => host.limitsForAPerson().rows
    const ONE = 'a1'.repeat(16)
    const OTHER = 'b2'.repeat(16)
    const HOUR = 60 * 60_000
    /** A conversation whose provider launched on the sign-in tagged `tag`. */
    const openOn = async (
      tag: string | null,
      provider: Provider = 'claude',
    ): Promise<FakeSessionHandle> => {
      const handle = await open(provider)
      Object.assign(handle, { signInTag: () => tag })
      return handle
    }
    const windows = (provider: Provider = 'claude') =>
      host.providerUsage()[provider].map((one) => one.window)
    const weekly = (usedPercent: number) => [
      { window: 'seven_day', usedPercent, resetsAt: clock + WEEK },
    ]
    /** The host stopped and started again over the same data folder. */
    const restart = async (): Promise<void> => {
      await host.closeAll()
      clock += 25 * 60_000
      host = hostOn()
    }

    it('🔴 kept across a restart, it is shown with its moment and raises no warning', async () => {
      const read = clock
      await reading(await openOn(ONE), weekly(82))
      expect(limits()).toHaveLength(1)
      await restart()
      expect(host.providerUsage().claude).toEqual([
        {
          window: 'seven_day',
          usedPercent: 82,
          resetsAt: read + WEEK,
          at: read,
          unconfirmed: true,
        },
      ])
      // ⛔ Nobody has said this is still the Mac's sign-in: 82% may be the account before's.
      expect(limits()).toEqual([])
    })

    it('🔴 the sign-in changed while the app was closed: the old readings go, and only the new sign-in’s own numbers warn', async () => {
      await reading(await openOn(ONE), [
        ...weekly(82),
        { window: 'five_hour', usedPercent: 95, resetsAt: clock + HOUR },
      ])
      await restart()
      const now = clock
      // A conversation on another sign-in reports its week, and says nothing of five hours.
      await reading(await openOn(OTHER), weekly(3))
      expect(host.providerUsage().claude).toEqual([
        { window: 'seven_day', usedPercent: 3, resetsAt: now + WEEK, at: now },
      ])
      expect(limits()).toEqual([])
      // …and it is that sign-in the file names from now on.
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toEqual({ claude: OTHER })
      // Its own numbers warn as any reading does.
      await reading(handles.at(-1)!, weekly(84))
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
    })

    it('⚑ THE CONTROL — the same sign-in after a restart: every kept reading counts again', async () => {
      const read = clock
      await reading(await openOn(ONE), weekly(82))
      await restart()
      const now = clock
      // The same sign-in reports another window; the week it did not name is its own, and warns.
      await reading(await openOn(ONE), [
        { window: 'five_hour', usedPercent: 10, resetsAt: now + 60 * 60_000 },
      ])
      expect(host.providerUsage().claude).toEqual([
        { window: 'seven_day', usedPercent: 82, resetsAt: read + WEEK, at: read },
        { window: 'five_hour', usedPercent: 10, resetsAt: now + 60 * 60_000, at: now },
      ])
      expect(limits()).toMatchObject([{ provider: 'claude', window: 'seven_day' }])
    })

    it('⛔ a conversation that cannot name its sign-in confirms nothing: the kept readings go', async () => {
      await reading(await openOn(ONE), weekly(82))
      await restart()
      await reading(await openOn(null), [
        { window: 'five_hour', usedPercent: 10, resetsAt: clock + 60 * 60_000 },
      ])
      expect(host.providerUsage().claude.map((one) => one.window)).toEqual(['five_hour'])
      expect(limits()).toEqual([])
    })

    it('⚑ readings kept with no tag are never confirmed, and one provider’s sign-in settles only its own', async () => {
      // An untagged conversation of each provider reports.
      await reading(await open(), weekly(82))
      await reading(await open('codex'), [
        { window: 'a 7-day window', usedPercent: 90, resetsAt: clock + WEEK },
      ])
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toBeUndefined()
      await restart()
      expect(limits()).toEqual([])
      await reading(await openOn(ONE), [
        { window: 'five_hour', usedPercent: 10, resetsAt: clock + 60 * 60_000 },
      ])
      // Claude's untagged week is gone; Codex's is still shown, and still raises nothing.
      expect(host.providerUsage().claude.map((one) => one.window)).toEqual(['five_hour'])
      expect(host.providerUsage().codex).toMatchObject([{ unconfirmed: true }])
      expect(limits()).toEqual([])
    })

    it('⚑ a quit before any conversation reports keeps the readings with the sign-in they were read on', async () => {
      await reading(await openOn(ONE), weekly(82))
      await restart()
      await restart()
      expect(readKeptUsage(providerUsageFile(userData))).toMatchObject({
        readings: { claude: [{ window: 'seven_day', usedPercent: 82 }] },
        readOn: { claude: ONE },
      })
      expect(host.providerUsage().claude).toMatchObject([{ unconfirmed: true }])
    })

    it('⛔ a tag in the file that is not one is not read', () => {
      const file = providerUsageFile(userData)
      for (const notOne of ['not hex!', 'c0ffee', `${ONE}00`, 7]) {
        writeFileSync(
          file,
          JSON.stringify({
            readings: { claude: [], codex: [] },
            seen: { claude: [], codex: [] },
            readOn: { claude: notOne, codex: ONE, other: ONE },
          }),
        )
        expect(readKeptUsage(file).readOn).toEqual({ codex: ONE })
      }
    })

    it('🔴 another sign-in in one run, which nobody noticed: a later conversation’s reading replaces what is held', async () => {
      const older = await openOn(ONE)
      await reading(older, weekly(82))
      expect(limits()).toHaveLength(1)
      // The Mac's sign-in moves, and a conversation starts on the new one before any turn of the
      // older one meets its gate. It names five hours, and says nothing of the week.
      clock += 1_000
      const newer = await openOn(OTHER)
      const now = clock
      await reading(newer, [{ window: 'five_hour', usedPercent: 3, resetsAt: now + HOUR }])
      expect(host.providerUsage().claude).toEqual([
        { window: 'five_hour', usedPercent: 3, resetsAt: now + HOUR, at: now },
      ])
      expect(limits()).toEqual([])
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toEqual({ claude: OTHER })

      // ⛔ The conversation still on the sign-in before says that one's week again: not taken.
      await reading(older, weekly(83))
      expect(windows()).toEqual(['five_hour'])
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toEqual({ claude: OTHER })

      // …so a restart on the new sign-in confirms that sign-in's readings and no other's.
      await restart()
      await reading(await openOn(OTHER), [
        { window: 'five_hour', usedPercent: 4, resetsAt: clock + HOUR },
      ])
      expect(windows()).toEqual(['five_hour'])
      expect(limits()).toEqual([])
    })

    it('🔴 the Mac’s sign-in found moved by one conversation: another launched on the same login no longer feeds the readings', async () => {
      await openOn(ONE)
      clock += 60_000
      const second = await openOn(ONE)
      await reading(second, weekly(40))
      // The first conversation's turn gate finds the Mac on another login; the second is mid-turn.
      ;(
        host as unknown as { aSignInChanged(provider: Provider, lifeSince: number): void }
      ).aSignInChanged('claude', clock - 60_000)
      expect(host.providerUsage().claude).toEqual([])
      await reading(second, weekly(90))
      expect(host.providerUsage().claude).toEqual([])
      expect(limits()).toEqual([])
      // ⚑ A conversation on the new login is read as before.
      clock += 1_000
      await reading(await openOn(OTHER), weekly(5))
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 5 }])
    })

    it('⚑ a Codex sign-in is its profile’s: conversations on two of them keep each other’s readings', async () => {
      await reading(await openOn(ONE, 'codex'), [
        { window: 'a 7-day window', usedPercent: 40, resetsAt: clock + WEEK },
      ])
      clock += 1_000
      await reading(await openOn(OTHER, 'codex'), [
        { window: 'a 5-hour window', usedPercent: 10, resetsAt: clock + HOUR },
      ])
      expect(windows('codex')).toEqual(['a 7-day window', 'a 5-hour window'])
    })

    it('⚑ the sign-in a reading was read on is kept when it alone moved', async () => {
      const same = weekly(82)
      await reading(await open(), same)
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toBeUndefined()
      await reading(await openOn(ONE), same)
      expect(readKeptUsage(providerUsageFile(userData)).readOn).toEqual({ claude: ONE })
    })

    it('🔴 forgotten after a restart, before any conversation reports: the readings and their sign-in leave the file', async () => {
      await reading(await openOn(ONE), weekly(82))
      await restart()
      ;(host as unknown as { providerLoginChanged(provider: Provider): void }).providerLoginChanged(
        'claude',
      )
      expect(host.providerUsage().claude).toEqual([])
      const file = readKeptUsage(providerUsageFile(userData))
      expect(file.readings.claude).toEqual([])
      expect(file.readOn).toBeUndefined()
      // What arrives next is this run's own, and warns on its own numbers.
      await reading(await openOn(OTHER), weekly(84))
      expect(host.providerUsage().claude).toMatchObject([{ usedPercent: 84 }])
      expect(host.providerUsage().claude[0]).not.toHaveProperty('unconfirmed')
      expect(limits()).toHaveLength(1)
    })

    it('⛔ a conversation on an older login settles nothing: the kept readings stay unconfirmed', async () => {
      await reading(await openOn(ONE, 'codex'), [
        { window: 'a 7-day window', usedPercent: 90, resetsAt: clock + WEEK },
      ])
      await restart()
      const life = await openOn(ONE, 'codex')
      // Its profile is signed in to another account under it.
      ;(
        host as unknown as { aSignInChanged(provider: Provider, lifeSince: number): void }
      ).aSignInChanged('codex', clock)
      await reading(life, [{ window: 'a 7-day window', usedPercent: 95, resetsAt: clock + WEEK }])
      expect(host.providerUsage().codex).toMatchObject([{ usedPercent: 90, unconfirmed: true }])
      expect(limits()).toEqual([])
    })

    it('🔴 agents read an unconfirmed reading as one: in the payload and in words', async () => {
      await reading(await openOn(ONE), weekly(82))
      await restart()
      const me = (await host.createSession({ provider: 'claude', cwd: userData }, window)).sessionId
      const tool = agentToolsFor(host, me).tools.find((one) => one.name === 'list_profiles')!
      const said = await tool.call({})
      const usage = (said.structured as { provider_usage: Record<string, unknown[]> })
        .provider_usage
      expect(usage['claude']).toMatchObject([
        { window: 'seven_day', used_percent: 82, unconfirmed_for_this_sign_in: true },
      ])
      expect(said.text).toContain("before this app last started, so it may be another sign-in's")
    })
  })
})
