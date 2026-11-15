import { readStateEntry } from './skill-tree-state.mjs'
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalRow,
  recordedLineage,
  requireEvidence,
  sha256,
  verifyCheckpoint,
  rowsPreserved,
} from './upgrade-path.mjs'

/** What a copy of a data folder's database holds: integrity check, tables, keys, migrations. */
export function readDatabase(folder, file = 'brobot2.sqlite') {
  const copy = mkdtempSync(join(tmpdir(), 'upgrade-path-db-'))
  try {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(join(folder, `${file}${suffix}`))) {
        copyFileSync(join(folder, `${file}${suffix}`), join(copy, `brobot2.sqlite${suffix}`))
      }
    }
    const db = new DatabaseSync(join(copy, 'brobot2.sqlite'), { readOnly: true })
    try {
      const { migrationRows, ...read } = readOpenDatabase(db)
      return { ...read, lineage: recordedLineage(migrationRows) }
    } finally {
      db.close()
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}
export const whole = (read) => read.integrity.length === 1 && read.integrity[0] === 'ok'
export const describeDatabase = (read) => ({
  integrity: read.integrity,
  schema: read.lineage.length,
  lineage: read.lineage,
  tables: Object.fromEntries(
    Object.entries(read.tables).map(([name, rows]) => [
      name,
      {
        rows: rows.length,
        sha256: sha256(
          rows
            .map((row) => canonicalRow(row))
            .sort()
            .join('\n'),
        ),
      },
    ]),
  ),
})

function readOpenDatabase(db) {
  const integrity = db
    .prepare('PRAGMA integrity_check')
    .all()
    .map((row) => row.integrity_check)
  const names = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
  const quoted = (name) => `"${name.replace(/"/g, '""')}"`
  const tables = Object.fromEntries(
    names.map((name) => [name, db.prepare(`SELECT * FROM ${quoted(name)}`).all()]),
  )
  const keys = Object.fromEntries(
    names.map((name) => [
      name,
      db
        .prepare(`PRAGMA table_info(${quoted(name)})`)
        .all()
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name),
    ]),
  )
  const migrationRows = db
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all()
  const scalar = (name) => Number(Object.values(db.prepare(`PRAGMA ${name}`).get())[0])
  const storage = {
    pages: scalar('page_count'),
    free: scalar('freelist_count'),
    pageSize: scalar('page_size'),
    autoVacuum: scalar('auto_vacuum'),
  }
  return { integrity, tables, keys, migrationRows, storage }
}

/** Small fictional upgrade fixtures only; real-size verification must stream through the app. */
export function readCompressedCheckpoint(folder, manifest, { program, os }) {
  const limit = 64 * 1024 * 1024
  requireEvidence(
    manifest.database.compression === 'gzip' &&
      Number.isSafeInteger(manifest.database.uncompressedBytes) &&
      manifest.database.uncompressedBytes > 0 &&
      manifest.database.uncompressedBytes <= limit,
    'The in-memory checkpoint reader needs a gzip fixture no larger than64MiB.',
  )
  const asar =
    os === 'mac'
      ? join(dirname(dirname(program)), 'Resources', 'app.asar')
      : join(dirname(program), 'resources', 'app.asar')
  const isolation = mkdtempSync(join(tmpdir(), 'upgrade-gzip-reader-'))
  const code = `
    const input = JSON.parse(process.argv[1]);
    if (!process.versions.electron) throw new Error('Packaged Electron is required.');
    const Database = require('node:module').createRequire(require('node:path').join(input.asar,'package.json'))('better-sqlite3');
    const bytes = require('node:zlib').gunzipSync(require('node:fs').readFileSync(input.file), {maxOutputLength:input.limit});
    if (bytes.length !== input.bytes || require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== input.sha256)
      throw new Error('The decoded checkpoint differs from its recorded database.');
    const db = new Database(bytes);
    try { process.stdout.write(JSON.stringify({read:(${readOpenDatabase.toString()})(db),
      runtime:{pid:process.pid,program:process.execPath,electron:process.versions.electron}})); }
    finally { db.close(); }
  `
  const result = spawnSync(
    program,
    [
      '-e',
      code,
      JSON.stringify({
        asar,
        file: join(folder, manifest.database.file),
        limit,
        bytes: manifest.database.uncompressedBytes,
        sha256: manifest.database.uncompressedSha256,
      }),
      '--brobot-hidden',
      `--user-data-dir=${isolation}`,
      '--remote-debugging-port=0',
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    },
  )
  requireEvidence(
    result.status === 0 && !result.error,
    `The packaged checkpoint reader failed: ${result.error?.message ?? result.stderr ?? result.signal}; pid=${result.pid}, retained=${isolation}`,
  )
  const reply = JSON.parse(result.stdout, (_key, value) =>
    value?.type === 'Buffer' && Array.isArray(value.data) ? Uint8Array.from(value.data) : value,
  )
  requireEvidence(
    typeof reply.runtime?.electron === 'string' &&
      realpathSync(reply.runtime.program) === realpathSync(program),
    'The checkpoint reader did not run under the selected packaged Electron.',
  )
  rmSync(isolation, { recursive: true, force: true })
  const { migrationRows, ...read } = reply.read
  return { ...read, lineage: recordedLineage(migrationRows), reader: reply.runtime }
}

export function verifyFixtureCheckpoint({
  data,
  made,
  baseline,
  state,
  stateFiles,
  reason,
  version,
  source,
  program: installedProgram,
  os,
  prefix,
  keep,
}) {
  const folder = join(data, 'backups', made)
  requireEvidence(existsSync(join(folder, 'manifest.json')), 'The copy has no manifest.')
  const markerLeft = existsSync(join(folder, 'unfinished'))
  requireEvidence(!markerLeft, 'The copy still carries its unfinished marker.')
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  keep(`${prefix}-manifest.json`, manifest)
  const files = { 'database.sqlite': readFileSync(join(folder, 'database.sqlite')) }
  for (const name of stateFiles) {
    if (existsSync(join(folder, name))) files[name] = readStateEntry(join(folder, name))
  }
  const workspaceIdFile = join(data, 'backups', 'workspace-id')
  const checked = verifyCheckpoint(manifest, files, {
    folder: made,
    workspaceId: existsSync(workspaceIdFile) ? readFileSync(workspaceIdFile, 'utf8').trim() : null,
    reason,
    version,
    build: source,
    lineage: baseline.lineage,
    stateFiles,
    state,
  })
  const inTheCopy =
    manifest.database.compression === 'gzip'
      ? readCompressedCheckpoint(folder, manifest, { program: installedProgram, os })
      : readDatabase(folder, 'database.sqlite')
  if (inTheCopy.reader) keep(`${prefix}-reader.json`, inTheCopy.reader)
  requireEvidence(
    whole(inTheCopy),
    `The copy's database is not whole: ${inTheCopy.integrity.join('; ')}`,
  )
  const compared = rowsPreserved(baseline.tables, inTheCopy.tables, {}, baseline.keys)
  requireEvidence(
    compared.lost.length === 0 && Object.keys(compared.added).length === 0,
    `The copy's rows are not the beta's: ${JSON.stringify(compared).slice(0, 1_000)}`,
  )
  return checked
}
