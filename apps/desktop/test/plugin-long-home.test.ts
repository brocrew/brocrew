import { expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { dirname, join } from 'node:path'
import { captureLog } from './lib/log-file'
import { seams, setup, settingsCall } from './plugin-production-fixtures'
import { cleanupLifecycleFixtures, fixture } from './plugin-lifecycle-fixtures'
import { pluginSocketPath } from '../src/main/plugins/socket-path'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'

async function deepRoot(f: Awaited<ReturnType<typeof setup>>) {
  const home = join(dirname(f.options.root), `fictional-deep-home-${'d'.repeat(120)}`)
  await mkdir(home, { mode: 0o700 })
  const root = join(home, 'plugins')
  expect(Buffer.byteLength(join(root, 'supervisor', 'owner.sock'))).toBeGreaterThan(100)
  return root
}

it.runIf(process.platform === 'darwin')(
  'starts with a plugin root too deep for a socket, using a short private folder',
  async () => {
    const f = await setup()
    const root = await deepRoot(f)
    const person = pluginSocketPath(root, 'person-control', 'person.sock')
    try {
      f.controller.start({ ...f.options, root })
      expect(await f.controller.ready!()).toBe(true)
      expect(seams.connect).toHaveBeenCalledWith(expect.objectContaining({ path: person }))
      expect(Buffer.byteLength(person)).toBeLessThanOrEqual(100)
      expect((await lstat(dirname(person))).mode & 0o777).toBe(0o700)
      await f.controller.close()
    } finally {
      await rm(dirname(person), { recursive: true, force: true })
    }
  },
)

it.runIf(process.platform === 'darwin')(
  'a real service and workspace lease meet over the short sockets of a too-deep root',
  async () => {
    const parent = await realpath(await mkdtemp('/tmp/fictional-long-home-'))
    const home = join(parent, `fictional-deep-home-${'d'.repeat(120)}`)
    const workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    const root = join(home, 'plugins')
    const owner = pluginSocketPath(root, 'supervisor', 'owner.sock')
    const f = await fixture()
    let service: PluginSupervisor | undefined
    let person: Awaited<ReturnType<typeof servePersonPluginControl>> | undefined
    try {
      service = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot] })
      expect((await lstat(owner)).isSocket()).toBe(true)
      const lease = await PluginWorkspaceLease.attach({
        root,
        workspaceRoot,
        generation: randomUUID(),
        build: 'fictional',
      })
      expect(await lease.close()).toBe(true)
      person = await servePersonPluginControl({
        root,
        key: 'a'.repeat(64),
        controller: f.controller,
        read: async () => null,
      })
      expect(person.path).toBe(pluginSocketPath(root, 'person-control', 'person.sock'))
      expect((await lstat(person.path)).isSocket()).toBe(true)
    } finally {
      await person?.close()
      if (service) {
        await service.shutdown()
        await service.closed
      }
      await rm(dirname(owner), { recursive: true, force: true })
      await rm(parent, { recursive: true, force: true })
      await cleanupLifecycleFixtures()
    }
  },
)

it.runIf(process.platform === 'darwin')(
  'a service started cold in a process with another TMPDIR is found by the app over a too-deep root',
  async () => {
    const parent = await realpath(await mkdtemp('/tmp/fictional-long-home-'))
    const home = join(parent, `fictional-deep-home-${'d'.repeat(120)}`)
    const workspaceRoot = join(home, 'workspace')
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    const root = join(home, 'plugins')
    const bundle = await bundleAWorker(
      'test/fixtures/owned-process-group.ts',
      join(parent, 'bundle'),
      'owner.cjs',
    )
    const program = `require(process.argv[1]).PluginSupervisor.start({ root: process.argv[2], workspaceRoots: [] })
      .then((owner) => { owner.closed.then(() => process.exit(0)); process.send('ready') },
        (error) => { process.send(String(error)); process.exit(1) })`
    const child = spawn(process.execPath, ['-e', program, bundle, root], {
      env: { ...process.env, NODE_OPTIONS: '', TMPDIR: join(parent, 'another-temp-folder') },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      expect((await once(child, 'message'))[0]).toBe('ready')
      const lease = await PluginWorkspaceLease.attach({
        root,
        workspaceRoot,
        generation: randomUUID(),
        build: 'fictional',
      })
      expect(await lease.close()).toBe(true)
      await once(child, 'exit')
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await rm(dirname(pluginSocketPath(root, 'supervisor', 'owner.sock')), {
        recursive: true,
        force: true,
      })
      await rm(parent, { recursive: true, force: true })
    }
  },
)

it.runIf(process.platform === 'linux')(
  'says the plugin folder path is too long where no short socket folder exists',
  async () => {
    const f = await setup()
    const root = await deepRoot(f)
    const captured = await captureLog()
    f.controller.start({ ...f.options, root })
    await f.controller.ready!()
    await expect(settingsCall(f.controller)({ kind: 'list' })).resolves.toEqual({
      ok: false,
      listState: 'fetch-error',
      reason: 'path-too-long',
    })
    const text = await captured.text()
    await captured.close()
    expect(text).toContain(
      "[plugins] path-too-long: The plugin folder's path is too long on this computer.",
    )
    expect(text).not.toContain('Check available disk space')
    expect(existsSync(root)).toBe(false)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.supervisor.start).not.toHaveBeenCalled()
    await f.controller.close()
  },
)
