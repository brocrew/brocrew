import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isTheProvidersRecord, newestReplyModel } from '../src/main/archive/native-file'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * # The launch's pass that puts an older Claude conversation's model on its record: what it skips,
 * # what it keeps, and when it stops
 *
 * Once after a launch, `recordWhatTheOlderOnesRan` reads the model Claude's own transcript names
 * for each conversation this app started with no model on record, and writes it as the provider's
 * report. The test beside this one pins which transcripts it may open (a link out, a conversation
 * brought in, a Codex one); none of these is reached:
 *
 *  - ⛔ a conversation with a selected model is skipped — the transcript names a model the way the
 *    API answered, not the one selected — beside a plain one the same pass records.
 *  - ⛔ a conversation running now is skipped: its own report is fresher than its transcript.
 *  - 🔴 the effort already on record is kept when the model is written; a transcript records none.
 *  - 🔴 the answer counts what it recorded and what has no record left to read, and a second pass
 *    reads only what is still unrecorded.
 *  - ⛔ once a quit has begun, the pass records nothing — and a new launch's pass then does.
 *
 * Real host, real SQLite ledger; the archive's lookup (`nativeTranscriptPath`) is a map from the
 * provider's id to a file this test wrote. Every folder is a `mkdtemp` one, removed after.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

/** One Claude Code transcript line: a reply that names its model. */
const aReply = (model: string): string =>
  `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, content: [] } })}\n`

describe('the pass over the older Claude conversations: skips, keeps, counts and stops', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  /** The archive's lookup: the provider's id → the file found for it. */
  let transcripts: Map<string, string>

  const tick = (): number => clock++
  const homeOf = (provider: Provider, profileId: string): string =>
    join(userData, 'provider-homes', profileId, provider)

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: (_provider, _home, ref) => transcripts.get(ref.sessionId) ?? null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = homeOf(provider, profileId ?? 'default')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) => homeOf(provider, profileId),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_older_${String(tick())}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-older-ones-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-older-ones-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    transcripts = new Map()
    store = createSessionStore(db, tick)
    host = buildHost()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, workspace]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (what: string, done: () => boolean): Promise<void> => {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      if (done()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** A file at `path`, its folders made. */
  const aFile = (path: string, text: string): string => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }

  /** A transcript in profile `pm`'s own Claude `projects/`, named for `name`. */
  const aTranscript = (name: string, text: string): string =>
    aFile(join(homeOf('claude', 'pm'), 'projects', 'p', `${name}.jsonl`), text)

  /**
   * A conversation this app started, in profile `pm`, with a provider id and NO model recorded —
   * neither set nor reported — and the archive finding `transcript` for it.
   */
  const aConversationThisAppStarted = (
    id: string,
    provider: Provider,
    transcript: string,
  ): string => {
    store.create({ id, provider, cwd: workspace, approvalMode: 'ask', profileId: 'pm' })
    store.append(
      id,
      0,
      {
        type: 'session',
        state: 'started',
        ref: { provider, sessionId: `p_${id}`, cwd: workspace, rotation: 0 },
      } as Parameters<SessionStore['append']>[2],
      tick(),
    )
    transcripts.set(`p_${id}`, transcript)
    return id
  }

  /** The control: a plain transcript in the profile's own `projects/`, newest reply `m1`. */
  const thePlainOne = (): string => {
    const id = aConversationThisAppStarted(
      'sess_plain',
      'claude',
      aTranscript('p_sess_plain', aReply('m1')),
    )
    expect(store.whatItRunsOn(id)).toMatchObject({ model: null, reportedModel: null })
    return id
  }

  it('⛔ a conversation with a selected model is left to its own next report — ⚑ one with none is recorded by the same pass', async () => {
    const plain = thePlainOne()
    const selected = aConversationThisAppStarted(
      'sess_selected',
      'claude',
      aTranscript('p_sess_selected', aReply('m-transcript')),
    )
    store.setModel(selected, 'sel')
    expect(store.whatItRunsOn(selected)).toMatchObject({ model: 'sel', reportedModel: null })

    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 1, noRecordLeft: 0 })
    expect(store.whatItRunsOn(selected)).toMatchObject({ model: 'sel', reportedModel: null })
    expect(store.whatItRunsOn(plain)).toMatchObject({ reportedModel: 'm1' })
  })

  it('⛔ a conversation running now keeps its own report — ⚑ one not running is recorded by the same pass', async () => {
    const plain = thePlainOne()
    const { sessionId: live } = await host.createSession(
      { provider: 'claude', profileId: 'pm', cwd: workspace, approvalMode: 'auto' },
      null,
    )
    await waitFor('its provider id on record', () => store.find(live)?.ref.sessionId !== undefined)
    const ref = store.find(live)?.ref.sessionId ?? ''
    // Premise: nothing about its model is on record, and its transcript would be read.
    store.setModel(live, null)
    expect(store.whatItRunsOn(live)).toMatchObject({ model: null, reportedModel: null })
    const transcript = aTranscript(ref, aReply('m-live-transcript'))
    transcripts.set(ref, transcript)
    expect(isTheProvidersRecord('claude', homeOf('claude', 'pm'), transcript)).toBe(true)

    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 1, noRecordLeft: 0 })
    expect(store.whatItRunsOn(live)).toMatchObject({ reportedModel: null })
    expect(store.whatItRunsOn(plain)).toMatchObject({ reportedModel: 'm1' })
  })

  it('🔴 the effort already on record is kept when the model is written', async () => {
    const kept = aConversationThisAppStarted(
      'sess_effort',
      'claude',
      aTranscript('p_sess_effort', aReply('m-effort')),
    )
    store.setReportedModel(kept, null, 'high')
    expect(store.whatItRunsOn(kept)).toMatchObject({
      model: null,
      reportedModel: null,
      reportedEffort: 'high',
    })
    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 1, noRecordLeft: 0 })
    expect(store.whatItRunsOn(kept)).toMatchObject({
      reportedModel: 'm-effort',
      reportedEffort: 'high',
    })
  })

  it('🔴 it counts what it recorded and what has no record left — ⚑ and a second pass reads only what is still unrecorded', async () => {
    const plain = thePlainOne()
    const silentFile = aTranscript(
      'p_sess_silent',
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } })}\n`,
    )
    aConversationThisAppStarted('sess_silent', 'claude', silentFile)
    // Premise: its transcript names no model.
    expect(newestReplyModel(silentFile)).toBeNull()

    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 1, noRecordLeft: 1 })
    expect(store.whatItRunsOn(plain)).toMatchObject({ reportedModel: 'm1' })
    expect(store.whatItRunsOn('sess_silent')).toMatchObject({ reportedModel: null })
    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 0, noRecordLeft: 1 })
  })

  it('⛔ once a quit has begun it records nothing — ⚑ the next launch’s pass does', async () => {
    const plain = thePlainOne()
    // Premise: its transcript is readable and names a model.
    expect(
      newestReplyModel(join(homeOf('claude', 'pm'), 'projects', 'p', 'p_sess_plain.jsonl')),
    ).toBe('m1')
    await host.closeAll()
    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 0, noRecordLeft: 0 })
    expect(store.whatItRunsOn(plain)).toMatchObject({ reportedModel: null })

    // ⚑ The next launch, with its own store object, records it.
    store = createSessionStore(db, tick)
    host = buildHost()
    expect(await host.recordWhatTheOlderOnesRan()).toEqual({ recorded: 1, noRecordLeft: 0 })
    expect(store.whatItRunsOn(plain)).toMatchObject({ reportedModel: 'm1' })
  })
})
