import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import {
  PluginStateError,
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
  const path = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-state-'),
  )
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

describe('persistent plugin selection', () => {
  it('does not return an older archive-only allocation while another operation is pending', () => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional publication interruption')
      }
    })
    const older = request(f.store)
    armed = true
    expect(() => f.store.prepare(older)).toThrow()
    const next = request(f.store, 'install', 'fictional-kite')
    const pending = f.store.prepare(next)
    expect(() => f.store.prepare(older)).toThrow()
    expect(f.open().inspect().pending).toEqual(pending)
  })
  it('reuses an unpublished allocation after workspace receipt changes without changing its saved request', () => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional publication interruption')
      }
    })
    install(f.store)
    const input = request(f.store, 'update')
    armed = true
    expect(() => f.store.prepare(input)).toThrow()
    const before = f.store.operation(input.operationId)!.operation
    const workspace = randomUUID()
    f.store.recordProjection(
      workspace,
      'fictional-bakery',
      f.store.emptyProjection(workspace, 'fictional-bakery'),
    )
    expect(f.store.inspect().sequence).toBeGreaterThan(input.consent.expectedSequence)
    expect(f.open().prepare(input)).toEqual(before)
    f.store.complete(input.operationId)
    expect(f.open().operation(input.operationId)?.operation.request).toEqual(input)
  })
  it('refuses an unpublished allocation if its target installation changed meanwhile', () => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional publication interruption')
      }
    })
    const older = request(f.store)
    armed = true
    expect(() => f.store.prepare(older)).toThrow()
    install(f.store)
    const selected = f.store.exportActivation()
    expect(() => f.open().prepare(older)).toThrow()
    expect(f.store.exportActivation()).toEqual(selected)
  })
  it('refuses a stale archive-only global restore after another installation changes', () => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional restore publication interruption')
      }
    })
    install(f.store)
    const restore = request(f.store, 'global-restore')
    restore.snapshot = f.store.exportActivation()
    armed = true
    expect(() => f.store.prepare(restore)).toThrow()
    expect(f.store.inspect().pending).toBeNull()
    const other = request(f.store, 'install', 'fictional-kite')
    f.store.prepare(other)
    f.store.complete(other.operationId)
    const selected = f.store.exportActivation()
    expect(() => f.open().prepare(restore)).toThrow()
    expect(f.store.exportActivation()).toEqual(selected)
    expect(f.store.inspect().pending).toBeNull()
  })
  it('persists ordinary Unicode, space and hidden package names and long versions', () => {
    const f = fixture()
    for (const id of ['.fictional package', 'fictional café', 'fictional-' + 'x'.repeat(90)]) {
      const input = request(f.store, 'install', id)
      input.consent.release!.version = 'fictional version ' + 'x'.repeat(200)
      const operation = f.store.prepare(input)
      f.store.complete(input.operationId)
      const receipt = f.store.emptyProjection(randomUUID(), id)!
      f.store.recordProjection(receipt.workspaceId, id, receipt)
      expect(
        f
          .open()
          .exportActivation()
          .entries.find((one) => one.pluginId === id)?.installId,
      ).toBe(operation.next?.installId)
    }
  })
  it('records a stable allocation before mutation and selects it only on completion', () => {
    const f = fixture(),
      input = request(f.store),
      workspace = randomUUID()
    const operation = f.store.prepare(input)
    expect(f.open().inspect().pending?.request).toEqual(input)
    expect(f.store.emptyProjection(workspace, 'fictional-bakery')).toBeNull()
    expect(f.store.currentInstallation('fictional-bakery')).toBeNull()
    expect(f.store.inspect().pending).toEqual(operation)
    f.store.complete(input.operationId)
    const receipt = f.open().emptyProjection(workspace, 'fictional-bakery')!
    expect(receipt.installId).toBe(operation.next?.installId)
    expect(f.store.matchesProjection(receipt, workspace)).toBe(true)
    expect(f.store.matchesProjection(receipt, randomUUID())).toBe(false)
  })
  it('retries retain allocation and completion without repeating an operation', () => {
    const f = fixture(),
      input = request(f.store),
      before = f.store.prepare(input)
    expect(f.open().prepare(input)).toEqual(before)
    f.store.complete(input.operationId)
    const sequence = f.store.inspect().sequence
    expect(f.open().prepare(input)).toEqual(before)
    f.store.complete(input.operationId)
    expect(f.store.inspect().sequence).toBe(sequence)
    expect(() => f.store.prepare({ ...input, consent: { ...input.consent, at: 2 } })).toThrow(
      PluginStateError,
    )
  })
  it('serializes mutations and reports stale input without overwriting a pending operation', () => {
    const f = fixture(),
      first = request(f.store),
      stale = request(f.store)
    f.store.prepare(first)
    expect(() => f.store.prepare(stale)).toThrow(expect.objectContaining({ code: 'busy' }))
    f.store.complete(first.operationId)
    expect(() => f.store.prepare(stale)).toThrow(expect.objectContaining({ code: 'conflict' }))
  })
  it('uninstall and reinstall keep stale workspace switches off', () => {
    const f = fixture(),
      workspace = randomUUID()
    install(f.store)
    const before = f.store.emptyProjection(workspace, 'fictional-bakery')!
    f.store.recordProjection(workspace, 'fictional-bakery', before)
    const removal = request(f.store, 'uninstall')
    f.store.prepare(removal)
    f.store.complete(removal.operationId)
    install(f.store)
    expect(f.store.matchesProjection(before, workspace)).toBe(false)
    expect(f.store.reconcileProjection(before, workspace, 'fictional-bakery').selectionPolicy).toBe(
      'off',
    )
  })
  it('updates preserve installation identity and workspace selection while refreshing run identity', () => {
    const f = fixture(),
      workspace = randomUUID()
    install(f.store)
    const before = f.store.emptyProjection(workspace, 'fictional-bakery')!
    f.store.recordProjection(workspace, 'fictional-bakery', before)
    const update = request(f.store, 'update')
    update.consent.release = release('2.0.0')
    update.workspaces = [workspace]
    f.store.prepare(update)
    f.store.complete(update.operationId)
    const after = f.open().projections(workspace)[0]!
    expect(after.installId).toBe(before.installId)
    expect(after.incarnation).not.toBe(before.incarnation)
    expect(after.releaseRevision).toBe(before.releaseRevision + 1)
    expect(f.store.reconcileProjection(before, workspace, 'fictional-bakery').selectionPolicy).toBe(
      'preserve-surviving',
    )
  })
  it('aborted install is retryable and aborted update/uninstall restore the old selection', () => {
    const f = fixture(),
      first = request(f.store)
    f.store.prepare(first)
    f.store.abort(first.operationId)
    f.store.abort(first.operationId)
    expect(f.store.exportActivation().entries).toEqual([])
    install(f.store)
    for (const action of ['update', 'uninstall'] as const) {
      const before = f.store.exportActivation(),
        input = request(f.store, action)
      f.store.prepare(input)
      f.store.abort(input.operationId)
      expect(f.open().exportActivation()).toEqual(before)
    }
  })
  it('does not pin a version to a historical archive or impose a data schema migration policy', () => {
    const f = fixture()
    install(f.store)
    const update = request(f.store, 'update')
    update.consent.release = { ...release(), archiveSha256: 'd'.repeat(64), dataSchema: 2 }
    f.store.prepare(update)
    f.store.complete(update.operationId)
    expect(f.open().exportActivation().entries[0]?.release).toEqual(update.consent.release)
  })
  it('restores the selected snapshot without antirollback tombstones or root enrollment', () => {
    const f = fixture()
    install(f.store)
    const snapshot = f.store.exportActivation()
    const removal = request(f.store, 'uninstall')
    f.store.prepare(removal)
    f.store.complete(removal.operationId)
    const restore = request(f.store, 'global-restore')
    restore.snapshot = { ...snapshot, rootId: randomUUID() }
    f.store.prepare(restore)
    f.store.complete(restore.operationId)
    expect(f.store.exportActivation().entries).toEqual(snapshot.entries)
  })
  it('uses the selected file for read-only display without mutating it', () => {
    const f = fixture()
    install(f.store)
    const file = join(f.root, 'installed-state.json'),
      before = readFileSync(file)
    expect(GlobalPluginState.readInstalledPackage(f.options, 'fictional-bakery')).toEqual({
      version: '1.0.0',
      archiveSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
    })
    expect(GlobalPluginState.observeInstallations(f.options).installed).toEqual([
      'fictional-bakery',
    ])
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(f.root).sort()).toEqual([
      'installed-state.json',
      'operations.sqlite',
      'writer-lock.sqlite',
    ])
  })
  it('ignores interrupted temporary files and reports malformed selected JSON', () => {
    const f = fixture()
    install(f.store)
    const expected = f.store.exportActivation()
    writeFileSync(join(f.root, '.state-fictional'), '{')
    expect(f.open().exportActivation()).toEqual(expected)
    writeFileSync(join(f.root, 'installed-state.json'), '{')
    expect(() => f.store.inspect()).toThrow(expect.objectContaining({ code: 'corrupt' }))
  })
  it('creates a missing state store despite old birth markers and accepts shared or workspace paths', () => {
    const parent = folder(),
      root = join(parent, 'workspace', 'state')
    mkdirSync(join(parent, 'workspace'))
    writeFileSync(join(parent, 'workspace', 'lifecycle-state-born'), '1')
    const store = GlobalPluginState.open({ root, workspaceRoots: [join(parent, 'workspace')] })
    stores.push(store)
    expect(store.inspect().sequence).toBe(0)
    expect(existsSync(join(root, 'installed-state.json'))).toBe(true)
  })
  it.each(['staged', 'published', 'durable'] as const)(
    'recovers an atomic completion interrupted at %s',
    (point) => {
      let armed = false
      const f = fixture((at) => {
        if (armed && at === point) {
          armed = false
          throw new Error('fictional interruption')
        }
      })
      const input = request(f.store),
        allocated = f.store.prepare(input)
      armed = true
      expect(() => f.store.complete(input.operationId)).toThrow()
      const next = f.open()
      next.complete(input.operationId)
      expect(next.exportActivation().entries[0]?.installId).toBe(allocated.next?.installId)
    },
  )
})
