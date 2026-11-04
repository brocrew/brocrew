import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { PLUGIN_TITLE_CANDIDATES_SQL } from '../src/main/db/plugin-title-candidates'

function fixture() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE work_resource (
    id TEXT PRIMARY KEY, work_id TEXT, title TEXT, name TEXT, sha256 TEXT,
    created_at INTEGER, body TEXT
  ); CREATE INDEX work_resource_work_idx ON work_resource(work_id);`)
  const insert = db.prepare('INSERT INTO work_resource VALUES (?, ?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (let i = 0; i < 150; i++)
      for (const piece of ['fictional-piece', 'other-piece']) {
        insert.run(
          `${piece}-${i}`,
          piece,
          `Fictional guide ${i}`,
          `guide-${i}.md`,
          String(i).padStart(64, '0'),
          i,
          'Fictional body that is excluded from title context.',
        )
      }
  })()
  return db
}
it('uses an index search without sorting the full piece before applying its bound', () => {
  const db = fixture()
  try {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${PLUGIN_TITLE_CANDIDATES_SQL}`)
      .all('fictional-piece') as { detail: string }[]
    expect(plan.some((row) => /SEARCH.*USING INDEX work_resource_work_idx/.test(row.detail))).toBe(
      true,
    )
    expect(plan.some((row) => /SCAN|TEMP B-TREE/.test(row.detail))).toBe(false)
  } finally {
    db.close()
  }
})
it('returns exactly the bounded piece metadata and excludes bodies', () => {
  const db = fixture()
  try {
    const rows = db.prepare(PLUGIN_TITLE_CANDIDATES_SQL).all('fictional-piece') as Record<
      string,
      unknown
    >[]
    expect(rows).toHaveLength(100)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['id', 'name', 'sha256', 'title', 'work_id'])
      expect(row.work_id).toBe('fictional-piece')
    }
    expect(JSON.stringify(rows)).not.toContain('Fictional body')
  } finally {
    db.close()
  }
})
