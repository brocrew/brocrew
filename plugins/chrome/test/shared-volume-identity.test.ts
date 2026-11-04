import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { createProfileStore } from '../src/profiles/store.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-volume-'))
  roots.push(root)
  const home = path.join(root, 'local'),
    shared = path.join(root, 'shared')
  fs.mkdirSync(home, { mode: 0o700 })
  fs.mkdirSync(shared, { mode: 0o700 })
  let volume = 'apfs:11111111-1111-4111-8111-111111111111'
  const open = (over = {}) =>
    createSharedProfileStore({
      home,
      shared,
      workspaceId: 'alpha',
      workspaceLabel: 'alpha',
      chromeState: () => 'ended',
      readVolumeIdentity: () => volume,
      ...over,
    })
  const file = path.join(shared, 'registry.json')
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  const edit = (change: (record: ReturnType<typeof read>) => void) => {
    const record = read()
    change(record)
    fs.writeFileSync(file, JSON.stringify(record))
  }
  open().create('fern', 'panel')
  return {
    root,
    home,
    shared,
    open,
    file,
    read,
    edit,
    volume: (value: string) => {
      volume = value
    },
  }
}
it('enrols a persistent volume and automatically survives later device renumbering', () => {
  const f = fixture()
  expect(f.read().profiles[0].directory.volume).toBe('apfs:11111111-1111-4111-8111-111111111111')
  f.edit((r) => {
    r.profiles[0].directory.dev = '999999999'
  })
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
it.each(
  ['inode', 'mode', 'uid', 'type', 'birthtime', 'volume', 'replacement', 'symlink'].filter(
    (change) => change !== 'mode' || process.platform !== 'win32',
  ),
)('refuses %s and preserves the record', (change) => {
  const f = fixture(),
    dir = path.join(f.shared, 'profiles/fern')
  if (change === 'inode')
    f.edit((r) => {
      r.profiles[0].directory.ino = '999999999'
    })
  if (change === 'mode') fs.chmodSync(dir, 0o755)
  if (change === 'uid')
    f.edit((r) => {
      r.profiles[0].directory.uid = '999999999'
    })
  if (change === 'type')
    f.edit((r) => {
      r.profiles[0].directory.type = 'file'
    })
  if (change === 'birthtime')
    f.edit((r) => {
      r.profiles[0].directory.birthtime = '1'
    })
  if (change === 'volume') f.volume('apfs:22222222-2222-4222-8222-222222222222')
  if (change === 'replacement' || change === 'symlink') {
    const saved = path.join(f.root, 'saved')
    fs.renameSync(dir, saved)
    if (change === 'replacement') fs.mkdirSync(dir, { mode: 0o700 })
    else fs.symlinkSync(saved, dir, 'dir')
  }
  const before = JSON.stringify(f.read().profiles[0])
  let store: ReturnType<typeof f.open> | undefined
  try {
    store = f.open()
  } catch (error) {
    expect(String(error)).toMatch(/identity|unavailable/i)
  }
  if (store) {
    if (change === 'symlink') expect(() => store!.get('fern')).toThrow()
    else expect(store.get('fern')?.enabled).toBe(false)
    expect(() => store.shared.acquire('fern')).toThrow()
  }
  expect(JSON.stringify(f.read().profiles[0])).toBe(before)
})
it('rebinds directory, migrated source and owner home together without touching signed-in data', () => {
  const f = fixture()
  const local = createProfileStore({ home: f.home })
  local.create('moss', 'panel')
  const original = local.dirOf('moss')
  fs.writeFileSync(path.join(original, 'fictional-sign-in'), 'fictional account')
  const store = f.open({ migrationApproved: true })
  const name = store.list().find((p) => p.name === 'moss')!.name
  f.edit((r) => {
    const p = r.profiles.find((p: { name: string }) => p.name === name)
    for (const id of [p.directory, p.migration.source, p.migration.home]) {
      const ino = id.ino
      for (const key of Object.keys(id)) delete id[key]
      Object.assign(id, { dev: '999999999', ino })
    }
  })
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const restored = f.open()
  restored.setFlags(name, { enabled: true })
  expect(restored.shared.restoreName('moss')).toBe(name)
  expect(fs.readFileSync(path.join(restored.dirOf(name), 'fictional-sign-in'), 'utf8')).toBe(
    'fictional account',
  )
  const p = f.read().profiles.find((p: { name: string }) => p.name === name)
  for (const id of [p.directory, p.migration.source, p.migration.home])
    expect(id.volume).toBe('apfs:11111111-1111-4111-8111-111111111111')
  expect(log).toHaveBeenCalledTimes(3)
})
it.skipIf(process.platform === 'win32')(
  'refuses a legacy directory with changed private mode rather than repairing it',
  () => {
    const f = fixture()
    f.edit((r) => {
      r.profiles[0].directory = { dev: '999999999', ino: r.profiles[0].directory.ino }
    })
    const before = JSON.stringify(f.read().profiles[0])
    const dir = path.join(f.shared, 'profiles/fern')
    fs.chmodSync(dir, 0o755)
    expect(f.open().get('fern')?.enabled).toBe(false)
    expect(JSON.stringify(f.read().profiles[0])).toBe(before)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o755)
  },
)
it('a Windows serial change is refused even for an anchorless legacy record', () => {
  const f = fixture()
  f.edit((r) => {
    r.profiles[0].directory = { dev: '999999999', ino: r.profiles[0].directory.ino }
  })
  const open = f.open({ readVolumeIdentity: (_path: string, dev: string) => `winvol:${dev}` })
  expect(open.get('fern')?.enabled).toBe(false)
  expect(() => open.shared.acquire('fern')).toThrow()
})
it.skipIf(process.platform === 'win32')(
  'does not chmod a changed migration home before judging its legacy identity',
  () => {
    const f = fixture()
    createProfileStore({ home: f.home }).create('moss', 'panel')
    f.open({ migrationApproved: true })
    fs.chmodSync(f.home, 0o755)
    const before = JSON.stringify(f.read().profiles)
    expect(() => f.open()).toThrow('Profile folder identity changed.')
    expect(() => f.open()).toThrow('Profile folder identity changed.')
    expect(fs.statSync(f.home).mode & 0o777).toBe(0o755)
    expect(JSON.stringify(f.read().profiles)).toBe(before)
  },
)
it('a legacy record still requires current-user ownership', () => {
  const f = fixture(),
    dir = path.join(f.shared, 'profiles/fern')
  f.edit((r) => {
    r.profiles[0].directory = { dev: '999999999', ino: r.profiles[0].directory.ino }
  })
  const stat = fs.lstatSync
  vi.spyOn(fs, 'lstatSync').mockImplementation(((
    target: fs.PathLike,
    options?: { bigint?: boolean },
  ) => {
    const s = stat(target, options as { bigint: true })
    if (String(target) !== dir || !options?.bigint) return s
    return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: 999999999n })
  }) as typeof fs.lstatSync)
  const store = f.open()
  expect(store.get('fern')?.enabled).toBe(false)
  expect(() => store.shared.acquire('fern')).toThrow()
})
it('never publishes a rebind when a directory changes during native observation', () => {
  const f = fixture(),
    dir = path.join(f.shared, 'profiles/fern')
  f.edit((r) => {
    r.profiles[0].directory.dev = '999999999'
  })
  const before = JSON.stringify(f.read().profiles[0])
  let changed = false
  const store = f.open({
    readVolumeIdentity: (target: string) => {
      if (target === dir && !changed) {
        changed = true
        fs.renameSync(dir, path.join(f.root, 'original'))
        fs.mkdirSync(dir, { mode: 0o700 })
      }
      return 'apfs:11111111-1111-4111-8111-111111111111'
    },
  })
  expect(changed).toBe(true)
  expect(store.get('fern')?.enabled).toBe(false)
  expect(JSON.stringify(f.read().profiles[0])).toBe(before)
})
it.each(['private-mode', 'anchored-volume', 'different-disk-home'])(
  'a refused legacy migration still reserves local access and suppresses duplicate migration: %s',
  (change) => {
    const f = fixture()
    const local = createProfileStore({ home: f.home })
    local.create('moss', 'panel')
    local.setFlags('moss', { enabled: true })
    const source = local.dirOf('moss')
    fs.writeFileSync(path.join(source, 'fictional-sign-in'), 'fictional account')
    expect(() =>
      f.open({
        migrationApproved: true,
        checkpoint: (phase: string) => {
          if (phase === 'reserved') throw new Error('fictional stopped owner')
        },
      }),
    ).toThrow('fictional stopped owner')
    f.edit((r) => {
      const p = r.profiles.find((p: { migratedFrom?: string }) => p.migratedFrom === 'moss')
      for (const id of [p.directory, p.migration.source, p.migration.home]) {
        const ino = id.ino
        for (const key of Object.keys(id)) delete id[key]
        Object.assign(id, { dev: '999999999', ino })
      }
      if (change === 'anchored-volume')
        p.migration.home.volume = 'apfs:22222222-2222-4222-8222-222222222222'
      if (change === 'different-disk-home') {
        p.migration.error = 'different-disk'
        p.migration.home.uid = '999999999'
      }
    })
    if (change === 'private-mode') fs.chmodSync(source, 0o755)
    const store = f.open()
    const alias = store.list().find((p) => p.name.startsWith('local-'))!.name
    expect(store.get(alias)?.enabled).toBe(false)
    expect(() => store.dirOf(alias)).toThrow(/reserved/)
    expect(() => store.shared.authorization(alias)).toThrow(/reserved/)
    expect(() => store.shared.acquire(alias)).toThrow(/reserved/)
    f.open({ migrationApproved: true, ownerState: () => 'gone' })
    expect(
      f.read().profiles.filter((p: { migratedFrom?: string }) => p.migratedFrom === 'moss'),
    ).toHaveLength(1)
    expect(fs.readFileSync(path.join(source, 'fictional-sign-in'), 'utf8')).toBe(
      'fictional account',
    )
  },
)

