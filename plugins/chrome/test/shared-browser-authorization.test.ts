import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { afterEach, expect, it, vi } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import type { ProfileBrowser } from '../src/browser/profileBrowser.js'
import { fenceBrowserHandles, unwrapBrowserHandle } from '../src/browser/profileBrowser.js'
import { createProfileStore } from '../src/profiles/store.js'
import type { ProfileStore } from '../src/profiles/store.js'
import type { SharedProfileAccess } from '../src/profiles/sharedTypes.js'
import {
  ProfileInUseElsewhereError,
  createSharedProfileStore,
} from '../src/profiles/sharedStore.js'
import { TabRegistry } from '../src/tabs.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { buildToolDefs } from '../src/tools/index.js'
import { fenceToolDefs } from '../src/tools/authorization.js'
import { watchWindow } from '../src/tools/showHide.js'
import { describeError } from '../src/tools/common.js'
import type { ToolDeps } from '../src/tools/common.js'

const homes: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-shared-browser-'))
  homes.push(dir)
  return dir
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 50 && !predicate(); n++) await Promise.resolve()
  expect(predicate()).toBe(true)
}
class Context extends EventEmitter {
  closed = false
  driver = new EventEmitter() as EventEmitter & { newBrowserCDPSession?: unknown }
  constructor() {
    super()
    this.driver.newBrowserCDPSession = async () => ({ on() {}, send: async () => ({}) })
  }
  pages(): Page[] {
    return []
  }
  browser() {
    return this.driver
  }
  async close() {
    this.closed = true
    this.emit('close')
  }
}
function browserFixture(overrides: Partial<ConstructorParameters<typeof ChromeBrowser>[0]> = {}) {
  const dir = home()
  fs.mkdirSync(path.join(dir, 'fern'))
  const context = new Context()
  const release = vi.fn(() => true)
  const acquire = vi.fn(() => ({ release }))
  const launch = vi.fn(async () => context as unknown as BrowserContext)
  const browser = new ChromeBrowser({
    dirOf: () => path.join(dir, 'fern'),
    downloadsRoot: path.join(dir, 'downloads'),
    acquireLease: acquire,
    authorization: () => 'permission-1',
    ua: {
      get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
      invalidate() {},
      peek: () => null,
    },
    lockHeld: async () => false,
    launchContext: launch,
    killChrome: vi.fn(async () => {}),
    ...overrides,
  })
  return { browser, acquire, release, launch, context }
}
it('acquires before lock/UA awaits and retains a slow launch lease until Chrome ends', async () => {
  const ua = deferred<{ userAgent: string; chromeVersion: string }>()
  const f = browserFixture({ ua: { get: () => ua.promise, invalidate() {}, peek: () => null } })
  const opening = f.browser.ensure('fern', 'headless')
  await until(() => f.acquire.mock.calls.length === 1)
  expect(f.launch).not.toHaveBeenCalled()
  expect(f.release).not.toHaveBeenCalled()
  vi.useFakeTimers()
  await vi.advanceTimersByTimeAsync(11_000)
  expect(f.release).not.toHaveBeenCalled()
  vi.useRealTimers()
  ua.resolve({ userAgent: 'fictional', chromeVersion: '1' })
  await opening
  expect(f.release).not.toHaveBeenCalled()
  await f.browser.close('fern')
  expect(f.release).toHaveBeenCalled()
})
it('does not launch when authorization changes during UA inspection', async () => {
  const ua = deferred<{ userAgent: string; chromeVersion: string }>()
  let epoch = 'allowed'
  const f = browserFixture({
    authorization: () => epoch,
    ua: { get: () => ua.promise, invalidate() {}, peek: () => null },
  })
  const opening = f.browser.ensure('fern', 'headless')
  await until(() => f.acquire.mock.calls.length === 1)
  epoch = 'revoked'
  ua.resolve({ userAgent: 'fictional', chromeVersion: '1' })
  await expect(opening).rejects.toThrow('authorization changed')
  expect(f.launch).not.toHaveBeenCalled()
  expect(f.release).toHaveBeenCalled()
})
it('closes a context returned after revocation without admitting a generation', async () => {
  const launch = deferred<BrowserContext>()
  let epoch = 'allowed'
  let launching = false
  const f = browserFixture({
    authorization: () => epoch,
    launchContext: () => {
      launching = true
      return launch.promise
    },
  })
  const opening = f.browser.ensure('fern', 'headless')
  await until(() => launching)
  epoch = 'revoked'
  launch.resolve(f.context as unknown as BrowserContext)
  await expect(opening).rejects.toThrow('authorization changed')
  expect(f.context.closed).toBe(true)
  expect(f.browser.state('fern')).toBeNull()
})
it('old disconnected callbacks cannot release a successor launch lease', async () => {
  const releases = [vi.fn(() => true), vi.fn(() => true)]
  const contexts = [new Context(), new Context()]
  let acquired = 0,
    launched = 0
  const f = browserFixture({
    acquireLease: () => ({ release: releases[acquired++] }),
    launchContext: async () => contexts[launched++] as unknown as BrowserContext,
  })
  await f.browser.ensure('fern', 'headless')
  await f.browser.ensure('fern', 'visible')
  const calls = releases[1].mock.calls.length
  contexts[0].driver.emit('disconnected')
  contexts[0].emit('close')
  expect(releases[1]).toHaveBeenCalledTimes(calls)
  await f.browser.closeAll()
})
it('preserves the cross-workspace refusal message', () => {
  expect(describeError(new ProfileInUseElsewhereError('Fictional'))).toContain(
    'Fictional workspace',
  )
})

