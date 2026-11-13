import { afterEach, expect, it, vi } from 'vitest'
const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: run,
}))
import { birthOf } from '../src/profiles/sharedLock.js'
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})
it.skipIf(process.platform === 'linux')(
  'process birth identity cannot change when reader locales or timezones differ',
  () => {
    const expected = process.platform === 'win32' ? '638980000000000001' : 'canonical-birth'
    run.mockImplementation((_file, _args, options) =>
      process.platform === 'win32' || (options.env?.LC_ALL === 'C' && options.env?.TZ === 'UTC')
        ? expected
        : `localized-${process.env.LANG}-${process.env.TZ}`,
    )
    vi.stubEnv('TZ', 'Pacific/Honolulu')
    vi.stubEnv('LANG', 'fr_FR.UTF-8')
    vi.stubEnv('LC_ALL', 'fr_FR.UTF-8')
    const first = birthOf(process.pid)
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.stubEnv('LANG', 'en_US.UTF-8')
    vi.stubEnv('LC_ALL', 'en_US.UTF-8')
    const second = birthOf(process.pid)
    expect(first).toBe(expected)
    expect(second).toBe(first)
  },
)
