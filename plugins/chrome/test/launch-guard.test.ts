import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { assertOwnProfileDir, defaultChromeDirs } from '../src/shared/browser/launchGuard.js'
it('keeps the own-profile launch fence, without starting a browser', () => {
  expect(() => assertOwnProfileDir({ profileDir: '' })).toThrow()
  expect(() =>
    assertOwnProfileDir({ profileDir: '/fictional/default' }, ['/fictional/default']),
  ).toThrow()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-launch-'))
  try {
    expect(() =>
      assertOwnProfileDir({ profileDir: path.join(home, 'fern') }, ['/fictional/default']),
    ).not.toThrow()
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

afterEach(() => vi.restoreAllMocks())
it.each(['darwin', 'linux', 'win32'] as const)(
  'protects the OS account Chrome directory despite the plugin HOME (%s)',
  (platform) => {
    const home = '/fictional/account'
    vi.spyOn(os, 'homedir').mockReturnValue('/fictional/plugin-home')
    vi.spyOn(os, 'userInfo').mockReturnValue({
      uid: 1000,
      gid: 1000,
      username: 'fictional',
      shell: '/bin/fictional',
      homedir: home,
    })
    const dirs = defaultChromeDirs(undefined, platform, {
      HOME: '/fictional/plugin-home',
      XDG_CONFIG_HOME: '/fictional/plugin-home/.config',
      LOCALAPPDATA: '/fictional/plugin-home/local',
    })
    const realChrome =
      platform === 'darwin'
        ? path.join(home, 'Library/Application Support/Google/Chrome')
        : platform === 'win32'
          ? path.win32.join(home, 'AppData/Local/Google/Chrome')
          : path.join(home, '.config/google-chrome')
    expect(dirs).toContain(realChrome)
    expect(() => assertOwnProfileDir({ profileDir: realChrome }, dirs)).toThrow(
      "normal Chrome's own profile directory",
    )
    expect(() => assertOwnProfileDir({ profileDir: realChrome + '/Default' }, dirs)).toThrow(
      "normal Chrome's own profile directory",
    )
  },
)
