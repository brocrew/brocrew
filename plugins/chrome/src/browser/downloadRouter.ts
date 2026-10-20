import fs from 'node:fs'
import { privateFolder } from '../privatePaths.js'
import path from 'node:path'
import type { Logger } from '../logger.js'
import { silentLogger } from '../logger.js'
import { MAX_DOWNLOAD_BYTES, WINDOWS_DEVICE } from '../files.js'
export interface DownloadSession {
  send(method: 'Browser.cancelDownload', params: { guid: string }): Promise<unknown>
  on(event: string, cb: (params: Record<string, unknown>) => void): unknown
}
export type FrameIds = () => Promise<ReadonlySet<string>>
export interface Capture {
  end(completed?: boolean): void
}
interface Rec {
  name: string
  frameId: string
  owner: CaptureImpl | null
  state: 'running' | 'completed' | 'canceled'
  unclaimed: boolean
  releasedAfterSuccess: boolean
  placing: boolean
  dest: string | null
  swept: boolean
  decided: Promise<void>
}
// Shared across browser generations, separately for each profile. Claimed tool downloads
// retain their existing limit; only unattended page downloads consume this allowance.
export const MAX_UNCLAIMED_PER_HOUR = 20
const HOUR_MS = 60 * 60 * 1000
export class UnclaimedDownloadQuota {
  private admitted: number[] = []
  constructor(private readonly now: () => number = Date.now) {}
  take(): boolean {
    const now = this.now()
    this.admitted = this.admitted.filter((at) => at > now - HOUR_MS)
    if (this.admitted.length >= MAX_UNCLAIMED_PER_HOUR) return false
    this.admitted.push(now)
    return true
  }
}
const MAX_RECORDS = 500
const MAX_NAME_BYTES = 200
class CaptureImpl implements Capture {
  taken = false
  ended = false
  constructor(
    readonly frames: FrameIds,
    private readonly router: DownloadRouter,
  ) {}
  end(completed = false): void {
    if (this.ended) return
    this.ended = true
    this.router.release(this, completed)
  }
}
export interface RouterOptions {
  dir: string
  session: DownloadSession
  nativeDir: () => string
  fallbackDirs?: () => string[]
  logger?: Logger
  allowUnclaimed: boolean
  quota: UnclaimedDownloadQuota
  onPolicyFailure: () => Promise<void>
}
export class DownloadRouter {
  private readonly recs = new Map<string, Rec>()
  private readonly captures = new Set<CaptureImpl>()
  private decisions: Promise<void> = Promise.resolve()
  private readonly logger: Logger
  constructor(private readonly o: RouterOptions) {
    this.logger = o.logger ?? silentLogger
    o.session.on('Browser.downloadWillBegin', (p) => this.begin(p))
    o.session.on('Browser.downloadProgress', (p) => this.progress(p))
  }
  capture(frames: FrameIds): Capture {
    const c = new CaptureImpl(frames, this)
    this.captures.add(c)
    return c
  }
  private begin(p: { guid?: unknown; frameId?: unknown; suggestedFilename?: unknown }): void {
    if (typeof p.guid !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(p.guid)) return
    if (this.recs.has(p.guid)) return
    if (this.recs.size >= MAX_RECORDS) {
      this.cancel(p.guid)
      return
    }
    const rec: Rec = {
      name: typeof p.suggestedFilename === 'string' ? p.suggestedFilename : '',
      frameId: typeof p.frameId === 'string' ? p.frameId : '',
      owner: null,
      state: 'running',
      unclaimed: false,
      releasedAfterSuccess: false,
      placing: false,
      dest: null,
      swept: false,
      decided: Promise.resolve(),
    }
    this.recs.set(p.guid, rec)
    rec.decided = this.decisions = this.decisions
      .then(() => this.decide(p.guid as string, rec))
      .catch(() => undefined)
  }
  private async decide(guid: string, rec: Rec): Promise<void> {
    if (rec.state === 'canceled') return
    for (const c of this.captures) {
      if (c.taken || c.ended) continue
      let ids: ReadonlySet<string>
      try {
        ids = await c.frames()
      } catch {
        continue
      }
      if (this.recs.get(guid) !== rec) return
      if (c.ended || !ids.has(rec.frameId)) continue
      c.taken = true
      rec.owner = c
      return
    }
    this.admitUnclaimed(guid, rec)
  }
  private admitUnclaimed(guid: string, rec: Rec): void {
    if (rec.unclaimed || rec.state === 'canceled') return
    if (!this.o.allowUnclaimed || !this.o.quota.take()) {
      this.cancel(guid, rec)
      return
    }
    rec.unclaimed = true
  }
  private cancel(guid: string, rec = this.recs.get(guid)): void {
    if (rec) rec.state = 'canceled'
    this.recs.delete(guid)
    // Cancellation failure ends only this owned browser: never keep downloading
    // after losing enforcement, and never fall back to Playwright's defaults.
    void this.o.session
      .send('Browser.cancelDownload', { guid })
      .then(() => fs.promises.rm(path.join(this.o.dir, guid), { force: true }))
      .catch(() => this.o.onPolicyFailure())
      .catch(() => this.logger.warn('download policy could not close the owned browser'))
  }
  private progress(p: {
    guid?: unknown
    state?: unknown
    receivedBytes?: unknown
    totalBytes?: unknown
  }): void {
    if (typeof p.guid !== 'string') return
    const rec = this.recs.get(p.guid)
    if (!rec) return
    const guid = p.guid
    if (
      [p.receivedBytes, p.totalBytes].some(
        (n) => typeof n === 'number' && (!Number.isFinite(n) || n < 0 || n > MAX_DOWNLOAD_BYTES),
      )
    ) {
      this.cancel(guid, rec)
      return
    }
    if (p.state === 'canceled') {
      rec.state = 'canceled'
      this.recs.delete(guid)
      return
    }
    if (p.state !== 'completed') return
    rec.state = 'completed'
    if (rec.releasedAfterSuccess) {
      this.discardCompleted(guid, rec)
      return
    }
    void rec.decided.then(() => {
      if (rec.state !== 'canceled' && !rec.owner) this.place(guid, rec)
    })
  }
  release(c: CaptureImpl, completed = false): void {
    this.captures.delete(c)
    for (const [guid, rec] of this.recs) {
      if (rec.owner !== c) continue
      rec.owner = null
      // Success may refer to a previously queued download, not this claim.
      // Keep monitoring a running claim until Chrome proves its completion;
      // only then can it be forgotten. Late events can still trip the size cap.
      if (completed) {
        rec.releasedAfterSuccess = true
        if (rec.state === 'completed') this.discardCompleted(guid, rec)
        continue
      }
      if (!this.o.allowUnclaimed && rec.state === 'completed') {
        this.discardCompleted(guid, rec)
        continue
      }
      // A failed tool may leave a user download in a visible window. An
      // unfinished headless download must stop as soon as the call ends.
      this.admitUnclaimed(guid, rec)
      if (rec.state === 'completed') this.place(guid, rec)
    }
  }
  private discardCompleted(guid: string, rec: Rec): void {
    rec.state = 'canceled'
    this.recs.delete(guid)
    // The successful tool has already saved its result. A different captured
    // file is discarded, rather than becoming an unclaimed quota bypass.
    void fs.promises
      .rm(path.join(this.o.dir, guid), { force: true })
      .catch(() => this.o.onPolicyFailure())
      .catch(() => this.logger.warn('download policy could not close the owned browser'))
  }
  sweep(): ReadonlySet<string> {
    const kept = new Set<string>()
    for (const [guid, rec] of this.recs) {
      if (rec.state !== 'completed' || rec.owner || !rec.unclaimed) continue
      const src = path.join(this.o.dir, guid)
      if (rec.dest) {
        fs.rmSync(src, { force: true })
        continue
      }
      if (this.placeSync(src, rec.name)) rec.swept = true
      else kept.add(guid)
    }
    this.recs.clear()
    return kept
  }
  private dirs(): string[] {
    return [this.o.nativeDir(), ...(this.o.fallbackDirs?.() ?? [])]
  }
  private place(guid: string, rec: Rec): void {
    if (rec.state === 'canceled' || !rec.unclaimed || rec.placing || rec.dest) return
    rec.placing = true
    const src = path.join(this.o.dir, guid)
    if (fs.existsSync(src) && fs.statSync(src).size > MAX_DOWNLOAD_BYTES) {
      this.cancel(guid, rec)
      return
    }
    void (async () => {
      for (const dir of this.dirs()) {
        try {
          const dest = await placeFile(src, dir, rec.name, (d) => {
            rec.dest = d
          })
          if (dest && rec.swept) await fs.promises.rm(dest, { force: true })
          this.recs.delete(guid)
          this.logger.info('download kept for the user', { guid: guid.slice(0, 8) })
          return
        } catch (e) {
          if (!fs.existsSync(src)) {
            this.recs.delete(guid)
            return
          }
          if (rec.dest) {
            this.recs.delete(guid)
            return
          }
          this.logger.warn('a download of the user could not be moved to a download folder', {
            errorCode: code(e),
          })
        }
      }
      rec.placing = false
      this.logger.warn(
        'a download of the user stays in the staging folder until the browser ends',
        { guid: guid.slice(0, 8) },
      )
    })()
  }
  private placeSync(src: string, name: string): boolean {
    if (!fs.existsSync(src)) return true
    if (fs.statSync(src).size > MAX_DOWNLOAD_BYTES) {
      fs.rmSync(src, { force: true })
      return true
    }
    for (const dir of this.dirs()) {
      try {
        placeFileSync(src, dir, name)
        return true
      } catch (e) {
        this.logger.warn('a download of the user could not be moved to a download folder', {
          errorCode: code(e),
        })
      }
    }
    return false
  }
}
export function userFileName(
  suggested: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = suggested.split(/[\\/]/).pop() ?? ''
  let name = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- Strip filename control characters.
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
  if (name === '') name = 'download'
  if (platform === 'win32' && WINDOWS_DEVICE.test(name)) name = `_${name}`
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    const ext = path.extname(name)
    const keep = ext.length < 20 ? ext : ''
    let stem = name.slice(0, name.length - keep.length)
    while (Buffer.byteLength(stem) + Buffer.byteLength(keep) > MAX_NAME_BYTES)
      stem = stem.slice(0, -1)
    name = (stem + keep).replace(/[. ]+$/, '') || 'download'
  }
  return name
}
function* candidates(name: string): Generator<string> {
  yield name
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 10000; i++) yield `${stem} (${i})${ext}`
}
const CROSS_DEVICE = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'])
const code = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? ''
const tempName = (dir: string): string =>
  path.join(dir, `.agent-chrome-${process.pid}-${Math.random().toString(36).slice(2, 10)}.part`)
