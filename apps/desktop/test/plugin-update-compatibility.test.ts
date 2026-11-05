import { observeInstalled } from './plugin-installed-observation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleWorkspace } from '../src/main/plugins/lifecycle/types'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import {
  JournalRecord as ParentRecord,
  decodeState as decodeParent,
  encodeState as encodeParent,
} from './fixtures/plugin-encoder-820/state-format'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import parentSources from './fixtures/plugin-update-parent/source.json'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('No network in the fictional compatibility control')
    }),
  )
})
afterEach(async () => {
  await cleanupLifecycleFixtures()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const snapshotRoot = fileURLToPath(new URL('./fixtures/plugin-update-parent/', import.meta.url))
async function accepted(
  controller: PluginLifecycleController,
  handle: LifecycleWorkspace,
  id: string,
  installId: string,
) {
  const workspaceId = controller.hostWorkspace(handle)
  let resolve!: () => void, reject!: (error: unknown) => void
  const ready = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const check = () => {
    try {
      if (controller.admitted(handle, id, installId)) resolve()
    } catch (error) {
      reject(error)
    }
  }
  const stop = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  try {
    check()
    await ready
  } finally {
    stop()
  }
}
async function withDrain(controller: PluginLifecycleController, body: () => Promise<void>) {
  const failures: unknown[] = []
  try {
    await body()
  } catch (error) {
    failures.push(error)
  }
  try {
    controller.consumersEnded()
    await controller.drain()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) throw new AggregateError(failures, 'Compatibility body or drain failed')
}
it.each(parentSources.files)(
  'pins unavailable historical producer source as labelled read-only data $path',
  async (source) => {
    const adapted = await readFile(join(snapshotRoot, source.file), 'utf8')
    expect(createHash('sha256').update(adapted).digest('hex')).toBe(source.frozenSha256)
    expect(source.status).toContain('source unavailable')
    const imports = new Map<string, string | undefined>(Object.entries(source.imports))
    const original = adapted.replace(/from '(\.[^']+)'/g, (_, spec: string) => {
      const originalImport = imports.get(spec)
      expect(originalImport).toBeDefined()
      return `from '${originalImport}'`
    })
    expect(createHash('sha256').update(original).digest('hex')).toBe(source.sourceSha256)
  },
)
function exitable(f: Awaited<ReturnType<typeof fixture>>) {
  const start = f.opts.runtime.start
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    let finish!: () => void
    const exited = new Promise<void>((resolve) => {
      finish = resolve
    })
    return {
      ...run,
      exited,
      async stop() {
        await run.stop()
        finish()
      },
    }
  }
}
async function prepared() {
  const f = await fixture({}, false, 'fictional-bakery')
  exitable(f)
  const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
  f.opts.download = async (release) =>
    release.version === next.release.version ? next.archive : f.pkg.archive
  f.opts.refreshCatalogue = async () => ({
    catalogue: { bytes: next.bytes, signature: next.signature },
    names: f.opts.names,
  })
  await f.controller.install(f.handle, 'fictional-bakery')
  const data = join(f.root, 'data', 'fictional-bakery')
  await mkdir(data, { recursive: true })
  await writeFile(join(data, 'login'), 'fictional-paired-phone')
  await writeFile(join(data, 'profiles.json'), '{"birch":{"enabled":false}}')
  await writeFile(join(data, 'consumed-commands.json'), '{"open-once":"consumed"}')
  await f.controller.refreshCatalogue(pluginSha256(next.bytes))
  return { ...f, next, data }
}
const clientOptions = (f: Awaited<ReturnType<typeof fixture>>, path: string) => ({
  path,
  personKey: 'a'.repeat(64),
  root: f.root,
  pinnedPublicKey: f.opts.pinnedPublicKey,
  target: f.opts.target,
  catalogue: { bytes: f.pkg.bytes, signature: f.pkg.signature },
  download: f.opts.download,
  projection: projection().sink,
})
async function diskBytes(root: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name.startsWith('writer-lock.sqlite')) continue
    const path = join(root, item.name),
      relative = prefix + item.name
    if (item.isDirectory()) Object.assign(files, await diskBytes(path, relative + '/'))
    else files[relative] = pluginSha256(await readFile(path))
  }
  return files
}
describe.skipIf(process.platform === 'win32')(
  'ordinary updates and retained legacy package data on fictional roots',
  () => {
    it.each(['install', 'update'] as const)(
      'keeps ordinary %s working with an intact historical v2 legacy-row vault',
      async (action) => {
        const f = await fixture({}, false, 'fictional-bakery')
        exitable(f)
        if (action === 'update') await f.controller.install(f.handle, 'fictional-bakery')
        await f.controller.drain()
        const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
        const historical = signed({ format: 2, entries: [{ ...next.release, legacy: true }] })
        const kept = join(f.root, 'package-vault', next.release.archive.sha256)
        await mkdir(kept, { recursive: true })
        await writeFile(join(kept, 'archive'), next.archive)
        await writeFile(join(kept, 'catalogue.json'), historical.bytes)
        await writeFile(join(kept, 'catalogue.sig'), historical.signature)
        const data = join(f.root, 'data', 'fictional-bakery', 'pairing.bin')
        await mkdir(join(f.root, 'data', 'fictional-bakery'), { recursive: true })
        const pairing = Buffer.from([0, 255, 17, 10])
        await writeFile(data, pairing)
        const download = vi.fn(async () => next.archive)
        const controller = await PluginLifecycleController.open({
          ...f.opts,
          catalogue: historical,
          download,
        })
        try {
          const handle = await controller.attach(projection().sink)
          const starts = f.starts()
          await controller[action](handle, 'fictional-bakery')
          expect((await controller.status()).cards).toMatchObject([
            {
              id: 'fictional-bakery',
              installed: true,
              state: 'Running',
              installedVersion: '1.0.3',
            },
          ])
          expect(f.state.currentInstallation('fictional-bakery')?.release).toMatchObject({
            version: '1.0.3',
            archiveSha256: pluginSha256(next.archive),
            manifestSha256: next.release.manifestSha256,
          })
          expect(f.state.inspect().pending).toBeNull()
          expect(f.starts()).toBe(starts + 1)
          expect(download).toHaveBeenCalledOnce()
          expect(await readFile(data)).toEqual(pairing)
          expect(await readFile(join(kept, 'archive'))).toEqual(next.archive)
          expect(await readFile(join(kept, 'catalogue.json'))).toEqual(historical.bytes)
          expect(await readFile(join(kept, 'catalogue.sig'))).toEqual(historical.signature)
          expect(fetch).not.toHaveBeenCalled()
        } finally {
          await controller.drain()
        }
      },
    )
    it('a caller keeps listing and installed bytes when the owner selects a different catalogue', async () => {
      const f = await prepared()
      const data = await diskBytes(f.data)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: sharedLifecycleWorkspaces(f.controller),
      })
      const client = await connectPluginSettings(clientOptions(f, bridge.path))
      try {
        expect(await client.catalogue()).toMatchObject([
          { id: 'fictional-bakery', installed: true, state: 'Running', installedVersion: '1.0.0' },
        ])
        await expect(client.screen('fictional-bakery')).rejects.toThrow()
        const screen = await observeInstalled(f.opts, f.state, 'fictional-bakery')
        expect(screen.package.readFile('plugin.json')).toEqual(Uint8Array.from(f.pkg.manifestBytes))
        await f.controller.update(f.handle, 'fictional-bakery')
        expect(f.state.currentInstallation('fictional-bakery')?.incarnation).not.toBe(
          screen.installation.incarnation,
        )
        expect((await client.catalogue())[0]).toMatchObject({
          state: 'Running',
          installedVersion: '1.0.3',
        })
        const current = await observeInstalled(f.opts, f.state, 'fictional-bakery')
        expect(current.installation.installId).toBe(screen.installation.installId)
        expect(current.package.readFile('plugin.json')).toEqual(
          Uint8Array.from(f.next.manifestBytes),
        )
        expect(await diskBytes(f.data)).toEqual(data)
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        await client.close()
        await bridge.close()
        await f.controller.drain()
      }
    })
    it('ordinary local updates work without optional owner features and retain opaque legacy data', async () => {
      const f = await prepared()
      const data = await diskBytes(f.data)
      const path = join(f.parent, 'fictional-selected-update.tar')
      await writeFile(path, f.next.archive)
      const call = PersonChannel.prototype.call
      vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(function (
        this: PersonChannel,
        input,
      ) {
        if (input && typeof input === 'object' && 'kind' in input && input.kind === 'features')
          return Promise.resolve({ features: [] })
        return call.call(this, input)
      })
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: sharedLifecycleWorkspaces(f.controller),
      })
      const client = await connectPluginSettings(clientOptions(f, bridge.path))
      try {
        expect(client.features!()).toEqual([])
        expect(client.mutationRequired!()).toBe(false)
        await expect(client.screen('fictional-bakery')).rejects.toThrow()
        const before = f.state.currentInstallation('fictional-bakery')!
        const selected = await client.inspectPackage!({ source: path })
        expect(selected.ref).toEqual({
          source: path,
          sha256: pluginSha256(f.next.archive),
          bytes: f.next.archive.length,
        })
        expect(selected.details).toMatchObject({
          authors: null,
          permissions: f.next.manifest.permissions,
          digest: selected.ref.sha256,
        })
        await client.applyPackage!(selected.ref, 'update')
        expect(f.state.currentInstallation('fictional-bakery')?.incarnation).not.toBe(
          before.incarnation,
        )
        expect(f.state.currentInstallation('fictional-bakery')?.installId).toBe(before.installId)
        expect((await client.catalogue())[0]).toMatchObject({
          installed: true,
          state: 'Running',
          installedVersion: '1.0.3',
        })
        expect(
          (await observeInstalled(f.opts, f.state, 'fictional-bakery')).package.readFile(
            'plugin.json',
          ),
        ).toEqual(Uint8Array.from(f.next.manifestBytes))
        expect(f.state.inspect().pending).toBeNull()
        expect(await diskBytes(f.data)).toEqual(data)
        expect(await readFile(path)).toEqual(f.next.archive)
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        await client.close()
        await bridge.close()
        await f.controller.drain()
      }
    })
    it.each([
      'staged',
      'update-fenced',
      'prepared',
      'prepared-missing',
      'ready',
      'receipted',
      'activated',
      'complete',
    ] as const)(
      'retains selected bytes and opaque data across %s, then recovers offline without replay',
      async (boundary) => {
        const f = await prepared()
        const data = await diskBytes(f.data)
        const operationId = '00000000-0000-4000-8000-000000000001'
        const reached: string[] = []
        f.opts.fault = (point) => {
          if (
            boundary !== 'complete' &&
            point === (boundary === 'prepared-missing' ? 'prepared' : boundary)
          ) {
            reached.push(point)
            throw new Error('fictional interruption')
          }
        }
        const update = f.controller.update(f.handle, 'fictional-bakery', operationId)
        if (boundary === 'complete') await update
        else await expect(update).rejects.toThrow()
        expect(reached).toEqual(
          boundary === 'complete' ? [] : [boundary === 'prepared-missing' ? 'prepared' : boundary],
        )
        if (boundary === 'prepared-missing')
          await unlink(join(f.root, 'lifecycle-effects', operationId + '.json'))
        await f.controller.drain()
        const expectedVersion =
          boundary === 'staged' || boundary === 'update-fenced' ? '1.0.0' : '1.0.3'
        const selected = expectedVersion === '1.0.0' ? f.pkg : f.next
        const download = vi.fn(async () => {
          throw new Error('fictional offline recovery')
        })
        const start = vi.fn(f.opts.runtime.start)
        const removeData = vi.fn(async () => {})
        const removeCode = vi.fn(async () => {})
        const state = reopenLifecycleFixture(f)
        const current = await PluginLifecycleController.open({
          ...f.opts,
          state,
          fault: undefined,
          download,
          runtime: { ...f.opts.runtime, start, removeData, removeCode },
        })
        await withDrain(current, async () => {
          const handle = await current.attach(projection().sink)
          await accepted(
            current,
            handle,
            'fictional-bakery',
            state.currentInstallation('fictional-bakery')!.installId,
          )
          expect(state.inspect().pending).toBeNull()
          expect(state.exportActivation().entries[0]?.release).toMatchObject({
            version: expectedVersion,
            archiveSha256: pluginSha256(selected.archive),
            manifestSha256: selected.release.manifestSha256,
          })
          expect(
            current.screen(handle, 'fictional-bakery').package.readFile('plugin.json'),
          ).toEqual(Uint8Array.from(selected.manifestBytes))
          if (boundary !== 'staged' && boundary !== 'update-fenced') {
            const beforeRetry = start.mock.calls.length
            await current.update(handle, 'fictional-bakery', operationId)
            expect(start).toHaveBeenCalledTimes(beforeRetry)
            expect(state.operation(operationId)?.status).toBe('completed')
          }
          expect(download).not.toHaveBeenCalled()
          expect(fetch).not.toHaveBeenCalled()
          expect(removeData).not.toHaveBeenCalled()
          expect(removeCode).not.toHaveBeenCalled()
          expect(await diskBytes(f.data)).toEqual(data)
          expect(
            await readFile(
              join(f.root, 'package-vault', selected.release.archive.sha256, 'archive'),
            ),
          ).toEqual(selected.archive)
        })
      },
    )
  },
)

