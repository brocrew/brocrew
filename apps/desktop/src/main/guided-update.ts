import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { load } from 'js-yaml'
import type { FoundUpdate, ReleaseFile } from './updates'

/**
 * The Mac's update, guided: an app signed ad hoc cannot replace itself, so BroCrew downloads the
 * disk image, checks it against the sha512 its release published, and opens it for the person to
 * drag into Applications.
 */

/**
 * Where a build's releases are, as electron-builder wrote it into the app (`app-update.yml`). A
 * GitHub feed is `private` only when the build says so.
 */
export type ReleaseFeed =
  | {
      readonly provider: 'github'
      readonly owner: string
      readonly repo: string
      readonly private?: true
    }
  | { readonly provider: 'generic'; readonly url: string }

/** The feed `app-update.yml` names, or null when it names none this can read. */
export function readFeed(text: string): ReleaseFeed | null {
  const read: unknown = load(text)
  if (typeof read !== 'object' || read === null) return null
  const { provider, owner, repo, url, private: isPrivate } = read as Record<string, unknown>
  if (provider === 'github' && typeof owner === 'string' && typeof repo === 'string') {
    if (owner === '' || repo === '') return null
    return isPrivate === true ? { provider, owner, repo, private: true } : { provider, owner, repo }
  }
  if (provider === 'generic' && typeof url === 'string' && url !== '') return { provider, url }
  return null
}

/** The feed of the app at `resources`, or null for a build with none (a development or beta build). */
export function feedOfTheApp(appUpdateYml: string): ReleaseFeed | null {
  if (!existsSync(appUpdateYml)) return null
  return readFeed(readFileSync(appUpdateYml, 'utf8'))
}

