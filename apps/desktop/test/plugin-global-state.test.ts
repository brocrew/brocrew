import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { stateFile } from './plugin-lifecycle-fixtures'
import {
  PluginStateError,
  stateFileName,
  stateFilesIn,
  type Consent,
  type OperationRequest,
} from '../src/main/plugins/state/format'

const actualRename = fs.renameSync,
  actualFsync = fs.fsyncSync
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
function fixture(fault?: (point: 'staged' | 'published') => void) {
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
    it.each(['staged', 'published'] as const)(
      'a crash at a prepare write %s cannot activate a half-install and can be retried',
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
    it.each(['staged', 'published'] as const)(
      'a crash at a resolution write %s stays denying or commits exactly the recorded allocation',
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
    it('missing, truncated or changed state is never recreated or treated as empty', () => {
      for (const mode of ['missing', 'truncated', 'changed']) {
        const { store, root, options } = fixture()
        install(store)
        store.close()
        const path = stateFile(root)!
        if (mode === 'missing') unlinkSync(path)
        else if (mode === 'truncated') writeFileSync(path, '{')
        else writeFileSync(path, readFileSync(path, 'utf8').replace('"format":2', '"format":3'))
        expect(() => GlobalPluginState.open(options)).toThrow(PluginStateError)
        expect(() => GlobalPluginState.create(options)).toThrow(PluginStateError)
      }
    })
    it('never reads a half-written state, and the next start removes it', () => {
      const { store, root, open } = fixture()
      store.close()
      const stage = join(root, stateFileName(1) + '.0123456789ab.tmp')
      writeFileSync(stage, '{"incomplete fictional state":', { mode: 0o600 })
      const next = open()
      expect(next.inspect().guards).toEqual([])
      expect(existsSync(stage)).toBe(false)
      install(next)
      next.close()
      expect(open().inspect().guards[0]?.phase).toBe('active')
    })
    it('after crashes leave several state files, the next start reads the highest and removes the rest', () => {
      let armed = false
      const { store, root, open } = fixture((point) => {
        if (armed && point === 'published') throw new Error('fictional crash before cleanup')
      })
      install(store)
      // Each write crashes after its file is in place and before older ones are removed.
      armed = true
      const remove = request(store, 'uninstall')
      expect(() => store.prepare(remove)).toThrow()
      expect(() => store.complete(remove.operationId)).toThrow()
      store.close()
      writeFileSync(join(root, stateFileName(5) + '.0123456789ab.tmp'), '{"half', { mode: 0o600 })
      expect(stateFilesIn(readdirSync(root)).length).toBeGreaterThan(2)
      const next = open()
      expect(next.inspect().guards[0]?.phase).toBe('removed')
      expect(next.inspect().pending).toBeNull()
      expect(readdirSync(root).filter((name) => name.startsWith('plugin-state'))).toEqual([
        stateFileName(next.inspect().sequence),
      ])
    })
    it('a damaged highest state refuses and never falls back to an older one', () => {
      const { store, root, options } = fixture()
      install(store)
      const installed = stateFilesIn(readdirSync(root))[0]!
      const before = readFileSync(join(root, installed.name))
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.complete(remove.operationId)
      store.close()
      // The installed state, left behind as a held file that could not be removed would be.
      writeFileSync(join(root, installed.name), before, { mode: 0o600 })
      const files = stateFilesIn(readdirSync(root))
      expect(files.map((one) => one.name)).toContain(installed.name)
      writeFileSync(join(root, files[0]!.name), '{"format":2')
      expect(() => GlobalPluginState.open(options)).toThrow(PluginStateError)
      expect(readFileSync(join(root, files[0]!.name), 'utf8')).toBe('{"format":2')
    })
    it('a pending removal reopens pending, never as the active install', () => {
      const { store, open } = fixture()
      install(store)
      const remove = request(store, 'uninstall')
      store.prepare(remove)
      store.close()
      const next = open()
      expect(next.inspect().pending?.request.operationId).toBe(remove.operationId)
      expect(next.inspect().guards[0]?.phase).toBe('removed')
      expect(() => active(next)).toThrow(PluginStateError)
      next.complete(remove.operationId)
      next.close()
      expect(open().inspect().guards[0]?.phase).toBe('removed')
    })
    it('every write adds a new file, never replaces one a reader may hold, and older ones go', () => {
      const { store, root } = fixture()
      const replaced: string[] = []
      let renames = 0
      const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        renames++
        if (existsSync(to)) replaced.push(String(to))
        actualRename(from, to)
      })
      syncBuiltinESMExports()
      try {
        install(store)
        const remove = request(store, 'uninstall')
        store.prepare(remove)
        store.complete(remove.operationId)
      } finally {
        rename.mockRestore()
        syncBuiltinESMExports()
      }
      // Windows refuses to replace a file another process holds open, so nothing is replaced.
      // Counted in the mock: restoring the spy clears its recorded calls.
      expect(renames).toBeGreaterThan(0)
      expect(replaced).toEqual([])
      expect(stateFilesIn(readdirSync(root)).map((one) => one.sequence)).toEqual([
        store.inspect().sequence,
      ])
    })
    it('an older file that cannot be removed yet stays aside; the highest is read and the next write removes it', () => {
      const { store, root, open } = fixture()
      const held = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw Object.assign(new Error('fictional held file'), { code: 'EPERM' })
      })
      syncBuiltinESMExports()
      try {
        install(store)
      } finally {
        held.mockRestore()
        syncBuiltinESMExports()
      }
      expect(stateFilesIn(readdirSync(root))).toHaveLength(3)
      store.close()
      const next = open()
      expect(active(next)).not.toBeNull()
      expect(stateFilesIn(readdirSync(root)).map((one) => one.sequence)).toEqual([
        next.inspect().sequence,
      ])
    })
    it('a write that fails after its rename holds what the file now says', () => {
      const { store, open } = fixture()
      const input = request(store)
      store.prepare(input)
      // The folder flush after the rename fails, as a full or unplugged disk can make it.
      let renamed = false
      const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        actualRename(from, to)
        renamed = true
      })
      const flush = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
        if (renamed) throw Object.assign(new Error('fictional flush failure'), { code: 'EIO' })
        actualFsync(fd)
      })
      syncBuiltinESMExports()
      try {
        expect(() => store.complete(input.operationId)).toThrow()
      } finally {
        rename.mockRestore()
        flush.mockRestore()
        syncBuiltinESMExports()
      }
      expect(store.inspect().pending).toBeNull()
      expect(active(store)).not.toBeNull()
      store.close()
      expect(open().inspect().guards[0]?.phase).toBe('active')
    })
    it('a copy that wrote since this one read wins, and this one refuses as a conflict', () => {
      const { store, open } = fixture()
      const other = open()
      install(other)
      expect(() => install(store)).toThrow(expect.objectContaining({ code: 'conflict' }))
      other.close()
      expect(open().inspect().guards).toHaveLength(1)
    })
    it('keeps only the latest operation of each plugin, and refuses a retry of an earlier one', () => {
      const { store, open } = fixture()
      const first = install(store)
      const update = request(store, 'update')
      update.consent.release = release('2.0.0')
      store.prepare(update)
      store.complete(update.operationId)
      const other = request(store, 'install', 'fictional-orchard')
      store.prepare(other)
      store.complete(other.operationId)
      store.close()
      const next = open()
      expect(next.inspect().operations.map((one) => one.operation.request.operationId)).toEqual([
        update.operationId,
        other.operationId,
      ])
      expect(() => next.prepare(first)).toThrow(expect.objectContaining({ code: 'conflict' }))
      expect(next.prepare(update).request).toEqual(update)
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
    it.skipIf(process.getuid?.() === 0)(
      'refuses an unreadable state and strips raw filesystem errors',
      () => {
        const { store, root, parent, options } = fixture()
        store.close()
        chmodSync(stateFile(root)!, 0)
        try {
          expect(() => GlobalPluginState.open(options)).toThrow(PluginStateError)
          try {
            GlobalPluginState.open(options)
          } catch (error) {
            expect(String(error)).not.toContain(parent)
            expect(error).not.toHaveProperty('cause')
          }
        } finally {
          chmodSync(stateFile(root)!, 0o600)
        }
      },
    )
  },
)
