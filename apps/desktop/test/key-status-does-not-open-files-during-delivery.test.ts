import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { API_KEYS_FILE, ApiKeys } from '../src/main/runtime/api-keys'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) }
})
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile) }
})

let folder: string
beforeEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(readFile).mockReset().mockImplementation(fs.readFile)
  vi.mocked(readFileSync).mockClear()
  folder = await mkdtemp(join(tmpdir(), 'brocrew-key-status-'))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

function held<T>() {
  let release!: (value: T) => void
  return {
    promise: new Promise<T>((resolve) => {
      release = resolve
    }),
    release: (value: T) => release(value),
  }
}

// The same counter can exercise the earlier snapshot's constructor as the control.
const openKeys = async () =>
  typeof ApiKeys.open === 'function'
    ? ApiKeys.open(folder)
    : (Reflect.construct(ApiKeys, [folder]) as ApiKeys)

it('status delivery never opens the key file', async () => {
  const keys = await openKeys()
  vi.mocked(readFile).mockClear()
  vi.mocked(readFileSync).mockClear()
  for (let count = 0; count < 200; count++) {
    expect(keys.status('claude').set).toBe(false)
    expect(keys.status('codex').set).toBe(false)
  }
  expect(readFileSync).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
})

it('a fresh credential read yields while the filesystem is delayed', async () => {
  const keys = await ApiKeys.open(folder)
  const blocked = held<string>()
  vi.mocked(readFile).mockImplementationOnce(() => blocked.promise)
  let finished = false
  const reading = keys.current('codex').finally(() => {
    finished = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(finished).toBe(false)
  expect(keys.status('codex').set).toBe(false)
  blocked.release('{"version":1,"keys":{}}')
  expect(await reading).toBeNull()
})

it('an older read cannot replace the projection after a durable mutation', async () => {
  const keys = await ApiKeys.open(folder)
  const blocked = held<string>()
  vi.mocked(readFile).mockImplementationOnce(() => blocked.promise)
  const reading = keys.refreshStatus('codex')
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))
  expect(await keys.set('codex', 'fictional-fern-key')).toBeNull()
  const stamp = keys.status('codex').setAt
  blocked.release('{"version":1,"keys":{}}')
  await reading
  expect(keys.status('codex')).toMatchObject({ set: true, setAt: stamp })
})

it('an older refresh cannot replace a later fresh observation', async () => {
  const keys = await ApiKeys.open(folder)
  const blocked = held<string>()
  vi.mocked(readFile).mockImplementationOnce(() => blocked.promise)
  const first = keys.refreshStatus('codex')
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))
  await writeFile(
    join(folder, API_KEYS_FILE),
    JSON.stringify({
      version: 1,
      keys: { codex: { key: 'fictional-maple-key', setAt: 30 } },
    }),
  )
  expect(await keys.refreshStatus('codex')).toMatchObject({ set: true, setAt: 30 })
  blocked.release('{"version":1,"keys":{}}')
  await first
  expect(keys.status('codex')).toMatchObject({ set: true, setAt: 30 })
})

it('a fresh result is returned even when a later refresh is still pending', async () => {
  const keys = await ApiKeys.open(folder)
  const first = held<string>()
  const second = held<string>()
  vi.mocked(readFile)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  const earlier = keys.refreshStatus('codex')
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2))
  const later = keys.refreshStatus('codex')
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(3))
  first.release(JSON.stringify({ keys: { codex: { key: 'fictional-fern-key', setAt: 20 } } }))
  expect(await earlier).toMatchObject({ set: true, setAt: 20 })
  second.release('{"keys":{}}')
  expect(await later).toMatchObject({ set: false })
})

it('event metadata never rereads a legacy key row', async () => {
  const hasSealedApiKey = vi.fn(() => true)
  const forgetSealedApiKey = vi.fn()
  const keys = await ApiKeys.open(folder, () => 5, { hasSealedApiKey, forgetSealedApiKey })
  hasSealedApiKey.mockClear()
  for (let count = 0; count < 100; count++)
    expect(keys.status('codex')).toMatchObject({ readState: 'unreadable' })
  expect(hasSealedApiKey).not.toHaveBeenCalled()
})
