import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  whyNoClaudeLogin,
  FakeRuntime,
  allProviderCapabilities,
  claudeProjectDirName,
  type RuntimeEvent,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { theStallAndItsAsk } from '../src/main/runtime/reply-rails'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import { derivePieces, type PieceRow } from '../src/shared/tasks'

/**
 * # A Claude key that stops working is said as a key, and reading old history needs no credential
 *
 * **§1–§4 · the refused key.** A Claude conversation launched on the API key a person saved, whose
 * key Anthropic then refuses (401), used to read as the Mac's login renewed elsewhere — *"If your
 * machine’s Claude login was renewed elsewhere on this computer…"*, and to its giver *"as it does
 * when another Claude on this computer renews or switches the login"*. Nothing on the Mac moved, and
 * nothing reopens it by itself. The runtime marks the refusal `onAKey` (its own test is in
 * `claude-runtime.test.ts`), and each surface says the key and where to check or replace it. A
 * conversation on the Mac's login reads exactly as before: every section has that control.
 *
 * **§5 · the import.** Catching up with old Claude history (the pass after a scan, and a Library
 * row's Import) went through the launch call, which asks for Claude's login or key and throws
 * without one — so on a Mac with neither, files already on disk logged *"could not be imported"*.
 * Reading them needs no credential, and the import no longer asks for one.
 *
 * ⚑ Fake values only: no key, token or login is read or written by any test here.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the conversation's own notice
// ─────────────────────────────────────────────────────────────────────────────────────────────

const noticesFor = (...events: RuntimeEvent[]): NoticeItem[] => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items.filter((item): item is NoticeItem => item.kind === 'notice')
}

const REFUSED = (onAKey: boolean): RuntimeEvent => ({
  type: 'error',
  message: onAKey
    ? 'Invalid API key · Fix external API key'
    : 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
  fatal: true,
  cause: 'auth_stale',
  ...(onAKey ? { onAKey: true as const } : {}),
})

describe('§1 · the refusal’s notice names the credential it refused', () => {
  it('🔴 on a key: the key, the card it is checked on, and what a message then does — no login', () => {
    const [notice] = noticesFor(REFUSED(true))
    expect(notice?.level).toBe('error')
    expect(notice?.text).toContain(
      'Anthropic refused the API key this conversation was started with',
    )
    expect(notice?.text).toContain('“API key” on the Claude card in Providers')
    expect(notice?.text).toContain('send this conversation a message to carry on')
    expect(notice?.text).not.toMatch(/login|renewed|elsewhere on this Mac/)
    // ⚑ The provider's own words stay out of the notice, as for the login (085's split).
    expect(notice?.text).not.toContain('Fix external API key')
  })

  it('⚑ control: on the Mac’s login, today’s words exactly', () => {
    const [notice] = noticesFor(REFUSED(false))
    expect(notice?.text).toContain(
      'The sign-in this conversation was launched with is no longer valid',
    )
    expect(notice?.text).toContain('renewed elsewhere on this computer')
    expect(notice?.text).not.toContain('API key')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the piece of work it was driving
// ─────────────────────────────────────────────────────────────────────────────────────────────

let ordinal = 0
let clock = 9_000_000
const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})
const theTask = (entries: TranscriptEvent[]): PieceRow => {
  ordinal = 0
  clock = 9_000_000
  const found = derivePieces('sess_worker', entries.map(row), { backgroundWakesIt: true })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

const given: TranscriptEvent = {
  type: 'work_given',
  piece: 'work_7',
  label: 'W1.7',
  parent: 'work_root',
  givenBy: 'sess_giver',
  title: 'Build the index',
  brief: 'build the index',
}
const itsTurn: TranscriptEvent[] = [
  given,
  { type: 'user_turn', text: 'build the index' },
  { type: 'status', state: 'working' },
]
const failedOn = (onAKey: boolean): TranscriptEvent[] => [
  ...itsTurn,
  {
    type: 'turn',
    state: 'failed',
    wordOf: 'this-app',
    loginRefused: true,
    ...(onAKey ? { onAKey: true as const } : {}),
  },
  { type: 'status', state: 'errored', loginRefused: true, ...(onAKey ? { onAKey: true } : {}) },
]

describe('§2 · the piece it stalled remembers that it was a key', () => {
  it('🔴 a turn that failed on a key: the same stall, and the row says it was a key', () => {
    expect(theTask(failedOn(true))).toMatchObject({
      state: 'stalled',
      stalledBecause: 'login_refused',
      stoppedOnALogin: { reopened: false, onAKey: true },
    })
  })

  it('⚑ control: one that failed on the Mac’s login carries no key', () => {
    const task = theTask(failedOn(false))
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'login_refused' })
    expect(task.stoppedOnALogin).toEqual({ reopened: false })
  })

  it('🔴 a reopen since keeps it a key', () => {
    expect(
      theTask([...failedOn(true), { type: 'reopened' } as TranscriptEvent]).stoppedOnALogin,
    ).toEqual({ reopened: true, onAKey: true })
  })

  it('🔴 a background wake the key’s refusal stopped — the session’s own status says it', () => {
    // ⚑ A wake that never wrote a turn row: only the session's terminal status ends it.
    const task = theTask([
      ...itsTurn,
      { type: 'background_work', running: [{ id: 'bg_1' }], source: 'test' } as TranscriptEvent,
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
      {
        type: 'background_work',
        ended: { id: 'bg_1', outcome: 'completed' },
        source: 'test',
      } as TranscriptEvent,
      { type: 'status', state: 'working' },
      { type: 'status', state: 'errored', loginRefused: true, onAKey: true },
    ])
    expect(task).toMatchObject({
      stalledBecause: 'login_refused',
      stoppedOnALogin: { reopened: false, onAKey: true },
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · what its giver is told
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the giver is told the key was refused, and who can fix it', () => {
  it('🔴 on a key: the key, the card, and that a person has to do it — no renewal', () => {
    const said = theStallAndItsAsk('login_refused', null, undefined, {
      reopened: false,
      onAKey: true,
    })
    expect(said).toBe(
      'its turn failed because Claude refused the Anthropic API key its conversation was started with, so a person needs to check or replace that key under “API key” on the Claude card in Providers, and its conversation has not been reopened since',
    )
  })

  it('⚑ control: on the Mac’s login, today’s sentence', () => {
    const said = theStallAndItsAsk('login_refused', null, undefined, { reopened: true })
    expect(said).toContain(
      'as it does when another Claude on this computer renews or switches the login',
    )
    expect(said).toContain('its conversation has been reopened since')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the Providers card
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the Claude card’s facts are true with a key saved and without', () => {
  it('🔴 each fact that named the Mac’s login as the only way names the saved key first', () => {
    const claude = allProviderCapabilities().claude
    const reasonOf = (status: { readonly state: string } & Record<string, unknown>): string =>
      String(status['reason'] ?? '')
    expect(reasonOf(claude.signIn)).toContain('the API key saved under “API key”')
    expect(reasonOf(claude.signIn)).toContain('with none saved, on your machine login')
    expect(reasonOf(claude.reprovisionAuth)).toContain('with no API key saved')
    expect(reasonOf(claude.homeCredential)).toContain(
      'the saved API key, or with none your machine login',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · importing old history needs no credential
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const migrations = join(here, '../src/main/db/migrations')
const ID = 'sess_child'

describe('§5 · an import with no login and no key reads the files it already has', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** How many times anything asked for a credential (the launch call). */
  let launchesAsked: number

  const homeOf = (provider: Provider, profileId: string): string =>
    join(dir, 'homes', profileId, provider)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-no-credential-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    launchesAsked = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      // ⚑ **A Mac with neither a Claude login nor a saved key**: the launch call refuses, as the
      // real one does (`prepareProviderHome` → `claudeAuthHealth`).
      prepareProviderHome: () => {
        launchesAsked += 1
        throw new AuthUnavailableError('claude', whyNoClaudeLogin({ platform: 'darwin' }))
      },
      providerHomePath: (provider, profileId) => homeOf(provider, profileId),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    // An app-owned adopted row, its conversation in the home this app made for it.
    store.adopt({
      id: ID,
      provider: 'claude',
      sessionId: `${ID}-thread`,
      cwd: join(dir, 'work'),
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
    })
    const projectDir = join(
      homeOf('claude', 'default'),
      'projects',
      claudeProjectDirName(join(dir, 'work')),
    )
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${ID}-thread.jsonl`), readFileSync(CLAUDE_FIXTURE, 'utf8'))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('🔴 a Library row’s Import brings the conversation in, and asks for no credential', async () => {
    expect(store.ledgerStatus(ID).present, 'the fixture must start with nothing to read').toBe(
      false,
    )
    const result = await host.importRecordedSession(ID)
    expect(result.outcome).toBe('imported')
    expect(store.events(ID).length).toBeGreaterThan(0)
    expect(launchesAsked).toBe(0)
  })

  it('🔴 the catch-up pass after a scan imports it, and logs no “could not be imported”', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const report = await host.adoptSessions()
    expect(report.skipped.map((one) => one.reason).join(' ')).not.toContain('could not be imported')
    expect(warned.mock.calls.flat().join(' ')).not.toContain('could not be imported')
    expect(report.imported).toBe(1)
    expect(launchesAsked).toBe(0)
  })

  it('⚑ control: a start still asks for one, and is refused without it', async () => {
    const sink: RuntimeEventSink = {
      ownerId: 'owner:1',
      aPersonIsBehindIt: false,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }
    await expect(
      host.createSession({ provider: 'claude', cwd: join(dir, 'work') }, sink),
    ).rejects.toThrow(whyNoClaudeLogin({ platform: 'darwin' }))
    expect(launchesAsked).toBe(1)
  })
})
