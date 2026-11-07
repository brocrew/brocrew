import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeRuntime,
  ResumeError,
  StoppedBeforeSend,
  type AgentRuntime,
  type RuntimeEvent,
  type ResumeOptions,
  type SessionHandle,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'

const closes: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
})

async function fixture(
  failFresh = false,
  holdLaterRead = false,
  holdRetirement = false,
  holdResumeExit = false,
  managed = true,
) {
  const root = mkdtempSync(join(tmpdir(), 'fictional-plugin-handoff-'))
  closes.push(() => rmSync(root, { recursive: true, force: true }))
  const db = openDatabase(join(root, 'app.sqlite'))
  closes.push(() => {
    db.close()
  })
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  const route = {
    pluginId: 'fern',
    name: 'plugin-fern',
    url: 'http://127.0.0.1:8123/mcp',
    capability: 'a'.repeat(64),
  }
  const chrome = { ...route, pluginId: 'chrome', name: 'plugin-chrome', capability: 'b'.repeat(64) }
  let ready = false
  let finishRead!: () => void, noticeRead!: () => void
  const heldRead = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  const laterReadStarted = new Promise<void>((resolve) => {
    noticeRead = resolve
  })
  let releaseRetirement!: () => void
  const retired = new Promise<void>((resolve) => {
    releaseRetirement = resolve
  })
  let releaseResumeExit!: () => void
  const resumeExit = new Promise<void>((resolve) => {
    releaseResumeExit = resolve
  })
  let resumeAttempts = 0
  let reads = 0
  const opened: Array<{
    ref: SessionRef
    options: StartOptions
    send: ReturnType<typeof vi.fn>
    end: () => void
    emit: (event: RuntimeEvent) => void
    busy: (value: boolean) => void
  }> = []
  const raw = new Proxy(new FakeRuntime('codex'), {
    get(target, key) {
      if (key === 'canRecreateMissingUnusedSession') return true
      if (key === 'resume')
        return async (ref: SessionRef, options: ResumeOptions) => {
          if (holdResumeExit && resumeAttempts++ === 0) {
            options.onSessionCreated?.({
              ref,
              close: async () => {},
              awaitProcessExit: () => resumeExit,
            } as SessionHandle)
          }
          throw new ResumeError(ref, 'fictional empty rollout', { noSuchSession: true })
        }
      if (key === 'start')
        return async (options: StartOptions) => {
          const index = opened.length
          const ref: SessionRef = {
            provider: 'codex',
            sessionId: `fixture-thread-${index}`,
            cwd: options.cwd,
            rotation: 0,
          }
          const queue = new AsyncQueue<RuntimeEvent>()
          let busy = false
          let ended = false,
            finish!: () => void
          const exited = new Promise<void>((resolve) => {
            finish = resolve
          })
          const end = () => {
            if (ended) return
            ended = true
            queue.push({ type: 'status', state: 'ended' })
            queue.close()
            finish()
          }
          const send = vi.fn<SessionHandle['send']>(async () => {
            if (ended) throw new Error('fictional ended actor')
            queue.push({ type: 'status', state: 'working' })
            queue.push({ type: 'assistant_message', text: 'Fixture done.' })
            queue.push({ type: 'turn', state: 'completed' })
            queue.push({ type: 'status', state: 'idle' })
          })
          const handle = {
            ref,
            status: () => (ended ? 'ended' : busy ? 'working' : 'idle'),
            events: () => queue,
            settings: {
              model: { effective: options.model, requested: options.model },
              reasoningEffort: {
                effective: options.reasoningEffort,
                requested: options.reasoningEffort,
              },
              planMode: { effective: false, requested: false },
            },
            workFolders: {
              effective: options.workFolders ?? [],
              requested: options.workFolders ?? [],
            },
            approvalMode: options.approvalMode ?? 'ask',
            blanketGrants: [],
            approval: {
              effective: options.approvalMode ?? 'ask',
              requested: options.approvalMode ?? 'ask',
            },
            send,
            close: async () => {
              if (index === 0 && holdRetirement) await retired
              end()
            },
            awaitProcessExit: () => exited,
            interrupt: async () => {},
            setModel: async () => {},
            setPlanMode: async () => {},
            setReasoningEffort: async () => {},
            setApprovalMode: async () => {},
            setWorkFolders: () => {},
          } as unknown as SessionHandle
          opened.push({
            ref,
            options,
            send,
            end,
            emit: (event) => queue.push(event),
            busy: (value) => {
              busy = value
            },
          })
          options.onSessionCreated?.(handle)
          queue.push({ type: 'session', state: 'started', ref })
          queue.push({ type: 'status', state: 'idle' })
          if (index > 0 && failFresh) {
            end()
            if (!holdLaterRead) opened[0]!.end() // Make the host's stopped-session automatic retry branch eligible.
            throw new Error('fictional failed candidate')
          }
          return handle
        }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as AgentRuntime
  const messages: Array<{ event: { type: string } }> = []
  const sink: RuntimeEventSink = {
    ownerId: 'fixture-window',
    aPersonIsBehindIt: true,
    alive: true,
    send: (message) => {
      messages.push(message)
    },
    sendLiveness() {},
  }
  const lookedUp: SessionRef[] = []
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: (_provider, _home, ref) => {
      lookedUp.push(ref)
      return null
    },
    exportDirectory: () => join(root, 'exports'),
    createRuntime: () => raw,
    prepareProviderHome: () => {
      const home = join(root, 'home')
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: () => join(root, 'home'),
    resolveCwd: (_id, requested) => requested ?? root,
    newSessionId: () => 'sess_fixture_handoff',
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'fictional-model',
      authNote: null,
      files: [],
    }),
    readInstructions: () => ({
      instructions: {
        injected: [],
        agentMemory: [],
        provider: [],
        refused: [],
        note: '',
        recallsReported: false,
        writesReported: true,
        composed: null,
      },
      systemHint: undefined,
      firstTurnLead: 'FICTIONAL NONEMPTY FIRST TURN LEAD',
    }),
    pluginAttachments: managed
      ? {
          agent: () => ({
            read: async () => {
              if (holdLaterRead && ++reads >= 3) {
                noticeRead()
                await heldRead
              }
              return {
                revision: ready ? 'ready' : 'starting',
                servers: ready ? [route, chrome] : [route],
                plugins: { pending: ready ? [] : ['chrome'], none: [], unknown: false },
              }
            },
            close: async () => {},
          }),
        }
      : undefined,
  })
  closes.push(() => host.closeAll())
  const created = await host.createSession(
    { provider: 'codex', cwd: root, model: 'fictional-model' },
    sink,
  )
  await vi.waitFor(() =>
    expect(store.find(created.sessionId)?.ref?.sessionId).toBe('fixture-thread-0'),
  )
  ready = true
  return {
    store,
    host,
    sink,
    created,
    opened,
    lookedUp,
    messages,
    laterReadStarted,
    finishRead,
    releaseRetirement,
    releaseResumeExit,
  }
}

