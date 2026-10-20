import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright-core'
import type { BrowserMode, ProfileBrowser } from '../src/browser/profileBrowser.js'
import type { KeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { createProfileStore } from '../src/profiles/store.js'
import type { ProfileStore } from '../src/profiles/store.js'
import { TabRegistry } from '../src/tabs.js'
import { createWindowTasks } from '../src/windows.js'
import type { WindowTasks } from '../src/windows.js'
import type { ToolDeps } from '../src/tools/index.js'
import { createAgentChromeTools } from '../src/tools/index.js'
export function tmpDir(prefix = 'agent-chrome-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}
export class FakeLocator {
  calls: Array<[string, unknown?]> = []
  constructor(
    readonly selector: string,
    private readonly onCall?: (name: string, arg: unknown) => unknown,
  ) {}
  private rec(name: string, arg?: unknown): Promise<unknown> {
    this.calls.push([name, arg])
    return Promise.resolve(this.onCall?.(name, arg))
  }
  click(o?: unknown) {
    return this.rec('click', o)
  }
  dblclick(o?: unknown) {
    return this.rec('dblclick', o)
  }
  fill(t: string, o?: unknown) {
    return this.rec('fill', { t, o })
  }
  press(k: string, o?: unknown) {
    return this.rec('press', { k, o })
  }
  hover(o?: unknown) {
    return this.rec('hover', o)
  }
  pressSequentially(t: string, o?: unknown) {
    return this.rec('pressSequentially', { t, o })
  }
  selectOption(v: string[]) {
    return this.rec('selectOption', v).then(() => v)
  }
  setInputFiles(f: unknown) {
    return this.rec('setInputFiles', f)
  }
  scrollIntoViewIfNeeded() {
    return this.rec('scrollIntoViewIfNeeded')
  }
  waitFor(o?: unknown) {
    return this.rec('waitFor', o)
  }
  screenshot() {
    return this.rec('screenshot').then(() => Buffer.from('png'))
  }
  first() {
    return this
  }
}
export class FakeDownload {
  deleted = false
  constructor(
    private readonly name: string,
    private readonly content: Buffer,
    public file = '',
  ) {}
  suggestedFilename() {
    return this.name
  }
  async path() {
    return this.file || null
  }
  async createReadStream() {
    return Readable.from([this.content])
  }
  async delete() {
    this.deleted = true
  }
  async cancel() {}
}
export class FakePage extends EventEmitter {
  closed = false
  urlValue = 'about:blank'
  locators: FakeLocator[] = []
  evaluated: string[] = []
  gotos: string[] = []
  main = {}
  constructor(
    private readonly hooks: {
      onLocatorCall?: (name: string, arg: unknown) => unknown
    } = {},
  ) {
    super()
  }
  url() {
    return this.urlValue
  }
  title() {
    return Promise.resolve('Title')
  }
  isClosed() {
    return this.closed
  }
  mainFrame() {
    return this.main
  }
  locator(selector: string) {
    const l = new FakeLocator(selector, this.hooks.onLocatorCall)
    this.locators.push(l)
    return l
  }
  getByText() {
    return this.locator('text')
  }
  goto(url: string) {
    this.gotos.push(url)
    this.urlValue = url
    return Promise.resolve({ status: () => 200 })
  }
  ariaSnapshot() {
    return Promise.resolve('- button "Go" [ref=e1]\n- textbox "Name" [ref=e2]')
  }
  textImpl: () => Promise<string> = () => Promise.resolve('page text')
  evaluate(expr: string | ((r: { from: number; to: number }) => string), arg?: unknown) {
    if (typeof expr === 'function') {
      const r = arg as {
        from: number
        to: number
      }
      return this.textImpl().then((t) => t.slice(r.from, r.to))
    }
    this.evaluateArgs.push(arg)
    return this.evaluateExpr(expr)
  }
  evaluateArgs: unknown[] = []
  private evaluateExpr(expr: string) {
    this.evaluated.push(expr)
    return Promise.resolve({ ok: 1 })
  }
  screenshot() {
    return Promise.resolve(Buffer.from('png'))
  }
  fronts = 0
  bringToFront() {
    this.fronts++
    return Promise.resolve()
  }
  close() {
    this.closed = true
    this.emit('close')
    return Promise.resolve()
  }
  emitNavigated() {
    this.emit('framenavigated', this.main)
  }
  keyboard = { press: () => Promise.resolve() }
  mouseCalls: Array<[string, ...unknown[]]> = []
  mouse = {
    move: (...a: unknown[]) => {
      this.mouseCalls.push(['move', ...a])
      return Promise.resolve()
    },
    click: (...a: unknown[]) => {
      this.mouseCalls.push(['click', ...a])
      return Promise.resolve()
    },
    dblclick: (...a: unknown[]) => {
      this.mouseCalls.push(['dblclick', ...a])
      return Promise.resolve()
    },
    down: (...a: unknown[]) => {
      this.mouseCalls.push(['down', ...a])
      return Promise.resolve()
    },
    up: (...a: unknown[]) => {
      this.mouseCalls.push(['up', ...a])
      return Promise.resolve()
    },
    wheel: (...a: unknown[]) => {
      this.mouseCalls.push(['wheel', ...a])
      return Promise.resolve()
    },
  }
  loadStates: string[] = []
  waitForLoadState(state: string) {
    this.loadStates.push(state)
    return Promise.resolve()
  }
  waitForEvent(
    event: string,
    opts: {
      timeout?: number
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      const timer = opts.timeout
        ? setTimeout(
            () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
            opts.timeout,
          )
        : undefined
      this.once(event, (v) => {
        if (timer) clearTimeout(timer)
        resolve(v)
      })
    })
  }
  cookieJar: Array<{
    name: string
    value: string
    expires?: number
  }> = []
  store: Array<{
    name: string
    value: string
    expires?: number
  }> | null = null
  context() {
    return {
      cookies: () =>
        Promise.resolve(
          this.cookieJar.length > 0 ? this.cookieJar : (this.store ?? this.cookieJar),
        ),
      addCookies: (
        c: Array<{
          name: string
          value: string
          expires?: number
        }>,
      ) => {
        ;(this.store ?? this.cookieJar).push(...c)
        return Promise.resolve()
      },
    }
  }
}
export class FakeBrowser implements ProfileBrowser {
  states = new Map<
    string,
    {
      mode: BrowserMode
      generation: number
    }
  >()
  pages = new Map<string, FakePage[]>()
  launches: Array<{
    profile: string
    mode: BrowserMode
  }> = []
  closes: string[] = []
  touches: string[] = []
  private gen = 0
  cookies = new Map<
    string,
    Array<{
      name: string
      value: string
      expires?: number
    }>
  >()
  private pageListeners = new Map<string, Array<(p: Page) => void>>()
  private closedListeners = new Map<string, Array<(g: number) => void>>()
  private chains = new Map<string, Promise<unknown>>()
  private waits = new Map<string, (r: 'pages-closed' | 'timeout') => void>()
  ensureError: Error | null = null
  constructor(private readonly dirFor: (profile: string) => string) {}
  async ensure(
    profile: string,
    mode: BrowserMode,
  ): Promise<{
    generation: number
  }> {
    if (this.ensureError) throw this.ensureError
    const cur = this.states.get(profile)
    if (cur && cur.mode === mode) return { generation: cur.generation }
    if (cur) await this.close(profile)
    const generation = ++this.gen
    this.states.set(profile, { mode, generation })
    this.pages.set(profile, [])
    this.launches.push({ profile, mode })
    return { generation }
  }
  async close(profile: string): Promise<void> {
    const cur = this.states.get(profile)
    if (!cur) return
    this.closes.push(profile)
    this.cookies.set(
      profile,
      (this.cookies.get(profile) ?? []).filter((c) => c.expires !== -1),
    )
    this.states.delete(profile)
    this.pages.delete(profile)
    for (const cb of this.closedListeners.get(profile) ?? []) cb(cur.generation)
  }
  captures: string[] = []
  async captureDownloads<T>(profile: string, _page: Page, fn: () => Promise<T>): Promise<T> {
    this.captures.push(profile)
    return fn()
  }
  state(profile: string) {
    return this.states.get(profile) ?? null
  }
  async newPage(profile: string): Promise<Page> {
    if (!this.states.has(profile)) throw new Error('profile is not open')
    const p = new FakePage()
    if (!this.cookies.has(profile)) this.cookies.set(profile, [])
    p.store = this.cookies.get(profile)!
    this.pages.get(profile)!.push(p)
    for (const cb of this.pageListeners.get(profile) ?? []) cb(asPage(p))
    return asPage(p)
  }
  popup(profile: string, url = 'https://popup.test/'): FakePage {
    const p = new FakePage()
    p.urlValue = url
    this.pages.get(profile)!.push(p)
    for (const cb of this.pageListeners.get(profile) ?? []) cb(asPage(p))
    return p
  }
  onPage(profile: string, cb: (page: Page) => void) {
    this.pageListeners.set(profile, [...(this.pageListeners.get(profile) ?? []), cb])
    return () => undefined
  }
  onClosed(profile: string, cb: (generation: number) => void) {
    this.closedListeners.set(profile, [...(this.closedListeners.get(profile) ?? []), cb])
    return () => undefined
  }
  waitAllPagesClosed(profile: string): Promise<'pages-closed' | 'timeout'> {
    return new Promise((resolve) => {
      this.waits.set(profile, resolve)
    })
  }
  endWindow(profile: string, outcome: 'pages-closed' | 'timeout' = 'pages-closed'): void {
    this.waits.get(profile)?.(outcome)
  }
  exclusive<T>(profile: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(profile) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    this.chains.set(
      profile,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }
  dir(profile: string): string {
    return this.dirFor(profile)
  }
  operate<T>(_profile: string, fn: () => Promise<T>): Promise<T> {
    return fn()
  }
  touch(profile: string): void {
    this.touches.push(profile)
  }
  crash(profile: string): void {
    void this.close(profile)
  }
}
export const simpleSerializer: KeyedSerializer = {
  activeKeys: () => 0,
  runExclusive: (_key, fn) => fn(),
}
export interface Harness {
  home: string
  downloads: string
  uploadRoot: string
  store: ProfileStore
  browser: FakeBrowser
  windows: WindowTasks
  tabs: TabRegistry
  deps: ToolDeps
  profile(
    name?: string,
    flags?: {
      enabled?: boolean
      allowExtensions?: boolean
      allowSettings?: boolean
      allowSync?: boolean
      keepRunning?: boolean
    },
  ): string
  call(
    tool: string,
    args?: unknown,
  ): Promise<{
    text: string
    json: unknown
    raw: unknown
  }>
  callError(tool: string, args?: unknown): Promise<string>
}
export function harness(): Harness {
  const home = tmpDir()
  const downloads = path.join(tmpDir(), 'downloads')
  const uploadRoot = fs.realpathSync(tmpDir('agent-chrome-upload-'))
  const store = createProfileStore({ home })
  const browser = new FakeBrowser((p) => store.dirOf(p))
  const windows = createWindowTasks({ browser })
  const tabs = new TabRegistry({ start: 1 })
  const deps: ToolDeps = {
    store,
    browser,
    windows,
    tabs,
    serializer: simpleSerializer,
    downloadsRoot: downloads,
    guard: () => ({
      roots: [uploadRoot],
      hostHome: os.homedir(),
      mount: '',
      maxBytes: 1024 * 1024,
    }),
    now: () => new Date(2026, 9, 16, 12, 0, 0),
  }
  const tools = createAgentChromeTools(deps)
  const run = async (tool: string, args: unknown) => {
    const t = tools.find((x) => x.definition.name === tool)
    if (!t) throw new Error(`no tool ${tool}`)
    return t.execute((args ?? {}) as Record<string, unknown>, {})
  }
  return {
    home,
    downloads,
    uploadRoot,
    store,
    browser,
    windows,
    tabs,
    deps,
    profile(name = 'perso', flags = { enabled: true }) {
      store.create(name, 'panel')
      store.setFlags(name, flags)
      return name
    },
    async call(tool, args) {
      const r = (await run(tool, args)) as {
        content: Array<{
          type: string
          text?: string
        }>
      }
      const text = r.content.find((c) => c.type === 'text')?.text ?? ''
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
      return { text, json, raw: r }
    },
    async callError(tool, args) {
      try {
        await run(tool, args)
      } catch (e) {
        return (e as Error).message
      }
      throw new Error('expected a refusal')
    },
  }
}
export function asPage(p: FakePage): Page {
  return p as unknown as Page
}
