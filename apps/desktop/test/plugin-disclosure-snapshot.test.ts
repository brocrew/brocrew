import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import fsPromises, { cp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { observeInstalledPackage } from '../src/main/plugins/state/observe-committed'
import { PluginFence } from '../src/main/plugins/state/fence'
import { cleanupLifecycleFixtures, stateFile } from './plugin-lifecycle-fixtures'
import { disclosureFixture, disclosureTree } from './plugin-disclosure-fixtures'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup() {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  return f
}
function snapshot(root: string) {
  return observeInstalledPackage({ root: join(root, 'state'), workspaceRoots: [] }, 'chrome')
}
it('reads only an immutable verified installed descriptor without a writer fence or effects', async () => {
  const f = await setup(),
    before = await f.snapshot(),
    acquire = vi.spyOn(PluginFence, 'acquire')
  const descriptor = await snapshot(f.f.root)
  expect(descriptor).toEqual({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
    manifestSha256: f.first.release.manifestSha256,
  })
  expect(Object.isFrozen(descriptor)).toBe(true)
  expect(acquire).not.toHaveBeenCalled()
  expect(await f.snapshot()).toEqual(before)
})
it('reads the prior descriptor while the real owner holds its fence without making it wait', async () => {
  const f = await setup(),
    before = await f.snapshot(),
    acquire = vi.spyOn(PluginFence, 'acquire')
  let finished = false
  await f.f.state.withExclusive(async () => {
    expect(await snapshot(f.f.root)).toMatchObject({ version: '1.0.1' })
    await Promise.resolve()
    finished = true
  })
  expect(finished).toBe(true)
  expect(acquire).not.toHaveBeenCalled()
  expect(await f.snapshot()).toEqual(before)
})
it('a damaged state file is unknown, and the read creates or repairs nothing', async () => {
  const f = await setup()
  await writeFile(stateFile(join(f.f.root, 'state'))!, '{"format":2')
  const before = await disclosureTree(f.f.root),
    acquire = vi.spyOn(PluginFence, 'acquire')
  expect(await snapshot(f.f.root)).toBeNull()
  expect(acquire).not.toHaveBeenCalled()
  expect(await disclosureTree(f.f.root)).toEqual(before)
})
it('an absent state root is unknown and is never created by a display read', async () => {
  const f = await setup(),
    before = await f.snapshot()
  expect(await snapshot(join(f.f.root, 'absent'))).toBeNull()
  expect(await f.snapshot()).toEqual(before)
})
it('an owner publication in progress is unknown with full state and bytes unchanged by the read', async () => {
  const f = await setup()
  await f.f.state.withExclusive(async () => {
    const state = f.f.state.inspect(),
      operationId = randomUUID()
    f.f.state.prepare({
      operationId,
      consent: {
        action: 'update',
        pluginId: 'chrome',
        at: 1000,
        expectedSequence: state.sequence,
        expectedInstallId: state.guards[0]!.installId,
        release: {
          version: '1.0.2',
          archiveSha256: f.next.release.archive.sha256,
          manifestSha256: f.next.release.manifestSha256,
          dataSchema: f.next.manifest.dataSchema,
        },
      },
      snapshot: null,
    })
    const before = await f.snapshot()
    expect(before.state.pending).not.toBeNull()
    expect(await snapshot(f.f.root)).toBeNull()
    expect(await f.snapshot()).toEqual(before)
    f.f.state.abort(operationId)
  })
})

it.each(['EBUSY', 'EPERM'])(
  '%s from a display-only read is unknown and has no effects',
  async (code) => {
    const f = await setup(),
      before = await f.snapshot()
    const read = vi.spyOn(fsPromises, 'readFile').mockImplementationOnce(async () => {
      throw Object.assign(new Error('busy'), { code })
    })
    syncBuiltinESMExports()
    expect(await snapshot(f.f.root)).toBeNull()
    read.mockRestore()
    syncBuiltinESMExports()
    expect(await f.snapshot()).toEqual(before)
  },
)
it.skipIf(process.platform === 'win32')(
  'repeated successful and failed display reads leave no file open',
  async () => {
    const f = await setup(),
      open = () => fs.readdirSync('/dev/fd').length,
      at = open()
    for (let i = 0; i < 20; i++)
      expect(await snapshot(f.f.root)).toMatchObject({ version: '1.0.1' })
    expect(open()).toBe(at)
    await writeFile(stateFile(join(f.f.root, 'state'))!, '{"format":2')
    for (let i = 0; i < 20; i++) expect(await snapshot(f.f.root)).toBeNull()
    expect(open()).toBe(at)
  },
)
it('displaying a copied state without its writer lock creates none', async () => {
  const f = await setup(),
    copy = join(f.f.root, 'display-copy')
  await cp(join(f.f.root, 'state'), join(copy, 'state'), { recursive: true })
  for (const name of ['writer-lock.sqlite', 'writer-lock.sqlite-wal', 'writer-lock.sqlite-shm'])
    await rm(join(copy, 'state', name), { force: true })
  const before = await disclosureTree(copy)
  expect(await snapshot(copy)).toMatchObject({ version: '1.0.1' })
  expect(await disclosureTree(copy)).toEqual(before)
})
