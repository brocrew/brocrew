import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { usageKeptIn } from '../src/main/provider-usage-file'
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
    now: () => NOW,
    usageKept: usageKeptIn(db),
    readProviderConfig: fixtureProviderConfig,
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fictional-warning-identity-'))
  file = join(directory, 'fictional.sqlite')
  db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  store = createSessionStore(db, () => NOW)
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
