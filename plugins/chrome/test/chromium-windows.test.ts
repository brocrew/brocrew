import { EventEmitter } from 'node:events'
import type { BrowserContext, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { ChromiumWindows } from '../src/shared/browser/chromiumWindows.js'

class Pg extends EventEmitter {
  closed = false
  constructor(
    readonly ctx: Ctx,
    readonly wid: number,
    private address = 'about:blank',
  ) {
    super()
  }
  context() {
    return this.ctx
  }
  isClosed() {
    return this.closed
  }
  url() {
    return this.address
  }
  async close() {
    this.closed = true
    this.emit('close')
  }
}
class Ctx extends EventEmitter {
  all: Pg[] = []
  sent: Array<{ method: string; params: Record<string, unknown> }> = []
  detached = 0
  fail = ''
  popupFirst = false
  hang = ''
  release: (() => void) | undefined
  hangDetach = false
  redirectWindow = false
  closeAnchor = false
  invalidId = false
  constructor() {
    super()
    this.add(1)
  }
  add(wid: number, address?: string) {
    const page = new Pg(this, wid, address)
    this.all.push(page)
    this.emit('page', page)
    return page
  }
  browser() {
    return {
      newBrowserCDPSession: () => this.newCDPSession(undefined as unknown as Page),
    }
  }
  pages() {
    return this.all.filter((p) => !p.closed) as unknown as Page[]
  }
  async newPage() {
    return this.add(1) as unknown as Page
  }
  async newCDPSession(raw: Page) {
    if (this.hang === 'session')
      await new Promise<void>((resolve) => {
        this.release = resolve
      })
    const page = raw as unknown as Pg
    return {
      detach: async () => {
        this.detached++
        if (this.hangDetach) await new Promise(() => undefined)
      },
      send: async (method: string, params: Record<string, unknown> = {}) => {
        this.sent.push({ method, params })
        if (this.hang === method)
          await new Promise<void>((resolve) => {
            this.release = resolve
          })
        if (this.fail === method) throw new Error('protocol failed')
        if (method === 'Browser.getWindowForTarget')
          return { windowId: this.invalidId ? undefined : page.wid }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 10 }
        if (method === 'Target.createTarget') {
          if (this.popupFirst) this.add(1, 'https://unrelated.test/')
          this.add(2, params.url as string)
          return { targetId: 'mine' }
        }
        if (method === 'Runtime.evaluate') {
          const address = /a.href = (".*?");/.exec(params.expression as string)![1]
          if (this.popupFirst) this.add(99, 'https://unrelated.test/')
          if (this.closeAnchor) await page.close()
          this.add(this.redirectWindow ? 2 : page.wid, JSON.parse(address))
          return {}
        }
        throw new Error(method)
      },
    }
  }
}
const setup = () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin')
  ctx.on('page', (p) => windows.created(p))
  return { ctx, windows }
}

