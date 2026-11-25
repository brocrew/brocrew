import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { StorageEngine, type StorageRoots } from '../src/main/storage/engine'

/**
 * A conversation that names no folder works in its profile's own home, so Storage's Workspace row
 * counts what is made there, beside an old `brobot-workspace` where one is left, and never counts a
 * provider home's history a second time. Fictional files on a clean data root only.
 */

let scratch = ''
afterEach(async () => {
  if (scratch !== '') await rm(scratch, { recursive: true, force: true })
  scratch = ''
})

async function aCleanDataRoot(): Promise<{ roots: StorageRoots; put: PutFile }> {
  scratch = await mkdtemp(join(tmpdir(), 'brocrew-profile-home-storage-'))
  const data = join(scratch, 'data')
  await mkdir(data)
  const under = (...parts: string[]): string => join(data, ...parts)
  const roots: StorageRoots = {
    data,
    workspace: under('brobot-workspace'),
    providers: under('provider-homes'),
    output: under('worker-output'),
    database: [under('brobot2.sqlite')],
    backups: [under('backups')],
    plugins: null,
    cache: null,
    resources: under('resources'),
  }
  const put: PutFile = async (bytes, ...parts) => {
    await mkdir(dirname(under(...parts)), { recursive: true })
    await writeFile(under(...parts), Buffer.alloc(bytes, 66))
  }
  return { roots, put }
}
type PutFile = (bytes: number, ...parts: string[]) => Promise<void>

const home = (profile: string, ...rest: string[]): string[] => [
  'provider-homes',
  'default',
  profile,
  ...rest,
]

it('counts work made in a profile home once, apart from provider history, with no old workspace', async () => {
  const { roots, put } = await aCleanDataRoot()
  await put(10, ...home('brobot', 'plan.txt'))
  await put(20, ...home('brobot', 'projects', 'site', 'index.html'))
  await put(7, ...home('reviewer', 'notes.md'))
  await put(30, ...home('brobot', 'claude', 'projects', 'one', 'conversation.jsonl'))
  await put(40, ...home('reviewer', 'codex', 'sessions', 'one.jsonl'))
  await put(5, ...home('brobot', 'claude', 'settings.json'))

  const reading = await new StorageEngine(roots).measure()
  const part = (id: string) => reading.parts.find((one) => one.id === id)
  expect(part('workspace')).toMatchObject({ bytes: 37, partial: false })
  expect(part('provider-conversations')).toMatchObject({ bytes: 70, partial: false })
  // A provider home's own settings are neither work nor history, as before.
  expect(reading.totalBytes).toBe(107)

  const engine = new StorageEngine(roots)
  const top = await engine.children({ part: 'workspace', segments: [] })
  expect(top.entries).toEqual([{ name: 'provider-homes', bytes: 37, isDirectory: true }])
  const brobots = await engine.children({ part: 'workspace', segments: home('brobot') })
  expect(brobots.entries.map((entry) => [entry.name, entry.bytes])).toEqual([
    ['projects', 20],
    ['plan.txt', 10],
  ])
  expect(brobots.totalBytes).toBe(30)
})

it('still counts an old brobot-workspace beside the profile homes', async () => {
  const { roots, put } = await aCleanDataRoot()
  await put(10, ...home('brobot', 'plan.txt'))
  await put(11, 'brobot-workspace', 'left.md')
  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((one) => one.id === 'workspace')?.bytes).toBe(21)
  const top = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(top.entries.map((entry) => [entry.name, entry.bytes])).toEqual([
    ['brobot-workspace', 11],
    ['provider-homes', 10],
  ])
})

it('does not count a stray file where a profile folder would be, in either row', async () => {
  const { roots, put } = await aCleanDataRoot()
  await put(10, ...home('brobot', 'plan.txt'))
  await put(4, 'provider-homes', 'default', '.DS_Store')
  await put(3, 'provider-homes', '.DS_Store')
  await put(30, ...home('brobot', 'claude', 'projects', 'one', 'conversation.jsonl'))
  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((one) => one.id === 'workspace')?.bytes).toBe(10)
  expect(reading.parts.find((one) => one.id === 'provider-conversations')?.bytes).toBe(30)
  const homes = await new StorageEngine(roots).children({
    part: 'workspace',
    segments: ['provider-homes', 'default'],
  })
  expect(homes.entries.map((entry) => entry.name)).toEqual(['brobot'])
})

it('keeps the physical depth allowance for a grouped root: 64 real levels still count', async () => {
  const { roots, put } = await aCleanDataRoot()
  const deep = [...Array.from({ length: 63 }, () => 'd'), 'f']
  await put(6, 'brobot-workspace', ...deep)
  await put(9, 'backups', ...deep)
  const reading = await new StorageEngine(roots).measure()
  const part = (id: string) => reading.parts.find((one) => one.id === id)
  expect(part('workspace')).toMatchObject({ bytes: 6, partial: false })
  expect(part('backups')).toMatchObject({ bytes: 9, partial: false })
  // One level more is past the allowance, as it always was.
  await put(5, 'brobot-workspace', 'd', ...deep)
  const deeper = await new StorageEngine(roots).measure()
  expect(deeper.parts.find((one) => one.id === 'workspace')).toMatchObject({
    partial: true,
    error: 'limit',
  })
})
