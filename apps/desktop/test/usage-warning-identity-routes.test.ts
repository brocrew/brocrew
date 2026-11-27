import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { usageKeptIn } from '../src/main/provider-usage-file'
import { limitsForDisplay } from '../src/main/providers/limit-meaning'
import { limitsOfTheAccountInUse } from '../src/main/providers/limits-in-use'
import {
  providerConditions,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../src/shared/provider-limit'
import { usageSays } from '../src/renderer/src/lib/usage-limit'
import { ProviderDouble, anOpenGate } from './lib/provider-double'
import {
  RecordingSink,
  fixtureProviderConfig,
  neutralHostDeps,
  syntheticProviderHome,
} from './lib/host-fixture'

const NOW = Date.UTC(2026, 10, 11)
const HOUR = 3_600_000
const slots = [
  { window: 'its primary window', usedPercent: 81, resetsAt: NOW + HOUR },
  { window: 'its secondary window', usedPercent: 95, resetsAt: NOW + 2 * HOUR },
]
let directory: string
let file: string
let db: AppDatabase
let store: SessionStore
let host: RuntimeHost
let handles: FakeSessionHandle[]
let next: number
let clock: number
/** What the windows were told moved. */
let notices: unknown[]
const engines: LimitsReadEngine[] = []

function makeHost(): RuntimeHost {
  const issued = new FakeProviderSessions()
  return new RuntimeHost({
    store,
    ...neutralHostDeps(() => directory),
    createRuntime: (provider) => new ProviderDouble(provider, handles, issued, anOpenGate()),
    prepareProviderHome: syntheticProviderHome(() => directory),
    providerHomePath: (provider) => join(directory, 'provider-homes', provider),
    resolveCwd: (_id, requested) => requested ?? directory,
    newSessionId: () => `fictional-${++next}`,
    now: () => clock,
    usageKept: usageKeptIn(db),
    readProviderConfig: fixtureProviderConfig,
    providersMoved: (message) => notices.push(message),
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fictional-warning-identity-'))
  file = join(directory, 'fictional.sqlite')
  db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  clock = NOW
  notices = []
  store = createSessionStore(db, () => clock)
  handles = []
  next = 0
  host = makeHost()
})
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.close()
  await host.closeAll()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it.each(['codex', 'claude'] as const)(
  'the actual %s host publication and legacy limits route agree on owner-bound identity',
  async (provider) => {
    const sink = new RecordingSink(sinkOwnerId({ id: 1 }))
    await host.createSession({ provider, cwd: directory }, sink)
    handles.at(-1)!.simulateProviderUsage(slots)
    await vi.waitFor(() => expect(host.providerUsage()[provider]).toHaveLength(2))
    const shown = host.providerUsage()[provider]
    const expected = provider === 'codex' ? ['this window'] : slots.map((row) => row.window).sort()
    expect(
      shown.flatMap((row) => (row.warning == null ? [] : [row.warning.window])).sort(),
    ).toEqual(expected)
    expect(
      host
        .limitsForAPerson()
        .rows.map((row) => row.window)
        .sort(),
    ).toEqual(expected)
    expect(shown.every((row) => row.period?.durationMs === null)).toBe(true)
    expect(shown.some((row) => Object.hasOwn(row, 'warningWindow'))).toBe(false)
    const kept = usageKeptIn(db).read()
    expect(kept.readings[provider].map(({ window }) => window)).toEqual(
      slots.map(({ window }) => window),
    )
    expect(kept.readings[provider].every((row) => !Object.hasOwn(row, 'warningWindow'))).toBe(true)
    await host.closeAll()
    host = makeHost()
    expect(
      host
        .providerUsage()
        [provider].every((row) => row.unconfirmed === true && row.warning === null),
    ).toBe(true)
    expect(host.limitsForAPerson().rows).toEqual([])
    expect(usageKeptIn(db).read()).toEqual(kept)
  },
)

function input(provider: Provider): LimitsReadInput {
  return {
    operation: 1,
    databaseEpoch: 1,
    signInEpoch: 1,
    capturedAt: NOW,
    signInChangedAt: {},
    usage: { [provider]: slots.map((row) => ({ ...row, at: NOW - 10 })) },
  }
}

it.each(['codex', 'claude'] as const)(
  'the actual %s worker projects old missing facts without changing its input or database',
  (provider) => {
    const engine = new LimitsReadEngine(file, () => NOW)
    engines.push(engine)
    const wanted = input(provider)
    const bytes = JSON.stringify(wanted)
    const before = db.prepare('SELECT id, payload FROM events ORDER BY id').all()
    const result = engine.read(wanted)
    const expected = provider === 'codex' ? ['this window'] : slots.map((row) => row.window).sort()
    expect(result.display.rows.map((row) => row.window).sort()).toEqual(expected)
    if (provider === 'codex') {
      expect(result.display.rows[0]?.said).toContain('95% of this window used')
      expect(result.display.rows[0]?.resetsAt).toBe(NOW + 2 * HOUR)
    }
    expect(JSON.stringify(wanted)).toBe(bytes)
    expect(db.prepare('SELECT id, payload FROM events ORDER BY id').all()).toEqual(before)
  },
)

it('the worker suppresses the derived Codex slot warning when its native warning already owns that key', () => {
  store.create({
    id: 'native',
    provider: 'codex',
    cwd: directory,
    approvalMode: 'ask',
    profileId: 'fictional',
  })
  const message = `codex is approaching its rate limit — 95% of this window used; resets ${new Date(NOW + 2 * HOUR).toISOString()}`
  store.append('native', 0, { type: 'error', message, fatal: false }, NOW - 1)
  const engine = new LimitsReadEngine(file, () => NOW)
  engines.push(engine)
  const result = engine.read(input('codex'))
  expect(result.display.rows).toHaveLength(1)
  expect(result.display.rows[0]?.window).toBe('this window')
  expect(result.display.rows[0]?.said).toBe(message)
  expect(store.events('native')[0]?.event).toEqual({ type: 'error', message, fatal: false })
})

const RESETS = NOW + 3 * 24 * HOUR
const WEEK = 'a 7-day window'
const weeklyLine = (used: number) =>
  `codex is approaching its rate limit — ${used}% of ${WEEK} used; resets ${new Date(RESETS).toISOString()}`
/** The sentences Waiting on you draws from a display walk's rows. */
const told = (rows: readonly ProviderLimitSeen[], now: number): string[] =>
  providerConditions(rows, now).map((condition) => usageSays(condition, now))
const NEAR_95 = 'Codex is near its weekly limit (95% used); it resets in 3 days.'
/** The account in use reads 11% or 95% of its week; another account's line said 90% of the same week. */
const ACCOUNT_CASES = [
  {
    name: 'a newer 90% line of an account not in use is not told while the one in use reads 11%',
    lineAt: NOW - 5,
    lineAccount: 'codex:sign-in:inactive-account',
    used: 11,
    says: [],
  },
  {
    name: 'an older 90% line of no known account gives way to the newer 11% of the account in use',
    lineAt: NOW - 20,
    lineAccount: undefined,
    used: 11,
    says: [],
  },
  {
    name: 'the account in use at 95% is told at 95%, beside the 90% line of an account not in use',
    lineAt: NOW - 5,
    lineAccount: 'codex:sign-in:inactive-account',
    used: 95,
    says: [NEAR_95],
  },
]

it.each(ACCOUNT_CASES)('the worker tells the account in use: $name', (one) => {
  store.create({
    id: 'inactive',
    provider: 'codex',
    cwd: directory,
    approvalMode: 'ask',
    profileId: 'fictional',
  })
  store.append('inactive', 0, { type: 'error', message: weeklyLine(90), fatal: false }, one.lineAt)
  const engine = new LimitsReadEngine(file, () => NOW)
  engines.push(engine)
  const result = engine.read({
    ...input('codex'),
    accountLives:
      one.lineAccount === undefined
        ? []
        : [{ sessionId: 'inactive', since: NOW - HOUR, account: one.lineAccount }],
    usage: {
      codex: [
        {
          window: WEEK,
          usedPercent: one.used,
          resetsAt: RESETS,
          at: NOW - 10,
          account: 'current-account',
        },
      ],
    },
  })
  // What holds work keeps the recorded line, with its account when it is known.
  expect(result.canonical.rows.map((row) => [row.said, row.account])).toEqual([
    [weeklyLine(90), one.lineAccount],
  ])
  expect(told(limitsForDisplay(result.display).rows, NOW)).toEqual(one.says)
})

it('the host tells the account its newest reading was read on, the one the title bar shows', async () => {
  const sink = new RecordingSink(sinkOwnerId({ id: 1 }))
  const onAccount = async (tag: string): Promise<FakeSessionHandle> => {
    await host.createSession({ provider: 'codex', cwd: directory }, sink)
    return Object.assign(handles.at(-1)!, { signInTag: () => tag })
  }
  const weekly = (handle: FakeSessionHandle, usedPercent: number) =>
    handle.simulateProviderUsage([{ window: WEEK, usedPercent, resetsAt: RESETS }])
  const inactive = await onAccount('inactive-account')
  weekly(inactive, 90)
  inactive.simulateError(weeklyLine(90), false)
  await vi.waitFor(() =>
    expect(told(host.limitsForAPerson().rows, clock)).toEqual([
      'Codex is near its weekly limit (90% used); it resets in 3 days.',
    ]),
  )
  const current = await onAccount('current-account')
  for (const [used, says] of [
    [11, []],
    [95, [NEAR_95]],
  ] as const) {
    clock += 1_000
    weekly(current, used)
    await vi.waitFor(() => expect(host.providerUsage().codex[0]?.usedPercent).toBe(used))
    expect(told(host.limitsForAPerson().rows, clock)).toEqual(says)
  }
  // A newer 5-hour reading of the other account puts it in use: the title bar shows only its
  // readings, and the notice is its own weekly line.
  clock += 1_000
  inactive.simulateProviderUsage([{ window: 'a 5-hour window', usedPercent: 20, resetsAt: null }])
  await vi.waitFor(() =>
    expect(host.providerUsage().codex.map((one) => [one.window, one.usedPercent])).toEqual([
      ['a 5-hour window', 20],
    ]),
  )
  expect(told(host.limitsForAPerson().rows, clock)).toEqual([
    'Codex is near its weekly limit (90% used); it resets in 3 days.',
  ])
  // The first account says its week again, unchanged: it is in use again, and the windows are told.
  clock += 1_000
  notices = []
  weekly(current, 95)
  await vi.waitFor(() => expect(notices).toContainEqual({ what: 'usage', provider: 'codex' }))
  expect(host.providerUsage().codex.map((one) => [one.window, one.usedPercent])).toEqual([
    [WEEK, 95],
  ])
  expect(told(host.limitsForAPerson().rows, clock)).toEqual([NEAR_95])
  // The line still stands for the account that recorded it.
  expect(store.providerLimitsSeen(clock).rows).toHaveLength(1)
})

const A = 'codex:sign-in:current-account'
const at = (iso: number) => `; resets ${new Date(iso).toISOString()}`
const line = (said: string, when: number, account?: string): ProviderLimitSeen => ({
  ...readProviderLimit(said, when)!,
  ...(account === undefined ? {} : { account }),
})
const reading = (window: string, usedPercent: number, when: number, extra: object = {}) => ({
  window,
  usedPercent,
  resetsAt: RESETS,
  at: when,
  account: 'current-account',
  ...extra,
})
const FIVE_HOURS_92 = `codex is approaching its rate limit — 92% of a 5-hour window used${at(NOW + HOUR)}`
const SECONDARY = `codex is approaching its rate limit — 90% of this window used${at(RESETS)}`
const CLAUDE_75 = `claude is approaching its rate limit (seven_day) — 75% used${at(RESETS)}`
/** What a warning may not give way to, and what does not name the account in use. */
const KEPT_CASES = [
  {
    name: 'a newer 95% reading whose window has reset leaves a current warning',
    rows: [line(weeklyLine(90), NOW - 20, A)],
    usage: { codex: [reading(WEEK, 95, NOW - 10, { resetsAt: NOW - 1 })] },
    kept: [weeklyLine(90)],
  },
  {
    name: 'a lower newer reading leaves a known account’s own Claude warning',
    rows: [line(CLAUDE_75, NOW - 20, 'claude:account:current-account')],
    usage: { claude: [reading('seven_day', 60, NOW - 10)] },
    kept: [CLAUDE_75],
  },
  {
    name: 'a newer 95% reading of no known account leaves a known account’s warning',
    rows: [line(weeklyLine(90), NOW - 20, A)],
    usage: { codex: [{ window: WEEK, usedPercent: 95, resetsAt: RESETS, at: NOW - 10 }] },
    kept: [
      weeklyLine(90),
      `codex is approaching its rate limit — 95% of ${WEEK} used, by its latest reading${at(RESETS)}`,
    ],
  },
  {
    name: 'a reading of one of two windows sharing a name leaves a warning of no known account',
    rows: [line(SECONDARY, NOW - 20)],
    usage: { codex: [reading('its secondary window', 11, NOW - 10)] },
    kept: [SECONDARY],
  },
  {
    name: 'a newer bucket reading of another account does not name the account in use',
    rows: [line(FIVE_HOURS_92, NOW - 20, A)],
    usage: {
      codex: [
        reading(WEEK, 50, NOW - 30),
        reading(`${WEEK} (Fictional-Spark)`, 95, NOW - 10, { account: 'inactive-account' }),
      ],
    },
    kept: [FIVE_HOURS_92],
  },
  {
    name: 'a newer reading of a window the title bar does not draw does not name the account in use',
    rows: [line(FIVE_HOURS_92, NOW - 20, A)],
    usage: {
      codex: [
        reading(WEEK, 11, NOW - 30),
        reading('its secondary window', 50, NOW - 10, { account: 'inactive-account' }),
      ],
    },
    kept: [FIVE_HOURS_92],
  },
  {
    name: 'readings kept by an earlier run name the account in use and warn of nothing',
    rows: [
      line(weeklyLine(90), NOW - 5, 'codex:sign-in:inactive-account'),
      line(FIVE_HOURS_92, NOW - 20, A),
    ],
    usage: { codex: [reading(WEEK, 11, NOW - 10, { unconfirmed: true })] },
    kept: [FIVE_HOURS_92],
  },
  {
    name: 'an account that cannot be read is no other account',
    rows: [line(weeklyLine(90), NOW - 5, 'codex:sign-in:')],
    usage: { codex: [reading(WEEK, 11, NOW - 10)] },
    kept: [weeklyLine(90)],
  },
]

it.each(KEPT_CASES)('the account in use keeps its warnings: $name', ({ rows, usage, kept }) => {
  const walk = {
    walk: 'every-provider-wall-recently-recorded' as const,
    rows,
    ledgers: 1,
    rowsUnread: 0,
  }
  expect(limitsOfTheAccountInUse(walk, usage, NOW).rows.map((row) => row.said)).toEqual(kept)
})
