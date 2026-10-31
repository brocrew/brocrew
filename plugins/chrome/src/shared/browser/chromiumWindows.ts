/** Context-scoped window identity, native background selection and explicit window targeting. */
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext, Page } from 'playwright-core'
const systemMonotonicClock = () => performance.now()
const FALLBACK_NOTE =
  'Opening in the requested window used a fallback that may bring Chrome to the front.'
const MAX_UNRESOLVED = 64
export class WindowTargetError extends Error {}
type Attempt = {
  marker: string
  dispatched: boolean
  page?: Page
  targetId?: string
  resolved: boolean
}
export class ChromiumWindows {
  private sequence = 0
  private pages = new Map<Page, { order: number; windowId?: number }>()
  private recent = new Map<number, number>()
  private lateMarkers = new Set<string>()
  private pendingMarkers = new Set<string>()
  private provisional = new Map<Page, () => void>()
  private reserved = 0
  private closed = false
  private readonly onPage = (page: Page) => this.created(page)
  constructor(
    private readonly context: BrowserContext,
    private readonly platform = process.platform,
    private readonly timeoutMs = 10_000,
    private readonly now = systemMonotonicClock,
    private readonly onAdmit?: (page: Page) => void,
  ) {
    for (const page of context.pages()) this.admit(page)
    context.on('page', this.onPage)
    context.once('close', () => {
      this.closed = true
      context.off('page', this.onPage)
      for (const [page, changed] of this.provisional) page.off('framenavigated', changed)
      this.provisional.clear()
      this.pages.clear()
      this.recent.clear()
      this.lateMarkers.clear()
      this.pendingMarkers.clear()
    })
  }
  private budget(deadline: number): void {
    if (this.now() >= deadline) throw new WindowTargetError('window operation timed out')
  }
  private wait<T>(work: Promise<T>, deadline: number, late?: (value: T) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let done = false
      const timer = setTimeout(
        () => {
          done = true
          reject(new WindowTargetError('window operation timed out'))
        },
        Math.max(0, deadline - this.now()),
      )
      work.then(
        (value) => {
          if (done) {
            late?.(value)
            return
          }
          done = true
          clearTimeout(timer)
          if (this.now() >= deadline) {
            late?.(value)
            reject(new WindowTargetError('window operation timed out'))
            return
          }
          resolve(value)
        },
        (error) => {
          if (done) return
          done = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
  private async detach(
    session: Awaited<ReturnType<BrowserContext['newCDPSession']>>,
  ): Promise<void> {
    await this.wait(session.detach(), this.now() + 100).catch(() => undefined)
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
  private admit(page: Page): void {
    if (this.closed || page.isClosed() || this.pages.has(page)) return
    this.forgetProvisional(page)
    this.pages.set(page, { order: ++this.sequence })
    page.once('close', () => this.pages.delete(page))
    this.onAdmit?.(page)
  }
  created(page: Page): void {
    if (this.closed || page.isClosed()) return
    if (this.lateMarkers.has(page.url())) {
      this.quarantine(page)
      const marker = page.url()
      void this.wait(page.close(), this.now() + 100)
        .then(() => {
          if (page.isClosed()) {
            this.lateMarkers.delete(marker)
            this.flush()
          }
        })
        .catch(() => undefined)
      return
    }
    if (
      this.reserved ||
      this.pendingMarkers.has(page.url()) ||
      (this.lateMarkers.size && page.url() === 'about:blank')
    ) {
      if (!this.pages.has(page)) this.quarantine(page)
      return
    }
    this.admit(page)
  }
  private flush(): void {
    if (this.reserved || this.closed) return
    for (const page of [...this.provisional.keys()]) this.created(page)
  }
  private check(page: Page): void {
    if (this.closed || page.isClosed() || page.context() !== this.context)
      throw new WindowTargetError(
        'the selected tab or window is closed or belongs to another profile',
      )
  }
  private async identity(page: Page, deadline: number): Promise<number> {
    this.check(page)
    this.budget(deadline)
    const session = await this.wait(this.context.newCDPSession(page), deadline, (late) => {
      void this.detach(late)
    })
    try {
      this.budget(deadline)
      const { windowId } = await this.wait(session.send('Browser.getWindowForTarget'), deadline)
      if (!Number.isInteger(windowId))
        throw new WindowTargetError('the selected window identity is unavailable')
      this.check(page)
      return windowId
    } finally {
      await this.detach(session)
    }
  }
  async windowId(page: Page, deadline = this.now() + this.timeoutMs): Promise<number> {
    const id = await this.identity(page, deadline)
    this.budget(deadline)
    this.created(page)
    const record = this.pages.get(page)
    if (record) {
      record.windowId = id
      this.recent.set(id, Math.max(this.recent.get(id) ?? 0, record.order))
    }
    return id
  }
  async used(page: Page): Promise<void> {
    const id = await this.windowId(page)
    const record = this.pages.get(page)
    if (!record) throw new WindowTargetError('the new tab has not been admitted')
    record.order = ++this.sequence
    this.recent.set(id, record.order)
  }
  async latest(deadline = this.now() + this.timeoutMs): Promise<Page | undefined> {
    const entries = await Promise.all(
      this.context
        .pages()
        .filter((p) => !p.isClosed() && !this.provisional.has(p))
        .map(async (page) => ({ page, id: await this.windowId(page, deadline) })),
    )
    const liveIds = new Set(entries.map((e) => e.id))
    for (const id of this.recent.keys()) if (!liveIds.has(id)) this.recent.delete(id)
    entries.sort((a, b) => (this.recent.get(b.id) ?? 0) - (this.recent.get(a.id) ?? 0))
    return entries[0]?.page
  }
  private async appeared(marker: string, deadline: number): Promise<Page> {
    for (;;) {
      if (this.closed) throw new WindowTargetError('the browser is closed')
      this.budget(deadline)
      const page = this.context.pages().find((p) => !p.isClosed() && p.url() === marker)
      if (page) return page
      if (this.now() >= deadline) throw new WindowTargetError('the new tab did not appear in time')
      await delay(Math.min(5, Math.max(0, deadline - this.now())))
    }
  }
  async open(opts: {
    newWindow: boolean
    windowOf?: Page
    onNote?: (note: string) => void
  }): Promise<Page> {
    const deadline = this.now() + this.timeoutMs
    if (opts.newWindow && opts.windowOf)
      throw new WindowTargetError('give either newWindow:true or windowOf, not both')
    if (this.lateMarkers.size + this.reserved + 2 > MAX_UNRESOLVED)
      throw new WindowTargetError(
        'too many unresolved tab creations; close and reopen this profile before trying again',
      )
    const anchor = opts.windowOf ?? (await this.latest(deadline))
    if (anchor) this.check(anchor)
    const separate = opts.newWindow || !anchor
    const preferred = anchor ? await this.identity(anchor, deadline) : undefined
    const attempts: Attempt[] = []
    let fallback = false
    let admitted: Page | undefined
    if (this.lateMarkers.size + this.reserved + 2 > MAX_UNRESOLVED)
      throw new WindowTargetError(
        'too many unresolved tab creations; close and reopen this profile before trying again',
      )
    this.reserved += 2 // reserve both possible phases BEFORE dispatch; never evict late ownership.
    const revalidate = async () => {
      if (opts.windowOf) {
        const current = await this.identity(opts.windowOf, deadline)
        this.budget(deadline)
        if (current !== preferred)
          throw new WindowTargetError(
            'the selected window closed or changed before the new tab could be opened',
          )
      }
    }
    const attempt = () => {
      if (this.closed || this.now() >= deadline)
        throw new WindowTargetError('window operation timed out')
      const a: Attempt = {
        marker: `about:blank#new-tab-${randomUUID()}`,
        dispatched: false,
        resolved: false,
      }
      attempts.push(a)
      this.pendingMarkers.add(a.marker)
      return a
    }
    let session: Awaited<ReturnType<BrowserContext['newCDPSession']>> | undefined
    try {
      this.budget(deadline)
      const acquiring = anchor
        ? this.context.newCDPSession(anchor)
        : this.context.browser()?.newBrowserCDPSession()
      if (!acquiring) throw new WindowTargetError('the browser is closed')
      session = await this.wait(acquiring, deadline, (late) => {
        void this.detach(late)
      })
      await revalidate()
      let phase = attempt()
      phase.dispatched = true
      const target = await this.wait(
        session.send('Target.createTarget', {
          url: phase.marker,
          newWindow: separate,
          background: true,
        }),
        deadline,
      )
      phase.targetId = target.targetId
      phase.page = await this.appeared(phase.marker, deadline)
      let id = await this.identity(phase.page, deadline)
      await revalidate()
      if (opts.windowOf && id !== preferred) {
        if (phase.page.url() !== phase.marker || phase.page.isClosed())
          throw new WindowTargetError('the unused background tab changed before cleanup')
        await this.wait(phase.page.close(), deadline)
        if (!phase.page.isClosed())
          throw new WindowTargetError('the unused background tab could not be closed')
        phase.resolved = true
        this.pendingMarkers.delete(phase.marker)
        await revalidate()
        phase = attempt()
        const { frameTree } = await this.wait(session.send('Page.getFrameTree'), deadline)
        this.budget(deadline)
        const { executionContextId } = await this.wait(
          session.send('Page.createIsolatedWorld', {
            frameId: frameTree.frame.id,
            worldName: 'background-tab',
          }),
          deadline,
        )
        await revalidate()
        const modifier = this.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
        const expression = `(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(phase.marker)}; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dispatchEvent(new MouseEvent('click', { ${modifier}: true })); })()`
        this.budget(deadline)
        fallback = true
        phase.dispatched = true
        const result = await this.wait(
          session.send('Runtime.evaluate', {
            expression,
            contextId: executionContextId,
            userGesture: false,
          }),
          deadline,
        )
        if (result.exceptionDetails)
          throw new WindowTargetError('the tab could not be opened in the selected window')
        phase.page = await this.appeared(phase.marker, deadline)
        id = await this.identity(phase.page, deadline)
        await revalidate()
        if (id !== preferred)
          throw new WindowTargetError(
            'the selected window closed before the new tab could be opened',
          )
      }
      if (phase.page.url() !== phase.marker)
        throw new WindowTargetError('the new tab changed before admission')
      this.check(phase.page)
      this.budget(deadline)
      admitted = phase.page
      phase.resolved = true
      if (fallback) opts.onNote?.(FALLBACK_NOTE)
      else if (!separate && !opts.windowOf && preferred !== undefined && preferred !== id)
        opts.onNote?.(
          'Chrome opened this tab in a different window from the last tool-used window.',
        )
      return admitted
    } catch (error) {
      for (const a of attempts)
        if (a.dispatched && !a.resolved) {
          this.lateMarkers.add(a.marker)
          for (const page of this.context.pages()) if (page.url() === a.marker) this.created(page)
        }
      if (fallback)
        throw new WindowTargetError(
          `${error instanceof Error ? error.message : 'window operation failed'} ${FALLBACK_NOTE}`,
        )
      throw error
    } finally {
      for (const a of attempts) this.pendingMarkers.delete(a.marker)
      this.reserved -= 2
      // Flush in original page-event order; closed probes never increment recency or allocate tab IDs.
      this.flush()
      if (admitted && !this.pages.has(admitted)) this.admit(admitted)
      if (session) await this.detach(session)
    }
  }
}
