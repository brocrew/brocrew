import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, writeFile, cp, rm } from 'node:fs/promises'
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
it('reads a frozen selected descriptor without a writer lock or effects', async () => {
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
it('reads the selected snapshot when unused old journal input is incomplete without repairing any bytes', async () => {
  const f = await setup(),
    folder = join(f.f.root, 'state', 'lifecycle-guard')
  await mkdir(folder)
  await writeFile(join(folder, '00000000.json'), '{fictional incomplete old record')
  const before = await disclosureTree(f.f.root),
    acquire = vi.spyOn(PluginFence, 'acquire')
  expect(snapshot(f.f.root)).toMatchObject({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
  })
  expect(acquire).not.toHaveBeenCalled()
  expect(await disclosureTree(f.f.root)).toEqual(before)
})
it('an absent state root is unknown and is never created by a display read', async () => {
  const f = await setup(),
    before = await f.snapshot()
  expect(snapshot(join(f.f.root, 'absent'))).toBeNull()
  expect(await f.snapshot()).toEqual(before)
})
it('shows the prior selected release during a pending update with all state and bytes unchanged by the read', async () => {
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
    expect(snapshot(f.f.root)).toMatchObject({
      version: '1.0.1',
      archiveSha256: f.first.release.archive.sha256,
    })
    expect(await f.snapshot()).toEqual(before)
    f.f.state.abort(operationId)
  })
})

it.each(['EBUSY', 'EPERM'])(
  '%s from a display-only read is unknown and has no effects',
  async (code) => {
    const f = await setup(),
      before = await f.snapshot()
    const path = join(f.f.root, 'state', 'installed-state.json'),
      read = fs.readFileSync
    const fault = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
        if (String(args[0]) === path)
          throw Object.assign(new Error('fictional display read failure'), { code })
        return read(...args)
      })
    syncBuiltinESMExports()
    expect(snapshot(f.f.root)).toBeNull()
    expect(fault).toHaveBeenCalled()
    fault.mockRestore()
    syncBuiltinESMExports()
    expect(await f.snapshot()).toEqual(before)
  },
)
it('repeated successful and malformed snapshot reads close every descriptor they open', async () => {
  const f = await setup(),
    path = join(f.f.root, 'state', 'installed-state.json')
  const selected = fs.readFileSync(path)
  const opened: number[] = [],
    open = fs.openSync
  vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
    const fd = open(...args)
    if (String(args[0]) === path) opened.push(fd)
    return fd
  })
  syncBuiltinESMExports()
  for (let i = 0; i < 20; i++) {
    expect(snapshot(f.f.root)).toMatchObject({ version: '1.0.1' })
    expect(opened.length).toBeGreaterThan(0)
    for (const fd of opened.splice(0)) expect(() => fs.fstatSync(fd)).toThrow()
  }
  await writeFile(path, '{fictional truncated snapshot')
  const before = await disclosureTree(f.f.root)
  for (let i = 0; i < 20; i++) {
    expect(snapshot(f.f.root)).toBeNull()
    expect(opened.length).toBeGreaterThan(0)
    for (const fd of opened.splice(0)) expect(() => fs.fstatSync(fd)).toThrow()
  }
  expect(await disclosureTree(f.f.root)).toEqual(before)
  await writeFile(path, selected)
})
it('observes a copied snapshot without history or writer files and never repairs an incomplete copy', async () => {
  const f = await setup(),
    copy = join(f.f.root, 'display-copy'),
    state = join(copy, 'state')
  await cp(join(f.f.root, 'state'), state, { recursive: true })
  for (const name of [
    'operations.sqlite',
    'writer-lock.sqlite',
    'writer-lock.sqlite-wal',
    'writer-lock.sqlite-shm',
  ])
    await rm(join(state, name), { force: true })
  const path = join(state, 'installed-state.json'),
    selected = await fs.promises.readFile(path)
  let before = await disclosureTree(copy)
  expect(snapshot(copy)).toMatchObject({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
  })
  expect(await disclosureTree(copy)).toEqual(before)
  await writeFile(path, '{fictional incomplete copy')
  before = await disclosureTree(copy)
  expect(snapshot(copy)).toBeNull()
  expect(await disclosureTree(copy)).toEqual(before)
  expect(fs.existsSync(join(state, 'writer-lock.sqlite'))).toBe(false)
  expect(fs.existsSync(join(state, 'operations.sqlite'))).toBe(false)
  await writeFile(path, selected)
  before = await disclosureTree(copy)
  expect(snapshot(copy)).toMatchObject({ version: '1.0.1' })
  expect(await disclosureTree(copy)).toEqual(before)
})
it('reads a multiply linked selected snapshot without writing through either name', async () => {
  const f = await setup(),
    path = join(f.f.root, 'state', 'installed-state.json'),
    alias = path + '.fictional-alias'
  fs.linkSync(path, alias)
  const before = await f.snapshot(),
    bytes = fs.readFileSync(alias),
    acquire = vi.spyOn(PluginFence, 'acquire')
  expect(snapshot(f.f.root)).toMatchObject({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
  })
  expect(acquire).not.toHaveBeenCalled()
  expect(fs.readFileSync(alias)).toEqual(bytes)
  expect(await f.snapshot()).toEqual(before)
})
