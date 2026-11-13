import { ChromiumWindows } from '../shared/browser/chromiumWindows.js'
import { BrocrewHelper, offInLastSession } from './brocrewHelper.js'
import type { HelperSwitch } from '../profiles/sharedTypes.js'
import type { HelperState } from './brocrewHelper.js'
import { privateFolder } from '../privatePaths.js'
import { assertOwnProfileDir } from '../shared/browser/launchGuard.js'
import fs from 'node:fs'
import { open as openFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, CDPSession, Page, Download } from 'playwright-core'
import { launchPersistentChromium } from '../shared/browser/browser-launch.js'
import type { ChromiumLaunchOptions } from '../shared/browser/browser-launch.js'
import { createKeyedSerializer, createTransitionBarrier } from '../shared/browser/browser-lease.js'
import type { KeyedSerializer, TransitionBarrier } from '../shared/browser/browser-lease.js'
import { OWN_SIGNALS, browserChoice, launchTarget } from '../shared/browser/launchConfig.js'
import type { BrowserChoice } from '../shared/browser/launchConfig.js'
import { allPagesClosed } from '../shared/browser/pagesClosed.js'
import type { Logger } from '../logger.js'
import { silentLogger } from '../logger.js'
import { settledWithin } from '../settled.js'
import { launchArgs } from './launchArgs.js'
import { PrivateDownloadFiles } from './privateDownloadFiles.js'
import { DownloadRouter, UnclaimedDownloadQuota } from './downloadRouter.js'
import {
  BROWSER_MISSING,
  BrowserNotFoundError,
  ProfileInUseError,
  fenceBrowserHandles,
  unwrapBrowserHandle,
} from './profileBrowser.js'
import type { ProfileBrowser } from './profileBrowser.js'
import {
  browserPidsOf,
  commandOfPid,
  endBrowsersOf,
  lockfileBusy,
  processList,
} from './processes.js'
import type { EndDeps, Platform } from './processes.js'
export const LOCK_WAIT_MS = 5000
export const CLOSE_MS = 10000
export const EXIT_GRACE_MS = 1500
export const KILL_GRACE_MS = 3000
export const WAIT_POLL_MS = 1500
export interface ChromeBrowserOptions {
  dirOf: (profile: string) => string
  /** Synchronous admission; release must retain its token while Chrome termination is uncertain. */
  acquireLease?: (profile: string) => { release(): boolean | void }
  /** A fresh effective authorization identity, including revocation epochs. */
  authorization?: (profile: string) => string
  helperDir?: (profile: string) => string
  profileExists?: (profile: string) => boolean
  logger?: Logger
  extensionsFor?: (profile: string) => boolean
  syncFor?: (profile: string) => boolean
  homedir?: () => string
  downloadsRoot?: string
  extraArgs?: readonly string[]
  /** The shipped BroCrew helper folder; without it no profile gets the helper. */
  helperSource?: string
  /** The person's switch for the helper in this profile, and where it is kept. */
  helperFor?: (profile: string) => HelperSwitch
  rememberHelper?: (profile: string, helper: HelperSwitch) => void
  noSandbox?: boolean
  noTestType?: boolean
  browser?: BrowserChoice
  launchContext?: (opts: ChromiumLaunchOptions) => Promise<BrowserContext>
  lockHeld?: (dir: string) => Promise<boolean>
  lockWaitMs?: number
  closeMs?: number
  exitGraceMs?: number
  killChrome?: (dir: string) => Promise<void>
  pollMs?: number
}
interface Entry {
  name: string
  barrier: TransitionBarrier
  ctx: BrowserContext | null
  extensions: boolean
  sync: boolean
  generation: number
  initial: Page[]
  windows: ChromiumWindows | null
  windowContext: BrowserContext | null
  helper: BrocrewHelper | null
  waiters: number
  life: Promise<unknown>
  lifePending: number
  removing: boolean
  pageListeners: Set<(page: Page) => void>
  closedListeners: Set<(generation: number) => void>
  endedHooks: Array<() => void>
  lease: { release(): boolean | void } | null
  authorization: string | undefined
  agentCalls: number
  downloads: {
    dir: string
    files: PrivateDownloadFiles
    session: CDPSession
    captures: number
    privateMode: boolean
    chain: Promise<void>
    router: DownloadRouter
  } | null
}
interface FrameTree {
  frame: {
    id: string
  }
  childFrames?: FrameTree[]
}
function frameIdsOf(tree: FrameTree, into = new Set<string>()): Set<string> {
  into.add(tree.frame.id)
  for (const child of tree.childFrames ?? []) frameIdsOf(child, into)
  return into
}
export async function lockHeldByLiveChrome(
  dir: string,
  deps: {
    platform?: Platform
    readLink?: (p: string) => Promise<string>
    commandOf?: (pid: number) => Promise<string | null>
    openLockfile?: (file: string) => Promise<{
      close(): Promise<void>
    }>
  } = {},
): Promise<boolean> {
  if ((deps.platform ?? process.platform) === 'win32')
    return lockfileBusy(path.join(dir, 'lockfile'), deps.openLockfile ?? ((p) => openFile(p, 'r+')))
  const readLink = deps.readLink ?? ((p: string) => readlink(p))
  const commandOf = deps.commandOf ?? commandOfPid
  let target: string
  try {
    target = await readLink(path.join(dir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(/-(\d+)$/.exec(target)?.[1])
  if (!Number.isInteger(pid) || pid <= 0) return false
  const command = await commandOf(pid)
  return command !== null && /chrom|msedge|microsoft[- ]edge/i.test(command)
}
export async function chromePidsOf(
  dir: string,
  psList?: () => Promise<string>,
  platform: Platform = process.platform,
): Promise<number[]> {
  return browserPidsOf(dir, psList ?? (() => processList(platform)), platform)
}
export async function killChromeOf(
  dir: string,
  graceMs = KILL_GRACE_MS,
  deps: EndDeps = {},
): Promise<void> {
  return endBrowsersOf(dir, graceMs, deps)
}
function isBlank(page: Page): boolean {
  return !page.isClosed() && page.url() === 'about:blank'
}
export class ChromeBrowser implements ProfileBrowser {
  private readonly entries = new Map<string, Entry>()
  private readonly serializer: KeyedSerializer = createKeyedSerializer()
  private readonly logger: Logger
  private readonly launchContext: (opts: ChromiumLaunchOptions) => Promise<BrowserContext>
  private readonly lockHeld: (dir: string) => Promise<boolean>
  private readonly lockWaitMs: number
  private readonly closeMs: number
  private readonly exitGraceMs: number
  private readonly pollMs: number
  private readonly killChrome: (dir: string) => Promise<void>
  private readonly downloadQuotas = new Map<string, UnclaimedDownloadQuota>()
  private generations = 0
  private shuttingDown = false
  private readonly choice: BrowserChoice
  constructor(private readonly opts: ChromeBrowserOptions) {
    this.logger = opts.logger ?? silentLogger
    this.choice = opts.browser ?? browserChoice()
    this.launchContext = opts.launchContext ?? launchPersistentChromium
    this.lockHeld = opts.lockHeld ?? ((dir) => lockHeldByLiveChrome(dir))
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_WAIT_MS
    this.closeMs = opts.closeMs ?? CLOSE_MS
    this.exitGraceMs = opts.exitGraceMs ?? EXIT_GRACE_MS
    this.pollMs = opts.pollMs ?? WAIT_POLL_MS
    this.killChrome = opts.killChrome ?? ((dir) => killChromeOf(dir))
  }
  private entry(profile: string): Entry {
    let e = this.entries.get(profile)
    if (!e) {
      e = {
        name: profile,
        barrier: createTransitionBarrier(),
        ctx: null,
        extensions: false,
        sync: false,
        generation: 0,
        initial: [],
        windows: null,
        windowContext: null,
        helper: null,
        waiters: 0,
        life: Promise.resolve(),
        lifePending: 0,
        removing: false,
        pageListeners: new Set(),
        closedListeners: new Set(),
        agentCalls: 0,
        downloads: null,
        endedHooks: [],
        lease: null,
        authorization: undefined,
      }
      this.entries.set(profile, e)
    }
    return e
  }
  private lifecycle<T>(e: Entry, fn: () => Promise<T>): Promise<T> {
    if (e.removing) return Promise.reject(new ProfileInUseError())
    e.lifePending++
    const run = e.life.then(fn, fn)
    const settled = run.finally(() => {
      e.lifePending--
    })
    e.life = settled.then(
      () => undefined,
      () => undefined,
    )
    return settled
  }
  dir(profile: string): string {
    return this.opts.dirOf(profile)
  }
  state(profile: string): {
    generation: number
    helper?: HelperState
  } | null {
    const e = this.entries.get(profile)
    if (!e?.ctx) return null
    return {
      generation: e.generation,
      ...(e.helper ? { helper: e.helper.state } : {}),
    }
  }
  async ensure(profile: string): Promise<{
    generation: number
  }> {
    if (this.shuttingDown) throw new Error('the server is shutting down')
    if (this.opts.profileExists?.(profile) === false) throw new Error('profile does not exist')
    if (this.entries.get(profile)?.removing) throw new ProfileInUseError()
    const authorization = this.opts.authorization?.(profile)
    const check = () => {
      if (this.shuttingDown || this.opts.authorization?.(profile) !== authorization)
        throw new Error('profile authorization changed')
    }
    const dir = this.dir(profile)
    const e = this.entry(profile)
    return this.lifecycle(e, async () => {
      check()
      const extensions = this.opts.extensionsFor?.(profile) === true
      const sync = this.opts.syncFor?.(profile) === true
      if (
        e.ctx &&
        e.extensions === extensions &&
        e.sync === sync &&
        e.authorization === authorization
      )
        return { generation: e.generation }
      if (e.ctx) await e.barrier.transition(() => this.closeNow(e))
      check()
      // Take admission before the first launch await, including lock inspection.
      this.releaseLease(e)
      if (e.lease) throw new ProfileInUseError()
      const lease = this.opts.acquireLease?.(profile) ?? null
      e.lease = lease
      try {
        await this.waitForLock(dir)
        check()
        const generation = await this.launch(e, dir, extensions, sync, authorization, check)
        check()
        return { generation }
      } catch (error) {
        if (e.ctx) await this.closeNow(e).catch(() => undefined)
        this.releaseLease(e, lease)
        throw error
      }
    })
  }
  private async waitForLock(dir: string): Promise<void> {
    const deadline = Date.now() + this.lockWaitMs
    while (await this.lockHeld(dir)) {
      if (Date.now() >= deadline) throw new ProfileInUseError()
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  private async launch(
    e: Entry,
    dir: string,
    extensions: boolean,
    sync: boolean,
    authorization: string | undefined,
    check: () => void,
  ): Promise<number> {
    const stagingDir = this.privateDownloadStage(dir)
    const helped = extensions && this.opts.helperSource !== undefined
    const helperSwitch = () => this.opts.helperFor?.(e.name) ?? 'on'
    // Chrome forgets the helper, and the person's switch, at any start; read it first. A Turn on
    // pressed since is newer than that record.
    if (
      this.opts.helperSource !== undefined &&
      helperSwitch() !== 'turning-on' &&
      offInLastSession(dir)
    )
      this.opts.rememberHelper?.(e.name, 'off')
    const base: ChromiumLaunchOptions = {
      profileDir: dir,
      ...launchTarget(this.choice),
      ...(stagingDir ? { downloadsPath: stagingDir } : {}),
      ...(this.opts.noSandbox === true ? {} : { chromiumSandbox: true }),
      ignoreAllDefaultArgs: true,
      args: launchArgs({
        profileDir: dir,
        channel: this.choice.channel,
        background: true,
        sync,
        extensions,
        noSandbox: this.opts.noSandbox === true,
        noTestType: this.opts.noTestType === true,
        ...(this.opts.extraArgs ? { extraArgs: this.opts.extraArgs } : {}),
      }),
      ...OWN_SIGNALS,
      viewport: null,
    }
    let ctx: BrowserContext
    try {
      check()
      assertOwnProfileDir(base)
      privateFolder(this.downloadRoot(dir), stagingDir)
      ctx = await this.launchContext(base)
    } catch (err) {
      if (BROWSER_MISSING.test(err instanceof Error ? err.message : '')) {
        this.logger.warn('browser launch failed: no browser found', {
          channel: this.choice.channel,
        })
        if (stagingDir) new PrivateDownloadFiles(this.downloadRoot(dir)).removeEmpty(stagingDir)
        throw new BrowserNotFoundError()
      }
      this.logger.warn('browser launch failed', {
        errorName: err instanceof Error ? err.name : 'unknown',
      })
      if (stagingDir) new PrivateDownloadFiles(this.downloadRoot(dir)).removeEmpty(stagingDir)
      throw err
    }
    try {
      check()
    } catch (error) {
      await ctx.close().catch(() => undefined)
      throw error
    }
    let nativeDownloads: Entry['downloads']
    try {
      nativeDownloads = await this.nativeDownloads(
        ctx,
        stagingDir,
        dir,
        () => e.ctx === ctx,
        check,
        e,
      )
      check()
    } catch (error) {
      await this.endDownloadBrowser(ctx, dir)
      new PrivateDownloadFiles(this.downloadRoot(dir)).removeEmpty(stagingDir)
      throw error
    }
    const generation = ++this.generations
    e.ctx = ctx
    e.extensions = extensions
    e.sync = sync
    e.generation = generation
    e.authorization = authorization
    e.downloads = nativeDownloads
    // Visible profiles with extensions on get the helper; it places tabs without showing Chrome.
    e.helper =
      helped && this.opts.helperSource
        ? new BrocrewHelper({
            context: ctx,
            profileDir: dir,
            source: this.opts.helperSource,
            ...(this.opts.helperDir ? { helperDir: this.opts.helperDir(e.name) } : {}),
            allowed: () =>
              e.ctx === ctx &&
              !this.shuttingDown &&
              this.authorized(e) &&
              this.opts.extensionsFor?.(e.name) === true,
            rememberedOff: () => helperSwitch() === 'off',
            remember: (off) => this.opts.rememberHelper?.(e.name, off ? 'off' : 'on'),
            logger: this.logger,
          })
        : null
    const windowContext = this.opts.authorization
      ? fenceBrowserHandles(ctx, () => {
          if (e.ctx !== ctx || !this.authorized(e)) throw new Error('profile authorization changed')
        })
      : ctx
    e.windowContext = windowContext
    e.windows = new ChromiumWindows(windowContext, {
      onAdmit: (page) => {
        if (e.ctx !== ctx) return
        for (const cb of [...e.pageListeners]) cb(page)
      },
      ...(e.helper ? { placer: e.helper } : {}),
    })
    e.initial = windowContext.pages()
    ctx.on('close', () => this.ended(e, ctx, generation))
    ctx.browser()?.on('disconnected', () => this.ended(e, ctx, generation))
    if (e.helper) await (helperSwitch() === 'turning-on' ? e.helper.turnOn() : e.helper.install())
    check()
    this.logger.info('browser launched', {
      generation,
      extensions,
      sync,
    })
    return generation
  }
  private authorized(e: Entry): boolean {
    try {
      return this.opts.authorization?.(e.name) === e.authorization
    } catch {
      return false
    }
  }
  private releaseLease(e: Entry, lease = e.lease): void {
    if (!lease || e.lease !== lease) return
    try {
      if (lease.release() !== false) e.lease = null
    } catch {
      this.logger.warn('browser lease retained: Chrome end is uncertain')
    }
  }
  private ended(e: Entry, ctx: BrowserContext, generation: number): void {
    if (e.ctx !== ctx) return
    this.releaseLease(e)
    this.logger.info('browser ended', { generation })
    if (e.downloads) {
      const kept = e.downloads.router.sweep()
      const remaining = e.downloads.router.cleanupStage(kept)
      if (remaining.size > 0)
        this.logger.warn(
          'downloads of the user could not be placed and stay in the staging folder',
          { count: remaining.size, dir: e.downloads.dir },
        )
    }
    e.downloads = null
    e.ctx = null
    e.initial = []
    e.windows = null
    e.windowContext = null
    e.helper = null
    for (const hook of e.endedHooks.splice(0)) hook()
    for (const cb of [...e.closedListeners]) {
      try {
        cb(generation)
      } catch {
        /* Continue without this optional result. */
      }
    }
  }
  private downloadRoot(profileDir: string): string {
    const root = this.opts.downloadsRoot ?? path.join(profileDir, 'downloads')
    privateFolder(path.dirname(root), root, true)
    return root
  }
  private privateDownloadStage(profileDir: string): string {
    return fs.mkdtempSync(path.join(this.downloadRoot(profileDir), 'stage-'))
  }
  private async endDownloadBrowser(
    ctx: BrowserContext,
    profileDir: string,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    let closed = false
    await settledWithin(
      ctx.close().then(() => {
        closed = true
      }),
      this.closeMs,
    )
    if (!closed) {
      if (!isCurrent()) throw new Error('Plugin unavailable. Try again.')
      await this.killChrome(profileDir)
    }
  }
  private async nativeDownloads(
    ctx: BrowserContext,
    dir: string,
    profileDir: string,
    isCurrent: () => boolean,
    check: () => void,
    e: Entry,
  ): Promise<NonNullable<Entry['downloads']>> {
    const session = await ctx.browser()!.newBrowserCDPSession()
    check()
    let ending: Promise<void> | undefined
    const end = (): Promise<void> =>
      (ending ??= this.endDownloadBrowser(ctx, profileDir, isCurrent))
    let quota = this.downloadQuotas.get(profileDir)
    if (!quota) {
      quota = new UnclaimedDownloadQuota()
      this.downloadQuotas.set(profileDir, quota)
    }
    const files = new PrivateDownloadFiles(this.downloadRoot(profileDir))
    const router: DownloadRouter = new DownloadRouter({
      dir,
      files,
      session,
      nativeDir: () => this.downloadRoot(profileDir),
      fallbackDirs: () => [this.downloadRoot(profileDir)],
      logger: this.logger,
      privateActive: () => e.agentCalls > 0 || downloads.privateMode || downloads.captures > 0,
      quota,
      onPolicyFailure: end,
    })
    const downloads: NonNullable<Entry['downloads']> = {
      dir,
      files,
      session,
      captures: 0,
      privateMode: true,
      chain: Promise.resolve(),
      router,
    }
    await session.send(
      'Browser.setDownloadBehavior',
      this.downloadBehavior(dir, e.agentCalls > 0, 0),
    )
    downloads.privateMode = e.agentCalls > 0
    return downloads
  }
  private downloadBehavior(dir: string, agent: boolean, captures: number) {
    const behavior: 'default' | 'allowAndName' = agent || captures > 0 ? 'allowAndName' : 'default'
    return {
      behavior,
      ...(behavior === 'default' ? {} : { downloadPath: dir }),
      eventsEnabled: true,
    }
  }
  private async applyDownloadBehavior(e: Entry): Promise<void> {
    const d = e.downloads,
      ctx = e.ctx
    if (!d || !ctx) return
    d.chain = d.chain
      .then(async () => {
        if (e.downloads !== d || e.ctx !== ctx) return
        if (!this.authorized(e)) throw new Error('profile authorization changed')
        const policy = this.downloadBehavior(d.dir, e.agentCalls > 0, d.captures)
        if (policy.behavior !== 'default') d.privateMode = true
        await d.session.send('Browser.setDownloadBehavior', policy)
        // Keep late private events owned until Chrome acknowledges normal routing.
        d.privateMode = policy.behavior !== 'default'
      })
      .catch(async (error: unknown) => {
        await this.endDownloadBrowser(ctx, this.dir(e.name), () => e.ctx === ctx)
        throw error
      })
    await d.chain
  }
  privateDownloadsActive(profile: string): boolean {
    const e = this.entries.get(profile)
    return (
      !!e &&
      (e.agentCalls > 0 || (e.downloads?.privateMode ?? false) || (e.downloads?.captures ?? 0) > 0)
    )
  }
  private readonly downloadOwnership = new WeakMap<
    Download,
    { downloads: NonNullable<Entry['downloads']>; result: Promise<boolean> }
  >()
  downloadIsPrivate(profile: string, handle: Download): Promise<boolean> {
    const download = unwrapBrowserHandle(handle)
    const d = this.entries.get(profile)?.downloads
    if (!d) return Promise.resolve(false)
    const existing = this.downloadOwnership.get(download)
    if (existing) return existing.downloads === d ? existing.result : Promise.resolve(false)
    const result = (async () => {
      try {
        // Playwright 1.61.0 serializes Artifact.absolutePath before Page.download.
        // Its Chromium Download artifact is downloadsPath/GUID, independent of
        // Chrome's native destination. Read only this pinned identity, not path()
        // (which waits for completion and would break in-flight wait recovery).
        const artifact = Object.getOwnPropertyDescriptor(download, '_artifact')?.value
        const initializer =
          artifact && Object.getOwnPropertyDescriptor(artifact, '_initializer')?.value
        const file =
          initializer && Object.getOwnPropertyDescriptor(initializer, 'absolutePath')?.value
        if (typeof file !== 'string' || path.dirname(file) !== d.dir) return false
        const owned = await d.router.origin(path.basename(file))
        return owned && this.entries.get(profile)?.downloads === d
      } catch {
        return false
      }
    })()
    this.downloadOwnership.set(download, { downloads: d, result })
    return result
  }
  downloadFileIsPrivate(profile: string, file: string): boolean {
    const d = this.entries.get(profile)?.downloads
    return !!d && path.dirname(file) === d.dir && d.files.file(file)
  }
  private artifactPath(download: Download): string | undefined {
    const raw = unwrapBrowserHandle(download)
    const artifact = Object.getOwnPropertyDescriptor(raw, '_artifact')?.value
    const initializer = artifact && Object.getOwnPropertyDescriptor(artifact, '_initializer')?.value
    const file = initializer && Object.getOwnPropertyDescriptor(initializer, 'absolutePath')?.value
    return typeof file === 'string' ? file : undefined
  }
  async deletePrivateDownload(profile: string, download: Download): Promise<void> {
    if (!(await this.downloadIsPrivate(profile, download))) return
    const file = this.artifactPath(download)
    if (!file || !this.downloadFileIsPrivate(profile, file)) return
    // Re-check and unlink locally in one synchronous turn. Do not hand a
    // checked pathname to a later asynchronous Playwright cleanup RPC.
    this.entries.get(profile)?.downloads?.files.remove(file)
  }
  async cancelPrivateDownload(profile: string, download: Download): Promise<void> {
    if (!(await this.downloadIsPrivate(profile, download))) return
    const file = this.artifactPath(download)
    if (
      !file ||
      (!this.downloadFileIsPrivate(profile, file) &&
        !this.downloadFileIsPrivate(profile, file + '.crdownload'))
    )
      return
    await unwrapBrowserHandle(download).cancel()
  }
  async agentCall<T>(profiles: readonly string[], fn: () => Promise<T>): Promise<T> {
    const entries = [...new Set(profiles)].map((name) => this.entry(name))
    const applyAll = async () => {
      const results = await Promise.allSettled(entries.map((e) => this.applyDownloadBehavior(e)))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }
    for (const e of entries) e.agentCalls++
    try {
      await applyAll()
      return await fn()
    } finally {
      for (const e of entries) e.agentCalls--
      await applyAll()
    }
  }
  async captureDownloads<T>(
    profile: string,
    page: Page,
    fn: () => Promise<T>,
    savedFile?: () => string | undefined,
    onprogress?: () => void,
    existing?: { download: Download; signal?: AbortSignal },
  ): Promise<T> {
    const e = this.entries.get(profile)
    const d = e?.downloads
    const ctx = e?.ctx
    if (!e || !d || !ctx) throw new Error('Plugin unavailable. Try again.')
    const check = () => {
      if (e.ctx !== ctx || !this.authorized(e)) throw new Error('profile authorization changed')
    }
    check()
    const apply = () => this.applyDownloadBehavior(e)
    d.captures++
    const held: {
      session?: Promise<CDPSession>
    } = {}
    const capture = d.router.capture(
      async () => {
        held.session ??= ctx.newCDPSession(unwrapBrowserHandle(page))
        const session = await held.session
        check()
        const tree = (await session.send('Page.getFrameTree')) as {
          frameTree: FrameTree
        }
        check()
        return frameIdsOf(tree.frameTree)
      },
      existing ? undefined : onprogress,
    )
    let completed = false
    let savedGuid: string | undefined
    let unobserve = () => {}
    const stopObserving = () => unobserve()
    try {
      await apply()
      check()
      if (existing && onprogress && !existing.signal?.aborted) {
        const file = this.artifactPath(existing.download)
        if (file && path.dirname(file) === d.dir)
          unobserve = d.router.observe(path.basename(file), onprogress)
        existing.signal?.addEventListener('abort', stopObserving, { once: true })
      }
      const result = await fn()
      check()
      const saved = savedFile?.()
      if (saved !== undefined) {
        const relative = path.relative(d.dir, saved)
        if (path.dirname(relative) === '.') savedGuid = relative
      }
      completed = true
      return result
    } finally {
      stopObserving()
      existing?.signal?.removeEventListener('abort', stopObserving)
      capture.end(completed, savedGuid)
      void held.session?.then((s) => s.detach()).catch(() => undefined)
      d.captures--
      await apply()
    }
  }
  private async closeNow(e: Entry): Promise<void> {
    const ctx = e.ctx
    if (!ctx) {
      this.releaseLease(e)
      return
    }
    const { generation } = e
    const closed = settledWithin(ctx.close(), this.closeMs).then((ok) => ({
      ok,
    }))
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const lingering = new Promise<{
      ok: false
      lingered: true
    }>((resolve) => {
      e.endedHooks.push(() => {
        graceTimer = setTimeout(() => resolve({ ok: false, lingered: true }), this.exitGraceMs)
        graceTimer.unref?.()
      })
    })
    const first = await Promise.race([closed, lingering])
    if (graceTimer) clearTimeout(graceTimer)
    if (!first.ok) {
      this.logger.warn(
        'lingered' in first
          ? 'Chrome disconnected but did not exit, ending the process'
          : 'browser close timed out, ending the Chrome process',
        {
          generation,
          ...('lingered' in first ? { graceMs: this.exitGraceMs } : { closeMs: this.closeMs }),
        },
      )
      await this.killChrome(this.dir(e.name)).catch(() =>
        this.logger.warn('ending the Chrome process failed', { generation }),
      )
    }
    if (e.ctx === ctx) this.ended(e, ctx, generation)
    this.releaseLease(e)
  }
  async close(profile: string): Promise<void> {
    const e = this.entries.get(profile)
    if (!e) return
    await this.lifecycle(e, async () => {
      if (e.ctx) await e.barrier.transition(() => this.closeNow(e))
      else this.releaseLease(e)
    })
  }
  async closeAll(): Promise<void> {
    this.shuttingDown = true
    await Promise.all(
      [...this.entries.values()].map((e) => this.closeNow(e).catch(() => undefined)),
    )
  }
  async newPage(
    profile: string,
    opts: { newWindow: boolean; windowOf?: Page; onNote?: (note: string) => void },
  ): Promise<Page> {
    const e = this.entries.get(profile)
    const ctx = e?.ctx
    if (e && !this.authorized(e)) throw new Error('profile authorization changed')
    if (!e || !ctx || !e.windows) throw new Error('profile is not open')
    const emptyLaunchWindow =
      e.initial.length > 0 &&
      (e.windowContext ?? ctx).pages().every((page) => e.initial.includes(page) && isBlank(page))
    const reuse = !opts.windowOf && emptyLaunchWindow ? e.initial.find(isBlank) : undefined
    e.initial = []
    if (reuse) return reuse
    return e.windows.open({
      ...opts,
      newWindow: opts.newWindow,
    })
  }
  /** The person turned the helper on: installed now in a running visible profile, else at its next. */
  async turnHelperOn(profile: string): Promise<void> {
    const e = this.entries.get(profile)
    if (this.opts.authorization) this.opts.authorization(profile)
    if (e?.ctx && !this.authorized(e)) throw new Error('profile authorization changed')
    this.opts.rememberHelper?.(profile, 'turning-on')
    await this.entries.get(profile)?.helper?.turnOn()
  }
  async windowId(profile: string, page: Page): Promise<number> {
    const windows = this.entries.get(profile)?.windows
    if (!windows) throw new Error('profile is not open')
    return windows.windowId(page)
  }
  async usePage(profile: string, page: Page): Promise<void> {
    const windows = this.entries.get(profile)?.windows
    if (!windows) throw new Error('profile is not open')
    await windows.used(page)
  }
  onPage(profile: string, cb: (page: Page) => void): () => void {
    const e = this.entry(profile)
    e.pageListeners.add(cb)
    return () => e.pageListeners.delete(cb)
  }
  onClosed(profile: string, cb: (generation: number) => void): () => void {
    const e = this.entry(profile)
    e.closedListeners.add(cb)
    return () => e.closedListeners.delete(cb)
  }
  async waitAllPagesClosed(
    profile: string,
    timeoutMs: number,
  ): Promise<'pages-closed' | 'timeout'> {
    const e = this.entries.get(profile)
    const ctx = e?.ctx
    if (!e || !ctx) return 'pages-closed'
    e.waiters++
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let reason = 'timeout'
    const because = <T>(why: string, outcome: T): T => {
      reason = why
      return outcome
    }
    try {
      return await Promise.race([
        allPagesClosed(ctx).then((o) => because('pages-closed', o)),
        new Promise<'pages-closed'>((resolve) =>
          ctx.once('close', () => resolve(because('context-closed', 'pages-closed'))),
        ),
        new Promise<'pages-closed'>((resolve) =>
          ctx
            .browser()
            ?.once('disconnected', () => resolve(because('disconnected', 'pages-closed'))),
        ),
        new Promise<'pages-closed'>((resolve) => {
          let empty = 0
          poll = setInterval(() => {
            empty = ctx.pages().length === 0 ? empty + 1 : 0
            if (ctx.browser()?.isConnected() === false)
              resolve(because('poll-disconnected', 'pages-closed'))
            else if (empty >= 2) resolve(because('poll-no-pages', 'pages-closed'))
          }, this.pollMs)
          poll.unref?.()
        }),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), timeoutMs)
        }),
      ])
    } finally {
      e.waiters--
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
      this.logger.info('window wait ended', {
        reason,
        ms: Date.now() - started,
      })
    }
  }
  exclusive<T>(profile: string, fn: () => Promise<T>): Promise<T> {
    return this.serializer.runExclusive(profile, fn)
  }
  /** A person may remove closed data only while no browser work can acquire it. */
  removeWhenIdle(profile: string, remove: () => void): Promise<void> {
    return this.exclusive(profile, async () => {
      const e = this.entry(profile)
      const busy = () =>
        e.ctx !== null ||
        e.lifePending > 0 ||
        e.waiters > 0 ||
        e.barrier.inFlight() > 0 ||
        e.barrier.isTransitioning()
      if (e.removing || busy()) throw new ProfileInUseError()
      e.removing = true
      try {
        if (await this.lockHeld(this.dir(profile))) throw new ProfileInUseError()
        if (busy()) throw new ProfileInUseError()
        remove()
      } finally {
        e.removing = false
      }
    })
  }
  operate<T>(profile: string, fn: () => Promise<T>): Promise<T> {
    const e = this.entry(profile)
    if (e.removing) return Promise.reject(new ProfileInUseError())
    const ctx = e.ctx
    const check = () => {
      if (e.ctx !== ctx || (ctx && !this.authorized(e)))
        throw new Error('profile authorization changed')
    }
    return e.barrier.runOp(async () => {
      check()
      const result = await fn()
      check()
      return result
    })
  }
}
