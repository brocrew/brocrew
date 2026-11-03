import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-migration-'))
  roots.push(root)
  const shared = path.join(root, 'shared')
  const home = path.join(root, 'local')
  fs.mkdirSync(shared)
  fs.mkdirSync(home)
  const local = createProfileStore({ home })
  local.create('fern', 'panel')
  local.setFlags('fern', { enabled: true, keepRunning: true })
  const source = local.dirOf('fern')
  fs.writeFileSync(path.join(source, 'fictional-sign-in'), 'signed-in-fixture')
  const open = (over = {}) =>
    createSharedProfileStore({
      home,
      shared,
      workspaceId: 'alpha',
      workspaceLabel: 'Alpha',
      chromeState: () => 'ended' as const,
      migrationApproved: true,
      ownerState: () => 'gone' as const,
      ...over,
    })
  return { root, shared, home, source, open }
}
for (const boundary of ['reserved', 'renamed', 'moved', 'local-retired', 'retired', 'ready'])
  it(`recovers a crash after ${boundary} without copy, credential edits or a second suffix`, () => {
    const f = fixture()
    const inode = fs.statSync(f.source).ino
    const copy = vi.spyOn(fs, 'cpSync')
    const copyFile = vi.spyOn(fs, 'copyFileSync')
    expect(() =>
      f.open({
        checkpoint: (phase: string) => {
          if (phase === boundary) throw new Error('simulated-crash')
        },
      }),
    ).toThrow('simulated-crash')
    const a = f.open()
    const name = a.shared.restoreName('fern')
    expect(a.get(name)).toMatchObject({ enabled: true, keepRunning: true })
    expect(fs.statSync(a.dirOf(name)).ino).toBe(inode)
    expect(fs.readFileSync(path.join(a.dirOf(name), 'fictional-sign-in'), 'utf8')).toBe(
      'signed-in-fixture',
    )
    expect(copy).not.toHaveBeenCalled()
    expect(copyFile).not.toHaveBeenCalled()
    expect(a.list()).toHaveLength(1)
  })
it('EXDEV leaves original data local and working, then can recover by rename later', () => {
  const f = fixture()
  const a = f.open({
    rename: () => {
      throw Object.assign(new Error('different disk'), { code: 'EXDEV' })
    },
  })
  const local = a.list().find((p) => p.name.startsWith('local-'))!
  expect(local.enabled).toBe(true)
  expect(a.shared.view(local.name)).toMatchObject({ migration: 'different-disk' })
  expect(a.dirOf(local.name)).toBe(f.source)
  expect(fs.existsSync(f.source)).toBe(true)
  const b = f.open()
  expect(fs.existsSync(f.source)).toBe(false)
  expect(b.shared.restoreName('fern')).toBe('fern')
})
for (const scenario of ['both', 'neither', 'wrong-source', 'wrong-destination'])
  it(`reserves rather than adopting ${scenario} folder identities`, () => {
    const f = fixture()
    expect(() =>
      f.open({
        checkpoint: (phase: string) => {
          if (phase === 'reserved') throw new Error('crash')
        },
      }),
    ).toThrow()
    const destination = path.join(f.shared, 'profiles', 'fern')
    if (scenario === 'both') fs.mkdirSync(destination)
    if (scenario === 'neither') fs.renameSync(f.source, path.join(f.root, 'original-safe'))
    if (scenario === 'wrong-source') {
      fs.renameSync(f.source, path.join(f.root, 'original-safe'))
      fs.mkdirSync(f.source)
    }
    if (scenario === 'wrong-destination') {
      fs.renameSync(f.source, path.join(f.root, 'original-safe'))
      fs.mkdirSync(destination)
    }
    const a = f.open()
    expect(a.get('fern')?.enabled).toBe(false)
    expect(() => a.shared.acquire('fern')).toThrow()
    expect(a.shared.view('fern')).toMatchObject({ status: 'moving' })
  })
it('running or uncertain legacy Chrome and missing folders are never migrated', () => {
  for (const state of ['live', 'unknown']) {
    const f = fixture()
    const a = f.open({ chromeState: () => state })
    expect(fs.existsSync(f.source)).toBe(true)
    expect(a.list().some((p) => !p.name.startsWith('local-'))).toBe(false)
  }
  const f = fixture()
  fs.renameSync(f.source, path.join(f.root, 'safe'))
  const held = f.open()
  expect(held.list()[0].name).toMatch(/^local-/)
  expect(held.list()[0].enabled).toBe(false)
  expect(() => held.dirOf(held.list()[0].name)).toThrow()
})
it('disabled legacy flags stay disabled and only the originating workspace receives its intent', () => {
  const f = fixture()
  createProfileStore({ home: f.home }).setFlags('fern', { enabled: false })
  const a = f.open()
  expect(a.get('fern')).toMatchObject({ enabled: false, keepRunning: true })
  fs.mkdirSync(path.join(f.root, 'other'))
  const other = createSharedProfileStore({
    home: path.join(f.root, 'other'),
    shared: f.shared,
    workspaceId: 'beta',
    workspaceLabel: 'Beta',
  })
  expect(other.get('fern')).toMatchObject({ enabled: false, keepRunning: false })
})
it('collision suffixes stay within 32 characters and reserved local-prefix legacy names migrate safely', () => {
  const f = fixture()
  const local = createProfileStore({ home: f.home })
  const long = 'a'.repeat(32)
  local.create(long, 'panel')
  local.create('local-legacy', 'panel')
  fs.mkdirSync(path.join(f.root, 'new-home'))
  const initial = createSharedProfileStore({
    home: path.join(f.root, 'new-home'),
    shared: f.shared,
    workspaceId: 'beta',
    workspaceLabel: 'Beta',
    chromeState: () => 'ended',
  })
  initial.create(long, 'panel')
  const a = f.open()
  const mapped = a.shared.restoreName(long)
  expect(mapped).not.toBe(long)
  expect(mapped.length).toBeLessThanOrEqual(32)
  expect(a.shared.restoreName('local-legacy')).toMatch(/^migrated-/)
  expect(a.get(mapped)).toBeDefined()
})
