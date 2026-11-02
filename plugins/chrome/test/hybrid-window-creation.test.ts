import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { ChromiumWindows } from '../src/shared/browser/chromiumWindows.js'
class Pg extends EventEmitter {
  closed = false
  constructor(
    readonly ctx: Ctx,
    public wid: number,
    public address = 'about:blank',
    readonly probe = false,
  ) {
    super()
  }
  url() {
    return this.address
  }
  context() {
    return this.ctx
  }
  isClosed() {
    return this.closed
  }
  async close() {
    if (this.probe && this.ctx.failClose) throw Error('close failed')
    this.closed = true
    this.emit('close')
  }
}
class Ctx extends EventEmitter {
  all: Pg[] = []
  sent: Array<{ method: string; params: Record<string, unknown> }> = []
  native = 1
  next = 2
  tick: ((method: string) => void) | undefined
  fail = ''
  hang = ''
  release: (() => void) | undefined
  failClose = false
  changeProbe = false
  failProbeIdentity = false
  moveAnchor = false
  closeAnchor = false
  initialBlank = false
  unrelated = false
  constructor() {
    super()
    this.add(1)
  }
  add(wid: number, address = 'about:blank', probe = false) {
    const p = new Pg(this, wid, address, probe)
    this.all.push(p)
    this.emit('page', p)
    return p
  }
  pages() {
    return this.all.filter((p) => !p.closed) as unknown as Page[]
  }
  browser() {
    return { newBrowserCDPSession: () => this.newCDPSession() }
  }
  async newCDPSession(page?: Page) {
    const p = page as unknown as Pg
    return {
      detach: async () => {},
      send: async (method: string, params: Record<string, unknown> = {}) => {
        this.sent.push({ method, params })
        this.tick?.(method)
        if (this.hang === method)
          await new Promise<void>((resolve) => {
            this.release = resolve
          })
        if (this.fail === method) throw Error('protocol failed')
        if (method === 'Browser.getWindowForTarget') {
          if (p?.probe && this.changeProbe) {
            p.address = 'https://changed.fixture/'
            p.emit('framenavigated')
          }
          if (p?.probe && this.failProbeIdentity) throw Error('fixture identity unavailable')
          return { windowId: p.wid }
        }
        // Chrome answers the page-click path too; tests assert it is never taken.
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'fixture-frame' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 }
        if (method === 'Runtime.evaluate') {
          const marker = JSON.parse(/a.href = (".*?");/.exec(params.expression as string)![1])
          this.add(p.wid, marker)
          return {}
        }
        if (method === 'Target.createTarget') {
          if (this.unrelated) this.add(88, 'https://unrelated.test/')
          const q = this.add(
            params.newWindow ? this.next++ : this.native,
            this.initialBlank ? 'about:blank' : (params.url as string),
            true,
          )
          if (this.moveAnchor && p) p.wid = 44
          if (this.closeAnchor && p) await p.close()
          if (this.initialBlank)
            setTimeout(() => {
              q.address = params.url as string
              q.emit('framenavigated')
            }, 5)
          return { targetId: 'owned-' + this.all.indexOf(q) }
        }
        throw Error(method)
      },
    }
  }
}
function setup(timeout = 1000) {
  const ctx = new Ctx(),
    published: Page[] = []
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, {
    timeoutMs: timeout,
    onAdmit: (p) => published.push(p),
  })
  published.length = 0
  return { ctx, windows, published }
}
describe('inactive native selection without the helper', () => {
  it('plain opens use background CDP/native window despite opposed tool recency, with a note', async () => {
    const { ctx, windows } = setup()
    const a = ctx.pages()[0]
    ctx.add(2)
    ctx.native = 2
    await windows.used(a)
    const notes: string[] = []
    const page = await windows.open({ newWindow: false, onNote: (n) => notes.push(n) })
    expect(await windows.windowId(page)).toBe(2)
    expect(notes.join(' ')).toContain('different window')
    expect(ctx.sent.filter((s) => s.method === 'Target.createTarget')).toHaveLength(1)
    expect(ctx.sent.find((s) => s.method === 'Target.createTarget')!.params).toMatchObject({
      background: true,
      newWindow: false,
    })
    expect(ctx.sent.some((s) => s.method === 'Runtime.evaluate')).toBe(false)
  })
  it('matching explicit window uses one background CDP page without a note', async () => {
    const { ctx, windows } = setup()
    const notes: string[] = []
    const page = await windows.open({
      newWindow: false,
      windowOf: ctx.pages()[0],
      onNote: (n) => notes.push(n),
    })
    expect(await windows.windowId(page)).toBe(1)
    expect(notes).toEqual([])
    expect(ctx.sent.some((s) => s.method === 'Runtime.evaluate')).toBe(false)
  })
  it('mismatch keeps the one background tab where Chrome put it and says so', async () => {
    const { ctx, windows, published } = setup()
    const anchor = ctx.add(2)
    published.length = 0
    const notes: string[] = []
    const page = await windows.open({
      newWindow: false,
      windowOf: anchor as unknown as Page,
      onNote: (n) => notes.push(n),
    })
    const created = ctx.all.find((p) => p.probe)!
    expect(page).toBe(created)
    expect(created.closed).toBe(false)
    expect(published).toEqual([page])
    expect(await windows.windowId(page)).toBe(1)
    expect(notes).toEqual([
      'Opened in window 1; the requested window was 2. Chrome chose the window; placing it in another one could bring Chrome to the front.',
    ])
    expect(ctx.sent.filter((s) => s.method === 'Target.createTarget')).toHaveLength(1)
    expect(ctx.sent.some((s) => s.method.startsWith('Runtime.'))).toBe(false)
  })
  it('quarantines initially blank page events and preserves unrelated popup admission', async () => {
    const { ctx, windows, published } = setup()
    const anchor = ctx.add(2)
    published.length = 0
    ctx.initialBlank = true
    ctx.unrelated = true
    const page = await windows.open({ newWindow: false, windowOf: anchor as unknown as Page })
    expect(page).toBe(ctx.all.find((p) => p.probe))
    expect(published.filter((p) => p === page)).toHaveLength(1)
    expect(published.some((p) => p.url() === 'https://unrelated.test/')).toBe(true)
  })
  it.each(['protocol failure', 'anchor movement', 'anchor close'])(
    'fails without a second creation after %s',
    async (fault) => {
      const { ctx, windows } = setup(40)
      const anchor = ctx.add(2)
      if (fault === 'protocol failure') ctx.fail = 'Target.createTarget'
      if (fault === 'anchor movement') ctx.moveAnchor = true
      if (fault === 'anchor close') ctx.closeAnchor = true
      await expect(
        windows.open({ newWindow: false, windowOf: anchor as unknown as Page }),
      ).rejects.toThrow()
      expect(ctx.sent.filter((s) => s.method === 'Target.createTarget')).toHaveLength(1)
      expect(ctx.sent.some((s) => s.method.startsWith('Runtime.'))).toBe(false)
    },
  )
  it('reserves the finite cleanup capacity before concurrent dispatch', async () => {
    const { ctx, windows } = setup(1000)
    ctx.hang = 'Target.createTarget'
    await Promise.allSettled(Array.from({ length: 65 }, () => windows.open({ newWindow: false })))
    expect(ctx.sent.filter((s) => s.method === 'Target.createTarget')).toHaveLength(64)
    ctx.emit('close')
  })
  it('retains bounded unresolved ownership instead of evicting cleanup evidence', async () => {
    const { ctx, windows } = setup()
    ctx.fail = 'Target.createTarget'
    for (let n = 0; n < 64; n++)
      await expect(windows.open({ newWindow: false })).rejects.toThrow('protocol failed')
    const count = ctx.sent.filter((s) => s.method === 'Target.createTarget').length
    await expect(windows.open({ newWindow: false })).rejects.toThrow('too many unresolved')
    expect(ctx.sent.filter((s) => s.method === 'Target.createTarget')).toHaveLength(count)
  })
  it('retains correlated failed page ownership after its URL changes, without public admission', async () => {
    const { ctx, windows, published } = setup()
    const anchor = ctx.add(2)
    published.length = 0
    ctx.changeProbe = true
    await expect(
      windows.open({ newWindow: false, windowOf: anchor as unknown as Page }),
    ).rejects.toThrow('cleanup incomplete')
    const probe = ctx.all.find((p) => p.probe)!
    expect(probe.closed).toBe(false)
    expect(published).not.toContain(probe as unknown as Page)
    // Further navigation and unrelated admission must never release failed ownership.
    probe.address = 'https://changed-again.fixture/'
    probe.emit('framenavigated')
    const unrelated = ctx.add(9, 'https://unrelated.fixture/')
    await windows.used(anchor as unknown as Page)
    expect(await windows.latest()).toBe(anchor)
    expect(published).toContain(unrelated as unknown as Page)
    expect(published).not.toContain(probe as unknown as Page)
    await probe.close()
    ctx.emit('close')
  })
  it('reports incomplete owned cleanup while preserving the primary identity error', async () => {
    const { ctx, windows, published } = setup()
    ctx.failClose = true
    ctx.failProbeIdentity = true
    await expect(windows.open({ newWindow: false })).rejects.toThrow(
      /fixture identity unavailable.*cleanup incomplete/,
    )
    const probe = ctx.all.find((p) => p.probe)!
    expect(probe.closed).toBe(false)
    expect(published).not.toContain(probe as unknown as Page)
    ctx.emit('close')
  })
  it('new windows stay CDP-only', async () => {
    const { ctx, windows } = setup()
    const page = await windows.open({ newWindow: true })
    expect(await windows.windowId(page)).toBe(2)
    expect(ctx.sent.map((s) => s.method)).not.toContain('Runtime.evaluate')
  })
  it('timeout consumes no public probe IDs and closes only the late owned page', async () => {
    const { ctx, windows, published } = setup(20)
    ctx.hang = 'Target.createTarget'
    await expect(windows.open({ newWindow: false })).rejects.toThrow(/timed out|in time/)
    const unrelated = ctx.add(88, 'https://unrelated.test/')
    ctx.release!()
    await new Promise((r) => setTimeout(r, 15))
    expect(ctx.all.find((p) => p.probe)?.closed).toBe(true)
    expect(unrelated.closed).toBe(false)
    expect(published.some((p) => p.url().startsWith('about:blank#new-tab-'))).toBe(false)
  })
})
