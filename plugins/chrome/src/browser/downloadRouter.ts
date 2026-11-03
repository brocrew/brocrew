import fs from 'node:fs'
import { PrivateDownloadFiles } from './privateDownloadFiles.js'
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
  end(completed?: boolean, savedGuid?: string): void
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
  end(completed = false, savedGuid?: string): void {
    if (this.ended) return
    this.ended = true
    this.router.release(this, completed, savedGuid)
  }
}
export interface RouterOptions {
  dir: string
  files?: PrivateDownloadFiles
  session: DownloadSession
  nativeDir: () => string
  fallbackDirs?: () => string[]
  logger?: Logger
  /** False means Chrome owns the native path and history; never move or delete it. */
  privateActive?: () => boolean
  allowUnclaimed: boolean
  quota: UnclaimedDownloadQuota
  onPolicyFailure: () => Promise<void>
}
export class DownloadRouter {
  private readonly files: PrivateDownloadFiles
  private readonly refused = new Set<string>()
  private readonly disposable = new Set<string>()
  private readonly recs = new Map<string, Rec>()
  private readonly origins = new Map<string, boolean>()
  private readonly originWaits = new Map<string, Promise<boolean>>()
  private readonly originResolvers = new Map<string, (owned: boolean) => void>()
  private readonly captures = new Set<CaptureImpl>()
  private decisions: Promise<void> = Promise.resolve()
  private readonly logger: Logger
  constructor(private readonly o: RouterOptions) {
    this.files = o.files ?? new PrivateDownloadFiles(o.dir)
    this.logger = o.logger ?? silentLogger
    o.session.on('Browser.downloadWillBegin', (p) => this.begin(p))
    o.session.on('Browser.downloadProgress', (p) => this.progress(p))
  }
  /** Immutable begin ownership; unknown/evicted GUIDs never authorize artifact cleanup. */
  owns(guid: string): boolean {
    return this.origins.get(guid) === true
  }
  origin(guid: string): Promise<boolean> {
    if (this.origins.has(guid)) return Promise.resolve(this.owns(guid))
    const existing = this.originWaits.get(guid)
    if (existing) return existing
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(guid) || this.originWaits.size >= 500)
      return Promise.resolve(false)
    // Page and browser events use sibling sessions. Wait briefly for the GUID's
    // immutable begin notice; a missing notice never grants cleanup authority.
    const result = new Promise<boolean>((resolve) => {
      const done = (owned: boolean) => {
        clearTimeout(timer)
        this.originWaits.delete(guid)
        this.originResolvers.delete(guid)
        resolve(owned)
      }
      const timer = setTimeout(() => done(false), 1000)
      this.originResolvers.set(guid, done)
    })
    this.originWaits.set(guid, result)
    return result
  }
  capture(frames: FrameIds): Capture {
    const c = new CaptureImpl(frames, this)
    this.captures.add(c)
    return c
  }
  private begin(p: { guid?: unknown; frameId?: unknown; suggestedFilename?: unknown }): void {
    if (typeof p.guid !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(p.guid)) return
    if (this.origins.has(p.guid)) return
    const isPrivate = this.o.privateActive?.() !== false
    this.origins.set(p.guid, isPrivate)
    this.originResolvers.get(p.guid)?.(isPrivate)
    if (this.origins.size > 2000) this.origins.delete(this.origins.keys().next().value!)
    if (!isPrivate) return
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
    const capturesAtStart = [...this.captures]
    rec.decided = this.decisions = this.decisions
      .then(() => this.decide(p.guid as string, rec, capturesAtStart))
      .catch(() => undefined)
  }
  private async decide(guid: string, rec: Rec, captures: readonly CaptureImpl[]): Promise<void> {
    if (rec.state === 'canceled' || this.refused.has(guid)) return
    for (const c of captures) {
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
    if (this.refused.has(guid)) {
      this.cancel(guid, rec)
      return
    }
    if (rec.unclaimed || rec.state === 'canceled') return
    if (!this.o.allowUnclaimed || !this.o.quota.take()) {
      this.cancel(guid, rec)
      return
    }
    rec.unclaimed = true
  }
  private markDisposable(guid: string): void {
    this.disposable.add(guid)
    if (this.disposable.size > 2000) this.disposable.delete(this.disposable.values().next().value!)
  }
  private cancel(guid: string, rec = this.recs.get(guid)): void {
    if (!this.owns(guid)) return
    this.refused.add(guid)
    if (this.refused.size > 2000) this.refused.delete(this.refused.values().next().value!)
    const file = path.join(this.o.dir, guid)
    // Do not use a GUID alone to cancel a possibly native download. A verified
    // private partial/full file is required; later progress can supply that proof.
    if (!this.files.file(file) && !this.files.file(file + '.crdownload')) return
    this.refused.delete(guid)
    this.markDisposable(guid)
    if (rec) rec.state = 'canceled'
    this.recs.delete(guid)
    void this.o.session
      .send('Browser.cancelDownload', { guid })
      .then(() => {
        this.files.remove(file)
        this.files.remove(file + '.crdownload')
      })
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
    if (this.refused.has(p.guid)) {
      this.cancel(p.guid, rec)
      return
    }
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
  release(c: CaptureImpl, completed = false, savedGuid?: string): void {
    this.captures.delete(c)
    for (const [guid, rec] of this.recs) {
      if (rec.owner !== c) continue
      rec.owner = null
      // Only the saved file's claim succeeded. A different download must still
      // pass the unattended policy, even if the tool saved an older queued file.
      if (completed && guid === savedGuid) {
        this.markDisposable(guid)
        // Late events still enforce the size cap until this file completes.
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
    // The matching tool has saved this file; remove only its staging copy.
    try {
      this.files.remove(path.join(this.o.dir, guid))
    } catch {
      void this.o
        .onPolicyFailure()
        .catch(() => this.logger.warn('download policy could not close the owned browser'))
    }
  }
  sweep(): ReadonlySet<string> {
    for (const resolve of [...this.originResolvers.values()]) resolve(false)
    const kept = new Set<string>()
    for (const [guid, rec] of this.recs) {
      if (rec.state !== 'completed' || rec.owner || !rec.unclaimed) continue
      const src = path.join(this.o.dir, guid)
      if (rec.dest) {
        if (fs.existsSync(src) && !this.files.remove(src)) kept.add(guid)
        continue
      }
      if (this.placeSync(src, rec.name)) rec.swept = true
      else kept.add(guid)
    }
    this.recs.clear()
    return kept
  }
  cleanupStage(kept: ReadonlySet<string>): ReadonlySet<string> {
    if (!this.files.directory(this.o.dir)) return new Set(['unverified-directory'])
    for (const name of fs.readdirSync(this.o.dir)) {
      const guid = name.endsWith('.crdownload') ? name.slice(0, -11) : name
      if (!kept.has(name) && this.disposable.has(guid))
        this.files.remove(path.join(this.o.dir, name))
    }
    const remaining = new Set(fs.readdirSync(this.o.dir))
    if (remaining.size === 0) this.files.removeEmpty(this.o.dir)
    return remaining
  }
  private dirs(): string[] {
    return [this.o.nativeDir(), ...(this.o.fallbackDirs?.() ?? [])]
  }
  private place(guid: string, rec: Rec): void {
    if (
      rec.state === 'canceled' ||
      this.refused.has(guid) ||
      !rec.unclaimed ||
      rec.placing ||
      rec.dest
    )
      return
    rec.placing = true
    const src = path.join(this.o.dir, guid)
    if (fs.existsSync(src) && !this.files.file(src)) {
      rec.placing = false
      return
    }
    if (fs.existsSync(src) && fs.statSync(src).size > MAX_DOWNLOAD_BYTES) {
      this.cancel(guid, rec)
      return
    }
    void (async () => {
      for (const dir of this.dirs()) {
        try {
          const dest = await placeFile(
            src,
            dir,
            rec.name,
            (d) => {
              rec.dest = d
            },
            this.files,
          )
          if (!dest) {
            rec.placing = false
            return
          }
          if (rec.swept) this.files.remove(dest)
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
    if (!this.files.file(src)) return false
    if (fs.statSync(src).size > MAX_DOWNLOAD_BYTES) {
      this.files.remove(src)
      return true
    }
    for (const dir of this.dirs()) {
      try {
        placeFileSync(src, dir, name, this.files)
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
async function copyInto(src: string, dest: string, files: PrivateDownloadFiles): Promise<void> {
  const tmp = tempName(path.dirname(dest))
  try {
    files.requireFile(src)
    files.prepare(path.dirname(dest))
    await fs.promises.copyFile(src, tmp, fs.constants.COPYFILE_EXCL)
    files.requireFile(tmp)
    const fh = await fs.promises.open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      files.requireFile(tmp)
      files.prepare(path.dirname(dest))
      await fs.promises.link(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      files.requireFile(tmp)
      files.prepare(path.dirname(dest))
      await fs.promises.rename(tmp, dest)
    }
  } finally {
    files.remove(tmp)
  }
}
function copyIntoSync(src: string, dest: string, files: PrivateDownloadFiles): void {
  const tmp = tempName(path.dirname(dest))
  try {
    files.requireFile(src)
    files.prepare(path.dirname(dest))
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_EXCL)
    files.requireFile(tmp)
    const fd = fs.openSync(tmp, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    try {
      files.requireFile(tmp)
      files.prepare(path.dirname(dest))
      fs.linkSync(tmp, dest)
    } catch (e) {
      if (code(e) === 'EEXIST') throw e
      if (fs.existsSync(dest)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      files.requireFile(tmp)
      files.prepare(path.dirname(dest))
      fs.renameSync(tmp, dest)
    }
  } finally {
    files.remove(tmp)
  }
}
export async function placeFile(
  src: string,
  dir: string,
  suggested: string,
  placed?: (dest: string) => void,
  files = new PrivateDownloadFiles(path.dirname(src)),
): Promise<string | null> {
  if (!fs.existsSync(src)) return null
  files.requireFile(src)
  files.prepare(dir)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        files.requireFile(src)
        files.prepare(dir)
        await fs.promises.link(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        await copyInto(src, dest, files)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    placed?.(dest)
    files.remove(src)
    return dest
  }
  throw new Error('no free file name')
}
export function placeFileSync(
  src: string,
  dir: string,
  suggested: string,
  files = new PrivateDownloadFiles(path.dirname(src)),
): string | null {
  if (!fs.existsSync(src)) return null
  files.requireFile(src)
  files.prepare(dir)
  for (const name of candidates(userFileName(suggested))) {
    const dest = path.join(dir, name)
    try {
      try {
        files.requireFile(src)
        files.prepare(dir)
        fs.linkSync(src, dest)
      } catch (e) {
        if (!CROSS_DEVICE.has(code(e))) throw e
        copyIntoSync(src, dest, files)
      }
    } catch (e) {
      if (code(e) === 'EEXIST') continue
      throw e
    }
    files.remove(src)
    return dest
  }
  throw new Error('no free file name')
}
