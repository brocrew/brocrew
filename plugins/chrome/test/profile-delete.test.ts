import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { ProfileInUseError } from '../src/browser/profileBrowser.js'
import { createProfileStore } from '../src/profiles/store.js'
import { createProfileOpener } from '../src/openWindow.js'
import { TabRegistry } from '../src/tabs.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser } from './fakes.js'

const cleanup: Array<() => void> = []
type IdleRemoval = { removeWhenIdle(profile: string, remove: () => void): Promise<void> }
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})
it('a partial disk removal keeps the name reserved, so a new profile cannot inherit remaining sign-ins', async () => {
  const { store, browser, dir } = setup()
  const remove = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
    fs.unlinkSync(join(dir, 'Default', 'Cookies'))
    throw Object.assign(new Error('fictional file is busy'), { code: 'EBUSY' })
  })
  expect(() => store.remove('fern')).toThrow('fictional file is busy')
  expect(store.get('fern')).toBeDefined()
  expect(fs.existsSync(join(dir, 'Default', 'Login Data'))).toBe(true)
  expect(() => store.create('fern', 'panel')).toThrow('already exists')
  remove.mockRestore()
  await browser.removeWhenIdle('fern', () => store.remove('fern'))
  expect(store.get('fern')).toBeUndefined()
  expect(fs.existsSync(dir)).toBe(false)
})
function setup(lockHeld: (dir: string) => Promise<boolean> = async () => false) {
  const home = fs.mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-delete-'),
  )
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const store = createProfileStore({ home })
  store.create('fern', 'panel')
  store.create('birch', 'panel')
  const dir = store.dirOf('fern')
  fs.mkdirSync(join(dir, 'Default'), { recursive: true })
  for (const name of ['Cookies', 'History', 'Login Data'])
    fs.writeFileSync(join(dir, 'Default', name), 'fictional')
  const launch = vi.fn(async () => {
    throw new Error('No browser is launched')
  })
  const options = {
    dirOf: store.dirOf,
    profileExists: (name: string) => store.get(name) !== undefined,
    lockHeld,
    launchContext: launch,
  }
  const browser = new ChromeBrowser(options) as ChromeBrowser & IdleRemoval
  return { store, browser, dir, launch }
}
it('removes the selected closed profile and its browsing data from disk, preserving another profile', async () => {
  const { store, browser, dir, launch } = setup()
  await browser.removeWhenIdle('fern', () => store.remove('fern'))
  expect(store.get('fern')).toBeUndefined()
  expect(fs.existsSync(dir)).toBe(false)
  expect(store.get('birch')?.name).toBe('birch')
  expect(fs.existsSync(store.dirOf('birch'))).toBe(true)
  await expect(browser.ensure('fern', 'headless')).rejects.toThrow('profile does not exist')
  expect(fs.existsSync(dir)).toBe(false)
  expect(launch).not.toHaveBeenCalled()
})
it('refuses deletion while a tool operation is running even without a browser context', async () => {
  const { store, browser, dir } = setup()
  let end!: () => void
  const work = browser.operate(
    'fern',
    () =>
      new Promise<void>((resolve) => {
        end = resolve
      }),
  )
  await expect(browser.removeWhenIdle('fern', () => store.remove('fern'))).rejects.toBeInstanceOf(
    ProfileInUseError,
  )
  expect(fs.existsSync(join(dir, 'Default', 'Cookies'))).toBe(true)
  end()
  await work
  await browser.removeWhenIdle('fern', () => store.remove('fern'))
  expect(fs.existsSync(dir)).toBe(false)
})
it('blocks new operations and launches during the removal lock check', async () => {
  let checked!: () => void
  const entering = new Promise<void>((resolve) => {
    checked = resolve
  })
  let unlock!: (busy: boolean) => void
  const { store, browser, launch } = setup(async () => {
    checked()
    return new Promise<boolean>((resolve) => {
      unlock = resolve
    })
  })
  const deletion = browser.removeWhenIdle('fern', () => store.remove('fern'))
  await entering
  const work = vi.fn(async () => undefined)
  await expect(browser.operate('fern', work)).rejects.toBeInstanceOf(ProfileInUseError)
  await expect(browser.ensure('fern', 'headless')).rejects.toBeInstanceOf(ProfileInUseError)
  expect(work).not.toHaveBeenCalled()
  expect(launch).not.toHaveBeenCalled()
  unlock(false)
  await deletion
  expect(store.get('fern')).toBeUndefined()
})
it('refuses a profile held by another browser without removing any data', async () => {
  const { store, browser, dir } = setup(async () => true)
  await expect(browser.removeWhenIdle('fern', () => store.remove('fern'))).rejects.toBeInstanceOf(
    ProfileInUseError,
  )
  expect(store.get('fern')).toBeDefined()
  expect(fs.existsSync(join(dir, 'Default', 'Login Data'))).toBe(true)
})
it('refuses deletion during a pending browser start without waiting for or ending that start', async () => {
  let entered!: () => void
  const enteredLock = new Promise<void>((resolve) => {
    entered = resolve
  })
  let unlock!: (busy: boolean) => void
  const { store, browser, dir } = setup(async () => {
    entered()
    return new Promise<boolean>((resolve) => {
      unlock = resolve
    })
  })
  const starting = browser.ensure('fern', 'visible')
  const failedStart = expect(starting).rejects.toThrow('No browser is launched')
  await enteredLock
  try {
    await expect(browser.removeWhenIdle('fern', () => store.remove('fern'))).rejects.toBeInstanceOf(
      ProfileInUseError,
    )
    expect(fs.existsSync(dir)).toBe(true)
  } finally {
    unlock(false)
    await failedStart
  }
})
it('a person Open queued behind a completed delete cannot recreate the removed profile', async () => {
  const { store, dir } = setup()
  const browser = new FakeBrowser(store.dirOf) as FakeBrowser & IdleRemoval
  const options = {
    browser,
    tabs: new TabRegistry(),
    logger: silentLogger,
    profileExists: (name: string) => store.get(name) !== undefined,
  }
  const opener = createProfileOpener(options)
  const deletion = browser.removeWhenIdle('fern', () => store.remove('fern'))
  const opening = expect(opener.open('fern')).rejects.toThrow('profile does not exist')
  await deletion
  await opening
  expect(browser.launches).toEqual([])
  expect(fs.existsSync(dir)).toBe(false)
})
