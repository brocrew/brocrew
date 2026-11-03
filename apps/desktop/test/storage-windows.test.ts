import { afterEach, expect, it, vi } from 'vitest'
import { win32 } from 'node:path'

const disk = vi.hoisted(() => ({
  elapsed: 0,
  entries: new Map<string, { bytes?: number; children?: string[] }>(),
}))
vi.mock('node:path', async (original) => {
  const path = await original<typeof import('node:path')>()
  return { ...path, ...path.win32 }
})
vi.mock('node:fs/promises', () => ({
  lstat: async (path: string) => {
    disk.elapsed += 2
    const entry = disk.entries.get(win32.normalize(path).toLowerCase())
    if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return {
      isSymbolicLink: () => false,
      isDirectory: () => entry.children !== undefined,
      isFile: () => entry.bytes !== undefined,
      size: entry.bytes ?? 0,
    }
  },
  realpath: async (path: string) => win32.normalize(path),
  statfs: async () => ({ bavail: 1000, bsize: 4096 }),
  opendir: async (path: string) => ({
    async *[Symbol.asyncIterator]() {
      for (const name of disk.entries.get(win32.normalize(path).toLowerCase())?.children ?? [])
        yield { name }
    },
  }),
}))
import { StorageEngine, insideData, type StorageRoots } from '../src/main/storage/engine'

afterEach(() => {
  vi.restoreAllMocks()
  disk.entries.clear()
  disk.elapsed = 0
})

it('measures later Windows categories even when the workspace reaches its own time limit', async () => {
  const data = 'C:\\Users\\Avery\\AppData\\Roaming\\@brobot2\\desktop'
  const roots: StorageRoots = {
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
  vi.spyOn(performance, 'now').mockImplementation(() => disk.elapsed)
  const reading = await new StorageEngine(roots, {
    entries: 1000,
    depth: 64,
    milliseconds: 30,
  }).measure()
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
