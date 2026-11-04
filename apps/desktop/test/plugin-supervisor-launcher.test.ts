import { mkdtemp, mkdir, realpath, rm, access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { OWNER_LAUNCH_MS, OWNER_LIMITS } from '../src/main/plugins/supervisor/protocol'

const program = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (...args: unknown[]) => {
    program.start(...args)
    throw new Error('fictional unexpected program')
  },
}))
describe.skipIf(process.platform === 'win32')('immutable supervisor launcher refusal', () => {
  let root = ''
  afterEach(async () => {
    vi.useRealTimers()
    if (root) await rm(root, { recursive: true, force: true })
    program.start.mockClear()
    vi.restoreAllMocks()
  })
  it('a missing bundled runtime is unavailable without executing system Node or app code', async () => {
    root = await realpath(await mkdtemp('/tmp/fictional-launcher-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { mode: 0o700 })
    const launch = createPluginSupervisorLauncher({
      root: join(root, 'global'),
      workspaceRoots: [workspace],
      resourcesRoot: join(root, 'absent-app'),
    })
    await expect(launch()).rejects.toMatchObject({ code: 'unavailable' })
    expect(program.start).not.toHaveBeenCalled()
    await expect(access(join(root, 'global/supervisor/owner.json'))).rejects.toThrow()
  })
  it('logs one closed failure when attachment fails, without raw error details, and remains retryable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = new Error('fictional-private-key-path-and-stack')
    const attach = vi.spyOn(PluginWorkspaceLease, 'attach').mockRejectedValue(original)
    const attachment = new PluginSupervisorAttachment()
    const options = {
      root: '/fictional/global',
      workspaceRoot: '/fictional/workspace',
      build: 'fictional-build',
    }
    try {
      attachment.start(options)
      attachment.start(options)
      expect(await attachment.ready()).toBe(false)
      expect(attach).toHaveBeenCalledOnce()
      expect(attachment.lastStartError).toBe(original)
      expect(warning.mock.calls).toEqual([['[plugins] supervisor-start-failed']])
      attachment.start(options)
      expect(await attachment.ready()).toBe(false)
      expect(attach).toHaveBeenCalledTimes(2)
      expect(warning.mock.calls).toEqual([
        ['[plugins] supervisor-start-failed'],
        ['[plugins] supervisor-start-failed'],
      ])
    } finally {
      await attachment.quit()
    }
  })
  async function workspaceOptions() {
    root = await realpath(await mkdtemp('/tmp/fictional-launcher-'))
    const workspaceRoot = join(root, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    return {
      root: join(root, 'global'),
      workspaceRoot,
      generation: randomUUID(),
      build: 'fictional-build',
    }
  }
  it('waits for a cold six-second start and then authenticates the owner once', async () => {
    const options = await workspaceOptions()
    let owner: PluginSupervisor | undefined
    let lease: PluginWorkspaceLease | undefined
    let settled = false
    const ownerNow = performance.now.bind(performance)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const launch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 6_000))
      owner = await PluginSupervisor.start({
        root: options.root,
        workspaceRoots: [],
        now: ownerNow,
      })
    })
    const attaching = PluginWorkspaceLease.attach({ ...options, launch })
    const result = attaching.then(
      (value) => {
        settled = true
        return { lease: value }
      },
      (error: unknown) => {
        settled = true
        return { error }
      },
    )
    try {
      await vi.advanceTimersByTimeAsync(2_100)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(3_900)
      vi.useRealTimers()
      const completed = await result
      if ('error' in completed) throw completed.error
      lease = completed.lease
      expect(owner!.valid(lease.lease, lease.epoch)).toBe(true)
      expect(launch).toHaveBeenCalledOnce()
      expect(OWNER_LIMITS.request).toBe(2_000)
    } finally {
      vi.useRealTimers()
      const completed = await result
      if ('lease' in completed) lease = completed.lease
      await lease?.close()
      await owner?.shutdown()
    }
  })
  it('still expires a stalled start at the launch budget without retrying', async () => {
    const options = await workspaceOptions()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const launch = vi.fn(() => new Promise<void>(() => {}))
    const result = PluginWorkspaceLease.attach({ ...options, launch }).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(OWNER_LAUNCH_MS + 20)
    expect(await result).toMatchObject({ code: 'unavailable' })
    expect(launch).toHaveBeenCalledOnce()
  })
  it('retains the original failed start through the public refusal', async () => {
    const options = await workspaceOptions()
    const original = new Error('fictional runtime verification failure')
    const launch = createPluginSupervisorLauncher({
      root: options.root,
      workspaceRoots: [options.workspaceRoot],
      resourcesRoot: join(root, 'absent-app'),
      lifecycleForNewOwner: async () => {
        throw original
      },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const result = PluginWorkspaceLease.attach({ ...options, launch }).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(OWNER_LAUNCH_MS + 20)
    expect(await result).toMatchObject({ code: 'unavailable', cause: { cause: original } })
    expect(program.start).not.toHaveBeenCalled()
  })
  it('attaches to a simultaneous winner despite the losing launcher error', async () => {
    const options = await workspaceOptions()
    const owner = await PluginSupervisor.start({ root: options.root, workspaceRoots: [] })
    const read = vi.spyOn(SupervisorStorage.prototype, 'read').mockReturnValueOnce(null)
    const launch = vi.fn(async () => {
      throw new Error('fictional losing starter')
    })
    let lease: PluginWorkspaceLease | undefined
    try {
      lease = await PluginWorkspaceLease.attach({ ...options, launch })
      expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
      expect(launch).toHaveBeenCalledOnce()
    } finally {
      read.mockRestore()
      await lease?.close()
      await owner.shutdown()
    }
  })
  it('reuses one real owner at a selected root inside a workspace without a duplicate launch', async () => {
    root = await realpath(await mkdtemp('/tmp/fictional-launcher-'))
    const selected = join(root, 'global'),
      secondWorkspace = join(root, 'second-workspace')
    await mkdir(selected)
    await mkdir(secondWorkspace)
    const sentinel = join(selected, 'fictional-profile')
    await writeFile(sentinel, 'fictional opaque bytes')
    const owner = await PluginSupervisor.start({ root: selected, workspaceRoots: [root] })
    const launch = createPluginSupervisorLauncher({
      root: selected,
      workspaceRoots: [root],
      resourcesRoot: join(root, 'absent-app'),
    })
    let first: PluginWorkspaceLease | undefined, second: PluginWorkspaceLease | undefined
    try {
      first = await PluginWorkspaceLease.attach({
        root: selected,
        workspaceRoot: root,
        generation: randomUUID(),
        build: 'fictional-build',
        launch,
      })
      second = await PluginWorkspaceLease.attach({
        root: selected,
        workspaceRoot: secondWorkspace,
        generation: randomUUID(),
        build: 'fictional-build',
        launch,
      })
      expect(owner.valid(first.lease, first.epoch)).toBe(true)
      expect(owner.valid(second.lease, second.epoch)).toBe(true)
      expect(second.epoch).toBe(first.epoch)
      const storage = new SupervisorStorage(selected, [root], false)
      try {
        expect(storage.read()?.epoch).toBe(first.epoch)
      } finally {
        storage.close()
      }
      expect(program.start).not.toHaveBeenCalled()
      expect(await readFile(sentinel, 'utf8')).toBe('fictional opaque bytes')
    } finally {
      await first?.close()
      await second?.close()
      await owner.shutdown()
    }
    expect(await readFile(sentinel, 'utf8')).toBe('fictional opaque bytes')
  })
})
