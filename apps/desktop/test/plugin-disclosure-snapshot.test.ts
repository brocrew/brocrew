import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as privateFiles from '../src/main/plugins/private-files'
import { afterEach, expect, it, vi } from 'vitest'
import { readdir, unlink, cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginFence } from '../src/main/plugins/state/fence'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
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
  const read = Reflect.get(GlobalPluginState, 'readInstalledPackage') as
    ((options: { root: string; workspaceRoots: string[] }, id: string) => unknown) | undefined
  return read?.({ root: join(root, 'state'), workspaceRoots: [] }, 'chrome') ?? null
}
it('reads only an immutable verified installed descriptor without a writer fence or effects', async () => {
  const f = await setup(),
    before = await f.snapshot(),
    acquire = vi.spyOn(PluginFence, 'acquire')
  const descriptor = snapshot(f.f.root)
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
    expect(snapshot(f.f.root)).toMatchObject({ version: '1.0.1' })
    await Promise.resolve()
    finished = true
  })
  expect(finished).toBe(true)
  expect(acquire).not.toHaveBeenCalled()
  expect(await f.snapshot()).toEqual(before)
})
it('a missing seal returns unknown without repairing the journal or creating any file', async () => {
  const f = await setup(),
    folder = join(f.f.root, 'state', 'lifecycle-guard')
  const seal = (await readdir(folder))
    .filter((name) => name.endsWith('.seal'))
    .sort()
    .at(-1)!
  await unlink(join(folder, seal))
  // inspect() would repair the deliberately damaged journal; compare all bytes instead.
  const before = await disclosureTree(f.f.root),
    acquire = vi.spyOn(PluginFence, 'acquire')
  expect(snapshot(f.f.root)).toBeNull()
  expect(acquire).not.toHaveBeenCalled()
  expect(await disclosureTree(f.f.root)).toEqual(before)
})
it('an absent state root is unknown and is never created by a display read', async () => {
  const f = await setup(),
    before = await f.snapshot()
  expect(snapshot(join(f.f.root, 'absent'))).toBeNull()
  expect(await f.snapshot()).toEqual(before)
})
it('an owner publication in progress is unknown with full state and bytes unchanged by the read', async () => {
  const f = await setup()
  await f.f.state.withExclusive(async () => {
    f.f.state.requireUpdateReader()
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
    expect(snapshot(f.f.root)).toBeNull()
    expect(await f.snapshot()).toEqual(before)
    f.f.state.abort(operationId)
  })
})

it.each(['EBUSY', 'EPERM'])(
  '%s from a display-only read is unknown and has no effects',
  async (code) => {
    const f = await setup(),
      before = await f.snapshot()
    const stat = vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('busy'), { code })
    })
    syncBuiltinESMExports()
    expect(snapshot(f.f.root)).toBeNull()
    stat.mockRestore()
    syncBuiltinESMExports()
    expect(await f.snapshot()).toEqual(before)
  },
)
it('repeated successful and failed display reads close every pinned descriptor', async () => {
  const f = await setup(),
    opened: number[] = [],
    open = privateFiles.openDirectoryNotThroughALink
  vi.spyOn(privateFiles, 'openDirectoryNotThroughALink').mockImplementation((...args) => {
    const fd = open(...args)
    opened.push(fd)
    return fd
  })
  for (let i = 0; i < 20; i++) {
    expect(snapshot(f.f.root)).toMatchObject({ version: '1.0.1' })
    for (const fd of opened.splice(0)) expect(() => fs.fstatSync(fd)).toThrow()
  }
  const folder = join(f.f.root, 'state', 'lifecycle-guard'),
    seal = (await readdir(folder)).find((name) => name.endsWith('.seal'))!
  await unlink(join(folder, seal))
  for (let i = 0; i < 20; i++) {
    expect(snapshot(f.f.root)).toBeNull()
    expect(opened.length).toBeGreaterThan(0)
    for (const fd of opened.splice(0)) expect(() => fs.fstatSync(fd)).toThrow()
  }
})
it('displaying an incomplete copied state creates neither reservations nor a writer lock', async () => {
  const f = await setup(),
    copy = join(f.f.root, 'display-copy')
  await cp(join(f.f.root, 'state'), join(copy, 'state'), { recursive: true })
  await rm(join(copy, 'state', 'resolution-reservations'), { recursive: true })
  for (const name of ['writer-lock.sqlite', 'writer-lock.sqlite-wal', 'writer-lock.sqlite-shm'])
    await rm(join(copy, 'state', name), { force: true })
  const guard = join(copy, 'state', 'lifecycle-guard')
  await unlink(
    join(
      guard,
      (await readdir(guard)).find((name) => name.endsWith('.seal'))!,
    ),
  )
  const before = await disclosureTree(copy)
  expect(snapshot(copy)).toBeNull()
  expect(await disclosureTree(copy)).toEqual(before)
})

it('multiply linked records are unknown and never cause a reservation folder to be pinned', async () => {
  const f = await setup(),
    guard = join(f.f.root, 'state', 'lifecycle-guard')
  const record = (await readdir(guard)).filter((name) => name.endsWith('.json')).sort()[0]!
  fs.linkSync(join(guard, record), join(guard, `.stage-${randomUUID()}`))
  const before = await f.snapshot(),
    open = vi.spyOn(privateFiles, 'openDirectoryNotThroughALink')
  expect(snapshot(f.f.root)).toBeNull()
  expect(open.mock.calls.some(([path]) => path.includes('resolution-reservations'))).toBe(false)
  expect(await f.snapshot()).toEqual(before)
})
