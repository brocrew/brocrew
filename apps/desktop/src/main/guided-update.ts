import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  type WriteStream,
} from 'node:fs'
import { finished } from 'node:stream/promises'
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
export async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

/** A download that receives nothing for this long has stalled, and ends. */
export const DOWNLOAD_STALLS_AFTER_MS = 60_000

/**
 * Download `url` to `to`, and keep it only if its sha512 is `sha512`. ⚑ Written to a partial file
 * of this process's own and renamed only once it is checked, so a file at `to` is always one that
 * was. ⚑ A file already at `to` whose sha512 matches is kept, and not downloaded again. ⚑ One that
 * receives nothing for {@link DOWNLOAD_STALLS_AFTER_MS} ends, and says so.
 */
export async function downloadChecked(options: {
  readonly url: string
  readonly sha512: string
  readonly to: string
  readonly onPercent: (percent: number) => void
  readonly fetch?: typeof globalThis.fetch
  readonly stallsAfterMs?: number
}): Promise<string> {
  const { url, sha512, to, onPercent } = options
  if (existsSync(to) && (await sha512Of(to)) === sha512) {
    onPercent(100)
    return to
  }
  const stallsAfterMs = options.stallsAfterMs ?? DOWNLOAD_STALLS_AFTER_MS
  const controller = new AbortController()
  let stall: (why: Error) => void = () => {}
  const stalled = new Promise<never>((_resolve, reject) => (stall = reject))
  stalled.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stall(
        new Error(
          `the download stalled: nothing arrived for ${String(Math.round(stallsAfterMs / 1000))} s`,
        ),
      )
      controller.abort()
    }, stallsAfterMs)
  }
  // ⚑ Each wait races the stall, so an answer that never comes ends the same way as a body that
  // stops: whether or not this `fetch` honours its signal.
  const orStall = <T>(waiting: Promise<T>): Promise<T> => Promise.race([waiting, stalled])
  const partial = `${to}.${String(process.pid)}.partial`
  let out: WriteStream | null = null
  watch()
  try {
    const response = await orStall(
      (options.fetch ?? globalThis.fetch)(url, { redirect: 'follow', signal: controller.signal }),
    )
    if (!response.ok || response.body === null) {
      throw new Error(`the download answered ${String(response.status)}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    const hash = createHash('sha512')
    out = createWriteStream(partial)
    const reader = response.body.getReader()
    controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
    let received = 0
    for (;;) {
      const { done, value } = await orStall(reader.read())
      if (done) break
      watch()
      hash.update(value)
      if (!out.write(value)) {
        const writing = out
        await orStall(new Promise<void>((resolve) => writing.once('drain', () => resolve())))
      }
      received += value.byteLength
      if (total > 0) onPercent(Math.min(99, (received / total) * 100))
    }
    out.end()
    await orStall(finished(out))
    if (hash.digest('base64') !== sha512) {
      throw new Error(
        'the download did not match the sha512 its release published, so it was deleted',
      )
    }
  } catch (error) {
    if (out !== null) {
      // ⚑ Closed before it is removed: a stream still opening would make the file again.
      out.destroy()
      await finished(out).catch(() => {})
      rmSync(partial, { force: true })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  renameSync(partial, to)
  onPercent(100)
  return to
}