async function copyInto(src: string, dest: string): Promise<void> {
  const tmp = tempName(path.dirname(dest))
  try {
    await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_EXCL)
    const fh = await fs.promises.open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await fs.promises.link(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      await fs.promises.rename(tmp, dest)
    }
  } finally {
    await fs.promises.rm(tmp, { force: true })
  }
}
function copyIntoSync(src: string, dest: string): void {
  const tmp = tempName(path.dirname(dest))
  try {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL)
    const fd = fs.openSync(tmp, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    try {
      fs.linkSync(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      fs.renameSync(tmp, dest)
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
export async function placeFile(
  src: string,
  dir: string,
  suggested: string,
  placed?: (dest: string) => void,
): Promise<string | null> {
  if (!fs.existsSync(src)) return null
  privateFolder(path.dirname(dir), dir, true)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        await fs.promises.link(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        await copyInto(src, dest)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    placed?.(dest)
    await fs.promises.rm(src, { force: true })
    return dest
  }
  throw new Error('no free file name')
}
export function placeFileSync(src: string, dir: string, suggested: string): string | null {
  if (!fs.existsSync(src)) return null
  privateFolder(path.dirname(dir), dir, true)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        fs.linkSync(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        copyIntoSync(src, dest)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    fs.rmSync(src, { force: true })
    return dest
  }
  throw new Error('no free file name')
}
