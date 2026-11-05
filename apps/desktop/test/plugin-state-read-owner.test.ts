import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { GlobalPluginState } from '../src/main/plugins/state/store'

const stores: GlobalPluginState[] = []
const roots: string[] = []
const releases: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const release of releases.splice(0)) release()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture(fault?: (point: 'staged' | 'published' | 'durable') => void) {
  const root = fs.mkdtempSync(join(tmpdir(), 'fictional-committed-state-'))
  roots.push(root)
  const options = { root, workspaceRoots: [], fault }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  return { root, options, store, workspace: randomUUID(), id: 'fictional-fern' }
}
it('owner reads reuse one decoded publication without filesystem I/O, including alias readers', () => {
  const f = fixture()
  const alias = f.root + '-alias'
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  roots.push(alias)
  const other = GlobalPluginState.open({ ...f.options, root: alias })
  stores.push(other)
  releases.push(f.store.retainOwnerReadSnapshot())
  const before = f.store.readView()
  const read = vi.spyOn(fs, 'readFileSync')
  const stat = vi.spyOn(fs, 'statSync')
  const open = vi.spyOn(fs, 'openSync')
  syncBuiltinESMExports()
  for (let i = 0; i < 50; i++) {
    expect(f.store.readView().sequence).toBe(before.sequence)
    expect(other.getEnabled(f.workspace, f.id)).toEqual({ enabled: true, revision: 0 })
    expect(f.store.currentInstallations()).toEqual([])
  }
  expect(read).not.toHaveBeenCalled()
  expect(stat).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})
it('publication invalidates the shared owner snapshot even when stat tokens cannot distinguish it', () => {
  const f = fixture()
  releases.push(f.store.retainOwnerReadSnapshot())
  expect(f.store.getEnabled(f.workspace, f.id).enabled).toBe(true)
  const keptStat = fs.statSync(join(f.root, 'installed-state.json'))
  const stat = vi.spyOn(fs, 'statSync').mockReturnValue(keptStat)
  syncBuiltinESMExports()
  f.store.setEnabled(f.workspace, f.id, false)
  expect(f.store.getEnabled(f.workspace, f.id)).toEqual({ enabled: false, revision: 1 })
  f.store.setEnabled(f.workspace, f.id, true)
  expect(f.store.getEnabled(f.workspace, f.id)).toEqual({ enabled: true, revision: 2 })
  expect(stat).not.toHaveBeenCalled()
})
it('a rename followed by a durability fault still exposes the published bytes to the owner', () => {
  let armed = false
  const f = fixture((point) => {
    if (armed && point === 'published') {
      armed = false
      throw new Error('fictional post-publication interruption')
    }
  })
  releases.push(f.store.retainOwnerReadSnapshot())
  expect(f.store.getEnabled(f.workspace, f.id).enabled).toBe(true)
  armed = true
  expect(() => f.store.setEnabled(f.workspace, f.id, false)).toThrow('fictional post-publication')
  expect(f.store.getEnabled(f.workspace, f.id)).toEqual({ enabled: false, revision: 1 })
  expect(
    JSON.parse(fs.readFileSync(join(f.root, 'installed-state.json'), 'utf8')).workspaceEnabled,
  ).toEqual([{ workspaceId: f.workspace, pluginId: f.id, enabled: false, revision: 1 }])
})
it('non-owner readers read fresh and never substitute an earlier valid snapshot for malformed bytes', () => {
  const f = fixture()
  expect(f.store.getEnabled(f.workspace, f.id).enabled).toBe(true)
  const selected = join(f.root, 'installed-state.json')
  const value = JSON.parse(fs.readFileSync(selected, 'utf8'))
  value.workspaceEnabled = [
    { workspaceId: f.workspace, pluginId: f.id, enabled: false, revision: 1 },
  ]
  fs.writeFileSync(selected, JSON.stringify(value))
  expect(f.store.getEnabled(f.workspace, f.id)).toEqual({ enabled: false, revision: 1 })
  fs.writeFileSync(selected, '{"format":')
  const before = fs.readFileSync(selected)
  expect(() => f.store.readView()).toThrow()
  expect(GlobalPluginState.readInstalledPackage(f.options, f.id)).toBeNull()
  expect(fs.readFileSync(selected)).toEqual(before)
})
it('working copies cannot mutate the owner snapshot before an atomic publication', () => {
  const f = fixture()
  releases.push(f.store.retainOwnerReadSnapshot())
  const before = f.store.readView()
  f.store.setTitlesEnabled(f.workspace, f.id, true)
  expect(before.getTitlesEnabled(f.workspace, f.id)).toEqual({ enabled: false, revision: 0 })
  expect(f.store.readView().getTitlesEnabled(f.workspace, f.id)).toEqual({
    enabled: true,
    revision: 1,
  })
})
