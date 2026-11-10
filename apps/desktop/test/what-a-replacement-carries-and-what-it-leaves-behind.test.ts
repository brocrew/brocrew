import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { RuntimeHost as ProductRuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'

/**
 * A conversation its provider no longer has is replaced by a new conversation of the same agent,
 * folder and parent. The explicit-follow-up cases use a host that declines automatic holder
 * reminders, so the follow-up alone reopens the forgotten session.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('what a replacement carries, and what it leaves behind', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (Host: typeof ProductRuntimeHost = RuntimeHost): RuntimeHost => {
    const built = new Host({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-replace-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-replace-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_100_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  /** A PM a person opened, and one worker it gave work to and then stopped. */
  const aWorkerOver = async (): Promise<{ pm: string; worker: string; label: string }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === worker && row.running !== 'not-running',
        ),
      'the worker to be over',
    )
    return { pm, worker, label: given.label as string }
  }

  /** The parent's follow-up naming the piece, which starts the stopped worker. */
  const wake = (pm: string, worker: string, label: string): Promise<Record<string, unknown>> =>
    callOn(pm, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })

  it('a successful automatic holder reminder precedes a lost-thread replacement that preserves its facts', async () => {
    await host.closeAll()
    host = buildHost(ProductRuntimeHost)
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const label = given.label as string
    await waitFor(() => store.piecesOwnedBy(worker).length > 0, 'the given piece to be recorded')
    const before = store.piecesOwnedBy(worker)[0]!
    await waitFor(
      () =>
        store
          .reconciliationReceipts(worker, before.piece)
          .some((one) => one.step === 'holder' && one.outcome === 'delivered'),
      'the successful automatic holder receipt',
    )
    await waitFor(() => turnsIn(worker) >= 2, 'both the brief and reminder turns to end')
    const receipts = store.reconciliationReceipts(worker, before.piece)
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'holder', outcome: 'planned' }),
        expect.objectContaining({ step: 'holder', outcome: 'delivered' }),
      ]),
    )
    expect(receipts.some((one) => one.step === 'holder' && one.outcome === 'failed')).toBe(false)
    const cwd = store.find(worker)?.cwd
    await host.close(worker, THE_APP_ITSELF)
    issued.forgetAll()
    const sent = await wake(pm, worker, label)
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    expect(next).not.toBe(worker)
    expect(store.parentOf(next)).toBe(pm)
    expect(store.identityOf(next)?.profileSlug).toBe('worker')
    expect(store.find(next)?.cwd).toBe(cwd)
    expect(store.piecesOwnedBy(next)).toEqual([])
    expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('could_not_be_reopened')
    expect(ledger(worker).filter((one) => one.type === 'replaced_by')).toHaveLength(1)
  })

  it('an open piece the replaced conversation held stalls could_not_be_reopened, and the new conversation starts holding none of it', async () => {
    const { pm, worker, label } = await aWorkerOver()
    const before = store.piecesOwnedBy(worker)[0]
    if (before === undefined) throw new Error('the premise: aWorkerOver left one open piece')
    // Close already stalled it; the could_not_be_reopened cause is written only at the replace.
    expect(TASK_IS_OPEN[before.state], `pre-replace state: ${before.state}`).toBe(true)
    expect(before.stalledBecause).not.toBe('could_not_be_reopened')

    issued.forgetAll()
    const sent = await wake(pm, worker, label)

    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    expect(typeof next, JSON.stringify(sent)).toBe('string')
    expect(next).not.toBe(worker)
    const after = store.piecesOwnedBy(worker)[0]
    expect(after?.state).toBe('stalled')
    expect(after?.stalledBecause).toBe('could_not_be_reopened')
    expect(store.piecesOwnedBy(next)).toEqual([])
    expect(ledger(worker)).toContainEqual({ type: 'replaced_by', sessionId: next })
  })

  it('a second message to an id already replaced reaches the ONE conversation that took its place, never a second replacement', async () => {
    const { pm, worker, label } = await aWorkerOver()
    issued.forgetAll()

    const sent1 = await wake(pm, worker, label)
    expect(sent1.outcome, JSON.stringify(sent1)).toBe('ok')
    const next1 = sent1.went_to as string
    expect(next1).not.toBe(worker)

    const sent2 = await wake(pm, worker, label)

    expect(sent2.outcome, JSON.stringify(sent2)).toBe('ok')
    expect(sent2.went_to).toBe(next1)
    expect(ledger(worker).filter((event) => event.type === 'replaced_by')).toHaveLength(1)
  })
})
