import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QUIET_LOOK_EVERY_MS } from '../src/main/updates'
import { UPDATES_CHANNELS, type UpdatesSnapshot } from '../src/shared/updates'
import { startUpdates } from '../src/main/updates-in-the-app'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const fake = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  return {
    native: new EventEmitter(),
    updaterEvents: new EventEmitter(),
    autoStage: true,
    installOnQuit: false,
    otherWorkspaces: 0,
    stops: [] as { conversationId: string; agentName: string }[],
    handlers: new Map<string, Handler>(),
    appEvents: new Map<string, () => void>(),
    answer: null as null | {
      isUpdateAvailable: boolean
      updateInfo: { version: string; files: { url: string; sha512: string }[] }
    },
    fail: null as Error | null,
    checks: 0,
    sent: [] as UpdatesSnapshot[],
    installer: '',
    installerDownloads: 0,
    cachedVersion: null as string | null,
    downloadedVersions: [] as (string | null)[],
    quits: 0,
    fetched: 0,
    nativeInstalls: 0,
    downloadFailure: null as Error | null,
  }
})

vi.mock('../src/main/other-brobots', () => ({
  otherBroBotsRunning: async () => fake.otherWorkspaces,
}))
vi.mock('electron', () => ({
  autoUpdater: fake.native,
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
    openPath: vi.fn(),
  },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      set autoInstallOnAppQuit(value: boolean) {
        fake.installOnQuit = value
      },
      checkForUpdates: async () => {
        fake.checks += 1
        if (fake.fail !== null) throw fake.fail
        if (fake.answer?.isUpdateAvailable) fake.cachedVersion = fake.answer.updateInfo.version
        return fake.answer
      },
      downloadUpdate: async () => {
        if (fake.downloadFailure) throw fake.downloadFailure
        fake.installerDownloads += 1
        fake.downloadedVersions.push(fake.cachedVersion)
        if (process.platform === 'darwin' && fake.autoStage)
          queueMicrotask(() => fake.native.emit('update-downloaded'))
        return [fake.installer]
      },
      quitAndInstall: () => {
        fake.nativeInstalls += 1
      },
      on: (...args: Parameters<typeof fake.updaterEvents.on>) => fake.updaterEvents.on(...args),
      once: (...args: Parameters<typeof fake.updaterEvents.once>) =>
        fake.updaterEvents.once(...args),
      off: (...args: Parameters<typeof fake.updaterEvents.off>) => fake.updaterEvents.off(...args),
    },
  },
}))
let root: string
let resourceDescriptor: PropertyDescriptor | undefined
let platformDescriptor: PropertyDescriptor | undefined
let updates: ReturnType<typeof startUpdates> | null = null
const ask = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = fake.handlers.get(channel)
  if (handler === undefined) throw new Error(`No update handler on ${channel}`)
  return handler({ sender: null }, ...args) as T
}

const start = (packaged = true, hidden = true): void => {
  const userData = join(root, 'data')
  const appData = join(root, 'app-data')
  mkdirSync(userData, { recursive: true })
  mkdirSync(appData, { recursive: true })
  const paths: Record<string, string> = { userData, appData, downloads: join(root, 'downloads') }
  const app = {
    isPackaged: packaged,
    getPath: (name: string) => paths[name],
    getVersion: () => '0.1.0',
    on: (name: string, run: () => void) => fake.appEvents.set(name, run),
    quit: () => {
      fake.quits += 1
    },
    getAppMetrics: () => [],
  } as unknown as App
  updates = startUpdates({
    app,
    host: { whatARestartWouldStop: () => fake.stops } as never,
    hidden,
  })
}

beforeEach(() => {
  platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  root = mkdtempSync(join(tmpdir(), 'brobot-update-wiring-'))
  resourceDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true })
  writeFileSync(
    join(root, 'app-update.yml'),
    'provider: generic\nurl: https://fictional.invalid/releases\n',
  )
  fake.native.removeAllListeners()
  fake.updaterEvents.removeAllListeners()
  fake.updaterEvents.on('error', () => {})
  fake.native.on('error', (error) => fake.updaterEvents.emit('error', error))
  fake.autoStage = true
  fake.stops = []
  fake.installOnQuit = false
  fake.otherWorkspaces = 0
  fake.handlers.clear()
  fake.appEvents.clear()
  fake.answer = null
  fake.fail = null
  fake.checks = 0
  fake.sent.length = 0
  fake.installer = join(root, 'fictional-update.AppImage')
  fake.installerDownloads = 0
  fake.cachedVersion = null
  fake.downloadedVersions.length = 0
  fake.quits = 0
  fake.fetched = 0
  fake.nativeInstalls = 0
  fake.downloadFailure = null
})

