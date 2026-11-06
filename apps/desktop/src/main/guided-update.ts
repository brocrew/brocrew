import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readFileSync,
  read,
  write,
  linkSync,
  lstatSync,
  readdirSync,
  unlinkSync,
  rmSync,
  type WriteStream,
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import { aStagingName, createFreshFile } from '@brobot2/runtime/provider-home'
import type { FoundUpdate, ReleaseFile } from './updates'

/**
 * 🔴 **W4.109 · B1 — the Mac's update, guided**: an app signed ad hoc cannot replace itself (its
 * designated requirement is its own hash, so Squirrel.Mac refuses every new build), so BroBot
 * downloads the disk image, checks it against the sha512 its release published, and opens it for
 * the person to drag into Applications.
 *
 * ⚑ Electron-free: the feed is read from the app's own `app-update.yml`, and the download takes any
 * `fetch`, so a throwaway local server stands in for GitHub in the tests.
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
  const field = (key: string): string | null => {
    const value = new RegExp(`^${key}: ?(.*)$`, 'm').exec(text)?.[1]?.trim()
    return value === undefined || value === '' ? null : value.replace(/^['"]|['"]$/g, '')
  }
  const provider = field('provider')
  if (provider === 'github') {
    const owner = field('owner')
    const repo = field('repo')
    if (owner === null || repo === null) return null
    return field('private') === 'true'
      ? { provider, owner, repo, private: true }
      : { provider, owner, repo }
  }
  if (provider === 'generic') {
    const url = field('url')
    return url === null ? null : { provider, url }
  }
  return null
}

/** The feed of the app at `resources`, or null for a build with none (a development or beta build). */
export function feedOfTheApp(appUpdateYml: string): ReleaseFeed | null {
  if (!existsSync(appUpdateYml)) return null
  return readFeed(readFileSync(appUpdateYml, 'utf8'))
}

