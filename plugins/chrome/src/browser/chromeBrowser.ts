import { privateFolder } from '../privatePaths.js'
import { assertOwnProfileDir } from '../shared/browser/launchGuard.js'
import fs from 'node:fs'
import { open as openFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import { launchPersistentChromium } from '../shared/browser/browser-launch.js'
import type { ChromiumLaunchOptions } from '../shared/browser/browser-launch.js'
import { createKeyedSerializer, createTransitionBarrier } from '../shared/browser/browser-lease.js'
import type { KeyedSerializer, TransitionBarrier } from '../shared/browser/browser-lease.js'
import { createChromeUa, createUaReader, fallbackUaFor } from '../shared/browser/chromeUa.js'
import type { ChromeUa } from '../shared/browser/chromeUa.js'
import { OWN_SIGNALS, browserChoice, launchTarget } from '../shared/browser/launchConfig.js'
import type { BrowserChoice } from '../shared/browser/launchConfig.js'
import { allPagesClosed } from '../shared/browser/pagesClosed.js'
import type { Logger } from '../logger.js'
import { silentLogger } from '../logger.js'
import { settledWithin } from '../settled.js'
import { launchArgs } from './launchArgs.js'
import { DownloadRouter, UnclaimedDownloadQuota } from './downloadRouter.js'
import { BROWSER_MISSING, BrowserNotFoundError, ProfileInUseError } from './profileBrowser.js'
import type { BrowserMode, ProfileBrowser } from './profileBrowser.js'
import {
  browserPidsOf,
  commandOfPid,
  endBrowsersOf,
  lockfileBusy,
  processList,
} from './processes.js'
import type { EndDeps, Platform } from './processes.js'
export const IDLE_MS = 10 * 60 * 1000
export const LOCK_WAIT_MS = 5000
export const CLOSE_MS = 10000
export const EXIT_GRACE_MS = 1500
export const KILL_GRACE_MS = 3000
export const WAIT_POLL_MS = 1500
export interface ChromeBrowserOptions {
  dirOf: (profile: string) => string
  logger?: Logger
  idleMs?: number
  afterIdleClose?: (profile: string) => void | Promise<void>
  extensionsFor?: (profile: string) => boolean
  syncFor?: (profile: string) => boolean
  keepRunningFor?: (profile: string) => boolean
  homedir?: () => string
  downloadsRoot?: string
  nativeDownloadsInHeadless?: boolean
  extraArgs?: readonly string[]
  noSandbox?: boolean
  noTestType?: boolean
  browser?: BrowserChoice
  launchContext?: (opts: ChromiumLaunchOptions) => Promise<BrowserContext>
  ua?: ChromeUa
  lockHeld?: (dir: string) => Promise<boolean>
  lockWaitMs?: number
  closeMs?: number
  exitGraceMs?: number
  killChrome?: (dir: string) => Promise<void>
  pollMs?: number
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
}
interface Entry {
  name: string
  barrier: TransitionBarrier
  ctx: BrowserContext | null
  mode: BrowserMode
  extensions: boolean
  sync: boolean
  generation: number
  initial: Page[]
  waiters: number
  idleTimer: ReturnType<typeof setTimeout> | null
  touched: number
  life: Promise<unknown>
  pageListeners: Set<(page: Page) => void>
  closedListeners: Set<(generation: number) => void>
  endedHooks: Array<() => void>
  downloads: {
    dir: string
    session: CDPSession
    captures: number
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
  private readonly ua: ChromeUa
  private readonly logger: Logger
  private readonly idleMs: number
  private readonly later: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
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
    this.ua =
      opts.ua ??
      createChromeUa({
        read: createUaReader(this.choice),
        fallback: fallbackUaFor(),
        onFallback: (reason, used) =>
          this.logger.warn('Chrome UA read failed, using a stand-in', { reason, used }),
      })
    this.idleMs = opts.idleMs ?? IDLE_MS
    this.later = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
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
        mode: 'headless',
        extensions: false,
        sync: false,
        generation: 0,
        initial: [],
        waiters: 0,
        idleTimer: null,
        touched: 0,
        life: Promise.resolve(),
        pageListeners: new Set(),
        closedListeners: new Set(),
        downloads: null,
        endedHooks: [],
      }
      this.entries.set(profile, e)
    }
    return e
  }
  private lifecycle<T>(e: Entry, fn: () => Promise<T>): Promise<T> {
    const run = e.life.then(fn, fn)
    e.life = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  dir(profile: string): string {
    return this.opts.dirOf(profile)
  }
  state(profile: string): {
    mode: BrowserMode
    generation: number
  } | null {
    const e = this.entries.get(profile)
    return e?.ctx ? { mode: e.mode, generation: e.generation } : null
  }
  async ensure(
    profile: string,
    mode: BrowserMode,
  ): Promise<{
    generation: number
  }> {
    if (this.shuttingDown) throw new Error('the server is shutting down')
    const dir = this.dir(profile)
    const e = this.entry(profile)
    return this.lifecycle(e, async () => {
      const extensions = this.opts.extensionsFor?.(profile) === true
      const sync = this.opts.syncFor?.(profile) === true
      if (e.ctx && e.mode === mode && e.extensions === extensions)
        return { generation: e.generation }
      if (e.ctx) await e.barrier.transition(() => this.closeNow(e))
      await this.waitForLock(dir)
      const generation = await this.launch(e, dir, mode, extensions, sync)
      return { generation }
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
    mode: BrowserMode,
    extensions: boolean,
    sync: boolean,
  ): Promise<number> {
    const stagingDir = this.privateDownloadStage(dir)
    const base: ChromiumLaunchOptions = {
      profileDir: dir,
      headless: mode === 'headless',
      ...launchTarget(this.choice),
      ...(stagingDir ? { downloadsPath: stagingDir } : {}),
      ...(this.opts.noSandbox === true ? {} : { chromiumSandbox: true }),
      ignoreAllDefaultArgs: true,
      args: launchArgs({
        profileDir: dir,
        channel: this.choice.channel,
        mode,
        sync,
        extensions,
        noSandbox: this.opts.noSandbox === true,
        noTestType: this.opts.noTestType === true,
        ...(this.opts.extraArgs ? { extraArgs: this.opts.extraArgs } : {}),
      }),
      ...OWN_SIGNALS,
      ...(mode === 'visible' ? { viewport: null } : {}),
    }
    const build = async (): Promise<ChromiumLaunchOptions> =>
      mode === 'headless' ? { ...base, userAgent: (await this.ua.get()).userAgent } : base
    let ctx: BrowserContext
    try {
      const options = await build()
      assertOwnProfileDir(options)
      privateFolder(this.downloadRoot(dir), stagingDir)
      ctx = await this.launchContext(options)
    } catch (err) {
      if (BROWSER_MISSING.test(err instanceof Error ? err.message : '')) {
        this.logger.warn('browser launch failed: no browser found', {
          mode,
          channel: this.choice.channel,
        })
        if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true })
        throw new BrowserNotFoundError()
      }
      if (
        mode !== 'headless' ||
        !/version|mismatch|protocol error|unsupported/i.test(
          err instanceof Error ? err.message : '',
        )
      ) {
        this.logger.warn('browser launch failed', {
          mode,
          errorName: err instanceof Error ? err.name : 'unknown',
        })
        if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true })
        throw err
      }
      this.logger.warn('browser launch failed, re-reading the Chrome UA once', { mode })
      this.ua.invalidate()
      const options = await build()
      assertOwnProfileDir(options)
      privateFolder(this.downloadRoot(dir), stagingDir)
      ctx = await this.launchContext(options)
    }
    if (this.shuttingDown) {
      await ctx.close().catch(() => undefined)
      if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true })
      throw new Error('the server is shutting down')
    }
    let nativeDownloads: Entry['downloads']
    try {
      nativeDownloads = await this.nativeDownloads(ctx, stagingDir, dir, mode, () => e.ctx === ctx)
    } catch (error) {
      await this.endDownloadBrowser(ctx, dir)
      fs.rmSync(stagingDir, { recursive: true, force: true })
      throw error
    }
    const generation = ++this.generations
    e.ctx = ctx
    e.mode = mode
    e.extensions = extensions
    e.sync = sync
    e.generation = generation
    e.downloads = nativeDownloads
    e.initial = ctx.pages()
    ctx.on('page', (page) => {
      if (e.ctx !== ctx) return
      for (const cb of [...e.pageListeners]) cb(page)
    })
    ctx.on('close', () => this.ended(e, ctx, generation))
    ctx.browser()?.on('disconnected', () => this.ended(e, ctx, generation))
    this.logger.info('browser launched', { mode, generation, extensions, sync })
    this.armIdle(e)
    return generation
  }
  private ended(e: Entry, ctx: BrowserContext, generation: number): void {
    if (e.ctx !== ctx) return
    this.logger.info('browser ended', { generation })
    if (e.downloads) {
      const kept = e.downloads.router.sweep()
      if (kept.size === 0) fs.rmSync(e.downloads.dir, { recursive: true, force: true })
      else {
        for (const entry of fs.readdirSync(e.downloads.dir))
          if (!kept.has(entry))
            fs.rmSync(path.join(e.downloads.dir, entry), { recursive: true, force: true })
        this.logger.warn(
          'downloads of the user could not be placed and stay in the staging folder',
          { count: kept.size, dir: e.downloads.dir },
        )
      }
    }
    e.downloads = null
    e.ctx = null
    e.initial = []
    this.clearIdle(e)
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
    if (process.platform !== 'win32') fs.chmodSync(root, 0o700)
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
    mode: BrowserMode,
    isCurrent: () => boolean,
  ): Promise<NonNullable<Entry['downloads']>> {
    const session = await ctx.browser()!.newBrowserCDPSession()
    let ending: Promise<void> | undefined
    const end = (): Promise<void> =>
      (ending ??= this.endDownloadBrowser(ctx, profileDir, isCurrent))
    let quota = this.downloadQuotas.get(profileDir)
    if (!quota) {
      quota = new UnclaimedDownloadQuota()
      this.downloadQuotas.set(profileDir, quota)
    }
    const router = new DownloadRouter({
      dir,
      session,
      nativeDir: () => this.downloadRoot(profileDir),
      fallbackDirs: () => [this.downloadRoot(profileDir)],
      logger: this.logger,
      allowUnclaimed: mode === 'visible',
      quota,
      onPolicyFailure: end,
    })
    await session.send('Browser.setDownloadBehavior', {
      behavior: mode === 'headless' ? 'deny' : 'allowAndName',
      downloadPath: dir,
      eventsEnabled: true,
    })
    return { dir, session, captures: 0, chain: Promise.resolve(), router }
  }
  async captureDownloads<T>(profile: string, page: Page, fn: () => Promise<T>): Promise<T> {
    const e = this.entries.get(profile)
    const d = e?.downloads
    const ctx = e?.ctx
    if (!e || !d || !ctx) throw new Error('Plugin unavailable. Try again.')
    const mode = e.mode
    const apply = (): Promise<void> => {
      d.chain = d.chain
        .then(async () => {
          if (e.ctx !== ctx || e.downloads !== d) throw new Error('Plugin unavailable. Try again.')
          await d.session.send('Browser.setDownloadBehavior', {
            behavior: mode === 'headless' && d.captures === 0 ? 'deny' : 'allowAndName',
            downloadPath: d.dir,
            eventsEnabled: true,
          })
        })
        .catch(async (error: unknown) => {
          await this.endDownloadBrowser(ctx, this.dir(profile), () => e.ctx === ctx)
          throw error
        })
      return d.chain
    }
    d.captures++
    const held: {
      session?: Promise<CDPSession>
    } = {}
    const capture = d.router.capture(async () => {
      held.session ??= ctx.newCDPSession(page)
      const tree = (await (await held.session).send('Page.getFrameTree')) as {
        frameTree: FrameTree
      }
      return frameIdsOf(tree.frameTree)
    })
    let completed = false
    try {
      await apply()
      const result = await fn()
      completed = true
      return result
    } finally {
      capture.end(completed)
      void held.session?.then((s) => s.detach()).catch(() => undefined)
      d.captures--
      await apply()
    }
  }
  private async closeNow(e: Entry): Promise<void> {
    const ctx = e.ctx
    if (!ctx) return
    const { generation } = e
    const closed = settledWithin(ctx.close(), this.closeMs).then((ok) => ({ ok }))
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
  }
  async close(profile: string): Promise<void> {
    const e = this.entries.get(profile)
    if (!e) return
    await this.lifecycle(e, async () => {
      if (e.ctx) await e.barrier.transition(() => this.closeNow(e))
    })
  }
  visiblePages(): Array<{
    profile: string
    urls: string[]
  }> {
    const out: Array<{
      profile: string
      urls: string[]
    }> = []
    for (const e of this.entries.values()) {
      if (!e.ctx || e.mode !== 'visible') continue
      try {
        out.push({ profile: e.name, urls: e.ctx.pages().map((p) => p.url()) })
      } catch {
        /* Continue without this optional result. */
      }
    }
    return out
  }
  async closeAll(): Promise<void> {
    this.shuttingDown = true
    await Promise.all(
      [...this.entries.values()].map((e) => this.closeNow(e).catch(() => undefined)),
    )
  }
  async newPage(
    profile: string,
    opts: {
      newWindow: boolean
    },
  ): Promise<Page> {
    const e = this.entries.get(profile)
    const ctx = e?.ctx
    if (!e || !ctx) throw new Error('profile is not open')
    const reuse = e.initial.find(isBlank)
    e.initial = []
    if (reuse) return reuse
    if (opts.newWindow && e.mode === 'visible') return this.newWindowPage(ctx)
    return ctx.newPage()
  }
  private async newWindowPage(ctx: BrowserContext): Promise<Page> {
    const anchor = ctx.pages()[0]
    if (!anchor) return ctx.newPage()
    const session = await ctx.newCDPSession(anchor)
    try {
      const appeared = ctx.waitForEvent('page', { timeout: 10000 })
      await session.send('Target.createTarget', {
        url: 'about:blank',
        newWindow: true,
        background: true,
      })
      return await appeared
    } finally {
      await session.detach().catch(() => undefined)
    }
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
      this.logger.info('window wait ended', { reason, ms: Date.now() - started })
    }
  }
  exclusive<T>(profile: string, fn: () => Promise<T>): Promise<T> {
    return this.serializer.runExclusive(profile, fn)
  }
  operate<T>(profile: string, fn: () => Promise<T>): Promise<T> {
    return this.entry(profile).barrier.runOp(fn)
  }
  touch(profile: string): void {
    const e = this.entries.get(profile)
    if (!e?.ctx) return
    e.touched++
    this.armIdle(e)
  }
  private armIdle(e: Entry): void {
    this.clearIdle(e)
    if (!e.ctx || e.mode === 'visible') return
    e.idleTimer = this.later(() => this.idleFired(e), this.idleMs)
    e.idleTimer.unref?.()
  }
  private clearIdle(e: Entry): void {
    if (e.idleTimer) clearTimeout(e.idleTimer)
    e.idleTimer = null
  }
  private idleFired(e: Entry): void {
    e.idleTimer = null
    if (!e.ctx || e.mode === 'visible') return
    const kept = this.opts.keepRunningFor?.(e.name) === true
    if (kept || e.waiters > 0 || e.barrier.inFlight() > 0) {
      e.idleTimer = this.later(() => this.idleFired(e), this.idleMs)
      e.idleTimer.unref?.()
      return
    }
    const { generation, touched } = e
    void this.exclusive(e.name, async () => {
      if (e.generation !== generation || e.touched !== touched) return
      if (e.mode === 'visible' || this.opts.keepRunningFor?.(e.name) === true) return
      this.logger.info('idle close', { generation })
      await this.close(e.name)
      await this.opts.afterIdleClose?.(e.name)
    }).catch(() => this.logger.warn('idle close failed'))
  }
}
