import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginNodeProcess, PluginNodeStart } from '../src/main/plugins/node-host'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import {
  createSupervisedPluginHost,
  ownedPluginNodeProcess,
} from '../src/main/plugins/supervisor/node-host'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function processFixture(exited = Promise.resolve({ exited: true })) {
  return {
    runId: randomUUID(),
    receiptPath: '/fictional-not-read/foreign-exit.json',
    exited,
    stop: vi.fn(async () => ({ exited: true })),
    ready: vi.fn(async () => ({
      serverPid: 404941,
      origin: 'http://127.0.0.1:1',
      mcp: () => ({ url: '', headers: { Authorization: '' } }),
      admin: () => ({ url: '', headers: { Authorization: '' } }),
    })),
  } satisfies PluginNodeProcess
}

describe('exact host-run exit adapter', () => {
  it('only accepts positive exit from the captured handle', async () => {
    const process = processFixture()
    const child = ownedPluginNodeProcess(process)
    await expect(child.exited).resolves.toBeUndefined()
    await expect(child.descendantsGone()).resolves.toBe(true)
    await expect(child.stop()).resolves.toBeUndefined()
    expect(process.stop).toHaveBeenCalledOnce()
  })
  it("a clean foreign run or successful stop cannot replace this run's unknown proof", async () => {
    await expect(ownedPluginNodeProcess(processFixture()).exited).resolves.toBeUndefined()
    const own = ownedPluginNodeProcess(processFixture(Promise.resolve({ exited: false })))
    await expect(own.stop()).resolves.toBeUndefined()
    await expect(own.exited).rejects.toMatchObject({ code: 'cleanup-pending' })
    await expect(own.descendantsGone()).resolves.toBe(false)
  })
  it('a rejected witness is not a timeout or receipt-based success', async () => {
    const child = ownedPluginNodeProcess(processFixture(Promise.reject(new Error('fictional'))))
    await expect(child.exited).rejects.toMatchObject({ code: 'cleanup-pending' })
    await expect(child.descendantsGone()).resolves.toBe(false)
  })
  it('a pending witness never becomes positive evidence just because stop succeeds', async () => {
    const result = deferred<{ exited: boolean }>()
    const child = ownedPluginNodeProcess(processFixture(result.promise))
    const exited = vi.fn(),
      descendants = vi.fn()
    void child.exited.then(exited, () => undefined)
    void child.descendantsGone().then(descendants)
    await child.stop()
    expect(exited).not.toHaveBeenCalled()
    expect(descendants).not.toHaveBeenCalled()
    result.resolve({ exited: false })
    await expect(child.exited).rejects.toMatchObject({ code: 'cleanup-pending' })
  })
  it('unknown stop is refused even if the exact exit later proves clean', async () => {
    const process = processFixture()
    process.stop.mockResolvedValue({ exited: false })
    const child = ownedPluginNodeProcess(process)
    await expect(child.stop()).rejects.toMatchObject({ code: 'cleanup-pending' })
    await expect(child.exited).resolves.toBeUndefined()
  })
})

// The production disk fence is POSIX-only; Windows plugin storage remains unavailable.
describe.skipIf(process.platform === 'win32')('supervisor and Node-host controller join', () => {
  let root = '',
    owner: PluginSupervisor | undefined,
    lease: PluginWorkspaceLease | undefined
  afterEach(async () => {
    await lease?.close()
    await owner?.shutdown()
    if (root) await rm(root, { recursive: true, force: true })
    owner = undefined
    lease = undefined
  })
  async function attached(drainWithin = 1000) {
    root = await realpath(await mkdtemp('/tmp/fictional-supervisor-host-'))
    const global = join(root, 'global'),
      workspace = join(root, 'workspace')
    await mkdir(workspace, { mode: 0o700 })
    const launch = vi.fn(async () => {
      owner = await PluginSupervisor.start({
        root: global,
        workspaceRoots: [workspace],
        drainWithin,
      })
    })
    lease = await PluginWorkspaceLease.attach({
      root: global,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'fictional',
      launch,
    })
    expect(launch).toHaveBeenCalledOnce()
    return global
  }
  const spec = {} as PluginNodeStart // Explicit fake host: no package execution in these unit controls.
  it('registers a pending host start before the last lease ends, then cleans its exact run', async () => {
    const global = await attached()
    const pending = deferred<PluginNodeProcess>(),
      exited = deferred<{ exited: boolean }>()
    const process = processFixture(exited.promise)
    process.stop.mockImplementation(async () => {
      exited.resolve({ exited: true })
      return { exited: true }
    })
    const host = {
      start: vi.fn(() => pending.promise),
      stop: vi.fn(async () => ({ exited: true })),
    }
    const started = createSupervisedPluginHost(owner!, host).start(spec)
    await vi.waitFor(() => expect(host.start).toHaveBeenCalledOnce())
    const closing = lease!.close()
    await vi.waitFor(async () =>
      expect(JSON.parse(await readFile(join(global, 'supervisor/owner.json'), 'utf8')).phase).toBe(
        'draining',
      ),
    )
    pending.resolve(process)
    await started
    expect(await closing).toBe(true)
    expect(process.stop).toHaveBeenCalledOnce()
  })
  it('readiness failure retains the registered run for actual shutdown proof', async () => {
    await attached()
    const process = processFixture()
    process.ready.mockRejectedValue(new Error('fictional readiness failure'))
    const host = { start: vi.fn(async () => process), stop: vi.fn(async () => ({ exited: true })) }
    await expect(createSupervisedPluginHost(owner!, host).start(spec)).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(await lease!.close()).toBe(true)
    expect(process.stop).toHaveBeenCalledTimes(2)
  })
})
