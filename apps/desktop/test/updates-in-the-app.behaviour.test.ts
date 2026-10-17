import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UPDATES_CHANNELS, type UpdatesSnapshot } from '../src/shared/updates'
import { startUpdates } from '../src/main/updates-in-the-app'
import type { Updates } from '../src/main/updates'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  answer: null as null | {
    isUpdateAvailable: boolean
    updateInfo: { version: string; files: { url: string; sha512: string }[] }
  },
  fail: null as Error | null,
  checks: 0,
  sent: [] as UpdatesSnapshot[],
  downloads: [] as string[],
  installer: '',
  installerDownloads: 0,
  quits: 0,
  fetched: 0,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => fake.handlers.set(channel, handler) },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (_channel: string, value: UpdatesSnapshot) => fake.sent.push(value),
        },
      },
    ],
  },
  net: {
    fetch: () => {
      fake.fetched += 1
      throw new Error('No network in this test')
    },
  },
  shell: {
    openPath: () => {
      throw new Error('A hidden launch must not open Finder')
    },
  },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      checkForUpdates: async () => {
        fake.checks += 1
        if (fake.fail !== null) throw fake.fail
        return fake.answer
      },
      downloadUpdate: async () => {
        fake.installerDownloads += 1
        return [fake.installer]
      },
      on: () => undefined,
      off: () => undefined,
    },
  },
}))
vi.mock('../src/main/guided-update', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/guided-update')>()
  return {
    ...original,
    downloadChecked: async ({ to }: { to: string }) => {
      fake.downloads.push(to)
      return to
    },
  }
})

let root: string
let resourceDescriptor: PropertyDescriptor | undefined
let updates: Updates | null = null
const ask = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = fake.handlers.get(channel)
  if (handler === undefined) throw new Error(`No update handler on ${channel}`)
  return handler({ sender: null }, ...args) as T
}

const start = (packaged = true): void => {
  const userData = join(root, 'data')
  const appData = join(root, 'app-data')
  mkdirSync(userData)
  mkdirSync(appData)
  const paths: Record<string, string> = { userData, appData, downloads: join(root, 'downloads') }
  const app = {
    isPackaged: packaged,
    getPath: (name: string) => paths[name],
    getVersion: () => '0.1.0',
    on: () => undefined,
    quit: () => {
      fake.quits += 1
    },
    getAppMetrics: () => [],
  } as unknown as App
  updates = startUpdates({
    app,
    host: { whatARestartWouldStop: () => ({ conversations: [], otherWorkspaces: 0 }) } as never,
    hidden: true,
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-update-wiring-'))
  resourceDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true })
  writeFileSync(
    join(root, 'app-update.yml'),
    'provider: generic\nurl: https://fictional.invalid/releases\n',
  )
  fake.handlers.clear()
  fake.answer = null
  fake.fail = null
  fake.checks = 0
  fake.sent.length = 0
  fake.downloads.length = 0
  fake.installer = join(root, 'fictional-update.AppImage')
  fake.installerDownloads = 0
  fake.quits = 0
  fake.fetched = 0
})

afterEach(() => {
  updates?.stop()
  updates = null
  if (resourceDescriptor === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourceDescriptor)
  fake.handlers.clear()
  rmSync(root, { recursive: true, force: true })
})

it('keeps a development build from checking even when the window asks', async () => {
  start(false)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state).toEqual({
    kind: 'not-here',
    why: 'a-development-build',
  })
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)).state.kind).toBe('not-here')
  expect(fake.checks).toBe(0)
  expect(fake.fetched).toBe(0)
})

it('reports no newer release, and lets the person select the beta channel in its own settings', async () => {
  start()
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).checkAutomatically).toBe(false)
  const none = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)
  expect(none.state).toMatchObject({ kind: 'idle', upToDate: true })
  expect(fake.checks).toBe(1)
  const chosen = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.set, { channel: 'beta' })
  expect(chosen.channel).toBe('beta')
  expect(
    JSON.parse(readFileSync(join(root, 'data', 'update-settings.json'), 'utf8')).updates.channel,
  ).toBe('beta')
  await expect(ask(UPDATES_CHANNELS.set, { channel: 'nightly' })).rejects.toThrow()
  expect(fake.fetched).toBe(0)
})

it('offers a release, refuses an unasked download, then saves a checked image in the hidden data folder', async (ctx) => {
  // A Mac guides a checked disk image into its hidden data folder; Linux installs on restart.
  ctx.skip(process.platform !== 'darwin')
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '0.2.0',
      files: [{ url: 'BroBot-0.2.0-arm64.dmg', sha512: 'fictional' }],
    },
  }
  start()
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)).state.kind).toBe('idle')
  expect(fake.downloads).toHaveLength(0)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)).state).toEqual({
    kind: 'available',
    version: '0.2.0',
  })
  const ready = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  expect(ready.state).toMatchObject({
    kind: 'ready',
    how: 'opened',
    path: join(root, 'data', 'updates', 'BroBot-0.2.0-arm64.dmg'),
  })
  expect(fake.downloads).toEqual([join(root, 'data', 'updates', 'BroBot-0.2.0-arm64.dmg')])
  expect(fake.installerDownloads).toBe(0)
  expect(fake.sent.some((one) => one.state.kind === 'available')).toBe(true)
  expect(fake.sent.at(-1)?.state.kind).toBe('ready')
  expect(fake.fetched).toBe(0)
})

it('offers a release and downloads an installer ready for a requested restart', async (ctx) => {
  // Linux uses electron-updater's installer route; the Mac's guided image is checked separately.
  ctx.skip(process.platform === 'darwin')
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '0.2.0',
      files: [{ url: 'fictional-update.AppImage', sha512: 'fictional' }],
    },
  }
  start()
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)).state.kind).toBe('idle')
  expect(fake.installerDownloads).toBe(0)
  expect(fake.downloads).toHaveLength(0)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)).state).toEqual({
    kind: 'available',
    version: '0.2.0',
  })
  const ready = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  expect(ready.state).toEqual({
    kind: 'ready',
    version: '0.2.0',
    how: 'restart',
    path: null,
  })
  expect(fake.installerDownloads).toBe(1)
  expect(fake.downloads).toHaveLength(0)
  expect(fake.sent.some((one) => one.state.kind === 'available')).toBe(true)
  expect(fake.sent.at(-1)?.state).toEqual(ready.state)
  expect(fake.quits).toBe(0)
  expect(fake.fetched).toBe(0)
})

it('shows a failed check and lets a later person-requested check recover', async () => {
  fake.fail = new Error('The fictional feed is unavailable')
  start()
  const failed = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)
  expect(failed.state).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('The fictional feed is unavailable'),
  })
  fake.fail = null
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)).state).toMatchObject({
    kind: 'idle',
    upToDate: true,
  })
  expect(fake.checks).toBe(2)
  expect(fake.fetched).toBe(0)
})
