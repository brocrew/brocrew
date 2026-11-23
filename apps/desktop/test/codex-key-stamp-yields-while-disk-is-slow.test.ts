import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CodexKeyOutcome } from '@brobot2/runtime/codex'
import { bringTheCodexKeyTo, codexAuth } from '../src/main/providers/codex'
import type { CodexKeySeam } from '../src/main/providers/codex/types'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    existsSync: vi.fn(fs.existsSync),
    readFileSync: vi.fn(fs.readFileSync),
    rmSync: vi.fn(fs.rmSync),
    writeFileSync: vi.fn(fs.writeFileSync),
  }
})
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile), stat: vi.fn(fs.stat) }
})
vi.mock('@brobot2/runtime/codex', async (original) => ({
  ...(await original<typeof import('@brobot2/runtime/codex')>()),
  provisionCodexAuth: vi.fn(),
}))

let root: string
beforeEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(readFile).mockReset().mockImplementation(fs.readFile)
  vi.mocked(stat).mockReset().mockImplementation(fs.stat)
  vi.clearAllMocks()
  root = await mkdtemp(join(tmpdir(), 'brocrew-key-stamp-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const stampName = 'brobot-api-key-login.json'
const key: CodexKeySeam = {
  current: () => ({ key: 'fictional-fern-key', setAt: 17 }),
  change: vi.fn(async (): Promise<CodexKeyOutcome> => ({ ok: true, authMethod: 'apikey' })),
}

it('a delayed stamp read yields the loop and does no synchronous filesystem work', async () => {
  await writeFile(join(root, stampName), '{"setAt":17}')
  await writeFile(join(root, 'auth.json'), '{}')
  let release: ((stamp: string) => void) | undefined
  vi.mocked(readFile).mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve
      }),
  )
  let finished = false
  const work = bringTheCodexKeyTo(root, key).finally(() => {
    finished = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const finishedBeforeTheRead = finished
  release?.('{"setAt":17}')
  expect(await work).toBe('the-key')
  expect(finishedBeforeTheRead).toBe(false)
  expect(key.change).not.toHaveBeenCalled()
  expect(readFileSync).not.toHaveBeenCalled()
  expect(existsSync).not.toHaveBeenCalled()
  expect(writeFileSync).not.toHaveBeenCalled()
  expect(rmSync).not.toHaveBeenCalled()
})

it('existing profile homes are visited in order without synchronous presence or stamp reads', async () => {
  for (const profile of ['fern', 'maple']) {
    const home = join(root, profile)
    await mkdir(home)
    await writeFile(join(home, stampName), '{"setAt":17}')
    await writeFile(join(home, 'auth.json'), '{}')
  }
  const auth = codexAuth(
    {
      managedRoot: root,
      defaultProfile: 'fern',
      profiles: () => ['fern', 'missing', 'maple'],
      homeOf: (profile) => join(root, profile),
      assertMayOpen: () => {},
    },
    { command: () => 'not-started', key },
  )
  expect(await auth.bringTheKeyToItsHomes?.()).toBeNull()
  expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([
    join(root, 'fern', stampName),
    join(root, 'maple', stampName),
  ])
  expect(key.change).not.toHaveBeenCalled()
  expect(existsSync).not.toHaveBeenCalled()
  expect(readFileSync).not.toHaveBeenCalled()
})

it('an auth entry whose target cannot be resolved reapplies the key despite a retained stamp', async () => {
  await writeFile(join(root, stampName), '{"setAt":17}')
  await writeFile(join(root, 'auth.json'), '{}')
  // Windows can allow access to a dangling entry while a followed stat still reports ENOENT.
  vi.mocked(stat).mockRejectedValueOnce(
    Object.assign(new Error('fictional missing target'), {
      code: 'ENOENT',
    }),
  )
  expect(await bringTheCodexKeyTo(root, key)).toBe('the-key')
  expect(stat).toHaveBeenCalledWith(join(root, 'auth.json'))
  expect(key.change).toHaveBeenCalledOnce()
})
