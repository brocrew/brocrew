import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  WorkSearchPageBudget,
  workSearchMaterialization,
  workSearchUnread,
} from '../src/main/db/bounded-work-search'
import { rowsUnreadOnce } from '../src/main/db/session-store'

const rows =
  'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < ?) SELECT x FROM n'

describe('the search bounds every reused owner and its own completeness', () => {
  it('keeps a shared unread wait dependency local to each owner while reporting it once', () => {
    for (const order of [
      ['A', 'B'],
      ['B', 'A'],
    ]) {
      const page = rowsUnreadOnce()
      const owners = order.map(() => workSearchUnread(page))
      for (const owner of owners) owner.in('shared-child')(7)
      expect(page.count).toBe(1)
      expect(owners.map((owner) => owner.count)).toEqual([1, 1])
      for (const owner of owners) owner.in('shared-wait')('the-whole-ledger')
      expect(page.ledgersSkipped).toBe(1)
      expect(owners.map((owner) => owner.ledgersSkipped)).toEqual([1, 1])
      const complete = workSearchUnread(page)
      expect(complete.count + complete.ledgersSkipped).toBe(0)
      expect(page.count + page.ledgersSkipped).toBe(2)
    }
  })

  it('holds the 50000 page limit when other owners consume room before the first owner returns', () => {
    const db = new Database(':memory:')
    try {
      const page = new WorkSearchPageBudget()
      const first = workSearchMaterialization(page)
      expect(first.database(db).prepare('SELECT 1 AS x').get()).toEqual({ x: 1 })
      for (let owner = 0; owner < 5; owner++) {
        const separate = workSearchMaterialization(page)
        expect(separate.database(db).prepare(rows).all(9999)).toHaveLength(9999)
      }
      expect(page.returnedRows).toBe(49996)
      expect(first.database(db).prepare(rows).all(4)).toHaveLength(4)
      expect(first.measured().rows).toBe(5)
      expect(page.returnedRows).toBe(50000)
      expect(() => first.database(db).prepare('SELECT 1 AS x').get()).toThrow()
      expect(page.overflowed).toBe(true)
      expect(page.returnedRows).toBe(50000)
      const nextPage = new WorkSearchPageBudget()
      expect(workSearchMaterialization(nextPage).database(db).prepare(rows).all(4)).toHaveLength(4)
      expect(nextPage.returnedRows).toBe(4)
    } finally {
      db.close()
    }
  })

  it('checks the running fold clock between returned rows', () => {
    const db = new Database(':memory:')
    let reads = 0
    const page = new WorkSearchPageBudget(() => ++reads > 3)
    try {
      expect(() => page.database(db).prepare(rows).all(20)).toThrow()
      expect(page.returnedRows).toBe(3)
      expect(page.overflowed).toBe(true)
    } finally {
      db.close()
    }
  })

  it('allows 10000 ledger rows and refuses the next independently of the page budget', () => {
    const db = new Database(':memory:')
    try {
      const page = new WorkSearchPageBudget()
      const ledger = workSearchMaterialization(page)
      expect(ledger.database(db).prepare(rows).all(10000)).toHaveLength(10000)
      expect(page.returnedRows).toBe(10000)
      expect(() => ledger.database(db).prepare('SELECT 1 AS x').get()).toThrow()
      expect(page.returnedRows).toBe(10000)
      expect(() => ledger.assert()).toThrow()
    } finally {
      db.close()
    }
  })

  it('enforces 16 MiB of ledger materialization across individually small cells', () => {
    const db = new Database(':memory:')
    try {
      const ledger = workSearchMaterialization()
      const value = 'x'.repeat(256 * 1024)
      const rowBytes = Buffer.byteLength('payload') + 16 + Buffer.byteLength(value)
      const fits = Math.floor((16 * 1024 * 1024) / rowBytes)
      expect(fits).toBe(63)
      const statement = ledger.database(db).prepare('SELECT ? AS payload')
      for (let index = 0; index < fits; index++)
        expect(statement.get(value)).toEqual({ payload: value })
      expect(ledger.measured().bytes).toBe(rowBytes * 63)
      expect(() => statement.get(value)).toThrow()
      expect(() => ledger.assert()).toThrow()
    } finally {
      db.close()
    }
  })
})
