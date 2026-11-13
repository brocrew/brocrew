import fs from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { harness, FakeBrowser } from './fakes.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { createChromeBrowser } from '../src/index.js'
import { silentLogger } from '../src/logger.js'

const made: ReturnType<typeof harness>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const h of made.splice(0)) {
    for (const profile of h.deps.store.list()) await h.deps.browser.close(profile.name)
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  }
})
function fixture(facade = false) {
  const h = harness()
  made.push(h)
  h.profile('fern', { enabled: true, allowSettings: true })
  h.profile('birch')
  if (facade) {
    const shared = path.join(h.home, 'shared')
    fs.mkdirSync(shared)
    h.deps.store = createSharedProfileStore({
      home: h.home,
      shared,
      workspaceId: 'fixture',
      workspaceLabel: 'Fictional',
      chromeState: () => 'ended',
    })
    h.deps.browser = new FakeBrowser(h.deps.store.dirOf)
  }
  const store = h.deps.store
  const name = store.list().find((p) => store.dirOf(p.name) === h.store.dirOf('fern'))!.name
  const other = store.list().find((p) => p.name !== name)!.name
  const folder = store.dirOf(name)
  fs.writeFileSync(path.join(folder, 'Cookies'), 'fictional cookies')
  fs.writeFileSync(path.join(folder, 'Login Data'), 'fictional login')
  const launch = vi.fn(async () => {
    throw new Error('unexpected browser launch')
  })
  const browser = createChromeBrowser(store, silentLogger, undefined, {
    downloadsRoot: h.downloads,
    lockHeld: async () => false,
    launchContext: launch,
  })
  const partialRemove = () => {
    const fault = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      fs.unlinkSync(path.join(folder, 'Cookies'))
      throw new Error('fictional busy file')
    })
    try {
      expect(() => store.remove(name)).toThrow('fictional busy file')
    } finally {
      fault.mockRestore()
    }
    expect(store.get(name)).toMatchObject({ enabled: true, deleting: true })
    expect(fs.readFileSync(path.join(folder, 'Login Data'), 'utf8')).toBe('fictional login')
  }
  return { h, store, name, other, folder, browser, launch, partialRemove }
}

it('uses disabled profiles and their supported settings without changing their flags', async () => {
  const { h, store, name } = fixture()
  store.setFlags(name, { enabled: false, allowSettings: false })
  expect((await h.call('get_settings', { profile: name })).json).toHaveProperty('settings')
  const opened = (await h.call('open_tab', { profile: name, url: 'about:blank' })).json
  expect(opened).toHaveProperty('tabId')
  expect(store.get(name)).toMatchObject({ enabled: false, allowSettings: false })
})

it.each([false, true])(
  'blocks partial local deletion and permits cleanup retry (facade %s)',
  async (facade) => {
    const f = fixture(facade)
    const identity = f.store.shared?.identity(f.name)
    f.partialRemove()
    if (f.store.shared) {
      expect(() => f.store.shared!.identity(f.name)).toThrow(/delet/i)
      expect(f.store.shared.admission(f.name).identity).toBe(identity)
    }
    await expect(f.h.call('get_settings', { profile: f.name })).rejects.toThrow()
    await expect(f.browser.ensure(f.name)).rejects.toThrow(/exist|delet/i)
    const action = vi.fn(async () => {})
    await expect(f.browser.operate(f.name, action)).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    const info = vi.fn()
    f.h.deps.logger = { info }
    expect((await f.h.call('delete_browser_profile', { profile: f.name })).json).toEqual({
      deleted: f.name,
    })
    expect(info).toHaveBeenCalledWith('admin action', expect.objectContaining({ temporary: false }))
    expect(f.store.get(f.name)).toBeUndefined()
    expect(fs.existsSync(f.folder)).toBe(false)
    expect(f.store.get(f.other)).toBeDefined()
    await f.browser.closeAll()
  },
)

it.each([false, true])(
  'rechecks deletion after the launch lock await (facade %s)',
  async (facade) => {
    const f = fixture(facade)
    let enter!: () => void, release!: (locked: boolean) => void
    const entered = new Promise<void>((r) => {
      enter = r
    })
    const lock = new Promise<boolean>((r) => {
      release = r
    })
    const browser = createChromeBrowser(f.store, silentLogger, undefined, {
      downloadsRoot: f.h.downloads,
      lockHeld: () => {
        enter()
        return lock
      },
      launchContext: f.launch,
    })
    const opening = browser.ensure(f.name)
    await entered
    f.partialRemove()
    release(false)
    await expect(opening).rejects.toThrow(/exist|delet/i)
    expect(f.launch).not.toHaveBeenCalled()
    await browser.closeAll()
  },
)

it.each([false, true])(
  'does not return work completed after partial deletion (facade %s)',
  async (facade) => {
    const f = fixture(facade)
    await expect(
      f.browser.operate(f.name, async () => {
        f.partialRemove()
        return 'stale result'
      }),
    ).rejects.toThrow()
    await f.browser.closeAll()
  },
)

it('does not reuse a local facade alias for a recreated same-name folder', async () => {
  const f = fixture(true)
  const admitted = f.store.shared!.identity(f.name)
  f.store.remove(f.name)
  f.h.store.create('fern', 'panel')
  expect(f.store.get(f.name)).toBeUndefined()
  expect(() => f.store.shared!.identity(f.name)).toThrow()
  const replacement = f.store.list().find((p) => f.store.dirOf(p.name) === f.folder)!
  expect(replacement.name).not.toBe(f.name)
  expect(f.store.shared!.identity(replacement.name)).not.toBe(admitted)
  await expect(f.browser.ensure(f.name)).rejects.toThrow()
  expect(f.launch).not.toHaveBeenCalled()
  await f.browser.closeAll()
})
