import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChromeBrowser } from '../src/index.js'
import { silentLogger } from '../src/logger.js'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { TabRegistry } from '../src/tabs.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { createWindowTasks } from '../src/windows.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import type { ToolDeps } from '../src/tools/common.js'
import { asPage, FakePage } from './fakes.js'

const roots: string[] = []
const releases: Array<() => void> = []
const closeBrowsers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const close of closeBrowsers.splice(0)) await close()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
// Only Playwright context/CDP/page effects are fictional. ChromeBrowser owns real launch leases.
class Context extends EventEmitter {
  readonly page = new FakePage()
  readonly driver = Object.assign(new EventEmitter(), {
    newBrowserCDPSession: async () =>
      Object.assign(new EventEmitter(), {
        send: async () => ({}),
        detach: async () => {},
      }),
  })
  constructor() {
    super()
    this.page.context = () => this as unknown as ReturnType<FakePage['context']>
  }
  pages() {
    return this.page.closed ? [] : [asPage(this.page)]
  }
  browser() {
    return this.driver
  }
  async newCDPSession() {
    return { send: async () => ({ windowId: 1 }), detach: async () => {} }
  }
  async close() {
    this.emit('close')
  }
}
function fixture(kind: 'local' | 'shared') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-close-hotfix-'))
  roots.push(root)
  const home = path.join(root, 'workspace-a')
  const shared = path.join(root, 'shared')
  fs.mkdirSync(home, { mode: 0o700 })
  fs.mkdirSync(shared, { mode: 0o700 })
  const open = (workspaceId: string) => {
    const local = path.join(root, `workspace-${workspaceId}`)
    fs.mkdirSync(local, { recursive: true, mode: 0o700 })
    return createSharedProfileStore({
      home: local,
      shared,
      workspaceId,
      workspaceLabel: `Fictional ${workspaceId}`,
      processIdentity: { pid: process.pid, birth: 'fictional-close-hotfix' },
      ownerState: () => 'alive',
      chromeState: () => 'ended',
      readVolumeIdentity: () => undefined,
    })
  }
  const store = kind === 'shared' ? open('a') : createProfileStore({ home })
  store.create('fern', 'panel')
  store.setFlags('fern', { enabled: true })
  store.create('birch', 'panel')
  store.setFlags('birch', { enabled: true })
  const context = new Context()
  const launch = vi.fn(async () => context as unknown as BrowserContext)
  const browser = createChromeBrowser(store, silentLogger, undefined, undefined, {
    downloadsRoot: path.join(root, 'downloads'),
    launchContext: launch,
    lockHeld: async () => false,
    ua: {
      get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
      invalidate() {},
      peek: () => null,
    },
    killChrome: vi.fn(async () => {}),
  })
  closeBrowsers.push(() => browser.closeAll())
  const tabs = new TabRegistry({ start: 1 })
  const deps: ToolDeps = {
    store,
    browser,
    tabs,
    serializer: createKeyedSerializer(),
    windows: createWindowTasks({ browser }),
    downloadsRoot: path.join(root, 'downloads'),
    guard: () => ({ roots: [], hostHome: root, mount: root, maxBytes: 1024 }),
  }
  const tools = createAgentChromeTools(deps)
  const call = (name: string, args: Record<string, unknown>) =>
    tools.find((tool) => tool.definition.name === name)!.execute(args, {})
  const generation = (profile: string) => browser.state(profile)?.generation ?? null
  return { store, browser, tabs, call, generation, open, context, launch }
}
async function openedTab(f: ReturnType<typeof fixture>) {
  const opened = await f.call('open_tab', { profile: 'fern', url: 'about:blank', visible: true })
  return (JSON.parse(opened.content[0]!.text) as { tabId: string }).tabId
}
async function heldClose(f: ReturnType<typeof fixture>, nativeFailure = false) {
  const tabId = await openedTab(f)
  const page = f.context.page
  const nativeClose = page.close.bind(page)
  const entered = barrier()
  const finish = barrier()
  releases.push(finish.resolve)
  const close = vi.spyOn(page, 'close').mockImplementation(async () => {
    entered.resolve()
    await finish.promise
    if (nativeFailure) throw new Error('fictional native close failure: private page text')
    await nativeClose()
  })
  const pending = Promise.resolve(f.call('close_tab', { profile: 'fern', tabId }))
  let settled = false
  void pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await entered.promise
  expect(close).toHaveBeenCalledOnce()
  expect(settled).toBe(false)
  return { tabId, page, close, pending, finish: finish.resolve }
}

