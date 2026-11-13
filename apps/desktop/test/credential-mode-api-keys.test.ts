import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiKeys, API_KEYS_FILE, whyNotAKey } from '../src/main/runtime/api-keys'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-key-metadata-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

it('leaves the provider to accept or reject a key longer than 512 characters', async () => {
  const key = 'fictional-fern-' + 'x'.repeat(1024)
  expect(whyNotAKey(key)).toBeNull()
  const keys = new ApiKeys(folder, () => 1234)
  expect(await keys.set('claude', key)).toBeNull()
  expect(await keys.read('claude')).toBe(key)
})

it.each([undefined, null, 'a previous day'])(
  'timestamp metadata %s does not veto usable key bytes',
  async (setAt) => {
    const key = 'fictional-fern-key'
    writeFileSync(
      join(folder, API_KEYS_FILE),
      JSON.stringify({ version: 1, keys: { claude: { key, setAt } } }),
    )
    const keys = new ApiKeys(folder, () => 1234)
    expect(await keys.read('claude')).toBe(key)
    expect(keys.status('claude')).toMatchObject({ set: true, inUse: true, setAt: null })
    expect((await keys.current('claude'))?.key).toBe(key)
  },
)

it('ignores a stale sealed row when there is no current key without opening or deleting it', async () => {
  const forgetSealedApiKey = vi.fn()
  const keys = new ApiKeys(folder, () => 1234, { hasSealedApiKey: () => true, forgetSealedApiKey })
  expect(await keys.read('claude')).toBeNull()
  expect(keys.status('claude')).toMatchObject({ set: false, inUse: false, setAt: null })
  expect(forgetSealedApiKey).not.toHaveBeenCalled()
})
