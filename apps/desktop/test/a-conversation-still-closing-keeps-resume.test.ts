import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 716 · R62 — a conversation still closing says so, beside `running`
 *
 * ⚑ **PM ruling R62** (`712` F-2, amends R57): *"A conversation still closing keeps Resume. The
 * standing main ruling wins: the reopen is the gesture that works (the host waits up to 10 s for the
 * close, then reopens). The row says it is still closing and that Resume waits for it. ⚑ Main owes
 * the fact: `closing: boolean` beside `running` (not a fourth `RunningState`) on
 * `ResumableSessionInfo` and `UnresumableSessionInfo`, set as `slot !== undefined &&
 * onItsWayOut(slot)`."*
 *
 * ⚠️ **Why a field and not a reading of `running`**: a closing conversation is `not-running` —
 * `runningStateOf`'s ruling — exactly as a conversation nothing has run since a crash is. Those two
 * rows were indistinguishable on the wire until `716`, and the frontend could not say *still
 * closing* about one without saying it about the other.
 *
 * ⚑ **D-017b retired the field** (`05` rule 5): *still closing* is a sentence about a process, and
 * the window says none. ⚑ So the arms now pin that the wire carries no such word — a close in flight
 * and a row a dead process left read the same `running` and the same one `state` — and R62's
 * premise, which D-017b keeps: the gesture that carries the conversation on waits the close out.
 *
 * ⚑ The rig is `a-live-conversation-is-never-drawn-as-ended.test.ts`'s (`421`): a handle that
 * announces its ending and then holds its teardown, which is the only way to keep a slot `closing`
 * long enough to ask about it.
 */

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('716 · R62, D-017b — a conversation still closing says no process word, and still carries on', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-r62-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    const sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider, { sessions })
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      // ⚠️ A bound on the MACHINE, not on the rule (`418`'s note): one arm parks a teardown.
      closeDrainTimeoutMs: 40,
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
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (sink: RuntimeEventSink | null): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      sink,
    )
    return sessionId
  }

  const rowOf = (sessionId: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )

  /**
   * Close it, and hold its teardown open once the provider has announced the ending. ⚠️ The close is
   * handed back WRAPPED: an async function returning a promise adopts it, and would wait the close out.
   */
  const closingNow = async (sessionId: string): Promise<{ ending: Promise<void> }> => {
    const ending = host.close(sessionId, THE_APP_ITSELF)
    await waitFor(
      () => ledger.events(sessionId).some((one) => one.event.type === 'status'),
      'the provider to announce its ending while the teardown is parked',
    )
    return { ending }
  }

  // ⚑ **D-017b · the `closing` flag is gone** (`05` rule 5): whether BroBot2 is still stopping a
  // provider is a process fact, and no surface says one any more — the row says what the one state
  // (`state`, `list_agents`' derivation) says. ⚑ What the arms below keep is the wire's side of that:
  // a conversation on its way out and a row a dead process left read the SAME, and R62's premise —
  // the gesture that carries it on waits the close out — still holds (the last arm).
  it('🔴 D-017b · a conversation on its way out carries no process word — no `closing` beside `running`', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)

    // ⚑ The slot is there and the teardown is running: the state R62 named.
    expect(host.sessionIds).toContain(sessionId)
    const row = rowOf(sessionId)
    // Non-vacuity: the row is listed, and carries the one state every row carries.
    expect(row).toBeDefined()
    expect(row?.state).toBeDefined()
    expect(row).not.toHaveProperty('closing')

    // ⚑ The control: released, the same id is still listed, still without the word.
    closeGate.release()
    await ending
    expect(host.sessionIds).not.toContain(sessionId)
    expect(rowOf(sessionId)).toBeDefined()
    expect(rowOf(sessionId)).not.toHaveProperty('closing')
  })

  it('⚑ control — `running` does not move: a closing conversation is still `not-running`', async () => {
    // ⚠️ **The ruling's "not a fourth RunningState", measured**: forty readers of `not-running` must
    // not have met a new member. True on `main` as well — this arm pins what did NOT change.
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    expect(rowOf(sessionId)?.running).toBe('not-running')
    closeGate.release()
    await ending
    expect(rowOf(sessionId)?.running).toBe('not-running')
  })

  it('🔴 D-017b · the two `not-running` rows read the same — a close in flight is not told apart from a dead process', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    // A row this host has never run — the shape a previous process leaves behind.
    ledger.create({
      id: 'sess_from_a_dead_process',
      provider: 'claude',
      cwd: userData,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const closing = rowOf(sessionId)
    const dead = rowOf('sess_from_a_dead_process')
    expect(closing).toBeDefined()
    expect(dead).toBeDefined()
    expect(closing?.running).toBe(dead?.running)
    expect(closing?.state).toEqual(dead?.state)
    expect(closing).not.toHaveProperty('closing')
    expect(dead).not.toHaveProperty('closing')
    closeGate.release()
    await ending
  })

  it('⚑ control — a running conversation is still told by `running` — unwatched or held by a window', async () => {
    const unwatched = await open(null)
    const held = await open(new WindowSink('webContents:1'))
    expect(rowOf(unwatched)).toMatchObject({ running: 'unwatched' })
    expect(rowOf(held)).toMatchObject({ running: 'in-a-window' })
    expect(rowOf(unwatched)).not.toHaveProperty('closing')
    expect(rowOf(held)).not.toHaveProperty('closing')
  })

  it('🔴 D-017b · the UNRESUMABLE half says no process word either — a live Claude session with no ref yet is there', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    // ⚑ A real Claude session has no `external_ref` until its first turn's init lands; the double
    // hands one over as it starts, so it is taken back here, once the double has written it — the
    // shape `a-restart-keeps-what-was-open` builds the same way.
    db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(sessionId)
    const half = host.unresumableSessions().find((row) => row.sessionId === sessionId)
    // Non-vacuity: the row really is on the half with no ref.
    expect(half).toBeDefined()
    expect(host.resumableSessions().some((row) => row.sessionId === sessionId)).toBe(false)
    expect(half?.state).toBeDefined()
    expect(half).not.toHaveProperty('closing')
    closeGate.release()
    await ending
    expect(
      host.unresumableSessions().find((row) => row.sessionId === sessionId),
    ).not.toHaveProperty('closing')
  })

  it('⚑ control — Resume waits for it: a reopen pressed while it closes opens it', async () => {
    // ⚑ **R62's premise, measured on this rig**: *"the reopen is the gesture that works"*. True on
    // `main` too (`075`); the arm is here so the flag's sentence cannot outlive the behaviour.
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    // ⚑ Still closing: the slot is held while its teardown is parked.
    expect(host.sessionIds).toContain(sessionId)
    const reopening = host.resumeSession(sessionId, new WindowSink('webContents:2'))
    closeGate.release()
    await ending
    await expect(reopening).resolves.toMatchObject({ sessionId })
    expect(rowOf(sessionId)).toMatchObject({ running: 'in-a-window' })
  })
})