describe('context window selection', () => {
  it('A/B in W1, C/D in W2; windowOf and tool use move preference; listing does not', async () => {
    const { ctx, windows } = setup()
    const a = ctx.pages()[0]
    await windows.used(a)
    const b = await windows.open({ newWindow: false })
    const c = await windows.open({ newWindow: true })
    const d = await windows.open({ newWindow: false })
    expect(await Promise.all([a, b, c, d].map((p) => windows.windowId(p)))).toEqual([1, 1, 2, 2])
    expect(await windows.windowId(await windows.open({ newWindow: false }))).toBe(2)
    await windows.used(a)
    expect(await windows.windowId(await windows.open({ newWindow: false }))).toBe(1)
    expect(await windows.windowId(await windows.open({ newWindow: false, windowOf: c }))).toBe(2)
    expect(ctx.sent.some((s) => /activate|bringToFront|focus/i.test(s.method))).toBe(false)
    const link = ctx.sent.find((s) => s.method === 'Runtime.evaluate')!
    expect(link.params.userGesture).toBe(false)
    expect(link.params.expression).toContain('metaKey: true')
    expect(link.params.expression).toContain("a.rel = 'noopener noreferrer'")
  })
  it('correlates own page when an unrelated popup arrives first and cleans listeners', async () => {
    const { ctx, windows } = setup()
    ctx.popupFirst = true
    const page = await windows.open({ newWindow: true })
    expect(page.url()).toMatch(/^about:blank#new-tab-/)
    expect(ctx.listenerCount('page')).toBe(2)
    const targeted = await windows.open({ newWindow: false, windowOf: page })
    expect(await windows.windowId(targeted)).toBe(2)
    expect(ctx.listenerCount('page')).toBe(2)
  })
  it('rejects closed/foreign anchors and conflict; falls back after recent window closes', async () => {
    const { ctx, windows } = setup()
    const a = ctx.pages()[0]
    const c = await windows.open({ newWindow: true })
    await c.close()
    expect(await windows.latest()).toBe(a)
    await expect(windows.open({ newWindow: false, windowOf: c })).rejects.toThrow('closed')
    await expect(windows.open({ newWindow: true, windowOf: a })).rejects.toThrow('either')
    await expect(windows.windowId(new Ctx().pages()[0])).rejects.toThrow('another profile')
  })
  it('cleans observer and sessions when protocol creation fails', async () => {
    const { ctx, windows } = setup()
    ctx.fail = 'Runtime.evaluate'
    await expect(windows.open({ newWindow: false })).rejects.toThrow('protocol failed')
    expect(ctx.listenerCount('page')).toBe(2)
    expect(ctx.detached).toBeGreaterThan(0)
  })
  it('bounds stalled creation/detach and closes only its late-created page', async () => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin', 20)
    ctx.hang = 'Runtime.evaluate'
    ctx.hangDetach = true
    const began = Date.now()
    await expect(windows.open({ newWindow: false })).rejects.toThrow(/timed out|in time/)
    expect(Date.now() - began).toBeLessThan(500)
    expect(ctx.listenerCount('page')).toBe(1) // only the context-scoped ownership/recency observer
    const old = ctx.all[0]
    ctx.release!()
    await new Promise((r) => setTimeout(r, 5))
    expect(old.closed).toBe(false)
    expect(ctx.all.at(-1)!.closed).toBe(true)
  })
  it('bounds read-only window identity when Chrome stops answering', async () => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin', 20)
    ctx.hang = 'Browser.getWindowForTarget'
    await expect(windows.windowId(ctx.pages()[0])).rejects.toThrow('timed out')
    ctx.release!()
  })

  it('uses background target creation when no existing window remains', async () => {
    const { ctx, windows } = setup()
    await ctx.pages()[0].close()
    const page = await windows.open({ newWindow: false })
    expect(await windows.windowId(page)).toBe(2)
    expect(ctx.sent.find((s) => s.method === 'Target.createTarget')?.params.background).toBe(true)
  })
})

it('a closed targeted window cannot silently fall back: the misdirected owned tab alone is closed', async () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin', 30)
  const original = ctx.pages()[0]
  const unrelated = ctx.add(2, 'https://unrelated.test/')
  ctx.redirectWindow = true
  ctx.closeAnchor = true
  await expect(windows.open({ newWindow: false, windowOf: original })).rejects.toThrow(
    'selected window closed',
  )
  expect(ctx.all.at(-1)!.closed).toBe(true)
  expect(unrelated.closed).toBe(false)
  expect(original.isClosed()).toBe(true)
})
it('bounds CDP session acquisition and detaches a session which arrives after the deadline', async () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin', 20)
  ctx.hang = 'session'
  await expect(windows.windowId(ctx.pages()[0])).rejects.toThrow('timed out')
  ctx.release!()
  await new Promise((r) => setTimeout(r, 5))
  expect(ctx.detached).toBe(1)
  expect(ctx.all.every((p) => !p.closed)).toBe(true)
})
it.each(['Page.getFrameTree', 'Page.createIsolatedWorld'])(
  'bounds stalled %s without affecting other tabs',
  async (method) => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext, 'darwin', 20)
    ctx.hang = method
    await expect(windows.open({ newWindow: false })).rejects.toThrow(/timed out|in time/)
    ctx.release!()
    await new Promise((r) => setTimeout(r, 5))
    expect(ctx.all[0].closed).toBe(false)
  },
)

it('refuses a malformed protocol identity instead of returning a non-numeric windowId', async () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
  ctx.invalidId = true
  await expect(windows.windowId(ctx.pages()[0])).rejects.toThrow('identity is unavailable')
})