// Exact8fe obligations use current enabled/profile authority, not permission epochs or new leases.
for (const kind of ['local', 'shared'] as const) {
  describe(`${kind} ordinary-package close hotfix continuity`, () => {
    it('accepts a held native close after its tab disappears', async () => {
      const f = fixture(kind)
      const work = await heldClose(f)
      work.finish()
      expect(await work.pending).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] })
      expect(work.page.closed).toBe(true)
      expect(f.tabs.list(f.generation, 'fern')).toEqual([])
      expect(work.close).toHaveBeenCalledOnce()
    })
    it('refuses a different supplied profile before dispatching native close', async () => {
      const f = fixture(kind)
      const tabId = await openedTab(f)
      const close = vi.spyOn(f.context.page, 'close')
      await expect(f.call('close_tab', { profile: 'birch', tabId })).rejects.toThrow(/profile/)
      expect(close).not.toHaveBeenCalled()
      expect(f.context.page.closed).toBe(false)
    })
    it('refuses a held close after the supplied profile is disabled', async () => {
      const f = fixture(kind)
      const work = await heldClose(f)
      f.store.setFlags('fern', { enabled: false })
      const refused = expect(work.pending).rejects.toThrow(
        /profile is unavailable|browser action failed \(Error\)/,
      )
      work.finish()
      await refused
      expect(work.close).toHaveBeenCalledOnce()
      expect(work.page.closed).toBe(true)
    })
    it('refuses a held native close failure while the tab remains open', async () => {
      const f = fixture(kind)
      const work = await heldClose(f, true)
      const refused = expect(work.pending).rejects.toThrow('the browser action failed (Error)')
      work.finish()
      await refused
      expect(work.close).toHaveBeenCalledOnce()
      expect(work.page.closed).toBe(false)
      expect(f.tabs.resolve(work.tabId, f.generation).profile).toBe('fern')
    })
  })
}
it('refuses a held local close after the supplied profile is removed', async () => {
  const f = fixture('local')
  const work = await heldClose(f)
  f.store.remove('fern')
  expect(f.store.get('fern')).toBeUndefined()
  const refused = expect(work.pending).rejects.toThrow(
    /profile is unavailable|browser action failed \(Error\)/,
  )
  work.finish()
  await refused
  expect(work.close).toHaveBeenCalledOnce()
  expect(work.page.closed).toBe(true)
})
it('retains its real launch lease through held close and refuses peer takeover or deletion', async () => {
  const f = fixture('shared')
  const peer = f.open('b')
  peer.setFlags('fern', { enabled: true })
  const identity = f.store.shared!.identity('fern')
  const work = await heldClose(f)
  expect(f.launch).toHaveBeenCalledOnce()
  expect(peer.shared.view('fern')).toMatchObject({ inUseIn: 'Fictional a' })
  expect(() => peer.shared.acquire('fern')).toThrow(/use/)
  expect(() => peer.shared.remove('fern', peer.shared.confirmation('fern'))).toThrow(/use/)
  expect(f.store.shared!.identity('fern')).toBe(identity)
  work.finish()
  expect(await work.pending).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] })
  expect(work.close).toHaveBeenCalledOnce()
  expect(f.tabs.list(f.generation, 'fern')).toEqual([])
  // Closing one tab does not release the browser's retained lease.
  expect(() => peer.shared.acquire('fern')).toThrow(/use/)
  await f.browser.close('fern')
  const successor = peer.shared.acquire('fern')
  expect(successor.release()).toBe(true)
})
it('refuses a profile already held by a peer before launching or dispatching close', async () => {
  const f = fixture('shared')
  const peer = f.open('b')
  peer.setFlags('fern', { enabled: true })
  const lease = peer.shared.acquire('fern')
  releases.push(() => {
    lease.release()
  })
  const close = vi.spyOn(f.context.page, 'close')
  await expect(openedTab(f)).rejects.toThrow(/profile|use/)
  expect(f.launch).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(f.browser.state('fern')).toBeNull()
})
