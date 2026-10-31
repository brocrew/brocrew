import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'

// These exercise the real SQLite fence and local socket. They do not qualify legacy Windows
// process retirement or the standalone production lifecycle.
describe('plugin owner recovery after the caller stops waiting', () => {
  let parent = ''
  let owner: PluginSupervisor | undefined
  let lease: PluginWorkspaceLease | undefined
  let child: ChildProcess | undefined
  let releaseWitness: (() => void) | undefined
  afterEach(async () => {
    releaseWitness?.()
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await lease?.close()
    await owner?.shutdown()
    if (parent) await rm(parent, { recursive: true, force: true })
    owner = undefined
    lease = undefined
    child = undefined
    releaseWitness = undefined
  })
  async function fixture() {
    parent = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-owner-recovery-'),
      ),
    )
    const root = join(parent, 'plugins')
    await keepPluginRootPrivate(root)
    const workspaceRoot = join(parent, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    const options = { root, workspaceRoot, build: 'fictional', generation: randomUUID() }
    owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot], drainWithin: 30 })
    lease = await PluginWorkspaceLease.attach(options)
    return { root, options }
  }
  it('publishes stopped after a delayed real child exit witness, even after shutdown returned false', async () => {
    const { root } = await fixture()
    const sentinel = join(root, 'profile-sentinel')
    await writeFile(sentinel, 'fictional-profile-and-installation', { mode: 0o600 })
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    await once(child, 'spawn')
    const realExit = once(child, 'exit')
    const delivery = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({
      stop() {
        child!.kill()
      },
      exited: realExit.then(() => delivery),
      async descendantsGone() {
        await realExit
        return child!.exitCode !== null || child!.signalCode !== null
      },
    })
    expect(await owner!.shutdown()).toBe(false)
    await realExit
    const phase = async () =>
      JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase
    expect(await phase()).not.toBe('stopped')
    releaseWitness!()
    await expect.poll(phase, { timeout: 1500 }).toBe('stopped')
    expect(await readFile(sentinel, 'utf8')).toBe('fictional-profile-and-installation')
  })
  it('does not turn a still-pending witness into a clean stop or overlap a successor', async () => {
    const { root, options } = await fixture()
    const delivery = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({
      stop() {},
      exited: delivery,
      async descendantsGone() {
        return true
      },
    })
    expect(await owner!.shutdown()).toBe(false)
    await expect(
      PluginSupervisor.start({ root, workspaceRoots: [options.workspaceRoot] }),
    ).rejects.toMatchObject({ code: 'busy' })
    const record = JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8'))
    expect(record.phase).not.toBe('stopped')
    releaseWitness!()
    await expect
      .poll(
        async () => JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase,
      )
      .toBe('stopped')
  })
  it.each(['blocked', 'draining'] as const)(
    'a %s refusal carries only the phase and attach stage',
    async (phase) => {
      const { root, options } = await fixture()
      const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
      try {
        const record = storage.read()!
        storage.write({ ...record, phase })
        await expect(
          PluginWorkspaceLease.attach({ ...options, generation: randomUUID() }),
        ).rejects.toMatchObject({ code: 'busy', diagnostic: { phase, stage: 'attach-record' } })
        storage.write(record)
      } finally {
        storage.close()
      }
    },
  )
})
