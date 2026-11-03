import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { identity, withSharedLock } from '../src/profiles/sharedLock.js'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore, inspectChrome } from '../src/profiles/sharedStore.js'
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-shared-'))
  roots.push(root)
  const shared = path.join(root, 'shared')
  const home = path.join(root, 'local')
  fs.mkdirSync(shared)
  fs.mkdirSync(home)
  const open = (id = 'alpha', over = {}) => {
    const ownerHome = id === 'alpha' ? home : path.join(root, `local-${id}`)
    fs.mkdirSync(ownerHome, { recursive: true })
    return createSharedProfileStore({
      home: ownerHome,
      shared,
      workspaceId: id,
      workspaceLabel: id,
      chromeState: () => 'ended' as const,
      ...over,
    })
  }
  return { root, shared, home, open }
}
it('one list, creator on, other workspace off, global flags and scoped Keep running', () => {
  const f = fixture()
  const a = f.open()
  const b = f.open('beta')
  a.create('fern', 'panel')
  expect(a.get('fern')?.enabled).toBe(true)
  expect(b.get('fern')?.enabled).toBe(false)
  b.setFlags('fern', { enabled: true, keepRunning: true, allowExtensions: false })
  expect(a.get('fern')).toMatchObject({ keepRunning: false, allowExtensions: false })
  expect(b.get('fern')?.keepRunning).toBe(true)
})
it('temporary names cannot shadow a shared name and never leave the workspace', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  expect(() => a.create('fern', 'agent', { temporary: true })).toThrow()
  const temp = a.create('tmp-a', 'agent', { temporary: true })
  expect(temp.name).toMatch(/^local-/)
  expect(f.open('other').get(temp.name)).toBeUndefined()
})
it('unknown fields survive revisions; unsupported formats cannot run or write', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const p = path.join(f.shared, 'registry.json')
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  raw.future = { a: 1 }
  raw.profiles[0].future = 3
  fs.writeFileSync(p, JSON.stringify(raw))
  a.setFlags('fern', { keepRunning: true })
  const next = JSON.parse(fs.readFileSync(p, 'utf8'))
  expect(next.future).toEqual({ a: 1 })
  expect(next.profiles[0].future).toBe(3)
  expect(next.revision).toBeGreaterThan(raw.revision)
  next.format = 2
  fs.writeFileSync(p, JSON.stringify(next))
  expect(() => a.shared.authorization('fern')).toThrow()
  expect(() => a.setFlags('fern', { enabled: true })).toThrow()
})
it('leases refuse the same and other workspaces; release compares tokens', () => {
  const f = fixture()
  const a = f.open()
  const b = f.open('beta')
  a.create('fern', 'panel')
  const held = a.shared.acquire('fern')
  expect(() => b.shared.acquire('fern')).toThrow(/alpha/)
  held.release()
  const successor = b.shared.acquire('fern')
  held.release()
  expect(() => a.shared.acquire('fern')).toThrow(/beta/)
  successor.release()
})
it('unknown Chrome state preserves a lease on release', () => {
  const f = fixture()
  const a = f.open('alpha', { chromeState: () => 'unknown' })
  a.create('fern', 'panel')
  const lease = a.shared.acquire('fern')
  lease.release()
  expect(() => f.open('other').shared.acquire('fern')).toThrow()
})
it('delete confirmation binds identity, revision and on-in list and refuses any lease', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const old = a.shared.confirmation('fern')
  f.open('beta').setFlags('fern', { enabled: true })
  expect(() => a.shared.remove('fern', old)).toThrow(/changed/)
  const held = a.shared.acquire('fern')
  expect(() => a.shared.remove('fern', a.shared.confirmation('fern'))).toThrow(/use/)
  held.release()
  a.shared.remove('fern', a.shared.confirmation('fern'))
  expect(a.get('fern')).toBeUndefined()
})
it('real migration defaults to HOLD', () => {
  const f = fixture()
  const local = createProfileStore({ home: f.home })
  local.create('fern', 'panel')
  const a = f.open()
  const held = a.list().find((p) => !p.temporary)!
  expect(held.name).toMatch(/^local-/)
  expect(fs.existsSync(path.join(f.home, 'profiles', 'fern'))).toBe(true)
  expect(a.shared.view(held.name)).toMatchObject({ migration: 'qualification-required' })
})
it('rename-only migration retains directory and sign-in fixture inodes, collision map and scoped flags', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const local = createProfileStore({ home: f.home })
  local.create('fern', 'panel')
  local.setFlags('fern', { enabled: true })
  local.create('tmp-a', 'agent', { temporary: true })
  const source = path.join(f.home, 'profiles', 'fern')
  const cookie = path.join(source, 'fictional-sign-in')
  fs.writeFileSync(cookie, 'fictional-cookie')
  const before = fs.statSync(cookie)
  const migrated = f.open('alpha', { migrationApproved: true })
  const name = migrated.shared.restoreName('fern')
  expect(name).not.toBe('fern')
  expect(fs.existsSync(source)).toBe(false)
  expect(fs.statSync(path.join(migrated.dirOf(name), 'fictional-sign-in')).ino).toBe(before.ino)
  expect(fs.readFileSync(path.join(migrated.dirOf(name), 'fictional-sign-in'), 'utf8')).toBe(
    'fictional-cookie',
  )
  expect(migrated.get(name)?.enabled).toBe(true)
  expect(f.open('beta').get(name)?.enabled).toBe(false)
  expect(fs.existsSync(path.join(f.home, 'profiles', 'tmp-a'))).toBe(true)
})
it('slow live launches are never stolen by age, and uncertain owner or live orphan Chrome stays held', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  a.shared.acquire('fern')
  const file = path.join(f.shared, 'registry.json')
  const r = JSON.parse(fs.readFileSync(file, 'utf8'))
  r.profiles[0].lease.startedAt = '2000-01-01T00:00:00Z'
  fs.writeFileSync(file, JSON.stringify(r))
  expect(() => f.open('beta', { ownerState: () => 'alive' }).shared.acquire('fern')).toThrow()
  expect(() => f.open('beta', { ownerState: () => 'unknown' }).shared.acquire('fern')).toThrow()
  expect(() =>
    f.open('beta', { ownerState: () => 'gone', chromeState: () => 'live' }).shared.acquire('fern'),
  ).toThrow()
  const successor = f
    .open('beta', { ownerState: () => 'gone', chromeState: () => 'ended' })
    .shared.acquire('fern')
  successor.release()
})
it('disk deletion failure remains visible and reserved, and a fresh confirmation can retry', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const dir = a.dirOf('fern')
  // A nonempty directory passed as a file makes removal fail deterministically through a spy.
  const real = fs.rmSync
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
    if (p === dir) throw new Error('disk fault')
    return real(p, opts)
  })
  expect(() => a.shared.remove('fern', a.shared.confirmation('fern'))).toThrow('disk fault')
  expect(a.shared.view('fern')).toMatchObject({ status: 'deleting' })
  expect(() => a.create('fern', 'panel')).toThrow()
  expect(() => a.shared.acquire('fern')).toThrow()
  spy.mockRestore()
  a.shared.remove('fern', a.shared.confirmation('fern'))
  expect(a.get('fern')).toBeUndefined()
})
it('missing or replaced shared directories never recreate an empty profile with the old identity', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const dir = a.dirOf('fern')
  fs.renameSync(dir, path.join(f.root, 'original-safe'))
  expect(a.get('fern')?.enabled).toBe(false)
  expect(() => a.shared.acquire('fern')).toThrow()
  expect(fs.existsSync(dir)).toBe(false)
  fs.mkdirSync(dir)
  expect(() => a.shared.authorization('fern')).toThrow()
  expect(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8')).toContain('fern')
})
it('permission ABA changes the epoch while lease/helper bookkeeping does not', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const before = a.shared.authorization('fern')
  const lease = a.shared.acquire('fern')
  a.setHelper('fern', 'off')
  lease.release()
  expect(a.shared.authorization('fern')).toBe(before)
  a.setFlags('fern', { enabled: false })
  a.setFlags('fern', { enabled: true })
  expect(a.shared.authorization('fern')).not.toBe(before)
})
it('new readers can list unsupported registry formats read-only with all execution disabled', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const file = path.join(f.shared, 'registry.json')
  const r = JSON.parse(fs.readFileSync(file, 'utf8'))
  r.format = 2
  fs.writeFileSync(file, JSON.stringify(r))
  const b = f.open('other')
  expect(b.get('fern')?.enabled).toBe(false)
  expect(() => b.shared.authorization('fern')).toThrow()
  expect(() => b.create('new', 'panel')).toThrow()
})
it('temporary/shared same-name records have one stable, collision-free facade resolution', () => {
  const f = fixture()
  const legacy = createProfileStore({ home: f.home })
  legacy.create('fern', 'agent', { temporary: true })
  const other = f.open('beta')
  other.create('fern', 'panel')
  const a = f.open()
  const temp = a.list().find((p) => p.temporary)!
  expect(temp.name).toMatch(/^local-/)
  expect(a.get('fern')?.temporary).toBe(false)
  expect(a.get(temp.name)?.temporary).toBe(true)
  expect(a.dirOf(temp.name)).toBe(path.join(f.home, 'profiles', 'fern'))
  expect(a.dirOf('fern')).toBe(path.join(f.shared, 'profiles', 'fern'))
  expect(a.shared.restoreName('fern')).toBe(temp.name)
})
it('refuses shared metadata or profile-folder symlinks without following them', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const file = path.join(f.shared, 'registry.json')
  const safe = path.join(f.root, 'registry-safe')
  fs.renameSync(file, safe)
  fs.symlinkSync(safe, file)
  expect(() => a.list()).toThrow()
  fs.unlinkSync(file)
  fs.renameSync(safe, file)
  const dir = a.dirOf('fern')
  fs.renameSync(dir, path.join(f.root, 'profile-safe'))
  fs.symlinkSync(path.join(f.root, 'profile-safe'), dir, 'dir')
  expect(() => a.shared.acquire('fern')).toThrow()
  expect(fs.existsSync(path.join(f.root, 'profile-safe'))).toBe(true)
})
it('native ended proof treats unreadable, malformed, truncated and unnamed-process inspection as unknown', () => {
  const f = fixture()
  const dir = path.join(f.home, 'profiles')
  fs.mkdirSync(dir)
  expect(inspectChrome(dir, { list: () => null })).toBe('unknown')
  expect(inspectChrome(dir, { list: () => '' })).toBe('unknown')
  expect(inspectChrome(dir, { list: () => 'malformed listing' })).toBe('unknown')
  expect(inspectChrome(dir, { list: () => `123 renamed-browser --user-data-dir=${dir}` })).toBe(
    'unknown',
  )
  expect(inspectChrome(dir, { list: () => '123 /sbin/init' })).toBe('ended')
  expect(
    inspectChrome(dir, { platform: 'win32', list: () => '"ProcessId","CommandLine"\n"123",""' }),
  ).toBe('unknown')
})
it('local temporary permission epochs survive registry-write faults and off/on cannot reuse admission', () => {
  const f = fixture()
  const a = f.open()
  const temp = a.create('tmp-a', 'agent', { temporary: true })
  const before = a.shared.authorization(temp.name)
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((source, dest) => {
    if (String(dest) === path.join(f.shared, 'registry.json'))
      throw new Error('registry write fault')
    return rename(source, dest)
  })
  expect(() => a.setFlags(temp.name, { enabled: false })).toThrow('registry write fault')
  expect(() => a.setFlags(temp.name, { enabled: true })).toThrow('registry write fault')
  expect(a.shared.authorization(temp.name)).not.toBe(before)
})
it('disk mutations refuse a foreign browser and exclude another owner through the whole write', () => {
  const f = fixture()
  const a = f.open()
  const b = f.open('beta')
  a.create('fern', 'panel')
  const browser = a.shared.acquire('fern')
  const write = vi.fn()
  expect(() => b.shared.withDiskAccess('fern', true, write)).toThrow(/use/)
  expect(write).not.toHaveBeenCalled()
  browser.release()
  a.shared.withDiskAccess('fern', true, () => {
    expect(() => b.shared.acquire('fern')).toThrow(/use/)
    expect(() => b.shared.withDiskAccess('fern', false, write)).toThrow(/use/)
  })
  b.shared.acquire('fern').release()
})
it('disk writes require confirmed Chrome end and failed writes release only their reservation', () => {
  const f = fixture()
  let chrome = 'unknown'
  const a = f.open('alpha', { chromeState: () => chrome })
  a.create('fern', 'panel')
  const write = vi.fn()
  expect(() => a.shared.withDiskAccess('fern', true, write)).toThrow()
  expect(write).not.toHaveBeenCalled()
  chrome = 'ended'
  expect(() =>
    a.shared.withDiskAccess('fern', true, () => {
      throw new Error('disk fault')
    }),
  ).toThrow('disk fault')
  f.open('beta').shared.acquire('fern').release()
})
it('deletion resumes an owned tombstone after removal completed but final metadata write failed', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const rename = fs.renameSync
  let writes = 0
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (destination === path.join(f.shared, 'registry.json') && ++writes === 2)
      throw new Error('final write fault')
    return rename(source, destination)
  })
  expect(() => a.shared.remove('fern', a.shared.confirmation('fern'))).toThrow('final write fault')
  expect(fs.existsSync(path.join(f.shared, 'profiles', 'fern'))).toBe(false)
  expect(a.shared.view('fern')).toMatchObject({ status: 'deleting' })
  spy.mockRestore()
  a.shared.remove('fern', a.shared.confirmation('fern'))
  expect(a.get('fern')).toBeUndefined()
})
it('deletion recovery never removes a replacement directory', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const dir = a.dirOf('fern')
  const rm = fs.rmSync
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    if (target === dir) throw new Error('stop before removal')
    return rm(target, options)
  })
  expect(() => a.shared.remove('fern', a.shared.confirmation('fern'))).toThrow()
  spy.mockRestore()
  fs.renameSync(dir, path.join(f.root, 'original'))
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'replacement'), 'keep')
  expect(() => a.shared.remove('fern', a.shared.confirmation('fern'))).toThrow(/identity/)
  expect(fs.readFileSync(path.join(dir, 'replacement'), 'utf8')).toBe('keep')
})

