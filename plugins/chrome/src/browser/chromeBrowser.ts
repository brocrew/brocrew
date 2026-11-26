import { ChromiumWindows } from '../shared/browser/chromiumWindows.js'
import { BrocrewHelper, offInLastSession } from './brocrewHelper.js'
import type { HelperSwitch } from '../profiles/sharedTypes.js'
import type { HelperState } from './brocrewHelper.js'
import { privateFolder } from '../privatePaths.js'
import { assertOwnProfileDir } from '../shared/browser/launchGuard.js'
import fs from 'node:fs'
import { open as openFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
import { DownloadRouter } from './downloadRouter.js'
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
import { untilAbort } from './waitForBrowser.js'
// A native lock can belong to another Chrome whose exit we do not control. Allow a brief
// handoff before reporting it busy. The managed close of our own context is awaited separately.
export const LOCK_WAIT_MS = 5000
export const CLOSE_MS = 10000
export const EXIT_GRACE_MS = 1500
export const KILL_GRACE_MS = 3000
export const WAIT_POLL_MS = 1500
export interface ChromeBrowserOptions {
  dirOf: (profile: string) => string
  /** Synchronous admission; release must retain its token while Chrome termination is uncertain. */
  acquireLease?: (profile: string) => { release(): boolean | void }
  /** A fresh stable profile target identity; replacement invalidates old work. */
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
  lockHeld?: (dir: string, signal?: AbortSignal) => Promise<boolean>
  lockWaitMs?: number
  closeMs?: number
  exitGraceMs?: number
  killChrome?: (dir: string, signal?: AbortSignal) => Promise<void>
  pollMs?: number
}
interface ClosingBrowser {
  ctx: BrowserContext
  generation: number
  closed: Promise<boolean>
  exited: AbortSignal
  sweep?: Promise<boolean>
}
interface Entry {
  name: string
  barrier: TransitionBarrier
  ctx: BrowserContext | null
  closing?: ClosingBrowser
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
    signal?: AbortSignal
    openLockfile?: (file: string) => Promise<{
      close(): Promise<void>
    }>
  } = {},
): Promise<boolean> {
  if ((deps.platform ?? process.platform) === 'win32')
    return lockfileBusy(path.join(dir, 'lockfile'), deps.openLockfile ?? ((p) => openFile(p, 'r+')))
  const readLink = deps.readLink ?? ((p: string) => readlink(p))
  const commandOf = deps.commandOf ?? ((pid) => commandOfPid(pid, undefined, deps.signal))
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
async function killChromeOf(
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
  private readonly lockHeld: NonNullable<ChromeBrowserOptions['lockHeld']>
  private readonly lockWaitMs: number
  private readonly closeMs: number
  private readonly exitGraceMs: number
  private readonly pollMs: number
  private readonly killChrome: NonNullable<ChromeBrowserOptions['killChrome']>
  private generations = 0
  private shuttingDown = false
  private readonly choice: BrowserChoice
  constructor(private readonly opts: ChromeBrowserOptions) {
    this.logger = opts.logger ?? silentLogger
    this.choice = opts.browser ?? browserChoice()
    this.launchContext = opts.launchContext ?? launchPersistentChromium
    this.lockHeld = opts.lockHeld ?? ((dir, signal) => lockHeldByLiveChrome(dir, { signal }))
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_WAIT_MS
    this.closeMs = opts.closeMs ?? CLOSE_MS
    this.exitGraceMs = opts.exitGraceMs ?? EXIT_GRACE_MS
    this.pollMs = opts.pollMs ?? WAIT_POLL_MS
    this.killChrome =
      opts.killChrome ?? ((dir, signal) => killChromeOf(dir, KILL_GRACE_MS, { signal }))
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
  async ensure(
    profile: string,
    signal?: AbortSignal,
  ): Promise<{
    generation: number
  }> {
    if (this.shuttingDown) throw new Error('the server is shutting down')
    if (this.opts.profileExists?.(profile) === false) throw new Error('profile does not exist')
    if (this.entries.get(profile)?.removing) throw new ProfileInUseError()
    const authorization = this.opts.authorization?.(profile)
    const check = () => {
      signal?.throwIfAborted()
      if (this.opts.profileExists?.(profile) === false) throw new Error('profile does not exist')
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
        !e.closing &&
        e.extensions === extensions &&
        e.sync === sync &&
        e.authorization === authorization
      )
        return { generation: e.generation }
      if (e.ctx || e.closing) await e.barrier.transition(() => this.closeNow(e, signal))
      check()
      // Take admission before the first launch await, including lock inspection.
      this.releaseLease(e)
      if (e.lease) throw new ProfileInUseError()
      const lease = this.opts.acquireLease?.(profile) ?? null
      e.lease = lease
      try {
        await this.waitForLock(dir, signal)
        check()
        const generation = await this.launch(e, dir, extensions, sync, authorization, check, signal)
        check()
        return { generation }
      } catch (error) {
        if (e.ctx) await this.closeNow(e).catch(() => undefined)
        this.releaseLease(e, lease)
        throw error
      }
    })
  }
  private async waitForLock(dir: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.lockWaitMs
    while (await this.lockHeld(dir, signal)) {
      signal?.throwIfAborted()
      if (Date.now() >= deadline) throw new ProfileInUseError()
      await delay(100, undefined, { signal })
    }
  }
  private async launch(
    e: Entry,
    dir: string,
    extensions: boolean,
    sync: boolean,
    authorization: string | undefined,
    check: () => void,
    signal?: AbortSignal,
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
      await this.closeNow(e, signal, ctx).catch(() => undefined)
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
      await this.closeNow(e, signal, ctx)
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
    // The optional worker can start after Chrome. Only explicit window placement waits for it.
    if (e.helper) void (helperSwitch() === 'turning-on' ? e.helper.turnOn() : e.helper.install())
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
    if (e.closing || !lease || e.lease !== lease) return
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
      (ending ??= isCurrent()
        ? this.closeNow(e)
        : settledWithin(ctx.close(), this.closeMs).then(() => undefined))
    const files = new PrivateDownloadFiles(this.downloadRoot(profileDir))
    const router: DownloadRouter = new DownloadRouter({
      dir,
      files,
      session,
      nativeDir: () => this.downloadRoot(profileDir),
      fallbackDirs: () => [this.downloadRoot(profileDir)],
      logger: this.logger,
      privateActive: () => e.agentCalls > 0 || downloads.privateMode || downloads.captures > 0,
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
  private async applyDownloadBehavior(
    e: Entry,
    signal?: AbortSignal,
    releasing = false,
  ): Promise<void> {
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
        if (e.ctx === ctx) await this.closeNow(e, signal)
        throw error
      })
    try {
      await (signal ? untilAbort(d.chain, signal) : d.chain)
    } catch (error) {
      if (!releasing || error !== signal?.reason) throw error
    }
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
  async agentCall<T>(
    profiles: readonly string[],
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const entries = [...new Set(profiles)].map((name) => this.entry(name))
    const applyAll = async (releasing = false) => {
      const results = await Promise.allSettled(
        entries.map((e) => this.applyDownloadBehavior(e, signal, releasing)),
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }
    for (const e of entries) e.agentCalls++
    try {
      await applyAll()
      return await fn()
    } finally {
      for (const e of entries) e.agentCalls--
      await applyAll(true)
    }
  }
  async captureDownloads<T>(
    profile: string,
    page: Page,
    fn: () => Promise<T>,
    savedFile?: () => string | undefined,
    onprogress?: () => void,
    existing?: { download: Download; signal?: AbortSignal },
    signal?: AbortSignal,
  ): Promise<T> {
    const e = this.entries.get(profile)
    const d = e?.downloads
    const ctx = e?.ctx
    if (!e || !d || !ctx) throw new Error('Plugin unavailable. Try again.')
    const check = () => {
      if (e.ctx !== ctx || !this.authorized(e)) throw new Error('profile authorization changed')
    }
    check()
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
      await this.applyDownloadBehavior(e, signal)
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
      await this.applyDownloadBehavior(e, signal, true)
    }
  }
  private finishClose(e: Entry, closing: ClosingBrowser): void {
    if (e.closing !== closing) return
    e.closing = undefined
    if (e.ctx === closing.ctx) this.ended(e, closing.ctx, closing.generation)
    else this.releaseLease(e)
  }
  private async closeNow(
    e: Entry,
    signal?: AbortSignal,
    ctx = e.closing?.ctx ?? e.ctx,
  ): Promise<void> {
    if (!ctx) {
      this.releaseLease(e)
      return
    }
    if (!e.closing) {
      const exit = new AbortController()
      const closing: ClosingBrowser = {
        ctx,
        generation: e.generation,
        exited: exit.signal,
        closed: Promise.resolve()
          .then(() => ctx.close())
          .then(
            async () => {
              exit.abort()
              await closing.sweep
              this.finishClose(e, closing)
              return true
            },
            () => false,
          ),
      }
      e.closing = closing
    }
    const closing = e.closing
    const { generation } = closing
    const closed = settledWithin(closing.closed, this.closeMs).then(async (finished) => ({
      ok: finished && (await closing.closed),
    }))
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let startGrace!: () => void
    const lingering = new Promise<{
      ok: false
      lingered: true
    }>((resolve) => {
      startGrace = () => {
        graceTimer = setTimeout(() => resolve({ ok: false, lingered: true }), this.exitGraceMs)
        graceTimer.unref?.()
      }
    })
    if (e.ctx === ctx) e.endedHooks.push(startGrace)
    else startGrace()
    let first: Awaited<typeof closed> | Awaited<typeof lingering>
    try {
      const waiting = Promise.race([closed, lingering])
      first = await (signal ? untilAbort(waiting, signal) : waiting)
    } finally {
      if (graceTimer) clearTimeout(graceTimer)
      const index = e.endedHooks.indexOf(startGrace)
      if (index >= 0) e.endedHooks.splice(index, 1)
    }
    if (!first.ok && e.closing === closing) {
      this.logger.warn(
        'lingered' in first
          ? 'Chrome disconnected but did not exit, ending the process'
          : 'browser close timed out, ending the Chrome process',
        {
          generation,
          ...('lingered' in first ? { graceMs: this.exitGraceMs } : { closeMs: this.closeMs }),
        },
      )
      // One sweep owns this generation. A later caller can resume an aborted sweep
      // only after the earlier listing has settled.
      while (e.closing === closing && !closing.exited.aborted) {
        signal?.throwIfAborted()
        const stopping = signal ? AbortSignal.any([signal, closing.exited]) : closing.exited
        closing.sweep ??= this.killChrome(this.dir(e.name), stopping).then(
          () => true,
          () => {
            if (stopping.aborted) {
              if (closing.exited.aborted) return true
              closing.sweep = undefined
              return false
            }
            this.logger.warn('ending the Chrome process failed', { generation })
            return true
          },
        )
        const ended = await (signal ? untilAbort(closing.sweep, signal) : closing.sweep)
        if (ended) break
      }
    }
    const sweep = closing.sweep
    if (sweep) await (signal ? untilAbort(sweep, signal) : sweep)
    // An abandoned caller must not write or delete. A later close can finish the same teardown.
    signal?.throwIfAborted()
    this.finishClose(e, closing)
  }
  async close(profile: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const e = this.entries.get(profile)
    if (!e) return
    await this.lifecycle(e, async () => {
      signal?.throwIfAborted()
      if (e.ctx || e.closing) await e.barrier.transition(() => this.closeNow(e, signal))
      else this.releaseLease(e)
    })
  }
  async closeAll(): Promise<void> {
    this.shuttingDown = true
    await Promise.all(
      [...this.entries.values()].map((e) => this.closeNow(e).catch(() => undefined)),
    )
  }
  async newPage(profile: string, opts: Parameters<ProfileBrowser['newPage']>[1]): Promise<Page> {
    opts.signal?.throwIfAborted()
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
  async turnHelperOn(profile: string, signal?: AbortSignal): Promise<void> {
    const e = this.entries.get(profile)
    if (this.opts.authorization) this.opts.authorization(profile)
    if (e?.ctx && !this.authorized(e)) throw new Error('profile authorization changed')
    this.opts.rememberHelper?.(profile, 'turning-on')
    const turningOn = e?.helper?.turnOn()
    if (turningOn) await (signal ? untilAbort(turningOn, signal) : turningOn)
  }
  knownWindowId(profile: string, page: Page): number | undefined {
    return this.entries.get(profile)?.windows?.knownWindowId(page)
  }
  async windowId(profile: string, page: Page, signal?: AbortSignal): Promise<number> {
    const windows = this.entries.get(profile)?.windows
    if (!windows) throw new Error('profile is not open')
    return windows.windowId(page, signal)
  }
  async usePage(profile: string, page: Page, signal?: AbortSignal): Promise<void> {
    const windows = this.entries.get(profile)?.windows
    if (!windows) throw new Error('profile is not open')
    await windows.used(page, signal)
  }
  onPage(profile: string, cb: (page: Page) => void): () => void {
    const e = this.entry(profile)
    e.pageListeners.add(cb)
    for (const page of e.windows?.admittedPages() ?? []) cb(page)
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
  removeWhenIdle(profile: string, remove: () => void, signal?: AbortSignal): Promise<void> {
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
        if (e.closing) await this.closeNow(e, signal)
        if (await this.lockHeld(this.dir(profile), signal)) throw new ProfileInUseError()
        signal?.throwIfAborted()
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
      if (this.opts.profileExists?.(profile) === false) throw new Error('profile does not exist')
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
