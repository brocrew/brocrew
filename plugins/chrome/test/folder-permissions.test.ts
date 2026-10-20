import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { FakeDownload, harness } from './fakes.js'
import { createProfileStore } from '../src/profiles/store.js'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { prefsFile } from '../src/prefs.js'
import { dayFolder } from '../src/files.js'

const removals: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const dir of removals.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-folder-'))
  removals.push(dir)
  return dir
}
function fixture() {
  const h = harness()
  removals.push(h.home, path.dirname(h.downloads), h.uploadRoot)
  h.profile('fern', { enabled: true, allowSettings: true, allowExtensions: true })
  return h
}
function held() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const setting = { profile: 'fern', key: 'translate.enabled', value: true }

it.each(['allowSettings', 'enabled'] as const)(
  'refuses a queued write after %s is revoked',
  async (flag) => {
    const h = fixture(),
      gate = held()
    const first = h.browser.exclusive('fern', () => gate.promise)
    const pending = h.call('set_setting', setting)
    h.store.setFlags('fern', { [flag]: false })
    gate.resolve()
    await first
    await expect(pending).rejects.toThrow()
    expect(fs.existsSync(prefsFile(h.store.dirOf('fern')))).toBe(false)
  },
)
it('rechecks a setting permission after the awaited close', async () => {
  const h = fixture(),
    gate = held(),
    entered = held()
  vi.spyOn(h.browser, 'close').mockImplementation(async () => {
    entered.resolve()
    await gate.promise
  })
  const pending = h.call('set_setting', setting)
  await entered.promise
  h.store.setFlags('fern', { allowSettings: false })
  gate.resolve()
  await expect(pending).rejects.toThrow()
  expect(fs.existsSync(prefsFile(h.store.dirOf('fern')))).toBe(false)
})
it.each(['allowExtensions', 'enabled'] as const)(
  'refuses an extension window queued before %s was revoked',
  async (flag) => {
    const h = fixture(),
      gate = held()
    const first = h.browser.exclusive('fern', () => gate.promise)
    const pending = h.call('install_extension', { profile: 'fern', source: 'a'.repeat(32) })
    h.store.setFlags('fern', { [flag]: false })
    gate.resolve()
    await first
    await expect(pending).rejects.toThrow()
    expect(h.browser.launches).toEqual([])
  },
)
it('refuses a queued new tab after the profile is disabled', async () => {
  const h = fixture(),
    gate = held()
  const first = h.browser.exclusive('fern', () => gate.promise)
  const pending = h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
  h.store.setFlags('fern', { enabled: false })
  gate.resolve()
  await first
  await expect(pending).rejects.toThrow()
  expect(h.browser.launches).toEqual([])
})
it('refuses a tab action after waiting in the tab queue', async () => {
  const h = fixture(),
    gate = held(),
    serializer = createKeyedSerializer()
  const opened = await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
  const id = (opened.json as { tabId: string }).tabId
  h.deps.serializer = serializer
  const first = serializer.runExclusive(id, () => gate.promise)
  const pending = h.call('snapshot', { tabId: id })
  h.store.setFlags('fern', { enabled: false })
  gate.resolve()
  await first
  await expect(pending).rejects.toThrow()
})
it('still writes an allowed setting', async () => {
  const h = fixture()
  expect((await h.call('set_setting', setting)).json).toMatchObject({ ok: true })
  expect(JSON.parse(fs.readFileSync(prefsFile(h.store.dirOf('fern')), 'utf8'))).toMatchObject({
    translate: { enabled: true },
  })
})
it.each(['outside', 'internal'] as const)(
  'refuses a linked profile on create and use (%s)',
  (kind) => {
    const root = home(),
      store = createProfileStore({ home: root })
    const target = kind === 'outside' ? home() : path.join(root, 'profiles', 'willow')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'sentinel'), 'kept')
    const link = path.join(root, 'profiles', 'fern')
    fs.symlinkSync(target, link, 'junction')
    expect(() => store.create('fern', 'panel')).toThrow()
    expect(() => store.dirOf('fern')).toThrow()
    expect(store.list()).toEqual([])
    expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('kept')
  },
)
it('refuses a linked profiles ancestor', () => {
  const root = home(),
    target = home()
  fs.symlinkSync(target, path.join(root, 'profiles'), 'junction')
  expect(() => createProfileStore({ home: root })).toThrow()
  expect(fs.readdirSync(target)).toEqual([])
})
it.each(['outside', 'internal'] as const)(
  'refuses a linked profile before the launch seam (%s)',
  async (kind) => {
    const root = home(),
      profiles = path.join(root, 'profiles')
    fs.mkdirSync(profiles)
    const target = kind === 'outside' ? home() : path.join(profiles, 'willow')
    fs.mkdirSync(target, { recursive: true })
    fs.symlinkSync(target, path.join(profiles, 'fern'), 'junction')
    const launch = vi.fn(async () => {
      throw new Error('fake launch reached')
    })
    const browser = new ChromeBrowser({
      dirOf: (name) => path.join(profiles, name),
      downloadsRoot: path.join(root, 'downloads'),
      lockHeld: async () => false,
      launchContext: launch,
    })
    await expect(browser.ensure('fern', 'visible')).rejects.toThrow()
    expect(launch).not.toHaveBeenCalled()
    await browser.closeAll()
  },
)
it.each(['outside', 'internal'] as const)(
  'refuses a linked download day folder without saving (%s)',
  async (kind) => {
    const h = fixture()
    fs.mkdirSync(h.downloads)
    const target = kind === 'outside' ? home() : path.join(h.downloads, 'kept')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'sentinel'), 'kept')
    fs.symlinkSync(target, path.join(h.downloads, dayFolder(h.deps.now!())), 'junction')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('fictional bytes')),
    )
    const opened = await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
    const pending = h.call('download_url', {
      tabId: (opened.json as { tabId: string }).tabId,
      url: 'https://fictional.invalid/paper.txt',
    })
    await expect(pending).rejects.toThrow()
    expect(fs.readdirSync(target)).toEqual(['sentinel'])
  },
)
it('still saves bytes in a real download day folder', async () => {
  const h = fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('fictional bytes')),
  )
  const opened = await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
  const result = await h.call('download_url', {
    tabId: (opened.json as { tabId: string }).tabId,
    url: 'https://fictional.invalid/paper.txt',
  })
  const saved = result.json as { path: string; bytes: number }
  expect(saved.bytes).toBe(Buffer.byteLength('fictional bytes'))
  expect(fs.readFileSync(saved.path, 'utf8')).toBe('fictional bytes')
  expect(fs.realpathSync(path.dirname(saved.path))).toBe(
    fs.realpathSync(path.join(h.downloads, dayFolder(h.deps.now!()))),
  )
})

