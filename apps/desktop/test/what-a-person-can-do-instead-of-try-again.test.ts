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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import * as unavailable from '../src/main/runtime/session-unavailable'

/**
 * # 🔴 716 · `710` F-5, the main half — what a person can do, instead of *"try again"*
 *
 * ⚑ **The item, verbatim**: *"`describeUnavailable`'s four 'try again (in a moment)' sentences
 * (`run-by-another-host`, `still-opening`, `took-too-long`, `still-closing`). Each says what happened
 * and what a person can do (rule 8.4)."* ⚑ **Standing rule 8.4**: *"When a test pins a mechanism's
 * limit, someone asks what a person SEES at that limit."*
 *
 * ⚑ **What each one says now, derived from the code** (`716`'s map):
 *
 * | reason | what the app does by itself | what a person can do |
 * |---|---|---|
 * | `run-by-another-host` | nothing — the other part runs on | continue it here once that part has let it go |
 * | `still-opening` | the start registers when its agent answers, however long that takes | nothing: it opens by itself |
 * | `still-closing` | the teardown runs on | a claim or a hand-back: a message sent to it waits; a reopen waits for it |
 *
 * ⚑ **D-017b · the gesture column changed and the rule did not.** There is no Reopen press any more
 * — one press opens every conversation, and a message is what continues it — so every *reopen it*
 * in the column above became the message, and *closing* became what BroBot does: *putting away the
 * last session* (no process word, `05` rule 5). Each sentence still says what happens and what a
 * person can do, and none says *try again*.
 *
 * ⚑ And a correction the map found on the way: the claim door told a reservation a person CLOSED that
 * it was *"still opening"* (its order now matches `reserve`'s). ⚠️ Review of `716`: neither
 * `still-opening` nor the claim's `still-closing` promises a reopen — a START in flight leaves no row.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const TRY_AGAIN = /try again/i

/** A provider that never answers its launch and stops when the launch is cancelled, as both do. */
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the sentences
// ─────────────────────────────────────────────────────────────────────────────────────────────

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
    // ⛔ A slow agent is waited for: nothing says BroCrew stops it for taking long.
    expect(say('still-opening')).not.toContain('in time')
  })

  it('🔴 `still-closing` — a message is the gesture, and a message that waited is told so', () => {
    // ⚑ D-017b — no process words (*its agent is being stopped*), and the gesture is the message.
    expect(say('still-closing')).toBe(
      "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done.",
    )
    // ⚑ A reopen waits for the close however long it takes, so it is told the same thing.
    expect(say('still-closing', { reopening: true })).toBe(say('still-closing'))
  })

  // ⛔ **The helper's own bound**, and ⛔ rather than ⚑: it is new in `716`, so on `main` it cannot run
  // at all. The behavioural RED is §2's reopen.
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
    // ⚑ …anything else, as it came
    const other = new Error('not a refusal')
    expect(unavailable.saidOfAReopen?.(other)).toBe(other)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · at the doors that reach them
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · what a person reads at the door', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** When set, every start and resume waits until it is cancelled — a provider that does not answer. */
  let stall: boolean
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-f5-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    stall = false
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider): AgentRuntime => {
        const real = new FakeRuntime(provider, { sessions })
        return {
          provider,
          // ⚑ **D-042 · R1 moved a fact here: a launch NAMES its model and effort before it
          // spawns**, and a Codex launch naming nothing reads `model/list` and names its
          // `isDefault` row. An empty list now refuses the start (`nothing-names-a-model`, F2)
          // before the stall below is reached, so the sentence a person reads would be that
          // refusal's and not the launch bound's. The Fake's own list answers, as `real` answers
          // the start — its first row is Codex's default, by name — and only the HANDSHAKE stalls.
          listModels: (context) => real.listModels(context),
          start: (opts) => (stall ? untilCancelled(opts.signal) : real.start(opts)),
          resume: (ref, opts) => (stall ? untilCancelled(opts.signal) : real.resume(ref, opts)),
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

  it('🔴 the claim door: a start in flight says it opens by itself', async () => {
    stall = true
    // ⚑ The reservation is taken in `createSession`'s synchronous stretch, so it stands the moment
    // the call returns.
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
    // ⚑ it is not opening: whatever arrives is handed back (`SessionStillStarting`'s note)
    expect(() => host.claimSession('sess_1', new Sink('webContents:2'))).toThrow(
      unavailable.describeUnavailable('still-closing'),
    )
    await closing.catch(() => {})
    await launching
  })
})