function toolFixture(sharedStore?: ProfileStore) {
  const dir = home()
  const store = sharedStore ?? createProfileStore({ home: dir })
  store.create('fern', 'panel')
  store.setFlags('fern', { enabled: true })
  store.create('hidden', 'panel', { description: 'private off metadata' })
  store.setFlags('hidden', { enabled: false })
  let epoch = 1,
    generation = 1
  store.shared ??= { authorization: () => String(epoch) } as SharedProfileAccess
  const filled = deferred()
  const filling = deferred()
  const press = vi.fn(async () => {})
  const cookies = vi.fn(async () => [])
  class FakePage extends EventEmitter {
    isClosed() {
      return false
    }
    url() {
      return 'https://fictional.invalid/'
    }
    context() {
      return { cookies }
    }
    locator() {
      return {
        fill: async () => {
          filling.resolve()
          await filled.promise
        },
        press,
      }
    }
    async title() {
      return 'fictional'
    }
  }
  const page = new FakePage() as unknown as Page
  const tabs = new TabRegistry({ start: 1 })
  const tab = tabs.add('fern', 1, page)
  tab.refs = new Set(['e1'])
  const serializer = createKeyedSerializer()
  const browser = {
    state: () => ({ mode: 'headless', generation }),
    touch() {},
    operate: async (_name: string, fn: () => Promise<unknown>) => fn(),
    exclusive: async (_name: string, fn: () => Promise<unknown>) => fn(),
    usePage: vi.fn(async () => {}),
    windowId: async () => 7,
    dir: store.dirOf,
  } as unknown as ProfileBrowser
  const deps: ToolDeps = {
    store,
    tabs,
    browser,
    serializer,
    windows: { open: async () => {} },
    downloadsRoot: path.join(dir, 'downloads'),
    guard: () => ({ roots: [], hostHome: dir, mount: dir, maxBytes: 1024 }),
  }
  const call = (name: string, args: Record<string, unknown>) =>
    buildToolDefs()
      .find((d) => d.spec.name === name)!
      .run(args, deps)
  return {
    deps,
    call,
    filled,
    filling,
    press,
    cookies,
    tab,
    revoke: () => {
      epoch++
    },
    replace: () => {
      generation++
    },
  }
}
it.each(['revocation', 'generation'] as const)(
  'fences submit after fill awaits a %s change',
  async (change) => {
    const f = toolFixture()
    const call = f.call('fill', { tabId: f.tab.id, ref: 'e1', text: 'fictional', submit: true })
    await f.filling.promise
    if (change === 'revocation') f.revoke()
    else f.replace()
    f.filled.resolve()
    await expect(call).rejects.toThrow('unavailable')
    expect(f.press).not.toHaveBeenCalled()
  },
)
it('fences queued work even when off is followed by on before the queue drains', async () => {
  const f = toolFixture()
  const blocker = deferred()
  const blocking = f.deps.serializer.runExclusive(f.tab.id, () => blocker.promise)
  const call = f.call('fill', { tabId: f.tab.id, ref: 'e1', text: 'fictional', submit: true })
  await until(() => vi.mocked(f.deps.browser.usePage).mock.calls.length === 0)
  await Promise.resolve()
  f.revoke()
  blocker.resolve()
  await blocking
  await expect(call).rejects.toThrow('unavailable')
  expect(f.deps.browser.usePage).not.toHaveBeenCalled()
})
it('hides off metadata in listings and direct-name operations', async () => {
  const f = toolFixture()
  const out = await f.call('list_browser_profiles', {})
  expect(JSON.stringify(out)).not.toContain('hidden')
  expect(JSON.stringify(out)).not.toContain('private off metadata')
  await expect(
    f.call('set_browser_profile_description', { profile: 'hidden', description: 'probe' }),
  ).rejects.toThrow('unavailable')
  expect(f.deps.store.get('hidden')?.description).toBe('private off metadata')
})
it('blocks a download request when cookies finish after revocation', async () => {
  const f = toolFixture()
  const cookieRead = deferred<never[]>()
  f.cookies.mockImplementation(() => cookieRead.promise)
  const fetching = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('fictional blocked request'))
  const call = f.call('download_url', { tabId: f.tab.id, url: 'https://fictional.invalid/file' })
  await until(() => f.cookies.mock.calls.length === 1)
  f.revoke()
  cookieRead.resolve([])
  await expect(call).rejects.toThrow('unavailable')
  expect(fetching).not.toHaveBeenCalled()
})
it('fences internal CDP continuations after session acquisition', async () => {
  const opening = deferred<{ send: ReturnType<typeof vi.fn> }>()
  const send = vi.fn(async () => {})
  let allowed = true
  const context = fenceBrowserHandles({ newCDPSession: () => opening.promise }, () => {
    if (!allowed) throw new Error('revoked')
  })
  const use = (async () => {
    const session = await context.newCDPSession()
    await session.send('Target.createTarget')
  })()
  allowed = false
  opening.resolve({ send })
  await expect(use).rejects.toThrow('revoked')
  expect(send).not.toHaveBeenCalled()
})

