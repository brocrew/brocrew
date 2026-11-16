import { metadataEditBaseline } from './lib/connection-metadata-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { listProviderConnections, updateProviderConnection } from '../src/main/connections/records'
import { createSessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const sink = new RecordingSink('fictional-metadata-window')
let folder: string
let file: string
let db: AppDatabase
let host: RuntimeHost
const moved = vi.fn()
const create = vi.fn((provider: Provider) => new FakeRuntime(provider))
const prepare = vi.fn(() => folder)
const resolve = vi.fn(() => {
  throw new Error('Metadata does not resolve a launch.')
})
function bind(): void {
  host = new RuntimeHost({
    ...neutralHostDeps(() => folder),
    store: createSessionStore(db),
    createRuntime: create,
    prepareProviderHome: prepare,
    connectionFor: resolve,
    providerHomePath: () => folder,
    resolveCwd: () => folder,
    newSessionId: () => 'fictional-unused-metadata',
    readProviderConfig: fixtureProviderConfig,
    listConnections: () =>
      (['claude', 'codex'] as const).flatMap((p) => listProviderConnections(db, p)),
    updateConnectionMetadata: (input) => updateProviderConnection(db, input),
    providersMoved: moved,
  })
}
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fictional-connection-edit-'))
  file = join(folder, 'workspace.db')
  db = openDatabase(file)
  applyMigrations(db, migrations)
  moved.mockClear()
  create.mockClear()
  prepare.mockClear()
  resolve.mockClear()
  bind()
})
afterEach(async () => {
  await host.closeAll()
  if (db.open) db.close()
  rmSync(folder, { recursive: true, force: true })
})
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: public metadata save persists without retargeting recorded, legacy or default bindings`, async () => {
    const store = createSessionStore(db)
    const selected = `${provider}:sign-in`
    for (const [id, connectionId] of [
      ['fictional-recorded', selected],
      ['fictional-legacy', null],
    ] as const)
      store.create({
        id,
        provider,
        cwd: folder,
        profileId: 'fern',
        approvalMode: 'ask',
        ...(connectionId === null ? {} : { connectionId }),
      })
    const { sessions, defaults } = metadataEditBaseline(db, store, provider, selected)
    const old = db
      .prepare('SELECT * FROM provider_connection WHERE id = ?')
      .get(selected) as Record<string, unknown>
    const command = {
      kind: 'updateProviderConnection',
      provider,
      connectionId: selected,
      name: '  Fictional research  ',
      description: '  Writing and research  ',
    }
    await expect(executeRuntimeCommand(host, sink, command)).resolves.toMatchObject({
      id: selected,
      provider,
      name: 'Fictional research',
      description: 'Writing and research',
    })
    expect(moved.mock.calls).toEqual([[{ what: 'connections', provider }]])
    expect(db.prepare('SELECT * FROM provider_connection WHERE id = ?').get(selected)).toEqual({
      ...old,
      name: 'Fictional research',
      description: 'Writing and research',
    })
    expect(db.prepare('SELECT * FROM provider_session ORDER BY id').all()).toEqual(sessions)
    expect(db.prepare('SELECT * FROM agent_identity ORDER BY slug').all()).toEqual(defaults)
    await host.closeAll()
    db.close()
    db = openDatabase(file)
    applyMigrations(db, migrations)
    bind()
    await expect(
      executeRuntimeCommand(host, sink, { kind: 'providerConnections' }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: selected,
          provider,
          name: 'Fictional research',
          description: 'Writing and research',
        }),
      ]),
    )
    expect(createSessionStore(db).connectionOf('fictional-recorded')).toBe(selected)
    expect(createSessionStore(db).connectionOf('fictional-legacy')).toBeNull()
    expect(db.prepare('SELECT * FROM agent_identity ORDER BY slug').all()).toEqual(defaults)
    expect(create).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it(`${provider}: a blank description clears only that display field`, async () => {
    const selected = `${provider}:api-key`
    db.prepare('UPDATE provider_connection SET description = ? WHERE id = ?').run(
      'Fictional old description',
      selected,
    )
    const before = listProviderConnections(db, provider).find((row) => row.id === selected)!
    await expect(
      executeRuntimeCommand(host, sink, {
        kind: 'updateProviderConnection',
        provider,
        connectionId: selected,
        name: before.name,
        description: '  \n  ',
      }),
    ).resolves.toEqual({ ...before, description: null })
    expect(listProviderConnections(db, provider).find((row) => row.id === selected)).toEqual({
      ...before,
      description: null,
    })
    expect(create).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it(`${provider}: invalid metadata and route-changing fields leave every connection unchanged`, async () => {
    const rows = listProviderConnections(db, provider)
    const selected = rows.find((row) => row.authMethod === 'sign-in')!
    const other = rows.find((row) => row.authMethod === 'api-key')!
    const before = db.prepare('SELECT * FROM provider_connection ORDER BY id').all()
    const command = {
      kind: 'updateProviderConnection',
      provider,
      connectionId: selected.id,
      name: 'Fictional valid',
      description: null,
    }
    await expect(executeRuntimeCommand(host, sink, { ...command, name: '  ' })).rejects.toThrow(
      'Give this connection a name.',
    )
    await expect(
      executeRuntimeCommand(host, sink, { ...command, name: other.name.toUpperCase() }),
    ).rejects.toThrow('already exists')
    await expect(
      executeRuntimeCommand(host, sink, {
        ...command,
        provider: provider === 'claude' ? 'codex' : 'claude',
      }),
    ).rejects.toThrow('unavailable')
    await expect(
      executeRuntimeCommand(host, sink, { ...command, authMethod: 'api-key' }),
    ).rejects.toThrow('invalid runtime command')
    expect(db.prepare('SELECT * FROM provider_connection ORDER BY id').all()).toEqual(before)
    expect(moved).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
}
