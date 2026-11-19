import { recordedMessageWakeFailure } from './lib/recorded-message-wake'
import { giveToSeededWorker } from './lib/give-fixture'
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
import type { WorkReconciler } from '../src/main/runtime/work-reconciliation'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { seedHistoricalSuccessor } from './lib/historical-replacement'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'

/**
 * Losing a provider session does not move the recorded work. Replacement records from earlier
 * versions still describe the original holder and route later messages to its successor.
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
    const { pm, given } = await giveToSeededWorker(
      host,
      window,
      personOpens,
      'The schema',
      'migrate the schema',
    )
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

  const seedSuccessorAfterQuit = async (worker: string): Promise<string> => {
    await host.closeAll()
    const next = seedHistoricalSuccessor(store, worker, `sess_${++counter}`, tick(), {
      sessions: issued,
      home: syntheticProviderHome(() => userData)('claude', 'worker'),
    })
    host = buildHost()
    return next
  }

  it('replans a retracted failure notice after a restart for an answerer with no work', async () => {
    const asker = await personOpens('pm')
    await host.closeAll()
    const holder = 'answerer-without-work'
    store.create({
      id: holder,
      provider: 'codex',
      cwd: root,
      approvalMode: 'auto',
      profileId: 'worker',
      parentSessionId: asker,
    })
    expect(store.rootOf(holder)).toBeNull()
    const append = (owner: string, event: TranscriptEvent) => {
      const ordinal = store.nextOrdinal(owner)
      store.append(owner, ordinal, event, tick())
      return ordinal
    }
    const requestId = 'req_failed_peer'
    const prompt = 'Which clock face should be kept?'
    append(asker, {
      type: 'question_asked',
      requestId,
      prompt,
      questions: [{ id: 'answer', prompt, options: [] }],
    })
    append(asker, { type: 'request_routed', requestId, to: 'an-agent', parent: holder })
    append(holder, {
      type: 'message_queued',
      messageId: requestId,
      kind: 'question',
      text: prompt,
      relayedFrom: asker,
      asks: { asker, requestId },
    })
    append(holder, { type: 'message_unqueued', messageId: requestId, reason: 'sent', text: prompt })
    append(holder, { type: 'user_turn', text: prompt, relayedFrom: asker })
    const message = 'The provider could not run the selected model.'
    const terminalOrdinal = append(holder, {
      type: 'turn',
      state: 'failed',
      wordOf: 'this-app',
      providerFailure: { message },
    })
    const messageId = 'retained-failure-notice'
    append(holder, {
      type: 'work_reconciliation',
      incident: 'retained-failure-incident',
      kind: 'provider-turn-failed',
      episode: { generation: 0, terminalOrdinal },
      since: tick(),
      step: 'giver',
      outcome: 'planned',
      target: asker,
      messageId,
    })
    const held = {
      messageId,
      text: message,
      attribution: 'app_authored',
      appNotice: 'a-provider-turn-failed',
    } as const
    append(asker, {
      ...held,
      type: 'message_queued',
      kind: 'notice',
      providerFailureHolder: holder,
    })
    append(asker, { ...held, type: 'message_unqueued', reason: 'retracted' })
    expect(store.reconciliationOwners()).not.toContain(holder)
    expect(store.reconciliationOwners(true)).toContain(holder)
    expect(store.providerFailureEpisode(holder)).toMatchObject({ terminalOrdinal })

    db.close()
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    store = createSessionStore(db, tick)
    host = buildHost(ProductRuntimeHost)
    await waitFor(
      () =>
        ledger(asker).some(
          (event) =>
            event.type === 'message_unqueued' &&
            event.messageId === messageId &&
            event.reason === 'sent',
        ),
      'the original notice to reach the asker after the restart',
    )
    const runner = (host as unknown as { workReconciler: WorkReconciler }).workReconciler
    await runner.run()
    await runner.run()

    const notices = ledger(asker).filter(
      (event) => event.type === 'message_queued' && event.appNotice === 'a-provider-turn-failed',
    )
    expect(notices).toHaveLength(2)
    expect(notices[1]).toMatchObject({ messageId, providerFailureHolder: holder })
    expect(notices[1]).toHaveProperty(
      'text',
      expect.stringContaining(`Unanswered questions: ${requestId}.`),
    )
    expect(store.reconciliationReceiptsForOwner(holder).map(({ outcome }) => outcome)).toEqual([
      'planned',
      'planned',
      'delivered',
    ])
  })

  it('a lost session leaves the work and its successful automatic holder reminder recorded', async () => {
    await host.closeAll()
    host = buildHost(ProductRuntimeHost)
    const { pm, given } = await giveToSeededWorker(
      host,
      window,
      personOpens,
      'The schema',
      'migrate the schema',
    )
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
    await host.close(worker, THE_APP_ITSELF)
    const recordedIds = () =>
      store
        .recorded()
        .map(({ sessionId }) => sessionId)
        .sort()
    const all = recordedIds()
    const recorded = store.piecesOwnedBy(worker)[0]
    issued.forgetAll()
    recordedMessageWakeFailure(
      store,
      worker,
      await wake(pm, worker, label),
      'provider-file-missing',
      /session file is missing/,
    )
    expect(recordedIds()).toEqual(all)
    expect(store.replacements()).toEqual([])
    expect(store.piecesOwnedBy(worker)[0]).toEqual(recorded)
    expect(store.reconciliationReceipts(worker, before.piece)).toEqual(
      expect.arrayContaining([...receipts]),
    )
  })

  it('a historical replacement leaves the stalled piece with its original holder', async () => {
    const { pm, worker } = await aWorkerOver()
    const before = store.piecesOwnedBy(worker)[0]
    if (before === undefined) throw new Error('the premise: aWorkerOver left one open piece')
    // Close already stalled it; the could_not_be_reopened cause is written only at the replace.
    expect(TASK_IS_OPEN[before.state], `pre-replace state: ${before.state}`).toBe(true)
    expect(before.stalledBecause).not.toBe('could_not_be_reopened')

    const cwd = store.find(worker)?.cwd
    const next = await seedSuccessorAfterQuit(worker)
    expect(next).not.toBe(worker)
    expect(store.parentOf(next)).toBe(pm)
    expect(store.identityOf(next)?.profileSlug).toBe('worker')
    expect(store.find(next)?.cwd).toBe(cwd)
    const after = store.piecesOwnedBy(worker)[0]
    expect(after?.state).toBe('stalled')
    expect(after?.stalledBecause).toBe('could_not_be_reopened')
    expect(store.piecesOwnedBy(next)).toEqual([])
    expect(ledger(worker)).toContainEqual({ type: 'replaced_by', sessionId: next })
  })

  it('moves a held provider failure notice under its original ID before rechecking it', async () => {
    const { pm, worker } = await aWorkerOver()
    const messageId = 'held-provider-failure-notice'
    const text = 'The provider could not run the selected model.'
    store.append(
      worker,
      store.nextOrdinal(worker),
      {
        type: 'message_queued',
        messageId,
        kind: 'notice',
        text,
        appNotice: 'a-provider-turn-failed',
        attribution: 'app_authored',
        providerFailureHolder: pm,
      },
      tick(),
    )
    const next = await seedSuccessorAfterQuit(worker)

    // The public send now resolves historical addresses first. Exercise the retained start path
    // directly, where it still moves queued rows from a historical address.
    const start = host as unknown as {
      ensureRunning(id: string, sink: RecordingSink): Promise<string>
    }
    expect(await start.ensureRunning(worker, window)).toBe(next)
    expect(ledger(worker)).toContainEqual(
      expect.objectContaining({
        type: 'message_unqueued',
        messageId,
        reason: 'abandoned',
      }),
    )
    expect(ledger(next)).toContainEqual(
      expect.objectContaining({
        type: 'message_queued',
        messageId,
        text,
        appNotice: 'a-provider-turn-failed',
        providerFailureHolder: pm,
      }),
    )
    await waitFor(
      () =>
        ledger(next).some(
          (event) =>
            event.type === 'message_unqueued' &&
            event.messageId === messageId &&
            event.reason === 'retracted',
        ),
      'the notice without a current failure to be retracted',
    )
    expect(ledger(next)).toContainEqual(
      expect.objectContaining({
        type: 'message_unqueued',
        messageId,
        reason: 'retracted',
        detail:
          'The app did not deliver this notice because it could not confirm it was still needed.',
      }),
    )
  })

  it('a second message to an id already replaced reaches the ONE conversation that took its place, never a second replacement', async () => {
    const { pm, worker, label } = await aWorkerOver()
    const next = await seedSuccessorAfterQuit(worker)
    await host.resumeSession(pm, window)

    const sent1 = await wake(pm, worker, label)
    expect(sent1.outcome, JSON.stringify(sent1)).toBe('ok')
    expect(sent1.went_to).toBe(next)

    const sent2 = await wake(pm, worker, label)

    expect(sent2.outcome, JSON.stringify(sent2)).toBe('ok')
    expect(sent2.went_to).toBe(next)
    expect(ledger(worker).filter((event) => event.type === 'replaced_by')).toHaveLength(1)
  })
})
