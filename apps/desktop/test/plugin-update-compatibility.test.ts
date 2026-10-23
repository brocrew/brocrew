import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import {
  JournalRecord as ParentRecord,
  decodeState as decodeParent,
} from './fixtures/plugin-update-parent/state-format'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { GlobalPluginState as ParentState } from './fixtures/plugin-update-parent/state-store'
import { PluginLifecycleController as ParentController } from './fixtures/plugin-update-parent/lifecycle-controller'
import { servePersonPluginControl as parentServer } from './fixtures/plugin-update-parent/lifecycle-person-control'
import { connectPluginSettings as parentClient } from './fixtures/plugin-update-parent/lifecycle-settings-client'
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
it.each(parentSources.files)(
  'uses the actual pinned parent $path, changing only import locations',
  async (source) => {
    const adapted = await readFile(join(snapshotRoot, source.file), 'utf8')
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
  const f = await fixture({}, false, 'whatsapp')
  exitable(f)
  const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
  f.opts.download = async (release) =>
    release.version === next.release.version ? next.archive : f.pkg.archive
  f.opts.refreshCatalogue = async () => ({
    catalogue: { bytes: next.bytes, signature: next.signature },
    names: f.opts.names,
  })
  await f.controller.install(f.handle, 'whatsapp')
  const data = join(f.root, 'data', 'whatsapp')
  await mkdir(data, { recursive: true })
  await writeFile(join(data, 'login'), 'fictional-paired-phone')
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
  projection: projection().sink,
  propose() {},
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
  'mixed-version plugin owners on fictional roots',
  () => {
    it.each(['install', 'update'] as const)(
      'keeps raw %s refused with a historical v2 legacy-row vault',
      async (action) => {
        const f = await fixture()
        exitable(f)
        const historical = await ParentController.open({
          ...f.opts,
          state: f.state as never,
          catalogue: signed({ format: 2, entries: [{ ...f.pkg.release, legacy: true }] }),
        })
        await historical.install(await historical.attach(projection().sink), 'chrome')
        await historical.drain()
        const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
        const download = vi.fn(async () => next.archive)
        const controller = await PluginLifecycleController.open({
          ...f.opts,
          catalogue: signed({ format: 2, entries: [{ ...next.release, legacy: true }] }),
          download,
        })
        try {
          const handle = await controller.attach(projection().sink)
          const before = {
            state: structuredClone(f.state.inspect()),
            tree: await diskBytes(f.root),
            events: [...f.events],
            starts: f.starts(),
            downloads: download.mock.calls.length,
          }
          await expect(controller[action](handle, 'chrome')).rejects.toMatchObject({
            code: 'policy-refused',
          })
          expect({
            state: f.state.inspect(),
            tree: await diskBytes(f.root),
            events: [...f.events],
            starts: f.starts(),
            downloads: download.mock.calls.length,
          }).toEqual(before)
        } finally {
          await controller.drain()
        }
      },
    )
    it('the parent client keeps listing and Configure against a new owner with a newer catalogue', async () => {
      const f = await prepared()
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: f.controller,
        read: async () => ({}),
      })
      const client = await parentClient(clientOptions(f, bridge.path))
      try {
        expect(await client.catalogue()).toMatchObject([
          { id: 'whatsapp', installed: true, state: 'Running' },
        ])
        expect(Object.keys((await client.catalogue())[0]!).sort()).toEqual([
          'id',
          'installed',
          'name',
          'state',
        ])
        const screen = await client.screen('whatsapp')
        expect(screen.current(screen.binding)).toBe(true)
        expect(screen.verified.manifest.version).toBe(f.pkg.manifest.version)
        await f.controller.update(f.handle, 'whatsapp')
        expect((await client.catalogue())[0]?.state).toBe('Running')
        expect((await client.screen('whatsapp')).verified.manifest.version).toBe('1.0.3')
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
      } finally {
        await client.close()
        await bridge.close()
        await f.controller.drain()
      }
    })
    it('the new client lists and configures under the actual parent owner without offering unsupported verbs', async () => {
      const f = await fixture({}, false, 'whatsapp')
      exitable(f)
      f.state.close()
      const state = ParentState.open({ root: join(f.root, 'state'), workspaceRoots: [f.workspace] })
      const controller = await ParentController.open({ ...f.opts, state: state as never })
      const handle = await controller.attach(projection().sink)
      await controller.install(handle, 'whatsapp')
      const bridge = await parentServer({
        root: f.root,
        key: 'a'.repeat(64),
        controller,
        read: async () => ({}),
      })
      // The window's list can have advanced while the older owner retains its admitted list.
      const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
      const client = await connectPluginSettings({
        ...clientOptions(f, bridge.path),
        catalogue: { bytes: next.bytes, signature: next.signature },
      })
      try {
        expect(client.refreshCatalogue).toBeUndefined()
        expect(client.update).toBeUndefined()
        expect(await client.catalogue()).toMatchObject([
          { installed: true, state: 'Running', uninstallDeletesData: true },
        ])
        const screen = await client.screen('whatsapp')
        expect(screen.current(screen.binding)).toBe(true)
        expect(screen.verified.manifest.version).toBe(f.pkg.manifest.version)
        expect(state.inspect().pending).toBeNull()
      } finally {
        await client.close()
        await bridge.close()
        await controller.drain()
        state.close()
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
      'the parent owner replays or refuses without recovery effects after %s, and the new owner recovers',
      async (boundary) => {
        const f = await prepared()
        const operationId = '00000000-0000-4000-8000-000000000001'
        f.opts.fault = (point) => {
          if (point === (boundary === 'prepared-missing' ? 'prepared' : boundary))
            throw new Error('fictional interruption')
        }
        await f.controller.update(f.handle, 'whatsapp', operationId).catch(() => {})
        if (boundary === 'prepared-missing')
          await unlink(join(f.root, 'lifecycle-effects', operationId + '.json'))
        await f.controller.drain()
        f.state.close()
        const before = await diskBytes(f.root)
        const guard = join(f.root, 'state', 'lifecycle-guard')
        const records = await Promise.all(
          (await readdir(guard))
            .filter((name) => /^\d{8}\.json$/.test(name))
            .sort()
            .map(async (name) => {
              const bytes = await readFile(join(guard, name))
              return { bytes, record: JSON.parse(JSON.parse(bytes.toString()).payload) }
            }),
        )
        if (boundary !== 'staged') {
          const floor = records.findIndex(({ record }) => record.event.kind === 'reader-floor')
          expect(floor).toBeGreaterThan(0)
          for (const entry of records.slice(0, floor))
            expect(() => decodeParent(entry.bytes, ParentRecord)).not.toThrow()
          expect(() => decodeParent(records[floor]!.bytes, ParentRecord)).toThrow()
          const updating = records.findIndex(
            ({ record }) => record.event.operation?.request.consent.action === 'update',
          )
          if (updating >= 0) expect(updating).toBeGreaterThan(floor)
        }
        const start = vi.fn(f.opts.runtime.start),
          removeData = vi.fn(),
          removeCode = vi.fn()
        const attempt = async () => {
          const state = ParentState.open({
            root: join(f.root, 'state'),
            workspaceRoots: [f.workspace],
          })
          try {
            const parent = await ParentController.open({
              ...f.opts,
              state: state as never,
              catalogue: { bytes: f.pkg.bytes, signature: f.pkg.signature },
              runtime: { ...f.opts.runtime, start, removeData, removeCode },
            })
            await parent.attach(projection().sink)
            await parent.drain()
          } finally {
            state.close()
          }
        }
        if (boundary === 'staged') await expect(attempt()).resolves.toBeUndefined()
        else {
          await expect(attempt()).rejects.toMatchObject({
            name: 'PluginStateError',
            code: 'corrupt',
          })
          expect(await diskBytes(f.root)).toEqual(before)
          expect(start).not.toHaveBeenCalled()
        }
        expect(fetch).not.toHaveBeenCalled()
        expect(removeData).not.toHaveBeenCalled()
        expect(removeCode).not.toHaveBeenCalled()
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
        const state = reopenLifecycleFixture(f)
        const current = await PluginLifecycleController.open({ ...f.opts, state, fault: undefined })
        await current.attach(projection().sink)
        expect(state.inspect().pending).toBeNull()
        expect(state.exportActivation().entries[0]?.release.version).toBe(
          boundary === 'staged' || boundary === 'update-fenced' ? f.pkg.manifest.version : '1.0.3',
        )
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
        await current.drain()
      },
    )
  },
)

describe.skipIf(process.platform === 'win32')(
  'reader-floor publication interrupts on fictional roots',
  () => {
    it.each(['staged', 'published', 'durable'] as const)(
      'the old reader stays safe when the floor is interrupted at %s',
      async (point) => {
        const f = await prepared()
        await f.controller.drain()
        f.state.close()
        let armed = false
        const state = GlobalPluginState.open({
          root: join(f.root, 'state'),
          workspaceRoots: [f.workspace],
          fault(at) {
            if (armed && at === point) throw new Error('fictional floor interruption')
          },
        })
        armed = true
        expect(() => state.requireUpdateReader()).toThrow()
        state.close()
        const before = await diskBytes(f.root)
        const attempt = () => {
          const parent = ParentState.open({
            root: join(f.root, 'state'),
            workspaceRoots: [f.workspace],
          })
          try {
            expect(parent.exportActivation().entries[0]?.release.version).toBe(
              f.pkg.manifest.version,
            )
          } finally {
            parent.close()
          }
        }
        if (point === 'staged') expect(attempt).not.toThrow()
        else {
          expect(attempt).toThrow()
          expect(await diskBytes(f.root)).toEqual(before)
        }
        expect(await readFile(join(f.data, 'login'), 'utf8')).toBe('fictional-paired-phone')
        const current = GlobalPluginState.open({
          root: join(f.root, 'state'),
          workspaceRoots: [f.workspace],
        })
        try {
          expect(current.inspect().pending).toBeNull()
          current.requireUpdateReader()
          current.requireUpdateReader()
          expect(current.exportActivation().entries[0]?.release.version).toBe(
            f.pkg.manifest.version,
          )
        } finally {
          current.close()
        }
      },
    )
  },
)
