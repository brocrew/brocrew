import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
  unlink,
  lstat,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'
import { pluginStartupReason } from '../src/main/plugins/startup-failure'

let folder = ''
const children: ChildProcess[] = []
const leases: PluginWorkspaceLease[] = []
const successors: PluginSupervisor[] = []
const readOwner = async (root: string) =>
  JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8'))
function message(child: ChildProcess, event: string): Promise<{ runId?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('message', receive)
      reject(new Error('Fictional owner IPC timeout: ' + event))
    }, 10000)
    function receive(value: unknown) {
      if (value && typeof value === 'object' && 'event' in value && value.event === event) {
        clearTimeout(timeout)
        child.off('message', receive)
        resolve({
          runId: 'runId' in value && typeof value.runId === 'string' ? value.runId : undefined,
        })
      }
    }
    child.on('message', receive)
  })
}
async function ended(child: ChildProcess, within = 1500) {
  await expect
    .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: within })
    .toBe(true)
  return child.exitCode
}
beforeAll(async () => {
  folder = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-retire-')),
  )
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(folder, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/plugin-owner-self-exit.ts', import.meta.url))],
    outfile: join(folder, 'owner.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    target: 'node24',
    external: ['better-sqlite3'],
    plugins: [
      {
        name: 'fixture-windows-root-admission',
        setup(builder: {
          onResolve(
            options: { filter: RegExp },
            resolve: (args: { importer: string }) => { path: string } | undefined,
          ): void
        }) {
          const privacy = fileURLToPath(
            new URL('./fixtures/plugin-owner-private-root.ts', import.meta.url),
          )
          builder.onResolve({ filter: /private-files$/ }, (args) => {
            if (args.importer.replaceAll('\\', '/').endsWith('/plugin-owner-private-root.ts'))
              return undefined
            return { path: privacy }
          })
        },
      },
    ],
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const lease of leases.splice(0)) lease.abandon()
  for (const owner of successors.splice(0)) await owner.shutdown()
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    if (child.connected) child.send('finish')
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')
      child.kill('SIGKILL')
      await exit
    }
  }
})
afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})
async function fixture(name: string, mode: string, fault?: string) {
  const parent = join(folder, name),
    root = join(parent, 'p'),
    workspaceRoot = join(parent, 'w')
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })

  const child = fork(
    join(folder, 'owner.mjs'),
    [root, workspaceRoot, mode, ...(fault ? [fault] : [])],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  )
  children.push(child)
  let errors = ''
  child.stderr?.on('data', (bytes: Buffer) => {
    errors = (errors + bytes.toString()).slice(0, 2048)
  })
  try {
    await message(child, 'ready')
  } catch (error) {
    throw new Error(errors, { cause: error })
  }
  const options = { root, workspaceRoot, generation: randomUUID(), build: 'fictional' }
  const lease = await PluginWorkspaceLease.attach(options)
  leases.push(lease)
  const adopted = message(child, 'adopted')
  child.send('adopt')
  const { runId } = await adopted
  return { root, workspaceRoot, child, options, lease, runId }
}
describe('blocked standalone owner self-exit under its unchanged fence', () => {
  // A held owner.json must not retain a childless blocked owner: try advice once, then exit.
  it.each(['proven', 'revoke-hung'])(
    'exits when its blocked record stays refused with %s runs, and a successor starts',
    async (mode) => {
      const target = await fixture('blocked-write-held-' + mode, mode, 'blocked-write-held')
      const fence = await lstat(join(target.root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      await target.lease.close()
      expect(await ended(target.child)).toBe(0)
      expect((await readOwner(target.root)).phase).not.toBe('blocked')
      const trace = await readFile(join(target.root, 'service.log'), 'utf8')
      const attempts = trace.split('\n').filter((line) => line.includes('blocked-write'))
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatch(/state: 'failed'.*attempt: 1.*errno: 'EPERM'/)
      // Cause logging keeps the real error text and path.
      expect(trace).toContain(
        "cause: 'Error code=EPERM: Bearer fictional-secret /fictional/private-owner-path'",
      )
      const advice = vi.fn()
      const successor = await PluginSupervisor.start({
        root: target.root,
        workspaceRoots: [target.workspaceRoot],
        recoverPrevious: (previous) =>
          previousRunsProvenStopped(target.root, { previous, onRebootRequired: advice }),
      })
      successors.push(successor)
      expect(advice).not.toHaveBeenCalled()
      const after = await lstat(join(target.root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      expect([after.dev, after.ino]).toEqual([fence.dev, fence.ino])
    },
  )
  it.each(['none', 'proven', 'hung', 'revoke-hung'])(
    'exits after synthetic failure with %s physical runs, rechecks receipts, and leaves another slot untouched',
    async (mode) => {
      const fault = process.platform === 'win32' ? 'terminal-record-held' : undefined
      const bystander = await fixture('bystander-' + mode, 'healthy', fault)
      const target = await fixture('target-' + mode, mode, fault)
      const before = await readOwner(bystander.root)
      const fence = await lstat(join(target.root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      await target.lease.close()
      expect(await ended(target.child)).toBe(0)
      expect((await readOwner(target.root)).phase).toBe(fault ? 'draining' : 'blocked')
      if (fault)
        expect(await readFile(join(target.root, 'service.log'), 'utf8')).toMatch(
          /blocked-write.*state: 'failed'.*attempt: 1.*errno: 'EPERM'/,
        )
      const proof = target.runId
        ? join(target.root, 'host/runs', target.runId, 'exit.json')
        : undefined
      const bytes = proof ? await readFile(proof) : undefined
      if (proof) {
        await unlink(proof)
        // The process record names a stranger's reused group; only the receipt proves exit.
        const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          detached: true,
          stdio: 'ignore',
        })
        children.push(stranger)
        await once(stranger, 'spawn')
        await writeFile(
          join(target.root, 'host/runs', target.runId!, 'process.json'),
          JSON.stringify({
            format: 1,
            runId: target.runId,
            pluginId: 'fictional',
            releaseDigest: 'f'.repeat(64),
            guardianPid: 404941,
            groups: [[stranger.pid, '0:a birth this number no longer has']],
          }),
          { mode: 0o600 },
        )
      }
      const start = () =>
        PluginSupervisor.start({
          root: target.root,
          workspaceRoots: [target.workspaceRoot],
          recoverPrevious: () => previousRunsProvenStopped(target.root),
        })
      if (proof) {
        await expect(start()).rejects.toMatchObject({ code: 'cleanup-pending' })
        await writeFile(proof, bytes!, { mode: 0o600 })
      }
      const successor = await start()
      successors.push(successor)
      const after = await lstat(join(target.root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      expect([after.dev, after.ino]).toEqual([fence.dev, fence.ino])
      expect((await readOwner(target.root)).epoch).not.toBe(target.lease.epoch)
      expect(await readOwner(bystander.root)).toEqual(before)
      await expect(bystander.lease.renew()).resolves.toBeUndefined()
      expect(bystander.child.exitCode).toBeNull()
      expect(await bystander.lease.close()).toBe(!fault)
      expect(await ended(bystander.child)).toBe(0)
      if (fault)
        expect(await readFile(join(bystander.root, 'service.log'), 'utf8')).toMatch(
          /stopped-write.*state: 'failed'.*attempt: 1.*errno: 'EPERM'/,
        )
    },
  )
  it('holds the fence until actual process death, never merely until the retirement callback', async () => {
    const target = await fixture('target-gated', 'gated')
    const retiring = message(target.child, 'retirement-ready')
    await target.lease.close()
    await retiring
    expect(target.child.exitCode).toBeNull()
    const start = () =>
      PluginSupervisor.start({
        root: target.root,
        workspaceRoots: [target.workspaceRoot],
        recoverPrevious: () => previousRunsProvenStopped(target.root),
      })
    await expect(start()).rejects.toMatchObject({ code: 'busy' })
    target.child.send('exit-now')
    await ended(target.child)
    const successor = await start()
    successors.push(successor)
  })
  it.each(['live', 'unproved', 'start-failure'])(
    'keeps the fence for a %s physical witness and gives bounded restart advice',
    async (mode) => {
      const target = await fixture('target-' + mode, mode)
      const closing = target.lease.close()
      if (mode === 'start-failure') {
        await expect.poll(async () => (await readOwner(target.root)).phase).toBe('draining')
        target.child.send('fail-start')
      }
      expect(await closing).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(target.child.exitCode).toBeNull()
      await expect(
        PluginSupervisor.start({
          root: target.root,
          workspaceRoots: [target.workspaceRoot],
          recoverPrevious: () => previousRunsProvenStopped(target.root),
        }),
      ).rejects.toMatchObject({ code: 'busy' })
      let elapsed = 0
      const original = performance.now.bind(performance)
      vi.spyOn(performance, 'now').mockImplementation(() => original() + elapsed)
      const attempt = async () =>
        pluginStartupReason(
          await PluginWorkspaceLease.attach({ ...target.options, generation: randomUUID() }).catch(
            (error: unknown) => error,
          ),
          'service-start',
        )
      expect(await attempt()).toBe('cleanup-pending')
      elapsed = 61_000
      expect(await attempt()).toBe('previous-service-stopping')
      const storage = new SupervisorStorage(target.root, [target.workspaceRoot], false)
      try {
        expect(storage.read()?.epoch).toBe(target.lease.epoch)
      } finally {
        storage.close()
      }
    },
  )
})
