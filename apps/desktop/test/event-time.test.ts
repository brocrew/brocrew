import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, RUNTIME_EVENT_TYPES, claudeProjectDirName } from '@brobot2/runtime'
import {
  NO_DISCOVERY,
  discoverSessionsIn,
  type Discovery,
} from '../src/main/adopt/discover-sessions'
import type { SessionBundle } from '../src/main/archive/export-session'
import { importClaudeTranscript } from '../src/main/archive/import-claude'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { listProviderHomes } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * When each thing happened, and whether it survives (Slice 2 · 001).
 *
 * The ledger has always had `created_at`; nothing carried it outward, so a reopened conversation
 * lost every per-message time and an imported one would have claimed to have happened at the
 * moment it was imported. These pin the three answers: live is the host's clock, replay is the
 * recorded time, and an import is the PROVIDER's own.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('when each event happened', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  let runtimes: Map<string, FakeRuntime>
  let fixture: { sessionId: string; cwd: string; text: string }

  function discoverEverything(): Discovery {
    return listProviderHomes(userData)
      .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
      .reduce<Discovery>(
        (all, part) => ({
          found: [...all.found, ...part.found],
          skipped: [...all.skipped, ...part.skipped],
        }),
        { found: [], skipped: [] },
      )
  }

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: discoverEverything,
      // A pinned clock, so "the wire and the ledger agree" is an equality rather than a
      // near-enough: two readings of Date.now() would differ by a millisecond and prove nothing.
      now: () => clock,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath,
      // One runtime per provider, SHARED across hosts: a relaunched app gets a new host, but the
      // provider's own state outlives it — and the Fake models that by refusing to resume a ref
      // it never issued (034).
      createRuntime: (provider) => {
        const existing = runtimes.get(provider)
        if (existing) return existing
        const fresh = new FakeRuntime(provider)
        runtimes.set(provider, fresh)
        return fresh
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  function plantFixture(): void {
    const home = join(userData, 'provider-homes', 'default', 'default', 'claude')
    const projectDir = join(home, 'projects', claudeProjectDirName(fixture.cwd))
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${fixture.sessionId}.jsonl`), fixture.text)
  }

  const eventRows = (sessionId: string) =>
    db
      .prepare('SELECT ordinal, created_at FROM events WHERE session_id = ? ORDER BY ordinal')
      .all(sessionId) as { ordinal: number; created_at: number }[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-time-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    clock = 1_800_000_000_000
    runtimes = new Map()

    const text = readFileSync(FIXTURE, 'utf8')
    const named = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { sessionId?: string; cwd?: string })
      .find((record) => typeof record.cwd === 'string')
    fixture = { sessionId: named?.sessionId ?? '', cwd: named?.cwd ?? '', text }
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('tells the renderer the same moment it writes to the ledger', async () => {
    const host = buildHost({ discoverSessions: NO_DISCOVERY })
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'claude' }, sink)
    await waitFor(() => sink.messages.length >= 2, 'the opening events')
    await host.closeAll()

    const rows = eventRows(created.sessionId)
    expect(rows.length).toBeGreaterThan(1)
    // Not "close enough" — the same number, because it is the same reading of the clock.
    for (const message of sink.messages) {
      const row = rows.find((entry) => entry.ordinal === message.ordinal)
      if (!row) continue
      expect(message.at, `ordinal ${message.ordinal}`).toBe(row.created_at)
    }
    expect(sink.messages[0]?.at).toBe(1_800_000_000_000)
  })

  it('replays the time it happened, not the time it was reopened', async () => {
    const first = buildHost({ discoverSessions: NO_DISCOVERY })
    const sink = new RecordingSink()
    const created = await first.createSession({ provider: 'codex' }, sink)
    await waitFor(() => sink.messages.length >= 2, 'the opening events')
    await first.close(created.sessionId, sink)
    const recorded = eventRows(created.sessionId)

    // Time passes, the app is quit and restarted, and the conversation is reopened.
    clock = 1_900_000_000_000
    const relaunched = buildHost({ discoverSessions: NO_DISCOVERY })
    const resumed = await relaunched.resumeSession(created.sessionId, new RecordingSink())

    expect(resumed.history.entries.length).toBe(recorded.length)
    expect(resumed.history.entries.map((entry) => entry.at)).toEqual(
      recorded.map((row) => row.created_at),
    )
    // Absolute, not merely self-consistent: comparing the replay against the same column it was
    // read from would pass even if the write had ignored the time it was given. The session ran
    // at exactly this moment, and that is the moment it has to come back with.
    expect(new Set(resumed.history.entries.map((entry) => entry.at))).toEqual(
      new Set([1_800_000_000_000]),
    )
    expect(resumed.history.entries.every((entry) => entry.at < 1_900_000_000_000)).toBe(true)
    await relaunched.closeAll()
  })

  it('imports a conversation with the times the provider recorded, not the time of the import', async () => {
    // Against the real transcript: its own records carry ISO-8601 timestamps, and those are what
    // the conversation should read as having happened at.
    plantFixture()
    await buildHost().adoptSessions()
    const sessionId = store.resumable()[0]?.sessionId ?? ''
    const rows = eventRows(sessionId)
    expect(rows.length).toBeGreaterThan(5)

    const provider = fixture.text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { timestamp?: string })
      .flatMap((record) => (record.timestamp ? [Date.parse(record.timestamp)] : []))
    const earliest = Math.min(...provider)
    const latest = Math.max(...provider)

    // Every recorded time is one the file itself names…
    for (const row of rows) {
      expect(row.created_at, `ordinal ${row.ordinal}`).toBeGreaterThanOrEqual(earliest)
      expect(row.created_at).toBeLessThanOrEqual(latest)
    }
    // …and none of them is the moment we imported it.
    expect(rows.some((row) => row.created_at === clock)).toBe(false)
    expect(rows[0]?.created_at).toBe(earliest)
    // The transcript runs forwards.
    expect(rows.map((row) => row.created_at)).toEqual(
      [...rows.map((row) => row.created_at)].sort((a, b) => a - b),
    )
  })

  it('carries the last known time onto a record that names none', () => {
    // Measured on the real transcripts: `ai-title` and `last-prompt` carry no timestamp. Saying
    // they happened at the import would be a lie; the most that is true is "at or after the thing
    // before them".
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-07-25T04:07:18.323Z',
          message: { content: 'hi' },
        }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'a name', sessionId: 'x' }),
      ],
      999,
    )
    expect(entries.map((entry) => entry.at)).toEqual([1784952438323, 1784952438323])
  })

  it('treats an unreadable timestamp as absent rather than as a NaN', () => {
    const { entries } = importClaudeTranscript(
      [JSON.stringify({ type: 'user', timestamp: 'not a date', message: { content: 'hi' } })],
      4242,
    )
    expect(entries[0]?.at).toBe(4242)
  })

  it('keeps the times through an export and back in again', async () => {
    plantFixture()
    const host = buildHost()
    await host.adoptSessions()
    const sessionId = store.resumable()[0]?.sessionId ?? ''
    const before = store.events(sessionId)

    const exported = await host.exportSession({ sessionId: sessionId, exportKind: 'bundle' })
    const bundle = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
    expect(bundle.ledger.map((entry) => entry.at)).toEqual(before.map((entry) => entry.at))

    // Into an empty database, as a transfer would be.
    const elsewhereDb = openDatabase(join(dir, 'elsewhere.sqlite'))
    applyMigrations(elsewhereDb, migrations)
    const elsewhere = createSessionStore(elsewhereDb)
    clock = 1_900_000_000_000
    const { sessionId: restored } = buildHost({ store: elsewhere }).importBundle(bundle)

    expect(elsewhere.events(restored).map((entry) => entry.at)).toEqual(
      before.map((entry) => entry.at),
    )
    elsewhereDb.close()
  })

  it('leaves the provider-neutral event alone — the time is on the envelope', () => {
    // The runtime is GO-locked, and time is ours rather than the provider's. If it had leaked
    // into the event union, it would be persisted inside every payload and exported as if the
    // provider had said it.
    expect(RUNTIME_EVENT_TYPES).not.toContain('at')
    const { entries } = importClaudeTranscript(
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-07-25T04:07:18.323Z',
          message: { content: 'hi' },
        }),
      ],
      0,
    )
    // `attribution` rides along because an imported turn is the provider file's claim about the
    // user, not something this app watched (074). Asserted whole, so the marker cannot go missing.
    expect(entries[0]?.event).toEqual({
      type: 'user_turn',
      text: 'hi',
      attribution: 'provider_transcript',
    })
    expect(Object.keys(entries[0]?.event ?? {})).not.toContain('at')
  })
})
