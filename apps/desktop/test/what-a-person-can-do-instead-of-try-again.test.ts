import { fixtureProviderConfig, neutralHostDeps, prepareUnprofiledHome } from './lib/host-fixture'
import { migratedSessionStore } from './lib/migrated-session-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import * as unavailable from '../src/main/runtime/session-unavailable'

const TRY_AGAIN = /try again/i

function untilCancelled(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('the launch was cancelled')), {
      once: true,
    })
  })
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('§1 · the four sentences say what happens and what a person can do', () => {
  const say = unavailable.describeUnavailable

  it('🔴 none of them says *try again* — with its context or without', () => {
    const reasons = ['run-by-another-host', 'still-opening', 'still-closing'] as const
    for (const reason of reasons) {
      for (const context of [{}, { reopening: true as const }, { openingForMs: 3_000 }]) {
        expect(say(reason, context), `${reason} ${JSON.stringify(context)}`).not.toMatch(TRY_AGAIN)
      }
    }
  })

  it('🔴 `run-by-another-host` — where the way back in is', () => {
    expect(say('run-by-another-host')).toContain(
      'so it was not opened here. It can continue here once that part has let it go.',
    )
  })

  it('🔴 `still-opening` — it ends by itself, and says so', () => {
    expect(say('still-opening', { openingForMs: 3_000 })).toBe(
      'This conversation is still opening — it is waiting for its agent to answer. It has been opening for 3s. It opens by itself when its agent answers.',
    )
    expect(say('still-opening')).not.toContain('in time')
  })

  it('🔴 `still-closing` — a message is the gesture, and a message that waited is told so', () => {
    expect(say('still-closing')).toBe(
      "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done.",
    )
    expect(say('still-closing', { reopening: true })).toBe(say('still-closing'))
  })

  it('⛔ `saidOfAReopen` changes the context and nothing else — reason, message and cause kept', () => {
    const cause = new Error('the errno')
    const refused = new unavailable.SessionUnavailable(
      'machine-ran-short',
      'diag',
      { openingForMs: 9 },
      { cause },
    )
    const said = unavailable.saidOfAReopen?.(refused) as InstanceType<
      typeof unavailable.SessionUnavailable
    >
    expect(said).toBeInstanceOf(unavailable.SessionUnavailable)
    expect(said.unavailable).toBe('machine-ran-short')
    expect(said.message).toBe('diag')
    expect(said.cause).toBe(cause)
    expect(said.context).toEqual({ openingForMs: 9, reopening: true })
    const other = new Error('not a refusal')
    expect(unavailable.saidOfAReopen?.(other)).toBe(other)
  })
})

describe('§2 · what a person reads at the door', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let stall: boolean
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-f5-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    store = migratedSessionStore(db)
    stall = false
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider): AgentRuntime => {
        const real = new FakeRuntime(provider, { sessions })
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: (opts) => (stall ? untilCancelled(opts.signal) : real.start(opts)),
          resume: (ref, opts) => (stall ? untilCancelled(opts.signal) : real.resume(ref, opts)),
        }
      },
      prepareProviderHome: (provider: Provider) => prepareUnprofiledHome(userData, provider),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 20,
      readProviderConfig: fixtureProviderConfig,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('🔴 the claim door: a start in flight says it opens by itself', async () => {
    stall = true
    void host
      .createSession({ provider: 'codex', cwd: userData, approvalMode: 'ask' }, null)
      .catch(() => {})
    expect(() => host.claimSession('sess_1', new Sink('webContents:2'))).toThrow(
      /It opens by itself when its agent answers\.$/,
    )
  })

  it('🔴 the claim door: a start a person CLOSED is still closing — not *still opening*', async () => {
    stall = true
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