it('records the committed native ref and first input/lead under the same durable app conversation', async () => {
  const f = await fixture()
  await f.host.send(f.created.sessionId, 'Use Chrome exactly once.', f.sink)
  await vi.waitFor(() =>
    expect(f.store.find(f.created.sessionId)?.ref?.sessionId).toBe('fixture-thread-1'),
  )
  await vi.waitFor(() =>
    expect(f.store.events(f.created.sessionId).some((one) => one.event.type === 'turn')).toBe(true),
  )
  expect(f.opened).toHaveLength(2)
  expect(f.opened[0]!.send).not.toHaveBeenCalled()
  expect(f.opened[1]!.send).toHaveBeenCalledTimes(1)
  expect(f.opened[1]!.options).toMatchObject({
    model: 'fictional-model',
    managedPluginMcp: expect.arrayContaining([expect.objectContaining({ name: 'plugin-chrome' })]),
  })
  const events = f.store.events(f.created.sessionId)
  const turns = events.filter((one) => one.event.type === 'user_turn')
  expect(turns).toHaveLength(1)
  const turn = turns[0]!
  expect(f.opened[1]!.send.mock.calls[0]![0]).toBe((turn.event as { sent: string }).sent)
  expect(f.opened[1]!.send.mock.calls[0]![0]).toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
  const started = events.findIndex(
    (one) =>
      one.event.type === 'session' &&
      one.event.state === 'started' &&
      one.event.ref.sessionId === 'fixture-thread-1',
  )
  const terminal = events.findIndex((one) => one.event.type === 'turn')
  expect(started).toBeGreaterThan(-1)
  expect(terminal).toBeGreaterThan(started)
  await f.host.turnAsSent(f.created.sessionId, turn.ordinal)
  expect(f.lookedUp.at(-1)?.sessionId).toBe('fixture-thread-1')
  expect(f.store.find(f.created.sessionId)?.sessionId).toBe(f.created.sessionId)
})

it('keeps a failed repair unsent through the host stopped-session automatic delivery path', async () => {
  const f = await fixture(true)
  await expect(
    f.host.send(f.created.sessionId, 'Do not redeliver.', f.sink),
  ).rejects.toBeInstanceOf(StoppedBeforeSend)
  expect(f.opened).toHaveLength(2)
  expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
  expect(f.store.find(f.created.sessionId)?.ref?.sessionId).toBe('fixture-thread-0')
  expect(
    f.store
      .events(f.created.sessionId)
      .some(
        (one) => one.event.type === 'session' && one.event.ref.sessionId === 'fixture-thread-1',
      ),
  ).toBe(false)
})

