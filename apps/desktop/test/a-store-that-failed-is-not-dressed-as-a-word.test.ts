import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # ⛔ 663 M33 · what is not recognised is dressed as a word — `650`'s catch-all, undone
 *
 * ⚑ **The rule, off `agent-tools.ts`'s own words**: `aWakeThatDidNotHappen` answers a failed reopen
 * in the wake's vocabulary only when it recognises the cause; whatever it does not recognise falls
 * through and is RETHROWN — *"a broken tool, not a word for a state nobody saw."* `650` is the card
 * that drew that line; before it, every reopen failure — however unrelated to a wake — was dressed
 * up as the same generic refusal, and a genuine bug (the STORE itself failing) read as an ordinary,
 * retryable *"that agent did not start."*
 *
 * ⚑ **The failure here is the store's, not the provider's or the launch's**: `SessionStore`'s own
 * `parentOf` (`spawnProvenance` until D-016), which `RuntimeHost.resumeSession` reads synchronously before it ever reaches the
 * provider, is made to throw a plain `Error` — a shape `aWakeThatDidNotHappen` has no branch for
 * (it is not a shortage errno, not a `ResumeError`, not one of `unavailableOf`'s reasons, and not a
 * typed launch failure). ⛔ **§1 is the kill**: on the code this row's plant edits, that plain Error
 * must reach the caller as a REJECTION of the `message_agent` call — never as a structured `refused`
 * answer. ⚑ **§2 is the positive it is paired with**: the very same wake, failing on a cause
 * `aWakeThatDidNotHappen` DOES recognise (an expired sign-in), still comes back as the ordinary
 * `agent-did-not-start` refusal — so §1's rejection is provably about recognition, not about the
 * wake path breaking wholesale.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('663 M33 · a store that failed is not dressed as a word', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let gate: ResumeGate

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-663-m33-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A PM, and a worker its give started, and that then STOPPED — the conversation a wake (a
   * follow-up message naming the piece) brings back. Built entirely on the real store, before that
   * store is made to fail, so setup itself never sees the planted failure.
   */
  const aWorkerThatStopped = async (): Promise<{ pm: string; worker: string; piece: string }> => {
    // ⚑ Registers the `worker` profile, as `personOpens` does elsewhere in this suite — `give_work`
    // refuses `no-such-profile` for a slug nothing has ever created a conversation under (D-016 · R3).
    const seed = (
      await host.createSession(
        { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: userData },
        window,
      )
    ).sessionId
    await host.close(seed, window)
    const pm = (
      await host.createSession(
        { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: userData },
        window,
      )
    ).sessionId
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => store.piecesOwnedBy(worker).some((one) => one.giver === pm),
      'the give to open a piece',
    )
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be over')
    return { pm, worker, piece: given.label as string }
  }

  const wakeByMessage = (
    pm: string,
    worker: string,
    piece: string,
  ): Promise<Record<string, unknown>> =>
    callOn(pm, 'message_agent', { agent: worker, text: 'carry on', kind: 'follow-up', piece })

  it('§1 · a store failure `aWakeThatDidNotHappen` cannot recognise reaches the caller as a broken tool, never a refusal', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    // ⚑ The store's own read, inside `resumeSession`, made to fail — a shape no shortage errno, no
    // `ResumeError` and no typed launch failure produces, so `aWakeThatDidNotHappen` returns null for
    // it and (on the unplanted code) the reopen's `catch` rethrows it rather than dressing it up.
    // ⚑ The rails (`whyItIsOutOfReach`, `refuseBeforeAStart` on arrival and again at delivery) read
    // `parentOf` too, ahead of the reopen — measured directly, by tracing every call this
    // wake makes before it reaches the store's own read. Only THAT read, `RuntimeHost.resumeSession`'s
    // (agent-tools.ts's plant is about what a REOPEN's failure becomes, not a rail's), is made to
    // fail — a rail throwing instead would leave `message_agent`'s catch entirely, never reaching
    // `AStartThatDidNotHappen` or `aWakeThatDidNotHappen`, and would reject on both the planted and
    // the unplanted code alike, proving nothing about this row.
    const real = store.parentOf.bind(store)
    store.parentOf = (id: string) => {
      const fromTheReopen = new Error().stack?.includes('.resumeSession (') ?? false
      if (fromTheReopen) throw new Error('663 M33: the ledger read failed (disk I/O error)')
      return real(id)
    }
    // ⛔ **Never a structured refusal** — the whole point is that this shape does not become one; a
    // caller reading `outcome` off a resolved value never gets the chance, because there is none.
    await expect(wakeByMessage(pm, worker, piece)).rejects.toThrow(
      '663 M33: the ledger read failed (disk I/O error)',
    )
  })

  it('§2 · control — the very same wake, failing on a cause it DOES recognise, still comes back as the ordinary refusal', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    gate.resumeFails = () => new AuthUnavailableError('claude', 'signed out')
    const refused = await wakeByMessage(pm, worker, piece)
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'agent-did-not-start',
      detail: { agent: worker, because: 'its-sign-in-is-unusable', provider: 'claude' },
    })
  })
})
