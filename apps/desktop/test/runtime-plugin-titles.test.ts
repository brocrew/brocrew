import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { NULL_SESSION_STORE, type WorkRow } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { PluginBeforeTurnResult } from '../src/shared/plugin-contract'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})
async function fixture(provider: Provider, context: 'active' | 'inactive' | 'absent' = 'active') {
  const directory = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-titles-'),
  )
  const raw = new FakeRuntime(provider),
    original = raw.start.bind(raw)
  let handle!: FakeSessionHandle
  const said: string[] = []
  const ordering: string[] = []
  vi.spyOn(raw, 'start').mockImplementation(async (options) => {
    handle = await original(options)
    const send = handle.send.bind(handle)
    vi.spyOn(handle, 'send').mockImplementation((text, stamp) => {
      ordering.push('provider')
      return send(text, stamp).then(() => {
        said.push(text)
      })
    })
    return handle
  })
  let present = false
  const row: WorkRow = {
    piece: 'fictional-piece',
    parent: null,
    number: 1,
    label: 'Fictional work',
    owner: 'sess_fictional_titles',
    givenBy: null,
    title: 'Notes',
    brief: null,
    folder: null,
    createdAt: 1,
  }
  const candidates = [
    { resourceId: 'fictional-guide', version: 'v1', title: 'Fictional guide', pieceId: row.piece },
  ]
  const beforeTurn = vi.fn(async (): Promise<PluginBeforeTurnResult> => ({
    pointers: [{ resourceId: 'fictional-guide', version: 'v1' }],
  }))
  const store = {
    ...NULL_SESSION_STORE,
    rootOf: vi.fn((id: string) => (present && id === row.owner ? row : null)),
    workById: vi.fn((piece: string) => (piece === row.piece ? row : null)),
    pluginTitleCandidates: vi.fn(() => candidates),
  }
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(directory, 'exports'),
    createRuntime: () => raw,
    prepareProviderHome: () => join(directory, 'home'),
    providerHomePath: () => join(directory, 'home'),
    resolveCwd: () => directory,
    newSessionId: () => row.owner,
    readProviderConfig: () => ({
      home: join(directory, 'home'),
      homeEnv: 'FICTIONAL_HOME',
      model: 'fictional-model',
      authNote: null,
      files: [],
    }),
    ...(context === 'absent'
      ? {}
      : {
          pluginContext: {
            active: () => {
              if (context === 'inactive') {
                ordering.push('inactive')
                queueMicrotask(() => ordering.push('inactive tick'))
              }
              return context === 'active'
            },
            beforeTurn,
          },
        }),
  })
  const events: RuntimeEventMessage[] = []
  const sink: RuntimeEventSink = {
    ownerId: 'fictional-window',
    aPersonIsBehindIt: true,
    alive: true,
    send: (event) => {
      events.push(event)
    },
    sendLiveness: () => {},
  }
  const { sessionId } = await host.createSession({ provider }, sink)
  present = true
  cleanups.push(async () => {
    await host.closeAll()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    host,
    sessionId,
    sink,
    events,
    said,
    beforeTurn,
    ordering,
    store,
    row,
    get handle() {
      return handle
    },
  }
}
it.each(['claude', 'codex'] as const)(
  'keeps an inactive title hook off direct, queued and interrupt handoff waits for %s',
  async (provider) => {
    const f = await fixture(provider, 'inactive')
    const expectNoHookWait = () => {
      expect(f.ordering.filter((value) => value === 'provider')).toHaveLength(1)
      expect(f.ordering.indexOf('inactive')).toBeGreaterThanOrEqual(0)
      expect(f.ordering.indexOf('provider')).toBeLessThan(f.ordering.indexOf('inactive tick'))
      expect(f.beforeTurn).not.toHaveBeenCalled()
    }
    f.ordering.length = 0
    await f.host.send(f.sessionId, 'First fictional words without a hook', f.sink)
    expectNoHookWait()
    await vi.waitFor(() => expect(f.handle.status()).toBe('waiting_permission'))
    await f.host.send(f.sessionId, 'Queued fictional words without a hook', f.sink)
    f.ordering.length = 0
    await f.host.interrupt(f.sessionId, f.sink)
    await vi.waitFor(() => expect(f.said).toHaveLength(2))
    expectNoHookWait()
    await vi.waitFor(() => expect(f.handle.status()).toBe('waiting_permission'))
    f.ordering.length = 0
    await f.host.sendInterrupting(f.sessionId, 'Replacement fictional words without a hook', f.sink)
    expectNoHookWait()
    expect(f.said).toHaveLength(3)
    expect(f.said.every((text) => !text.includes('Suggested file titles'))).toBe(true)
  },
)
it.each(['claude', 'codex'] as const)(
  'omits titles when the receiving piece is reassigned during the hook for %s',
  async (provider) => {
    const f = await fixture(provider)
    let enter!: () => void, finish!: (value: PluginBeforeTurnResult) => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    f.beforeTurn.mockImplementation(() => {
      enter()
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const pending = f.host.send(f.sessionId, 'Fictional words during reassignment', f.sink)
    await entered
    f.store.workById.mockReturnValue({ ...f.row, owner: 'sess_fictional_other' })
    finish({ pointers: [{ resourceId: 'fictional-guide', version: 'v1' }] })
    await pending
    expect(f.said).toHaveLength(1)
    expect(f.said[0]).toContain('Fictional words during reassignment')
    expect(f.said[0]).not.toContain('Suggested file titles')
    expect(f.store.pluginTitleCandidates).toHaveBeenCalledTimes(1)
  },
)
it.each(['claude', 'codex'] as const)(
  'omits titles when the selected receiving piece changes during the hook for %s',
  async (provider) => {
    const f = await fixture(provider)
    let enter!: () => void, finish!: (value: PluginBeforeTurnResult) => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    f.beforeTurn.mockImplementation(() => {
      enter()
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const pending = f.host.send(f.sessionId, 'Fictional words during piece change', f.sink)
    await entered
    f.store.rootOf.mockReturnValue({ ...f.row, piece: 'fictional-replacement-piece' })
    finish({ pointers: [{ resourceId: 'fictional-guide', version: 'v1' }] })
    await pending
    expect(f.said).toHaveLength(1)
    expect(f.said[0]).toContain('Fictional words during piece change')
    expect(f.said[0]).not.toContain('Suggested file titles')
    expect(f.store.pluginTitleCandidates).toHaveBeenCalledTimes(1)
  },
)
it.each(['claude', 'codex'] as const)(
  'composes canonical titles after the sender on direct, queued and interrupt sends for %s',
  async (provider) => {
    const f = await fixture(provider)
    await f.host.send(f.sessionId, 'First fictional words', f.sink)
    expect(f.said[0]).toContain('Suggested file titles')
    expect(f.said[0]!.indexOf('Suggested file titles')).toBeGreaterThan(
      f.said[0]!.indexOf('Sent by'),
    )
    expect(f.said[0]).toContain('Fictional guide')
    await vi.waitFor(() =>
      expect(f.events.some((message) => message.event.type === 'permission_request')).toBe(true),
    )
    await f.host.send(f.sessionId, 'Queued fictional words', f.sink)
    expect(f.beforeTurn).toHaveBeenCalledTimes(1)
    await f.host.interrupt(f.sessionId, f.sink)
    await vi.waitFor(() => expect(f.said).toHaveLength(2))
    expect(f.beforeTurn).toHaveBeenCalledTimes(2)
    expect(f.said[1]).toContain('Suggested file titles')
    await vi.waitFor(() => expect(f.handle.status()).toBe('waiting_permission'))
    await f.host.sendInterrupting(f.sessionId, 'Replacement fictional words', f.sink)
    expect(f.said.at(-1)).toContain('Suggested file titles')
    expect(f.beforeTurn).toHaveBeenCalledTimes(3)
    expect(f.handle.origins).toHaveLength(3)
    expect(f.beforeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        pieceId: 'fictional-piece',
        candidates: [
          {
            resourceId: 'fictional-guide',
            version: 'v1',
            title: 'Fictional guide',
            pieceId: 'fictional-piece',
          },
        ],
      }),
    )
  },
)
it('sends the original turn on the context deadline and ignores a late title result', async () => {
  const f = await fixture('codex')
  let finish!: (result: PluginBeforeTurnResult) => void
  f.beforeTurn.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await f.host.send(f.sessionId, 'Fictional words with a slow hook', f.sink)
  expect(f.said).toHaveLength(1)
  expect(f.said[0]).not.toContain('Suggested file titles')
  finish({ pointers: [{ resourceId: 'fictional-guide', version: 'v1' }] })
  await Promise.resolve()
  expect(f.said).toHaveLength(1)
})