afterEach(() => {
  updates?.stop()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  if (platformDescriptor !== undefined)
    Object.defineProperty(process, 'platform', platformDescriptor)
  updates = null
  if (resourceDescriptor === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourceDescriptor)
  fake.handlers.clear()
  rmSync(root, { recursive: true, force: true })
})

for (const platform of ['win32', 'darwin'] as const) {
  for (const fails of [false, true]) {
    it(`${platform}: Download refreshes electron-updater's offer${fails ? ' and retains the previous download on check failure' : ' before fetching the newest release'}`, async () => {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
      const offer = (version: string) => ({
        isUpdateAvailable: true,
        updateInfo: {
          version,
          files: [{ url: `BroCrew-${version}-arm64.dmg`, sha512: `digest-${version}` }],
        },
      })
      fake.answer = offer('0.1.22')
      start()
      await ask(UPDATES_CHANNELS.checkNow)
      expect(fake.installerDownloads).toBe(0)
      fake.answer = offer('0.1.25')
      if (fails) fake.fail = new Error('feed temporarily unavailable')
      const ready = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
      const version = fails ? '0.1.22' : '0.1.25'
      expect(fake.checks).toBe(2)
      expect(ready.state).toMatchObject({
        kind: 'ready',
        version,
        how: 'restart',
      })
      expect(fake.downloadedVersions).toEqual([version])
      expect(fake.quits).toBe(0)
      expect(fake.fetched).toBe(0)
    })
  }
}

it.each(['1', undefined])('honours the rehearsal update-check flag %s', async (flag) => {
  vi.stubEnv('BROCREW_SKIP_UPDATE_CHECK', flag)
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  expect(fake.checks).toBe(flag === '1' ? 0 : 1)
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

it('offers a release and downloads an installer ready for a requested restart', async () => {
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

for (const platform of ['win32', 'darwin'] as const) {
  it(`${platform}: only the Mac calls quitAndInstall for a requested quiet restart`, async () => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    fake.answer = {
      isUpdateAvailable: true,
      updateInfo: {
        version: '0.2.0',
        files: [{ url: 'fictional-update.zip', sha512: 'fictional' }],
      },
    }
    start()
    await ask(UPDATES_CHANNELS.checkNow)
    await ask(UPDATES_CHANNELS.download)
    expect(fake.nativeInstalls).toBe(0)
    expect(fake.installOnQuit).toBe(platform === 'darwin')
    await ask(UPDATES_CHANNELS.restartWhenQuiet)
    await vi.waitFor(() => {
      expect(fake.nativeInstalls).toBe(platform === 'darwin' ? 1 : 0)
      expect(fake.quits).toBe(platform === 'win32' ? 1 : 0)
    })
  })
}

it('keeps a failed Mac download from becoming installable', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0', files: [{ url: 'fictional-update.zip', sha512: 'fictional' }] },
  }
  fake.downloadFailure = new Error('fictional download failure')
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)).state).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('fictional download failure'),
  })
  await ask(UPDATES_CHANNELS.restartWhenQuiet)
  expect(fake.nativeInstalls).toBe(0)
  expect(fake.quits).toBe(0)
})

const beginMacPreparation = async (): Promise<[Promise<UpdatesSnapshot>]> => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  fake.autoStage = false
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0', files: [{ url: 'fictional.zip', sha512: 'fictional' }] },
  }
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  const downloading = ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  await vi.waitFor(() => expect(fake.installerDownloads).toBe(1))
  return [downloading]
}

