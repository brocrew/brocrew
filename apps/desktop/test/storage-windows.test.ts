import { afterEach, expect, it, vi } from 'vitest'
import { win32 } from 'node:path'
import { lstat } from 'node:fs/promises'

const disk = vi.hoisted(() => ({
  entries: new Map<
    string,
    {
      bytes?: number
      children?: string[]
      readError?: string
      statError?: string
      statErrors?: (string | undefined)[]
      realpathErrors?: (string | undefined)[]
      openErrors?: string[]
      vanishAfterYield?: boolean
    }
  >(),
  freeError: false,
  iteratorFailed: false,
}))
vi.mock('node:process', async (original) => {
  const module = await original<{ default: NodeJS.Process }>()
  return { ...module, default: { ...module.default, platform: 'win32' } }
})
vi.mock('node:path', async (original) => {
  const path = await original<typeof import('node:path')>()
  return { ...path, ...path.win32 }
})
vi.mock('node:fs/promises', () => ({
  lstat: async (path: string) => {
    const entry = disk.entries.get(win32.resolve(path).toLowerCase())
    if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    const failure = entry.statErrors?.shift()
    if (failure) throw Object.assign(new Error('stat failed'), { code: failure })
    if (entry.statError) throw Object.assign(new Error('stat failed'), { code: entry.statError })
    return {
      isSymbolicLink: () => false,
      isDirectory: () => entry.children !== undefined,
      isFile: () => entry.bytes !== undefined,
      size: entry.bytes ?? 0,
    }
  },
  realpath: async (path: string) => {
    const failure = disk.entries.get(win32.resolve(path).toLowerCase())?.realpathErrors?.shift()
    if (failure) throw Object.assign(new Error('realpath failed'), { code: failure })
    return win32.resolve(path)
  },
  statfs: async () => {
    if (disk.freeError) throw new Error('free space unavailable')
    return { bavail: 1000, bsize: 4096 }
  },
  opendir: async (path: string) => {
    const entry = disk.entries.get(win32.resolve(path).toLowerCase())
    const failure = entry?.openErrors?.shift()
    if (failure) throw Object.assign(new Error('open failed'), { code: failure })
    return {
      async *[Symbol.asyncIterator]() {
        for (const name of entry?.children ?? []) yield { name }
        if (entry?.vanishAfterYield)
          for (const name of entry.children ?? [])
            disk.entries.delete(win32.join(path, name).toLowerCase())
        if (entry?.readError) {
          disk.iteratorFailed = true
          throw Object.assign(new Error('directory read failed'), { code: entry.readError })
        }
      },
    }
  },
}))
import { StorageEngine, insideData, type StorageRoots } from '../src/main/storage/engine'

afterEach(() => {
  vi.restoreAllMocks()
  disk.entries.clear()
  disk.freeError = false
  disk.iteratorFailed = false
})

function storageRoots(): StorageRoots {
  const data = 'C:\\Users\\Avery\\AppData\\Roaming\\@brobot2\\desktop'
  return {
    data,
    workspace: win32.join(data, 'brobot-workspace'),
    providers: win32.join(data, 'provider-homes'),
    output: win32.join(data, 'worker-output'),
    database: [win32.join(data, 'brobot2.sqlite')],
    backups: [win32.join(data, 'backups')],
    plugins: win32.join(data, 'plugins'),
    cache: win32.join(data, 'Cache'),
    resources: win32.join(data, 'resources'),
  }
}

