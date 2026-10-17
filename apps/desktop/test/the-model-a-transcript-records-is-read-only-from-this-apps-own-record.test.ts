import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
 * # The model an older conversation's own transcript records, read only from this app's record
 *
 * A Claude conversation from before models were recorded has none at all; once after each launch
 * the host reads the model Claude Code wrote on its transcript's newest reply and records it as the
 * model its provider reported (`recordWhatTheOlderOnesRan`). Three guards decide whether it may read
 * the file: ⛔ only a Claude conversation (a Codex rollout is found by copying Codex's state
 * database), ⛔ only one this app started (`adoptedAt === null`: a conversation brought in is not
 * this app's to read for this), and ⛔ only a file that IS the provider's record in this profile's
 * home (`isTheProvidersRecord`) — so a `.jsonl` under `projects/` that is a link leading elsewhere is
 * never opened. Each, lost, opens a file the app has no claim to — a person's own folder, through a
 * link — and records what it says as the model the conversation ran.
 *
 *  - ⚑ a Claude conversation this app started, with no model recorded, is recorded as the model its
 *    newest reply names — the control every refusal below sits beside.
 *  - ⛔ a transcript that is a link out of the profile's home is not read.
 *  - ⛔ a conversation brought in (`adopt`) is not read, though its file is in the same home.
 *  - ⛔ a Codex conversation is not read, though a file the Claude guard would pass is there.
 *
 * ⚑ Real host, real SQLite ledger; the archive's lookup (`nativeTranscriptPath`) is a map from the
 * provider's id to a file this test wrote. ⛔ Every folder is a `mkdtemp` one, removed after; the
 * adopted row is given a profile, so even a host with its guard removed reads only this test's
 * folders, never the user's own home.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

/** One Claude Code transcript line: a reply that names its model. */
const aReply = (model: string): string =>
  `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, content: [] } })}\n`

describe('the model an older conversation’s own transcript records', () => {
  let userData: string
  let workspace: string
  let outside: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  /** The archive's lookup: the provider's id → the file found for it. */
  let transcripts: Map<string, string>

  const tick = (): number => clock++
  const homeOf = (provider: Provider, profileId: string): string =>
    join(userData, 'provider-homes', profileId, provider)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-older-transcript-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-older-transcript-cwd-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot2-older-transcript-outside-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    transcripts = new Map()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
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
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, workspace, outside]) rmSync(dir, { recursive: true, force: true })
  })

  /** A file at `path`, its folders made. */
  const aFile = (path: string, text: string): string => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }

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

  /** ⚑ The host's pass over the older conversations, then what it recorded as each one's model. */
  const recordTheOlderOnes = async (): Promise<{ recorded: number; noRecordLeft: number }> =>
    host.recordWhatTheOlderOnesRan()
  const reportedOf = (id: string): string | null => store.whatItRunsOn(id)?.reportedModel ?? null

  /** ⚑ The control: a plain transcript in the profile's own `projects/`, newest reply `m1`. */
  const thePlainOne = (): string => {
    const id = aConversationThisAppStarted(
      'sess_plain',
      'claude',
      aFile(join(homeOf('claude', 'pm'), 'projects', 'p', 'p_sess_plain.jsonl'), aReply('m1')),
    )
    // Premise: nothing about its model is recorded here.
    expect(store.whatItRunsOn(id)).toMatchObject({ model: null, reportedModel: null })
    return id
  }

  it('⚑ a Claude conversation this app started, with no model recorded, is recorded as the model its transcript’s newest reply names', async () => {
    const plain = thePlainOne()
    expect(await recordTheOlderOnes()).toEqual({ recorded: 1, noRecordLeft: 0 })
    expect(reportedOf(plain)).toBe('m1')
  })

  it('⛔ a transcript named like a record that is a link leading out of the profile’s home is not read — ⚑ the transcript beside it is', async () => {
    const plain = thePlainOne()
    const elsewhere = aFile(join(outside, 'someone-elses.jsonl'), aReply('m-outside'))
    const link = join(homeOf('claude', 'pm'), 'projects', 'p', 'p_sess_link.jsonl')
    symlinkSync(elsewhere, link)
    const linked = aConversationThisAppStarted('sess_link', 'claude', link)
    // Premise: through the link the file reads as a reply naming `m-outside`, and only the record
    // guard tells it apart from the plain one.
    expect(newestReplyModel(link)).toBe('m-outside')
    expect(isTheProvidersRecord('claude', homeOf('claude', 'pm'), link)).toBe(false)
    const pass = await recordTheOlderOnes()
    // ⛔ Not read: counted as having no record left, and nothing recorded for it.
    expect(reportedOf(linked)).toBeNull()
    // ⚑ The control, beside it in the same folder.
    expect(reportedOf(plain)).toBe('m1')
    expect(pass).toEqual({ recorded: 1, noRecordLeft: 1 })
  })

  it('⛔ a conversation brought in from the profile’s home, not started here, is not read — ⚑ one this app started, in the same home, is', async () => {
    const plain = thePlainOne()
    const transcript = aFile(
      join(homeOf('claude', 'pm'), 'projects', 'p', 'p_sess_adopted.jsonl'),
      aReply('m-adopted'),
    )
    store.adopt({
      id: 'sess_adopted',
      provider: 'claude',
      sessionId: 'p_sess_adopted',
      cwd: workspace,
      profileId: 'pm',
      createdAt: NOW,
      updatedAt: NOW,
    })
    transcripts.set('p_sess_adopted', transcript)
    // Premise: it is held as brought in, no model recorded, and its file passes the record guard.
    expect(store.find('sess_adopted')?.adoptedAt).not.toBeNull()
    expect(store.whatItRunsOn('sess_adopted')).toMatchObject({ model: null, reportedModel: null })
    expect(isTheProvidersRecord('claude', homeOf('claude', 'pm'), transcript)).toBe(true)
    const pass = await recordTheOlderOnes()
    // ⛔ Not read — not even counted: it is passed over before any file is looked for.
    expect(reportedOf('sess_adopted')).toBeNull()
    // ⚑ The control.
    expect(reportedOf(plain)).toBe('m1')
    expect(pass).toEqual({ recorded: 1, noRecordLeft: 0 })
  })

  it('⛔ a Codex conversation is not asked of a transcript — ⚑ a Claude one is', async () => {
    const plain = thePlainOne()
    // A file the Claude guard WOULD pass for the Codex home, so only the provider check stops it.
    const codexHome = homeOf('codex', 'pm')
    const file = aFile(join(codexHome, 'projects', 'p', 'p_sess_codex.jsonl'), aReply('m-codex'))
    const codex = aConversationThisAppStarted('sess_codex', 'codex', file)
    expect(isTheProvidersRecord('claude', codexHome, file)).toBe(true)
    expect(store.whatItRunsOn(codex)).toMatchObject({ model: null, reportedModel: null })
    const pass = await recordTheOlderOnes()
    // ⛔ Not read — passed over before any file is looked for.
    expect(reportedOf(codex)).toBeNull()
    // ⚑ The control.
    expect(reportedOf(plain)).toBe('m1')
    expect(pass).toEqual({ recorded: 1, noRecordLeft: 0 })
  })
})
