import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { Committed } from '../src/main/db/committed-changes'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const text = (words: string): TranscriptEvent => ({ type: 'assistant_message', text: words })

/**
 * The commit record's own proof, independent of the list it keeps: each actual commit's
 * persistent writes are published at that commit; the ways around the record are pinned; an append
 * runs the store's statements and nothing else; and each act's invalidations are those the hand
 * marks made before the record replaced them, or more.
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

  describe('the ways around the record are pinned', () => {
    /**
     * Its limits, stated: the record frames every transaction and every prepared write on a
     * writable connection once the store has installed it. What can go around it is a statement
     * handed to `exec`, or a statement prepared on the connection before the store exists. Every
     * `exec` site in the main process is pinned below with what it runs; a new one fails here and
     * must be read. Statements prepared before the store are covered only by the startup order
     * pinned at the end. Other connections are read-only engines, separate databases, or recovery
     * copies, and a foreign commit on the app's file is caught by the record's own check.
     */
    const EXEC_SITES: Record<string, { count: number; why: string }> = {
      'db/provider-wall-watch.ts': { count: 2, why: 'temp triggers for the wall watch' },
      'db/fold-write-watch.ts': { count: 1, why: 'temp triggers for kept folds' },
      'db/past-work-search.ts': {
        count: 6,
        why: 'temp table and triggers on the app file; a read transaction; its own in-memory index',
      },
      'db/window-writer-stamp.ts': { count: 4, why: 'temp counters and triggers; dropping them' },
      'db/compact.ts': { count: 1, why: 'VACUUM, at launch' },
      'db/question-copies.ts': {
        count: 3,
        why: "the derived copies' tables, triggers and index, created at open: schema only",
      },
      'db/files-library-engine.ts': {
        count: 3,
        why: 'its read-only connection: BEGIN/COMMIT/ROLLBACK',
      },
      'db/team-profile-graph-engine.ts': { count: 3, why: 'its read-only connection' },
      'db/limits-read-engine.ts': { count: 3, why: 'its read-only connection' },
      'db/work-search-engine.ts': { count: 3, why: 'its read-only connection' },
      'db/window-read-engine.ts': { count: 3, why: 'its read-only connection' },
      'plugins/state/fence.ts': { count: 2, why: 'the plugin state database, not the app file' },
      'plugins/supervisor/sqlite-adapter.ts': { count: 1, why: 'the supervisor database' },
    }
    const execSites = (source: string): number =>
      [...source.matchAll(/\b(?:db|source|this\.db|memory|connection)\.exec\(/g)].length

    it('every exec site, and the record installed before any transaction', () => {
      const found: Record<string, number> = {}
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else if (path.endsWith('.ts')) {
            const count = execSites(readFileSync(path, 'utf8'))
            if (count > 0) found[path.slice(mainRoot.length + 1).replaceAll('\\', '/')] = count
          }
        }
      }
      walk(mainRoot)
      expect(found).toEqual(
        Object.fromEntries(Object.entries(EXEC_SITES).map(([path, site]) => [path, site.count])),
      )
      // The control: a write handed to exec, behind a comment, is still one more site.
      expect(execSites("/* tidy */ db.exec(`UPDATE provider_session SET cwd = ''`)")).toBe(1)
      const store = readFileSync(join(mainRoot, 'db/session-store.ts'), 'utf8')
      expect(store.indexOf('committedChangesOf(connection)')).toBeGreaterThan(0)
      expect(store.indexOf('committedChangesOf(connection)')).toBeLessThan(
        store.indexOf('createOwnNotesStore(connection)'),
      )
    })
  })

  describe('each actual commit is published with the tables it wrote', () => {
    /**
     * Test-only, installed on the connection before the store: temp triggers on every persistent
     * table say which tables a write touched, and wrappers on `transaction`, `prepare` and `exec`
     * say where each actual outer commit or autocommit ended — independently of the record.
     */
    const watchCommits = (db: AppDatabase) => {
      const commits: string[][] = []
      const levels: Set<string>[] = []
      let loose = new Set<string>()
      const ended = (): void => {
        if (loose.size > 0) commits.push([...loose].sort())
        loose = new Set()
      }
      db.function('a_persistent_write', (table: unknown) => {
        ;(levels.at(-1) ?? loose).add(String(table))
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
              BEGIN SELECT a_persistent_write('${table}'); END`)
          watched += 1
        } catch {
          // A virtual table's own storage takes no trigger; its writes come with its table's.
        }
      }
      const prepare = db.prepare.bind(db)
      Object.defineProperty(db, 'prepare', {
        configurable: true,
        writable: true,
        value: (sql: string) => {
          const statement = prepare(sql)
          const run = statement.run.bind(statement) as (...args: unknown[]) => unknown
          Object.defineProperty(statement, 'run', {
            configurable: true,
            writable: true,
            value: (...args: unknown[]) => {
              const result = run(...args)
              if (!db.inTransaction && levels.length === 0) ended()
              return result
            },
          })
          return statement
        },
      })
      const exec = db.exec.bind(db)
      Object.defineProperty(db, 'exec', {
        configurable: true,
        writable: true,
        value: (sql: string) => {
          const result = exec(sql)
          if (!db.inTransaction && levels.length === 0) ended()
          return result
        },
      })
      type Made = ((...args: unknown[]) => unknown) &
        Record<string, (...args: unknown[]) => unknown>
      const transaction = db.transaction.bind(db) as unknown as (fn: unknown) => Made
      Object.defineProperty(db, 'transaction', {
        configurable: true,
        writable: true,
        value: (fn: unknown) => {
          const made = transaction(fn)
          const framed =
            (call: (...args: unknown[]) => unknown) =>
            (...args: unknown[]) => {
              levels.push(new Set())
              let result: unknown
              try {
                result = call(...args)
              } catch (error) {
                levels.pop()
                throw error
              }
              const mine = levels.pop()!
              const parent = levels.at(-1)
              if (parent !== undefined) for (const table of mine) parent.add(table)
              else if (!db.inTransaction && mine.size > 0) commits.push([...mine].sort())
              return result
            }
          const wrapped = framed(made) as Made
          for (const variant of ['default', 'deferred', 'immediate', 'exclusive'])
            wrapped[variant] = framed(made[variant]!)
          return wrapped
        },
      })
      // The tables a session's rows cascade into: a whole change to a session declares them.
      const keyedBySession = new Set<string>()
      let grew = true
      while (grew) {
        grew = false
        for (const table of tables) {
          if (keyedBySession.has(table)) continue
          const keys = db
            .prepare(`SELECT "table" AS parent FROM pragma_foreign_key_list(?)`)
            .all(table) as {
            parent: string
          }[]
          if (
            keys.some((key) => key.parent === 'provider_session' || keyedBySession.has(key.parent))
          ) {
            keyedBySession.add(table)
            grew = true
          }
        }
      }
      return { commits, watched, keyedBySession }
    }
    /** What the record published, one entry per commit. */
    const hearCommits = (store: SessionStore) => {
      const heard: Committed[] = []
      store.onCommitted((change) => heard.push(change))
      return heard
    }
    /** Each observed commit against its publication: same count and order, tables covered. */
    const mismatches = (
      commits: string[][],
      heard: Committed[],
      keyedBySession: ReadonlySet<string> = new Set(),
    ): string[] => {
      const problems: string[] = []
      if (commits.length !== heard.length)
        problems.push(`${commits.length} commits observed, ${heard.length} published`)
      commits.forEach((tables, at) => {
        const published = heard[at]
        if (published === undefined || published.resync) return
        const declaredWhole = published.whole.size > 0
        const missing = tables.filter(
          (table) => !published.tables.has(table) && !(declaredWhole && keyedBySession.has(table)),
        )
        if (missing.length > 0)
          problems.push(`commit ${at} wrote ${missing.join(', ')} unpublished`)
      })
      return problems
    }
    const create = (store: SessionStore, id: string) =>
      store.create({ id, provider: 'claude', cwd: '/tmp', approvalMode: 'auto', profileId: id })

    it('at every door exercised, one publication per commit, naming each table written', () => {
      let watch!: ReturnType<typeof watchCommits>
      const { store } = aStore((db) => (watch = watchCommits(db)))
      const heard = hearCommits(store)
      expect(watch.watched).toBeGreaterThan(10)
      create(store, 'alpha')
      create(store, 'beta')
      store.append('alpha', 0, text('one'), 5_000)
      store.appendMany('alpha', [{ ordinal: 1, event: text('two'), at: 5_000 }])
      store.setModel('alpha', 'fictional-model')
      store.setApprovalMode('alpha', 'ask')
      const root = store.ensurePersonalRoot('alpha', 5_000)
      store.addResource(
        {
          piece: root.piece,
          role: 'made',
          title: 'Fictional notes',
          summary: null,
          name: 'notes.md',
          sha256: 'a'.repeat(64),
          bytes: 1,
          addedBy: null,
        },
        5_000,
      )
      store.restartedWorkLate('alpha', ['fictional-piece'], 5_000)
      store.settleOrphanRuns(5_000, new Set())
      store.clearOrphanBuilds(new Set())
      // A rebuild commits begin, its batches and its promotion separately.
      const generation = store.beginGeneration('beta')
      store.appendGeneration('beta', generation, [
        { ordinal: 0, event: text('rebuilt'), at: 5_000 },
      ])
      store.appendGeneration('beta', generation, [{ ordinal: 1, event: text('again'), at: 5_000 }])
      store.promoteGeneration('beta', generation, { normalizerVersion: 1, derivedThrough: 2 })
      store.importSnapshot({
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
      })
      store.deleteTheTree(['bundle'])
      expect(watch.commits.length).toBeGreaterThanOrEqual(14)
      expect(watch.keyedBySession.has('events')).toBe(true)
      expect(mismatches(watch.commits, heard, watch.keyedBySession)).toEqual([])
    })

    it('a commit the record misses is caught though a later one writes the same table', () => {
      let watch!: ReturnType<typeof watchCommits>
      const { db, store } = aStore((raw) => (watch = watchCommits(raw)))
      const heard = hearCommits(store)
      create(store, 'alpha')
      db.exec("UPDATE provider_session SET cwd = '/tmp/missed' WHERE id = 'alpha'")
      store.setModel('alpha', 'fictional-model')
      expect(mismatches(watch.commits, heard)).toEqual(['3 commits observed, 2 published'])
    })

    it('a table written beside a published one in the same commit is caught', () => {
      let watch!: ReturnType<typeof watchCommits>
      const { db, store } = aStore((raw) => (watch = watchCommits(raw)))
      const heard = hearCommits(store)
      create(store, 'alpha')
      store.atomically(() => {
        store.append('alpha', 0, text('covered'), 5_000)
        db.exec("UPDATE app_policy SET updated_at = 5000 WHERE id = 'policy'")
      })
      expect(mismatches(watch.commits, heard)).toEqual(['commit 1 wrote app_policy unpublished'])
    })
  })

  it('a warmed append runs exactly the store’s own statements', () => {
    const executed: string[] = []
    const { db, store } = aStore((raw) => {
      // Installed before the store, so every statement the store or the recorder prepares is
      // counted by its text when it runs.
      const prepare = raw.prepare.bind(raw)
      Object.defineProperty(raw, 'prepare', {
        configurable: true,
        writable: true,
        value: (sql: string) => {
          const statement = prepare(sql)
          const said = sql.replace(/\s+/g, ' ').trim().slice(0, 90)
          for (const method of ['run', 'get', 'all', 'iterate'] as const) {
            const real = statement[method].bind(statement) as (...args: unknown[]) => unknown
            Object.defineProperty(statement, method, {
              configurable: true,
              writable: true,
              value: (...args: unknown[]) => {
                executed.push(said)
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
    // What the store's own append runs, and nothing of the recorder's: pinned, so a constant extra
    // query fails as surely as a varying one.
    const theStoresAppend = [
      'INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generatio',
      'SELECT active, normalizer_version, derived_through, building, highest, failure FROM derive',
      'SELECT id FROM turn WHERE session_id = ? AND generation = ? ORDER BY ordinal DESC LIMIT 1',
      'SELECT id, blocked_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS N',
      'SELECT id, blocked_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS N',
      'SELECT status FROM provider_session WHERE id = ?',
      'UPDATE provider_session SET status = ?, updated_at = ? WHERE id = ?',
    ]
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      executed.length = 0
      store.append('alpha', ordinal, text(`fictional ${ordinal}`), 5_000)
      expect([...executed].sort()).toEqual(theStoresAppend)
    }
    expect(pragma).not.toHaveBeenCalled()
  })

  describe('each act invalidates at least what its hand marks did', () => {
    /**
     * The expectation table is the pre-cutover hand marks (core `c0dbc7cf`): each act's door, the
     * rows it marked, and what the unchanged classifier did for each — recorded per act as
     * `effect:conversation:row type` (`-` for a file or a whole change). More is allowed, since the
     * record now follows doors the marks never covered; less is not.
     */
    let world: AServiceWorld
    let host: RuntimeHost
    let effects: string[]
    afterEach(async () => world.cleanUp())
    const begin = () => {
      world = aServiceWorld()
      world.anAgent('giver', 'normal')
      world.anAgent('helper', 'normal')
      world.anAgent('target', 'normal')
      host = world.aHost({ servicesOn: false, statesMoved: () => undefined })
      effects = []
      type Watched = Record<string, (...args: unknown[]) => unknown>
      const watched = host as unknown as Watched
      let row = '-'
      const follow = watched.aRowWasWritten!.bind(host)
      vi.spyOn(watched, 'aRowWasWritten').mockImplementation((...args: unknown[]) => {
        const before = row
        row = (args[1] as { rowType: string }).rowType
        try {
          return follow(...args)
        } finally {
          row = before
        }
      })
      for (const name of [
        'stateMayHaveMoved',
        'theAnswersItOwesMoved',
        'theWorkItGaveMoved',
        'itsNameMayHaveMoved',
        'filesWereKept',
      ]) {
        const real = watched[name]!.bind(host)
        vi.spyOn(watched, name).mockImplementation((...args: unknown[]) => {
          effects.push(`${name}:${String(args[0])}:${row}`)
          return real(...args)
        })
      }
    }
    const settle = async () => {
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    }
    const opensOnAuto = async (profile: string) =>
      (
        await host.createSession(
          { provider: 'claude', profileId: profile, cwd: world.folder, approvalMode: 'auto' },
          world.window,
        )
      ).sessionId

    it('a person’s turn: its words, the turn and its status move the state (deliver, recordOurs)', async () => {
      begin()
      const giver = await opensOnAuto('giver')
      await settle()
      effects.length = 0
      await host.send(giver, 'Fictional words for a turn that ends.', world.window)
      await vi.waitFor(() =>
        expect(world.ledger(giver).some((event) => event.type === 'turn')).toBe(true),
      )
      await settle()
      expect(effects).toEqual(
        expect.arrayContaining([
          `stateMayHaveMoved:${giver}:user_turn`,
          `stateMayHaveMoved:${giver}:turn`,
          `stateMayHaveMoved:${giver}:status`,
        ]),
      )
    })

    it('a give moves the owner’s name and the giver’s wait (recordTheGive)', async () => {
      begin()
      const giver = await world.aPersonOpens(host, 'giver')
      await settle()
      effects.length = 0
      const given = await world.gives(host, giver, 'helper')
      if (!given.ok) throw new Error('the give was refused')
      await settle()
      const owner = world.store.workById(given.piece)!.owner
      expect(effects).toEqual(
        expect.arrayContaining([
          `itsNameMayHaveMoved:${owner}:work_given`,
          `theWorkItGaveMoved:${giver}:work_given`,
        ]),
      )
    })

    it('a stopped move tells both conversations (the stopped-source door)', async () => {
      begin()
      const source = await world.aPersonOpens(host, 'giver')
      const target = await world.aPersonOpens(host, 'target')
      await host.send(source, 'Please check the fictional release notes.', world.window)
      const asked = await host.raiseAQuestion(
        {
          piece: null,
          question: 'The target owns this subject.',
          options: [],
          who: 'a-person',
          agent: null,
          moveTo: target,
        },
        { ownerId: agentCallerId(source) },
      )
      if (!asked.ok) throw new Error(asked.refusal.reason)
      await host.close(source, world.window)
      await host.close(target, world.window)
      await settle()
      effects.length = 0
      const ack = await host.decideMoveRequest(
        { sessionId: source, requestId: asked.question, decision: 'move' },
        world.window,
      )
      expect(ack.outcome).toBe('moved')
      await settle()
      const told = (conversation: string) =>
        effects.some(
          (one) => one.startsWith(`stateMayHaveMoved:${conversation}:`) && !one.endsWith(':-'),
        )
      expect(told(source)).toBe(true)
      expect(told(target)).toBe(true)
    })

    it('a row the store refuses still moves its live state, and no row is kept (recordOurs fallback)', async () => {
      begin()
      const giver = await world.aPersonOpens(host, 'giver')
      await settle()
      const rows = world.ledger(giver).length
      const append = vi.spyOn(world.store, 'append').mockImplementation(() => {
        throw new Error('fictional disk full')
      })
      effects.length = 0
      await host.send(giver, 'Fictional words the store refuses.', world.window).catch(() => {})
      await settle()
      append.mockRestore()
      expect(effects).toContain(`stateMayHaveMoved:${giver}:user_turn`)
      expect(world.ledger(giver).length).toBe(rows)
    })

    it('kept files and a whole import move what they name', async () => {
      begin()
      const giver = await world.aPersonOpens(host, 'giver')
      await settle()
      const piece = world.store.rootOf(giver)!.piece
      effects.length = 0
      world.store.addResource(
        {
          piece,
          role: 'made',
          title: 'Fictional notes',
          summary: null,
          name: 'notes.md',
          sha256: 'b'.repeat(64),
          bytes: 1,
          addedBy: null,
        },
        world.clock++,
      )
      world.store.importSnapshot({
        session: {
          id: 'imported',
          provider: 'claude',
          sessionId: 'fictional-imported',
          cwd: world.folder,
          profileId: 'fictional',
          updatedAt: world.clock,
          createdAt: world.clock,
        },
        derivedThrough: 0,
        ledger: [{ ordinal: 0, at: world.clock, event: text('imported') }],
      })
      await settle()
      expect(effects).toEqual(
        expect.arrayContaining([
          `filesWereKept:${piece}:-`,
          `theAnswersItOwesMoved:${giver}:-`,
          `stateMayHaveMoved:imported:-`,
        ]),
      )
    })
  })
})