it('re-observes a changed UUID between public operations with unchanged device and inode', () => {
  const f = fixture()
  const store = f.open()
  expect(store.get('fern')?.enabled).toBe(true)
  expect(store.shared.authorization('fern')).toBeTruthy()
  const before = JSON.stringify(f.read().profiles[0])
  f.volume('apfs:22222222-2222-4222-8222-222222222222')
  expect(store.get('fern')?.enabled).toBe(false)
  expect(() => store.shared.authorization('fern')).toThrow(/reserved/)
  expect(() => store.shared.acquire('fern')).toThrow(/reserved/)
  expect(JSON.stringify(f.read().profiles[0])).toBe(before)
  f.volume('apfs:11111111-1111-4111-8111-111111111111')
  expect(store.get('fern')?.enabled).toBe(true)
})
it('clears volume observations when a synchronous disk operation throws', () => {
  const f = fixture()
  const store = f.open()
  expect(() =>
    store.shared.withDiskAccess('fern', false, () => {
      expect(store.get('fern')?.enabled).toBe(true)
      throw new Error('fictional failed callback')
    }),
  ).toThrow('fictional failed callback')
  f.volume('apfs:22222222-2222-4222-8222-222222222222')
  expect(() => store.dirOf('fern')).toThrow(/reserved/)
})

it('each admission snapshot observes the current volume even when device and inode match', () => {
  const f = fixture(),
    store = f.open()
  const first = store.shared.admission('fern')
  expect(first.profile.enabled).toBe(true)
  expect(first.identity).toBe(store.shared.identity('fern'))
  expect(first.authorization).toBe(store.shared.authorization('fern'))
  f.volume('apfs:22222222-2222-4222-8222-222222222222')
  expect(() => store.shared.admission('fern')).toThrow(/reserved/)
  f.volume('apfs:11111111-1111-4111-8111-111111111111')
  expect(store.shared.admission('fern').profile.enabled).toBe(true)
})
