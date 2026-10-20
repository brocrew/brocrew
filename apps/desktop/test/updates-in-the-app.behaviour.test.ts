import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UPDATES_CHANNELS, type UpdatesSnapshot } from '../src/shared/updates'
import { createAppLifetime } from '../src/main/app-lifetime'
import { startUpdates } from '../src/main/updates-in-the-app'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  appEvents: new Map<string, () => void>(),
  guidedSignals: [] as (AbortSignal | undefined)[],
  stagingFolders: [] as string[],
  opened: [] as string[],
  guidedPath: null as string | null,
  cleanup: null as Promise<void> | null,
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
    openPath: async (path: string) => {
      fake.opened.push(path)
      return ''
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
    downloadChecked: async ({
      to,
      signal,
      stagingFolder,
    }: {
      to: string
      signal?: AbortSignal
      stagingFolder: string
    }) => {
      fake.downloads.push(to)
      fake.guidedSignals.push(signal)
      fake.stagingFolders.push(stagingFolder)
      if (fake.cleanup !== null) {
        await new Promise<void>((resolve) =>
          signal!.addEventListener('abort', () => resolve(), { once: true }),
        )
        await fake.cleanup
        signal!.throwIfAborted()
      }
      return fake.guidedPath ?? to
    },
  }
})

let root: string
let resourceDescriptor: PropertyDescriptor | undefined
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
    host: { whatARestartWouldStop: () => ({ conversations: [], otherWorkspaces: 0 }) } as never,
    hidden,
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
  fake.appEvents.clear()
  fake.guidedSignals.length = 0
  fake.stagingFolders.length = 0
  fake.opened.length = 0
  fake.guidedPath = null
  fake.cleanup = null
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
  expect(fake.opened).toEqual([])
  expect(fake.stagingFolders).toEqual([join(root, 'data', 'updates', 'staging')])
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

it('keeps the guided download’s actual collision path and cancels its signal before quit', async (ctx) => {
  ctx.skip(process.platform !== 'darwin')
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.2.0',
      files: [{ url: 'Fern-1.2.0-arm64.dmg', sha512: 'fictional' }],
    },
  }
  fake.guidedPath = join(root, 'data', 'updates', 'Fern-1.2.0-arm64 (1).dmg')
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  const ready = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  expect(ready.state).toMatchObject({ kind: 'ready', path: fake.guidedPath })
  const signal = fake.guidedSignals[0]
  expect(signal).toBeDefined()
  expect(signal?.aborted).toBe(false)
  fake.appEvents.get('before-quit')?.()
  expect(signal?.aborted).toBe(true)
})

it('drains a cancelled guided download before an empty app may finish quitting', async (ctx) => {
  ctx.skip(process.platform !== 'darwin')
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.2.0',
      files: [{ url: 'Fern.dmg', sha512: 'fictional' }],
    },
  }
  let release!: () => void
  fake.cleanup = new Promise<void>((resolve) => {
    release = resolve
  })
  start()
  await ask(UPDATES_CHANNELS.checkNow)
  const downloading = ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  await vi.waitFor(() => expect(fake.guidedSignals).toHaveLength(1))
  const events: string[] = []
  const prevented = vi.fn()
  const lifetime = createAppLifetime({
    announceClosing: () => {
      events.push('closing')
    },
    closeAllSessions: async () => {},
    stopArchiveWork: () => {
      updates!.stop()
    },
    drainArchiveWork: async () => {
      events.push('draining')
      await updates!.drain()
    },
    closeDatabase: () => {
      events.push('closed')
    },
    quit: () => {
      events.push('quit')
    },
    exit: () => {
      events.push('exit')
    },
    armLastResort: () => {},
    log: () => {},
    now: () => 0,
  })
  try {
    fake.appEvents.get('before-quit')?.()
    expect(typeof updates!.drain).toBe('function')
    lifetime.beforeQuit({ preventDefault: prevented })
    await vi.waitFor(() => expect(events).toContain('draining'))
    expect(prevented).toHaveBeenCalledOnce()
    expect(fake.guidedSignals[0]?.aborted).toBe(true)
    expect(events).not.toContain('closed')
    expect(events).not.toContain('quit')
    release()
    await lifetime.shuttingDown
    expect(events).toEqual(['closing', 'draining', 'closed', 'quit'])
    expect((await downloading).state.kind).toBe('error')
  } finally {
    release()
    await downloading
  }
})

