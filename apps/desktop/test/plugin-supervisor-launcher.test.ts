import { mkdtemp, mkdir, realpath, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'

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
    const attach = vi
      .spyOn(PluginWorkspaceLease, 'attach')
      .mockRejectedValue(new Error('fictional-private-key-path-and-stack'))
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
