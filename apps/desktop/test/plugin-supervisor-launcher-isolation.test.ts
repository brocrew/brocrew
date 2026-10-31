import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { OWNER_LAUNCH_MS } from '../src/main/plugins/supervisor/protocol'
import { PluginStartupError } from '../src/main/plugins/startup-failure'

vi.mock('../src/main/plugins/supervisor/storage', async (original) => {
  const actual = await original<typeof import('../src/main/plugins/supervisor/storage')>()
  return {
    ...actual,
    SupervisorStorage: class extends actual.SupervisorStorage {
      constructor(...args: ConstructorParameters<typeof actual.SupervisorStorage>) {
        super(...args)
        // Distinct temporary folders can receive the same device/inode after removal.
        Object.defineProperty(this, 'identity', { value: 'fictional-reused-directory' })
      }
    },
  }
})

describe.skipIf(process.platform === 'win32')('supervisor launch isolation between roots', () => {
  const roots: string[] = []
  let owner: PluginSupervisor | undefined
  let lease: PluginWorkspaceLease | undefined
  let release: (() => void) | undefined
  afterEach(async () => {
    vi.useRealTimers()
    release?.()
    await lease?.close()
    await owner?.shutdown()
    vi.restoreAllMocks()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
    owner = undefined
    lease = undefined
    release = undefined
  })
  async function options() {
    const folder = await realpath(await mkdtemp('/tmp/fictional-launch-isolation-'))
    roots.push(folder)
    const workspaceRoot = join(folder, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    return {
      root: join(folder, 'plugins'),
      workspaceRoot,
      generation: randomUUID(),
      build: 'fictional',
    }
  }
  async function leavePendingLaunch() {
    const first = await options()
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const failed = PluginWorkspaceLease.attach({ ...first, launch: () => pending }).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(OWNER_LAUNCH_MS + 20)
    expect(await failed).toMatchObject({ code: 'unavailable' })
    vi.useRealTimers()
  }
  it('runs a new root launcher despite a pending launch with the same directory identity', async () => {
    await leavePendingLaunch()
    const second = await options()
    owner = await PluginSupervisor.start({ root: second.root, workspaceRoots: [] })
    vi.spyOn(SupervisorStorage.prototype, 'read').mockReturnValueOnce(null)
    const launch = vi.fn(async () => {
      throw new Error('fictional losing starter')
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const attaching = PluginWorkspaceLease.attach({ ...second, launch })
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    release?.()
    lease = await attaching
    expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
    expect(launch).toHaveBeenCalledOnce()
  })
  it('keeps a new root launch failure despite a pending launch with the same directory identity', async () => {
    await leavePendingLaunch()
    const second = await options()
    const original = new Error('fictional runtime verification failure')
    const launch = vi.fn(async () => {
      throw new PluginStartupError('runtime', original)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const failed = PluginWorkspaceLease.attach({ ...second, launch }).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(OWNER_LAUNCH_MS + 20)
    expect(await failed).toMatchObject({ code: 'unavailable', cause: { cause: original } })
    expect(launch).toHaveBeenCalledOnce()
  })
})
