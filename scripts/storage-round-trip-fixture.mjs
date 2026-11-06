// Executed only by the preserved old app's Electron-as-Node, with its own native module.
// These are synthetic SQL rows, never described as writes made by the old app's APIs.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: Object.fromEntries(
    ['app', 'database', 'scratch', 'template', 'output'].map((key) => [key, { type: 'string' }]),
  ),
})
function must(condition, message) {
  if (!condition) throw new Error(message)
}
must(
  process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    process.versions.electron &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_REPOSITORY === 'brocrew/brocrew' &&
    process.env.ROUND_TRIP_NATIVE_SEED === 'synthetic-only',
  'Native seed requires hosted arm64 packaged Electron',
)
for (const key of ['app', 'database', 'scratch', 'template', 'output'])
  must(args[key], `Missing --${key}`)
const scratch = realpathSync(args.scratch)
for (const key of ['app', 'database', 'template', 'output']) {
  const path =
    key === 'output'
      ? join(realpathSync(dirname(args[key])), args[key].split('/').at(-1))
      : realpathSync(args[key])
  const rel = relative(scratch, path)
  must(rel && !rel.startsWith('..') && !isAbsolute(rel), `${key} escaped scratch`)
}
const template = JSON.parse(readFileSync(args.template, 'utf8'))
const require = createRequire(join(resolve(args.app), 'Contents/Resources/app.asar/package.json'))
const nativePath = require.resolve('better-sqlite3')
must(nativePath.startsWith(resolve(args.app) + '/'), 'Native seed module escaped old app')
const Database = require('better-sqlite3')
const db = new Database(args.database)
const q = (s) => `"${s.replaceAll('"', '""')}"`
let payloadBytes = 0
const sourceHash = createHash('sha256')
const before = db.prepare('SELECT count(*) AS n FROM events').get().n
const schema = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
  .get()
must(
  !db.prepare("SELECT 1 FROM sqlite_master WHERE name='question_copy'").get(),
  'Seed already has F13 objects',
)
const row = db.prepare('SELECT * FROM provider_session WHERE id=?').get(template.root)
must(
  row &&
    template.question?.type === 'question_asked' &&
    template.launched?.type === 'launched' &&
    template.routing?.type === 'request_routed',
  'Missing actual-app fixture templates',
)
const cols = Object.keys(row)
const insertSession = db.prepare(
  `INSERT INTO provider_session (${cols.map(q)}) VALUES (${cols.map(() => '?')})`,
)
const insert = db.prepare(
  'INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
)
const sentinelSession = 'zzzz-round-trip-seed-0999'
const sentinelRequest = 'req_round_trip_historical_sentinel'
const sentinelEvent = 'round-trip-seed-0999-0-1'
const append = (session, generation, ordinal, payload, id) => {
  const text = JSON.stringify({ ...payload, padding: 'x'.repeat(1024) })
  payloadBytes += Buffer.byteLength(text)
  sourceHash.update(
    JSON.stringify([id, session, generation, ordinal, payload.type, text, 1700000000000]) + '\n',
  )
  insert.run(id, session, generation, ordinal, payload.type, text, 1700000000000)
}
try {
  db.pragma('foreign_keys = ON')
  db.transaction(() => {
    for (let s = 0; s < 1000; s++) {
      const session = `zzzz-round-trip-seed-${String(s).padStart(4, '0')}`
      const copy = {
        ...row,
        id: session,
        status: 'ended',
        external_ref: null,
        launched_as: null,
        agent_identity_id: null,
        parent_session_id: null,
        closed_by_the_quit_at: null,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      }
      insertSession.run(...cols.map((c) => copy[c]))
      for (let generation = 0; generation < 4; generation++) {
        for (let ordinal = 0; ordinal < 175; ordinal++) {
          // Ordinals are per generation. Exactly 70 of the 700 rows in each session are questions.
          const slot = generation * 175 + ordinal
          const id = `round-trip-seed-${String(s).padStart(4, '0')}-${generation}-${slot}`
          let payload =
            slot % 10 === 0
              ? {
                  ...template.question,
                  requestId: `req_seed_${s}_${slot}`,
                  passedUpFrom: `fixture-key-${(s + slot) % 31}`,
                }
              : { type: 'status', state: 'ended' }
          // Keep the sentinel in active generation zero, with late-session index position.
          if (s === 999 && generation === 0 && ordinal === 1)
            payload = {
              ...template.question,
              requestId: sentinelRequest,
              passedUpFrom: template.originalRequest,
            }
          if (s === 999 && generation === 0 && ordinal === 0) payload = template.launched
          if (s === 999 && generation === 0 && ordinal === 2)
            payload = { ...template.routing, requestId: sentinelRequest, to: 'a-person' }
          append(session, generation, ordinal, payload, id)
        }
      }
      append(
        session,
        0,
        1000,
        { type: 'assistant_message', text: 'Unrelated synthetic café ☕ 日本語' },
        `round-trip-nonfold-${s}`,
      )
      if (s % 25 === 0)
        process.stdout.write(
          JSON.stringify({ heartbeat: true, sessions: s, at: Date.now() }) + '\n',
        )
    }
  })()
  const eligible = db
    .prepare("SELECT count(*) AS n FROM events WHERE id LIKE 'round-trip-seed-%'")
    .get().n
  const questions = db
    .prepare(
      "SELECT count(*) AS n FROM events WHERE id LIKE 'round-trip-seed-%' AND type='question_asked'",
    )
    .get().n
  must(eligible === 700000 && questions === 70000, 'Synthetic fixture scale mismatch')
  must(
    db.prepare('PRAGMA foreign_key_check').all().length === 0,
    'Synthetic fixture foreign keys invalid',
  )
  db.pragma('wal_checkpoint(TRUNCATE)')
  const result = {
    generator: 'round-trip-large-v1',
    source: 'synthetic SQL through preserved old packaged engine',
    seed: 1700000000000,
    foldRows: eligible,
    questions,
    sessions: 1000,
    generations: 4,
    unrelatedRows: 1000,
    payloadBytes,
    sourceRowsSha256: sourceHash.digest('hex'),
    beforeEvents: before,
    afterEvents: db.prepare('SELECT count(*) AS n FROM events').get().n,
    sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get(),
    electron: process.versions.electron,
    nativePath,
    eventsSchema: schema,
    databaseBytes: statSync(args.database).size,
    sentinel: {
      session: sentinelSession,
      request: sentinelRequest,
      event: sentinelEvent,
      originalRequest: template.originalRequest,
      originalAsker: template.leaf,
      piece: template.leafPiece,
      giver: template.middle,
    },
  }
  writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
} finally {
  db.close()
}
