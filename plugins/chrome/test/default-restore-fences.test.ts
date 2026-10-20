import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { listExtensions } from '../src/extensions.js'
import { restoreVisibleSession } from '../src/restoreSession.js'
import { silentLogger } from '../src/logger.js'
import { harness } from './fakes.js'

const cleanup: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-default-'))
  cleanup.push(dir)
  return dir
}
const id = 'a'.repeat(32)
function extension(defaultDir: string) {
  const dir = path.join(defaultDir, 'Extensions', id, '1.0')
  fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true })
  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({ extensions: { settings: { [id]: { state: 1 } } } }),
  )
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: '__MSG_title__', version: '1.0', default_locale: 'en' }),
  )
  fs.writeFileSync(
    path.join(dir, '_locales', 'en', 'messages.json'),
    JSON.stringify({ title: { message: 'Fictional extension' } }),
  )
  return dir
}
it.each(['outside', 'internal'] as const)(
  'refuses extension reads through linked Default (%s)',
  (kind) => {
    const root = home(),
      profile = path.join(root, 'fern')
    fs.mkdirSync(profile)
    const target = kind === 'outside' ? home() : path.join(root, 'willow', 'Default')
    extension(target)
    fs.symlinkSync(target, path.join(profile, 'Default'), 'junction')
    expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
  },
)
it('refuses extension reads through a linked Extensions folder', () => {
  const root = home(),
    profile = path.join(root, 'fern'),
    target = home()
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true })
  extension(target)
  fs.symlinkSync(
    path.join(target, 'Extensions'),
    path.join(profile, 'Default', 'Extensions'),
    'junction',
  )
  expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
})
it('refuses a linked extension locale folder', () => {
  const profile = home(),
    target = home()
  const dir = extension(path.join(profile, 'Default'))
  fs.rmSync(path.join(dir, '_locales'), { recursive: true })
  fs.mkdirSync(path.join(target, 'en'))
  fs.writeFileSync(
    path.join(target, 'en', 'messages.json'),
    JSON.stringify({ title: { message: 'Other extension' } }),
  )
  fs.symlinkSync(target, path.join(dir, '_locales'), 'junction')
  expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
})
it('still reads an ordinary extension and its localized name', () => {
  const profile = home()
  extension(path.join(profile, 'Default'))
  expect(listExtensions(profile)).toEqual([
    { id, name: 'Fictional extension', version: '1.0', enabled: true, unpacked: false },
  ])
})
function held() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function restoreFixture() {
  const h = harness()
  cleanup.push(h.home, path.dirname(h.downloads), h.uploadRoot)
  h.profile('fern', { enabled: true })
  const now = () => new Date('2026-10-18T01:00:00Z')
  const file = path.join(h.home, 'restore.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      savedAt: now().toISOString(),
      profiles: [
        {
          name: 'fern',
          urls: ['https://fictional.invalid/first', 'https://fictional.invalid/second'],
        },
      ],
    }),
  )
  return {
    h,
    deps: { file, store: h.store, browser: h.browser, tabs: h.tabs, logger: silentLogger, now },
  }
}
it.each(['disabled', 'gone'] as const)(
  'does not launch a restore queued before the profile became %s',
  async (change) => {
    const { h, deps } = restoreFixture(),
      gate = held()
    const first = h.browser.exclusive('fern', () => gate.promise)
    const pending = restoreVisibleSession(deps)
    if (change === 'disabled') h.store.setFlags('fern', { enabled: false })
    else h.store.remove('fern')
    gate.resolve()
    await first
    expect(await pending).toEqual([])
    expect(h.browser.launches).toEqual([])
    expect(h.tabs.list(() => null)).toEqual([])
  },
)
it('does not navigate restored tabs when disabled during preparation', async () => {
  const { h, deps } = restoreFixture(),
    gate = held(),
    entered = held()
  const ensure = h.browser.ensure.bind(h.browser)
  vi.spyOn(h.browser, 'ensure').mockImplementation(async (name, mode) => {
    const result = await ensure(name, mode)
    entered.resolve()
    await gate.promise
    return result
  })
  const newPage = vi.spyOn(h.browser, 'newPage')
  const pending = restoreVisibleSession(deps)
  await entered.promise
  h.store.setFlags('fern', { enabled: false })
  gate.resolve()
  expect(await pending).toEqual([])
  expect(newPage).not.toHaveBeenCalled()
})
it('still restores enabled profiles and their tabs', async () => {
  const { h, deps } = restoreFixture()
  expect(await restoreVisibleSession(deps)).toEqual(['fern'])
  expect(h.browser.launches).toEqual([{ profile: 'fern', mode: 'visible' }])
  expect(
    h.tabs.list((name) => h.browser.state(name)?.generation ?? null).map((tab) => tab.page.url()),
  ).toEqual(['https://fictional.invalid/first', 'https://fictional.invalid/second'])
  h.browser.endWindow('fern')
})