it('does not automatically redeliver a later input when closing after an earlier failed repair', async () => {
  const f = await fixture(true, true)
  await expect(
    f.host.send(f.created.sessionId, 'First failed input.', f.sink),
  ).rejects.toBeInstanceOf(StoppedBeforeSend)
  const later = f.host.send(f.created.sessionId, 'Later held input.', f.sink)
  void later.catch(() => {})
  await f.laterReadStarted
  const closing = f.host.close(f.created.sessionId, f.sink)
  try {
    await expect(later).rejects.toBeInstanceOf(StoppedBeforeSend)
    await closing
    expect(f.opened).toHaveLength(2)
    expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
  } finally {
    f.finishRead()
    await closing
  }
})

it('preserves the nonempty host lead for a successful explicit retry after adopted B was unsent', async () => {
  const f = await fixture(false, false, true)
  const first = f.host.send(f.created.sessionId, 'Original unsent input.', f.sink)
  void first.catch(() => {})
  try {
    await vi.waitFor(() =>
      expect(f.store.find(f.created.sessionId)?.ref?.sessionId).toBe('fixture-thread-1'),
    )
    await f.host.interrupt(f.created.sessionId, f.sink)
    f.releaseRetirement()
    await expect(first).rejects.toBeInstanceOf(StoppedBeforeSend)
    expect(f.opened).toHaveLength(2)
    expect(f.opened.every((one) => one.send.mock.calls.length === 0)).toBe(true)
    expect(f.store.find(f.created.sessionId)?.ref?.sessionId).toBe('fixture-thread-1')
    await f.host.send(f.created.sessionId, 'Explicit retry input.', f.sink)
    expect(f.opened).toHaveLength(2)
    expect(f.opened[1]!.send).toHaveBeenCalledTimes(1)
    const sent = f.opened[1]!.send.mock.calls[0]![0] as string
    expect(sent.split('FICTIONAL NONEMPTY FIRST TURN LEAD')).toHaveLength(2)
    const turns = f.store
      .events(f.created.sessionId)
      .filter((one) => one.event.type === 'user_turn')
    expect(turns).toHaveLength(1)
    expect((turns[0]!.event as { sent: string }).sent).toBe(sent)
    await vi.waitFor(() =>
      expect(f.store.events(f.created.sessionId).some((one) => one.event.type === 'turn')).toBe(
        true,
      ),
    )
    await f.host.send(f.created.sessionId, 'Next ordinary input.', f.sink)
    expect(f.opened[1]!.send.mock.calls[1]![0]).not.toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
  } finally {
    f.releaseRetirement()
    await first.catch(() => {})
  }
})

it('restores the nonempty host lead after a synchronous typed unsent refusal', async () => {
  const f = await fixture(false, false, true)
  const first = f.host.send(f.created.sessionId, 'Synchronously unsent.', f.sink)
  void first.catch(() => {})
  try {
    await vi.waitFor(() => expect(f.opened).toHaveLength(2))
    f.opened[1]!.send.mockImplementationOnce(() => {
      throw new StoppedBeforeSend()
    })
    f.releaseRetirement()
    await expect(first).rejects.toBeInstanceOf(StoppedBeforeSend)
    await f.host.send(f.created.sessionId, 'Explicit successful retry.', f.sink)
    expect(f.opened[1]!.send.mock.calls[1]![0]).toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
    expect(
      f.store.events(f.created.sessionId).filter((one) => one.event.type === 'user_turn'),
    ).toHaveLength(1)
  } finally {
    f.releaseRetirement()
    await first.catch(() => {})
  }
})

it('a late typed refusal cannot restore consumed lead over a newer handover', async () => {
  const f = await fixture(false, false, true)
  let rejectFirst!: (error: unknown) => void, sentFirst!: () => void
  const arrived = new Promise<void>((resolve) => {
    sentFirst = resolve
  })
  const refused = new Promise<void>((_resolve, reject) => {
    rejectFirst = reject
  })
  const first = f.host.send(f.created.sessionId, 'Late unsent refusal.', f.sink)
  void first.catch(() => {})
  try {
    await vi.waitFor(() => expect(f.opened).toHaveLength(2))
    f.opened[1]!.send.mockImplementationOnce(() => {
      sentFirst()
      return refused
    })
    f.releaseRetirement()
    await arrived
    f.opened[1]!.emit({
      type: 'compaction',
      compactionId: 'fictional-newer-lead',
      source: 'fixture',
    })
    await vi.waitFor(() =>
      expect(
        f.store.events(f.created.sessionId).some((one) => one.event.type === 'compaction'),
      ).toBe(true),
    )
    await f.host.send(f.created.sessionId, 'Newer handover.', f.sink)
    expect(f.opened[1]!.send.mock.calls[1]![0]).toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
    rejectFirst(new StoppedBeforeSend())
    await expect(first).rejects.toBeInstanceOf(StoppedBeforeSend)
    await f.host.send(f.created.sessionId, 'Following handover.', f.sink)
    expect(f.opened[1]!.send.mock.calls[2]![0]).not.toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
    expect(
      f.store.events(f.created.sessionId).filter((one) => one.event.type === 'user_turn'),
    ).toHaveLength(2)
  } finally {
    f.releaseRetirement()
    rejectFirst(new StoppedBeforeSend())
    await first.catch(() => {})
  }
})

