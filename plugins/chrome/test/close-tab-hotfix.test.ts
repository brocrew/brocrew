import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { TabRegistry } from '../src/tabs.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { createWindowTasks } from '../src/windows.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import type { ToolDeps } from '../src/tools/common.js'
import { FakeBrowser } from './fakes.js'

const roots: string[] = []
const releases: Array<() => void> = []
afterEach(() => {
  for (const release of releases.splice(0)) release()
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
  store.setFlags('fern', { enabled: true, allowSettings: true })
  store.create('birch', 'panel')
  store.setFlags('birch', { enabled: true })
  // Only the browser boundary is fictional. Tools, serializer, tabs and stores are ordinary code.
  const browser = new FakeBrowser(store.dirOf)
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
  const remove = () => {
    if (store.shared) store.shared.remove('fern', store.shared.confirmation('fern'))
    else store.remove('fern')
  }
  return { store, browser, tabs, call, generation, remove, open }
}
async function heldClose(f: ReturnType<typeof fixture>, nativeFailure = false) {
  const opened = await f.call('open_tab', { profile: 'fern', url: 'about:blank' })
  const { tabId } = JSON.parse(opened.content[0]!.text) as { tabId: string }
  const page = f.browser.pages.get('fern')![0]!
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
  let settled = false
  const pending = Promise.resolve(f.call('close_tab', { profile: 'fern', tabId }))
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

// 8fe65ca8 close postcondition: the removed tab is success; surviving authority is revalidated.
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
      const opened = await f.call('open_tab', { profile: 'fern', url: 'about:blank' })
      const { tabId } = JSON.parse(opened.content[0]!.text) as { tabId: string }
      const page = f.browser.pages.get('fern')![0]!
      const close = vi.spyOn(page, 'close')
      f.browser.touches.length = 0
      await expect(f.call('close_tab', { profile: 'birch', tabId })).rejects.toThrow(/profile/)
      expect(close).not.toHaveBeenCalled()
      expect(f.browser.touches).toEqual([])
      expect(page.closed).toBe(false)
    })
    it.each(['disabled', 'removed', 'off-on', 'tab-remapped', 'generation'] as const)(
      'refuses a held close after %s without relying on a removed-tab lookup',
      async (change) => {
        const f = fixture(kind)
        const work = await heldClose(f)
        if (change === 'disabled' || change === 'off-on') {
          f.store.setFlags('fern', { enabled: false })
          if (change === 'off-on') f.store.setFlags('fern', { enabled: true })
        }
        if (change === 'removed') f.remove()
        if (change === 'tab-remapped') f.tabs.resolve(work.tabId, f.generation).profile = 'birch'
        if (change === 'generation') f.browser.states.get('fern')!.generation++
        const refused = expect(work.pending).rejects.toThrow(/profile|unavailable/)
        work.finish()
        await refused
        // The native operation completed once; its result must still be refused on lost authority.
        expect(work.close).toHaveBeenCalledOnce()
        expect(work.page.closed).toBe(true)
      },
    )
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
it.each(['permission', 'profile-replaced', 'shared-held'] as const)(
  'refuses a held close when real shared admission changes: %s',
  async (change) => {
    const f = fixture('shared')
    const peer = f.open('b')
    peer.setFlags('fern', { enabled: true })
    const work = await heldClose(f)
    if (change === 'permission') peer.setFlags('fern', { allowSettings: false })
    if (change === 'profile-replaced') {
      f.remove()
      f.store.create('fern', 'panel')
      f.store.setFlags('fern', { enabled: true, allowSettings: true })
    }
    if (change === 'shared-held') {
      // A second real store takes admission while the fictional browser's close is pending.
      const lease = peer.shared.acquire('fern')
      releases.push(() => {
        lease.release()
      })
      expect(() => f.store.shared!.acquire('fern')).toThrow(/use/)
    }
    const refused = expect(work.pending).rejects.toThrow(/profile|unavailable/)
    work.finish()
    await refused
    expect(work.close).toHaveBeenCalledOnce()
    expect(work.page.closed).toBe(true)
  },
)
