import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/**
 * The commit record's own proof, independent of the list it keeps: every persistent change a
 * commit makes is published; no write reaches the file outside what it frames; an append costs no
 * SQL of the recorder's; and the host follows each committed row exactly once.
 */
describe('the commit record covers every write', () => {
  const opened: { db: AppDatabase; folder: string }[] = []
  afterEach(() => {
    for (const { db, folder } of opened.splice(0)) {
      db.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })
  const aStore = (beforeTheStore?: (db: AppDatabase) => void) => {
    const folder = mkdtempSync(join(tmpdir(), 'brocrew-commit-cover-'))
    const db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
    opened.push({ db, folder })
    beforeTheStore?.(db)
    const store = createSessionStore(db, () => 5_000)
    return { db, folder, store }
  }
  const text = (words: string): TranscriptEvent => ({ type: 'assistant_message', text: words })

  it('no source writes a persistent table outside a statement the record frames', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts')) files.push(path)
      }
    }
    walk(mainRoot)
    expect(files.length).toBeGreaterThan(300)
    // A literal handed to `exec` runs no prepared statement, so it is the one way around the record.
    const literal = /\.exec\(\s*(?:'([^']*)'|`([^`]*)`|"([^"]*)")/g
    const writes = (source: string): string[] =>
      [...source.matchAll(literal)]
        .map((hit) => (hit[1] ?? hit[2] ?? hit[3] ?? '').trim())
        .filter((sql) => /^(?:INSERT|REPLACE|UPDATE|DELETE|WITH)\b/i.test(sql))
    const found = files.flatMap((path) =>
      writes(readFileSync(path, 'utf8')).map((sql) => `${path.slice(mainRoot.length + 1)}: ${sql}`),
    )
    expect(found).toEqual([])
    // The control: the walk sees a write handed to `exec`.
    expect(writes("db.exec(`UPDATE provider_session SET cwd = ''`)")).toHaveLength(1)
    // And the store installs the record before any module on its connection makes a transaction.
    const store = readFileSync(join(mainRoot, 'db/session-store.ts'), 'utf8')
    expect(store.indexOf('committedChangesOf(connection)')).toBeGreaterThan(0)
    expect(store.indexOf('committedChangesOf(connection)')).toBeLessThan(
      store.indexOf('createOwnNotesStore(connection)'),
    )
  })

  it('every commit that changes a persistent table is published, whatever door made it', () => {
    const { db, store } = aStore()
    // Test-only: a temp trigger on each persistent table says a change happened, independently of
    // the record; a publication clears it.
    let changed = false
    db.function('a_persistent_change', () => {
      changed = true
      return 0
    })
    const tables = (
      db
        .prepare(
          `SELECT name FROM main.sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%'`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name)
    let watched = 0
    for (const table of tables) {
      try {
        for (const verb of ['INSERT', 'UPDATE', 'DELETE'])
          db.exec(`CREATE TEMP TRIGGER "cover_${table}_${verb}" AFTER ${verb} ON main."${table}"
            BEGIN SELECT a_persistent_change(); END`)
        watched += 1
      } catch {
        // A virtual table's own storage takes no trigger; its writes come with its table's.
      }
    }
    expect(watched).toBeGreaterThan(10)
    store.onCommitted(() => {
      changed = false
    })
    const doors: [string, (one: SessionStore) => void][] = [
      [
        'create',
        (one) =>
          one.create({
            id: 'alpha',
            provider: 'claude',
            cwd: '/tmp',
            approvalMode: 'auto',
            profileId: 'alpha',
          }),
      ],
      ['append', (one) => one.append('alpha', 0, text('one'), 5_000)],
      [
        'appendMany',
        (one) => one.appendMany('alpha', [{ ordinal: 1, event: text('two'), at: 5_000 }]),
      ],
      ['setModel', (one) => one.setModel('alpha', 'fictional-model')],
      ['ensurePersonalRoot', (one) => void one.ensurePersonalRoot('alpha', 5_000)],
      [
        'addResource',
        (one) =>
          void one.addResource(
            {
              piece: one.rootOf('alpha')!.piece,
              role: 'made',
              title: 'Fictional notes',
              summary: null,
              name: 'notes.md',
              sha256: 'a'.repeat(64),
              bytes: 1,
              addedBy: null,
            },
            5_000,
          ),
      ],
      ['restartedWorkLate', (one) => one.restartedWorkLate('alpha', ['fictional-piece'], 5_000)],
      [
        'rebuild',
        (one) => {
          const generation = one.beginGeneration('alpha')
          one.appendGeneration('alpha', generation, [
            { ordinal: 0, event: text('rebuilt'), at: 5_000 },
          ])
          one.promoteGeneration('alpha', generation, { normalizerVersion: 1, derivedThrough: 1 })
        },
      ],
      [
        'importSnapshot',
        (one) =>
          one.importSnapshot({
            session: {
              id: 'bundle',
              provider: 'claude',
              sessionId: 'fictional-bundle',
              cwd: '/tmp',
              profileId: 'fictional',
              updatedAt: 5_000,
              createdAt: 5_000,
            },
            derivedThrough: 0,
            ledger: [{ ordinal: 0, at: 5_000, event: text('imported') }],
          }),
      ],
      ['deleteTheTree', (one) => void one.deleteTheTree(['bundle'])],
    ]
    const unpublished: string[] = []
    for (const [name, door] of doors) {
      changed = false
      door(store)
      if (changed) unpublished.push(name)
    }
    expect(unpublished).toEqual([])
    // The control: a change the record never frames is seen.
    changed = false
    db.exec("UPDATE provider_session SET cwd = '/tmp/elsewhere' WHERE id = 'alpha'")
    expect(changed).toBe(true)
  })

  it('an append runs no SQL of the recorder’s own', () => {
    const executed: string[] = []
    const { db, store } = aStore((raw) => {
      // Installed before the store, so the recorder prepares through it and every statement the
      // store or the recorder runs is counted by its text.
      const prepare = raw.prepare.bind(raw)
      Object.defineProperty(raw, 'prepare', {
        configurable: true,
        writable: true,
        value: (sql: string) => {
          const statement = prepare(sql)
          for (const method of ['run', 'get', 'all', 'iterate'] as const) {
            const real = statement[method].bind(statement) as (...args: unknown[]) => unknown
            Object.defineProperty(statement, method, {
              configurable: true,
              writable: true,
              value: (...args: unknown[]) => {
                executed.push(sql)
                return real(...args)
              },
            })
          }
          return statement
        },
      })
    })
    store.create({
      id: 'alpha',
      provider: 'claude',
      cwd: '/tmp',
      approvalMode: 'auto',
      profileId: 'alpha',
    })
    store.onCommitted(() => undefined)
    store.append('alpha', 0, text('warm'), 5_000)
    const pragma = vi.spyOn(db, 'pragma')
    const perAppend: number[] = []
    for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
      executed.length = 0
      store.append('alpha', ordinal, text(`fictional ${ordinal}`), 5_000)
      expect(executed.filter((sql) => /temp\.sqlite_master|data_version/.test(sql))).toEqual([])
      perAppend.push(executed.length)
    }
    expect(pragma).not.toHaveBeenCalled()
    expect(new Set(perAppend).size).toBe(1)
  })

  describe('the host follows each committed row exactly once', () => {
    let world: AServiceWorld
    let host: RuntimeHost
    afterEach(async () => world.cleanUp())

    it('across a person’s start, a give, its turn and a message', async () => {
      world = aServiceWorld()
      world.anAgent('giver', 'normal')
      world.anAgent('helper', 'normal')
      host = world.aHost({ servicesOn: false })
      const followed: string[] = []
      const watched = host as unknown as {
        aRowWasWritten(conversation: string, row: { rowType: string; ordinal: number }): void
      }
      const real = watched.aRowWasWritten.bind(host)
      vi.spyOn(watched, 'aRowWasWritten').mockImplementation((conversation, row) => {
        followed.push(`${conversation}:${row.ordinal}:${row.rowType}`)
        real(conversation, row)
      })
      const giver = await world.aPersonOpens(host, 'giver')
      const given = await world.gives(host, giver, 'helper')
      expect(given).toMatchObject({ ok: true })
      await host.send(giver, 'Fictional words for the giver.', world.window)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const conversations = (
        world.db.prepare('SELECT id FROM provider_session').all() as { id: string }[]
      ).map((row) => row.id)
      const committed = conversations.flatMap((id) =>
        world.store.events(id).map((row) => `${id}:${row.ordinal}:${row.event.type}`),
      )
      expect(followed.length).toBeGreaterThan(0)
      expect([...followed].sort()).toEqual([...committed].sort())
    })
  })
})
