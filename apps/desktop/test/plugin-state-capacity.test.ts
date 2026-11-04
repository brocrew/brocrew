import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { type OperationRequest } from '../src/main/plugins/state/format'

const roots: string[] = [],
  stores: GlobalPluginState[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const release = {
  version: '1.0.0',
  archiveSha256: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  dataSchema: 1,
}
function fixture(fault?: (point: 'staged' | 'published' | 'durable') => void) {
  const parent = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-capacity-'),
  )
  roots.push(parent)
  const root = join(parent, 'plugins'),
    options = { root, workspaceRoots: [], fault }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  return {
    root,
    store,
    options,
    reopen() {
      const next = GlobalPluginState.open(options)
      stores.push(next)
      return next
    },
  }
}
function request(store: GlobalPluginState): OperationRequest {
  const state = store.inspect(),
    before = state.guards.find((entry) => entry.pluginId === 'fictional-bakery')
  return {
    operationId: randomUUID(),
    consent: {
      action: before?.phase === 'active' ? 'update' : 'install',
      pluginId: 'fictional-bakery',
      at: 1000,
      expectedSequence: state.sequence,
      expectedInstallId: before?.installId ?? null,
      release,
    },
    snapshot: null,
  }
}
function install(store: GlobalPluginState) {
  const input = request(store)
  store.prepare(input)
  store.complete(input.operationId)
}
describe('plugin state has no permanent history budget', () => {
  it('keeps the active snapshot compact with a retained archive above 32 MiB and 4096 operations', () => {
    let armed: 'staged' | 'published' | 'durable' | undefined
    const f = fixture((point) => {
        if (point === armed) {
          armed = undefined
          throw new Error('fictional archive/snapshot interruption')
        }
      }),
      first = request(f.store),
      planned = f.store.prepare(first)
    f.store.complete(first.operationId)
    const selected = f.store.exportActivation(),
      template = selected.entries[0]!
    const archive = join(f.root, 'operations.sqlite'),
      database = new Database(archive)
    const insert = database.prepare(
      'INSERT INTO operations (id, sequence, value, status) VALUES (?, ?, ?, ?)',
    )
    const entries = Array.from({ length: 24 }, (_, index) => ({
      ...template,
      pluginId: 'fictional-history-' + index,
      installId: randomUUID(),
      incarnation: randomUUID(),
    }))
    try {
      database.transaction(() => {
        for (let index = 0; index < 4100; index++) {
          const operationId = randomUUID(),
            operation = {
              ...planned,
              request: {
                ...first,
                operationId,
                consent: {
                  ...first.consent,
                  action: 'global-restore',
                  pluginId: null,
                  expectedInstallId: null,
                  release: null,
                },
                snapshot: { ...selected, entries },
              },
              next: null,
            }
          insert.run(
            operationId,
            0,
            JSON.stringify({ operation, status: 'completed' }),
            'completed',
          )
        }
      })()
    } finally {
      database.close()
    }
    expect(statSync(archive).size).toBeGreaterThan(32 * 1024 * 1024)
    const file = join(f.root, 'installed-state.json')
    const sizes: number[] = []
    for (let index = 0; index < 24; index++) {
      install(f.store)
      sizes.push(statSync(file).size)
    }
    expect(Math.max(...sizes)).toBeLessThan(64 * 1024)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1024)
    for (const point of ['staged', 'published', 'durable'] as const) {
      const input = request(f.store)
      armed = point
      expect(() => f.store.prepare(input)).toThrow('fictional archive/snapshot interruption')
      const allocation = f.store.operation(input.operationId)!.operation.allocated
      const resumed = f.reopen()
      expect(resumed.prepare(input).allocated).toEqual(allocation)
      armed = point
      expect(() => resumed.complete(input.operationId)).toThrow(
        'fictional archive/snapshot interruption',
      )
      const completed = f.reopen()
      completed.complete(input.operationId)
      expect(completed.inspect().pending).toBeNull()
      expect(completed.operation(input.operationId)).toMatchObject({
        status: 'completed',
        operation: { allocated: allocation },
      })
    }
    const reader = new Database(archive, { readonly: true })
    try {
      expect(
        (reader.prepare('SELECT count(*) AS count FROM operations').get() as { count: number })
          .count,
      ).toBe(4128)
    } finally {
      reader.close()
    }
    const before = f.store.inspect().sequence
    expect(f.reopen().prepare(first)).toEqual(planned)
    expect(f.store.inspect().sequence).toBe(before)
    expect(f.reopen().exportActivation().entries[0]?.release).toEqual(release)
    expect(readdirSync(f.root).sort()).toEqual([
      'installed-state.json',
      'operations.sqlite',
      'writer-lock.sqlite',
    ])
  })
  it('ordinary display and indexed retry do not parse unrelated retained history', () => {
    const f = fixture(),
      input = request(f.store),
      planned = f.store.prepare(input)
    f.store.complete(input.operationId)
    const database = new Database(join(f.root, 'operations.sqlite'))
    database
      .prepare('INSERT INTO operations (id, sequence, value, status) VALUES (?, 0, ?, ?)')
      .run(randomUUID(), '{broken historical row', 'completed')
    database.close()
    expect(GlobalPluginState.readInstalledPackage(f.options, 'fictional-bakery')).toMatchObject({
      version: '1.0.0',
    })
    expect(f.store.prepare(input)).toEqual(planned)
    install(f.store)
    expect(f.reopen().exportActivation().entries).toHaveLength(1)
  })
  it('keeps more than the old plugin and workspace projection capacities', () => {
    const f = fixture()
    install(f.store)
    const file = join(f.root, 'installed-state.json'),
      value = JSON.parse(readFileSync(file, 'utf8'))
    value.installations = Array.from({ length: 201 }, (_, index) => ({
      ...value.installations[0],
      pluginId: 'fictional-bakery-' + index,
    }))
    value.active = value.installations
    const original = f.store.emptyProjection(randomUUID(), 'fictional-bakery')!
    value.projections = Array.from({ length: 4100 }, () => ({
      ...original,
      workspaceId: randomUUID(),
      pluginId: 'fictional-bakery-0',
    }))
    writeFileSync(file, JSON.stringify(value))
    const next = f.reopen(),
      input = request(next)
    next.prepare(input)
    next.complete(input.operationId)
    expect(next.exportActivation().entries).toHaveLength(202)
    const workspace = randomUUID(),
      receipt = next.emptyProjection(workspace, 'fictional-bakery')!
    next.recordProjection(workspace, 'fictional-bakery', receipt)
    expect(f.reopen().projections(workspace)).toEqual([receipt])
  })
  it('does not allocate resolution reservations and leaves an interrupted atomic selection recoverable', () => {
    let armed = false
    const f = fixture((point) => {
      if (armed && point === 'staged') {
        armed = false
        throw new Error('fictional interruption')
      }
    })
    const input = request(f.store)
    f.store.prepare(input)
    armed = true
    expect(() => f.store.complete(input.operationId)).toThrow()
    const next = f.reopen()
    next.complete(input.operationId)
    expect(next.inspect().reservation).toBeNull()
    expect(readdirSync(f.root).sort()).toEqual([
      'installed-state.json',
      'operations.sqlite',
      'writer-lock.sqlite',
    ])
  })
})
