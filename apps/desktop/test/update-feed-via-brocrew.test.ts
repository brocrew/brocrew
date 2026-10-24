import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RequestOptions } from 'node:http'
import type { App } from 'electron'
import type { NsisUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startUpdates } from '../src/main/updates-in-the-app'

const fake = vi.hoisted(() => ({
  updater: null as unknown,
  opened: vi.fn(async () => ''),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return fake.updater
    },
  },
}))
vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: (...args: Parameters<typeof fetch>) => fake.fetch(...args) },
  shell: { openPath: () => fake.opened() },
}))

const require = createRequire(import.meta.url)
const dependency = createRequire(require.resolve('electron-updater'))
const { DigestTransform } = dependency('builder-util-runtime') as {
  DigestTransform: new (digest: string) => Transform
}
const BODY = Buffer.from('A fictional release file, never an executable.')
const HASH = createHash('sha512').update(BODY).digest('base64')
const VERSION = '0.2.0'
const INSTALLED = '0.1.8'
type Asked = { url: URL; headers: RequestOptions['headers']; download: boolean }
let root: string
let resources: PropertyDescriptor | undefined
let platform: PropertyDescriptor | undefined
let updater: NsisUpdater
let updates: ReturnType<typeof startUpdates> | undefined
let asked: Asked[]
let primaryError: Error | null
let primaryManifest: string
let bytes: Buffer
let quit: ReturnType<typeof vi.fn<() => void>>
let verify: ReturnType<typeof vi.fn<(publishers: string[], file: string) => Promise<string | null>>>

function manifest(on: 'win32' | 'darwin' = 'win32'): string {
  const names =
    on === 'darwin'
      ? [`BroCrew-${VERSION}-arm64-mac.zip`, `BroCrew-${VERSION}-arm64.dmg`]
      : [`BroCrew-Setup-${VERSION}-x64.exe`]
  return JSON.stringify({
    version: VERSION,
    files: names.map((url) => ({ url, sha512: HASH, size: BODY.length })),
    path: names[0],
    sha512: HASH,
  })
}

function requestUrl(options: RequestOptions): URL {
  return new URL(
    `${options.protocol ?? 'https:'}//${options.hostname ?? options.host}${options.path ?? '/'}`,
  )
}

async function start(on: 'win32' | 'darwin' = 'win32', enabled = true): Promise<void> {
  Object.defineProperty(process, 'platform', { value: on, configurable: true })
  primaryManifest = manifest(on)
  const { NsisUpdater: RealUpdater } =
    await vi.importActual<typeof import('electron-updater')>('electron-updater')
  const data = join(root, 'data')
  mkdirSync(data)
  const appUpdate = join(root, 'app-update.yml')
  writeFileSync(
    appUpdate,
    'provider: github\nowner: brocrew\nrepo: brocrew\npublisherName: Fictional Publisher\nupdaterCacheDirName: fictional-updates\n',
  )
  writeFileSync(
    join(data, 'update-settings.json'),
    JSON.stringify({ updates: { checkAutomatically: enabled, channel: 'stable' } }),
  )
  quit = vi.fn<() => void>()
  updater = new RealUpdater(undefined, {
    version: INSTALLED,
    name: 'Fictional',
    isPackaged: true,
    appUpdateConfigPath: appUpdate,
    userDataPath: data,
    baseCachePath: join(root, 'cache'),
    whenReady: async () => {},
    relaunch: () => {},
    quit,
    onQuit: () => {},
  })
  Object.assign(updater, {
    _testOnlyOptions: { platform: on },
    httpExecutor: {
      request: async (options: RequestOptions) => {
        const url = requestUrl(options)
        asked.push({ url, headers: options.headers, download: false })
        if (url.origin === 'https://brocrew.app') {
          if (primaryError) throw primaryError
          return primaryManifest
        }
        if (url.pathname.endsWith('.atom'))
          return `<feed><entry><title>Fictional</title><link href="https://github.com/brocrew/brocrew/releases/tag/v${VERSION}"/><content>Fictional release</content></entry></feed>`
        if (url.pathname.endsWith('/latest')) return JSON.stringify({ tag_name: `v${VERSION}` })
        if (url.pathname.endsWith('.yml')) return manifest(on)
        throw Error('Unexpected test request: ' + url.href)
      },
      download: async (
        url: URL,
        file: string,
        options: { sha512: string; headers: RequestOptions['headers'] },
      ) => {
        asked.push({ url: new URL(url), headers: options.headers, download: true })
        await pipeline(
          Readable.from(bytes),
          new DigestTransform(options.sha512),
          createWriteStream(file),
        )
      },
    },
  })
  updater.disableDifferentialDownload = true
  verify = vi.fn<(publishers: string[], file: string) => Promise<string | null>>(async () => null)
  updater.verifyUpdateCodeSignature = verify
  vi.spyOn(updater, 'install').mockReturnValue(false)
  fake.updater = updater
  fake.fetch.mockImplementation(async (input, init) => {
    asked.push({
      url: new URL(String(input)),
      headers: init?.headers as RequestOptions['headers'],
      download: true,
    })
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-length': String(bytes.length) },
    })
  })
  const app = {
    isPackaged: true,
    getVersion: () => INSTALLED,
    getPath: (name: string) =>
      ({ userData: data, appData: root, downloads: join(root, 'downloads') })[name],
    on: () => {},
    quit,
    getAppMetrics: () => [],
  } as unknown as App
  updates = startUpdates({ app, hidden: true, host: { whatARestartWouldStop: () => [] } as never })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-update-feed-'))
  resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'resourcesPath', { value: root, configurable: true })
  asked = []
  primaryError = null
  bytes = BODY
  fake.opened.mockClear()
  fake.fetch.mockReset()
})
afterEach(async () => {
  await updates?.drain()
  updates = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (resources) Object.defineProperty(process, 'resourcesPath', resources)
  else Reflect.deleteProperty(process, 'resourcesPath')
  if (platform) Object.defineProperty(process, 'platform', platform)
  rmSync(root, { recursive: true, force: true })
})

