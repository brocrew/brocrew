import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { committedChangesOf, type Committed } from '../src/main/db/committed-changes'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * The store records what each commit wrote, once, after the commit: the ledger rows with the facts
 * that move other conversations, whole changes, staged rebuilds and kept files. A rollback records
 * nothing, and a commit that can't be told — another connection's, or writes made after SQLite ended
 * a transaction under its caller — is one resync.
 */
describe('a commit is recorded once, after it commits', () => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  let seen: { change: Committed; inTransaction: boolean }[]
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-committed-'))
    db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db, () => 5_000)
    seen = []
    committedChangesOf(db).listen((change) =>
      seen.push({ change, inTransaction: db.inTransaction }),
    )
    for (const id of ['alpha', 'beta']) {
      store.create({ id, provider: 'claude', cwd: folder, approvalMode: 'auto', profileId: id })
    }
    seen.length = 0
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  const text = (words: string): TranscriptEvent => ({ type: 'assistant_message', text: words })
  const rowsOf = (change: Committed) =>
    change.resync ? null : change.rows.map((row) => `${row.session}:${row.ordinal}:${row.type}`)

  it('one append is one record, published after the commit', () => {
    store.append('alpha', 0, text('fictional words'), 5_000)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.inTransaction).toBe(false)
    expect(rowsOf(seen[0]!.change)).toEqual(['alpha:0:assistant_message'])
  })

  it('a run of appends is one record, in order', () => {
    store.appendMany('alpha', [
      { ordinal: 0, event: text('one'), at: 5_000 },
      { ordinal: 1, event: text('two'), at: 5_000 },
    ])
    expect(seen.map((one) => rowsOf(one.change))).toEqual([
      ['alpha:0:assistant_message', 'alpha:1:assistant_message'],
    ])
  })

  it('a rolled-back transaction records nothing', () => {
    expect(() =>
      store.atomically(() => {
        store.append('alpha', 0, text('kept nowhere'), 5_000)
        store.append('beta', 0, text('kept nowhere'), 5_000)
        throw new Error('fictional failure')
      }),
    ).toThrow('fictional failure')
    expect(seen).toEqual([])
  })

  it('a savepoint rolled back inside a commit records only what the commit kept', () => {
    store.atomically(() => {
      store.append('alpha', 0, text('kept'), 5_000)
      try {
        store.atomically(() => {
          store.append('beta', 0, text('rolled back'), 5_000)
          throw new Error('fictional inner failure')
        })
      } catch {
        // The outer transaction goes on.
      }
    })
    expect(seen.map((one) => rowsOf(one.change))).toEqual([['alpha:0:assistant_message']])
  })

  it('a row carries the facts that move another conversation', () => {
    store.append(
      'alpha',
      0,
      {
        type: 'request_routed',
        requestId: 'fictional-request',
        to: 'the-parent',
        parent: 'beta',
      } as TranscriptEvent,
      5_000,
    )
    store.append('alpha', 1, { type: 'status', state: 'ended' } as TranscriptEvent, 5_000)
    const rows = seen.flatMap((one) => (one.change.resync ? [] : one.change.rows))
    expect(rows).toMatchObject([
      { session: 'alpha', type: 'request_routed', parent: 'beta', to: 'the-parent' },
      { session: 'alpha', type: 'status', state: 'ended' },
    ])
    expect(Object.isFrozen(rows[0])).toBe(true)
  })

  it('a listener that throws changes neither the write nor the other listeners', () => {
    const others: number[] = []
    committedChangesOf(db).listen(() => {
      throw new Error('fictional listener failure')
    })
    committedChangesOf(db).listen((change) => others.push(change.commit))
    expect(() => store.append('alpha', 0, text('fictional'), 5_000)).not.toThrow()
    expect(store.events('alpha')).toHaveLength(1)
    expect(others).toHaveLength(1)
  })

  it('a commit a listener makes is delivered after the one it heard', () => {
    const order: string[] = []
    let once = true
    committedChangesOf(db).listen((change) => {
      order.push(rowsOf(change)?.join(',') ?? 'resync')
      if (once) {
        once = false
        store.append('beta', 0, text('written while hearing'), 5_000)
        order.push('wrote')
      }
    })
    store.append('alpha', 0, text('first'), 5_000)
    expect(order).toEqual(['alpha:0:assistant_message', 'wrote', 'beta:0:assistant_message'])
  })

  it('another connection’s commit is one resync, and our own commits never are', () => {
    const recorder = committedChangesOf(db)
    store.append('alpha', 0, text('ours'), 5_000)
    recorder.check()
    expect(seen.filter((one) => one.change.resync)).toEqual([])
    const other = openDatabase(join(folder, 'fixture.sqlite'))
    try {
      other
        .prepare("UPDATE provider_session SET cwd = 'fictional-elsewhere' WHERE id = 'beta'")
        .run()
    } finally {
      other.close()
    }
    recorder.check()
    recorder.check()
    expect(seen.filter((one) => one.change.resync)).toHaveLength(1)
  })

  it('an import is one whole change, with no row each', () => {
    store.importSnapshot({
      session: {
        id: 'bundle',
        provider: 'claude',
        sessionId: 'fictional-bundle',
        cwd: folder,
        profileId: 'fictional',
        updatedAt: 5_000,
        createdAt: 5_000,
      },
      derivedThrough: 0,
      ledger: Array.from({ length: 5 }, (_, ordinal) => ({ ordinal, at: 5_000, event: text('x') })),
    })
    expect(seen).toHaveLength(1)
    const change = seen[0]!.change
    if (change.resync) throw new Error('an import was not recorded')
    expect(change.rows).toEqual([])
    expect([...change.whole]).toEqual([['bundle', 'imported']])
  })

  it('a rebuild’s batches are staged, and only its promotion is a whole change', () => {
    const generation = store.beginGeneration('alpha')
    store.appendGeneration('alpha', generation, [{ ordinal: 0, event: text('rebuilt'), at: 5_000 }])
    store.appendGeneration('alpha', generation, [{ ordinal: 1, event: text('rebuilt'), at: 5_000 }])
    store.promoteGeneration('alpha', generation, { normalizerVersion: 1, derivedThrough: 2 })
    const changes = seen.map((one) => one.change)
    if (changes.some((one) => one.resync)) throw new Error('a rebuild resynced')
    const wholes = changes.flatMap((one) => (one.resync ? [] : [...one.whole]))
    expect(wholes).toEqual([
      ['alpha', 'listing'],
      ['alpha', 'promoted'],
    ])
    expect(changes.flatMap((one) => (one.resync ? [] : one.rows))).toEqual([])
    expect(changes.filter((one) => !one.resync && one.staged.has('alpha'))).toHaveLength(2)
  })

  it('a deleted tree is a whole change for each of its conversations', () => {
    store.deleteTheTree(['alpha'])
    const wholes = seen.flatMap((one) => (one.change.resync ? [] : [...one.change.whole]))
    expect(wholes).toEqual([['alpha', 'deleted']])
  })

  it('writes made after SQLite ended the transaction under its caller are one resync', () => {
    const outer = db.transaction(() => {
      db.exec('ROLLBACK')
      store.append('alpha', 0, text('committed on its own'), 5_000)
    })
    expect(() => outer()).toThrow()
    expect(store.events('alpha')).toHaveLength(1)
    expect(seen.map((one) => one.change.resync)).toEqual([true])
  })
})
