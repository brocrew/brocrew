/** Context-scoped window identity, native background selection and explicit window targeting. */
import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from 'playwright-core'
import type { TabPlacer } from '../../browser/brocrewHelper.js'
import { untilAbort } from '../../browser/waitForBrowser.js'
import { settledWithin } from '../../settled.js'
const MAX_UNRESOLVED = 64
// Cleanup gives Chrome a short chance to answer. An unconfirmed private tab stays quarantined,
// and a missing detach reply does not hold a completed operation.
const CLEANUP_WAIT_MS = 100
export class WindowTargetError extends Error {}
type Attempt = {
  marker: string
  dispatched: boolean
  page?: Page
  resolved: boolean
  failed: boolean
  cleanup?: Promise<boolean>
  appeared?: (page: Page) => void
}
type Operation = { active: boolean; attempts: Attempt[] }
export class ChromiumWindows {
  private sequence = 0
  private pages = new Map<Page, { order: number; windowId?: number }>()
  private recent = new Map<number, number>()
  private operations = new Set<Operation>()
  private markers = new Map<string, Attempt>()
  private ownedPages = new Map<Page, Attempt>()
  private provisional = new Map<Page, () => void>()
  private readonly closed = new AbortController()
  private readonly onPage = (page: Page) => this.created(page)
  private readonly onAdmit?: (page: Page) => void
  private readonly placer?: TabPlacer
  constructor(
    private readonly context: BrowserContext,
    options: {
      onAdmit?: (page: Page) => void
      /** Places a tab in a requested window without showing Chrome; see brocrewHelper.ts. */
      placer?: TabPlacer
    } = {},
  ) {
    this.onAdmit = options.onAdmit
    this.placer = options.placer
    for (const page of context.pages()) this.admit(page)
    context.on('page', this.onPage)
    context.once('close', () => {
      this.closed.abort(new WindowTargetError('the browser is closed'))
      context.off('page', this.onPage)
      for (const [page, changed] of this.provisional) page.off('framenavigated', changed)
      this.provisional.clear()
      this.pages.clear()
      this.recent.clear()
      this.operations.clear()
      this.markers.clear()
      this.ownedPages.clear()
    })
  }
  private signal(request?: AbortSignal): AbortSignal {
    return request ? AbortSignal.any([request, this.closed.signal]) : this.closed.signal
  }
  private async detach(
    session: Awaited<ReturnType<BrowserContext['newCDPSession']>>,
  ): Promise<void> {
    await settledWithin(session.detach(), CLEANUP_WAIT_MS)
  }
  private forgetProvisional(page: Page): void {
    const changed = this.provisional.get(page)
    if (changed) page.off('framenavigated', changed)
    this.provisional.delete(page)
  }
  private quarantine(page: Page): void {
    if (this.provisional.has(page)) return
    const changed = () => this.created(page)
    this.provisional.set(page, changed)
    page.on('framenavigated', changed)
    page.once('close', () => this.forgetProvisional(page))
  }
  /** Tabs this class did not open itself, such as ones Chrome restored, learn their window here. */
  private admit(page: Page, windowId?: number): void {
    if (this.closed.signal.aborted || page.isClosed() || this.pages.has(page)) return
    this.forgetProvisional(page)
    this.pages.set(page, { order: ++this.sequence, windowId })
    page.once('close', () => this.pages.delete(page))
    this.onAdmit?.(page)
    if (windowId === undefined) void this.windowId(page).catch(() => undefined)
  }
  /** Records a tab's window as the most recently used one. */
  private touch(page: Page, windowId: number): boolean {
    const record = this.pages.get(page)
    if (!record) return false
    record.windowId = windowId
    record.order = ++this.sequence
    this.recent.set(windowId, record.order)
    return true
  }
  private releaseOperations(): void {
    for (const operation of this.operations)
      if (!operation.active && operation.attempts.every((a) => !a.dispatched || a.resolved))
        this.operations.delete(operation)
  }
  private resolveAttempt(a: Attempt): void {
    a.resolved = true
    this.markers.delete(a.marker)
    if (a.page) this.ownedPages.delete(a.page)
    this.releaseOperations()
  }
  private claim(page: Page, a: Attempt): void {
    if (a.page && a.page !== page)
      throw new WindowTargetError('the private tab identity is ambiguous')
    if (this.ownedPages.get(page) === a) return
    a.page = page
    this.ownedPages.set(page, a)
    this.quarantine(page)
    a.appeared?.(page)
    page.once('close', () => {
      this.resolveAttempt(a)
      this.flush()
    })
  }
  private cleanupAttempt(a: Attempt): Promise<boolean> {
    if (a.resolved || !a.dispatched) return Promise.resolve(true)
    if (a.cleanup) return a.cleanup
    // Exact correlated identity survives navigation. Never close changed user content or admit it.
    if (!a.page) return Promise.resolve(false)
    if (a.page.isClosed()) {
      this.resolveAttempt(a)
      return Promise.resolve(true)
    }
    if (a.page.url() !== a.marker) return Promise.resolve(false)
    const page = a.page
    a.cleanup = settledWithin(page.close(), CLEANUP_WAIT_MS)
      .then(() => {
        if (!page.isClosed()) return false
        this.resolveAttempt(a)
        return true
      })
      .catch(() => false)
      .finally(() => {
        a.cleanup = undefined
      })
    return a.cleanup
  }
  created(page: Page): void {
    if (this.closed.signal.aborted || page.isClosed()) return
    const attempt = this.ownedPages.get(page) ?? this.markers.get(page.url())
    if (attempt) {
      this.claim(page, attempt)
      if (attempt.failed) void this.cleanupAttempt(attempt)
      return
    }
    if (
      [...this.operations].some((operation) => operation.active) ||
      (this.markers.size && page.url() === 'about:blank')
    ) {
      if (!this.pages.has(page)) this.quarantine(page)
      return
    }
    this.admit(page)
  }
  private flush(): void {
    if (this.closed.signal.aborted || [...this.operations].some((operation) => operation.active))
      return
    for (const page of [...this.provisional.keys()]) this.created(page)
  }
  private check(page: Page): void {
    if (this.closed.signal.aborted || page.isClosed() || page.context() !== this.context)
      throw new WindowTargetError(
        'the selected tab or window is closed or belongs to another profile',
      )
  }
  private async identity(page: Page, signal: AbortSignal): Promise<number> {
    this.check(page)
    signal.throwIfAborted()
    const session = await untilAbort(this.context.newCDPSession(page), signal, (late) => {
      void this.detach(late)
    })
    try {
      signal.throwIfAborted()
      const { windowId } = await untilAbort(session.send('Browser.getWindowForTarget'), signal)
      if (!Number.isInteger(windowId))
        throw new WindowTargetError('the selected window identity is unavailable')
      this.check(page)
      return windowId
    } finally {
      await this.detach(session)
    }
  }
  admittedPages(): Iterable<Page> {
    return this.pages.keys()
  }
  knownWindowId(page: Page): number | undefined {
    return this.pages.get(page)?.windowId
  }
  async windowId(page: Page, request?: AbortSignal): Promise<number> {
    const signal = this.signal(request)
    const id = await this.identity(page, signal)
    signal.throwIfAborted()
    this.created(page)
    const record = this.pages.get(page)
    if (record) {
      record.windowId = id
      this.recent.set(id, Math.max(this.recent.get(id) ?? 0, record.order))
    }
    return id
  }
  async used(page: Page, signal?: AbortSignal): Promise<void> {
    if (!this.touch(page, await this.windowId(page, signal)))
      throw new WindowTargetError('the new tab has not been admitted')
  }
  async latest(signal?: AbortSignal): Promise<Page | undefined> {
    const entries = await Promise.all(
      this.context
        .pages()
        .filter((p) => !p.isClosed() && !this.provisional.has(p))
        .map(async (page) => ({ page, id: await this.windowId(page, signal) })),
    )
    const liveIds = new Set(entries.map((e) => e.id))
    for (const id of this.recent.keys()) if (!liveIds.has(id)) this.recent.delete(id)
    entries.sort((a, b) => (this.recent.get(b.id) ?? 0) - (this.recent.get(a.id) ?? 0))
    return entries[0]?.page
  }
  private async appeared(attempt: Attempt, signal: AbortSignal): Promise<Page> {
    signal.throwIfAborted()
    const page = attempt.page ?? this.context.pages().find((p) => p.url() === attempt.marker)
    if (page) return page
    try {
      return await untilAbort(
        new Promise<Page>((resolve) => {
          attempt.appeared = resolve
        }),
        signal,
      )
    } finally {
      attempt.appeared = undefined
    }
  }
  async open(opts: {
    newWindow: boolean
    windowOf?: Page
    onNote?: (note: string) => void
    signal?: AbortSignal
  }): Promise<Page> {
    const signal = this.signal(opts.signal)
    signal.throwIfAborted()
    if (opts.newWindow && opts.windowOf)
      throw new WindowTargetError('give either newWindow:true or windowOf, not both')
    if (this.operations.size >= MAX_UNRESOLVED)
      throw new WindowTargetError(
        'too many unresolved tab creations; close and reopen this profile before trying again',
      )
    const anchor = opts.windowOf ?? (await this.latest(opts.signal))
    if (anchor) this.check(anchor)
    const separate = opts.newWindow || !anchor
    const preferred = anchor ? await this.identity(anchor, signal) : undefined
    const operation: Operation = { active: true, attempts: [] }
    const { attempts } = operation
    let admittedId: number | undefined
    let admitted: Page | undefined
    if (this.operations.size >= MAX_UNRESOLVED)
      throw new WindowTargetError(
        'too many unresolved tab creations; close and reopen this profile before trying again',
      )
    // One slot owns every dispatched creation until each is resolved.
    this.operations.add(operation)
    const revalidate = async () => {
      if (opts.windowOf) {
        const current = await this.identity(opts.windowOf, signal)
        if (current !== preferred)
          throw new WindowTargetError(
            'the selected window closed or changed before the new tab could be opened',
          )
      }
    }
    const attempt = () => {
      signal.throwIfAborted()
      const a: Attempt = {
        marker: `about:blank#new-tab-${randomUUID()}`,
        dispatched: false,
        resolved: false,
        failed: false,
      }
      attempts.push(a)
      this.markers.set(a.marker, a)
      return a
    }
    let session: Awaited<ReturnType<BrowserContext['newCDPSession']>> | undefined
    try {
      let phase: Attempt | undefined
      if (opts.windowOf) {
        if (!this.placer)
          throw new WindowTargetError(
            'WINDOW_TARGET_UNAVAILABLE: the BroCrew helper cannot select this window; no tab was created',
          )
        await revalidate()
        const placing = attempt()
        placing.dispatched = true
        const placed = await untilAbort(
          this.placer.place(preferred!, placing.marker, signal),
          signal,
          (late) => {
            if (!late.created) this.resolveAttempt(placing)
          },
        )
        if (placed.created) {
          phase = placing
        } else {
          this.resolveAttempt(placing)
          throw new WindowTargetError(
            `WINDOW_TARGET_UNAVAILABLE: helper ${placed.helper}; no tab was created`,
          )
        }
      }
      if (!phase) {
        signal.throwIfAborted()
        const acquiring = anchor
          ? this.context.newCDPSession(anchor)
          : this.context.browser()?.newBrowserCDPSession()
        if (!acquiring) throw new WindowTargetError('the browser is closed')
        session = await untilAbort(acquiring, signal, (late) => {
          void this.detach(late)
        })
        await revalidate()
        const creating = attempt()
        creating.dispatched = true
        await untilAbort(
          session.send('Target.createTarget', {
            url: creating.marker,
            newWindow: separate,
            background: true,
          }),
          signal,
        )
        phase = creating
      }
      this.claim(await this.appeared(phase, signal), phase)
      const id = await this.identity(phase.page!, signal)
      await revalidate()
      if (phase.page!.url() !== phase.marker)
        throw new WindowTargetError('the new tab changed before admission')
      this.check(phase.page!)
      signal.throwIfAborted()
      if (opts.windowOf && preferred !== id)
        throw new WindowTargetError(
          `WINDOW_TARGET_MISMATCH: Chrome placed the tab in window ${id} instead of ${preferred}`,
        )
      admitted = phase.page!
      admittedId = id
      phase.resolved = true
      if (!separate && preferred !== undefined && preferred !== id)
        opts.onNote?.(
          'Chrome opened this tab in a different window from the last tool-used window.',
        )
      return admitted
    } catch (error) {
      for (const a of attempts) {
        if (!a.dispatched || a.resolved) continue
        a.failed = true
        for (const page of this.context.pages()) if (page.url() === a.marker) this.claim(page, a)
      }
      const cleaned = await Promise.all(attempts.map((a) => this.cleanupAttempt(a)))
      if (!cleaned.every(Boolean))
        throw new WindowTargetError(
          `${error instanceof Error ? error.message : 'window operation failed'} Private tab cleanup incomplete; unresolved creations remain quarantined until they close or this profile closes.`,
        )
      throw error
    } finally {
      operation.active = false
      for (const a of attempts) {
        if (!a.dispatched || a.resolved) this.resolveAttempt(a)
      }
      this.releaseOperations()
      if (admitted) this.admit(admitted, admittedId)
      // Failed page identities remain private independently of their current URLs.
      this.flush()
      if (admitted) this.touch(admitted, admittedId!)
      if (session) await this.detach(session)
    }
  }
}
