import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  FakeProviderSessions,
  claudeCommandIn,
  type ClaudeLoginRenewal,
  type FakeSessionHandle,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { prepareOnTheLogin } from '../src/main/providers/claude'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # The setup steps name the Claude Code BroBot found
 *
 * The Providers card and the setup window tell a person to run Claude Code to sign in. They read
 * the command from main, which writes the program its launches run by its full path, for this
 * computer's shell: a new PowerShell may not search the folder Anthropic's installer puts it in.
 *
 * ⚑ A made-up program path; nothing is run.
 */

/** A window nobody reads from. */
const sink: RuntimeEventSink = {
  aPersonIsBehindIt: true,
  alive: true,
  ownerId: sinkOwnerId({ id: 1 }),
  send() {},
  sendLiveness() {},
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('the setup steps name the Claude Code BroBot found', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost

  const hostWith = (
    claudeProgramFound?: () => string | null,
    login?: { renew: () => Promise<ClaudeLoginRenewal>; refused: boolean },
  ): RuntimeHost => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-setup-command-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    let made = 0
    return new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        if (provider === 'claude' && login?.refused === true) {
          throw new AuthUnavailableError('claude', 'the expired login')
        }
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++made)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      ...(claudeProgramFound === undefined ? {} : { programFound: () => claudeProgramFound() }),
      ...(login === undefined ? {} : {
        loginRenewal: (provider: Provider) => provider === 'claude' ? {
          launchLabel: 'Claude sign-in renewal',
          renew: login.renew,
          prepare: (prepare: () => string | Promise<string>, renew: typeof login.renew) =>
            prepareOnTheLogin(prepare, renew, () => claudeCommandIn(claudeProgramFound?.() ?? null, process.platform)),
        } : undefined,
      }),
    })
  }

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('🔴 the program found, by its full path, as this computer’s shell runs it', () => {
    const program =
      process.platform === 'win32'
        ? 'C:\\Users\\Jo Example\\.local\\bin\\claude.exe'
        : '/Users/some one/.local/bin/claude'
    host = hostWith(() => program)
    expect(host.providerSetup().claude).toMatchObject({
      signInCommand: claudeCommandIn(program, process.platform),
      shell: process.platform === 'win32' ? 'PowerShell' : 'Terminal',
    })
    expect(host.providerSetup().claude?.signInCommand).toContain(program)
  })

  it('⚑ none found, or nobody asked: `claude`, as the installer’s own steps say', async () => {
    host = hostWith(() => null)
    expect(host.providerSetup().claude?.signInCommand).toBe('claude')
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    host = hostWith()
    expect(host.providerSetup().claude?.signInCommand).toBe('claude')
  })

  it('🔴 a start whose login could not be renewed says to run the program found', async () => {
    const program = '/Users/some one/.local/bin/claude'
    let asked = 0
    host = hostWith(
      () => {
        asked += 1
        return program
      },
      { renew: async () => 'not-renewed', refused: true },
    )
    await expect(host.createSession({ provider: 'claude' }, sink)).rejects.toThrow(
      `\`${claudeCommandIn(program, process.platform)}\``,
    )
    expect(asked).toBe(1)
  })

  it('⚑ a start on a login that is fine does not look for the program', async () => {
    let asked = 0
    host = hostWith(
      () => {
        asked += 1
        return '/x/claude'
      },
      { renew: async () => 'not-needed', refused: false },
    )
    await host.createSession({ provider: 'claude' }, sink)
    expect(asked).toBe(0)
  })

  it('⚑ the program is looked for when asked, so one installed meanwhile is named', () => {
    let found: string | null = null
    host = hostWith(() => found)
    expect(host.providerSetup().claude?.signInCommand).toBe('claude')
    found = '/Users/someone/.local/bin/claude'
    expect(host.providerSetup().claude?.signInCommand).toContain(found)
  })
})
