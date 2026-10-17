/**
 * Measure the cost of reading the complete waiting set as ledger history grows.
 * Hold pending work constant to distinguish cost driven by current obligations from cost
 * driven by historical events. Read the exact candidate query
 * `SELECT DISTINCT session_id FROM events WHERE type = 'request_routed'`, then each
 * conversation's routed-request rows from its first routing onward.
 *
 *   node scripts/waiting-set-probe.mjs
 *
 * Use only deterministic rows in a temporary SQLite file removed in `finally`. Its schema
 * mirrors relevant columns and indexes, without becoming an app migration. No app, provider,
 * user database or debugging port is opened.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const Database = requireDesktop('better-sqlite3')

/** ⛔ **The budget, stated before the first process** (standing rule 13). */
const MAX_MS = 240_000
const REPEATS = 5
const WARMUPS = 2

/**
 * ⛔ **The waiting set, FIXED.** Sixteen conversations owe a person something, in every run, at
 * every history size — so a cost that moves is a cost of history.
 */
const WAITING = 16
/** How much has happened. Each step multiplies the ledger, not the obligations. */
const HISTORY = [40, 400, 4_000]
/** Conversations that routed something and SETTLED it — candidates that return nothing. */
const SETTLED = 240
/** Conversations that never routed at all: the population the candidate query must skip. */
const QUIET = 240
const FILLER = 'x'.repeat(240)

const REQUEST_FOLD_TYPES = [
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'request_escalated',
  'status',
]

const DAY = 86_400_000
const NOW = 1_800_000_000_000
/** ⚑ **400 days**, so the oldest thing owed is genuinely old and not a few ticks back. */
const ANCIENT = NOW - 400 * DAY

const deadline = performance.now() + MAX_MS
function checkDeadline(step) {
  if (performance.now() > deadline) throw new Error(`NOT PERFORMED: ${step} past ${MAX_MS} ms`)
}

function quantile(samples, q) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * q) - 1]
}

function mib(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function inList(types) {
  return types.map((type) => `'${type}'`).join(',')
}

function prepareSchema(db) {
  db.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
      generation INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX events_session_ordinal_uq ON events(session_id, generation, ordinal);
    CREATE INDEX events_session_idx ON events(session_id);
    CREATE INDEX events_request_routed_idx ON events(session_id, ordinal)
      WHERE type = 'request_routed';
  `)
}

/**
 * Plant a world: `WAITING` conversations each holding one OPEN permission-shaped routing — the
 * oldest of them 400 days back — `SETTLED` that routed and closed, and `QUIET` that never routed.
 * Every conversation carries `history` events, so the ledger grows and the obligations do not.
 */
function plant(db, history) {
  const insert = db.prepare(`INSERT INTO events
    (id,session_id,ordinal,type,payload,created_at,generation) VALUES (?,?,?,?,?,?,?)`)
  let rows = 0
  const write = (sessionId, ordinal, type, at, extra = {}) => {
    insert.run(
      `${sessionId}:${ordinal}`,
      sessionId,
      ordinal,
      type,
      JSON.stringify({ filler: FILLER, ...extra }),
      at,
      0,
    )
    rows++
  }
  const fill = (sessionId, from, at) => {
    for (let ordinal = from; ordinal < from + history; ordinal++) {
      write(sessionId, ordinal, 'assistant_delta', at + ordinal)
    }
  }
  db.transaction(() => {
    for (let n = 0; n < WAITING; n++) {
      const id = `waiting-${n}`
      // ⚑ The FIRST routing is at ordinal 0, so the fold's floor admits this conversation's whole
      // request history — which is the shape that makes the read complete.
      const at = n === 0 ? ANCIENT : NOW - n * 60_000
      write(id, 0, 'request_routed', at, {
        requestId: `req-${n}`,
        to: 'a-person',
        because: 'a-permission-decision',
        parent: 'pm',
      })
      fill(id, 1, at)
    }
    for (let n = 0; n < SETTLED; n++) {
      const id = `settled-${n}`
      const at = NOW - n * 30_000
      write(id, 0, 'request_routed', at, {
        requestId: `done-${n}`,
        to: 'a-person',
        because: 'a-permission-decision',
        parent: 'pm',
      })
      write(id, 1, 'user_decision', at + 500, { requestId: `done-${n}`, outcome: 'deny' })
      fill(id, 2, at)
    }
    for (let n = 0; n < QUIET; n++) {
      const id = `quiet-${n}`
      fill(id, 0, NOW)
    }
  })()
  return rows
}

/** The exact two statements `session-store.ts` prepares for this read. */
function readers(db) {
  return {
    candidates: db.prepare(
      `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'`,
    ),
    fold: db.prepare(`SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ?
        AND type IN (${inList(REQUEST_FOLD_TYPES)})
        AND ordinal >= (SELECT min(ordinal) FROM events
                         WHERE session_id = ? AND generation = ? AND type = 'request_routed')
      ORDER BY ordinal`),
  }
}

