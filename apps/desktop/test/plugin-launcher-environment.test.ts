import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'

const fixture = vi.hoisted(() => ({ node: '', spawn: vi.fn() }))
vi.mock('../src/main/plugins/node-runtime', () => ({
  preparePluginNodeRuntime: async () => ({ id: 'a'.repeat(64) }),
  runtimeFiles: async () => ({ node: fixture.node }),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (...args: unknown[]) => {
    fixture.spawn(...args)
    throw new Error('Fictional captured launcher, no program executed')
  },
}))

let root = ''
afterEach(async () => {
  vi.unstubAllEnvs()
  fixture.spawn.mockClear()
  if (root) await rm(root, { recursive: true, force: true })
})

it('forwards ordinary HOME, PATH and custom environment through the production owner launcher', async () => {
  root = await realpath(
    await mkdtemp(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-launch-environment-'),
    ),
  )
  fixture.node = join(root, 'fictional-runtime', 'node')
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'plugin-supervisor'), { recursive: true })
  await writeFile(join(resources, 'plugin-supervisor', 'entry.cjs'), '// Fictional entry\n')
  vi.stubEnv('HOME', join(root, 'ordinary-home'))
  vi.stubEnv('USERPROFILE', join(root, 'ordinary-profile'))
  vi.stubEnv('PATH', join(root, 'ordinary-bin'))
  vi.stubEnv('FICTIONAL_LAUNCH_VALUE', 'ordinary inherited fixture')
  const launch = createPluginSupervisorLauncher({
    root: join(root, 'plugins'),
    workspaceRoots: [],
    resourcesRoot: resources,
  })
  await expect(launch()).rejects.toMatchObject({ code: 'unavailable' })
  expect(fixture.spawn).toHaveBeenCalledOnce()
  const options = fixture.spawn.mock.calls[0]![2] as { env: NodeJS.ProcessEnv }
  expect({
    home: options.env.HOME,
    profile: options.env.USERPROFILE,
    path: options.env.PATH,
    custom: options.env.FICTIONAL_LAUNCH_VALUE,
  }).toEqual({
    home: join(root, 'ordinary-home'),
    profile: join(root, 'ordinary-profile'),
    path: join(root, 'ordinary-bin'),
    custom: 'ordinary inherited fixture',
  })
})
