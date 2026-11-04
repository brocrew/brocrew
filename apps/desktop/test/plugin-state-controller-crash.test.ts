import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { packageFixture } from './plugin-package-fixtures'
import {
  fixture,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

afterEach(cleanupLifecycleFixtures)
it.each(['install', 'update', 'uninstall'] as const)(
  'retries the same %s allocation through the controller after archive commit but before pending publication',
  async (action) => {
    let armed = false
    const f = await fixture({}, false, 'fictional-bakery', (point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional interruption before selection')
      }
    })
    const manifest = parsePluginManifest(
      Buffer.from(
        JSON.stringify({
          ...f.pkg.manifest,
          format: 2,
          authors: ['fictional-baker'],
          server: null,
          toolApi: null,
          ui: null,
          uiApi: null,
          executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
          hooks: [
            {
              id: 'fictional-titles',
              kind: 'turn.context.titles',
              api: 1,
              optional: true,
              inputs: ['resource-titles'],
            },
          ],
        }),
      ),
    )
    let offered = packageFixture({ manifest })
    const offer = () => {
      f.opts.catalogue = { bytes: offered.bytes, signature: offered.signature }
      f.opts.download = async () => offered.archive
    }
    offer()
    let controller = await PluginLifecycleController.open(f.opts)
    let handle = await controller.attach(f.local.sink)
    if (action !== 'install') {
      const prepared = await controller.prepareMutation(
        handle,
        'install',
        manifest.id,
        offered.release.archive.sha256,
        pluginSha256(offered.bytes),
      )
      await controller.installPrepared(handle, manifest.id, prepared)
      if (action === 'update')
        offered = packageFixture({ manifest: { ...manifest, version: '9.0.0' } })
      offer()
      controller = await PluginLifecycleController.open(f.opts)
      handle = await controller.attach(f.local.sink)
    }
    const operationId = randomUUID()
    async function mutate(target: PluginLifecycleController, workspace: typeof handle) {
      if (action === 'uninstall') return target.uninstall(workspace, manifest.id, operationId)
      const prepared = await target.prepareMutation(
        workspace,
        action,
        manifest.id,
        offered.release.archive.sha256,
        pluginSha256(offered.bytes),
      )
      return action === 'install'
        ? target.installPrepared(workspace, manifest.id, prepared, operationId)
        : target.updatePrepared(workspace, manifest.id, prepared, operationId)
    }
    armed = true
    await expect(mutate(controller, handle)).rejects.toThrow()
    expect(armed).toBe(false)
    const archived = f.state.operation(operationId)!
    expect(archived).toBeDefined()
    expect(archived.status).toBe('prepared')
    expect(f.state.inspect().pending).toBeNull()
    const state = reopenLifecycleFixture(f)
    const recovered = await PluginLifecycleController.open({ ...f.opts, state })
    const nextHandle = await recovered.attach(f.local.sink)
    await expect(mutate(recovered, nextHandle)).resolves.toBeUndefined()
    expect(state.inspect().pending).toBeNull()
    expect(state.operation(operationId)).toMatchObject({
      status: 'completed',
      operation: { allocated: archived.operation.allocated },
    })
    if (action === 'uninstall') {
      expect(state.exportActivation().entries).toEqual([])
      expect(f.local.rows.has(manifest.id)).toBe(false)
    } else {
      expect(state.exportActivation().entries[0]?.incarnation).toBe(
        archived.operation.next?.incarnation,
      )
      expect(f.local.rows.get(manifest.id)?.installId).toBe(archived.operation.next?.installId)
    }
  },
)
