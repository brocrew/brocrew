import { checkToolAuthorization } from './authorization.js'
import { PrivateDownloadFiles } from '../browser/privateDownloadFiles.js'
import { privateFolder } from '../privatePaths.js'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import type { BrowserContext, Download } from 'playwright-core'
import { MAX_DOWNLOAD_BYTES, dayFolder, reserveFile, sanitizeDownloadName } from '../files.js'
import { ToolError } from './schema.js'
import { checkDownloadUrl, raceTimeout } from './common.js'
import type { ToolDeps } from './common.js'
import type { TabState } from '../tabs.js'

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
export function dropPending(tab: TabState, download: Download): void {
  tab.pendingDownloads = tab.pendingDownloads.filter((d) => d.download !== download)
}
class DownloadTooLarge extends Error {}
const MAX_REDIRECTS = 10
function downloadCounter(deps: ToolDeps) {
  let bytes = 0
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        checkToolAuthorization(deps)
      } catch (error) {
        cb(error as Error)
        return
      }
      bytes += chunk.length
      if (chunk.length > 0) deps.activity?.('download-received')
      if (bytes > MAX_DOWNLOAD_BYTES) cb(new DownloadTooLarge())
      else cb(null, chunk)
    },
  })
  return { cap, bytes: () => bytes }
}
export async function fetchToDisk(
  deps: ToolDeps,
  ctx: BrowserContext,
  start: string,
  ms: number | undefined,
): Promise<Record<string, unknown>> {
  const explicit = ms === undefined ? undefined : AbortSignal.timeout(ms)
  const signal =
    explicit && deps.signal ? AbortSignal.any([explicit, deps.signal]) : (explicit ?? deps.signal)
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const cookie = (await ctx.cookies(url)).map((c) => `${c.name}=${c.value}`).join('; ')
    checkToolAuthorization(deps)
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: cookie ? { cookie } : {},
    })
    try {
      checkToolAuthorization(deps)
    } catch (error) {
      await res.body?.cancel().catch(() => undefined)
      throw error
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => undefined)
      url = checkDownloadUrl(new URL(res.headers.get('location') as string, url).href)
      continue
    }
    try {
      if (!res.ok || !res.body) throw new ToolError(`the server answered ${res.status}`)
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES)
        throw new ToolError('the file is larger than 200 MB and was not saved')
      const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
        res.headers.get('content-disposition') ?? '',
      )?.[1]
      let urlName = ''
      try {
        urlName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
      } catch {
        /* Continue without this optional result. */
      }
      const dir = path.join(deps.downloadsRoot, dayFolder((deps.now ?? (() => new Date()))()))
      privateFolder(path.dirname(deps.downloadsRoot), deps.downloadsRoot, true)
      privateFolder(deps.downloadsRoot, dir, true)
      const privateFiles = new PrivateDownloadFiles(deps.downloadsRoot)
      const { fd, target } = reserveFile(
        dir,
        sanitizeDownloadName(disposition ? safeDecode(disposition) : urlName),
      )
      const received = downloadCounter(deps)
      try {
        await pipeline(
          Readable.fromWeb(res.body as never),
          received.cap,
          fs.createWriteStream(target, { fd }),
        )
        checkToolAuthorization(deps)
        deps.activity?.('download-saved')
      } catch (e) {
        privateFiles.remove(target)
        if (e instanceof DownloadTooLarge)
          throw new ToolError('the file is larger than 200 MB and was discarded')
        throw e
      }
      return {
        path: target,
        bytes: received.bytes(),
        status: res.status,
        contentType: res.headers.get('content-type'),
      }
    } finally {
      await res.body?.cancel().catch(() => undefined)
    }
  }
  throw new ToolError('too many redirects')
}
function chromeNameMatches(wanted: string, found: string): boolean {
  if (found === wanted) return true
  const ext = path.extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  return (
    found.startsWith(`${stem} (`) &&
    found.endsWith(`)${ext}`) &&
    /^\d{1,4}$/.test(found.slice(stem.length + 2, found.length - ext.length - 1))
  )
}
function nativeDownload(
  deps: ToolDeps,
  suggested: string,
  startedAt: number,
): Record<string, unknown> {
  const dir = deps.nativeDownloads ?? deps.downloadsRoot
  privateFolder(deps.downloadsRoot, dir)
  const privateFiles = new PrivateDownloadFiles(deps.downloadsRoot)
  let best: {
    target: string
    bytes: number
    mtime: number
  } | null = null
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!chromeNameMatches(suggested, f)) continue
      const target = path.join(dir, f)
      if (!privateFiles.file(target)) continue
      const st = fs.statSync(target)
      if (st.isFile() && st.mtimeMs >= startedAt - 2000 && (!best || st.mtimeMs > best.mtime))
        best = { target, bytes: st.size, mtime: st.mtimeMs }
    }
  } catch {
    /* Continue without this optional result. */
  }
  if (!best)
    throw new ToolError(
      'Chrome saved the download itself, but the file was not found in the plugin downloads folder',
    )
  return { path: best.target, bytes: best.bytes, savedBy: 'chrome' }
}
export async function saveDownload(
  deps: ToolDeps,
  profile: string,
  download: Download,
  ms: number,
  startedAt: number,
  savedFile?: (file: string) => void,
  completionMs?: number,
): Promise<Record<string, unknown>> {
  if (
    deps.browser.downloadIsPrivate &&
    !(await raceTimeout(deps.browser.downloadIsPrivate(profile, download), ms))
  )
    throw new ToolError('the download failed')
  let tmp: string | null
  try {
    tmp = await (completionMs === undefined
      ? download.path()
      : raceTimeout(download.path(), completionMs))
    checkToolAuthorization(deps)
  } catch (e) {
    await deps.browser.cancelPrivateDownload?.(profile, download).catch(() => undefined)
    throw e
  }
  if (!tmp) throw new ToolError('the download failed')
  if (!fs.existsSync(tmp)) return nativeDownload(deps, download.suggestedFilename(), startedAt)
  if (deps.browser.downloadFileIsPrivate?.(profile, tmp) === false)
    throw new ToolError('the download failed')
  const tooLarge = new ToolError('the download is larger than 200 MB and was discarded')
  let copied = false
  try {
    if (fs.statSync(tmp).size > MAX_DOWNLOAD_BYTES) throw tooLarge
    const source = await download.createReadStream()
    checkToolAuthorization(deps)
    if (!source) throw new ToolError('the download failed')
    const dir = path.join(deps.downloadsRoot, dayFolder((deps.now ?? (() => new Date()))()))
    privateFolder(path.dirname(deps.downloadsRoot), deps.downloadsRoot, true)
    privateFolder(deps.downloadsRoot, dir, true)
    const privateFiles = new PrivateDownloadFiles(deps.downloadsRoot)
    const { fd, target } = reserveFile(dir, sanitizeDownloadName(download.suggestedFilename()))
    const received = downloadCounter(deps)
    try {
      await pipeline(source, received.cap, fs.createWriteStream(target, { fd }))
      checkToolAuthorization(deps)
      deps.activity?.('download-saved')
    } catch (e) {
      privateFiles.remove(target)
      throw e instanceof DownloadTooLarge ? tooLarge : e
    }
    savedFile?.(tmp)
    copied = true
    return { path: target, bytes: received.bytes() }
  } finally {
    if (copied) await deps.browser.deletePrivateDownload?.(profile, download).catch(() => undefined)
  }
}
