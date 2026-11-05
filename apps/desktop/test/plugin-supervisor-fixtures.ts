import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginSupervisor, type OwnerOptions } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Only newly allocated fictional roots and captured children belong to these fixtures. */
export function supervisorFixtures() {
  const folders: string[] = []
  const owners: PluginSupervisor[] = []
  const leases: PluginWorkspaceLease[] = []
  const releases: Array<() => void | Promise<void>> = []
  async function fixture() {
    const folder = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-supervisor-'),
      ),
    )
    folders.push(folder)
    const root = join(folder, 'p'),
      workspaceRoot = join(folder, 'w')
    await mkdir(workspaceRoot)
    const options = { root, workspaceRoot, generation: randomUUID(), build: 'fictional' }
    const start = async (extra: Partial<OwnerOptions> = {}) => {
      const owner = await PluginSupervisor.start({
        root,
        workspaceRoots: [workspaceRoot],
        tickEvery: 60_000,
        ...extra,
      })
      owners.push(owner)
      return owner
    }
    const attach = async (extra: Partial<typeof options> = {}) => {
      const lease = await PluginWorkspaceLease.attach({ ...options, ...extra })
      leases.push(lease)
      return lease
    }
    const read = () => {
      const storage = new SupervisorStorage(root, [], false)
      try {
        return storage.read()
      } finally {
        storage.close()
      }
    }
    return { root, folder, workspaceRoot, options, start, attach, read }
  }
  async function cleanup() {
    for (const release of releases.splice(0)) await release()
    for (const lease of leases.splice(0)) lease.abandon()
    for (const owner of owners.splice(0)) {
      await owner.shutdown()
      await owner.closed
    }
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
  }
  return { fixture, cleanup, releases, owners, leases }
}