it('waits for native preparation before offering Restart, then preserves quiet waiting and Cancel', async () => {
  const [downloading] = await beginMacPreparation()
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state.kind).toBe('downloading')
  await ask(UPDATES_CHANNELS.restartWhenQuiet)
  expect(fake.nativeInstalls).toBe(0)
  fake.native.emit('update-downloaded')
  expect((await downloading).state.kind).toBe('ready')
  expect(fake.native.listenerCount('update-downloaded')).toBe(0)
  vi.useFakeTimers()
  fake.stops = [{ conversationId: 'busy', agentName: 'Fictional' }]
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.restartWhenQuiet)).state.kind).toBe(
    'waiting-to-restart',
  )
  await ask(UPDATES_CHANNELS.cancelRestart)
  fake.stops = []
  await vi.advanceTimersByTimeAsync(QUIET_LOOK_EVERY_MS * 2)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state.kind).toBe('ready')
  expect(fake.nativeInstalls).toBe(0)
})

it('shows a native preparation error after ZIP download and never offers Restart', async () => {
  const [downloading] = await beginMacPreparation()
  fake.native.emit('error', new Error('fictional Squirrel signature failure'))
  expect((await downloading).state).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('fictional Squirrel signature failure'),
  })
  expect(fake.sent.some((one) => one.state.kind === 'ready')).toBe(false)
  expect(fake.native.listenerCount('update-downloaded')).toBe(0)
  expect(fake.updaterEvents.listenerCount('error')).toBe(2)
  await ask(UPDATES_CHANNELS.restartWhenQuiet)
  expect(fake.nativeInstalls).toBe(0)
})

it('detaches pending native preparation when the app stops', async () => {
  const [downloading] = await beginMacPreparation()
  updates!.stop()
  await downloading
  expect(fake.native.listenerCount('update-downloaded')).toBe(0)
  expect(fake.updaterEvents.listenerCount('error')).toBe(1)
  const sent = fake.sent.length
  fake.native.emit('update-downloaded')
  expect(fake.sent.length).toBe(sent)
  expect(fake.nativeInstalls).toBe(0)
})

for (const waiting of [false, true]) {
  it(`shows a native error after ready${waiting ? ' and cancels a waiting restart' : ''}, then permits recovery`, async () => {
    const [downloading] = await beginMacPreparation()
    fake.native.emit('update-downloaded')
    expect((await downloading).state.kind).toBe('ready')
    if (waiting) {
      vi.useFakeTimers()
      fake.stops = [{ conversationId: 'busy', agentName: 'Fictional' }]
      await ask(UPDATES_CHANNELS.restartWhenQuiet)
      expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state.kind).toBe(
        'waiting-to-restart',
      )
    } else {
      await ask(UPDATES_CHANNELS.restartWhenQuiet)
      await vi.waitFor(() => expect(fake.nativeInstalls).toBe(1))
      vi.useFakeTimers()
    }
    const installs = fake.nativeInstalls
    fake.native.emit('error', new Error('fictional ShipIt relaunch failure'))
    expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('fictional ShipIt relaunch failure'),
    })
    expect(fake.sent.at(-1)?.state.kind).toBe('error')
    fake.stops = []
    await vi.advanceTimersByTimeAsync(QUIET_LOOK_EVERY_MS * 2)
    expect(fake.nativeInstalls).toBe(installs)
    expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.checkNow)).state.kind).toBe('available')
    updates!.stop()
    expect(fake.updaterEvents.listenerCount('error')).toBe(1)
  })
}

it('keeps the Windows quiet restart waiting for other workspaces and lets Cancel stand', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0', files: [{ url: 'fictional.exe', sha512: 'fictional' }] },
  }
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  await ask(UPDATES_CHANNELS.download)
  fake.otherWorkspaces = 4
  await ask(UPDATES_CHANNELS.restartWhenQuiet)
  await vi.waitFor(async () => {
    expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.read)).state).toMatchObject({
      kind: 'waiting-to-restart',
      stops: { otherWorkspaces: 4 },
    })
  })
  expect(fake.quits).toBe(0)
  await ask(UPDATES_CHANNELS.cancelRestart)
  vi.useFakeTimers()
  fake.otherWorkspaces = 0
  await vi.advanceTimersByTimeAsync(QUIET_LOOK_EVERY_MS * 2)
  expect(fake.quits).toBe(0)
  await ask(UPDATES_CHANNELS.restartWhenQuiet)
  await vi.waitFor(() => expect(fake.quits).toBe(1))
  expect(fake.nativeInstalls).toBe(0)
})
