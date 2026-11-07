import {
  codexFixtureConfig,
  neutralHostDeps,
  NonPersonSink as RecordingSink,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProcessExit,
  FakeRuntime,
  type AgentRuntime,
  type SessionHandle,
} from '@brobot2/runtime'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

function gateClose(
  handle: SessionHandle,
  gate: Promise<void>,
  onClose: () => void,
): { handle: SessionHandle; closed: () => boolean } {
  let finished = false
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          onClose()
          await gate
          await target.close()
          finished = true
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { handle: proxied, closed: () => finished }
}

class StallingRuntime implements AgentRuntime {
  readonly provider = 'codex' as const
  running = false
  aborted = false
  private readonly inner: FakeRuntime
  late: { handle: SessionHandle; closed: () => boolean } | null = null
  private readonly teardown = deferred()
  private readonly arrival = deferred()

  constructor(
    private readonly answer: 'tears-down' | 'slow-to-die' | 'arrives-anyway',
    private readonly closeGate?: Promise<void>,
    exit?: FakeProcessExit,
  ) {
    this.inner = new FakeRuntime('codex', exit ? { exit } : {})
  }

  finishTeardown(): void {
    this.teardown.resolve()
  }
  arriveNow(): void {
    this.arrival.resolve()
  }

  listModels(
    context: Parameters<AgentRuntime['listModels']>[0],
  ): ReturnType<AgentRuntime['listModels']> {
    return this.inner.listModels(context)
  }

  start(options: Parameters<AgentRuntime['start']>[0]): Promise<SessionHandle> {
    return this.stall(options.signal, () => this.inner.start(options))
  }

  resume(...args: Parameters<AgentRuntime['resume']>): Promise<SessionHandle> {
    return this.stall(args[1].signal, () => this.inner.resume(args[0], args[1]))
  }

  private async stall(
    signal: AbortSignal | undefined,
    build: () => Promise<SessionHandle>,
  ): Promise<SessionHandle> {
    this.running = true
    const stopped = deferred()
    signal?.addEventListener(
      'abort',
      () => {
        this.aborted = true
        stopped.resolve()
      },
      { once: true },
    )
    if (this.answer === 'arrives-anyway') {
      const handle = await build()
      await this.arrival.promise
      this.late = gateClose(handle, this.closeGate ?? Promise.resolve(), () => {})
      return this.late.handle
    }
    await stopped.promise
    if (this.answer === 'slow-to-die') await this.teardown.promise
    this.running = false
    throw new Error('codex start was cancelled')
  }
}

describe('cancelling a launch (102)', () => {
  let userData: string
  let sink: RecordingSink

  function buildHost(
    runtime: AgentRuntime,
    overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
  ): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: codexFixtureConfig,
      closeDrainTimeoutMs: 40,
      ...overrides,
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cancel-'))
    sink = new RecordingSink()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('reaches the launch through the real IPC boundary, not just through the host', async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
      launchKey: 'k1',
    })
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    expect(await executeRuntimeCommand(host, sink, { kind: 'cancelLaunch', launchKey: 'k1' })).toBe(
      true,
    )
    expect(runtime.aborted).toBe(true)
    await failure
    await host.closeAll()
  })

  it('releases the slot AND confirms the provider stopped', async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(true)

    expect(runtime.aborted).toBe(true)
    expect(runtime.running).toBe(false)
    expect(host.sessionIds).toEqual([])
    const ending = await failure
    expect(ending).toBeInstanceOf(Error)
    const sentence = (ending as Error).message
    expect(sentence).toContain('stopped before it opened')
    expect(sentence).not.toContain('sess_')
    expect(sentence).not.toContain('codex start was cancelled')
    await host.closeAll()
  })

  it('…and the very next launch opens, so Cancel did not poison the app', async () => {
    const runtime = new StallingRuntime('tears-down')
    const real = new FakeRuntime('codex')
    let useReal = false
    const host = buildHost({
      provider: 'codex',
      listModels: (context) => real.listModels(context),
      start: (options) => (useReal ? real.start(options) : runtime.start(options)),
      resume: (ref, options) => real.resume(ref, options),
    })

    const failing = host
      .createSession({ provider: 'codex', launchKey: 'k1' }, sink)
      .catch(() => null)
    await waitFor(() => runtime.running, 'the provider to be spawned')
    await host.cancelLaunch('k1', sink.ownerId)
    await failing

    useReal = true
    const created = await host.createSession({ provider: 'codex' }, sink)
    expect(created.sessionId).toBe('sess_2')
    expect(host.sessionIds).toEqual(['sess_2'])
    await host.closeAll()
  })

  it('holds a reopen of the id until termination is confirmed, and starts nothing before', async () => {
    const closing = deferred()
    const runtime = new StallingRuntime('arrives-anyway', closing.promise)
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    const cancelling = host.cancelLaunch('k1', sink.ownerId)
    runtime.arriveNow()
    expect(await cancelling).toBe(true)
    await failure

    expect(host.sessionIds).toEqual([])
    expect(runtime.late?.closed()).toBe(false)
    let reopened = false
    const reopening = host.resumeSession('sess_1', sink).then(
      () => {
        reopened = true
      },
      () => {
        reopened = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(reopened).toBe(false)
    expect(runtime.late?.closed()).toBe(false)

    closing.resolve()
    await waitFor(() => runtime.late?.closed() === true, 'the hand-back to finish')
    await reopening
    expect(reopened).toBe(true)
    await host.closeAll()
  })

  it("will not let one window cancel another window's launch", async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    expect(await host.cancelLaunch('k1', 'owner:2')).toBe(false)
    expect(runtime.aborted).toBe(false)
    expect(runtime.running).toBe(true)

    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(true)
    await failure
    await host.closeAll()
  })

  it('says there was nothing to cancel, and leaves a session that already opened alone', async () => {
    const host = buildHost(new FakeRuntime('codex'))

    const created = await host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)

    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(false)
    expect(host.sessionIds).toEqual([created.sessionId])
    await host.closeAll()
  })
})
