import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { type HandedPath } from '../src/shared/runtime-ipc'

/** An ordinary first message with an attachment reaches the reopened conversation. */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: unknown[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('735 M4 · a race the second ask sees refuses without joining the arrivals queue', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: AWindow
  let issued: FakeProviderSessions
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-735-m4-'))
    // ⚑ Real path: a handed attachment is refused when the path it names and the path it resolves
    // to differ, and macOS hands out `/var/…` for `/private/var/…`.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-735-m4-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new AWindow('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const listed = (sessionId: string): { running: string } => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    if (row === undefined) throw new Error(`${sessionId} is not listed`)
    return { running: row.running }
  }

  /** ⚑ A person's conversation, open and idle when the person quit; the next launch has it kept open. */
  const aConversationTheQuitLeftOpen = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2')
    expect(listed(sessionId).running, 'the premise: the quit left it open').toBe('not-running')
    return sessionId
  }

  /** ⚑ A file the person attached, as main classified it when they did. */
  const attached = (name: string): HandedPath => {
    const path = join(root, name)
    writeFileSync(path, 'the notes\n')
    return { path, kind: 'file', outsideCwd: false }
  }

  it('a first message with an attachment is answered and sent', async () => {
    const id = await aConversationTheQuitLeftOpen()
    const notes = attached('notes.md')
    const answer = await host.startAndSend(id, 'hello', window, [notes])
    expect('sent' in answer && answer.sent.sessionId, JSON.stringify(answer)).toBe(id)
  })
})
