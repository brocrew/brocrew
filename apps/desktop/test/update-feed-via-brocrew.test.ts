import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RequestOptions } from 'node:http'
import type { App } from 'electron'
import type { CancellationToken } from 'electron-updater/out/types'
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
const { DigestTransform, HttpExecutor } = dependency('builder-util-runtime') as {
  HttpExecutor: {
    prototype: {
      request(options: RequestOptions, cancellation?: CancellationToken): Promise<string | null>
    }
  }
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
let primaryRequest: (() => void) | undefined
let beforeDownloadTransport: (() => void) | undefined
let primaryHangs: boolean
const cancelledRequest = vi.fn()
type Reply = { status: number; body: string; headers?: Record<string, string> }
let replies: Map<string, Reply>
function responseFor(options: RequestOptions): Reply | undefined {
  const url = requestUrl(options)
  return replies.get(url.origin + url.pathname)
}

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

async function start(
  on: 'win32' | 'darwin' = 'win32',
  enabled = true,
  installed = INSTALLED,
): Promise<void> {
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
    version: installed,
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
    httpExecutor: Object.assign(Object.create(HttpExecutor.prototype) as object, {
      maxRedirects: 10,
      createRequest(options: RequestOptions, callback: (response: PassThrough) => void = () => {}) {
        const reply = responseFor(options)
        const request = Object.assign(new EventEmitter(), {
          options,
          abort: (): void => {
            request.emit('aborted')
          },
          end: () =>
            queueMicrotask(() => {
              if (!reply) throw new Error('No fictional response for ' + requestUrl(options))
              const response = Object.assign(new PassThrough(), {
                statusCode: reply.status,
                headers: { 'content-type': 'application/json', ...reply.headers },
              })
              callback(response)
              response.end(reply.body)
            }),
        })
        if (reply)
          asked.push({ url: requestUrl(options), headers: options.headers, download: false })
        return request
      },
      async request(
        this: { createRequest(options: RequestOptions): { options: RequestOptions } },
        original: RequestOptions,
        cancellation?: CancellationToken,
      ) {
        if (responseFor(original))
          return HttpExecutor.prototype.request.call(this, original, cancellation)
        const options = this.createRequest(original).options
        const url = requestUrl(options)
        asked.push({ url, headers: options.headers, download: false })
        if (url.origin === 'https://brocrew.app') {
          primaryRequest?.()
          if (primaryHangs)
            return cancellation!.createPromise((_resolve, _reject, onCancel) =>
              onCancel(cancelledRequest),
            )
          if (primaryError) throw primaryError
          return primaryManifest
        }
        if (url.pathname.endsWith('.atom'))
          return `<feed><entry><title>Fictional</title><link href="https://github.com/brocrew/brocrew/releases/tag/v${VERSION}"/><content>Fictional release</content></entry></feed>`
        if (url.pathname.endsWith('/latest')) return JSON.stringify({ tag_name: `v${VERSION}` })
        if (url.pathname.endsWith('.yml')) return manifest(on)
        throw Error('Unexpected test request: ' + url.href)
      },
      async download(
        this: { createRequest(options: RequestOptions): { options: RequestOptions } },
        url: URL,
        file: string,
        options: { sha512: string; headers: RequestOptions['headers'] },
      ) {
        beforeDownloadTransport?.()
        const request = this.createRequest({
          protocol: url.protocol,
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers: options.headers,
        }).options
        asked.push({ url: requestUrl(request), headers: request.headers, download: true })
        await pipeline(
          Readable.from(bytes),
          new DigestTransform(options.sha512),
          createWriteStream(file),
        )
      },
    }),
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
    getVersion: () => installed,
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
  primaryRequest = undefined
  beforeDownloadTransport = undefined
  primaryHangs = false
  replies = new Map()
  cancelledRequest.mockClear()
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

  it.each(['win32', 'darwin'] as const)(
    'keeps manual checks and downloads on GitHub with the switch off: %s',
    async (on) => {
      await start(on, false)
      expect((await updates!.checkNow()).state.kind).toBe('available')
      expect((await updates!.download()).state.kind).toBe('ready')
      expect(asked.length).toBeGreaterThan(0)
      expect(asked.every((row) => row.url.origin === 'https://github.com')).toBe(true)
      expect(updater.install).not.toHaveBeenCalled()
    },
  )

  it.each(['win32', 'darwin'] as const)(
    'uses GitHub if the switch is turned off after a website offer: %s',
    async (on) => {
      await start(on)
      await updates!.checkNow()
      expect(asked[0]!.url.origin).toBe('https://brocrew.app')
      asked = []
      updates!.set({ checkAutomatically: false })
      expect((await updates!.download()).state.kind).toBe('ready')
      expect(asked.filter((row) => row.download)).toHaveLength(1)
      expect(
        asked.every((row) => row.url.origin === 'https://github.com' && row.url.search === ''),
      ).toBe(true)
      expect(updater.install).not.toHaveBeenCalled()
    },
  )

  it('rechecks the switch at transport time after Windows download URLs were resolved', async () => {
    await start()
    await updates!.checkNow()
    asked = []
    beforeDownloadTransport = () => updates!.set({ checkAutomatically: false })
    expect((await updates!.download()).state.kind).toBe('ready')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.url.href).toBe(
      `https://github.com/brocrew/brocrew/releases/download/v${VERSION}/BroCrew-Setup-${VERSION}-x64.exe`,
    )
    expect(verify).toHaveBeenCalledOnce()
    expect(updater.install).not.toHaveBeenCalled()
  })

  it('reads another workspace’s switch-off before a retry or download', async () => {
    await start()
    primaryError = Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })
    primaryRequest = () =>
      writeFileSync(
        join(root, 'data', 'update-settings.json'),
        JSON.stringify({ updates: { checkAutomatically: false, channel: 'stable' } }),
      )
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked.filter((row) => row.url.origin === 'https://brocrew.app')).toHaveLength(1)
    asked = []
    expect((await updates!.download()).state.kind).toBe('ready')
    expect(asked.every((row) => row.url.origin === 'https://github.com')).toBe(true)
  })

  it('keeps beta on GitHub, and returns to the website for a stable check', async () => {
    await start()
    updates!.set({ channel: 'beta' })
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((row) => row.url.origin === 'https://github.com')).toBe(true)
    updates!.set({ channel: 'stable' })
    asked = []
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked.map((row) => row.url.origin)).toEqual(['https://brocrew.app'])
  })

  it('encodes the full installed SemVer without adding a timestamp or identifier', async () => {
    const installed = '0.1.8-beta.1+fictional.2'
    await start('win32', true, installed)
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect([...asked[0]!.url.searchParams]).toEqual([['v', installed]])
    expect(asked[0]!.url.search).toContain('%2Bfictional.2')
  })

  it('keeps both derived Windows blockmaps version-only, and reroutes queued blockmaps after switch-off', async () => {
    await start()
    await updates!.checkNow()
    const pending = updater as unknown as {
      updateInfoAndProvider: {
        info: Parameters<
          import('electron-updater/out/providers/GenericProvider').GenericProvider['resolveFiles']
        >[0]
        provider: import('electron-updater/out/providers/GenericProvider').GenericProvider
      }
      httpExecutor: {
        createRequest(options: RequestOptions, callback: () => void): { options: RequestOptions }
      }
    }
    const { info, provider } = pending.updateInfoAndProvider
    const file = provider.resolveFiles(info)[0]!
    const maps = await provider.getBlockMapFiles(file.url, INSTALLED, VERSION)
    expect(maps.map((url) => [...url.searchParams])).toEqual([
      [['v', INSTALLED]],
      [['v', INSTALLED]],
    ])
    updates!.set({ checkAutomatically: false })
    for (const [index, url] of maps.entries()) {
      const sent = pending.httpExecutor.createRequest(
        { protocol: url.protocol, hostname: url.hostname, path: url.pathname + url.search },
        () => {},
      ).options
      const release = index === 0 ? INSTALLED : VERSION
      expect(requestUrl(sent).href).toBe(
        `https://github.com/brocrew/brocrew/releases/download/v${release}/BroCrew-Setup-${release}-x64.exe.blockmap`,
      )
    }
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

  it('cancels a website request that never responds and falls back after the deadline', async () => {
    vi.useFakeTimers()
    await start()
    primaryHangs = true
    const check = updates!.checkNow()
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(59_000)
    expect(asked).toHaveLength(1)
    expect(cancelledRequest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await check).state.kind).toBe('available')
    expect(cancelledRequest).toHaveBeenCalledOnce()
    expect(asked.slice(1).every((row) => row.url.origin === 'https://github.com')).toBe(true)
    expect(updater.install).not.toHaveBeenCalled()
  })

  it.each([
    Object.assign(new Error('offline'), { code: 'ENOTFOUND' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    new Error('Request timed out'),
    new Error('Request has been aborted by the server'),
    new Error('net::ERR_CONNECTION_RESET'),
    Object.assign(new Error('net::ERR_FAILED'), { code: 'ERR_FAILED' }),
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

  it.each(['win32', 'darwin'] as const)(
    'keeps a fallback offer’s download on GitHub: %s',
    async (on) => {
      await start(on)
      primaryError = Object.assign(new Error('HTTP 502'), { statusCode: 502 })
      expect((await updates!.checkNow()).state.kind).toBe('available')
      asked = []
      expect((await updates!.download()).state.kind).toBe('ready')
      expect(asked).toHaveLength(1)
      expect(asked[0]!.url.origin).toBe('https://github.com')
      expect(asked[0]!.url.search).toBe('')
      expect(updater.install).not.toHaveBeenCalled()
    },
  )

  it.each([503, 403, 200])(
    'uses the real HTTP parser for status %s with malformed or empty JSON',
    async (status) => {
      await start()
      for (const body of ['', '{', 'not JSON']) {
        replies.set('https://brocrew.app/update/latest.yml', { status, body })
        asked = []
        expect((await updates!.checkNow()).state.kind).toBe(status === 503 ? 'available' : 'error')
        expect(asked[0]!.url.origin).toBe('https://brocrew.app')
        expect(asked.some((row) => row.url.origin === 'https://github.com')).toBe(status === 503)
        expect(asked.some((row) => row.download)).toBe(false)
      }
      expect(updater.install).not.toHaveBeenCalled()
    },
  )

  it('retains the final response status across a redirect without carrying it into the next check', async () => {
    await start()
    replies.set('https://brocrew.app/update/latest.yml', {
      status: 302,
      body: '',
      headers: { location: '/update/fictional-latest.yml' },
    })
    replies.set('https://brocrew.app/update/fictional-latest.yml', { status: 503, body: '{' })
    expect((await updates!.checkNow()).state.kind).toBe('available')
    expect(asked.filter((row) => row.url.origin === 'https://brocrew.app')).toHaveLength(2)
    asked = []
    replies.set('https://brocrew.app/update/fictional-latest.yml', { status: 200, body: '{' })
    expect((await updates!.checkNow()).state.kind).toBe('error')
    expect(asked.every((row) => row.url.origin === 'https://brocrew.app')).toBe(true)
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

  it('refuses a missing checksum, conflicting top-level path and unexpected package', async () => {
    await start()
    const ordinary = JSON.parse(manifest())
    for (const invalid of [
      { ...ordinary, files: [{ url: ordinary.path }] },
      { ...ordinary, files: [...ordinary.files, ...ordinary.files] },
      { ...ordinary, path: 'BroCrew-Setup-0.3.0-x64.exe' },
      { ...ordinary, sha512: Buffer.alloc(64, 1).toString('base64') },
      { ...ordinary, packages: { x64: { path: 'https://fictional.invalid/payload' } } },
    ]) {
      primaryManifest = JSON.stringify(invalid)
      expect((await updates!.checkNow()).state.kind).toBe('error')
      await updates!.download()
    }
    expect(asked.every((row) => !row.download && row.url.origin === 'https://brocrew.app')).toBe(
      true,
    )
    expect(updater.install).not.toHaveBeenCalled()
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
