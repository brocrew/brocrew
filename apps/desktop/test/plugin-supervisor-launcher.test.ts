import { mkdtemp, mkdir, realpath, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { OWNER_LIMITS } from '../src/main/plugins/supervisor/protocol'

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
  it('authenticates the owner once a cold start passes the former launch deadline', async () => {
    const options = await workspaceOptions()
    let owner: PluginSupervisor | undefined
    let lease: PluginWorkspaceLease | undefined
    let settled = false
    const ownerNow = performance.now.bind(performance)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const launch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 65_000))
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
      await vi.advanceTimersByTimeAsync(64_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
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
  it('lets a caller cancel its own pending launch wait', async () => {
    const options = await workspaceOptions()
    const stopping = new AbortController()
    let finish!: (reason: unknown) => void
    const launch = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          finish = reject
        }),
    )
    let settled = false
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const result = PluginWorkspaceLease.attach({
      ...options,
      launch,
      signal: stopping.signal,
    }).then(
      (value) => ({ value }),
      (error: unknown) => {
        settled = true
        return { error }
      },
    )
    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(launch).toHaveBeenCalledOnce()
      stopping.abort(new Error('fictional app quit'))
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      expect(await result).toMatchObject({ error: { code: 'unavailable' } })
    } finally {
      finish(new Error('fictional launcher ended during cleanup'))
      vi.useRealTimers()
      await result
    }
  })
  it('quits a pending admission without an external abort signal', async () => {
    const { root, workspaceRoot, build } = await workspaceOptions()
    const attachment = new PluginSupervisorAttachment()
    let finish!: (error: Error) => void
    const launch = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          finish = reject
        }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    attachment.start({ root, workspaceRoot, build, launch })
    await vi.advanceTimersByTimeAsync(0)
    expect(launch).toHaveBeenCalledOnce()
    let settled = false
    const quitting = attachment.quit().then(() => {
      settled = true
    })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
      expect(await attachment.ready()).toBe(false)
    } finally {
      finish(new Error('fictional launcher ended during cleanup'))
      vi.useRealTimers()
      await quitting
    }
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
    let settled = false
    const result = PluginWorkspaceLease.attach({ ...options, launch }).catch((error: unknown) => {
      settled = true
      return error
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(true)
    expect(await result).toMatchObject({ code: 'unavailable', cause: { cause: original } })
    expect(program.start).not.toHaveBeenCalled()
  })
  it('refuses a global root inside a workspace before writing or starting anything', async () => {
    root = await realpath(await mkdtemp('/tmp/fictional-launcher-'))
    const launch = createPluginSupervisorLauncher({
      root: join(root, 'global'),
      workspaceRoots: [root],
      resourcesRoot: join(root, 'absent-app'),
    })
    await expect(launch()).rejects.toMatchObject({ code: 'unavailable' })
    expect(program.start).not.toHaveBeenCalled()
    await expect(access(join(root, 'global'))).rejects.toThrow()
  })
})
