import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ read: undefined as (() => void) | undefined }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const value = await actual.readFile(...args)
      io.read?.()
      return value
    },
  }
})
import { stopLegacySupervisor } from '../src/main/plugins/supervisor/legacy-owner'

let root = ''
afterEach(async () => {
  vi.restoreAllMocks()
  io.read = undefined
  if (root) await rm(root, { recursive: true, force: true })
})
it('a delayed upgrader leaves an already-published successor running', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fictional-upgraders-')))
  const folder = join(root, 'supervisor-launches', 'old')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'service.json'),
    JSON.stringify({ format: 1, ready: true, pid: 12345 }),
  )
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  let epoch = 'legacy'
  io.read = () => {
    epoch = 'successor'
  }
  await stopLegacySupervisor(root, () => epoch === 'legacy')
  expect(kill).not.toHaveBeenCalled()
})
