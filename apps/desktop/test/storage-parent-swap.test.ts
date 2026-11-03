import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({ target: '', swap: async () => {} }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return {
    ...fs,
    opendir: async (path: string) => {
      const handle = await fs.opendir(path)
      if (path !== control.target) return handle
      return {
        async *[Symbol.asyncIterator]() {
          for await (const entry of handle) {
            await control.swap()
            yield entry
          }
        },
      }
    },
  }
})
import { StorageEngine } from '../src/main/storage/engine'

let folder = ''
afterEach(async () => {
  control.target = ''
  if (folder) await rm(folder, { recursive: true, force: true })
})

it('does not count an outside file after its enumerated parent becomes a link or junction', async () => {
  folder = await mkdtemp(join(tmpdir(), 'fictional-storage-parent-swap-'))
  const data = join(folder, 'data')
  const workspace = join(data, 'workspace')
  const outside = join(folder, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside)
  await writeFile(join(workspace, 'same-name'), Buffer.alloc(7))
  await writeFile(join(outside, 'same-name'), Buffer.alloc(999))
  control.target = await realpath(workspace)
  let swapped = false
  control.swap = async () => {
    if (swapped) return
    swapped = true
    await rename(workspace, `${workspace}-original`)
    await symlink(outside, workspace, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const reading = await new StorageEngine({
    data,
    workspace,
    providers: join(data, 'providers'),
    output: join(data, 'output'),
    database: [join(data, 'database')],
    backups: [join(data, 'backups')],
    plugins: join(data, 'plugins'),
    cache: join(data, 'cache'),
    resources: join(data, 'resources'),
  }).measure()
  expect(swapped).toBe(true)
  expect(reading.parts.find((part) => part.id === 'workspace')).toMatchObject({
    bytes: null,
    partial: true,
  })
  expect((await readFile(join(outside, 'same-name'))).byteLength).toBe(999)
})
