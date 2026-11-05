import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginStateDisk } from '../src/main/plugins/state/disk'
import { snapshotFiles, snapshotPath } from './helpers/plugin-state-snapshot'

const roots: string[] = [],
  stores: GlobalPluginState[] = [],
  disks: PluginStateDisk[] = [],
  descriptors: number[] = []
type Point = 'staged' | 'published' | 'durable'
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const fd of descriptors.splice(0)) fs.closeSync(fd)
  for (const disk of disks.splice(0)) disk.close()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function folder() {
  const root = fs.mkdtempSync(join(tmpdir(), 'fictional-state-publications-'))
  roots.push(root)
  return root
}
function fixture(fault?: (point: Point) => void) {
  const root = folder(),
    options = { root, workspaceRoots: [], fault }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  const workspace = randomUUID(),
    id = 'fictional-heron'
  const publish = () => store.setEnabled(workspace, id, !store.getEnabled(workspace, id).enabled)
  return { root, options, store, workspace, id, publish }
}
function observer(root: string) {
  const disk = new PluginStateDisk({ root, workspaceRoots: [] }, false, true)
  disks.push(disk)
  return disk
}
function requireVersioned(root: string) {
  const files = snapshotFiles(root)
  expect(files.length).toBeGreaterThan(0)
  expect(fs.existsSync(join(root, 'installed-state.json'))).toBe(false)
  return files
}
function copySelected(root: string, ordinal?: string) {
  const selected = requireVersioned(root).at(-1)!,
    copy = folder()
  fs.mkdirSync(join(copy, 'snapshots'))
  const name = ordinal ? ordinal + '-cr.json' : selected.name
  fs.copyFileSync(selected.path, join(copy, 'snapshots', name))
  return copy
}

it('publishes fresh immutable names while an old descriptor keeps its exact bytes', () => {
  const f = fixture(),
    first = requireVersioned(f.root)[0]!,
    before = fs.readFileSync(first.path)
  expect(first.ordinal).toBe('0000000000000000')
  const fd = fs.openSync(first.path, 'r')
  descriptors.push(fd)
  f.publish()
  expect(fs.readFileSync(first.path)).toEqual(before)
  for (let i = 0; i < 12; i++) f.publish()
  const old = Buffer.alloc(before.length)
  expect(fs.readSync(fd, old, 0, old.length, 0)).toBe(before.length)
  expect(old).toEqual(before)
  const files = snapshotFiles(f.root)
  expect(files.at(-1)!.ordinal).toBe('0000000000000013')
  expect(files.length).toBeLessThanOrEqual(3)
  console.log(
    'native-versioned-held-growth',
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      publications: 14,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + fs.statSync(file.path).size, 0),
      directories: 1,
      heldOldBytes: old.length,
    }),
  )
})

it.each<Point>(['staged', 'published', 'durable'])(
  'keeps old or new state across the %s cut without a second stage name',
  (cut) => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === cut) throw new Error('fictional publication cut')
    })
    requireVersioned(f.root)
    armed = true
    for (let i = 0; i < 3; i++) {
      expect(f.publish).toThrow('fictional publication cut')
      expect(observer(f.root).load().sequence).toBe(cut === 'staged' ? 0 : i + 1)
      expect(fs.readdirSync(f.root).filter((name) => name.includes('stage'))).toEqual([])
    }
    armed = false
    f.publish()
    expect(observer(f.root).load().sequence).toBe(cut === 'staged' ? 1 : 4)
    expect(snapshotFiles(f.root).at(-1)!.ordinal).toBe(
      cut === 'staged' ? '0000000000000001' : '0000000000000004',
    )
  },
)

it('imports fixed JSON once without changing its bytes and preserves legacy corruption precedence', () => {
  const f = fixture(),
    bytes = fs.readFileSync(requireVersioned(f.root)[0]!.path),
    root = folder()
  const legacy = JSON.parse(bytes.toString())
  legacy.operations = legacy.recentOperations
  delete legacy.recentOperations
  const old = Buffer.from(JSON.stringify(legacy)),
    fixed = join(root, 'installed-state.json')
  fs.writeFileSync(fixed, old)
  const store = GlobalPluginState.open({ root, workspaceRoots: [] })
  stores.push(store)
  expect(store.inspect().sequence).toBe(0)
  expect(snapshotFiles(root)).toHaveLength(1)
  expect(fs.readFileSync(fixed)).toEqual(old)
  fs.writeFileSync(snapshotPath(root), '{fictional malformed newest')
  expect(() => observer(root).load()).toThrow()
  expect(fs.readFileSync(fixed)).toEqual(old)
  const corrupt = folder()
  fs.writeFileSync(join(corrupt, 'installed-state.json'), '{fictional malformed fixed')
  expect(() => observer(corrupt).load()).toThrow()
})