it('discards an interrupted download stream after permission revocation', async () => {
  const f = toolFixture()
  const reading = deferred()
  const resume = deferred()
  let chunks = 0
  const body = new ReadableStream(
    {
      async pull(controller) {
        if (chunks++ === 0) controller.enqueue(new TextEncoder().encode('fictional first chunk'))
        else {
          reading.resolve()
          await resume.promise
          controller.enqueue(new TextEncoder().encode('forbidden next chunk'))
          controller.close()
        }
      },
    },
    { highWaterMark: 0 },
  )
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
  const call = f.call('download_url', {
    tabId: f.tab.id,
    url: 'https://fictional.invalid/file.txt',
  })
  await reading.promise
  expect(fs.existsSync(f.deps.downloadsRoot)).toBe(true)
  f.revoke()
  resume.resolve()
  await expect(call).rejects.toThrow('unavailable')
  const root = f.deps.downloadsRoot
  if (fs.existsSync(root))
    for (const folder of fs.readdirSync(root))
      expect(fs.readdirSync(path.join(root, folder))).toEqual([])
})

it('retains uncertain failed-launch leases and retries release before later admission', async () => {
  let ended = false
  let launches = 0
  const release = vi.fn(() => ended)
  const acquire = vi.fn(() => ({ release }))
  const context = new Context()
  const f = browserFixture({
    acquireLease: acquire,
    launchContext: async () => {
      if (launches++ === 0) throw new Error('fictional launch failure')
      return context as unknown as BrowserContext
    },
  })
  await expect(f.browser.ensure('fern', 'visible')).rejects.toThrow('fictional launch failure')
  await expect(f.browser.ensure('fern', 'visible')).rejects.toThrow('another Chrome')
  expect(acquire).toHaveBeenCalledTimes(1)
  ended = true
  await f.browser.ensure('fern', 'visible')
  expect(acquire).toHaveBeenCalledTimes(2)
  await f.browser.closeAll()
})
it('retains the lease between context close and confirmed Chrome end', async () => {
  const closing = deferred()
  const finish = deferred()
  let ended = false
  const release = vi.fn(() => ended)
  const context = new Context()
  context.close = async () => {
    context.emit('close')
    closing.resolve()
    await finish.promise
    ended = true
  }
  const f = browserFixture({
    acquireLease: () => ({ release }),
    launchContext: async () => context as unknown as BrowserContext,
  })
  await f.browser.ensure('fern', 'visible')
  const close = f.browser.close('fern')
  await closing.promise
  expect(release).toHaveReturnedWith(false)
  finish.resolve()
  await close
  expect(release).toHaveLastReturnedWith(true)
})

