import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { MOVED_MARKER } from '../src/main/plugins/state/disk'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { GlobalPluginState as JournalStore } from './fixtures/plugin-journal-parent/store'
import { GlobalPluginState as UpdateParentStore } from './fixtures/plugin-update-parent/state-store'
import { GlobalPluginState as DeleteParentStore } from './fixtures/plugin-delete-parent/store'
import { encodeState, type JournalRecord } from './fixtures/plugin-journal-parent/format'
import {
  appendProjectionHistory,
  cleanupLifecycleFixtures,
  fixture,
  reopenLifecycleFixture,
  runOperation,
  stateFile,
  stateRequest,
} from './plugin-lifecycle-fixtures'
import { stateFileName, stateFilesIn } from '../src/main/plugins/state/format'

const roots: string[] = [],
  stores: { close(): void }[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  await cleanupLifecycleFixtures()
})
function kept<T extends { close(): void }>(store: T): T {
  stores.push(store)
  return store
}
/** The documented rollback deletes every state file. */
function removeStateFiles(root: string) {
  for (const one of stateFilesIn(readdirSync(root))) unlinkSync(join(root, one.name))
}
function folder() {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-migration-'))
  roots.push(path)
  return path
}
type Fault = (point: 'staged' | 'published' | 'durable') => void
/** A root that an earlier build wrote: the journal, its reservations and activation files. */
function journalRoot(fault?: Fault) {
  const parent = folder()
  const options = { root: join(parent, 'state'), workspaceRoots: [] as never[], fault }
  return { parent, options, journal: kept(JournalStore.create(options)) }
}
type JournalHead = Parameters<typeof appendProjectionHistory>[1]
const headOf = (journal: JournalStore) =>
  (journal as unknown as { disk: { load(): JournalHead } }).disk.load()
/** Every file's bytes in the state folder, the writer lock aside. */
function bytes(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (item.name.startsWith('writer-lock.sqlite')) continue
    const path = join(root, item.name)
    if (item.isDirectory()) Object.assign(files, bytes(path, prefix + item.name + '/'))
    else files[prefix + item.name] = pluginSha256(readFileSync(path))
  }
  return files
}
const key = (one: { operation: { request: { consent: { pluginId: string | null } } } }) =>
  one.operation.request.consent.pluginId ?? '*'
/** What the old recovery makes of the journal, on a copy, since it repairs and reclaims. */
function oldRecovery(root: string) {
  const copy = join(folder(), 'plugins')
  cpSync(root, copy, { recursive: true })
  const journal = JournalStore.open({ root: copy, workspaceRoots: [] })
  try {
    const { reservation: _reservation, operations, ...view } = structuredClone(journal.inspect())
    void _reservation
    return {
      ...view,
      // The state file keeps only each plugin's latest operation.
      operations: operations.filter(
        (one, at) => !operations.slice(at + 1).some((later) => key(later) === key(one)),
      ),
      active: journal.committedActivation().entries,
    }
  } finally {
    journal.close()
  }
}
function migrated(options: { root: string; workspaceRoots: readonly never[] }) {
  const state = kept(GlobalPluginState.open(options))
  return {
    state,
    view: { ...structuredClone(state.inspect()), active: state.committedActivation().entries },
  }
}

