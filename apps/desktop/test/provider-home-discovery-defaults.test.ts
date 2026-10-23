import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const defaults = vi.hoisted(() => ({ home: vi.fn(() => '/fictional/person') }))
vi.mock('node:os', async (load) => ({
  ...(await load<typeof import('node:os')>()),
  homedir: defaults.home,
}))
import { userProviderHomePath } from '../src/main/adopt/user-homes'
beforeEach(() => defaults.home.mockClear())
describe('a provider home override needs no default home lookup', () => {
  it.each(['claude', 'codex'] as const)(
    'uses the recorded override for %s before asking the operating system',
    (provider) => {
      defaults.home.mockReturnValue('/fictional/person')
      const env = {
        CLAUDE_CONFIG_DIR: '/fictional/override/claude',
        CODEX_HOME: '/fictional/override/codex',
      }
      const before = defaults.home.mock.calls.length
      const found = userProviderHomePath(provider, env)
      const lookups = defaults.home.mock.calls.length - before
      expect(found).toBe(env[provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'])
      expect(lookups).toBe(0)
    },
  )
  it.each(['claude', 'codex'] as const)(
    'asks for the default home once when %s has no override',
    (provider) => {
      defaults.home.mockReturnValue('/fictional/person')
      const before = defaults.home.mock.calls.length
      const found = userProviderHomePath(provider, {})
      const lookups = defaults.home.mock.calls.length - before
      expect(found).toBe(join('/fictional/person', '.' + provider))
      expect(lookups).toBe(1)
    },
  )
})