it('a disk reservation retained during uncertain Chrome state can be released and retried later', () => {
  const f = fixture()
  let state = 'ended'
  const a = f.open('alpha', { chromeState: () => state })
  a.create('fern', 'panel')
  a.shared.withDiskAccess('fern', true, () => {
    state = 'unknown'
  })
  expect(() => f.open('beta').shared.acquire('fern')).toThrow(/use/)
  state = 'ended'
  a.shared.withDiskAccess('fern', true, () => undefined)
  f.open('beta').shared.acquire('fern').release()
})

it('the registry mutex tolerates a completed contender disappearing during realpath validation', () => {
  const f = fixture()
  const owner = identity()
  const folder = path.join(
    f.shared,
    'registry.lock',
    `${owner.pid}.${Buffer.from(owner.birth).toString('base64url')}.11111111-1111-4111-8111-111111111111`,
  )
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'ticket'), '1')
  const realpath = fs.realpathSync
  let removed = false
  vi.spyOn(fs, 'realpathSync').mockImplementation((target, options) => {
    if (target === folder && !removed) {
      removed = true
      fs.rmSync(folder, { recursive: true })
    }
    return realpath(target, options)
  })
  expect(withSharedLock(f.shared, owner, () => 'entered')).toBe('entered')
  expect(removed).toBe(true)
})

it('a registry publication fault during disk release retains the handle for same-process recovery', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const other = f.open('beta')
  const rename = fs.renameSync
  let completed = false
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (completed && destination === path.join(f.shared, 'registry.json'))
      throw new Error('release publication fault')
    return rename(source, destination)
  })
  expect(() =>
    a.shared.withDiskAccess('fern', true, () => {
      completed = true
    }),
  ).toThrow('release publication fault')
  expect(completed).toBe(true)
  expect(() => other.shared.acquire('fern')).toThrow(/use/)
  spy.mockRestore()
  a.shared.withDiskAccess('fern', true, () => undefined)
  a.shared.acquire('fern').release()
  other.shared.acquire('fern').release()
})