it('measures later Windows categories even when the workspace reaches its own entry limit', async () => {
  const roots = storageRoots()
  const { data } = roots
  const directory = (path: string, children: string[] = []) =>
    disk.entries.set(path.toLowerCase(), { children })
  directory(data)
  directory(
    roots.workspace,
    Array.from({ length: 20 }, (_, n) => `file-${n}`),
  )
  for (let n = 0; n < 20; n++)
    disk.entries.set(win32.join(roots.workspace, `file-${n}`).toLowerCase(), { bytes: 3 })
  directory(roots.providers)
  directory(roots.output)
  directory(roots.backups[0]!, ['database.sqlite'])
  disk.entries.set(win32.join(roots.backups[0]!, 'database.sqlite').toLowerCase(), { bytes: 41 })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 29 })
  directory(roots.plugins!)
  directory(roots.cache!)
  directory(roots.resources)
  const reading = await new StorageEngine(roots, { entries: 30, depth: 64 }).measure()
  expect(reading.parts.find((part) => part.id === 'workspace')).toMatchObject({
    partial: true,
    error: 'limit',
  })
  expect(reading.parts.find((part) => part.id === 'database')).toMatchObject({
    bytes: 29,
    partial: false,
  })
  expect(reading.parts.find((part) => part.id === 'backups')).toMatchObject({
    bytes: 41,
    partial: false,
  })
  expect(
    reading.parts.filter((part) => part.id !== 'workspace').every((part) => !part.partial),
  ).toBe(true)
  expect(insideData(data, win32.join(data, '..', 'desktop-other'))).toBe(false)
  expect(insideData(data, 'D:\\outside')).toBe(false)
  expect(insideData(data, win32.join(data.toUpperCase(), 'backups'))).toBe(true)
})

it('includes task output after fifty thousand workspace files while the walk keeps progressing', async () => {
  const roots = storageRoots()
  const names = Array.from({ length: 50_000 }, (_, n) => `file-${n}`)
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: [...names, 'task-output'] })
  for (const name of names)
    disk.entries.set(win32.join(roots.workspace, name).toLowerCase(), { bytes: 1 })
  disk.entries.set(win32.join(roots.workspace, 'task-output').toLowerCase(), {
    children: ['build'],
  })
  disk.entries.set(win32.join(roots.workspace, 'task-output', 'build').toLowerCase(), {
    bytes: 1_048_576,
  })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 29 })
  const progressed = vi.fn()
  const reading = await new StorageEngine(roots, undefined, undefined, progressed).measure()
  expect(reading.parts.find((part) => part.id === 'workspace')).toMatchObject({
    bytes: 1_098_576,
    partial: false,
  })
  expect(reading.totalBytes).toBe(1_098_605)
  expect(reading.partial).toBe(false)
  expect(progressed).toHaveBeenCalled()
  const listing = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(listing).toMatchObject({ totalBytes: 1_098_576, partial: false })
})

it('keeps measured workspace bytes when its directory stops yielding entries', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), {
    children: ['task-output'],
    readError: 'EACCES',
  })
  disk.entries.set(win32.join(roots.workspace, 'task-output').toLowerCase(), { bytes: 31 })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 7 })
  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((part) => part.id === 'workspace')).toEqual({
    id: 'workspace',
    bytes: 31,
    partial: true,
    error: 'unavailable',
  })
  expect(reading.totalBytes).toBe(38)
  expect(reading.partial).toBe(true)
})

it('counts nested and duplicate roots once using the existing category order', async () => {
  const base = storageRoots()
  const roots = {
    ...base,
    output: win32.join(base.workspace, 'task-output'),
    database: [base.database[0]!, base.database[0]!.toUpperCase()],
  }
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), {
    children: ['project', 'task-output', 'task-output-other'],
  })
  disk.entries.set(win32.join(roots.workspace, 'project').toLowerCase(), { bytes: 11 })
  disk.entries.set(win32.join(roots.workspace, 'task-output-other').toLowerCase(), { bytes: 5 })
  disk.entries.set(roots.output.toLowerCase(), { children: ['build'] })
  disk.entries.set(win32.join(roots.output, 'build').toLowerCase(), { bytes: 23 })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 7 })
  const reading = await new StorageEngine(roots).measure()
  expect(reading.totalBytes).toBe(46)
  expect(reading.totalBytes).toBe(
    reading.parts.reduce((total, part) => total + (part.bytes ?? 0), 0),
  )
  expect(reading.parts.find((part) => part.id === 'workspace')?.bytes).toBe(39)
  expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(0)
  expect(reading.parts.find((part) => part.id === 'database')?.bytes).toBe(7)
  expect(reading.partial).toBe(false)
})

