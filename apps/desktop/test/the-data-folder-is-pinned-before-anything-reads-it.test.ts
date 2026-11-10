import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_ID,
  nameTheAppToWindows,
  pinTheDataFolder,
  type PinnableApp,
} from '../src/main/data-folder'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot-pin-order-'))
  roots.push(root)
  return root
}

function anApp(appData: string, switches: readonly string[] = []) {
  const asked: string[] = []
  const switchesAsked: string[] = []
  const set: { name: string; path: string; existed: boolean }[] = []
  const app: PinnableApp = {
    getPath: (name) => {
      asked.push(name)
      return name === 'appData' ? appData : join(appData, 'not-appData', String(name))
    },
    setPath: (name, path) => {
      set.push({ name, path, existed: existsSync(path) })
    },
    commandLine: {
      hasSwitch: (name) => {
        switchesAsked.push(name)
        return switches.includes(name)
      },
    },
  }
  return { app, asked, switchesAsked, set }
}

describe('the pin’s own order', () => {
  it('the folder is made BEFORE Electron is told it — `setPath` throws on a folder that is not there', () => {
    const appData = scratch()
    const folder = join(appData, '@brobot2', 'desktop')
    const { app, set } = anApp(appData)
    expect(existsSync(folder), 'a first launch on a new machine has no folder yet').toBe(false)
    pinTheDataFolder(app)
    expect(set).toEqual([{ name: 'userData', path: folder, existed: true }])
  })

  it('a folder that cannot be made does not stop the launch — the pin still names it, and the database says what went wrong', () => {
    const appData = join(scratch(), 'appData-is-a-file')
    writeFileSync(appData, '')
    const folder = join(appData, '@brobot2', 'desktop')
    const { app, set } = anApp(appData)
    expect(() => pinTheDataFolder(app)).not.toThrow()
    expect(set).toEqual([{ name: 'userData', path: folder, existed: false }])

    const fine = anApp(scratch())
    pinTheDataFolder(fine.app)
    expect(fine.set.map((one) => one.existed)).toEqual([true])
  })

  it('a launch with its own --user-data-dir makes nothing in appData and asks nothing of it', () => {
    const appData = scratch()
    const own = anApp(appData, ['user-data-dir'])
    pinTheDataFolder(own.app)
    expect(own.set).toEqual([])
    expect(own.asked, 'a launch with its own folder has no use for appData').toEqual([])
    expect(readdirSync(appData), 'nothing made in the folder every build shares').toEqual([])

    const shared = anApp(appData)
    pinTheDataFolder(shared.app)
    expect(readdirSync(appData)).toEqual(['@brobot2'])
  })

  it('the folder is under appData — not home, not whatever userData already says — and a hidden launch is pinned all the same', () => {
    const appData = scratch()
    const { app, asked, switchesAsked, set } = anApp(appData, ['brobot-hidden'])
    pinTheDataFolder(app)
    expect(asked).toEqual(['appData'])
    expect(switchesAsked).toEqual(['user-data-dir'])
    expect(set.map((one) => one.path)).toEqual([join(appData, '@brobot2', 'desktop')])
    expect(relative(appData, set[0]?.path ?? '')).toBe(join('@brobot2', 'desktop'))
  })
})

describe('nameTheAppToWindows', () => {
  it('with no platform named — the call index.ts makes — it asks the process it runs in', () => {
    const realPlatform = process.platform
    const named: string[] = []
    const app = { setAppUserModelId: (id: string) => named.push(id) }
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      nameTheAppToWindows(app)
      expect(named).toEqual([APP_ID])

      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      nameTheAppToWindows(app)
      expect(named).toEqual([APP_ID])
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    }
  })

  it('only Windows: no other system is given the id', () => {
    const named: string[] = []
    const app = { setAppUserModelId: (id: string) => named.push(id) }
    for (const platform of ['linux', 'darwin', 'freebsd'] as const)
      nameTheAppToWindows(app, platform)
    expect(named).toEqual([])
    nameTheAppToWindows(app, 'win32')
    expect(named).toEqual(['com.brobot2.desktop'])
  })
})
