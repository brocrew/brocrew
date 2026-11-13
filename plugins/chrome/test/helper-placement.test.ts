import { EventEmitter } from 'node:events'
import type { BrowserContext, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { Placement, TabPlacer } from '../src/browser/brocrewHelper.js'
import { ChromiumWindows } from '../src/shared/browser/chromiumWindows.js'

class Pg extends EventEmitter {
  closed = false
  constructor(
    readonly ctx: Ctx,
    public wid: number,
    public address = 'about:blank',
    readonly owned = false,
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
    if (this.owned && this.ctx.failClose) throw Error('close failed')
    this.closed = true
    this.emit('close')
  }
}
class Ctx extends EventEmitter {
  all: Pg[] = []
  sent: string[] = []
  native = 1
  failClose = false
  constructor() {
    super()
    this.add(1)
  }
  add(wid: number, address = 'about:blank', owned = false) {
    const p = new Pg(this, wid, address, owned)
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
        this.sent.push(method)
        if (method === 'Browser.getWindowForTarget') return { windowId: p.wid }
        // Chrome answers the page-click path too; tests assert it is never taken.
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 3 }
        if (method === 'Runtime.evaluate') {
          const marker = JSON.parse(/a.href = (".*?");/.exec(params.expression as string)![1])
          this.add(p.wid, marker, true)
          return {}
        }
        if (method === 'Target.createTarget') {
          this.add(params.newWindow ? 9 : this.native, params.url as string, true)
          return { targetId: 'owned' }
        }
        throw Error(method)
      },
    }
  }
  owned() {
    return this.all.filter((p) => p.owned)
  }
}
/** A helper whose answer each test chooses; it creates tabs the way Chrome would. */
class Placer implements TabPlacer {
  calls: Array<{ windowId: number; url: string }> = []
  timeouts: number[] = []
  answer: 'create' | Exclude<Placement, { created: true }>['helper'] | 'throw' | 'hang' = 'create'
  landIn: number | undefined
  onCreate: (() => void) | undefined
  release: ((created: boolean) => void) | undefined
  constructor(readonly ctx: Ctx) {}
  private create(windowId: number, url: string): Placement {
    const wid = this.landIn ?? windowId
    this.ctx.add(wid, url, true)
    this.onCreate?.()
    return { created: true, windowId: wid }
  }
  async place(windowId: number, url: string, timeoutMs: number): Promise<Placement> {
    this.calls.push({ windowId, url })
    this.timeouts.push(timeoutMs)
    if (this.answer === 'create') return this.create(windowId, url)
    if (this.answer === 'throw') throw new Error('Execution context was destroyed')
    if (this.answer === 'hang')
      return new Promise((resolve) => {
        this.release = (created) =>
          resolve(created ? this.create(windowId, url) : { created: false, helper: 'unavailable' })
      })
    return { created: false, helper: this.answer }
  }
}
function setup(timeout = 1000) {
  const ctx = new Ctx()
  const placer = new Placer(ctx)
  const published: Page[] = []
  const windows = new ChromiumWindows(ctx as unknown as BrowserContext, {
    timeoutMs: timeout,
    onAdmit: (p) => published.push(p),
    placer,
  })
  published.length = 0
  const anchor = ctx.add(2)
  published.length = 0
  const notes: string[] = []
  const open = () =>
    windows.open({
      newWindow: false,
      windowOf: anchor as unknown as Page,
      onNote: (n) => notes.push(n),
    })
  return { ctx, placer, windows, published, anchor, notes, open }
}
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('a requested window with the BroCrew helper', () => {
  it('places one inactive tab there: no CDP creation, no script, no note', async () => {
    const { ctx, placer, windows, published, notes, open } = setup()
    const page = await open()
    expect(placer.calls).toEqual([{ windowId: 2, url: page.url() }])
    // The helper gets the time left on the call's own deadline, never a clock reading.
    expect(placer.timeouts[0]).toBeGreaterThan(0)
    expect(placer.timeouts[0]).toBeLessThanOrEqual(1000)
    expect(page.url()).toMatch(/^about:blank#new-tab-/)
    expect(await windows.windowId(page)).toBe(2)
    expect(published).toEqual([page])
    expect(notes).toEqual([])
    expect(ctx.sent).not.toContain('Target.createTarget')
    expect(ctx.sent.some((m) => m.startsWith('Runtime.') || /activate|focus/i.test(m))).toBe(false)
  })
  it.each(['off', 'unavailable', 'refused'] as const)(
    'when the helper answers %s, fails clearly without creating elsewhere',
    async (answer) => {
      const { ctx, placer, notes, open } = setup()
      placer.answer = answer
      await expect(open()).rejects.toThrow(`WINDOW_TARGET_UNAVAILABLE: helper ${answer}`)
      expect(ctx.owned()).toEqual([])
      expect(ctx.sent).not.toContain('Target.createTarget')
      expect(notes).toEqual([])
    },
  )
  it('closes a misplaced helper tab and fails without creating a second one', async () => {
    const { ctx, placer, notes, open } = setup()
    placer.landIn = 5
    await expect(open()).rejects.toThrow('WINDOW_TARGET_MISMATCH')
    expect(ctx.owned()).toHaveLength(1)
    expect(ctx.owned()[0].closed).toBe(true)
    expect(ctx.sent).not.toContain('Target.createTarget')
    expect(notes).toEqual([])
  })
  it('fails before creation when no helper can select the requested window', async () => {
    const ctx = new Ctx()
    const windows = new ChromiumWindows(ctx as unknown as BrowserContext)
    await expect(windows.open({ newWindow: false, windowOf: ctx.pages()[0] })).rejects.toThrow(
      'WINDOW_TARGET_UNAVAILABLE',
    )
    expect(ctx.owned()).toEqual([])
    expect(ctx.sent).not.toContain('Target.createTarget')
  })
  it('without a requested window it never asks the helper', async () => {
    const { ctx, placer, windows } = setup()
    await windows.open({ newWindow: false })
    await windows.open({ newWindow: true })
    expect(placer.calls).toEqual([])
    expect(ctx.sent.filter((m) => m === 'Target.createTarget')).toHaveLength(2)
  })
})

describe('an uncertain helper creation is never duplicated', () => {
  it('a reply after the deadline fails the call; the late tab is closed and nothing else is created', async () => {
    const { ctx, placer, published, open } = setup(30)
    placer.answer = 'hang'
    await expect(open()).rejects.toThrow(/timed out/)
    placer.release!(true)
    await settle()
    expect(ctx.owned()).toHaveLength(1)
    expect(ctx.owned()[0].closed).toBe(true)
    expect(ctx.sent).not.toContain('Target.createTarget')
    expect(published).toEqual([])
  })
  it('a worker restart after dispatch fails the call without a background creation; a tab that still arrives is closed', async () => {
    const { ctx, placer, published, open } = setup(60)
    placer.answer = 'throw'
    await expect(open()).rejects.toThrow('Execution context was destroyed')
    expect(ctx.sent).not.toContain('Target.createTarget')
    // Chrome may still deliver the tab the restarted worker asked for.
    const late = ctx.add(2, placer.calls[0].url, true)
    await settle()
    expect(late.closed).toBe(true)
    expect(published).toEqual([])
  })
  it('a requested window removed while the helper works: the helper tab is closed, no second one', async () => {
    const { ctx, placer, anchor, open } = setup()
    placer.onCreate = () => void anchor.close()
    await expect(open()).rejects.toThrow(/closed|another profile/)
    expect(ctx.owned()).toHaveLength(1)
    expect(ctx.owned()[0].closed).toBe(true)
    expect(ctx.sent).not.toContain('Target.createTarget')
  })
  it('a requested window that moves while the helper works fails the same way', async () => {
    const { ctx, placer, anchor, open } = setup()
    placer.onCreate = () => {
      anchor.wid = 44
    }
    await expect(open()).rejects.toThrow('changed')
    expect(ctx.owned().every((p) => p.closed)).toBe(true)
    expect(ctx.sent).not.toContain('Target.createTarget')
  })
  it('a failed close is disclosed, and the tab stays owned and unpublished until it closes', async () => {
    const { ctx, placer, anchor, published, open } = setup()
    placer.onCreate = () => {
      anchor.wid = 44
    }
    ctx.failClose = true
    await expect(open()).rejects.toThrow(/changed.*cleanup incomplete/)
    const stuck = ctx.owned()[0]
    expect(stuck.closed).toBe(false)
    expect(published).toEqual([])
    ctx.failClose = false
    await stuck.close()
    await settle()
    expect(published).toEqual([])
  })
  it('a late "nothing was created" answer releases the slot it held', async () => {
    const { placer, windows, open } = setup(30)
    placer.answer = 'hang'
    for (let n = 0; n < 64; n++) await expect(open()).rejects.toThrow(/timed out/)
    const pending = placer.release
    await expect(windows.open({ newWindow: false })).rejects.toThrow('too many unresolved')
    pending!(false)
    await settle()
    await expect(windows.open({ newWindow: false })).resolves.toBeDefined()
  })
})