it.each(['EIO', 'ENOENT'])('retains bytes and reports a late iterator %s', async (readError) => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: ['first', 'second'], readError })
  disk.entries.set(win32.join(roots.workspace, 'first').toLowerCase(), { bytes: 7 })
  disk.entries.set(win32.join(roots.workspace, 'second').toLowerCase(), { bytes: 11 })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 29 })
  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((part) => part.id === 'workspace')).toEqual({
    id: 'workspace',
    bytes: 18,
    partial: true,
    error: 'unavailable',
  })
  expect(reading).toMatchObject({ totalBytes: 47, partial: true })
})

it('keeps readable siblings after a child EACCES', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: ['first', 'denied', 'second'] })
  disk.entries.set(win32.join(roots.workspace, 'first').toLowerCase(), { bytes: 7 })
  disk.entries.set(win32.join(roots.workspace, 'denied').toLowerCase(), { statError: 'EACCES' })
  disk.entries.set(win32.join(roots.workspace, 'second').toLowerCase(), { bytes: 11 })
  expect((await new StorageEngine(roots).measure()).parts[0]).toEqual({
    id: 'workspace',
    bytes: 18,
    partial: true,
    error: 'unavailable',
  })
})

it('retains immediate children when enumeration fails after yielding their names', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), {
    children: ['first', 'second'],
    readError: 'EIO',
  })
  disk.entries.set(win32.join(roots.workspace, 'first').toLowerCase(), { bytes: 7 })
  disk.entries.set(win32.join(roots.workspace, 'second').toLowerCase(), { bytes: 11 })
  const listing = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(listing).toMatchObject({ totalBytes: 18, partial: true, error: 'unavailable' })
  expect(listing.entries.map((entry) => entry.bytes)).toEqual([11, 7])
})

it.each([false, true])(
  'counts task output once with nested=%s and preserves existing drill-down totals',
  async (nested) => {
    const base = storageRoots()
    const roots = {
      ...base,
      output: nested ? win32.join(base.workspace, 'task-output') : base.output,
    }
    disk.entries.set(roots.data.toLowerCase(), { children: [] })
    disk.entries.set(roots.workspace.toLowerCase(), {
      children: nested ? ['ordinary', 'task-output'] : ['ordinary'],
    })
    disk.entries.set(win32.join(roots.workspace, 'ordinary').toLowerCase(), { bytes: 13 })
    disk.entries.set(roots.output.toLowerCase(), { children: ['build'] })
    disk.entries.set(win32.join(roots.output, 'build').toLowerCase(), { bytes: 23 })
    disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 29 })
    const manifest = structuredClone(disk.entries)
    const reading = await new StorageEngine(roots).measure()
    expect(reading).toMatchObject({ totalBytes: 65, partial: false })
    expect(reading.parts.find((part) => part.id === 'workspace')?.bytes).toBe(nested ? 36 : 13)
    expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(nested ? 0 : 23)
    expect(
      (await new StorageEngine(roots).children({ part: 'workspace', segments: [] })).totalBytes,
    ).toBe(nested ? 36 : 13)
    expect(disk.entries).toEqual(manifest)
  },
)

