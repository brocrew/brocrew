// A protocol fixture, not a browser engine. Only the owned fixture page can navigate.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { Socket } from 'node:net'

export const fixtureTitle = 'Fern fixture page'
export const fixtureText = 'A fern grows beside a fictional stream.'
export const fixtureHtml = `<!doctype html><title>${fixtureTitle}</title><p>${fixtureText}</p>`
const userAgent = 'Mozilla/5.0 HeadlessChrome/155.0.0.0 Safari/537.36'
const setup = new Set([
  'Browser.setDownloadBehavior',
  'Browser.setWindowBounds',
  'Target.setDiscoverTargets',
  'Target.disposeBrowserContext',
  'Target.detachFromTarget',
  'Page.enable',
  'Page.setLifecycleEventsEnabled',
  'Page.setInterceptFileChooserDialog',
  'Log.enable',
  'Network.enable',
  'Network.setCacheDisabled',
  'Network.setExtraHTTPHeaders',
  'Network.setBypassServiceWorker',
  'Emulation.setFocusEmulationEnabled',
  'Emulation.setDeviceMetricsOverride',
  'Emulation.setUserAgentOverride',
  'Emulation.setEmulatedMedia',
  'Emulation.setLocaleOverride',
  'Emulation.setTimezoneOverride',
  'Emulation.setDefaultBackgroundColorOverride',
  'Page.setFontFamilies',
  'Runtime.addBinding',
  'Runtime.releaseObject',
])
export class FixtureBrowser {
  constructor({ emit, readPage, receipt = () => {}, close = () => {} }) {
    this.emit = emit
    this.readPage = readPage
    this.receipt = receipt
    this.close = close
    this.pages = new Map()
    this.sessions = new Map()
    this.objects = new Map()
    this.sequence = 0
    this.stats = {
      navigations: 0,
      evaluations: 0,
      closedTabs: 0,
      rejectedNavigations: 0,
      unsupportedCommands: 0,
    }
  }
  event(method, params, sessionId) {
    this.emit({ method, params, ...(sessionId ? { sessionId } : {}) })
  }
  info(page) {
    return {
      targetId: page.id,
      type: 'page',
      title: page.title,
      url: page.url,
      attached: true,
      canAccessOpener: false,
      browserContextId: page.context ?? 'default',
    }
  }
  attach(page, sessionId = `s${++this.sequence}`) {
    this.sessions.set(sessionId, page)
    this.event('Target.attachedToTarget', {
      sessionId,
      targetInfo: this.info(page),
      waitingForDebugger: true,
    })
    return sessionId
  }
  create(context) {
    const page = { id: `t${++this.sequence}`, context, url: 'about:blank', title: '', text: '' }
    this.pages.set(page.id, page)
    const document = {
      get title() {
        return page.title
      },
      body: {
        get innerText() {
          return page.text
        },
      },
    }
    page.vm = vm.createContext({
      document,
      navigator: { userAgent },
      console: { debug() {} },
      setTimeout,
      clearTimeout,
      performance,
      URL,
    })
    this.attach(page)
    return page
  }
  frame(page) {
    return {
      id: page.id,
      loaderId: page.loader ?? 'initial',
      url: page.url,
      securityOrigin: 'http://127.0.0.1',
      mimeType: 'text/html',
    }
  }
  contexts(page, sessionId) {
    for (const [id, name, isDefault] of [
      [1, '', true],
      [2, page.world ?? 'utility', false],
    ])
      this.event(
        'Runtime.executionContextCreated',
        {
          context: {
            id,
            origin: 'http://127.0.0.1',
            name,
            uniqueId: `${sessionId}-${id}`,
            auxData: { frameId: page.id, isDefault, type: isDefault ? 'default' : 'isolated' },
          },
        },
        sessionId,
      )
  }
  remote(value, byValue) {
    if (value !== null && (typeof value === 'object' || typeof value === 'function') && !byValue) {
      const objectId = `o${++this.sequence}`
      this.objects.set(objectId, value)
      return { type: typeof value, objectId }
    }
    return { type: typeof value, value }
  }
  async dispatch({ method, params = {}, sessionId }) {
    const page = this.sessions.get(sessionId)
    if (setup.has(method)) return {}
    switch (method) {
      case 'Browser.getVersion':
        return {
          product: 'Chrome/155.0.0.0',
          revision: 'fixture',
          userAgent,
          jsVersion: 'fixture',
          protocolVersion: '1.3',
        }
      case 'Browser.getWindowForTarget':
        return {
          windowId: 1,
          bounds: { left: 0, top: 0, width: 800, height: 600, windowState: 'normal' },
        }
      case 'Target.setAutoAttach':
        if (!sessionId && this.pages.size === 0) this.create(undefined)
        return {}
      case 'Target.getTargetInfo':
        return { targetInfo: this.info(page ?? [...this.pages.values()][0]) }
      case 'Target.getTargets':
        return { targetInfos: [...this.pages.values()].map((p) => this.info(p)) }
      case 'Target.createBrowserContext':
        return { browserContextId: `c${++this.sequence}` }
      case 'Target.createTarget':
        return { targetId: this.create(params.browserContextId).id }
      case 'Target.attachToTarget':
        return { sessionId: this.attach(this.pages.get(params.targetId)) }
      case 'Target.attachToBrowserTarget':
        return { sessionId: `b${++this.sequence}` }
      case 'Page.getFrameTree':
        return { frameTree: { frame: this.frame(page) } }
      case 'Page.addScriptToEvaluateOnNewDocument':
        page.world = params.worldName
        return { identifier: 'fixture' }
      case 'Page.createIsolatedWorld':
        page.world = params.worldName
        this.contexts(page, sessionId)
        return { executionContextId: 2 }
      case 'Runtime.enable':
        this.contexts(page, sessionId)
        return {}
      case 'Runtime.runIfWaitingForDebugger':
        if (page)
          for (const name of ['DOMContentLoaded', 'load'])
            this.event(
              'Page.lifecycleEvent',
              { frameId: page.id, loaderId: page.loader ?? 'initial', name, timestamp: 1 },
              sessionId,
            )
        return {}
      case 'Page.navigate': {
        let fixture
        try {
          fixture = await this.readPage(params.url)
        } catch {
          this.stats.rejectedNavigations++
          this.receipt(this.stats)
          throw new Error('Fixture navigation refused')
        }
        page.url = params.url
        page.title = fixture.title
        page.text = fixture.text
        page.loader = `l${++this.sequence}`
        this.stats.navigations++
        this.receipt(this.stats)
        this.event('Page.frameStartedLoading', { frameId: page.id }, sessionId)
        this.event('Runtime.executionContextsCleared', {}, sessionId)
        this.event(
          'Page.frameNavigated',
          { frame: this.frame(page), type: 'Navigation' },
          sessionId,
        )
        this.contexts(page, sessionId)
        for (const name of ['DOMContentLoaded', 'load'])
          this.event(
            'Page.lifecycleEvent',
            { frameId: page.id, loaderId: page.loader, name, timestamp: 2 },
            sessionId,
          )
        this.event('Page.frameStoppedLoading', { frameId: page.id }, sessionId)
        return { frameId: page.id, loaderId: page.loader }
      }
      case 'Runtime.evaluate':
      case 'Runtime.callFunctionOn': {
        if (!page) throw new Error('No fixture page')
        const source =
          method === 'Runtime.evaluate' ? params.expression : `(${params.functionDeclaration})`
        if (typeof source !== 'string' || source.length > 1024 * 1024)
          throw new Error('Expression refused')
        let value = vm.runInContext(source, page.vm, { timeout: 1000 })
        if (method === 'Runtime.callFunctionOn') {
          page.vm.fixtureFunction = value
          page.vm.fixtureArgs = (params.arguments ?? []).map((arg) =>
            arg.objectId ? this.objects.get(arg.objectId) : arg.value,
          )
          value = vm.runInContext('fixtureFunction(...fixtureArgs)', page.vm, { timeout: 1000 })
        }
        value = await value
        this.stats.evaluations++
        this.receipt(this.stats)
        return { result: this.remote(value, params.returnByValue) }
      }
      case 'Target.closeTarget': {
        const closed = this.pages.get(params.targetId)
        if (closed) {
          this.pages.delete(closed.id)
          for (const [id, candidate] of this.sessions)
            if (candidate === closed) {
              this.event('Target.detachedFromTarget', { sessionId: id, targetId: closed.id })
              this.sessions.delete(id)
            }
          this.stats.closedTabs++
          this.receipt(this.stats)
        }
        return { success: true }
      }
      case 'Browser.close':
        setTimeout(this.close, 10)
        return {}
      default:
        this.stats.unsupportedCommands++
        this.receipt(this.stats)
        throw new Error('Unsupported fixture CDP method')
    }
  }
  async message(message) {
    this.receipt(this.stats)
    try {
      this.emit({
        id: message.id,
        sessionId: message.sessionId,
        result: await this.dispatch(message),
      })
    } catch {
      this.emit({
        id: message.id,
        sessionId: message.sessionId,
        error: { code: -32000, message: 'Fixture CDP refused' },
      })
    }
  }
}

