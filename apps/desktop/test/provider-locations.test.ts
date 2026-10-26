import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { recordProviderLocation, resolveProviderLocation } from '../src/main/providers/locations'
import { prepareProviderHome } from '../src/main/runtime/provider-homes'
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-location-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})
it.each(['brobot', 'default', 'fern', 'Fern', 'field-2', 'A.b_C'])(
  'retains exact folder spelling for %s and relocates only the managed root',
  (profile) => {
    for (const provider of ['claude', 'codex'] as const) {
      const root = join(dir, 'provider-homes')
      const original = join(root, 'default', profile, provider)
      const address = recordProviderLocation(root, original, provider)
      expect(address).toBe(`default/${profile}/${provider}`)
      expect(resolveProviderLocation(root, address, provider)).toBe(original)
      expect(resolveProviderLocation(join(dir, 'moved'), address, provider)).toBe(
        join(dir, 'moved', 'default', profile, provider),
      )
    }
    expect(existsSync(join(dir, 'provider-homes'))).toBe(false)
  },
)
it.each([
  '',
  '/default/fern/codex',
  '../fern/codex',
  'default//codex',
  'default/../codex',
  'default/fern/claude',
  'default/fern/codex/',
  'default/fern/codex/extra',
  'default\\fern\\codex',
  'other/fern/codex',
  'default/has space/codex',
])('refuses malformed recorded address %j', (location) => {
  expect(() => resolveProviderLocation(join(dir, 'homes'), location, 'codex')).toThrow(
    'Invalid recorded provider location',
  )
})
it('refuses a linked profile segment escaping the managed root, including before preparation', async () => {
  const root = join(dir, 'provider-homes')
  const outside = join(dir, 'outside')
  mkdirSync(join(root, 'default'), { recursive: true })
  mkdirSync(outside)
  symlinkSync(
    outside,
    join(root, 'default', 'fern'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  expect(() => resolveProviderLocation(root, 'default/fern/codex', 'codex')).toThrow(
    /symlink|outside its managed root/,
  )
  let credentials = 0
  await expect(
    prepareProviderHome(
      dir,
      { provider: 'codex', profileId: 'fern' },
      {
        provisionHome: () => {
          throw new Error('must not provision')
        },
        provisionCodexAuth: () => {
          credentials++
        },
      },
      'default/fern/codex',
    ),
  ).rejects.toThrow(/symlink|outside its managed root/)
  expect(credentials).toBe(0)
})
it('does not serialize absolute paths or paths outside the managed root', () => {
  expect(() => recordProviderLocation(join(dir, 'root'), join(dir, 'outside'), 'claude')).toThrow()
})

it('refuses an inside-root symlink too, retaining the provisioning ancestry rule', () => {
  const root = join(dir, 'provider-homes')
  const target = join(root, 'default', 'birch')
  mkdirSync(target, { recursive: true })
  symlinkSync(
    target,
    join(root, 'default', 'fern'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  expect(() => resolveProviderLocation(root, 'default/fern/claude', 'claude')).toThrow('symlink')
})
