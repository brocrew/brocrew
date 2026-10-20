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
function install(store: GlobalPluginState) {
  const input = request(store)
  store.prepare(input)
  store.complete(input.operationId)
  return input
}

it('Windows disk storage refuses a root whose access list was not checked, before creating anything', () => {
  const parent = folder(),
    root = join(parent, 'plugins')
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
    expect(() => GlobalPluginState.create({ root, workspaceRoots: [] })).toThrow(
      expect.objectContaining({ code: 'unsupported', message: 'Plugin unavailable. Try again.' }),
    )
    expect(existsSync(root)).toBe(false)
    expect(readdirSync(parent)).toEqual([])
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
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
    it('journals consent before mutation and grants no projection during prepare', () => {
      const { store, open } = fixture(),
        workspace = randomUUID(),
        input = request(store)
      const operation = store.prepare(input)
      expect(operation.request).toEqual(input)
      expect(open().inspect().pending?.request).toEqual(input)
      expect(store.inspect().guards[0]?.phase).toBe('prepared')
      expect(() => store.emptyProjection(workspace, 'fictional-bakery')).toThrow(
        expect.objectContaining({ code: 'busy' }),
      )
      store.complete(input.operationId)
      const receipt = store.emptyProjection(workspace, 'fictional-bakery')!
      expect(receipt.installId).toBe(operation.next?.installId)
      expect(receipt.skills).toEqual([])
      expect(receipt.bindings).toEqual([])
      expect(store.matchesProjection(receipt, workspace)).toBe(true)
      expect(store.matchesProjection(receipt, randomUUID())).toBe(false)
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
    it('uninstall denies first; a reinstall is B and cannot revive old workspace A', () => {
      const { store, open } = fixture(),
        workspace = randomUUID()
      install(store)
      const old = store.emptyProjection(workspace, 'fictional-bakery')!
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      expect(open().inspect().guards[0]?.phase).toBe('removed')
      expect(() => store.matchesProjection(old, workspace)).toThrow(PluginStateError)
      store.complete(remove.operationId)
      expect(store.emptyProjection(workspace, 'fictional-bakery')).toBeNull()
      install(store)
      const current = store.emptyProjection(workspace, 'fictional-bakery')!
      expect(current.installId).not.toBe(old.installId)
      expect(current.incarnation).not.toBe(old.incarnation)
      expect(current.lifecycleSequence).toBeGreaterThan(old.lifecycleSequence)
      expect(store.matchesProjection(old, workspace)).toBe(false)
      expect(store.reconcileProjection(old, workspace, 'fictional-bakery')).toEqual({
        receipt: current,
        revoke: true,
        selectionPolicy: 'off',
      })
    })
    it('ordinary release changes keep installId and configuration revision but fence old receipts', () => {
      const { store } = fixture(),
        workspace = randomUUID()
      install(store)
      const old = store.emptyProjection(workspace, 'fictional-bakery')!
      const update = request(store, 'update')
      update.consent.release = release('2.0.0')
      store.prepare(update)
      store.complete(update.operationId)
      const current = store.emptyProjection(workspace, 'fictional-bakery')!
      expect(current.installId).toBe(old.installId)
      expect(current.configRevision).toBe(old.configRevision)
      expect(current.incarnation).not.toBe(old.incarnation)
      expect(current.releaseRevision).toBe(old.releaseRevision + 1)
      expect(store.matchesProjection(old, workspace)).toBe(false)
      expect(store.reconcileProjection(old, workspace, 'fictional-bakery').selectionPolicy).toBe(
        'preserve-surviving',
      )
    })
    it('never overwrites a pending or concurrent person operation with a stale revision', () => {
      const { store, open } = fixture(),
        second = open(),
        a = request(store),
        b = request(second)
      store.prepare(a)
      expect(() => second.prepare(b)).toThrow(PluginStateError)
      store.complete(a.operationId)
      expect(() => second.prepare(b)).toThrow(expect.objectContaining({ code: 'conflict' }))
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
      expect(other.inspect().pending?.request.operationId).toBe(first.operationId)
      expect(other.inspect().operations).toHaveLength(1)
      other.complete(first.operationId)
      expect(other.emptyProjection(randomUUID(), 'fictional-bakery')).not.toBeNull()
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
      expect(store.emptyProjection(randomUUID(), 'fictional-bakery')).toBeNull()
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
        if (next.inspect().pending !== null)
          expect(() => next.emptyProjection(randomUUID(), 'fictional-bakery')).toThrow(
            PluginStateError,
          )
        else expect(next.emptyProjection(randomUUID(), 'fictional-bakery')).toBeNull()
        next.prepare(input)
        next.complete(input.operationId)
        expect(next.emptyProjection(randomUUID(), 'fictional-bakery')).not.toBeNull()
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
          expect(() => next.emptyProjection(randomUUID(), 'fictional-bakery')).toThrow(
            PluginStateError,
          )
        } else {
          expect(view.guards[0]?.installId).toBe(planned.next?.installId)
          expect(view.guards[0]?.phase).toBe('active')
        }
        next.complete(input.operationId)
        expect(next.emptyProjection(randomUUID(), 'fictional-bakery')?.installId).toBe(
          planned.next?.installId,
        )
      },
    )
    it('an old global A snapshot cannot resurrect A, erase B, or guess B metadata', () => {
      const { store } = fixture(),
        workspace = randomUUID()
      install(store)
      const snapshot = store.exportActivation(),
        old = store.emptyProjection(workspace, 'fictional-bakery')!
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.complete(remove.operationId)
      install(store)
      const current = store.emptyProjection(workspace, 'fictional-bakery')!
      const restore = request(store, 'global-restore')
      restore.snapshot = snapshot
      store.prepare(restore)
      store.complete(restore.operationId)
      expect(store.inspect().guards[0]?.installId).toBe(current.installId)
      expect(store.exportActivation().entries).toEqual([])
      expect(store.matchesProjection(old, workspace)).toBe(false)
      expect(store.emptyProjection(workspace, 'fictional-bakery')).toBeNull()
      const unrelated = request(store, 'install', 'fictional-orchard')
      store.prepare(unrelated)
      store.complete(unrelated.operationId)
      expect(store.emptyProjection(workspace, 'fictional-bakery')).toBeNull()
      expect(store.emptyProjection(workspace, 'fictional-orchard')).not.toBeNull()
    })
    it('global restore preserves a tombstone and rekeys compatible active receipts', () => {
      const { store } = fixture(),
        workspace = randomUUID()
      install(store)
      const snapshot = store.exportActivation(),
        old = store.emptyProjection(workspace, 'fictional-bakery')!
      const restore = request(store, 'global-restore')
      restore.snapshot = snapshot
      store.prepare(restore)
      store.complete(restore.operationId)
      const current = store.emptyProjection(workspace, 'fictional-bakery')!
      expect(current.installId).toBe(old.installId)
      expect(current.epoch).not.toBe(old.epoch)
      expect(store.matchesProjection(old, workspace)).toBe(false)
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
    it('refuses foreign-root global snapshots and forged/nonempty projection bindings', () => {
      const { store } = fixture()
      install(store)
      const restore = request(store, 'global-restore')
      restore.snapshot = { ...store.exportActivation(), rootId: randomUUID() }
      expect(() => store.prepare(restore)).toThrow(PluginStateError)
      const workspace = randomUUID(),
        receipt = store.emptyProjection(workspace, 'fictional-bakery')!
      expect(store.matchesProjection({ ...receipt, installId: randomUUID() }, workspace)).toBe(
        false,
      )
      expect(store.matchesProjection({ ...receipt, skills: ['forged'] }, workspace)).toBe(false)
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
      expect(() => store.emptyProjection(randomUUID(), 'fictional-bakery')).toThrow(
        PluginStateError,
      )
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
      expect(() => store.emptyProjection(randomUUID(), 'fictional-bakery')).toThrow(
        PluginStateError,
      )
    })
    it('refuses global storage under a workspace or a shared parent without changing its permissions', () => {
      const parent = folder(),
        workspace = join(parent, 'workspace')
      mkdirSync(workspace, { mode: 0o700 })
      expect(() =>
        GlobalPluginState.create({ root: join(workspace, 'plugins'), workspaceRoots: [workspace] }),
      ).toThrow(PluginStateError)
      chmodSync(parent, 0o755)
      expect(() =>
        GlobalPluginState.create({ root: join(parent, 'plugins'), workspaceRoots: [] }),
      ).toThrow(PluginStateError)
      expect(readdirSync(parent)).toEqual(['workspace'])
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
