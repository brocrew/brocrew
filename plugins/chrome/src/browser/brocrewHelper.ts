/** BroCrew helper: the one built-in extension this plugin loads into the visible profiles it launches. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, CDPSession, Worker } from 'playwright-core'
import { HELPER_ID, listExtensions } from '../extensions.js'
import type { Logger } from '../logger.js'
import { privateFolder } from '../privatePaths.js'
import { settledWithin } from '../settled.js'
import { untilAbort } from './waitForBrowser.js'

/** The files this plugin ships for the helper. A copy is loaded only when its bytes match. */
export const HELPER_FILES = Object.freeze([
  {
    name: 'manifest.json',
    sha256: '30f84f31a445122e61ac09c9a7ec18559aa3dc8718702e1f8ed6cece09d5217e',
  },
  { name: 'worker.js', sha256: '03ce208b86c780228ce2068c2d8e02d649c347c5fff8891b056715d2e81edbe9' },
])
export const HELPER_PROTOCOL = 1
export const HELPER_VERSION = `p${HELPER_PROTOCOL}-${createHash('sha256').update(JSON.stringify(HELPER_FILES)).digest('hex')}`
const HELPER_FOLDER = 'brocrew-helper'
const WORKER_URL = `chrome-extension://${HELPER_ID}/worker.js`
const MAX_FILE_BYTES = 64 * 1024
// Detach is best-effort cleanup. A missing reply must not hold a completed browser operation.
const DETACH_MS = 100

export type HelperState = 'ready' | 'off' | 'unavailable'
/** created: false means nothing was created. A thrown error means a tab may still arrive. */
type Unplaced = HelperState | 'refused'
type Installation = {
  fresh: boolean
  cancel: AbortController
  ready: Promise<HelperState>
}
export type Placement = { created: true; windowId: number } | { created: false; helper: Unplaced }
export interface TabPlacer {
  place(windowId: number, url: string, signal?: AbortSignal): Promise<Placement>
}

