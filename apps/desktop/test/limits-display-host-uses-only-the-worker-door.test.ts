import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { LimitsReaderLifetime, type LimitsReader } from '../src/main/db/limits-reader-lifetime'
import type { LimitsReadInput, LimitsReadResult } from '../src/main/db/limits-read-protocol'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'

class Reader implements LimitsReader {
  readonly calls: LimitsReadInput[] = []
  readonly whenExited: Promise<void>
  private exit!: () => void
  private resolve!: (value: LimitsReadResult) => void
  constructor() {
    this.whenExited = new Promise((resolve) => {
      this.exit = resolve
    })
  }
  execute(input: LimitsReadInput): Promise<LimitsReadResult> {
    this.calls.push(input)
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }
  finish() {
    const input = this.calls.at(-1)!
    const walk = {
      walk: 'every-provider-wall-recently-recorded' as const,
      rows: [],
      ledgers: 1,
      rowsUnread: 0,
    }
    this.resolve({
      ...input,
      inputCapturedAt: input.capturedAt,
      readStartedAt: 20,
      snapshotPinStartedAt: 21,
      snapshotPinnedAt: 22,
      evaluatedAt: 23,
      readFinishedAt: 24,
      canonical: walk,
      display: walk,
      measured: { rows: 0, bytes: 0, statements: 1 },
    })
  }
  stop(): Promise<void> {
    this.exit()
    return this.whenExited
  }
}

const hosts: RuntimeHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.closeAll()
  vi.restoreAllMocks()
})
const drain = async () => {
  for (let n = 0; n < 8; n++) await new Promise<void>((resolve) => setImmediate(resolve))
}

function fixture(runtime = new FakeRuntime('claude')) {
  const reader = new Reader()
  const lifetime = new LimitsReaderLifetime('fictional.sqlite', () => reader)
  const canonical = vi.fn(() => {
    throw new Error('a display call must not read the writer')
  })
  let clock = 10
  const host = new RuntimeHost({
    store: { ...NULL_SESSION_STORE, providerLimitsSeen: canonical },
    limitsReader: lifetime,
    now: () => ++clock,
    discoverSessions: NO_DISCOVERY,
    createRuntime: () => runtime,
    resolveCwd: () => '/fictional',
    prepareProviderHome: () => '/fictional',
    providerHomePath: () => '/fictional',
    nativeTranscriptPath: () => null,
    exportDirectory: () => '/fictional',
    newSessionId: () => 'fictional',
    readProviderConfig: () => ({
      home: '/fictional',
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  hosts.push(host)
  const sink = {
    ownerId: 'fictional-window',
    alive: true,
    aPersonIsBehindIt: true,
    send: () => {},
    sendLiveness: () => {},
  }
  return { host, reader, lifetime, canonical, sink }
}

describe('the window display door is independent of current and admission facts', () => {
  it('captures the known account life for the production worker without reading the writer', async () => {
    const runtime = new FakeRuntime('codex')
    const start = runtime.start.bind(runtime)
    vi.spyOn(runtime, 'start').mockImplementation(async (options) => {
      const handle = await start(options)
      Object.defineProperty(handle, 'signInTag', { value: () => 'fern-account' })
      return handle
    })
    const { host, reader, sink, canonical } = fixture(runtime)
    const { sessionId } = await host.createSession({ provider: 'codex' }, sink)
    const answer = host.readLimitsDisplay()
    await drain()
    expect(reader.calls.at(-1)?.accountLives).toContainEqual({
      sessionId,
      since: expect.any(Number),
      account: 'codex:fern-account',
    })
    reader.finish()
    expect(await answer).toMatchObject({ is: 'read' })
    expect(canonical).not.toHaveBeenCalled()
  })

  it('the legacy limits IPC also awaits the worker without reading its writer', async () => {
    const { host, reader, sink, canonical } = fixture()
    const answer = executeRuntimeCommand(host, sink, { kind: 'limitsForAPerson' })
    await drain()
    expect(reader.calls).toHaveLength(1)
    expect(canonical).not.toHaveBeenCalled()
    reader.finish()
    expect(await answer).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      rows: [],
      ledgers: 1,
      rowsUnread: 0,
    })
    expect(canonical).not.toHaveBeenCalled()
  })

  it('the actual IPC door remains pending without opening the writer and returns dated evidence', async () => {
    const { host, reader, canonical, sink } = fixture()
    let settled = false
    const answer = executeRuntimeCommand(host, sink, { kind: 'readLimitsDisplay' }).then(
      (value) => {
        settled = true
        return value
      },
    )
    await drain()
    expect(reader.calls).toHaveLength(1)
    expect(settled).toBe(false)
    expect(canonical).not.toHaveBeenCalled()
    reader.finish()
    expect(await answer).toMatchObject({
      is: 'read',
      reading: {
        operation: 1,
        evaluatedAt: 23,
        pinStartedAt: 21,
        pinFinishedAt: 22,
        walked: { ledgers: 1 },
      },
    })
    expect(canonical).not.toHaveBeenCalled()
  })

  it('coalesced callers carry the actual selected operation and capture time', async () => {
    const { host, reader } = fixture()
    const first = host.readLimitsDisplay()
    await drain()
    const second = host.readLimitsDisplay()
    const third = host.readLimitsDisplay()
    reader.finish()
    expect(await first).toMatchObject({ is: 'read', reading: { operation: 1 } })
    await drain()
    expect(reader.calls.map((input) => input.operation)).toEqual([1, 3])
    reader.finish()
    const expected = { is: 'read', reading: { operation: 3, usageAt: reader.calls[1]!.capturedAt } }
    expect(await second).toMatchObject(expected)
    expect(await third).toMatchObject(expected)
  })

  it('sign-in changes refuse old replies and the following read uses the new scope', async () => {
    const { host, reader, lifetime, canonical } = fixture()
    const old = host.readLimitsDisplay()
    await drain()
    lifetime.signInChanged()
    expect(await old).toEqual({ is: 'unavailable', databaseEpoch: 1, signInEpoch: 2 })
    reader.finish()
    const fresh = host.readLimitsDisplay()
    await drain()
    expect(reader.calls.at(-1)?.signInEpoch).toBe(2)
    reader.finish()
    expect(await fresh).toMatchObject({ is: 'read', reading: { signInEpoch: 2 } })
    expect(canonical).not.toHaveBeenCalled()
  })

  it('quit owns worker exit and the public display door is refused afterwards', async () => {
    const { host, reader, sink } = fixture()
    const stop = vi.spyOn(reader, 'stop')
    const read = host.readLimitsDisplay()
    await drain()
    expect(reader.calls).toHaveLength(1)
    reader.finish()
    expect(await read).toMatchObject({ is: 'read' })
    await host.closeAll()
    expect(stop).toHaveBeenCalledTimes(1)
    await expect(executeRuntimeCommand(host, sink, { kind: 'readLimitsDisplay' })).rejects.toThrow()
  })
})
