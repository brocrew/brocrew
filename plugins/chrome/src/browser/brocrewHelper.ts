/** BroCrew helper: the one built-in extension this plugin loads into the visible profiles it launches. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, CDPSession, Worker } from 'playwright-core'
import { HELPER_ID, listExtensions } from '../extensions.js'
import type { Logger } from '../logger.js'
import { privateFolder } from '../privatePaths.js'

/** The files this plugin ships for the helper. A copy is loaded only when its bytes match. */
export const HELPER_FILES = Object.freeze([
  {
    name: 'manifest.json',
    sha256: '30f84f31a445122e61ac09c9a7ec18559aa3dc8718702e1f8ed6cece09d5217e',
  },
  { name: 'worker.js', sha256: '03ce208b86c780228ce2068c2d8e02d649c347c5fff8891b056715d2e81edbe9' },
])
const HELPER_PROTOCOL = 1
const HELPER_FOLDER = 'brocrew-helper'
const WORKER_URL = `chrome-extension://${HELPER_ID}/worker.js`
const MAX_FILE_BYTES = 64 * 1024
const INSTALL_MS = 5000
const WORKER_WAIT_MS = 2000
const DETACH_MS = 100

export type HelperState = 'ready' | 'off' | 'unavailable'
/** created: false means nothing was created. A thrown error means a tab may still arrive. */
export type Unplaced = HelperState | 'refused'
export type Placement = { created: true; windowId: number } | { created: false; helper: Unplaced }
export interface TabPlacer {
  /** timeoutMs is the time left for the whole placement, on the caller's own clock. */
  place(windowId: number, url: string, timeoutMs: number): Promise<Placement>
}

class HelperProblem extends Error {
  constructor(readonly code: string) {
    super(`BroCrew helper: ${code}`)
  }
}
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Copies the shipped helper into the profile's own folder; nothing outside it is followed. */
export function copyHelper(source: string, profileDir: string): string {
  const shipped = fs.lstatSync(source)
  if (!shipped.isDirectory() || shipped.isSymbolicLink()) throw new HelperProblem('files')
  const folder = privateFolder(profileDir, path.join(profileDir, HELPER_FOLDER), true)
  const names = new Set(HELPER_FILES.map((file) => file.name))
  for (const entry of fs.readdirSync(folder))
    if (!names.has(entry)) fs.rmSync(path.join(folder, entry), { recursive: true, force: true })
  for (const file of HELPER_FILES) {
    const from = path.join(source, file.name)
    const stat = fs.lstatSync(from)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new HelperProblem('files')
    const bytes = fs.readFileSync(from)
    if (digest(bytes) !== file.sha256) throw new HelperProblem('files')
    const to = path.join(folder, file.name)
    const temporary = `${to}.part`
    fs.rmSync(temporary, { force: true })
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, to)
    const copied = fs.lstatSync(to)
    if (!copied.isFile() || digest(fs.readFileSync(to)) !== file.sha256)
      throw new HelperProblem('files')
  }
  return folder
}