it.each([false, true])(
  'does not duplicate aliases with ancestor-first=%s',
  async (ancestorFirst) => {
    const base = storageRoots()
    const backupChild = win32.join(base.backups[0]!, 'nested')
    const roots = {
      ...base,
      output: base.workspace.toUpperCase() + win32.sep,
      backups: [
        ...(ancestorFirst ? [base.backups[0]!, backupChild] : [backupChild, base.backups[0]!]),
        base.backups[0]!.toUpperCase() + win32.sep,
      ],
    }
    disk.entries.set(roots.data.toLowerCase(), { children: [] })
    disk.entries.set(roots.workspace.toLowerCase(), { children: ['ordinary'] })
    disk.entries.set(win32.join(roots.workspace, 'ordinary').toLowerCase(), { bytes: 13 })
    disk.entries.set(base.backups[0]!.toLowerCase(), { children: ['nested', 'other'] })
    disk.entries.set(backupChild.toLowerCase(), { children: ['copy'] })
    disk.entries.set(win32.join(backupChild, 'copy').toLowerCase(), { bytes: 23 })
    disk.entries.set(win32.join(base.backups[0]!, 'other').toLowerCase(), { bytes: 29 })
    expect((await lstat(roots.output)).isDirectory()).toBe(true)
    expect((await lstat(roots.backups[2]!)).isDirectory()).toBe(true)
    const reading = await new StorageEngine(roots).measure()
    expect(reading).toMatchObject({ totalBytes: 65, partial: false })
    expect(reading.parts.find((part) => part.id === 'workspace')?.bytes).toBe(13)
    expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(0)
    expect(reading.parts.find((part) => part.id === 'backups')?.bytes).toBe(52)
  },
)

it('preserves measured bytes when free space cannot be read and keeps absent roots empty', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 65 })
  disk.freeError = true
  const reading = await new StorageEngine(roots).measure()
  expect(reading).toMatchObject({ totalBytes: 65, freeBytes: null, partial: true })
  expect(reading.parts[0]).toEqual({ id: 'workspace', bytes: 0, partial: false })
  expect(reading.parts.every((part) => !part.partial)).toBe(true)
})

it('lets a later broader root count files excluded by an earlier category filter', async () => {
  const base = storageRoots()
  const roots = { ...base, output: base.providers }
  const provider = win32.join(roots.providers, 'default', 'fictional', 'codex')
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.providers.toLowerCase(), { children: ['default', 'other'] })
  disk.entries.set(win32.join(roots.providers, 'default').toLowerCase(), {
    children: ['fictional'],
  })
  disk.entries.set(win32.join(roots.providers, 'default', 'fictional').toLowerCase(), {
    children: ['codex'],
  })
  disk.entries.set(provider.toLowerCase(), { children: ['sessions', 'logs'] })
  disk.entries.set(win32.join(provider, 'sessions').toLowerCase(), { children: ['conversation'] })
  disk.entries.set(win32.join(provider, 'sessions', 'conversation').toLowerCase(), { bytes: 7 })
  disk.entries.set(win32.join(provider, 'logs').toLowerCase(), { children: ['log'] })
  disk.entries.set(win32.join(provider, 'logs', 'log').toLowerCase(), { bytes: 11 })
  disk.entries.set(win32.join(roots.providers, 'other').toLowerCase(), { bytes: 13 })
  const reading = await new StorageEngine(roots).measure()
  expect(reading).toMatchObject({ totalBytes: 31, partial: false })
  expect(reading.parts.find((part) => part.id === 'provider-conversations')?.bytes).toBe(7)
  expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(24)
  expect(
    (await new StorageEngine(roots).children({ part: 'agent-output', segments: [] })).totalBytes,
  ).toBe(31)
})

it('keeps overlap totals partial when an earlier eligible root cannot finish', async () => {
  const base = storageRoots()
  const roots = { ...base, output: win32.join(base.workspace, 'task-output') }
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: ['ordinary'], readError: 'EIO' })
  disk.entries.set(win32.join(roots.workspace, 'ordinary').toLowerCase(), { bytes: 13 })
  disk.entries.set(roots.output.toLowerCase(), { children: ['build'] })
  disk.entries.set(win32.join(roots.output, 'build').toLowerCase(), { bytes: 23 })
  const reading = await new StorageEngine(roots).measure()
  expect(reading).toMatchObject({ totalBytes: 13, partial: true })
  expect(reading.parts.find((part) => part.id === 'workspace')).toMatchObject({
    bytes: 13,
    partial: true,
    error: 'unavailable',
  })
  expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(0)
})