it('refuses extension removal queued before its permission was revoked', async () => {
  const h = fixture(),
    gate = held(),
    id = 'a'.repeat(32)
  const dir = path.join(h.store.dirOf('fern'), 'Default', 'Extensions', id, '1.0')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'Fictional', version: '1.0' }),
  )
  const first = h.browser.exclusive('fern', () => gate.promise)
  const pending = h.call('remove_extension', { profile: 'fern', id })
  h.store.setFlags('fern', { allowExtensions: false })
  gate.resolve()
  await first
  await expect(pending).rejects.toThrow()
  expect(h.browser.launches).toEqual([])
})
it.each(['show_tab', 'hide_tab'])(
  'refuses queued %s after the profile is disabled',
  async (tool) => {
    const h = fixture(),
      gate = held()
    const opened = await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
    const first = h.browser.exclusive('fern', () => gate.promise)
    const pending = h.call(tool, { tabId: (opened.json as { tabId: string }).tabId })
    h.store.setFlags('fern', { enabled: false })
    gate.resolve()
    await first
    await expect(pending).rejects.toThrow()
    expect(h.browser.launches).toHaveLength(1)
  },
)
it('refuses a linked day folder for a browser-stream download too', async () => {
  const h = fixture(),
    target = home()
  fs.mkdirSync(h.downloads)
  const stage = path.join(h.downloads, 'stage-fictional')
  fs.mkdirSync(stage)
  const source = path.join(stage, 'payload')
  fs.writeFileSync(source, 'fictional bytes')
  fs.symlinkSync(target, path.join(h.downloads, dayFolder(h.deps.now!())), 'junction')
  const opened = await h.call('open_tab', {
    profile: 'fern',
    url: 'https://fictional.invalid/',
    visible: true,
  })
  const id = (opened.json as { tabId: string }).tabId
  const tab = h.tabs.resolve(id, (name) => h.browser.state(name)?.generation ?? null)
  const download = new FakeDownload('paper.txt', Buffer.from('fictional bytes'), source)
  tab.pendingDownloads.push({ download: download as never, at: Date.now() })
  await expect(h.call('wait_for_download', { tabId: id })).rejects.toThrow()
  expect(fs.readdirSync(target)).toEqual([])
  expect(download.deleted).toBe(true)
})
it('refuses a linked downloads root before the launch seam', async () => {
  const root = home(),
    target = home()
  fs.mkdirSync(path.join(root, 'profiles', 'fern'), { recursive: true })
  fs.symlinkSync(target, path.join(root, 'downloads'), 'junction')
  const launch = vi.fn(async () => {
    throw new Error('fake launch reached')
  })
  const browser = new ChromeBrowser({
    dirOf: (name) => path.join(root, 'profiles', name),
    downloadsRoot: path.join(root, 'downloads'),
    lockHeld: async () => false,
    launchContext: launch,
  })
  await expect(browser.ensure('fern', 'visible')).rejects.toThrow()
  expect(launch).not.toHaveBeenCalled()
  expect(fs.readdirSync(target)).toEqual([])
  await browser.closeAll()
})
