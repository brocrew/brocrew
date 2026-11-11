import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { browserEnvironment } from '../src/shared/browser/browser-environment.js'
import { chromeExecutable } from '../src/shared/browser/chrome-executable.js'
import { browserChoice, launchTarget } from '../src/shared/browser/launchConfig.js'

const account = 'C:\\Users\\Fern'
const privateHome = 'C:\\Plugin\\private'
const local = path.win32.join(account, 'AppData', 'Local')
const env = {
  SystemDrive: 'C:',
  HOME: privateHome,
  USERPROFILE: privateHome,
  APPDATA: path.win32.join(privateHome, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.win32.join(privateHome, 'AppData', 'Local'),
}
const executable = (root: string) =>
  path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
function disk(files: string[]) {
  return vi.spyOn(fs, 'statSync').mockImplementation((name) => {
    if (!files.includes(String(name))) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { isFile: () => true } as fs.Stats
  })
}
function user() {
  return vi.spyOn(os, 'userInfo').mockReturnValue({
    uid: 1000,
    gid: 1000,
    username: 'Fern',
    shell: '',
    homedir: account,
  })
}
afterEach(() => vi.restoreAllMocks())

it.each(['C:\\Program Files', 'C:\\Program Files (x86)', local])(
  'discovers Chrome in %s despite a private plugin HOME',
  (root) => {
    user()
    const stat = disk([executable(root)])
    expect(chromeExecutable(env, 'win32')).toBe(executable(root))
    expect(stat.mock.calls.map(([name]) => String(name))).not.toContain(
      executable(env.LOCALAPPDATA),
    )
    expect(launchTarget(browserChoice('chrome', chromeExecutable(env, 'win32')))).toEqual({
      executablePath: executable(root),
    })
  },
)
it('honors declared Program Files roots before the account-local installation', () => {
  user()
  const files = [executable('D:\\Programs64'), executable('E:\\Programs32'), executable(local)]
  const stat = disk(files)
  expect(
    chromeExecutable(
      {
        ...env,
        ProgramW6432: 'D:\\Programs64',
        ProgramFiles: 'D:\\Ignored',
        'ProgramFiles(x86)': 'E:\\Programs32',
      },
      'win32',
    ),
  ).toBe(files[0])
  expect(stat).toHaveBeenCalledTimes(1)
})
it('uses ProgramFiles when ProgramW6432 is absent and the system drive when both are absent', () => {
  user()
  disk([executable('D:\\Programs'), executable('E:\\Program Files')])
  expect(chromeExecutable({ ...env, ProgramFiles: 'D:\\Programs' }, 'win32')).toBe(
    executable('D:\\Programs'),
  )
  expect(chromeExecutable({ ...env, SystemDrive: 'E:' }, 'win32')).toBe(
    executable('E:\\Program Files'),
  )
})
it('keeps an injected executable authoritative without probing another installation', () => {
  const stat = disk([])
  const info = user()
  expect(
    chromeExecutable({ ...env, BROCREW_CHROME_EXECUTABLE: 'Z:\\Chosen\\chrome.exe' }, 'win32'),
  ).toBe('Z:\\Chosen\\chrome.exe')
  expect(stat).not.toHaveBeenCalled()
  expect(info).not.toHaveBeenCalled()
})
it('skips directories and leaves the existing Chrome channel fallback when nothing is installed', () => {
  user()
  vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false } as fs.Stats)
  expect(chromeExecutable(env, 'win32')).toBeUndefined()
  expect(launchTarget(browserChoice('chrome', chromeExecutable(env, 'win32')))).toEqual({
    channel: 'chrome',
  })
})
it.each(['darwin', 'linux'] as const)('keeps the existing channel choice on %s', (platform) => {
  const stat = disk([])
  expect(chromeExecutable(env, platform)).toBeUndefined()
  expect(stat).not.toHaveBeenCalled()
})
it('gives only the browser a copy of the real Windows account roots', () => {
  user()
  const before = { ...env }
  expect(browserEnvironment(env, 'win32')).toEqual({
    ...env,
    HOME: account,
    USERPROFILE: account,
    APPDATA: path.win32.join(account, 'AppData', 'Roaming'),
    LOCALAPPDATA: local,
  })
  expect(env).toEqual(before)
})
it('preserves the existing non-Windows browser HOME behavior', () => {
  user()
  expect(browserEnvironment(env, 'darwin')).toEqual({ ...env, HOME: account })
})
