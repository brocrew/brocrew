import { EventEmitter } from 'node:events'
import type { BrowserContext, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
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
  onHang: (() => void) | undefined
  hangDetach = false
  closeAnchor = false
  invalidId = false
  nativeWindow = 1
  nextWindow = 2
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
        this.onHang?.()
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
            this.onHang?.()
          })
        if (this.fail === method) throw new Error('protocol failed')
        if (method === 'Browser.getWindowForTarget')
          return { windowId: this.invalidId ? undefined : page.wid }
        // Chrome answers the page-click path too; tests assert it is never taken.
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 10 }
        if (method === 'Runtime.evaluate') {
          const address = /a.href = (".*?");/.exec(params.expression as string)![1]
          this.add(page.wid, JSON.parse(address))
          return {}
        }
        if (method === 'Target.createTarget') {
          if (this.popupFirst) this.add(1, 'https://unrelated.test/')
          if (this.closeAnchor && page) await page.close()
          this.add(params.newWindow ? this.nextWindow++ : this.nativeWindow, params.url as string)
          return { targetId: 'mine' }
        }
        throw new Error(method)
      },
    }
  }
}
const setup = () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
  ctx.on('page', (p) => windows.created(p))
  return { ctx, windows }
}

describe('context window selection', () => {
  it('default follows native selection; explicit targeting without the helper creates nothing', async () => {
    const { ctx, windows } = setup()
    const a = ctx.pages()[0]
    await windows.used(a)
    const b = await windows.open({ newWindow: false })
    const c = await windows.open({ newWindow: true })
    const d = await windows.open({ newWindow: false })
    expect(await Promise.all([a, b, c, d].map((p) => windows.windowId(p)))).toEqual([1, 1, 2, 1])
    expect(await windows.windowId(await windows.open({ newWindow: false }))).toBe(1)
    await windows.used(a)
    expect(await windows.windowId(await windows.open({ newWindow: false }))).toBe(1)
    const count = ctx.all.length
    await expect(windows.open({ newWindow: false, windowOf: c })).rejects.toThrow(
      'WINDOW_TARGET_UNAVAILABLE',
    )
    expect(ctx.all).toHaveLength(count)
    expect(ctx.sent.some((s) => /activate|bringToFront|focus|Runtime\./i.test(s.method))).toBe(
      false,
    )
  })
  it('correlates own page when an unrelated popup arrives first and cleans listeners', async () => {
    const { ctx, windows } = setup()
    ctx.popupFirst = true
    const page = await windows.open({ newWindow: true })
    expect(page.url()).toMatch(/^about:blank#new-tab-/)
    expect(ctx.listenerCount('page')).toBe(2)
    const targeted = await windows.open({ newWindow: false })
    expect(targeted.url()).toMatch(/^about:blank#new-tab-/)
    expect(await windows.windowId(targeted)).toBe(1)
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
    ctx.fail = 'Target.createTarget'
    await expect(windows.open({ newWindow: false })).rejects.toThrow('protocol failed')
    expect(ctx.listenerCount('page')).toBe(2)
    expect(ctx.detached).toBeGreaterThan(0)
  })
  it('cancels a stalled creation and closes only its late-created page even if detach hangs', async () => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
    const request = new AbortController()
    ctx.hang = 'Target.createTarget'
    ctx.onHang = () => request.abort(new Error('cancelled'))
    ctx.hangDetach = true
    const began = Date.now()
    await expect(windows.open({ newWindow: false, signal: request.signal })).rejects.toThrow(
      'cancelled',
    )
    expect(Date.now() - began).toBeLessThan(1500)
    expect(ctx.listenerCount('page')).toBe(1) // only the context-scoped ownership/recency observer
    const old = ctx.all[0]
    ctx.release!()
    await new Promise((r) => setTimeout(r, 5))
    expect(old.closed).toBe(false)
    expect(ctx.all.at(-1)!.closed).toBe(true)
  })
  it('ends a pending window identity read when Chrome closes', async () => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
    ctx.hang = 'Browser.getWindowForTarget'
    ctx.onHang = () => ctx.emit('close')
    await expect(windows.windowId(ctx.pages()[0])).rejects.toThrow('the browser is closed')
    ctx.release!()
  })

  it('admits a tab when Chrome answers after ten seconds', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, windows } = setup()
      ctx.hang = 'Target.createTarget'
      const opening = windows.open({ newWindow: false }).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(10_001)
      ctx.release!()
      expect(await opening).toBe(ctx.pages().at(-1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses background target creation when no existing window remains', async () => {
    const { ctx, windows } = setup()
    await ctx.pages()[0].close()
    const page = await windows.open({ newWindow: false })
    expect(await windows.windowId(page)).toBe(2)
    expect(ctx.sent.find((s) => s.method === 'Target.createTarget')?.params.background).toBe(true)
  })
})

it('a targeted window that closes during creation fails: the owned tab alone is closed', async () => {
  const ctx = new Ctx()
  const original = ctx.pages()[0]
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, {
    placer: {
      async place(windowId, url) {
        ctx.add(windowId, url)
        await original.close()
        return { created: true, windowId }
      },
    },
  })
  const unrelated = ctx.add(2, 'https://unrelated.test/')
  ctx.closeAnchor = true
  await expect(windows.open({ newWindow: false, windowOf: original })).rejects.toThrow(
    /closed|changed/,
  )
  expect(ctx.all.at(-1)!.closed).toBe(true)
  expect(unrelated.closed).toBe(false)
  expect(original.isClosed()).toBe(true)
})
it('tabs Chrome restored before the profile opened, and tabs opened outside the tools, know their real window', async () => {
  const ctx = new Ctx()
  const restored = ctx.add(5, 'https://restored.test/')
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
  const later = ctx.add(7, 'https://opened-by-the-person.test/')
  await new Promise((r) => setTimeout(r, 5))
  expect(windows.knownWindowId(ctx.pages()[0])).toBe(1)
  expect(windows.knownWindowId(restored as unknown as Page)).toBe(5)
  expect(windows.knownWindowId(later as unknown as Page)).toBe(7)
})
it('a tab it opens knows its window and becomes the most recent one with no second lookup', async () => {
  const { ctx, windows } = setup()
  await new Promise((r) => setTimeout(r, 5))
  const lookups = () => ctx.sent.filter((s) => s.method === 'Browser.getWindowForTarget').length
  const page = await windows.open({ newWindow: true })
  const after = lookups()
  await new Promise((r) => setTimeout(r, 5))
  expect(lookups()).toBe(after)
  expect(windows.knownWindowId(page)).toBe(2)
  expect(await windows.latest()).toBe(page)
})
it('cancels CDP session acquisition and detaches a session which arrives later', async () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
  await new Promise((r) => setTimeout(r, 5))
  const before = ctx.detached
  const request = new AbortController()
  ctx.hang = 'session'
  ctx.onHang = () => request.abort(new Error('cancelled'))
  await expect(windows.windowId(ctx.pages()[0], request.signal)).rejects.toThrow('cancelled')
  ctx.release!()
  await new Promise((r) => setTimeout(r, 5))
  expect(ctx.detached - before).toBe(1)
  expect(ctx.all.every((p) => !p.closed)).toBe(true)
})
it('refuses a malformed protocol identity instead of returning a non-numeric windowId', async () => {
  const ctx = new Ctx()
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
  ctx.invalidId = true
  await expect(windows.windowId(ctx.pages()[0])).rejects.toThrow('identity is unavailable')
})