export class BrocrewHelper implements TabPlacer {
  private current: HelperState = 'unavailable'
  private folder: string | undefined
  private waking: Promise<Worker | undefined> | undefined
  private readonly now: () => number
  constructor(
    private readonly o: {
      context: BrowserContext
      profileDir: string
      source: string
      /** False once the browser generation ends, the person turns extensions off, or the plugin stops. */
      allowed: () => boolean
      /** Whether the person has turned the helper off, as this plugin remembers it. */
      rememberedOff: () => boolean
      /** Records the person's switch: off in Chrome's extensions page, or on once it is running. */
      remember: (off: boolean) => void
      logger: Logger
      now?: () => number
    },
  ) {
    this.now = o.now ?? (() => Date.now())
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
  private within<T>(work: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    return Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new HelperProblem('timeout')),
          Math.max(0, deadline - this.now()),
        )
      }),
    ]).finally(() => clearTimeout(timer))
  }
  private async withSession<T>(deadline: number, use: (session: CDPSession) => Promise<T>) {
    const browser = this.o.context.browser()
    if (!browser) throw new HelperProblem('closed')
    const opening = browser.newBrowserCDPSession()
    let session: CDPSession
    try {
      session = await this.within(opening, deadline)
    } catch (error) {
      void opening.then((late) => late.detach()).catch(() => undefined)
      throw error
    }
    try {
      this.recheck()
      return await use(session)
    } finally {
      // Detaching waits on Chrome too; never past the caller's deadline, and never long.
      await this.within(session.detach(), Math.min(deadline, this.now() + DETACH_MS)).catch(
        () => undefined,
      )
    }
  }
  /** true or false when Chrome says; undefined when the helper is not installed; 'unknown' otherwise. */
  private async enabled(
    session: CDPSession,
    deadline: number,
  ): Promise<boolean | undefined | 'unknown'> {
    try {
      const { extensions } = await this.within(session.send('Extensions.getExtensions'), deadline)
      return extensions.find((one) => one.id === HELPER_ID)?.enabled
    } catch (error) {
      if (error instanceof HelperProblem) throw error
      return 'unknown'
    }
  }
  /** The person switched it off in chrome://extensions: remembered, so a restart keeps it off. */
  private turnedOff(): void {
    this.set('off')
    this.o.remember(true)
  }
  /** A stopped worker may mean the person switched the helper off; ask Chrome once. */
  private watch(worker: Worker): void {
    worker.once('close', () => {
      if (this.current !== 'ready') return
      const deadline = this.now() + INSTALL_MS
      void this.withSession(deadline, async (session) => {
        if ((await this.enabled(session, deadline)) === false) this.turnedOff()
      }).catch(() => undefined)
    })
  }
  private live(): Worker | undefined {
    return this.o.context.serviceWorkers().find((worker) => worker.url() === WORKER_URL)
  }
  /** Loads the copy and resolves with the worker that started after the load was asked for. */
  private async load(session: CDPSession, folder: string, deadline: number): Promise<Worker> {
    const { context } = this.o
    let seen: ((worker: Worker) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = new Promise<Worker>((resolve, reject) => {
      seen = (worker) => {
        if (worker.url() === WORKER_URL) resolve(worker)
      }
      context.on('serviceworker', seen)
      timer = setTimeout(
        () => reject(new HelperProblem('no worker')),
        Math.max(0, Math.min(deadline, this.now() + WORKER_WAIT_MS) - this.now()),
      )
    })
    started.catch(() => undefined)
    try {
      const { id } = await this.within(
        session.send('Extensions.loadUnpacked', { path: folder }),
        deadline,
      )
      if (id !== HELPER_ID) throw new HelperProblem('id')
      this.recheck()
      const worker = await started
      this.watch(worker)
      return worker
    } finally {
      clearTimeout(timer)
      if (seen) context.off('serviceworker', seen)
    }
  }
  private async answers(worker: Worker, deadline: number): Promise<void> {
    const protocol = await this.within(
      worker.evaluate(
        () => (globalThis as { brocrewHelper?: { protocol?: unknown } }).brocrewHelper?.protocol,
      ),
      deadline,
    )
    if (protocol !== HELPER_PROTOCOL) throw new HelperProblem('protocol')
    this.recheck()
  }
  /**
   * Installs or updates the helper, unless the person has turned it off. fresh: the person asked
   * for it, so a disabled copy Chrome still lists is not their answer. Never throws.
   */
  async install(timeoutMs = INSTALL_MS, fresh = false): Promise<HelperState> {
    if (!fresh && this.o.rememberedOff()) return this.set('off')
    const deadline = this.now() + timeoutMs
    try {
      return await this.withSession(deadline, async (session) => {
        if (!fresh && (await this.enabled(session, deadline)) === false) {
          this.turnedOff()
          return this.current
        }
        this.recheck()
        this.folder = copyHelper(this.o.source, this.o.profileDir)
        const worker = await this.load(session, this.folder, deadline)
        await this.answers(worker, deadline)
        this.o.remember(false)
        return this.set('ready')
      })
    } catch (error) {
      return this.set('unavailable', error instanceof HelperProblem ? error.code : 'chrome')
    }
  }
  /**
   * The person asked BroCrew to turn the helper on: a fresh install, even over a disabled copy.
   * Only a helper that answers records "on"; otherwise the request stays for the next launch.
   */
  async turnOn(timeoutMs = INSTALL_MS): Promise<HelperState> {
    const deadline = this.now() + timeoutMs
    await this.withSession(deadline, (session) =>
      this.within(session.send('Extensions.uninstall', { id: HELPER_ID }), deadline),
    ).catch(() => undefined)
    return this.install(Math.max(0, deadline - this.now()), true)
  }
  /** Starts a stopped worker, only while Chrome confirms the helper is loaded and on. */
  private wake(deadline: number): Promise<Worker | undefined> {
    this.waking ??= this.withSession(deadline, async (session) => {
      const enabled = await this.enabled(session, deadline)
      if (enabled === false) {
        if (this.current !== 'off') this.turnedOff()
        return undefined
      }
      // Not loaded (removed, or off since launch), or Chrome cannot say: never load it here.
      if (enabled !== true || !this.folder) return undefined
      const worker = this.live() ?? (await this.load(session, this.folder, deadline))
      await this.answers(worker, deadline)
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
  async place(windowId: number, url: string, timeoutMs: number): Promise<Placement> {
    const deadline = this.now() + timeoutMs
    const unplaced = (): Placement => ({
      created: false,
      helper: this.current === 'off' ? 'off' : 'unavailable',
    })
    if (this.current === 'unavailable' || !this.o.allowed()) return unplaced()
    let worker = this.current === 'ready' ? this.live() : undefined
    if (!worker) worker = await this.within(this.wake(deadline), deadline).catch(() => undefined)
    if (!worker || this.current !== 'ready' || !this.o.allowed()) return unplaced()
    // From here Chrome may create the tab even when no answer comes back.
    const answer = (await this.within(
      worker.evaluate(
        ([job, input]) =>
          (
            globalThis as unknown as {
              brocrewHelper: { run(job: string, input: unknown): unknown }
            }
          ).brocrewHelper.run(job, input),
        ['place-tab', { windowId, url }] as const,
      ),
      deadline,
    )) as { ok?: unknown; created?: unknown; windowId?: unknown } | null
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
