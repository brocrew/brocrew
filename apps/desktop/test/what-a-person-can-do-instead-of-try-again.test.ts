import { neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import * as unavailable from '../src/main/runtime/session-unavailable'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const TRY_AGAIN = /try again/i

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('the four sentences say what happens and what a person can do', () => {
  const say = unavailable.describeUnavailable

  it('none of the four says *try again* — with its context or without', () => {
    const reasons = [
      'run-by-another-host',
      'still-opening',
      'took-too-long',
      'still-closing',
    ] as const
    for (const reason of reasons) {
      for (const context of [
        {},
        { reopening: true as const },
        { openingForMs: 3_000, waitedForMs: 15_000 },
      ]) {
        expect(say(reason, context), `${reason} ${JSON.stringify(context)}`).not.toMatch(TRY_AGAIN)
      }
    }
  })

  it('`run-by-another-host` — where the way back in is', () => {
    expect(say('run-by-another-host')).toContain(
      'so it was not opened here. It can continue here once that part has let it go.',
    )
  })

  it('`still-opening` — it ends by itself, and says so', () => {
    expect(say('still-opening', { openingForMs: 3_000 })).toBe(
      'This conversation is still opening — it is waiting for its agent to answer. It has been opening for 3s. It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it.',
    )
    expect(say('still-opening')).toContain('does not answer in time')
  })

  it('`took-too-long` — a start is started again; a reopen is sent its message again', () => {
    const start = say('took-too-long', { waitedForMs: 15_000 })
    const reopen = say('took-too-long', { waitedForMs: 15_000, reopening: true })
    expect(start).toContain('No conversation was made: start it again.')
    expect(reopen).toContain('The conversation is kept: send it your message again.')
    for (const sentence of [start, reopen]) {
      expect(sentence).toContain('BroCrew observed no further launch progress for 15s')
      expect(sentence).toContain('stopped waiting and requested cancellation')
      expect(sentence).not.toContain('shut it down')
      expect(sentence).not.toContain('provider is not responding')
    }
  })

  it('`still-closing` — a message is the gesture, and a message that waited is told so', () => {
    expect(say('still-closing')).toBe(
      "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done.",
    )
    expect(say('still-closing', { reopening: true })).toBe(
      "BroCrew was still putting away this conversation's last session and waited as long as it will, so your message did not go in. To wait longer, send it your message again.",
    )
  })
})

describe('what a person reads at the door', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** When set, every start and resume waits for this — a provider that does not answer. */
  let stall: Promise<never> | null
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-f5-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    stall = null
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider): AgentRuntime => {
        const real = new FakeRuntime(provider, { sessions })
        return {
          provider,
          // The model list answers so a launch can name its model; only the handshake stalls.
          listModels: (context) => real.listModels(context),
          start: (opts) => (stall === null ? real.start(opts) : stall),
          resume: (ref, opts) => (stall === null ? real.resume(ref, opts) : stall),
        }
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      // bounds on the machine, not on the rule: a stalled provider is given up quickly here
      launchTimeoutMs: 60,
      closeDrainTimeoutMs: 20,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('a REOPEN whose agent did not answer is told to send its message again, not to start it', async () => {
    const window = new Sink('webContents:1')
    const { sessionId } = await host.createSession(
      { provider: 'codex', cwd: userData, approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)
    stall = new Promise<never>(() => {})
    const failure = await host.resumeSession(sessionId, window).catch((error: Error) => error)
    expect((failure as Error).message).toContain('observed no further launch progress for 0s')
    expect((failure as Error).message).toContain(
      'The conversation is kept: send it your message again.',
    )
    expect((failure as Error).message).not.toMatch(TRY_AGAIN)
  })

  it('a START whose agent did not answer is told to start it again', async () => {
    stall = new Promise<never>(() => {})
    const failure = await host
      .createSession(
        { provider: 'codex', cwd: userData, approvalMode: 'ask' },
        new Sink('webContents:1'),
      )
      .catch((error: Error) => error)
    expect((failure as Error).message).toContain('No conversation was made: start it again.')
    expect((failure as Error).message).toContain(
      'BroCrew observed no further launch progress for 0s',
    )
  })

  it('the claim door: a start in flight says it opens by itself, or is stopped and says so', async () => {
    stall = new Promise<never>(() => {})
    // The reservation stands as soon as createSession returns, before the 60ms bound ends it.
    const launching = host
      .createSession({ provider: 'codex', cwd: userData, approvalMode: 'ask' }, null)
      .catch(() => {})
    expect(() => host.claimSession('sess_1', new Sink('webContents:2'))).toThrow(
      /It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it\./,
    )
    await launching
  })

  it('the claim door: a start a person CLOSED is still closing — not *still opening*', async () => {
    stall = new Promise<never>(() => {})
    const window = new Sink('webContents:1')
    const launching = host
      .createSession({ provider: 'codex', cwd: userData, approvalMode: 'ask' }, window)
      .catch(() => {})
    const closing = host.close('sess_1', window)
    expect(() => host.claimSession('sess_1', new Sink('webContents:2'))).toThrow(
      unavailable.describeUnavailable('still-closing'),
    )
    await closing.catch(() => {})
    await launching
  })
})