function realSharedFixture() {
  const root = home()
  const shared = path.join(root, 'shared')
  const local = path.join(root, 'workspace-a')
  fs.mkdirSync(shared)
  fs.mkdirSync(local)
  const store = createSharedProfileStore({
    home: local,
    shared,
    workspaceId: 'a',
    workspaceLabel: 'Fictional A',
    chromeState: () => 'ended',
    ownerState: () => 'alive',
    processIdentity: { pid: process.pid, birth: 'fictional' },
  })
  return { ...toolFixture(store), shared, store }
}
it.each(['off-on', 'permission'] as const)(
  'rereads a real shared registry after external %s while queued',
  async (change) => {
    const f = realSharedFixture()
    const blocker = deferred()
    const blocking = f.deps.serializer.runExclusive(f.tab.id, () => blocker.promise)
    const call = f.call('fill', { tabId: f.tab.id, ref: 'e1', text: 'fictional', submit: true })
    // The queued operation is admitted; an independent process changes only the fictional registry.
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import fs from 'node:fs';
    const file = process.argv[1];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const profile = data.profiles.find(p => p.name === 'fern');
    if (process.argv[2] === 'off-on') {
      profile.perWorkspace.a.enabled = true;
      profile.perWorkspace.a.enabled = false;
      profile.perWorkspace.a.accessEpoch = Number(profile.perWorkspace.a.accessEpoch ?? 0) + 1;
      fs.writeFileSync(file, JSON.stringify(data));
      profile.perWorkspace.a.enabled = true;
      profile.perWorkspace.a.accessEpoch++;
    } else {
      profile.allowExtensions = false;
      profile.permissionRevision++;
    }
    data.revision++;
    fs.writeFileSync(file, JSON.stringify(data));
  `,
        path.join(f.shared, 'registry.json'),
        change,
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    expect(child.status, child.stderr).toBe(0)
    blocker.resolve()
    await blocking
    await expect(call).rejects.toThrow('unavailable')
    expect(f.deps.browser.usePage).not.toHaveBeenCalled()
    expect(f.press).not.toHaveBeenCalled()
  },
)
it('launches against the real facade without treating lease or helper bookkeeping as revocation', async () => {
  const f = realSharedFixture()
  const before = f.store.shared!.authorization('fern')
  const browser = new ChromeBrowser({
    dirOf: f.store.dirOf,
    downloadsRoot: f.deps.downloadsRoot,
    acquireLease: f.store.shared!.acquire,
    authorization: f.store.shared!.authorization,
    lockHeld: async () => false,
    launchContext: async () => new Context() as unknown as BrowserContext,
  })
  try {
    await browser.ensure('fern', 'visible')
    expect(f.store.shared!.authorization('fern')).toBe(before)
    f.store.setHelper('fern', 'off')
    expect(f.store.shared!.authorization('fern')).toBe(before)
    await browser.close('fern')
    expect(f.store.shared!.authorization('fern')).toBe(before)
  } finally {
    await browser.closeAll()
  }
})

it('reuses the shared launch blank page and unwraps Page handles for native boundaries', async () => {
  const context = new Context()
  const page = Object.assign(new EventEmitter(), {
    isClosed: () => false,
    url: () => 'about:blank',
    context: () => context,
  }) as unknown as Page
  context.pages = () => [page]
  const f = browserFixture({ launchContext: async () => context as unknown as BrowserContext })
  try {
    await f.browser.ensure('fern', 'visible')
    const reused = await f.browser.newPage('fern', { newWindow: false })
    expect(unwrapBrowserHandle(reused)).toBe(page)
    const session = vi.fn(async (passed: Page) => {
      expect(passed).toBe(page)
      return {}
    })
    const guarded = fenceBrowserHandles({ newCDPSession: session }, () => {})
    await guarded.newCDPSession(unwrapBrowserHandle(reused))
    expect(session).toHaveBeenCalledOnce()
  } finally {
    await f.browser.closeAll()
  }
})

it('drops stale passive events while still draining close observers', () => {
  const raw = new EventEmitter()
  let allowed = true
  const guarded = fenceBrowserHandles(raw, () => {
    if (!allowed) throw new Error('revoked')
  })
  const observation = vi.fn()
  const closed = vi.fn()
  const reused = vi.fn()
  guarded.on('request', observation)
  guarded.on('close', closed)
  guarded.on('request', reused)
  guarded.on('close', reused)
  allowed = false
  expect(() => raw.emit('request', { method: () => 'GET' })).not.toThrow()
  expect(observation).not.toHaveBeenCalled()
  raw.emit('close')
  expect(closed).toHaveBeenCalledOnce()
  expect(reused).toHaveBeenCalledOnce()
})

it('keeps one window watcher when separate authorized tool calls use the same browser', async () => {
  const f = toolFixture()
  const pages = deferred<'pages-closed' | 'timeout'>()
  const wait = vi.fn(() => pages.promise)
  const close = vi.fn(async () => {})
  f.deps.browser.state = () => ({ mode: 'visible', generation: 1 })
  f.deps.browser.waitAllPagesClosed = wait
  f.deps.browser.close = close
  const [tool] = fenceToolDefs([
    {
      spec: { name: 'fixture', description: '', props: {} },
      async run(_args, deps) {
        watchWindow(deps, 'fern')
        return { json: null }
      },
    },
  ])
  await tool.run({ profile: 'fern' }, f.deps)
  await tool.run({ profile: 'fern' }, f.deps)
  expect(wait).toHaveBeenCalledOnce()
  pages.resolve('pages-closed')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(close).toHaveBeenCalledOnce()
})