describe.skipIf(process.platform === 'win32')('migrating the plugin journal once', () => {
  it('a Personal-sized journal migrates to the old recovery’s state and is left untouched', () => {
    const { parent, options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    runOperation(journal, 'install', 'whatsapp')
    runOperation(journal, 'update', 'whatsapp', '1.0.1')
    runOperation(journal, 'uninstall', 'whatsapp')
    runOperation(journal, 'install', 'whatsapp', '1.0.1')
    runOperation(journal, 'install', 'bakery')
    runOperation(journal, 'uninstall', 'bakery')
    const pending = stateRequest(journal, 'update', 'chrome', '1.0.1')
    const head = headOf(journal)
    journal.close()
    // About as long as the longest journal seen in use, most of it old reconnect receipts.
    appendProjectionHistory(parent, head, randomUUID(), 1843 - head.sequence - 2)
    const resumed = kept(JournalStore.open(options))
    pending.consent.expectedSequence = resumed.inspect().sequence
    resumed.prepare(pending)
    resumed.close()
    const guard = join(options.root, 'lifecycle-guard')
    expect(readdirSync(guard).filter((name) => name.endsWith('.json'))).toHaveLength(1843)
    const before = bytes(options.root)
    const old = oldRecovery(options.root)
    const { state, view } = migrated(options)
    expect(view).toEqual(old)
    expect(view.pending?.request.operationId).toBe(pending.operationId)
    expect(view.guards.map((one) => [one.pluginId, one.phase])).toEqual([
      ['chrome', 'prepared'],
      ['whatsapp', 'active'],
      ['bakery', 'removed'],
    ])
    const after = bytes(options.root)
    expect(Object.keys(after).sort()).toEqual(
      [
        ...Object.keys(before),
        stateFileName(view.sequence),
        'resolution-reservations/' + MOVED_MARKER,
      ].sort(),
    )
    for (const [name, digest] of Object.entries(before)) expect(after[name], name).toBe(digest)
    expect(statSync(stateFile(options.root)!).size).toBeLessThan(16 * 1024)
    // Recovery resolves the migrated pending operation as it would have the journal's.
    state.abort(pending.operationId)
    expect(state.inspect().guards[0]?.phase).toBe('removed')
  })

  it.each(['the last seal missing', 'a guard-local crash stage left behind'] as const)(
    'with %s, the migration counts the records the old recovery counts',
    (mode) => {
      const { parent, options, journal } = journalRoot()
      runOperation(journal, 'install', 'chrome')
      const head = headOf(journal)
      journal.close()
      // The last record is one the old recovery seals again from the record alone: a receipt.
      appendProjectionHistory(parent, head, randomUUID(), 1)
      const guard = join(options.root, 'lifecycle-guard')
      if (mode === 'the last seal missing') {
        const seal = readdirSync(guard)
          .filter((name) => name.endsWith('.seal'))
          .sort()
          .at(-1)!
        unlinkSync(join(guard, seal))
      } else {
        linkSync(join(guard, '00000000.json'), join(guard, `.stage-${randomUUID()}`))
        writeFileSync(join(guard, `.stage-${randomUUID()}`), '{"incomplete', { mode: 0o600 })
      }
      const before = bytes(options.root)
      const old = oldRecovery(options.root)
      expect(migrated(options).view).toEqual(old)
      for (const [name, digest] of Object.entries(before))
        expect(bytes(options.root)[name], name).toBe(digest)
    },
  )

  it.each([
    ['prepare', 'staged'],
    ['prepare', 'published'],
    ['prepare', 'durable'],
    ['resolution', 'staged'],
    ['resolution', 'published'],
    ['resolution', 'durable'],
  ] as const)(
    'a journal publication interrupted during %s at %s migrates as the old recovery reads it',
    (step, point) => {
      let armed = false
      const { options, journal } = journalRoot((at) => {
        if (armed && at === point) {
          armed = false
          throw new Error('fictional power loss')
        }
      })
      runOperation(journal, 'install', 'chrome')
      const update = stateRequest(journal, 'update', 'chrome', '1.0.1')
      if (step === 'resolution') journal.prepare(update)
      armed = true
      expect(() =>
        step === 'prepare' ? journal.prepare(update) : journal.complete(update.operationId),
      ).toThrow()
      journal.close()
      const old = oldRecovery(options.root)
      const { state, view } = migrated(options)
      expect(view).toEqual(old)
      // Whatever the crash left, the migrated state finishes it as the old store would have.
      if (view.pending) {
        state.complete(update.operationId)
        expect(state.inspect().guards[0]?.release.version).toBe('1.0.1')
      } else expect(view.guards[0]?.phase).toBe('active')
    },
  )

  it.each(['install', 'uninstall'] as const)(
    'an %s stopped mid-operation recovers to the same outcome from the journal and from the state file',
    async (action) => {
      const outcomes = []
      for (const migrate of [false, true]) {
        const f = await fixture({}, 'chrome', {}, { journal: true })
        if (action === 'uninstall') await f.controller.install(f.handle, 'chrome')
        else
          f.opts.fault = (point) => {
            if (point === 'ready') throw new Error('fictional crash')
          }
        // The plugin's process cannot be proved stopped, so the operation stays pending.
        f.failStop()
        await f.controller[action](f.handle, 'chrome').catch(() => undefined)
        expect(f.state.inspect().pending).not.toBeNull()
        let state: GlobalPluginState
        if (migrate) state = reopenLifecycleFixture(f)
        else {
          f.state.close()
          state = kept(
            JournalStore.open({ root: join(f.root, 'state'), workspaceRoots: [f.workspace] }),
          ) as unknown as GlobalPluginState
        }
        f.failStop(false)
        const recovered = await PluginLifecycleController.open({
          ...f.opts,
          state,
          fault: undefined,
        })
        outcomes.push({
          pending: state.inspect().pending,
          phases: state.inspect().guards.map((one) => [one.pluginId, one.phase]),
          active: state.exportActivation().entries.map((one) => one.pluginId),
          card: (await recovered.status()).cards[0]?.state,
        })
        await recovered.drain()
      }
      expect(outcomes[1]).toEqual(outcomes[0])
      expect(outcomes[0]!.pending).toBeNull()
      expect(outcomes[0]!.phases).toEqual([['chrome', 'removed']])
    },
  )

  // Recovery only finishes operations whose effect is unsettled. The controller settles an
  // effect before it resolves the operation, except an abort's own label, and an abort leaves
  // the plugin removed, so its next operation is a fresh install. Here the journal keeps every
  // operation and the state file only the latest; a restart must end the same way in both.
  it.each(['completed with a crash after its resolution', 'aborted with its label left'] as const)(
    'an install %s, then a new operation and a restart, ends as it does with every operation kept',
    async (scenario) => {
      const outcomes = []
      for (const journal of [true, false]) {
        const f = await fixture({}, 'chrome', {}, { journal })
        const after = scenario.startsWith('completed') ? 'activated' : 'ready'
        f.opts.fault = (point) => {
          if (point === after) throw new Error('fictional crash')
        }
        await f.controller.install(f.handle, 'chrome').catch(() => undefined)
        f.opts.fault = undefined
        const first = f.state.inspect().operations[0]!
        expect(first.status).toBe(scenario.startsWith('completed') ? 'completed' : 'aborted')
        const effects = await LifecycleEffects.open(f.root, false)
        if (scenario.startsWith('aborted')) {
          // Fixture image of a crash after the abort, before its effect said so.
          const effect = (await effects.read(first.operation.request.operationId))!
          expect(effect.phase).toBe('aborted')
          await effects.write({ ...effect, phase: 'prepared' })
        }
        // A new operation for the same plugin: the state file now drops the first one.
        if (scenario.startsWith('completed')) await f.controller.uninstall(f.handle, 'chrome')
        else await f.controller.install(f.handle, 'chrome')
        expect(f.state.inspect().operations.length).toBe(journal ? 2 : 1)
        let state: GlobalPluginState
        if (journal) {
          f.state.close()
          state = kept(
            JournalStore.open({ root: join(f.root, 'state'), workspaceRoots: [f.workspace] }),
          ) as unknown as GlobalPluginState
        } else state = reopenLifecycleFixture(f)
        const at = f.events.length
        const recovered = await PluginLifecycleController.open({ ...f.opts, state })
        const labels = await Promise.all(
          state
            .inspect()
            .operations.map(
              async (one) => (await effects.read(one.operation.request.operationId))?.phase,
            ),
        )
        outcomes.push({
          pending: state.inspect().pending,
          phases: state.inspect().guards.map((one) => [one.pluginId, one.phase]),
          active: state.exportActivation().entries.map((one) => one.pluginId),
          card: (await recovered.status()).cards[0]?.state,
          recovery: f.events.slice(at),
          latest: labels.at(-1),
          first: (await effects.read(first.operation.request.operationId))?.phase,
        })
      }
      expect(outcomes[1]).toEqual(outcomes[0])
      expect(outcomes[0]!.pending).toBeNull()
    },
  )

  it('a crash before the state file is in place leaves the journal as it was, and the next start migrates again', () => {
    const { options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    journal.close()
    const before = bytes(options.root)
    expect(() =>
      GlobalPluginState.open({
        ...options,
        fault(point) {
          if (point === 'staged') throw new Error('fictional power loss')
        },
      }),
    ).toThrow()
    expect(stateFile(options.root)).toBeUndefined()
    for (const [name, digest] of Object.entries(before))
      expect(bytes(options.root)[name], name).toBe(digest)
    const old = oldRecovery(options.root)
    expect(migrated(options).view).toEqual(old)
  })

  it('a crash after the state file but before the marker is finished by the next start', () => {
    const { options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    journal.close()
    const marker = join(options.root, 'resolution-reservations', MOVED_MARKER)
    expect(() =>
      GlobalPluginState.open({
        ...options,
        fault(point) {
          if (point === 'published') throw new Error('fictional power loss')
        },
      }),
    ).toThrow()
    expect(stateFile(options.root)).toBeDefined()
    expect(existsSync(marker)).toBe(false)
    // Until the marker is written, the journal is still current for an older app.
    const old = oldRecovery(options.root)
    expect(migrated(options).view).toEqual(old)
    expect(existsSync(marker)).toBe(true)
  })

  it('a state file lost after migration refuses instead of rebuilding from the stale journal', () => {
    const { options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    journal.close()
    const { state } = migrated(options)
    runOperation(state, 'uninstall', 'chrome')
    state.close()
    removeStateFiles(options.root)
    const before = bytes(options.root)
    expect(() => GlobalPluginState.open(options)).toThrow(
      expect.objectContaining({ code: 'missing-guard' }),
    )
    expect(bytes(options.root)).toEqual(before)
  })

  it('older builds refuse a migrated root and change nothing; removing the marker and the state file rolls back to migration day', () => {
    const { options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    const backup = journal.exportActivation()
    journal.close()
    const { state } = migrated(options)
    runOperation(state, 'uninstall', 'chrome')
    state.close()
    const before = bytes(options.root)
    for (const older of [JournalStore, UpdateParentStore, DeleteParentStore])
      expect(() => kept(older.open(options))).toThrow(
        expect.objectContaining({ name: 'PluginStateError' }),
      )
    expect(bytes(options.root)).toEqual(before)
    // The documented rollback: the older app is back on the journal as it was when migrated.
    unlinkSync(join(options.root, 'resolution-reservations', MOVED_MARKER))
    removeStateFiles(options.root)
    const rolledBack = kept(JournalStore.open(options))
    expect(rolledBack.inspect().guards.map((one) => one.phase)).toEqual(['active'])
    rolledBack.close()
    // The next newer start migrates that journal again.
    const again = migrated(options)
    expect(again.view.guards.map((one) => one.phase)).toEqual(['active'])
    expect(existsSync(join(options.root, 'resolution-reservations', MOVED_MARKER))).toBe(true)
    // A removal after migration holds against a restore of a backup taken before it.
    runOperation(again.state, 'uninstall', 'chrome')
    const restore = {
      operationId: randomUUID(),
      snapshot: backup,
      consent: {
        action: 'global-restore',
        pluginId: null,
        at: 1000,
        expectedSequence: again.state.inspect().sequence,
        expectedInstallId: null,
        release: null,
      },
    }
    again.state.prepare(restore)
    again.state.complete(restore.operationId)
    expect(again.state.inspect().guards[0]?.phase).toBe('removed')
    expect(again.state.exportActivation().entries).toEqual([])
  })

  it('after migration the journal is never read again', () => {
    const { options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    journal.close()
    const { state, view } = migrated(options)
    runOperation(state, 'uninstall', 'chrome')
    const after = structuredClone(state.inspect())
    state.close()
    renameSync(join(options.root, 'lifecycle-guard'), join(options.root, '..', 'moved-away'))
    expect(migrated(options).view.guards).toEqual(after.guards)
    expect(view.guards[0]?.phase).toBe('active')
  })

  it('a journal at its record limit, which refused every change, migrates and changes again', () => {
    const { parent, options, journal } = journalRoot()
    runOperation(journal, 'install', 'chrome')
    const head = headOf(journal)
    journal.close()
    appendProjectionHistory(parent, head, randomUUID(), 4094 - head.sequence)
    const full = kept(JournalStore.open(options))
    expect(() => full.prepare(stateRequest(full, 'uninstall', 'chrome'))).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
    full.close()
    const { state } = migrated(options)
    for (let i = 0; i < 5; i++) {
      runOperation(state, 'uninstall', 'chrome')
      runOperation(state, 'install', 'chrome')
    }
    expect(state.inspect().sequence).toBeGreaterThan(4096)
    expect(state.inspect().operations).toHaveLength(1)
    expect(statSync(stateFile(options.root)!).size).toBeLessThan(4 * 1024)
  })

  it('a journal that is not one refuses, and nothing is written', () => {
    const { options, journal } = journalRoot()
    journal.close()
    const guard = join(options.root, 'lifecycle-guard')
    const record: JournalRecord = {
      sequence: 1,
      previous: 'a'.repeat(64),
      publicationId: randomUUID(),
      event: { kind: 'reader-floor', version: 2 },
    }
    writeFileSync(join(guard, '00000001.json'), encodeState(record), { mode: 0o600 })
    const before = bytes(options.root)
    expect(() => GlobalPluginState.open(options)).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    )
    expect(bytes(options.root)).toEqual(before)
  })
})