describe('the public update feed', () => {
  it('sends no requests with automatic checks switched off, at launch or a day later', async () => {
    vi.useFakeTimers()
    await start('win32', false)
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000)
    expect(asked).toEqual([])
    expect(fake.fetch).not.toHaveBeenCalled()
  })

  it('asks brocrew.app with only the installed version and no user or install identifier', async () => {
    await start()
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.url.origin + asked[0]!.url.pathname).toBe(
      'https://brocrew.app/update/latest.yml',
    )
    expect([...asked[0]!.url.searchParams]).toEqual([['v', INSTALLED]])
    expect(asked[0]!.headers).toEqual({ 'User-Agent': 'BroCrew' })
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
  })

  it.each([
    Object.assign(new Error('offline'), { code: 'ENOTFOUND' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    new Error('Request timed out'),
    Object.assign(new Error('HTTP 503'), { statusCode: 503 }),
  ])('falls back to the existing GitHub feed for an unavailable check: %s', async (error) => {
    await start()
    primaryError = error
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked[0]!.url.origin).toBe('https://brocrew.app')
    expect(asked.slice(1).every((row) => row.url.origin === 'https://github.com')).toBe(true)
    expect(asked.some((row) => row.url.pathname === '/brocrew/brocrew/releases.atom')).toBe(true)
    primaryError = null
    asked = []
    await updates!.checkNow()
    expect(asked.map((row) => row.url.origin)).toEqual(['https://brocrew.app'])
  })

  it('does not disguise a refusal or malformed manifest as an unavailable website', async () => {
    await start()
    primaryError = Object.assign(new Error('HTTP 403'), { statusCode: 403 })
    expect((await updates!.checkNow()).state.kind).toBe('error')
    expect(asked.map((row) => row.url.origin)).toEqual(['https://brocrew.app'])
    primaryError = null
    primaryManifest = '[['
    asked = []
    expect((await updates!.checkNow()).state.kind).toBe('error')
    expect(asked.map((row) => row.url.origin)).toEqual(['https://brocrew.app'])
  })

  it.each([
    'BroCrew-Setup-0.3.0-x64.exe',
    'Another-App-0.2.0.exe',
    'https://fictional.invalid/BroCrew-Setup-0.2.0-x64.exe',
    '../BroCrew-Setup-0.2.0-x64.exe',
  ])('refuses a mismatched release file without downloading or installing: %s', async (url) => {
    await start()
    primaryManifest = JSON.stringify({
      version: VERSION,
      files: [{ url, sha512: HASH }],
      path: url,
      sha512: HASH,
    })
    expect((await updates!.checkNow()).state.kind).toBe('error')
    await updates!.download()
    expect(asked.filter((row) => row.download)).toEqual([])
    expect(updater.install).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('keeps the Windows updater checksum check and refuses damaged bytes', async () => {
    await start()
    bytes = Buffer.from('Wrong fictional installer bytes')
    await updates!.checkNow()
    expect((await updates!.download()).state).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/checksum|sha512/i),
    })
    expect(asked.filter((row) => row.download).map((row) => row.url.origin)).toEqual([
      'https://brocrew.app',
    ])
    expect(verify).not.toHaveBeenCalled()
    expect(updater.install).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('downloads the selected Windows file without automatically installing it', async () => {
    await start()
    await updates!.checkNow()
    expect((await updates!.download()).state).toMatchObject({ kind: 'ready', how: 'restart' })
    const download = asked.find((row) => row.download)!
    expect(download.url.pathname).toBe(`/update/BroCrew-Setup-${VERSION}-x64.exe`)
    expect([...download.url.searchParams]).toEqual([['v', INSTALLED]])
    expect(download.headers).toEqual({ 'User-Agent': 'BroCrew', accept: '*/*' })
    expect(verify).toHaveBeenCalledOnce()
    expect(updater.install).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('keeps the Windows updater signature check after a correct checksum', async () => {
    await start()
    verify.mockResolvedValue('Fictional signer mismatch')
    await updates!.checkNow()
    expect((await updates!.download()).state).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('not signed'),
    })
    expect(verify).toHaveBeenCalledOnce()
    expect(updater.install).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('keeps the Mac checked download and never opens bytes with a wrong hash', async () => {
    await start('darwin')
    bytes = Buffer.from('Wrong fictional disk image bytes')
    await updates!.checkNow()
    expect((await updates!.download()).state).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('sha512'),
    })
    const sent = asked.find((row) => row.download)!
    expect(sent.url.pathname).toBe(`/update/BroCrew-${VERSION}-arm64.dmg`)
    expect([...sent.url.searchParams]).toEqual([['v', INSTALLED]])
    expect(fake.opened).not.toHaveBeenCalled()
  })
})
