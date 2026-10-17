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
 * | `still-opening` | the start registers, or is given up at the launch bound and says so | nothing: it opens by itself |
 * | `took-too-long` | the start was stopped | a START: start it again · a REOPEN: send it your message again |
 * | `still-closing` | the teardown runs on | a claim or a hand-back: a message sent to it waits · a REOPEN (which already waited): send it again to wait longer |
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

  it('🔴 none of the four says *try again* — with its context or without', () => {
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

  it('🔴 `run-by-another-host` — where the way back in is', () => {
    expect(say('run-by-another-host')).toContain(
      'so it was not opened here. It can continue here once that part has let it go.',
    )
  })

  it('🔴 `still-opening` — it ends by itself, and says so', () => {
    expect(say('still-opening', { openingForMs: 3_000 })).toBe(
      'This conversation is still opening — it is waiting for its agent to answer. It has been opening for 3s. It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it.',
    )
    expect(say('still-opening')).toContain('does not answer in time')
  })

  it('🔴 `took-too-long` — a start is started again; a reopen is sent its message again', () => {
    const start = say('took-too-long', { waitedForMs: 15_000 })
    const reopen = say('took-too-long', { waitedForMs: 15_000, reopening: true })
    expect(start).toContain('No conversation was made: start it again.')
    // ⚑ D-017b — a message continues it; there is no Reopen press to name.
    expect(reopen).toContain('The conversation is kept: send it your message again.')
    for (const sentence of [start, reopen]) {
      expect(sentence).toContain('agent did not answer within 15s')
      expect(sentence).toContain(
        'If it keeps not answering, its provider is not responding on this machine.',
      )
    }
  })

  it('🔴 `still-closing` — a message is the gesture, and a message that waited is told so', () => {
    // ⚑ D-017b — no process words (*its agent is being stopped*), and the gesture is the message.
    expect(say('still-closing')).toBe(
      "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done.",
    )
    expect(say('still-closing', { reopening: true })).toBe(
      "BroCrew was still putting away this conversation's last session and waited as long as it will, so your message did not go in. To wait longer, send it your message again.",
    )
  })

  // ⛔ **The helper's own bound**, and ⛔ rather than ⚑: it is new in `716`, so on `main` it cannot run
  // at all. The behavioural RED is §2's reopen.
  it('⛔ `saidOfAReopen` changes the context and nothing else — reason, message and cause kept', () => {
    const cause = new Error('the errno')
    const refused = new unavailable.SessionUnavailable(
      'took-too-long',
      'diag',
      { waitedForMs: 9 },
      { cause },
    )
    const said = unavailable.saidOfAReopen?.(refused) as InstanceType<
      typeof unavailable.SessionUnavailable
    >
    expect(said).toBeInstanceOf(unavailable.SessionUnavailable)
    expect(said.unavailable).toBe('took-too-long')
    expect(said.message).toBe('diag')
    expect(said.cause).toBe(cause)
    expect(said.context).toEqual({ waitedForMs: 9, reopening: true })
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
      // ⚠️ bounds on the MACHINE, not on the rule: a stalled provider is given up quickly here
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

  it('🔴 a REOPEN whose agent did not answer is told to send its message again, not to start it', async () => {
    const window = new Sink('webContents:1')
    const { sessionId } = await host.createSession(
      { provider: 'codex', cwd: userData, approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)
    stall = new Promise<never>(() => {})
    const failure = await host.resumeSession(sessionId, window).catch((error: Error) => error)
    expect((failure as Error).message).toContain('did not answer within 0s')
    expect((failure as Error).message).toContain(
      'The conversation is kept: send it your message again.',
    )
    expect((failure as Error).message).not.toMatch(TRY_AGAIN)
  })

  it('🔴 a START whose agent did not answer is told to start it again', async () => {
    stall = new Promise<never>(() => {})
    const failure = await host
      .createSession(
        { provider: 'codex', cwd: userData, approvalMode: 'ask' },
        new Sink('webContents:1'),
      )
      .catch((error: Error) => error)
    expect((failure as Error).message).toContain('No conversation was made: start it again.')
  })

  it('⚑ control — a start that took too long still says so, and for how long', async () => {
    // ⚑ True on `main` too: what F-5 changed is the gesture after it, never the fact.
    stall = new Promise<never>(() => {})
    const failure = await host
      .createSession(
        { provider: 'codex', cwd: userData, approvalMode: 'ask' },
        new Sink('webContents:1'),
      )
      .catch((error: Error) => error)
    expect((failure as Error).message).toContain(
      "This conversation's agent did not answer within 0s",
    )
  })

  it('🔴 the claim door: a start in flight says it opens by itself, or is stopped and says so', async () => {
    stall = new Promise<never>(() => {})
    // ⚑ The reservation is taken in `createSession`'s synchronous stretch, so it stands the moment
    // the call returns — and asked THEN, before the 60ms bound can end it.
    const launching = host
      .createSession({ provider: 'codex', cwd: userData, approvalMode: 'ask' }, null)
      .catch(() => {})
    expect(() => host.claimSession('sess_1', new Sink('webContents:2'))).toThrow(
      /It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it\./,
    )
    await launching
  })

  it('🔴 the claim door: a start a person CLOSED is still closing — not *still opening*', async () => {
    stall = new Promise<never>(() => {})
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
