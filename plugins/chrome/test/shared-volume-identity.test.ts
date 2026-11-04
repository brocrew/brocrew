import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-volume-'))
  roots.push(root)
  const home = path.join(root, 'local'), shared = path.join(root, 'shared')
  fs.mkdirSync(home, { mode: 0o700 })
  fs.mkdirSync(shared, { mode: 0o700 })
  let volume = 'apfs:11111111-1111-4111-8111-111111111111'
  const open = () => createSharedProfileStore({
    home, shared, workspaceId: 'alpha', workspaceLabel: 'alpha',
    chromeState: () => 'ended', readVolumeIdentity: () => volume,
  })
  const file = path.join(shared, 'registry.json')
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  const edit = (change: (record: ReturnType<typeof read>) => void) => {
    const record = read(); change(record); fs.writeFileSync(file, JSON.stringify(record))
  }
  open().create('fern', 'panel')
  return { root, home, shared, open, file, read, edit, volume: (value: string) => { volume = value } }
}
it('enrols a persistent volume and automatically survives later device renumbering', () => {
  const f = fixture()
  expect(f.read().profiles[0].directory.volume).toBe('apfs:11111111-1111-4111-8111-111111111111')
  f.edit((r) => { r.profiles[0].directory.dev = '999999999' })
  expect(f.open().get('fern')?.enabled).toBe(true)
  f.open().shared.acquire('fern').release()
})
it('legacy anchorless record on a renumbered or cloned volume is rebound and logged once', () => {
  const f = fixture()
  f.edit((r) => {
    const id = r.profiles[0].directory
    r.profiles[0].directory = { dev: '999999999', ino: id.ino }
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(f.open().get('fern')?.enabled).toBe(true)
  expect(warn).toHaveBeenCalledWith('rebound after device renumbering')
  expect(f.read().profiles[0].directory.volume).toBeTruthy()
  warn.mockClear()
  expect(f.open().get('fern')?.enabled).toBe(true)
  expect(warn).not.toHaveBeenCalled()
})
it.each(['inode', 'mode', 'uid', 'volume', 'replacement', 'symlink'])(
  'refuses %s and preserves the record', (change) => {
    const f = fixture(), dir = path.join(f.shared, 'profiles/fern')
    if (change === 'inode') f.edit((r) => { r.profiles[0].directory.ino = '999999999' })
    if (change === 'mode') fs.chmodSync(dir, 0o755)
    if (change === 'uid') f.edit((r) => { r.profiles[0].directory.uid = '999999999' })
    if (change === 'volume') f.volume('apfs:22222222-2222-4222-8222-222222222222')
    if (change === 'replacement' || change === 'symlink') {
      const saved = path.join(f.root, 'saved')
      fs.renameSync(dir, saved)
      if (change === 'replacement') fs.mkdirSync(dir, { mode: 0o700 })
      else fs.symlinkSync(saved, dir, 'dir')
    }
    const before = fs.readFileSync(f.file, 'utf8')
    try {
      const store = f.open()
      expect(store.get('fern')?.enabled).toBe(false)
      expect(() => store.shared.acquire('fern')).toThrow()
    } catch (error) {
      if (change !== 'symlink') throw error
    }
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before)
  },
)