it.each(['stat', 'realpath', 'open'])(
  'does not claim a root that disappears during startup %s',
  async (phase) => {
    const base = storageRoots()
    const roots = { ...base, output: base.workspace.toUpperCase() + win32.sep }
    disk.entries.set(roots.data.toLowerCase(), { children: [] })
    disk.entries.set(roots.workspace.toLowerCase(), {
      children: ['build'],
      statErrors: phase === 'stat' ? [undefined, 'ENOENT'] : [],
      realpathErrors: phase === 'realpath' ? [undefined, 'ENOENT'] : [],
      openErrors: phase === 'open' ? ['ENOENT'] : [],
    })
    disk.entries.set(win32.join(roots.workspace, 'build').toLowerCase(), { bytes: 23 })
    const reading = await new StorageEngine(roots).measure()
    expect(reading).toMatchObject({ totalBytes: 23, partial: false })
    expect(reading.parts.find((part) => part.id === 'workspace')?.bytes).toBe(0)
    expect(reading.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(23)
  },
)

it('retains sized children that disappear before a late iterator error', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), {
    children: ['first'],
    readError: 'EIO',
    vanishAfterYield: true,
  })
  disk.entries.set(win32.join(roots.workspace, 'first').toLowerCase(), { bytes: 7 })
  const listing = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(listing).toMatchObject({ totalBytes: 7, partial: true, error: 'unavailable' })
  expect(listing.entries).toEqual([
    { name: 'first', bytes: 7, isDirectory: false, lastWrittenAt: expect.any(Number) },
  ])
})

it('preserves tied top-ten order and eviction totals regardless of directory order', async () => {
  const roots = storageRoots()
  const names = Array.from({ length: 17 }, (_, index) => `file-${String(index).padStart(2, '0')}`)
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: [...names].reverse() })
  for (const name of names)
    disk.entries.set(win32.join(roots.workspace, name).toLowerCase(), { bytes: 7 })
  const listing = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(listing).toMatchObject({
    totalBytes: 119,
    smallerBytes: 49,
    smallerCount: 7,
    partial: false,
  })
  expect(listing.entries.map((entry) => entry.name)).toEqual(names.slice(0, 10))
})

it('stops on cancellation after an earlier child read error', async () => {
  const roots = storageRoots()
  const broken = win32.join(roots.workspace, 'broken')
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  disk.entries.set(roots.workspace.toLowerCase(), { children: ['broken', 'second', 'third'] })
  disk.entries.set(broken.toLowerCase(), { children: ['good'], readError: 'EIO' })
  disk.entries.set(win32.join(broken, 'good').toLowerCase(), { bytes: 7 })
  for (const name of ['second', 'third'])
    disk.entries.set(win32.join(roots.workspace, name).toLowerCase(), { bytes: 11 })
  let checksAfterFailure = 0
  const engine = new StorageEngine(roots, undefined, () => {
    if (!disk.iteratorFailed) return false
    checksAfterFailure++
    return true
  })
  const listing = await engine.children({ part: 'workspace', segments: [] })
  expect(listing.error).toBe('cancelled')
  expect(checksAfterFailure).toBe(1)
})

it('keeps readable siblings when one branch exceeds the measurement depth', async () => {
  const roots = storageRoots()
  disk.entries.set(roots.data.toLowerCase(), { children: [] })
  let branch = roots.workspace
  for (let depth = 0; depth < 64; depth++) {
    disk.entries.set(branch.toLowerCase(), { children: ['d', 'sibling'] })
    disk.entries.set(win32.join(branch, 'sibling').toLowerCase(), { bytes: 2 })
    branch = win32.join(branch, 'd')
  }
  disk.entries.set(branch.toLowerCase(), { children: ['beyond-depth'] })
  disk.entries.set(win32.join(branch, 'beyond-depth').toLowerCase(), { bytes: 999 })
  disk.entries.set(roots.database[0]!.toLowerCase(), { bytes: 23 })

  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((part) => part.id === 'workspace')).toMatchObject({
    bytes: 128,
    partial: true,
    error: 'limit',
  })
  expect(reading).toMatchObject({ totalBytes: 151, partial: true })
})
