import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import {
  PluginStateError,
  ActivationSnapshot,
  decodeState,
  type Consent,
  type OperationRequest,
} from '../src/main/plugins/state/format'

const roots: string[] = []
const stores: GlobalPluginState[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function folder() {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-state-'))
  roots.push(path)
  return path
}
function fixture(fault?: (point: 'staged' | 'published' | 'durable') => void) {
  const parent = folder(),
    root = join(parent, 'plugins')
  const options = { root, workspaceRoots: [], fault }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  return {
    parent,
    root,
    store,
    options,
    open() {
      const next = GlobalPluginState.open(options)
      stores.push(next)
      return next
    },
  }
}
const release = (version = '1.0.0') => ({
  version,
  archiveSha256: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  dataSchema: 1,
})
function request(
  store: GlobalPluginState,
  action: Consent['action'] = 'install',
  pluginId = 'fictional-bakery',
): OperationRequest {
  const view = store.inspect(),
    before = view.guards.find((entry) => entry.pluginId === pluginId)
  return {
    operationId: randomUUID(),
    consent: {
      action,
      pluginId: action === 'global-restore' ? null : pluginId,
      at: 1000,
      expectedSequence: view.sequence,
      expectedInstallId: action === 'global-restore' ? null : (before?.installId ?? null),
      release: action === 'install' || action === 'update' ? release() : null,
    },
    snapshot: null,
  }
}
/** The plugin's current active install, as admission reads it; busy while an operation is pending. */
const active = (store: GlobalPluginState, id = 'fictional-bakery') =>
  store.exportActivation().entries.find((one) => one.pluginId === id) ?? null
function install(store: GlobalPluginState) {
  const input = request(store)
  store.prepare(input)
  store.complete(input.operationId)
  return input
}

it('creates standalone state without a prior root admission', () => {
  const parent = folder(),
    root = join(parent, 'plugins')
  if (process.platform !== 'win32') chmodSync(parent, 0o755)
  const state = GlobalPluginState.create({ root, workspaceRoots: [] })
  state.close()
  expect(existsSync(root)).toBe(true)
  expect(readdirSync(parent)).toEqual(['plugins'])
})

describe.skipIf(process.platform === 'win32')(
  'global plugin state on private fictional folders',
  () => {
    it('refuses canonical global roots inside an aliased workspace on create and open', () => {
      const parent = folder(),
        workspace = join(parent, 'fictional-workspace'),
        alias = join(parent, 'alias')
      mkdirSync(workspace, { mode: 0o700 })
      symlinkSync(workspace, alias, 'dir')
      const root = join(workspace, 'plugins')
      expect(() => GlobalPluginState.create({ root, workspaceRoots: [alias] })).toThrow(
        expect.objectContaining({ code: 'unsafe-path' }),
      )
      expect(existsSync(root)).toBe(false)
      const store = GlobalPluginState.create({ root, workspaceRoots: [] })
      stores.push(store)
      expect(() => GlobalPluginState.open({ root, workspaceRoots: [alias] })).toThrow(
        expect.objectContaining({ code: 'unsafe-path' }),
      )
    })
    it('resolves workspace aliases without refusing a physically separate global root', () => {
      const parent = folder(),
        workspace = join(parent, 'fictional-workspace'),
        alias = join(parent, 'alias')
      mkdirSync(workspace, { mode: 0o700 })
      symlinkSync(workspace, alias, 'dir')
      const root = join(parent, 'plugins'),
        options = { root, workspaceRoots: [alias] }
      const store = GlobalPluginState.create(options)
      stores.push(store)
      const next = GlobalPluginState.open(options)
      stores.push(next)
      expect(next.inspect()).toEqual(store.inspect())
    })
    it('refuses an unresolved workspace before writing a global root', () => {
      const parent = folder(),
        root = join(parent, 'plugins')
      expect(() =>
        GlobalPluginState.create({ root, workspaceRoots: [join(parent, 'missing')] }),
      ).toThrow(expect.objectContaining({ code: 'unsafe-path' }))
      expect(readdirSync(parent)).toEqual([])
    })
    it('journals consent before mutation and grants no activation during prepare', () => {
      const { store, open } = fixture(),
        input = request(store)
      const operation = store.prepare(input)
      expect(operation.request).toEqual(input)
      expect(open().inspect().pending?.request).toEqual(input)
      expect(store.inspect().guards[0]?.phase).toBe('prepared')
      expect(() => active(store)).toThrow(expect.objectContaining({ code: 'busy' }))
      store.complete(input.operationId)
      expect(active(store)?.installId).toBe(operation.next?.installId)
    })
    it('idempotent retries retain allocation and consent, and refuse changed consent', () => {
      const { store } = fixture(),
        input = request(store)
      const operation = store.prepare(input)
      expect(store.prepare(input)).toEqual(operation)
      expect(() => store.prepare({ ...input, consent: { ...input.consent, at: 1001 } })).toThrow(
        PluginStateError,
      )
      store.complete(input.operationId)
      const before = store.inspect()
      store.complete(input.operationId)
      expect(store.prepare(input)).toEqual(operation)
      expect(store.inspect()).toEqual(before)
      expect(() => store.abort(input.operationId)).toThrow(PluginStateError)
    })
    it('uninstall denies first; a reinstall is B and cannot revive old A', () => {
      const { store, open } = fixture()
      install(store)
      const old = active(store)!
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      expect(open().inspect().guards[0]?.phase).toBe('removed')
      expect(() => active(store)).toThrow(PluginStateError)
      store.complete(remove.operationId)
      expect(active(store)).toBeNull()
      install(store)
      const current = active(store)!
      expect(current.installId).not.toBe(old.installId)
      expect(current.incarnation).not.toBe(old.incarnation)
      expect(current.lifecycleSequence).toBeGreaterThan(old.lifecycleSequence)
    })
    it('ordinary release changes keep installId and configuration revision under a new incarnation', () => {
      const { store } = fixture()
      install(store)
      const old = active(store)!
      const update = request(store, 'update')
      update.consent.release = release('2.0.0')
      store.prepare(update)
      store.complete(update.operationId)
      const current = active(store)!
      expect(current.installId).toBe(old.installId)
      expect(current.configRevision).toBe(old.configRevision)
      expect(current.incarnation).not.toBe(old.incarnation)
      expect(current.releaseRevision).toBe(old.releaseRevision + 1)
    })
    it('never overwrites a pending or concurrent person operation with a stale revision', () => {
      // Both requests are made from the same view; the second is stale once the first commits.
      const { store } = fixture(),
        a = request(store),
        b = request(store)
      store.prepare(a)
      expect(() => store.prepare(b)).toThrow(PluginStateError)
      store.complete(a.operationId)
      expect(() => store.prepare(b)).toThrow(expect.objectContaining({ code: 'conflict' }))
      expect(store.inspect().operations).toHaveLength(1)
    })
    it('exclusive writer fence refuses an interleaving without removing live preparation', () => {
      let interrupt: (() => void) | null = null
      const { store, open } = fixture((point) => {
        if (point === 'staged' && interrupt !== null) {
          const run = interrupt
          interrupt = null
          run()
        }
      })
      const other = open(),
        first = request(store),
        winner = request(other)
      interrupt = () => {
        expect(() => other.prepare(winner)).toThrow(expect.objectContaining({ code: 'busy' }))
        expect(() => open()).toThrow(expect.objectContaining({ code: 'busy' }))
      }
      store.prepare(first)
      // The writer that held the fence reads its own preparation; the next start reads it too.
      other.close()
      store.close()
      const next = open()
      expect(next.inspect().pending?.request.operationId).toBe(first.operationId)
      expect(next.inspect().operations).toHaveLength(1)
      next.complete(first.operationId)
      expect(active(next)).not.toBeNull()
    })
    it('still reads a legacy publication with its verified guard-local crash stage', () => {
      const { root, store, open } = fixture()
      const guard = join(root, 'lifecycle-guard')
      const stage = join(guard, `.stage-${randomUUID()}`)
      linkSync(join(guard, '00000000.json'), stage)
      expect(open().inspect()).toEqual(store.inspect())
      expect(existsSync(stage)).toBe(true)
    })
    it('aborts fail closed, remain idempotent, and require a fresh install identity', () => {
      const { store } = fixture(),
        input = request(store),
        first = store.prepare(input)
      store.abort(input.operationId)
      store.abort(input.operationId)
      expect(active(store)).toBeNull()
      const next = store.prepare(request(store))
      expect(next.next?.installId).not.toBe(first.next?.installId)
      expect(() => store.complete(input.operationId)).toThrow(PluginStateError)
    })
    it('keeps immutable release pins across uninstall and rejects unsupported data migrations', () => {
      const { store } = fixture()
      install(store)
      const migrate = request(store, 'update')
      migrate.consent.release = { ...release('2.0.0'), dataSchema: 2 }
      expect(() => store.prepare(migrate)).toThrow(PluginStateError)
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.complete(remove.operationId)
      const changed = request(store)
      changed.consent.release = { ...release(), archiveSha256: 'c'.repeat(64) }
      expect(() => store.prepare(changed)).toThrow(PluginStateError)
    })
    it.each(['staged', 'published', 'durable'] as const)(
      'a crash at journal %s cannot activate a half-install and can be retried',
      (point) => {
        let armed = false
        const { store, open } = fixture((at) => {
          if (armed && at === point) {
            armed = false
            throw new Error('fictional power loss')
          }
        })
        const input = request(store)
        armed = true
        expect(() => store.prepare(input)).toThrow(PluginStateError)
        const next = open()
        if (next.inspect().pending !== null) expect(() => active(next)).toThrow(PluginStateError)
        else expect(active(next)).toBeNull()
        next.prepare(input)
        next.complete(input.operationId)
        expect(active(next)).not.toBeNull()
      },
    )
    it.each(['staged', 'published', 'durable'] as const)(
      'a crash at reserved resolution %s stays denying or commits exactly the recorded allocation',
      (point) => {
        let armed = false
        const { store, open } = fixture((at) => {
          if (armed && at === point) {
            armed = false
            throw new Error('fictional power loss')
          }
        })
        const input = request(store),
          planned = store.prepare(input)
        armed = true
        expect(() => store.complete(input.operationId)).toThrow(PluginStateError)
        const next = open()
        const view = next.inspect()
        if (view.pending !== null) {
          expect(view.pending.next?.installId).toBe(planned.next?.installId)
          expect(() => active(next)).toThrow(PluginStateError)
        } else {
          expect(view.guards[0]?.installId).toBe(planned.next?.installId)
          expect(view.guards[0]?.phase).toBe('active')
        }
        next.complete(input.operationId)
        expect(active(next)?.installId).toBe(planned.next?.installId)
      },
    )
    it('an old global A snapshot cannot resurrect A, erase B, or guess B metadata', () => {
      const { store } = fixture()
      install(store)
      const snapshot = store.exportActivation()
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.complete(remove.operationId)
      install(store)
      const current = active(store)!
      const restore = request(store, 'global-restore')
      restore.snapshot = snapshot
      store.prepare(restore)
      store.complete(restore.operationId)
      expect(store.inspect().guards[0]?.installId).toBe(current.installId)
      expect(store.exportActivation().entries).toEqual([])
      const unrelated = request(store, 'install', 'fictional-orchard')
      store.prepare(unrelated)
      store.complete(unrelated.operationId)
      expect(active(store)).toBeNull()
      expect(active(store, 'fictional-orchard')).not.toBeNull()
    })
    it('global restore preserves a tombstone and keeps a compatible active install under a new epoch', () => {
      const { store } = fixture()
      install(store)
      const snapshot = store.exportActivation(),
        old = active(store)!,
        epoch = store.inspect().epoch
      const restore = request(store, 'global-restore')
      restore.snapshot = snapshot
      store.prepare(restore)
      store.complete(restore.operationId)
      expect(active(store)?.installId).toBe(old.installId)
      expect(store.inspect().epoch).not.toBe(epoch)
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.complete(remove.operationId)
      const again = request(store, 'global-restore')
      again.snapshot = snapshot
      store.prepare(again)
      store.complete(again.operationId)
      expect(store.inspect().guards[0]?.phase).toBe('removed')
      expect(store.exportActivation().entries).toEqual([])
    })
    it('refuses foreign-root global snapshots', () => {
      const { store } = fixture()
      install(store)
      const restore = request(store, 'global-restore')
      restore.snapshot = { ...store.exportActivation(), rootId: randomUUID() }
      expect(() => store.prepare(restore)).toThrow(PluginStateError)
    })
    it('an activation lost in global restore disables execution without erasing the lifecycle floor', () => {
      const { store, root } = fixture()
      install(store)
      const guard = store.inspect().guards[0]
      const name = readdirSync(join(root, 'activations')).find((name) =>
        decodeState(readFileSync(join(root, 'activations', name)), ActivationSnapshot).entries.some(
          (entry) => entry.installId === guard?.installId,
        ),
      )!
      const path = join(root, 'activations', name)
      unlinkSync(path)
      expect(() => active(store)).toThrow(PluginStateError)
      expect(store.inspect().guards[0]).toEqual(guard)
    })
    it('missing, truncated or changed guard data is never recreated or treated as empty', () => {
      for (const mode of ['missing', 'truncated', 'changed']) {
        const { store, root, options } = fixture()
        install(store)
        store.close()
        const path = join(root, 'lifecycle-guard', '00000000.json')
        if (mode === 'missing') unlinkSync(path)
        else if (mode === 'truncated') writeFileSync(path, '{')
        else writeFileSync(path, readFileSync(path, 'utf8').replace('created', 'changed'))
        expect(() => GlobalPluginState.open(options)).toThrow(PluginStateError)
        expect(() => GlobalPluginState.create(options)).toThrow(PluginStateError)
      }
    })
    it('ignores a partially written stage without replaying or deleting it', () => {
      const { store, root, open } = fixture()
      const stage = join(root, 'lifecycle-guard', `.stage-${randomUUID()}`)
      writeFileSync(stage, '{"incomplete fictional record":', { mode: 0o600 })
      const next = open()
      expect(next.inspect().guards).toEqual([])
      install(next)
      expect(readFileSync(stage, 'utf8')).toBe('{"incomplete fictional record":')
      expect(store.inspect().guards[0]?.phase).toBe('active')
    })
    it('a missing final uninstall record cannot roll the floor back to the active install', () => {
      const { store, root, options } = fixture()
      install(store)
      store.prepare(request(store, 'uninstall'))
      const records = readdirSync(join(root, 'lifecycle-guard'))
        .filter((name) => name.endsWith('.json'))
        .sort()
      unlinkSync(join(root, 'lifecycle-guard', records.at(-1)!))
      expect(() => GlobalPluginState.open(options)).toThrow(
        expect.objectContaining({ code: 'corrupt' }),
      )
      expect(() => active(store)).toThrow(PluginStateError)
    })
    it('refuses global storage under a workspace or a shared parent without changing its permissions', () => {
      const parent = folder(),
        workspace = join(parent, 'workspace')
      mkdirSync(workspace, { mode: 0o700 })
      expect(() =>
        GlobalPluginState.create({ root: join(workspace, 'plugins'), workspaceRoots: [workspace] }),
      ).toThrow(PluginStateError)
      chmodSync(parent, 0o755)
      const shared = GlobalPluginState.create({ root: join(parent, 'plugins'), workspaceRoots: [] })
      shared.close()
      expect(readdirSync(parent).sort()).toEqual(['plugins', 'workspace'])
    })
    it('never follows a substituted guard folder or a journal-file symlink', () => {
      const { store, root, parent } = fixture(),
        outside = join(parent, 'outside')
      mkdirSync(outside, { mode: 0o700 })
      const sentinel = join(outside, 'sentinel')
      writeFileSync(sentinel, 'fictional outside bytes', { mode: 0o600 })
      const input = request(store)
      const guard = join(root, 'lifecycle-guard')
      renameSync(guard, join(root, 'old-guard'))
      symlinkSync(outside, guard, 'dir')
      expect(() => store.prepare(input)).toThrow(PluginStateError)
      expect(readFileSync(sentinel, 'utf8')).toBe('fictional outside bytes')
      const other = fixture(),
        record = join(other.root, 'lifecycle-guard', '00000000.json')
      unlinkSync(record)
      symlinkSync(sentinel, record)
      expect(() => other.open()).toThrow(PluginStateError)
      expect(readFileSync(sentinel, 'utf8')).toBe('fictional outside bytes')
    })
    it('refuses an outside hardlink and strips raw filesystem errors', () => {
      const { store, root, parent, options } = fixture()
      store.close()
      const original = join(root, 'lifecycle-guard', '00000000.json'),
        outside = join(parent, 'outside.json')
      renameSync(original, outside)
      linkSync(outside, original)
      expect(() => GlobalPluginState.open(options)).toThrow(PluginStateError)
      try {
        GlobalPluginState.open(options)
      } catch (error) {
        expect(String(error)).not.toContain(parent)
        expect(error).not.toHaveProperty('cause')
      }
      expect(readFileSync(outside).length).toBeGreaterThan(0)
    })
  },
)
