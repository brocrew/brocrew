/** Context-scoped Chromium window identity, recent-window selection and background tab creation. */
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
const systemMonotonicClock = () => performance.now()
import type { BrowserContext, Page } from 'playwright-core'

export class WindowTargetError extends Error {}

export class ChromiumWindows {
  private sequence = 0
  private pages = new Map<Page, { order: number; windowId?: number }>()
  private recent = new Map<number, number>()
  private lateMarkers = new Set<string>()
  private readonly onPage = (page: Page) => this.created(page)
  constructor(
    private readonly context: BrowserContext,
    private readonly platform = process.platform,
    private readonly timeoutMs = 10_000,
    private readonly now = systemMonotonicClock,
  ) {
    for (const page of context.pages()) this.created(page)
    context.on('page', this.onPage)
    context.once('close', () => {
      context.off('page', this.onPage)
      this.pages.clear()
      this.recent.clear()
      this.lateMarkers.clear()
    })
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
  created(page: Page): void {
    if (this.lateMarkers.delete(page.url())) {
      void this.wait(page.close(), this.now() + 100).catch(() => undefined)
      return
    }
    if (!this.pages.has(page)) {
      this.pages.set(page, { order: ++this.sequence })
      page.once('close', () => this.pages.delete(page))
    }
  }
  private check(page: Page): void {
    if (page.isClosed() || page.context() !== this.context)
      throw new WindowTargetError(
        'the selected tab or window is closed or belongs to another profile',
      )
  }
  async windowId(page: Page, deadline = this.now() + this.timeoutMs): Promise<number> {
    this.check(page)
    const session = await this.wait(this.context.newCDPSession(page), deadline, (late) => {
      void this.detach(late)
    })
    try {
      const { windowId } = await this.wait(session.send('Browser.getWindowForTarget'), deadline)
      if (!Number.isInteger(windowId))
        throw new WindowTargetError('the selected window identity is unavailable')
      this.check(page)
      this.created(page)
      const record = this.pages.get(page)!
      record.windowId = windowId
      this.recent.set(windowId, Math.max(this.recent.get(windowId) ?? 0, record.order))
      return windowId
    } finally {
      await this.detach(session)
    }
  }
  async used(page: Page): Promise<void> {
    const id = await this.windowId(page)
    const order = ++this.sequence
    this.pages.get(page)!.order = order
    this.recent.set(id, order)
  }
  async latest(deadline = this.now() + this.timeoutMs): Promise<Page | undefined> {
    const live = this.context.pages().filter((p) => !p.isClosed())
    const entries = await Promise.all(
      live.map(async (page) => ({
        page,
        id: await this.windowId(page, deadline),
      })),
    )
    const liveIds = new Set(entries.map((entry) => entry.id))
    for (const id of this.recent.keys()) if (!liveIds.has(id)) this.recent.delete(id)
    entries.sort((a, b) => (this.recent.get(b.id) ?? 0) - (this.recent.get(a.id) ?? 0))
    return entries[0]?.page
  }
  async open(opts: { newWindow: boolean; windowOf?: Page }): Promise<Page> {
    const deadline = this.now() + this.timeoutMs
    if (opts.newWindow && opts.windowOf)
      throw new WindowTargetError('give either newWindow:true or windowOf, not both')
    const anchor = opts.windowOf ?? (await this.latest(deadline))
    if (anchor) this.check(anchor)
    const createWindow = opts.newWindow || !anchor
    const expectedWindow = createWindow ? undefined : await this.windowId(anchor!, deadline)
    // A unique blank address correlates ONLY our page, even if unrelated popups arrive first.
    const marker = `about:blank#new-tab-${randomUUID()}`
    let listener: (page: Page) => void
    let timer: ReturnType<typeof setTimeout>
    let rejectPage!: (error: Error) => void
    const appeared = new Promise<Page>((resolve, reject) => {
      rejectPage = reject
      listener = (page) => {
        if (page.url() === marker) resolve(page)
      }
      this.context.on('page', listener)
      timer = setTimeout(
        () => reject(new WindowTargetError('the new tab did not appear in time')),
        Math.max(0, deadline - this.now()),
      )
    })
    void appeared.catch(() => undefined)
    let session: Awaited<ReturnType<BrowserContext['newCDPSession']>> | undefined
    try {
      const acquiring = anchor
        ? this.context.newCDPSession(anchor)
        : this.context.browser()?.newBrowserCDPSession()
      if (!acquiring) throw new WindowTargetError('the browser is closed')
      session = await this.wait(acquiring, deadline, (late) => {
        void this.detach(late)
      })
      if (createWindow) {
        await this.wait(
          session.send('Target.createTarget', {
            url: marker,
            newWindow: true,
            background: true,
          }),
          deadline,
        )
      } else {
        const { frameTree } = await this.wait(session.send('Page.getFrameTree'), deadline)
        const { executionContextId } = await this.wait(
          session.send('Page.createIsolatedWorld', {
            frameId: frameTree.frame.id,
            worldName: 'background-tab',
          }),
          deadline,
        )
        // Native modified-link disposition = background tab in the source window. The detached node cannot
        // reach site listeners; the isolated world avoids site overrides; noopener prevents opener access.
        const modifier = this.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
        const expression = `(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(marker)}; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dispatchEvent(new MouseEvent('click', { ${modifier}: true })); })()`
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
      }
      const page = await appeared
      if (
        expectedWindow !== undefined &&
        (await this.windowId(page, deadline)) !== expectedWindow
      ) {
        await this.wait(page.close(), deadline).catch(() => undefined)
        throw new WindowTargetError('the selected window closed before the new tab could be opened')
      }
      const id = await this.windowId(page, deadline)
      const order = ++this.sequence
      this.pages.get(page)!.order = order
      this.recent.set(id, order)
      return page
    } catch (error) {
      // The command may still create its page after our deadline. The context-scoped page listener owns
      // only this unpredictable marker and closes that late page, never a pre-existing/user page.
      this.lateMarkers.add(marker)
      for (const page of this.context.pages()) if (page.url() === marker) this.created(page)
      rejectPage(new WindowTargetError('the tab could not be opened in the selected window'))
      throw error
    } finally {
      clearTimeout(timer!)
      this.context.off('page', listener!)
      if (session) await this.detach(session)
    }
  }
}