it('keeps an ordinary Mac download’s staging private while opening its Downloads destination', async (ctx) => {
  ctx.skip(process.platform !== 'darwin')
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.2.0',
      files: [{ url: 'Fern.dmg', sha512: 'fictional' }],
    },
  }
  start(true, false)
  await ask(UPDATES_CHANNELS.checkNow)
  const ready = await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)
  expect(ready.state).toMatchObject({ kind: 'ready', path: join(root, 'downloads', 'Fern.dmg') })
  expect(fake.stagingFolders).toEqual([join(root, 'data', 'updates', 'staging')])
  expect(fake.opened).toEqual([join(root, 'downloads', 'Fern.dmg')])
})

it('clears crash-left staging files at each start before any download', () => {
  const staging = join(root, 'data', 'updates', 'staging')
  mkdirSync(staging, { recursive: true })
  const partial = join(staging, 'Fern.brobot-0123456789abcdef01234567.partial')
  writeFileSync(partial, 'A fictional interrupted download')
  start()
  expect(existsSync(partial)).toBe(false)
  expect(fake.downloads).toEqual([])
  expect(fake.checks).toBe(0)
  writeFileSync(partial, 'Another fictional interrupted download')
  updates!.stop()
  start()
  expect(existsSync(partial)).toBe(false)
  expect(fake.downloads).toEqual([])
})

it('unlinks direct staging links while keeping their targets and subdirectories intact', () => {
  const staging = join(root, 'data', 'updates', 'staging')
  const outside = join(root, 'outside')
  mkdirSync(staging, { recursive: true })
  mkdirSync(outside)
  const target = join(outside, 'Brook.txt')
  writeFileSync(target, 'A fictional draft')
  const link = join(staging, 'linked-folder')
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  const nested = join(staging, 'kept-directory')
  mkdirSync(nested)
  writeFileSync(join(nested, 'kept.txt'), 'A fictional nested file')
  start()
  expect(existsSync(link)).toBe(false)
  expect(readFileSync(target, 'utf8')).toBe('A fictional draft')
  expect(readdirSync(outside)).toEqual(['Brook.txt'])
  expect(readFileSync(join(nested, 'kept.txt'), 'utf8')).toBe('A fictional nested file')
  expect(readdirSync(staging)).toEqual(['kept-directory'])
})

for (const linked of ['updates', 'staging']) {
  it(`skips a linked ${linked} folder at start without sweeping its target`, () => {
    const updatesFolder = join(root, 'data', 'updates')
    const outside = join(root, 'outside')
    mkdirSync(join(root, 'data'), { recursive: true })
    mkdirSync(outside)
    if (linked === 'staging') mkdirSync(updatesFolder)
    const link = linked === 'updates' ? updatesFolder : join(updatesFolder, 'staging')
    const targetFolder = linked === 'updates' ? join(outside, 'staging') : outside
    mkdirSync(targetFolder, { recursive: true })
    writeFileSync(join(targetFolder, 'Brook.txt'), 'A fictional draft')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    start()
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(targetFolder, 'Brook.txt'), 'utf8')).toBe('A fictional draft')
    expect(fake.downloads).toEqual([])
  })
}

it('starts without a staging folder and creates it only for a later download', async (ctx) => {
  ctx.skip(process.platform !== 'darwin')
  start()
  const staging = join(root, 'data', 'updates', 'staging')
  expect(existsSync(staging)).toBe(false)
  fake.answer = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.2.0',
      files: [{ url: 'Fern.dmg', sha512: 'fictional' }],
    },
  }
  await ask(UPDATES_CHANNELS.checkNow)
  expect((await ask<UpdatesSnapshot>(UPDATES_CHANNELS.download)).state.kind).toBe('ready')
  expect(lstatSync(staging).isDirectory()).toBe(true)
})