it('allocates exactly beyond the safe Number range from an isolated copied basename', () => {
  const f = fixture(),
    root = copySelected(f.root, '9007199254740991')
  expect(fs.existsSync(join(root, 'operations.sqlite'))).toBe(false)
  expect(observer(root).load().sequence).toBe(0)
  expect(fs.existsSync(join(root, 'writer-lock.sqlite'))).toBe(false)
  const store = GlobalPluginState.open({ root, workspaceRoots: [] })
  stores.push(store)
  store.setEnabled(f.workspace, f.id, false)
  expect(snapshotFiles(root).at(-1)!.ordinal).toBe('9007199254740992')
  store.setEnabled(f.workspace, f.id, true)
  expect(snapshotFiles(root).at(-1)!.ordinal).toBe('9007199254740993')
})

it('refuses ordinal exhaustion before writing or opening a stage', () => {
  const f = fixture(),
    root = copySelected(f.root, '9999999999999999')
  const store = GlobalPluginState.open({ root, workspaceRoots: [] })
  stores.push(store)
  const before = fs.readFileSync(snapshotPath(root)),
    open = vi.spyOn(fs, 'openSync')
  syncBuiltinESMExports()
  expect(() => store.setEnabled(f.workspace, f.id, false)).toThrow()
  expect(
    open.mock.calls.filter((call) => String(call[0]).endsWith('.installed-state-stage')),
  ).toEqual([])
  expect(snapshotFiles(root)).toHaveLength(1)
  expect(fs.readFileSync(snapshotPath(root))).toEqual(before)
})

it('refuses corrupt newest bytes instead of choosing an older complete publication', () => {
  const f = fixture()
  requireVersioned(f.root)
  const operationId = randomUUID()
  f.store.prepare({
    operationId,
    consent: {
      action: 'install',
      pluginId: f.id,
      at: 0,
      expectedSequence: 0,
      expectedInstallId: null,
      release: {
        version: '1.0.0',
        archiveSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        dataSchema: 1,
      },
    },
    snapshot: null,
  })
  f.store.complete(operationId)
  const admitted = {
    version: '1.0.0',
    archiveSha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
  }
  expect(GlobalPluginState.readInstalledPackage(f.options, f.id)).toEqual(admitted)
  f.publish()
  const files = snapshotFiles(f.root),
    old = fs.readFileSync(files[0]!.path)
  expect(files).toHaveLength(2)
  expect(JSON.parse(old.toString()).active[0]).toMatchObject({ pluginId: f.id, release: admitted })
  fs.writeFileSync(files[1]!.path, '{fictional corrupt newest')
  expect(() => observer(f.root).load()).toThrow()
  expect(GlobalPluginState.readInstalledPackage(f.options, f.id)).toBeNull()
  expect(fs.readFileSync(files[0]!.path)).toEqual(old)
})

it.each(['malformed', 'duplicate'] as const)(
  'refuses a %s final-name layout without modifying bytes',
  (kind) => {
    const f = fixture(),
      first = requireVersioned(f.root)[0]!,
      bytes = fs.readFileSync(first.path)
    const extra = join(
      f.root,
      'snapshots',
      kind === 'malformed' ? 'fictional-invalid.json' : first.ordinal + '-c0000000000000000.json',
    )
    fs.writeFileSync(extra, bytes)
    expect(() => observer(f.root).load()).toThrow()
    expect(fs.readFileSync(first.path)).toEqual(bytes)
    expect(fs.readFileSync(extra)).toEqual(bytes)
  },
)

it.each([1, 2])(
  'allows only one complete re-selection after a selected file disappears (%i disappearances)',
  (count) => {
    const f = fixture()
    requireVersioned(f.root)
    f.publish()
    const paths = snapshotFiles(f.root)
        .map((file) => file.path)
        .reverse(),
      read = fs.readFileSync
    let disappeared = 0
    vi.spyOn(fs, 'readFileSync').mockImplementation(
      (...args: Parameters<typeof fs.readFileSync>) => {
        if (disappeared < count && String(args[0]) === paths[disappeared]) {
          fs.unlinkSync(paths[disappeared]!)
          disappeared++
          throw Object.assign(new Error('fictional selected name disappeared'), { code: 'ENOENT' })
        }
        return read(...args)
      },
    )
    syncBuiltinESMExports()
    const disk = observer(f.root)
    if (count === 1) expect(disk.load().sequence).toBe(0)
    else expect(() => disk.load()).toThrow()
    expect(disappeared).toBe(count)
  },
)

it('cleans one abandoned stage or refuses before changing it when cleanup is denied', () => {
  const f = fixture()
  requireVersioned(f.root)
  const stage = join(f.root, '.installed-state-stage'),
    bytes = Buffer.from('fictional abandoned stage')
  fs.writeFileSync(stage, bytes)
  const unlink = fs.unlinkSync
  const denied = vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
    if (String(path) === stage)
      throw Object.assign(new Error('fictional held stage'), { code: 'EPERM' })
    return unlink(path)
  })
  syncBuiltinESMExports()
  expect(f.publish).toThrow()
  expect(fs.readFileSync(stage)).toEqual(bytes)
  expect(snapshotFiles(f.root)).toHaveLength(1)
  denied.mockRestore()
  syncBuiltinESMExports()
  f.publish()
  expect(fs.existsSync(stage)).toBe(false)
  expect(snapshotFiles(f.root).at(-1)!.ordinal).toBe('0000000000000001')
})