it('keeps the nonempty host lead while failed-resume exit blocks repair until an explicit retry', async () => {
  const f = await fixture(false, false, false, true)
  try {
    await expect(
      f.host.send(f.created.sessionId, 'Blocked unsent input.', f.sink),
    ).rejects.toBeInstanceOf(StoppedBeforeSend)
    expect(f.opened).toHaveLength(1)
    expect(f.opened[0]!.send).not.toHaveBeenCalled()
    f.releaseResumeExit()
    await f.host.send(f.created.sessionId, 'Explicit input after actual exit.', f.sink)
    expect(f.opened).toHaveLength(2)
    expect(f.opened[0]!.send).not.toHaveBeenCalled()
    expect(f.opened[1]!.send).toHaveBeenCalledTimes(1)
    const sent = f.opened[1]!.send.mock.calls[0]![0] as string
    expect(sent.split('FICTIONAL NONEMPTY FIRST TURN LEAD')).toHaveLength(2)
    const turns = f.store
      .events(f.created.sessionId)
      .filter((one) => one.event.type === 'user_turn')
    expect(turns).toHaveLength(1)
    expect((turns[0]!.event as { sent: string }).sent).toBe(sent)
    await vi.waitFor(() =>
      expect(f.store.find(f.created.sessionId)?.ref?.sessionId).toBe('fixture-thread-1'),
    )
    await f.host.send(f.created.sessionId, 'Ordinary later input.', f.sink)
    expect(f.opened[1]!.send.mock.calls[1]![0]).not.toContain('FICTIONAL NONEMPTY FIRST TURN LEAD')
  } finally {
    f.releaseResumeExit()
  }
})

it('restores an owed lead when the direct host handle synchronously refuses before dispatch', async () => {
  const f = await fixture(false, false, false, false, false)
  f.opened[0]!.send.mockImplementationOnce(() => {
    throw new StoppedBeforeSend()
  })
  await expect(f.host.send(f.created.sessionId, 'Direct unsent.', f.sink)).rejects.toBeInstanceOf(
    StoppedBeforeSend,
  )
  await f.host.send(f.created.sessionId, 'Direct explicit retry.', f.sink)
  expect(f.opened).toHaveLength(1)
  expect(
    (f.opened[0]!.send.mock.calls[1]![0] as string).split('FICTIONAL NONEMPTY FIRST TURN LEAD'),
  ).toHaveLength(2)
  expect(
    f.store.events(f.created.sessionId).filter((one) => one.event.type === 'user_turn'),
  ).toHaveLength(1)
})

it('restores an owed lead after an unsent grouped held-message handover', async () => {
  const f = await fixture(false, false, false, false, false)
  const actor = f.opened[0]!
  actor.busy(true)
  actor.emit({ type: 'status', state: 'working' })
  await f.host.queueMessage(f.created.sessionId, 'First held input.', f.sink)
  await f.host.queueMessage(f.created.sessionId, 'Second held input.', f.sink)
  actor.send.mockImplementationOnce(() => {
    throw new StoppedBeforeSend()
  })
  actor.busy(false)
  actor.emit({ type: 'status', state: 'idle' })
  await vi.waitFor(() => expect(actor.send).toHaveBeenCalledTimes(1))
  expect(
    f.store.events(f.created.sessionId).filter((one) => one.event.type === 'user_turn'),
  ).toHaveLength(0)
  actor.emit({ type: 'status', state: 'idle' })
  await vi.waitFor(() => expect(actor.send).toHaveBeenCalledTimes(2))
  const sent = actor.send.mock.calls[1]![0] as string
  expect(sent).toContain('First held input.')
  expect(sent).toContain('Second held input.')
  expect(sent.split('FICTIONAL NONEMPTY FIRST TURN LEAD')).toHaveLength(2)
  await vi.waitFor(() =>
    expect(
      f.store.events(f.created.sessionId).filter((one) => one.event.type === 'user_turn'),
    ).toHaveLength(1),
  )
})
