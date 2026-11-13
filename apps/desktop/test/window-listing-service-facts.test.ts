import Database from 'better-sqlite3'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { openDatabase } from '../src/main/db/connection'
import { writeProfileExecution } from '../src/main/profile-execution-file'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'

it('uses worker structural facts for listing service classification with canonical labels', async () => {
  const writer: { current?: Database.Database } = {}
  let measuring = false
  const probes: string[] = []
  const callers: string[] = []
  const prepare = Database.prototype.prepare
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string,
  ) {
    const isWriter = () => this === writer.current
    const statement = prepare.call(this, sql) as Database.Statement<unknown[], unknown>
    if (!/^\s*SELECT\b/i.test(sql)) return statement
    return new Proxy(statement, {
      get(native, key) {
        if (key === 'get')
          return (...args: unknown[]) => {
            const caller = measuring && isWriter() ? (new Error().stack ?? '') : ''
            if (/theServiceOf/.test(caller)) {
              probes.push(sql)
              callers.push(caller)
            }
            return native.get(...args)
          }
        const value: unknown = Reflect.get(native, key, native)
        return typeof value === 'function' ? value.bind(native) : value
      },
    })
  })
  const world = aServiceWorld()
  writer.current = world.db
  const normal = world.anAgent('normal', 'normal')
  const born = world.anAgent('born', 'service')
  const reserved = world.anAgent('reserved', 'service')
  for (const id of ['normal', 'child', 'unknown', 'born', 'reserved'])
    world.store.create({
      id,
      provider: 'codex',
      profileId: id === 'child' || id === 'unknown' ? 'normal' : id,
      cwd: world.folder,
      approvalMode: 'ask',
      ...(id === 'child' ? { parentSessionId: 'normal' } : {}),
      ...(id === 'unknown' || id === 'born' ? { service: true as const } : {}),
    })
  const root = world.store.rootOf('normal')!
  for (const id of ['child', 'unknown', 'born'])
    world.store.append(
      id,
      0,
      {
        type: 'work_given',
        piece: `${id}-piece`,
        label: `${root.label}.1`,
        parent: root.piece,
        givenBy: 'normal',
        title: 'Fictional child',
        brief: 'Fictional',
      },
      world.clock,
    )
  writeProfileExecution(world.db, {
    profiles: {
      [normal.id]: { kind: 'normal', identityCreatedAt: normal.createdAt },
      [born.id]: {
        kind: 'service',
        identityCreatedAt: born.createdAt,
        serviceConversation: 'born',
      },
      [reserved.id]: {
        kind: 'service',
        identityCreatedAt: reserved.createdAt,
        reserved: 'reserved',
      },
    },
  })
  const canonical = world.aHost()
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  const host = world.aHost({
    windowReader: { read: async (query) => engine.read(query), close: async () => {} },
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
  })
  const counts: { phase: string; probes: number; canonicalProbes: number }[] = []
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    const read = async (phase: string, unknownLabel: string | null = null) => {
      probes.length = 0
      measuring = true
      const expected = canonical.unresumableSessions()
      measuring = false
      const canonicalProbes = probes.length
      probes.length = 0
      callers.length = 0
      const before = probes.length
      measuring = true
      const answer = await executeRuntimeCommand(host, world.window, { kind: 'listUnresumable' })
      measuring = false
      counts.push({ phase, probes: probes.length - before, canonicalProbes })
      expect(answer).toEqual(expected)
      expect(expected.find((row) => row.sessionId === 'normal')?.named?.label).toBe(root.label)
      expect(expected.find((row) => row.sessionId === 'child')?.named?.label).toBe(
        `${root.label}.1`,
      )
      expect(expected.find((row) => row.sessionId === 'unknown')?.named?.label ?? null).toBe(
        unknownLabel,
      )
      for (const id of ['born', 'reserved'])
        expect(expected.find((row) => row.sessionId === id)?.named).toBeNull()
    }
    await read('cold')
    await read('warm')
    world.store.append(
      'normal',
      world.store.nextOrdinal('normal'),
      {
        type: 'work_retitled',
        piece: root.piece,
        title: 'Changed title',
        by: null,
      },
      world.clock,
    )
    await read('retitled')
    const external = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      external
        .prepare('UPDATE provider_session SET parent_session_id = ? WHERE id = ?')
        .run('normal', 'unknown')
      await read('external-parent', `${root.label}.1`)
      external
        .prepare('UPDATE provider_session SET parent_session_id = NULL WHERE id = ?')
        .run('unknown')
      await read('external-parent-removed')
    } finally {
      external.close()
    }
    const added = world.store.ensurePersonalRoot('unknown', world.clock)
    await read('root-added', added.label)
    console.info(JSON.stringify({ counts, probes, callers }))
    expect(counts[0]!.canonicalProbes).toBeGreaterThan(0)
    expect(counts.every((one) => one.probes === 0)).toBe(true)
    expect(probes).toEqual([])
  } finally {
    measuring = false
    await host.closeAll()
    await canonical.closeAll()
    engine.close()
    await world.cleanUp()
    vi.restoreAllMocks()
  }
})