describe.skipIf(process.platform === 'win32')(
  'interrupted migration of retained legacy installation and archive bytes',
  () => {
    it.each(['staged', 'published', 'durable'] as const)(
      'reopens the selected legacy package after atomic migration is interrupted at %s',
      async (point) => {
        const f = await prepared()
        const selected = f.state.exportActivation()
        const install = selected.entries[0]!
        const operation = f.state
          .inspect()
          .operations.find((one) => one.operation.request.consent.action === 'install')!.operation
        const data = await diskBytes(f.data)
        await f.controller.drain()
        f.state.close()
        const root = join(f.root, 'state')
        const guard = join(root, 'lifecycle-guard')
        const activations = join(root, 'activations')
        await mkdir(guard, { recursive: true })
        await mkdir(activations, { recursive: true })
        const activation = encodeParent(selected)
        const activationName = '00000002-' + pluginSha256(activation) + '.json'
        await writeFile(join(activations, activationName), activation)
        const events = [
          { kind: 'created', rootId: selected.rootId, epoch: selected.epoch },
          { kind: 'prepared', operation },
          {
            kind: 'completed',
            operationId: operation.request.operationId,
            activation: { name: activationName, sha256: pluginSha256(activation) },
          },
        ]
        let previous: string | null = null
        for (const [sequence, event] of events.entries()) {
          const bytes = encodeParent({ sequence, previous, publicationId: randomUUID(), event })
          expect(() => decodeParent(bytes, ParentRecord)).not.toThrow()
          await writeFile(join(guard, String(sequence).padStart(8, '0') + '.json'), bytes)
          previous = pluginSha256(bytes)
        }
        const oldJournal = await diskBytes(guard)
        const oldActivations = await diskBytes(activations)
        const vault = join(f.root, 'package-vault', install.release.archiveSha256)
        await unlink(join(vault, 'release.json'))
        await writeFile(join(vault, 'catalogue.json'), f.pkg.bytes)
        await writeFile(join(vault, 'catalogue.sig'), f.pkg.signature)
        const oldVault = await diskBytes(vault)
        await unlink(join(root, 'installed-state.json'))
        expect(() =>
          GlobalPluginState.open({
            root,
            workspaceRoots: [f.workspace],
            fault(at) {
              if (at === point) throw new Error('fictional migration interruption')
            },
          }),
        ).toThrow('fictional migration interruption')
        const state = reopenLifecycleFixture(f)
        expect(state.exportActivation()).toEqual(selected)
        expect(state.operation(operation.request.operationId)?.status).toBe('completed')
        expect(state.inspect().pending).toBeNull()
        const snapshot = await readFile(join(root, 'installed-state.json'))
        expect(() => state.requireUpdateReader()).not.toThrow()
        state.requireUpdateReader()
        expect(await readFile(join(root, 'installed-state.json'))).toEqual(snapshot)
        const download = vi.fn(async () => {
          throw new Error('fictional offline migration')
        })
        const removeData = vi.fn(async () => {})
        const current = await PluginLifecycleController.open({
          ...f.opts,
          state,
          download,
          fault: undefined,
          catalogue: signed({ format: 1, entries: [] }),
          runtime: { ...f.opts.runtime, removeData },
        })
        await withDrain(current, async () => {
          const handle = await current.attach(projection().sink)
          await accepted(current, handle, 'fictional-bakery', install.installId)
          expect(
            current.screen(handle, 'fictional-bakery').package.readFile('plugin.json'),
          ).toEqual(Uint8Array.from(f.pkg.manifestBytes))
          expect(state.currentInstallation('fictional-bakery')?.installId).toBe(install.installId)
          expect(await diskBytes(guard)).toEqual(oldJournal)
          expect(await diskBytes(activations)).toEqual(oldActivations)
          expect(await diskBytes(vault)).toEqual(oldVault)
          expect(await diskBytes(f.data)).toEqual(data)
          expect(download).not.toHaveBeenCalled()
          expect(fetch).not.toHaveBeenCalled()
          expect(removeData).not.toHaveBeenCalled()
        })
      },
    )
  },
)