class HelperProblem extends Error {
  constructor(readonly code: string) {
    super(`BroCrew helper: ${code}`)
  }
}
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Publishes a verified immutable version; never edits or removes an existing holder's files. */
export function copyHelper(source: string, profileDir: string, helperDir?: string): string {
  const shipped = fs.lstatSync(source)
  if (!shipped.isDirectory() || shipped.isSymbolicLink()) throw new HelperProblem('files')
  const files = HELPER_FILES.map((file) => {
    const from = path.join(source, file.name)
    const stat = fs.lstatSync(from)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new HelperProblem('files')
    const bytes = fs.readFileSync(from)
    if (digest(bytes) !== file.sha256) throw new HelperProblem('files')
    return { ...file, bytes }
  })
  const root = helperDir
    ? privateFolder(path.dirname(helperDir), helperDir, true)
    : privateFolder(profileDir, path.join(profileDir, HELPER_FOLDER), true)
  const folder = privateFolder(root, path.join(root, HELPER_VERSION))
  const verify = () => {
    privateFolder(root, folder)
    const names = fs.readdirSync(folder).sort()
    if (
      names.join('\n') !==
      files
        .map((file) => file.name)
        .sort()
        .join('\n')
    )
      throw new HelperProblem('files')
    for (const file of files) {
      const target = path.join(folder, file.name)
      const stat = fs.lstatSync(target)
      if (
        !stat.isFile() ||
        stat.size > MAX_FILE_BYTES ||
        digest(fs.readFileSync(target)) !== file.sha256
      )
        throw new HelperProblem('files')
    }
  }
  if (fs.existsSync(folder)) {
    verify()
    return folder
  }
  const staging = fs.mkdtempSync(path.join(root, '.preparing-'))
  try {
    for (const file of files)
      fs.writeFileSync(path.join(staging, file.name), file.bytes, { flag: 'wx', mode: 0o600 })
    try {
      fs.renameSync(staging, folder)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error
    }
    verify()
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return folder
}

export class BrocrewHelper implements TabPlacer {
  private current: HelperState = 'unavailable'
  private folder: string | undefined
  private installing: Installation | undefined
  private waking: Promise<Worker | undefined> | undefined
  private readonly closed = new AbortController()
  constructor(
    private readonly o: {
      context: BrowserContext
      profileDir: string
      source: string
      /** Host-authorized shared helper root; absent keeps helper files local. */
      helperDir?: string
      /** False once the browser generation ends, the person turns extensions off, or the plugin stops. */
      allowed: () => boolean
      /** Whether the person has turned the helper off, as this plugin remembers it. */
      rememberedOff: () => boolean
      /** Records the person's switch: off in Chrome's extensions page, or on once it is running. */
      remember: (off: boolean) => void
      logger: Logger
    },
  ) {
    o.context.once('close', () => this.closed.abort(new HelperProblem('closed')))
  }
  get state(): HelperState {
    return this.current
  }
  private set(state: HelperState, code?: string): HelperState {
    if (state !== this.current || code)
      this.o.logger.info('BroCrew helper', { state, ...(code ? { reason: code } : {}) })
    this.current = state
    return state
  }
  private recheck(): void {
    if (!this.o.allowed()) throw new HelperProblem('profile changed')
  }
  private wait<T>(work: Promise<T>, signal = this.closed.signal): Promise<T> {
    return untilAbort(work, signal)
  }
  private async withSession<T>(
    use: (session: CDPSession) => Promise<T>,
    signal = this.closed.signal,
  ) {
    this.recheck()
    signal.throwIfAborted()
    const browser = this.o.context.browser()
    if (!browser) throw new HelperProblem('closed')
    const session = await untilAbort(browser.newBrowserCDPSession(), signal, (late) => {
      void late.detach().catch(() => undefined)
    })
    let result: T
    try {
      this.recheck()
      signal.throwIfAborted()
      result = await use(session)
    } finally {
      await settledWithin(session.detach(), DETACH_MS)
    }
    this.recheck()
    return result
  }
  /** true or false when Chrome says; undefined when the helper is not installed; 'unknown' otherwise. */
  private async enabled(
    session: CDPSession,
    signal = this.closed.signal,
  ): Promise<boolean | undefined | 'unknown'> {
    try {
      this.recheck()
      const { extensions } = await this.wait(session.send('Extensions.getExtensions'), signal)
      this.recheck()
      return extensions.find((one) => one.id === HELPER_ID)?.enabled
    } catch (error) {
      if (error instanceof HelperProblem) throw error
      return 'unknown'
    }
  }
  /** The person switched it off in chrome://extensions: remembered, so a restart keeps it off. */
  private turnedOff(): void {
    this.recheck()
    this.set('off')
    this.o.remember(true)
  }
  /** A stopped worker may mean the person switched the helper off; ask Chrome once. */
  private watch(worker: Worker): void {
    worker.once('close', () => {
      if (this.current !== 'ready') return
      void this.withSession(async (session) => {
        if ((await this.enabled(session)) === false) this.turnedOff()
      }).catch(() => undefined)
    })
  }
  private live(): Worker | undefined {
    return this.o.context.serviceWorkers().find((worker) => worker.url() === WORKER_URL)
  }
  /** Loads the copy and resolves with the worker that started after the load was asked for. */
  private async load(
    session: CDPSession,
    folder: string,
    signal = this.closed.signal,
  ): Promise<Worker> {
    const { context } = this.o
    let seen!: (worker: Worker) => void
    const started = new Promise<Worker>((resolve) => {
      seen = (worker) => {
        if (worker.url() === WORKER_URL) resolve(worker)
      }
      context.on('serviceworker', seen)
    })
    try {
      this.recheck()
      signal.throwIfAborted()
      const { id } = await this.wait(
        session.send('Extensions.loadUnpacked', { path: folder }),
        signal,
      )
      if (id !== HELPER_ID) throw new HelperProblem('id')
      this.recheck()
      const worker = await this.wait(started, signal)
      this.recheck()
      this.watch(worker)
      return worker
    } finally {
      context.off('serviceworker', seen)
    }
  }
  private async answers(worker: Worker, signal = this.closed.signal): Promise<void> {
    this.recheck()
    signal.throwIfAborted()
    const protocol = await this.wait(
      worker.evaluate(
        () => (globalThis as { brocrewHelper?: { protocol?: unknown } }).brocrewHelper?.protocol,
      ),
      signal,
    )
    if (protocol !== HELPER_PROTOCOL) throw new HelperProblem('protocol')
    this.recheck()
  }
  /**
   * Installs or updates the helper, unless the person has turned it off.
   */
  async install(): Promise<HelperState> {
    if (this.o.rememberedOff()) return this.set('off')
    return this.startInstall(false)
  }
  private startInstall(fresh: boolean): Promise<HelperState> {
    if (this.installing && (!fresh || this.installing.fresh)) return this.installing.ready
    this.installing?.cancel.abort(new HelperProblem('superseded'))
    const cancel = new AbortController()
    const signal = AbortSignal.any([cancel.signal, this.closed.signal])
    const ready = this.prepare(fresh, signal).finally(() => {
      if (this.installing?.cancel === cancel) this.installing = undefined
    })
    this.installing = { fresh, cancel, ready }
    return ready
  }
  private async prepare(fresh: boolean, signal: AbortSignal): Promise<HelperState> {
    try {
      return await this.withSession(async (session) => {
        if (fresh) {
          await this.wait(session.send('Extensions.uninstall', { id: HELPER_ID }), signal).catch(
            () => undefined,
          )
        } else if ((await this.enabled(session, signal)) === false) {
          signal.throwIfAborted()
          this.turnedOff()
          return this.current
        }
        signal.throwIfAborted()
        this.recheck()
        this.folder = copyHelper(this.o.source, this.o.profileDir, this.o.helperDir)
        const worker = await this.load(session, this.folder, signal)
        await this.answers(worker, signal)
        signal.throwIfAborted()
        this.recheck()
        this.o.remember(false)
        return this.set('ready')
      }, signal)
    } catch (error) {
      if (signal.aborted && !this.closed.signal.aborted) return this.current
      return this.set('unavailable', error instanceof HelperProblem ? error.code : 'chrome')
    }
  }
  /**
   * The person asked BroCrew to turn the helper on: a fresh install, even over a disabled copy.
   * Only a helper that answers records "on"; otherwise the request stays for the next launch.
   */
  turnOn(): Promise<HelperState> {
    return this.startInstall(true)
  }
  /** Starts a stopped worker, only while Chrome confirms the helper is loaded and on. */
  private wake(): Promise<Worker | undefined> {
    this.waking ??= this.withSession(async (session) => {
      const enabled = await this.enabled(session)
      if (enabled === false) {
        if (this.current !== 'off') this.turnedOff()
        return undefined
      }
      // Not loaded (removed, or off since launch), or Chrome cannot say: never load it here.
      if (enabled !== true || !this.folder) return undefined
      const worker = this.live() ?? (await this.load(session, this.folder))
      await this.answers(worker)
      // Switched back on in chrome://extensions during this session.
      if (this.current === 'off') this.o.remember(false)
      this.set('ready')
      return worker
    })
      .catch(() => undefined)
      .finally(() => {
        this.waking = undefined
      })
    return this.waking
  }
  async place(windowId: number, url: string, request?: AbortSignal): Promise<Placement> {
    const signal = request ? AbortSignal.any([request, this.closed.signal]) : this.closed.signal
    const unplaced = (): Placement => ({
      created: false,
      helper: this.current === 'off' ? 'off' : 'unavailable',
    })
    while (this.installing && !signal.aborted)
      await untilAbort(this.installing.ready, signal).catch(() => undefined)
    if (signal.aborted || this.current === 'unavailable' || !this.o.allowed()) return unplaced()
    let worker = this.current === 'ready' ? this.live() : undefined
    if (!worker) worker = await untilAbort(this.wake(), signal).catch(() => undefined)
    if (signal.aborted || !worker || this.current !== 'ready' || !this.o.allowed())
      return unplaced()
    // After dispatch the window tracker cancels the caller and keeps observing this reply.
    const answer = (await this.wait(
      worker.evaluate(
        ([job, input]) =>
          (
            globalThis as unknown as {
              brocrewHelper: { run(job: string, input: unknown): unknown }
            }
          ).brocrewHelper.run(job, input),
        ['place-tab', { windowId, url }] as const,
      ),
    )) as { ok?: unknown; created?: unknown; windowId?: unknown } | null
    this.recheck()
    if (answer?.ok === true && Number.isSafeInteger(answer.windowId))
      return { created: true, windowId: answer.windowId as number }
    if (answer?.ok === false && answer.created === false)
      return { created: false, helper: 'refused' }
    throw new HelperProblem('unclear answer')
  }
}

/** Whether Chrome's last session recorded the person switching the helper off. Read before launch:
 * Chrome drops a helper loaded over the debugging pipe, and its record, at its next start. */
export function offInLastSession(profileDir: string): boolean {
  try {
    return listExtensions(profileDir).find((one) => one.id === HELPER_ID)?.enabled === false
  } catch {
    return false
  }
}