export function fixtureReader(expectedUrl, request = fetch) {
  const expected = new URL(expectedUrl)
  if (
    expected.protocol !== 'http:' ||
    expected.hostname !== '127.0.0.1' ||
    !expected.port ||
    expected.pathname !== '/fern'
  )
    throw new Error('Invalid local fixture')
  return async (url) => {
    if (url !== expected.href) throw new Error('Fixture URL refused')
    const response = await request(expected, {
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok || (await response.text()) !== fixtureHtml)
      throw new Error('Fixture page differs')
    return { title: fixtureTitle, text: fixtureText }
  }
}
export function runBrowser(directory) {
  if (process.argv.includes('--fixture-probe')) {
    fs.writeFileSync(
      path.join(process.env.BROCREW_CHROME_DATA, 'fake-browser.json'),
      JSON.stringify({ pid: process.pid }),
      { mode: 0o600 },
    )
    process.on('SIGTERM', () => process.exit(0))
    setInterval(() => {}, 1000)
    return
  }
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'browser-fixture.json')))
  const out = new Socket({ fd: 4, readable: false, writable: true })
  const browser = new FixtureBrowser({
    emit: (value) => out.write(JSON.stringify(value) + '\0'),
    readPage: fixtureReader(plan.url),
    close: () => process.exit(0),
    receipt: (stats) =>
      fs.writeFileSync(path.join(directory, `cdp-${process.pid}.json`), JSON.stringify(stats), {
        mode: 0o600,
      }),
  })
  fs.writeFileSync(
    path.join(directory, 'fake-browser.json'),
    JSON.stringify({ pid: process.pid }),
    { mode: 0o600 },
  )
  let input = ''
  new Socket({ fd: 3, readable: true, writable: false })
    .on('data', (bytes) => {
      input += bytes.toString()
      if (input.length > 2 * 1024 * 1024) process.exit(1)
      let end
      while ((end = input.indexOf('\0')) !== -1) {
        const frame = input.slice(0, end)
        input = input.slice(end + 1)
        void browser.message(JSON.parse(frame))
      }
    })
    .on('end', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}
