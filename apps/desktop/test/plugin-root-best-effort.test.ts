import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { windowsAccessLists } from '../src/main/recovery/windows-privacy'

const folders: string[] = [],
  stores: GlobalPluginState[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const state of stores.splice(0)) state.close()
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const parent = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-folder-'),
  )
  folders.push(parent)
  return { parent, root: join(parent, 'plugins') }
}
describe('plugin folders use ordinary filesystem access', () => {
  it('opens the selected state without requesting owner or ACL observations', async () => {
    const f = fixture(),
      restrict = vi
        .spyOn(windowsAccessLists, 'restrict')
        .mockRejectedValue(new Error('fictional ACL failure'))
    const user = vi
      .spyOn(windowsAccessLists, 'userSid')
      .mockRejectedValue(new Error('fictional SID failure'))
    await keepPluginRootPrivate(f.root, { platform: 'win32', lists: windowsAccessLists })
    const state = GlobalPluginState.create({ root: join(f.root, 'state'), workspaceRoots: [] })
    stores.push(state)
    expect(state.inspect().sequence).toBe(0)
    expect(restrict).not.toHaveBeenCalled()
    expect(user).not.toHaveBeenCalled()
  })
  it.skipIf(process.platform === 'win32')(
    'keeps a shared selected directory and its existing modes',
    async () => {
      const f = fixture()
      mkdirSync(f.root)
      chmodSync(f.root, 0o755)
      const before = statSync(f.root).mode
      writeFileSync(join(f.root, 'fictional-profile'), 'opaque preserved bytes')
      await keepPluginRootPrivate(f.root)
      expect(statSync(f.root).mode).toBe(before)
      expect(readFileSync(join(f.root, 'fictional-profile'), 'utf8')).toBe('opaque preserved bytes')
    },
  )
  it('uses the selected directory through a junction or directory alias', async () => {
    const f = fixture(),
      target = join(f.parent, 'selected')
    mkdirSync(target)
    symlinkSync(target, f.root, process.platform === 'win32' ? 'junction' : 'dir')
    await keepPluginRootPrivate(f.root)
    const state = GlobalPluginState.create({ root: join(f.root, 'state'), workspaceRoots: [] })
    stores.push(state)
    expect(state.inspect().sequence).toBe(0)
    expect(readFileSync(join(target, 'state', 'installed-state.json'))).toEqual(
      readFileSync(join(f.root, 'state', 'installed-state.json')),
    )
  })
})
