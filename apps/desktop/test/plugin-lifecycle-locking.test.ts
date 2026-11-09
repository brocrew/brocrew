import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleRuntime } from '../src/main/plugins/lifecycle/types'
import { catalogueBytes, packageFixture } from './plugin-package-fixtures'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})

async function installedPair() {
  const f = await fixture()
  const whatsapp = packageFixture({ manifest: { ...f.pkg.manifest, id: 'whatsapp' } })
  f.opts.catalogue = catalogueBytes({ format: 1, entries: [f.pkg.release, whatsapp.release] })
  f.opts.download = async (release) => (release.id === 'chrome' ? f.pkg.archive : whatsapp.archive)
  await f.controller.install(f.handle, 'chrome')
  await f.controller.install(f.handle, 'whatsapp')
  return f
}
function runtime(beforeStart: (id: string) => Promise<void> = async () => {}) {
  const starts: string[] = [],
    stops: string[] = []
  const peer: LifecycleRuntime = {
    previousOwnerClean: async () => true,
    removeCode: async () => {},
    removeData: async () => {},
    async start(input) {
      const id = input.package.manifest.id
      starts.push(id)
      await beforeStart(id)
      const exit = deferred<void>()
      return {
        runId: randomUUID(),
        exited: exit.promise,
        async ready() {
          return {
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }
        },
        async stop() {
          stops.push(id)
          exit.resolve()
        },
      }
    },
  }
  return { peer, starts, stops }
}
function apply(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const install = f.state.readWorkspaceAdmission().installations.find((one) => one.pluginId === id)!
  return f.controller.applyProfile(f.handle, {
    pluginId: id,
    installId: install.installId,
    incarnation: install.incarnation,
    revision: 0,
    proposal:
      id === 'chrome'
        ? { action: 'create-profile', profile: 'birch' }
        : { action: 'set-read', enabled: true },
  })
}

it('starts WhatsApp and reads status while Chrome attach start is suspended', async () => {
  const f = await installedPair()
  const entered = deferred<void>(),
    release = deferred<void>()
  const peers = runtime(async (id) => {
    if (id === 'chrome') {
      entered.resolve()
      await release.promise
    }
  })
  const controller = await PluginLifecycleController.open({ ...f.opts, runtime: peers.peer })
  const attaching = controller.attach(projection().sink)
  await entered.promise
  let statusDone = false
  const status = controller.status().then(() => {
    statusDone = true
  })
  try {
    await vi.waitFor(() => {
      expect(peers.starts).toContain('whatsapp')
      expect(statusDone).toBe(true)
    })
  } finally {
    release.resolve()
    await Promise.all([attaching, status])
  }
})

it('applies WhatsApp and reads status while a Chrome profile request is suspended', async () => {
  const f = await installedPair()
  const entered = deferred<void>(),
    release = deferred<void>()
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/profiles')) {
      entered.resolve()
      await release.promise
      return new Response('{}', { status: 201 })
    }
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const chrome = apply(f, 'chrome')
  await entered.promise
  let whatsappDone = false,
    statusDone = false
  const whatsapp = apply(f, 'whatsapp').then(() => {
    whatsappDone = true
  })
  const status = f.controller.status().then(() => {
    statusDone = true
  })
  try {
    await vi.waitFor(() => {
      expect(whatsappDone).toBe(true)
      expect(statusDone).toBe(true)
    })
  } finally {
    release.resolve()
    await Promise.all([chrome, whatsapp, status])
  }
})

it('serializes Chrome restart after its profile apply', async () => {
  const f = await installedPair()
  const entered = deferred<void>(),
    release = deferred<void>()
  vi.stubGlobal('fetch', async () => {
    entered.resolve()
    await release.promise
    return new Response('{}', { status: 201 })
  })
  const applying = apply(f, 'chrome')
  await entered.promise
  const stopped = vi.fn()
  const restarting = f.controller.restartChromeTools(undefined, stopped)
  try {
    // An independent read completes while the same-plugin restart stays queued.
    let read = false
    const status = f.controller.status().then(() => {
      read = true
    })
    await vi.waitFor(() => expect(read).toBe(true))
    expect(stopped).not.toHaveBeenCalled()
    release.resolve()
    await status
  } finally {
    release.resolve()
    await Promise.all([applying, restarting])
  }
  expect(stopped).toHaveBeenCalledOnce()
})

it.each(['update', 'global-restore'] as const)(
  'attach excludes pending %s without waiting for its writer',
  async (action) => {
    const f = await installedPair()
    const peers = runtime()
    const controller = await PluginLifecycleController.open({ ...f.opts, runtime: peers.peer })
    const entered = deferred<void>(),
      release = deferred<void>()
    const operationId = randomUUID()
    const writer = f.state.withExclusive(async () => {
      const state = f.state.inspect(),
        before = f.state.exportActivation()
      const chrome = before.entries.find((one) => one.pluginId === 'chrome')!
      f.state.prepare({
        operationId,
        snapshot: action === 'global-restore' ? before : null,
        consent: {
          action,
          pluginId: action === 'update' ? 'chrome' : null,
          at: 1000,
          expectedSequence: state.sequence,
          expectedInstallId: action === 'update' ? chrome.installId : null,
          release: action === 'update' ? chrome.release : null,
        },
      })
      entered.resolve()
      await release.promise
      f.state.abort(operationId)
    })
    await entered.promise
    let attached = false
    const attaching = controller.attach(projection().sink).then(() => {
      attached = true
    })
    try {
      await vi.waitFor(() => expect(attached).toBe(true))
      expect(peers.starts).toEqual(action === 'update' ? ['whatsapp'] : [])
    } finally {
      release.resolve()
      await Promise.all([writer, attaching])
    }
  },
)

it('drain waits for an attach start already in flight and stops its late run', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const entered = deferred<void>(),
    release = deferred<void>()
  const peers = runtime(async (id) => {
    if (id === 'chrome') {
      entered.resolve()
      await release.promise
    }
  })
  const controller = await PluginLifecycleController.open({ ...f.opts, runtime: peers.peer })
  const attaching = controller.attach(projection().sink)
  await entered.promise
  let drained = false
  const drain = controller.drain().then(() => {
    drained = true
  })
  try {
    // Status is an independent completion witness while the start is suspended.
    let read = false
    const status = controller.status().then(() => {
      read = true
    })
    await vi.waitFor(() => expect(read).toBe(true))
    expect(drained).toBe(false)
    await status
  } finally {
    release.resolve()
    await attaching
    await drain
  }
  expect(peers.stops).toEqual(['chrome'])
  expect(controller.cleanForShutdown()).toBe(true)
})
