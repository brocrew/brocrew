import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { createSessionStore } from '../src/main/db/session-store'

const migrations = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url))

it.each([
  {
    type: 'instruction_proposed',
    settled: 'instruction_settled',
    id: 'askId',
    reader: 'instructionAsksWaiting',
    proposed: 'asked',
    missingId: 'an instruction row with no ask id',
  },
  {
    type: 'mcp_server_requested',
    settled: 'mcp_server_request_settled',
    id: 'requestId',
    reader: 'mcpServerRequestsWaiting',
    proposed: 'requested',
    missingId: 'an MCP server request row with no request id',
  },
] as const)('$reader reads once, reports bad rows in order and keeps healthy proposals', (kind) => {
  const db = openDatabase(':memory:')
  try {
    applyMigrations(db, migrations)
    const reads: { method: string; inTransaction: boolean }[] = []
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes(`WHERE type IN ('${kind.type}', '${kind.settled}')`)) {
        for (const method of ['all', 'get', 'iterate'] as const) {
          const read = statement[method].bind(statement)
          vi.spyOn(statement, method).mockImplementation((...args: unknown[]) => {
            reads.push({ method, inTransaction: db.inTransaction })
            return read(...args)
          })
        }
      }
      return statement
    })
    const store = createSessionStore(db, () => 1)
    const conversation = 'sess_proposals'
    store.create({
      id: conversation,
      provider: 'codex',
      cwd: tmpdir(),
      approvalMode: 'ask',
      profileId: 'test-profile',
    })
    const insert = prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
    )
    for (const [ordinal, at, payload] of [
      [10, 50, JSON.stringify({ type: kind.type, [kind.id]: 'newer' })],
      [11, 20, '{not json'],
      [12, 30, JSON.stringify({ type: kind.type, [kind.id]: 3 })],
      [13, 10, JSON.stringify({ type: kind.type, [kind.id]: 'older' })],
    ] as const) {
      insert.run(`evt_proposal_${ordinal}`, conversation, ordinal, kind.type, payload, at)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unread = rowsUnreadOnce()
    const note = vi.spyOn(unread, 'in')
    expect(store[kind.reader](unread)).toMatchObject([
      { conversation, at: 10, [kind.proposed]: { [kind.id]: 'older' } },
      { conversation, at: 50, [kind.proposed]: { [kind.id]: 'newer' } },
    ])
    expect(reads).toEqual([{ method: 'all', inTransaction: false }])
    expect(note.mock.calls).toEqual([[conversation], [conversation]])
    expect(unread.count).toBe(2)
    expect(unread.ledgersSkipped).toBe(0)
    expect(warn.mock.calls).toEqual([
      [`session ledger: ${conversation} ordinal 11 is not JSON and was skipped by a guarded read`],
      [
        `session ledger: ${conversation} ordinal 12 could not be read and was skipped (${kind.missingId})`,
      ],
    ])
    if (kind.type === 'instruction_proposed') {
      reads.length = 0
      expect(store.settleInstructionAsk('older', 'refused', { who: 'a-person' }, 60)).toBe(true)
      expect(reads).toEqual([{ method: 'all', inTransaction: true }])
      expect(store[kind.reader]()).toMatchObject([{ [kind.proposed]: { [kind.id]: 'newer' } }])
    }
  } finally {
    vi.restoreAllMocks()
    db.close()
  }
})
