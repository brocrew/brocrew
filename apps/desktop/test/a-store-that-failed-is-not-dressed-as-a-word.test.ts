import { newConversationGive } from './lib/give-fixture'
import { waitFor } from './lib/f093-host'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * A failure before a Message is recorded rejects the call. Once the recipient holds it,
 * a failed start returns that recorded ID and its cannot-run state, with the diagnostic
 * in the log. Errors reading the delivery outcome or writing the sender's receipt retain
 * their own error boundary.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: fixtureProviderConfig,
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
    const given = await callOn(
      pm,
      'give_work',
      newConversationGive('worker', 'The schema', 'migrate the schema'),
    )
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

  it('keeps the recorded Message receipt when a startup store read fails', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    const fault = new Error('the ledger read failed during the reopen')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const real = store.parentOf.bind(store)
    store.parentOf = (id: string) => {
      const fromTheReopen = new Error().stack?.includes('.resumeSession (') ?? false
      if (fromTheReopen) throw fault
      return real(id)
    }
    const result = await wakeByMessage(pm, worker, piece)
    const [held] = store.messagesWaitingIn(worker)
    expect(held).toMatchObject({ messageId: expect.any(String), text: 'carry on' })
    expect(result).toMatchObject({
      outcome: 'ok',
      delivery: 'queued',
      receipt: {
        recorded: { kind: 'message', id: held?.messageId },
        recipient: {
          id: worker,
          state: { kind: 'cannot-run', cause: { code: 'could-not-start' } },
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain(fault.message)
    expect(warned.mock.calls.flat().join(' ')).toContain(fault.message)
    expect(host.sessionIds).not.toContain(worker)
  })

  it('rejects a failed queue write before it has recorded the Message', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    const fault = new Error('the recipient queue write failed')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const append = store.append.bind(store)
    vi.spyOn(store, 'append').mockImplementation((...args) => {
      if (args[0] === worker && args[2].type === 'message_queued') throw fault
      return append(...args)
    })
    await expect(wakeByMessage(pm, worker, piece)).rejects.toThrow(
      'the words could not be kept for its next start',
    )
    expect(warned.mock.calls.flat().join(' ')).toContain(fault.message)
    expect(store.messagesWaitingIn(worker)).toEqual([])
    expect(host.sessionIds).not.toContain(worker)
  })

  it('§2 · control — an unavailable sign-in leaves a recorded message and a cannot-run receipt', async () => {
    const { pm, worker, piece } = await aWorkerThatStopped()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    gate.resumeFails = () => new AuthUnavailableError('claude', 'signed out')
    const result = await wakeByMessage(pm, worker, piece)
    const [held] = store.messagesWaitingIn(worker)
    expect(held?.text).toBe('carry on')
    expect(result).toMatchObject({
      outcome: 'ok',
      delivery: 'queued',
      agent: worker,
      receipt: {
        recorded: { kind: 'message', id: held?.messageId },
        recipient: {
          id: worker,
          state: {
            kind: 'cannot-run',
            needsPerson: true,
            cause: { code: 'could-not-start' },
          },
        },
      },
    })
  })

  it.each([false, true])(
    'surfaces the post-wake receipt read error, even if recording the sender receipt also fails: %s',
    async (failReceiptWrite) => {
      const { pm, worker, piece } = await aWorkerThatStopped()
      const fault = new Error('the post-wake message receipt read failed')
      const read = store.messagesWaitingIn.bind(store)
      const lookup = vi.spyOn(store, 'messagesWaitingIn').mockImplementation((id) => {
        if (id === worker && new Error().stack?.includes('.stateOfARecordedMessage (')) throw fault
        return read(id)
      })
      const append = store.append.bind(store)
      const writeFault = new Error('the sender receipt write failed too')
      const write = vi.spyOn(store, 'append').mockImplementation((...args) => {
        const [id, , event] = args
        if (failReceiptWrite && id === pm && event.type === 'message_sent') throw writeFault
        return append(...args)
      })
      try {
        await expect(wakeByMessage(pm, worker, piece)).rejects.toBe(fault)
        expect(
          write.mock.calls.filter(([id, , event]) => id === pm && event.type === 'message_sent'),
        ).toHaveLength(1)
      } finally {
        lookup.mockRestore()
        write.mockRestore()
      }
      expect(host.sessionIds).toContain(worker)
      const events = store.events(worker).map(({ event }) => event)
      const queued = events
        .filter((event) => event.type === 'message_queued')
        .filter((event) => event.text === 'carry on')
      expect(queued).toEqual([expect.objectContaining({ messageId: expect.any(String) })])
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'message_unqueued',
          messageId: queued[0]?.messageId,
          reason: 'sent',
        }),
      )
    },
  )
})
