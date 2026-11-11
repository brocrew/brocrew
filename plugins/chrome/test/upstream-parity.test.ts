import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { harness } from './fakes.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { assertOwnProfileDir } from '../src/shared/browser/launchGuard.js'
import { launchPersistentChromium } from '../src/shared/browser/browser-launch.js'
const fake = vi.hoisted(() => ({ launch: vi.fn(async () => ({})) }))
vi.mock('playwright-core', () => ({ chromium: { launchPersistentContext: fake.launch } }))
const homes: string[] = []
const fixtures: ReturnType<typeof harness>[] = []
function setup() {
  const h = harness()
  fixtures.push(h)
  homes.push(h.home, path.dirname(h.downloads), h.uploadRoot)
  h.profile('fern', { enabled: true })
  return h
}
afterEach(async () => {
  for (const h of fixtures.splice(0))
    for (const profile of [...h.browser.states.keys()]) await h.browser.close(profile)
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
  vi.clearAllMocks()
})
it('names absolute files and download folders under the private plugin HOME', () => {
  const h = setup()
  const pluginHome = path.join(h.home, 'fictional-plugin-home')
  const filesRoot = path.join(pluginHome, 'files')
  const downloadsRoot = path.join(pluginHome, 'downloads')
  const home = vi.spyOn(os, 'homedir').mockReturnValue(pluginHome)
  try {
    const tools = createAgentChromeTools({
      ...h.deps,
      guard: () => ({ ...h.deps.guard(), roots: [filesRoot] }),
      downloadsRoot,
    })
    const upload = tools.find((t) => t.definition.name === 'upload_file')!.definition.description
    const download = tools.find((t) => t.definition.name === 'download')!.definition.description
    expect(upload).toContain(filesRoot)
    expect(upload).not.toContain('~/files')
    expect(download).toContain(downloadsRoot)
    expect(download).not.toContain('~/downloads')
  } finally {
    home.mockRestore()
  }
})
it('gives only the Chrome child the OS account HOME while retaining its owned profile', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-keychain-home-')))
  homes.push(root)
  const profileDir = path.join(root, 'fern')
  const serverHome = process.env.HOME
  const accountHome = process.platform === 'win32' ? 'C:\\Users\\Fictional' : '/fictional/account'
  const account = vi.spyOn(os, 'userInfo').mockReturnValue({
    uid: 1000,
    gid: 1000,
    username: 'fictional',
    shell: '/bin/fictional',
    homedir: accountHome,
  })
  try {
    await launchPersistentChromium({
      profileDir,
      channel: 'chrome',
      headless: true,
      ignoreAllDefaultArgs: true,
      args: [`--user-data-dir=${profileDir}`, '--remote-debugging-pipe'],
    })
    expect(fake.launch).toHaveBeenCalledWith(
      profileDir,
      expect.objectContaining({
        env: {
          ...process.env,
          HOME: accountHome,
          ...(process.platform === 'win32'
            ? {
                USERPROFILE: accountHome,
                APPDATA: path.win32.join(accountHome, 'AppData', 'Roaming'),
                LOCALAPPDATA: path.win32.join(accountHome, 'AppData', 'Local'),
              }
            : {}),
        },
        args: [`--user-data-dir=${profileDir}`, '--remote-debugging-pipe'],
      }),
    )
    expect(process.env.HOME).toBe(serverHome)
  } finally {
    account.mockRestore()
  }
})
it('passes only explicitly owned all-default arguments to the fake Playwright driver', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-all-args-')))
  homes.push(root)
  const profileDir = path.join(root, 'fern')
  const own = `--user-data-dir=${profileDir}`
  await launchPersistentChromium({
    profileDir,
    headless: false,
    ignoreAllDefaultArgs: true,
    args: [own, '--remote-debugging-pipe'],
  })
  expect(fake.launch).toHaveBeenCalledWith(
    profileDir,
    expect.objectContaining({ ignoreDefaultArgs: true, args: [own, '--remote-debugging-pipe'] }),
  )
  for (const args of [
    [],
    [own, own],
    ['--user-data-dir=/fictional/foreign'],
    [own, '--user-data-dir'],
    [`${own}-other`],
  ]) {
    expect(() => assertOwnProfileDir({ profileDir, ignoreAllDefaultArgs: true, args })).toThrow(
      'Plugin unavailable. Try again.',
    )
  }
  expect(() => assertOwnProfileDir({ profileDir, args: [own] })).toThrow()
  expect(() =>
    assertOwnProfileDir({
      profileDir,
      ignoreAllDefaultArgs: true,
      ignoreDefaultArgs: true,
      args: [own],
    }),
  ).toThrow()
  expect(fake.launch).toHaveBeenCalledOnce()
})
it('back and forward wait for a commit while URL navigation and reload retain their load wait', async () => {
  const h = setup()
  const opened = (
    await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/first' })
  ).json as { tabId: string }
  const page = h.browser.pages.get('fern')![0]
  const nav = Object.assign(page, {
    goBack: vi.fn(async () => null),
    goForward: vi.fn(async () => null),
    reload: vi.fn(async () => null),
  })
  const goto = vi.spyOn(page, 'goto')
  for (const action of ['back', 'forward', 'reload'])
    await h.call('navigate', { tabId: opened.tabId, action })
  await h.call('navigate', { tabId: opened.tabId, url: 'https://fictional.invalid/next' })
  expect(nav.goBack).toHaveBeenCalledWith(expect.objectContaining({ waitUntil: 'commit' }))
  expect(nav.goForward).toHaveBeenCalledWith(expect.objectContaining({ waitUntil: 'commit' }))
  expect(nav.reload).toHaveBeenCalledWith(
    expect.objectContaining({ waitUntil: 'domcontentloaded' }),
  )
  expect(goto).toHaveBeenCalledWith(
    'https://fictional.invalid/next',
    expect.objectContaining({ waitUntil: 'domcontentloaded' }),
  )
})
it('generic show and hide return immediately and tools still work while the person has a visible window', async () => {
  const h = setup()
  const names = createAgentChromeTools(h.deps).map((tool) => tool.definition.name)
  expect(names).toContain('show_tab')
  expect(names).toContain('hide_tab')
  expect(names.filter((name) => name.startsWith('ask_'))).toEqual([])
  const opened = (
    await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/first' })
  ).json as { tabId: string }
  await h.call('show_tab', { tabId: opened.tabId })
  expect(h.browser.state('fern')?.mode).toBe('visible')
  await h.call('navigate', { tabId: opened.tabId, url: 'https://fictional.invalid/shared' })
  expect(h.browser.pages.get('fern')![0].url()).toBe('https://fictional.invalid/shared')
  await h.call('hide_tab', { tabId: opened.tabId })
  expect(h.browser.state('fern')?.mode).toBe('headless')
})