/** Where a file of a release is downloaded from. GitHub's releases are tagged `v<version>`. */
export function downloadUrlOf(feed: ReleaseFeed, version: string, file: string): string {
  if (feed.provider === 'github') {
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(file)}`
  }
  return new URL(encodeURIComponent(file), feed.url.endsWith('/') ? feed.url : `${feed.url}/`).href
}

/**
 * The token a private GitHub feed is read with, by electron-updater's own rule: only when the build
 * says the feed is private, from `GH_TOKEN`, else `GITHUB_TOKEN`. Null for every other feed, and for
 * a private one with no token, which is then read as a public one. A `token:` in the file, which
 * electron-updater would also take, is never read here: no build writes one, and a release's check
 * refuses it.
 */
export function privateFeedToken(feed: ReleaseFeed, env: NodeJS.ProcessEnv): string | null {
  if (feed.provider !== 'github' || feed.private !== true) return null
  return env['GH_TOKEN'] || env['GITHUB_TOKEN'] || null
}

/** The only place a private feed's token is ever sent. */
const GITHUB_API = 'https://api.github.com'

/**
 * Where a file of a release on a private GitHub feed is downloaded from: GitHub's API names the
 * release's file and hands out a short-lived address for it, which is then fetched without the
 * token. The token goes to `api.github.com` and nowhere else, whatever address the API names, and
 * no error repeats it: a request that fails is said in fixed words, because what `fetch` throws can
 * quote the request's headers.
 */
export async function privateDownloadUrlOf(options: {
  readonly feed: ReleaseFeed & { readonly provider: 'github' }
  readonly version: string
  readonly file: string
  readonly token: string
  readonly fetch?: typeof globalThis.fetch
}): Promise<string> {
  const { feed, version, file, token } = options
  const fetch = options.fetch ?? globalThis.fetch
  const ask = async (
    url: string,
    accept: string,
    redirect: RequestInit['redirect'],
  ): Promise<Response> => {
    if (!URL.canParse(url) || new URL(url).origin !== GITHUB_API) {
      throw new Error('the private feed named an address that is not GitHub’s API')
    }
    const answer = await fetch(url, {
      headers: { accept, authorization: `token ${token}`, 'user-agent': 'BroCrew' },
      redirect,
    }).catch(() => null)
    if (answer === null) throw new Error('the private feed could not be reached')
    return answer
  }
  const api = `${GITHUB_API}/repos/${encodeURIComponent(feed.owner)}/${encodeURIComponent(feed.repo)}`
  const release = await ask(
    `${api}/releases/tags/v${encodeURIComponent(version)}`,
    'application/vnd.github+json',
    'follow',
  )
  if (!release.ok) {
    throw new Error(`the private feed answered ${String(release.status)} for release ${version}`)
  }
  const { assets } = (await release.json()) as { assets?: { name: string; url: string }[] }
  const asset = assets?.find((one) => one.name === file)
  if (asset === undefined) throw new Error(`release ${version} on the private feed has no ${file}`)
  const handed = await ask(asset.url, 'application/octet-stream', 'manual')
  const location = handed.headers.get('location')
  if (handed.status < 300 || handed.status > 399 || location === null) {
    throw new Error(
      `the private feed did not hand out ${file}: it answered ${String(handed.status)}`,
    )
  }
  return location
}

/** The disk image a Mac release names, or null. */
export function diskImageOf(found: FoundUpdate): ReleaseFile | null {
  return found.files.find((file) => file.url.endsWith('.dmg')) ?? null
}

const STALLS_AFTER_MS = 60_000

/**
 * Download into private staging, check the bytes against the release's sha512 as they arrive, then
 * copy the image to an unused name beside `to`. Nothing reaches `to`'s folder unless it matched.
 */
export async function downloadChecked(options: {
  readonly url: string
  readonly sha512: string
  readonly to: string
  readonly stagingFolder: string
  readonly onPercent: (percent: number) => void
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly stallsAfterMs?: number
  readonly signal?: AbortSignal
}): Promise<string> {
  const { url, sha512, to, onPercent } = options
  const stallsAfterMs = options.stallsAfterMs ?? STALLS_AFTER_MS
  const stalled = new Error(
    `the download stalled: no progress for ${String(Math.round(stallsAfterMs / 1000))} s`,
  )
  const idle = new AbortController()
  const signal =
    options.signal === undefined ? idle.signal : AbortSignal.any([options.signal, idle.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(stalled), stallsAfterMs)
  }
  const failure = (error: unknown): unknown => {
    if (options.signal?.aborted === true) return options.signal.reason
    if (idle.signal.aborted) return stalled
    console.warn(`updates: downloading ${url.split('?')[0]!} failed: ${String(error)}`)
    return new Error('the download could not be completed')
  }
  const partial = join(options.stagingFolder, `${randomUUID()}.partial`)
  watch()
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      signal,
      credentials: 'omit',
      headers: { 'user-agent': 'BroCrew' },
    }).catch((error: unknown) => {
      throw failure(error)
    })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new Error(`the download answered ${String(response.status)}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    const hash = createHash('sha512')
    let received = 0
    const checking = new Transform({
      transform(chunk: Uint8Array, _encoding, done) {
        watch()
        hash.update(chunk)
        received += chunk.byteLength
        if (total > 0) onPercent(Math.min(99, (received / total) * 100))
        done(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      checking,
      createWriteStream(partial, { flags: 'wx' }),
      { signal },
    ).catch((error: unknown) => {
      throw failure(error)
    })
    clearTimeout(timer)
    if (hash.digest('base64') !== sha512) {
      throw new Error(
        'the download did not match the sha512 its release published, so it was deleted',
      )
    }
    const landed = await copyBeside(partial, to)
    onPercent(100)
    return landed
  } finally {
    clearTimeout(timer)
    await rm(partial, { force: true })
  }
}

/** Copy to `to`, or to `name (1).dmg` and so on: an existing file is never replaced. */
async function copyBeside(from: string, to: string): Promise<string> {
  const extension = extname(to)
  const stem = to.slice(0, to.length - extension.length)
  for (let number = 0; number < 100; number += 1) {
    const name = number === 0 ? to : `${stem} (${String(number)})${extension}`
    try {
      await copyFile(from, name, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      // COPYFILE_EXCL means this name was created by this copy, so a partial copy is ours to remove.
      await rm(name, { force: true })
      console.warn(`updates: saving ${name} failed: ${String(error)}`)
      throw new Error(`the download could not be saved to ${dirname(to)}`, { cause: error })
    }
  }
  throw new Error(`the download could not be saved to ${dirname(to)}`)
}
