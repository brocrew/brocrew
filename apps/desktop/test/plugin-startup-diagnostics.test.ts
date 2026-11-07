import { randomUUID } from 'node:crypto'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { z } from 'zod'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginSupervisorLaunchFailure } from '../src/main/plugins/startup-failure'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import {
  fixture,
  projection,
  deferred,
  cleanupLifecycleFixtures,
} from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})

it.skipIf(process.platform === 'win32')(
  'carries initial and ended-run server causes only over the negotiated list',
  async () => {
    const f = await fixture()
    const diagnostic = {
      exitCode: 23,
      signal: null,
      stderr: 'Error: rejected /fictional/plugin/auth.json',
    }
    let exit = deferred<void>()
    let fail = false
    const originalStart = f.opts.runtime.start
    f.opts.runtime.start = async (spec) => {
      const run = await originalStart(spec)
      const runExit = exit
      return {
        ...run,
        exited: runExit.promise,
        stop: async () => {
          await run.stop()
          runExit.resolve()
        },
        startupDiagnostic: () => diagnostic,
        ready: async () => {
          if (fail) {
            runExit.resolve()
            throw new PluginSupervisorLaunchFailure(diagnostic)
          }
          return run.ready()
        },
      }
    }
    await f.controller.install(f.handle, 'chrome')
    await f.controller.drain()
    fail = true
    exit = deferred<void>()
    const controller = await PluginLifecycleController.open(f.opts)
    const failedHandle = await controller.attach(projection().sink)
    const key = 'b'.repeat(64)
    const service = await servePersonPluginControl({
      root: f.root,
      key,
      controller: sharedLifecycleWorkspaces(controller),
      read: async () => null,
    })
    const client = await connectPluginSettings({
      path: service.path,
      personKey: key,
      root: f.root,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
    })
    const legacy = await connectPersonPluginControl({
      path: service.path,
      key,
      handle: async () => true,
    })
    try {
      await legacy.call({
        kind: 'attach',
        workspaceId: randomUUID(),
        catalogueDigest: pluginSha256(f.opts.catalogue.bytes),
      })
      expect((await client.catalogue())[0]).toMatchObject({
        state: 'Unavailable',
        unavailableReason: 'plugin-start',
        startupDiagnostic: diagnostic,
      })
      const oldCard = z.strictObject({
        id: z.string(),
        name: z.string(),
        state: z.string(),
        installed: z.boolean(),
        uninstallDeletesData: z.boolean().optional(),
        installedVersion: z.string().optional(),
        toolsCause: z.string().optional(),
      })
      for (const kind of ['list', 'list-v2', 'list-tool-health', 'list-tool-cause']) {
        const reply = await legacy.call({ kind })
        expect(z.array(oldCard).safeParse(reply).success, kind).toBe(true)
        expect((reply as object[])[0]).not.toHaveProperty('startupDiagnostic')
      }
    } finally {
      await legacy.call({ kind: 'detach' })
      legacy.close()
      await client.close()
      await service.close()
    }
    f.failStop()
    await expect(controller.uninstall(failedHandle, 'chrome')).rejects.toMatchObject({
      code: 'cleanup-pending',
    })
    expect(f.state.inspect().pending?.next?.pluginId).toBe('chrome')
    expect((await controller.status()).cards[0]).toMatchObject({
      state: 'Unavailable',
      unavailableReason: 'operation-pending',
    })
    f.failStop(false)
    await controller.uninstall(failedHandle, 'chrome')
    expect((await controller.status()).cards[0]).toMatchObject({
      installed: false,
      state: 'Available',
    })
    expect((await controller.status()).cards[0]).not.toHaveProperty('startupDiagnostic')
    expect((await controller.status()).cards[0]).not.toHaveProperty('unavailableReason')
    await controller.drain()
    fail = false
    exit = deferred<void>()
    const installer = await PluginLifecycleController.open(f.opts)
    const installing = await installer.attach(projection().sink)
    await installer.install(installing, 'chrome')
    await installer.drain()
    // A fresh run that reaches ready and later closes keeps the same diagnostic on its blocked card.
    fail = false
    exit = deferred<void>()
    const running = await PluginLifecycleController.open(f.opts)
    await running.attach(projection().sink)
    expect((await running.status()).cards[0]?.state).toBe('Running')
    exit.resolve()
    await vi.waitFor(async () => {
      expect((await running.status()).cards[0]).toMatchObject({
        state: 'Unavailable',
        unavailableReason: 'plugin-start',
        startupDiagnostic: diagnostic,
      })
    })
  },
)