/** Where a file of a release is downloaded from. ⚑ GitHub's releases are tagged `v<version>`. */
export function downloadUrlOf(feed: ReleaseFeed, version: string, file: string): string {
  if (feed.provider === 'github') {
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(file)}`
  }
  return new URL(encodeURIComponent(file), feed.url.endsWith('/') ? feed.url : `${feed.url}/`).href
}

/**
 * The token a private GitHub feed is read with, by electron-updater's own rule: only when the build
 * says the feed is private, from `GH_TOKEN`, else `GITHUB_TOKEN`. Null for every other feed, and for
 * a private one with no token, which is then read as a public one. ⚑ A `token:` in the file, which
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
 * token. ⛔ The token goes to `api.github.com` and nowhere else, whatever address the API names, and
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

/** A file's sha512, as release files publish it: base64. ⚑ Read as a stream, never whole. */
export async function sha512Of(file: string, signal?: AbortSignal): Promise<string> {
  const stream = createReadStream(file, { signal })
  const hash = createHash('sha512')
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

const DOWNLOAD_KEPT =
  'the saved download did not pass its check. It was left in Downloads; you can delete it. Try the update again.'

/** Copy through the held files, including short writes, without reopening either pathname. */
async function copyOpened(from: number, to: number, signal: AbortSignal): Promise<void> {
  const buffer = Buffer.allocUnsafe(256 * 1024)
  let position = 0
  for (;;) {
    signal.throwIfAborted()
    const count = await new Promise<number>((resolve, reject) => {
      read(from, buffer, 0, buffer.length, position, (error, count) => {
        if (error !== null) reject(error)
        else resolve(count)
      })
    })
    if (count === 0) return
    let written = 0
    while (written < count) {
      signal.throwIfAborted()
      const length = await new Promise<number>((resolve, reject) => {
        write(to, buffer, written, count - written, position + written, (error, length) => {
          if (error !== null) reject(error)
          else resolve(length)
        })
      })
      if (length === 0)
        throw new Error('The staged download could not be copied: write returned zero bytes.')
      written += length
    }
    position += count
  }
}

/** Publish only at an unused name; an error never removes anything from the destination folder. */
async function placeDownload(
  partial: string,
  to: string,
  checkedFd: number,
  signal: AbortSignal,
  placed: (name: string) => void,
): Promise<string> {
  const extension = extname(to)
  const stem = to.slice(0, to.length - extension.length)
  let collision: unknown
  for (let number = 0; number < 100; number += 1) {
    const name = number === 0 ? to : `${stem} (${number})${extension}`
    signal.throwIfAborted()
    try {
      linkSync(partial, name)
      placed(name)
      return name
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        collision = error
        continue
      }
      if (code !== 'EXDEV') throw error
    }
    let writer: number
    try {
      writer = createFreshFile(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      collision = error
      continue
    }
    placed(name)
    try {
      await copyOpened(checkedFd, writer, signal)
      return name
    } finally {
      closeSync(writer)
    }
  }
  throw collision
}

/** Clear only direct files and links left in private staging; never descend through a link. */
export function clearUpdateStaging(userData: string): void {
  const updates = join(userData, 'updates')
  const staging = join(updates, 'staging')
  try {
    for (const folder of [updates, staging]) {
      const entry = lstatSync(folder)
      if (entry.isSymbolicLink() || !entry.isDirectory()) return
    }
    for (const name of readdirSync(staging)) {
      const path = join(staging, name)
      try {
        const entry = lstatSync(path)
        if (entry.isFile() || entry.isSymbolicLink()) unlinkSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn('BroCrew could not clear update staging:', error)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('BroCrew could not clear update staging:', error)
  }
}

/** A download that receives nothing for this long has stalled, and ends. */
export const DOWNLOAD_STALLS_AFTER_MS = 60_000

/**
 * Check the downloaded stream against release sha512, then publish from private staging.
 * An existing regular file with the right checksum is reused; otherwise it is kept and the
 * download takes an unused numbered name. A stalled or cancelled download removes only its private partial.
 */
export async function downloadChecked(options: {
  readonly url: string
  readonly sha512: string
  readonly to: string
  /** An existing folder owned by the app, never the shared destination folder. */
  readonly stagingFolder: string
  readonly onPercent: (percent: number) => void
  readonly fetch?: typeof globalThis.fetch
  readonly stallsAfterMs?: number
  readonly signal?: AbortSignal
}): Promise<string> {
  const { url, sha512, to, onPercent } = options
  options.signal?.throwIfAborted()
  let alreadyChecked = false
  try {
    alreadyChecked = existsSync(to) && (await sha512Of(to, options.signal)) === sha512
  } catch {
    options.signal?.throwIfAborted()
    // A linked or unreadable destination stays untouched; the download gets another name.
  }
  options.signal?.throwIfAborted()
  if (alreadyChecked) {
    onPercent(100)
    options.signal?.throwIfAborted()
    return to
  }
  const stallsAfterMs = options.stallsAfterMs ?? DOWNLOAD_STALLS_AFTER_MS
  const controller = new AbortController()
  let interrupt: (why: unknown) => void = () => {}
  const interrupted = new Promise<never>((_resolve, reject) => (interrupt = reject))
  interrupted.catch(() => {})
  const stop = (why: unknown): void => {
    interrupt(why)
    controller.abort(why)
  }
  const cancel = (): void => stop(options.signal?.reason)
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stop(
        new Error(
          `the download stalled: nothing arrived for ${String(Math.round(stallsAfterMs / 1000))} s`,
        ),
      )
    }, stallsAfterMs)
  }
  const orStopped = <T>(waiting: Promise<T>): Promise<T> => {
    controller.signal.throwIfAborted()
    return Promise.race([waiting, interrupted])
  }
  const partial = `${aStagingName(join(options.stagingFolder, basename(to)))}.partial`
  let stageCreated = false
  let placed: string | null = null
  let checkedFd: number | null = null
  let unclaimedWriter: number | null = null
  let out: WriteStream | null = null
  let written: Promise<void> | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  watch()
  try {
    controller.signal.throwIfAborted()
    const response = await orStopped(
      (options.fetch ?? globalThis.fetch)(url, { redirect: 'follow', signal: controller.signal }),
    )
    if (!response.ok || response.body === null) {
      throw new Error(`the download answered ${String(response.status)}`)
    }
    reader = response.body.getReader()
    controller.signal.addEventListener(
      'abort',
      () => void reader?.cancel(controller.signal.reason).catch(() => {}),
      { once: true },
    )
    const fd = createFreshFile(partial)
    unclaimedWriter = fd
    stageCreated = true
    out = createWriteStream('', { fd, autoClose: true })
    unclaimedWriter = null
    // Observe write errors while waiting for the network, too.
    written = finished(out)
    void written.catch(stop)
    const total = Number(response.headers.get('content-length') ?? 0)
    const hash = createHash('sha512')
    let received = 0
    for (;;) {
      const { done, value } = await orStopped(reader.read())
      if (done) break
      watch()
      hash.update(value)
      if (!out.write(value)) {
        const writing = out
        await orStopped(new Promise<void>((resolve) => writing.once('drain', () => resolve())))
      }
      received += value.byteLength
      if (total > 0) onPercent(Math.min(99, (received / total) * 100))
    }
    out.end()
    await orStopped(written)
    if (hash.digest('base64') !== sha512) {
      throw new Error(
        'the download did not match the sha512 its release published, so it was deleted',
      )
    }
    controller.signal.throwIfAborted()
    checkedFd = openSync(partial, constants.O_RDONLY)
    const publication = await placeDownload(partial, to, checkedFd, controller.signal, (name) => {
      placed = name
    })
    onPercent(100)
    controller.signal.throwIfAborted()
    rmSync(partial, { force: true })
    stageCreated = false
    return publication
  } catch (error) {
    controller.abort(error)
    if (out !== null) {
      out.destroy()
      await written?.catch(() => {})
    }
    if (placed !== null) {
      const kept = new Error(`${DOWNLOAD_KEPT} ${placed}: ${String(error)}`, { cause: error })
      if (error instanceof Error && error.name !== 'Error') kept.name = error.name
      throw kept
    }
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error(`${to}: ${String(error)}`, { cause: error })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    try {
      reader?.releaseLock()
    } finally {
      try {
        if (stageCreated) rmSync(partial, { force: true })
      } finally {
        try {
          if (checkedFd !== null) closeSync(checkedFd)
        } finally {
          if (unclaimedWriter !== null) closeSync(unclaimedWriter)
        }
      }
    }
  }
}