/**
 * ⛔ **The open set, folded in JS the way `deriveRoutedRequests` decides it** — a routing with a
 * `because` and no closing row. ⚠️ **Not the real fold**, which is TypeScript and not reachable
 * from here; what it reproduces is the SHAPE of the work (one pass per candidate over the rows the
 * SQL returned) and the COUNT, which the probe asserts against what was planted.
 */
function openWaiting(rows) {
  const state = new Map()
  for (const row of rows) {
    const event = JSON.parse(row.payload)
    if (event.requestId === undefined) continue
    if (event.to !== undefined) state.set(event.requestId, event.because ?? null)
    else state.delete(event.requestId)
  }
  let open = 0
  for (const because of state.values()) if (because !== null) open++
  return open
}

function measure(db, history) {
  const { candidates, fold } = readers(db)
  const samples = []
  let seen = null
  for (let repeat = -WARMUPS; repeat < REPEATS; repeat++) {
    checkDeadline(`history=${history}`)
    const start = performance.now()
    const asked = candidates.all()
    const afterCandidates = performance.now()
    let eventRows = 0
    let waiting = 0
    for (const row of asked) {
      const rows = fold.all(row.id, 0, row.id, 0)
      eventRows += rows.length
      waiting += openWaiting(rows)
    }
    const afterFold = performance.now()
    if (repeat < 0) continue
    seen = { candidates: asked.length, eventRows, waiting }
    samples.push({
      candidates: afterCandidates - start,
      fold: afterFold - afterCandidates,
      total: afterFold - start,
    })
  }
  // ⛔ **WHY it costs what it costs, from SQLite rather than from a guess.** The fold returns
  // almost nothing per candidate; what it pays for is FINDING those rows, and the plan says
  // whether an index is doing that work.
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${fold.source}`)
    .all('waiting-0', 0, 'waiting-0', 0)
    .map((row) => row.detail)
  // ⛔ **The answer is asserted, not printed and trusted** — a probe that timed a read returning
  // the wrong set would report a cost for something nobody wants.
  assert.equal(seen.waiting, WAITING, 'the read did not return the planted waiting set')
  assert.equal(seen.candidates, WAITING + SETTLED, 'the candidate query did not skip quiet ledgers')
  const stat = (key) => ({
    p50: +quantile(
      samples.map((one) => one[key]),
      0.5,
    ).toFixed(2),
    p95: +quantile(
      samples.map((one) => one[key]),
      0.95,
    ).toFixed(2),
  })
  return {
    history,
    ...seen,
    plan,
    ms: { candidates: stat('candidates'), fold: stat('fold'), total: stat('total') },
  }
}

function runSize(history) {
  const dir = mkdtempSync(join(tmpdir(), 'brobot-waiting-set-'))
  const path = join(dir, 'synthetic.sqlite')
  let db
  try {
    db = new Database(path)
    db.pragma('journal_mode = DELETE')
    db.pragma('cache_size = -16384')
    prepareSchema(db)
    const planted = performance.now()
    const rows = plant(db, history)
    const plantMs = performance.now() - planted
    const result = measure(db, history)
    return {
      ...result,
      plantedRows: rows,
      plantMs: Math.round(plantMs),
      dbMiB: mib(statSync(path).size),
    }
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

const started = performance.now()
const results = HISTORY.map(runSize)
const oldest = ANCIENT
console.log(`\n434 · waiting-set read cost · budget ${MAX_MS / 1000}s`)
console.log(
  `waiting ${WAITING} · settled candidates ${SETTLED} · ledgers that never routed ${QUIET} · oldest owed ${new Date(oldest).toISOString().slice(0, 10)}\n`,
)
console.log(
  [
    'history/ldgr',
    'rows',
    'db MiB',
    'candidates',
    'event rows',
    'waiting',
    'cand p50',
    'fold p50',
    'total p50',
    'total p95',
  ]
    .map((head) => head.padStart(12))
    .join(''),
)
for (const row of results) {
  console.log(
    [
      row.history,
      row.plantedRows,
      row.dbMiB,
      row.candidates,
      row.eventRows,
      row.waiting,
      row.ms.candidates.p50,
      row.ms.fold.p50,
      row.ms.total.p50,
      row.ms.total.p95,
    ]
      .map((cell) => String(cell).padStart(12))
      .join(''),
  )
}
const first = results[0]
const last = results[results.length - 1]
console.log(
  `\nledger ×${(last.plantedRows / first.plantedRows).toFixed(0)} · read ×${(last.ms.total.p50 / first.ms.total.p50).toFixed(1)} · waiting set unchanged at ${WAITING}`,
)
console.log(
  `event rows read ×${(last.eventRows / first.eventRows).toFixed(1)} — the cost is HISTORY, not what is owed.`,
)
console.log('\nwhy — the fold\u2019s own query plan, per candidate:')
for (const detail of last.plan) console.log(`  ${detail}`)
console.log(`probe ${Math.round(performance.now() - started)} ms of ${MAX_MS} ms budget\n`)