it('advances past four denied old files, wraps after fault bursts, and reclaims them after release', () => {
  let interrupted = false
  const f = fixture((point) => {
    if (interrupted && point === 'published') throw new Error('fictional missed cleanup')
  })
  requireVersioned(f.root)
  interrupted = true
  for (let i = 0; i < 12; i++) expect(f.publish).toThrow('fictional missed cleanup')
  interrupted = false
  const denied = new Set(
      snapshotFiles(f.root)
        .slice(0, 4)
        .map((file) => file.path),
    ),
    unlink = fs.unlinkSync
  const attempts: string[][] = []
  vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
    if (String(path).includes('/snapshots/') || String(path).includes('\\snapshots\\')) {
      attempts.at(-1)!.push(String(path))
      if (denied.has(String(path)))
        throw Object.assign(new Error('fictional held old file'), { code: 'EPERM' })
    }
    return unlink(path)
  })
  syncBuiltinESMExports()
  for (let i = 0; i < 16; i++) {
    attempts.push([])
    f.publish()
  }
  expect(attempts.every((pass) => pass.length <= 4 && new Set(pass).size === pass.length)).toBe(
    true,
  )
  expect(snapshotFiles(f.root)).toHaveLength(6)
  for (const path of denied)
    expect(attempts.flat().filter((attempt) => attempt === path).length).toBeGreaterThan(1)
  const bytes = snapshotFiles(f.root).reduce((sum, file) => sum + fs.statSync(file.path).size, 0)
  denied.clear()
  for (let i = 0; i < 8; i++) {
    attempts.push([])
    f.publish()
  }
  expect(snapshotFiles(f.root)).toHaveLength(2)
  console.log(
    'native-versioned-pruning',
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      heldFiles: 6,
      heldBytes: bytes,
      releasedFiles: snapshotFiles(f.root).length,
      maxDeleteAttempts: Math.max(...attempts.map((pass) => pass.length)),
    }),
  )
})

it.each([false, true])(
  'commits the independent descending plan and pins P (missed cleanup: %s)',
  (missed) => {
    let cut = false
    const f = fixture((point) => {
      if (cut && point === 'published') throw new Error('fictional planned cleanup cut')
    })
    const bytes = fs.readFileSync(requireVersioned(f.root)[0]!.path),
      directory = join(f.root, 'snapshots')
    const name = (id: number, cursor = 'r') =>
      String(id).padStart(16, '0') + '-c' + cursor + '.json'
    for (let id = 0; id < 9; id++) fs.writeFileSync(join(directory, name(id)), bytes)
    const previous = join(directory, name(9, '0000000000000005'))
    fs.writeFileSync(previous, bytes)
    const unlink = fs.unlinkSync,
      attempts: string[] = []
    vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
      if (/^\d{16}-c/.test(basename(String(path)))) attempts.push(basename(String(path)))
      return unlink(path)
    })
    syncBuiltinESMExports()
    cut = missed
    if (missed) expect(f.publish).toThrow('fictional planned cleanup cut')
    else f.publish()
    const tenth = join(directory, name(10, '0000000000000001'))
    expect(fs.existsSync(tenth)).toBe(true)
    expect(fs.readFileSync(previous)).toEqual(bytes)
    expect(attempts).toEqual(missed ? [] : [name(4), name(3), name(2), name(1)])
    attempts.length = 0
    cut = false
    f.publish()
    expect(attempts).toEqual([name(0), name(9, '0000000000000005'), name(8), name(7)])
    expect(fs.existsSync(join(directory, name(11, '0000000000000007')))).toBe(true)
    expect(fs.readFileSync(tenth).length).toBeGreaterThan(0)
  },
)

it('records a cleanup error without rejecting an already committed lifecycle save', () => {
  const f = fixture()
  requireVersioned(f.root)
  f.publish()
  const unlink = fs.unlinkSync,
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
    if (basename(String(path)).endsWith('.json'))
      throw Object.assign(new Error('fictional cleanup error'), { code: 'EIO' })
    return unlink(path)
  })
  syncBuiltinESMExports()
  expect(f.publish).not.toThrow()
  expect(observer(f.root).load().sequence).toBe(2)
  expect(warning).toHaveBeenCalled()
})

it('reports flat selection work as a fault backlog grows without opening history', () => {
  const f = fixture(),
    first = requireVersioned(f.root)[0]!,
    bytes = fs.readFileSync(first.path)
  const measurements: Array<{ files: number; milliseconds: number; bytes: number }> = []
  let written = 1
  for (const count of [4, 64, 512]) {
    for (; written < count; written++)
      fs.writeFileSync(
        join(f.root, 'snapshots', String(written).padStart(16, '0') + '-cr.json'),
        bytes,
      )
    const disk = observer(f.root),
      started = performance.now()
    expect(disk.load().sequence).toBe(0)
    measurements.push({
      files: count,
      milliseconds: performance.now() - started,
      bytes: count * bytes.length,
    })
  }
  console.info(
    'native-versioned-listing-cost',
    JSON.stringify({ node: process.version, platform: process.platform, measurements }),
  )
}, 30000)
