import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
  writeFileSync,
  constants,
  realpathSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { once } from 'node:events'
import { digest, measurementFilesystem, joinMeasurementChild } from './mac-update-test.mjs'
import { until } from './update-rehearsal-app.mjs'
import { readStateEntry } from './skill-tree-state.mjs'
import {
  requireEvidence,
  makeEarlierMigrationFixture,
  makeMigrationFixture,
  recoveryCopies,
  stateFileNames,
  stateKept,
  verifyCheckpoint,
  startOrder,
  recordedLineage,
  CHECKPOINT_LINE,
} from './upgrade-path.mjs'

export function retainRecoveryProgram(installed, { os, run }) {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-old-'))
  if (os === 'mac') {
    const exe = join(root, basename(installed.exe))
    run('/usr/bin/ditto', ['--rsrc', '--extattr', installed.exe, exe])
    return {
      ...installed,
      exe,
      program: join(exe, relative(installed.exe, installed.program)),
      root,
    }
  }
  cpSync(dirname(installed.program), root, { recursive: true })
  const program = join(root, basename(installed.program))
  return { ...installed, exe: program, program, root }
}

export async function proofManifests(folder) {
  return (await recoveryCopies(folder, { digestFiles: false }))
    .filter((one) => one.manifest)
    .map((one) => ({
      folder: join(folder, 'backups', one.folder),
      manifest: one.manifest,
    }))
}

export async function completedProofCopy(folder, ids) {
  return until(
    async () => (await proofManifests(folder)).find((one) => !ids.has(one.manifest.id)) ?? null,
    600_000,
    100,
  )
}

export function cloneMeasurementFile(from, to) {
  requireEvidence(process.platform === 'darwin', 'Native measurement cloning requires Darwin.')
  // Node's forced FICLONE is unavailable here; call clonefile without a copy fallback.
  const result = spawnSync(
    '/usr/bin/python3',
    [
      '-c',
      `
import ctypes, errno, json, os, sys
try:
    clone = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True).clonefile
    clone.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
    clone.restype = ctypes.c_int
    if clone(os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2]), 0) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))
    print(json.dumps({'cloned': True}))
except (OSError, AttributeError) as error:
    number = getattr(error, 'errno', None) or errno.ENOSYS
    print(json.dumps({'errno': number, 'code': errno.errorcode.get(number), 'message': str(error)}))
    sys.exit(1)
`,
      from,
      to,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
  if (result.error) throw result.error
  if (!result.stdout.trim()) throw new Error(`clonefile process failed: ${result.stderr.trim()}`)
  const facts = JSON.parse(result.stdout)
  if (result.status !== 0 || facts.cloned !== true)
    throw Object.assign(
      new Error(`clonefile failed: ${facts.message ?? result.stderr.trim()}`),
      facts,
    )
}

export function measurementSize(value) {
  const bytes = Number(value)
  requireEvidence(
    /^\d+$/.test(String(value)) && Number.isSafeInteger(bytes),
    'Measurement ceiling must be a nonnegative safe decimal integer.',
  )
  return bytes
}

export function seedMeasurementDatabase(
  db,
  { journal, sqlOf, bytes, earlier = false, beforeBatch },
) {
  const lineage = earlier
    ? makeEarlierMigrationFixture(db, journal, sqlOf)
    : makeMigrationFixture(db, journal.entries, sqlOf)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
  const session = db.prepare(
    "INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at) VALUES (?, 'claude', '.', 'ended', 1, 1)",
  )
  for (const id of ['measurement-oracle', 'measurement-bulk']) session.run(id)
  const insert = db.prepare(
    'INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation) VALUES (?, ?, ?, ?, ?, ?, 0)',
  )
  insert.run(
    'measurement-first',
    'measurement-oracle',
    0,
    'assistant_message',
    JSON.stringify({ type: 'assistant_message', text: 'Fictional measurement first answer.' }),
    1,
  )
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size)
  const size = () => Number(db.prepare('PRAGMA page_count').get().page_count) * pageSize
  let rows = 0
  let batches = 0
  let maxBatchBytes = 0
  while (size() < bytes) {
    beforeBatch?.()
    db.exec('BEGIN')
    let batchBytes = 0
    try {
      for (let n = 0; n < 1024; n++) {
        const type = rows % 2 === 0 ? 'user_turn' : 'assistant_message'
        const text = `Fictional measurement row${rows}: ${'café sample '.repeat(40 + (rows % 100))}`
        const payload = JSON.stringify({ type, text })
        const length = Buffer.byteLength(payload)
        if (batchBytes + length > 2 * 1024 * 1024) break
        insert.run(`measurement-${rows}`, 'measurement-bulk', rows, type, payload, rows + 2)
        rows++
        batchBytes += length
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    batches++
    maxBatchBytes = Math.max(maxBatchBytes, batchBytes)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    requireEvidence(
      size() <= bytes + 32 * 1024 * 1024,
      'The populated fixture overshot its size budget.',
    )
  }
  return { lineage, bytes: size(), pageSize, rows, batches, maxBatchBytes }
}

export function measurementFacts(db) {
  return {
    lineage: recordedLineage(
      db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all(),
    ),
    pages: db.prepare('PRAGMA page_count').get().page_count,
    pageSize: db.prepare('PRAGMA page_size').get().page_size,
    freePages: db.prepare('PRAGMA freelist_count').get().freelist_count,
    rows: db.prepare('SELECT count(*) AS n FROM events').get().n,
    bulk: db
      .prepare(
        "SELECT count(*) AS rows, min(ordinal) AS first, max(ordinal) AS last, sum(length(payload)) AS payloadCharacters FROM events WHERE session_id='measurement-bulk'",
      )
      .get(),
    needles: db
      .prepare(
        "SELECT id, session_id, ordinal, payload FROM events WHERE id IN ('measurement-first', 'measurement-wal') ORDER BY id",
      )
      .all(),
    objects: db
      .prepare('SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC')
      .all(),
  }
}

const HEADROOM = 10_000_000_000
const OVERSHOOT = 32 * 1024 * 1024
const STATE_AND_WAL = 64 * 1024 * 1024
const measurementError = (error) => ({
  code: error.code ?? null,
  errno: error.errno ?? null,
  signal: error.signal ?? null,
  message: error.message,
})
const freeAt = (root) => {
  const { bavail, bsize } = statfsSync(root)
  return bavail * bsize
}

export function requireMeasurementCapacity({ bytes, free, filesystem, cloned }) {
  requireEvidence(
    filesystem === 'apfs' && cloned,
    'Measurement needs APFS and a successful FORCE clone.',
  )
  requireEvidence(
    free >= 3 * (bytes + OVERSHOOT) + HEADROOM + STATE_AND_WAL,
    'Post-build space is below the live/copy/migration-rebuild measurement budget.',
  )
}

export function measurementSizes(ceiling, free) {
  const maximum = Math.min(
    ceiling,
    Math.floor((free - HEADROOM - 2 * STATE_AND_WAL) / 3) - OVERSHOOT,
  )
  requireEvidence(maximum >= 8 * 1024 * 1024, 'No populated fixture fits above the10GB free floor.')
  return [...new Set([Math.max(8 * 1024 * 1024, Math.floor(maximum / 4)), maximum])]
}

export function measurementOrder(log, record, { background, checkpointLine, confirmed }) {
  return startOrder(log, {
    checkpoint: true,
    checkpointLine,
    completion: background
      ? record.manifestAbsent
        ? 'background'
        : 'functional-background'
      : 'before-ready',
    observation: {
      launched: record.launched,
      responsive: record.responsive,
      absent: record.absent,
      completed: record.manifestAbsent ? record.completed.at : confirmed,
      manifestAbsent: record.manifestAbsent,
    },
  })
}

function allocation(root) {
  let logical = 0
  let fileBlocks = 0
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      const stat = lstatSync(file)
      if (stat.isDirectory()) walk(file)
      else if (stat.isFile()) {
        logical += stat.size
        fileBlocks += stat.blocks * 512
      }
    }
  }
  walk(root)
  return { free: freeAt(root), logical, fileBlocks, at: performance.now() }
}

export async function compareMeasurementCopies({ file, fs, root, signal, comparisons = [] }) {
  const original = await digest(file),
    size = lstatSync(file).size
  for (const path of ['production-adapter', 'portable-copy']) {
    requireEvidence(
      freeAt(root) >= HEADROOM + STATE_AND_WAL,
      'No comparison fits above the10GB floor.',
    )
    const owned = mkdtempSync(join(root, `comparison-${path}-`)),
      destination = join(owned, 'database.sqlite')
    const record = { path, bytes: size, before: allocation(root), callerAdmission: false }
    let cleanupFailure = null
    comparisons.push(record)
    const admit = () => {
      requireEvidence(
        freeAt(root) >= size + HEADROOM + STATE_AND_WAL,
        'The copy lacks space above the10GB floor.',
      )
      record.callerAdmission = true
    }
    try {
      admit()
      signal?.throwIfAborted()
      record.started = performance.now()
      if (path === 'production-adapter')
        await fs.cloneFile(file, destination, signal, () => {
          record.adapterAdmission = true
          admit()
        })
      else await fs.copyFile(file, destination, constants.COPYFILE_EXCL)
      record.finished = performance.now()
      record.elapsedMs = record.finished - record.started
      record.afterCopy = allocation(root)
      requireEvidence(record.afterCopy.free >= HEADROOM, 'The copy crossed the10GB free floor.')
      signal?.throwIfAborted()
      const handle = await fs.open(destination, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      record.fsynced = performance.now()
      record.validationStarted = performance.now()
      requireEvidence(
        (await digest(destination)) === original,
        'The comparison copy differs from the populated source.',
      )
      const copy = new DatabaseSync(destination)
      try {
        copy.exec('CREATE TABLE measurement_copy_independence (fictional INTEGER)')
      } finally {
        copy.close()
      }
      requireEvidence(
        (await digest(file)) === original,
        'Mutating the comparison changed its source.',
      )
      record.validationFinished = performance.now()
      record.correct = true
    } catch (error) {
      record.error = measurementError(error)
      throw error
    } finally {
      try {
        await fs.rm(owned, { recursive: true, force: true })
      } catch (error) {
        record.cleanupError = measurementError(error)
        cleanupFailure = error
      }
      record.cleanupVerified = !existsSync(owned)
    }
    if (cleanupFailure) throw cleanupFailure
  }
  return comparisons
}

async function embeddedCopyComparisons(input) {
  const result = {
    source: input.source,
    kind: input.file ? 'copy-comparison' : 'runtime-prerequisite-only',
    success: false,
    clock: 'Embedded process monotonic clock; application trials use the parent clock.',
    runtime: {
      executable: process.execPath,
      electron: process.versions.electron,
      node: process.versions.node,
      uv: process.versions.uv,
      arch: process.arch,
      platform: process.platform,
    },
    filesystemCommands: [],
  }
  const abort = new AbortController(),
    stop = () => abort.abort()
  process.once('SIGTERM', stop)
  try {
    requireEvidence(
      process.platform === 'darwin' &&
        process.versions.electron &&
        realpathSync(process.execPath) === realpathSync(input.program),
      'Actual packaged Darwin Electron is required.',
    )
    const gitOptions = { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }
    const head = spawnSync('git', ['-C', input.repo, 'rev-parse', 'HEAD'], gitOptions)
    requireEvidence(
      head.status === 0 && head.stdout.trim() === input.source,
      'Comparison checkout source differs.',
    )
    const clean = spawnSync(
      'git',
      [
        '-C',
        input.repo,
        'diff',
        '--quiet',
        'HEAD',
        '--',
        'apps/desktop/src/main/recovery',
        'packages/runtime/src',
      ],
      gitOptions,
    )
    requireEvidence(clean.status === 0, 'Comparison recovery source is not the committed source.')
    const app = join(dirname(dirname(process.execPath)), 'Resources/app.asar')
    const main = readFileSync(join(app, 'out/main/index.js'))
    result.build = {
      version: JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version,
      mainSha256: createHash('sha256').update(main).digest('hex'),
    }
    requireEvidence(
      result.build.version === input.version && main.includes(Buffer.from(input.source)),
      'Comparison packaged build/source differs.',
    )
    result.filesystem = measurementFilesystem(input.root, result.filesystemCommands)
    requireEvidence(
      (result.filesystem.FilesystemType ?? result.filesystem.TypeBundle) === 'apfs',
      'Comparison needs actual APFS.',
    )
    const desktop = join(input.repo, 'apps/desktop')
    const vite = await import(
      pathToFileURL(join(desktop, 'node_modules/vite/dist/node/index.js')).href
    )
    const adapter = join(desktop, 'src/main/recovery/files.ts')
    const { module } = await vite.runnerImport(adapter, {
      configFile: false,
      root: desktop,
      logLevel: 'error',
    })
    result.adapterSha256 = await digest(adapter)
    result.binding =
      'Matching committed source RecoveryFs under packaged Electron; not private bundled exports. cp success is not physical clone proof.'
    result.comparisons = []
    if (input.file)
      await compareMeasurementCopies({
        ...input,
        fs: module.nodeFs,
        signal: abort.signal,
        comparisons: result.comparisons,
      })
    abort.signal.throwIfAborted()
    result.success = true
  } catch (error) {
    result.failure = measurementError(error)
    process.exitCode = 1
  } finally {
    process.removeListener('SIGTERM', stop)
    writeFileSync(input.output, `${JSON.stringify(result, null, 2)}\n`)
  }
}

export async function packagedCopyComparisons(input, { launch = spawn, ...lifetime } = {}) {
  input = {
    ...input,
    next: undefined,
    repo: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    program: input.next.program,
    output: join(input.root, 'adapter-comparison.json'),
  }
  const child = launch(
    input.program,
    [fileURLToPath(import.meta.url), '--embedded-copy-comparison', JSON.stringify(input)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let launchError = null,
    output = ''
  child.on('error', (error) => {
    launchError = measurementError(error)
  })
  child.stdout?.on('data', (part) => {
    output = (output + part.toString()).slice(-8000)
  })
  child.stderr?.on('data', (part) => {
    output = (output + part.toString()).slice(-8000)
  })
  const ended = await joinMeasurementChild(child, lifetime)
  const result = existsSync(input.output) ? JSON.parse(readFileSync(input.output, 'utf8')) : {}
  Object.assign(result, {
    child: { pid: child.pid, ...ended, launchError, output },
  })
  if (ended.timedOut || ended.cancelled || ended.code !== 0 || launchError) result.success = false
  writeFileSync(input.output, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

const WAL_WRITER = `
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[1]);
db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA synchronous=FULL; BEGIN');
const insert = db.prepare('INSERT INTO events (id,session_id,ordinal,type,payload,created_at,generation) VALUES (?, ?, ?, ?, ?, ?, 0)');
for (let i=0; i<8192; i++) {
  const last=i===8191;
  insert.run(last?'measurement-wal':'measurement-tail-'+i,'measurement-oracle',i+1,'assistant_message',JSON.stringify({type:'assistant_message',text:last?'Fictional WAL final answer.':'Fictional committed tail '+i+' '+ 'sample '.repeat(140)}),i+3);
}
db.exec('COMMIT');
console.log(JSON.stringify({pid:process.pid,committed:true}));
setInterval(()=>{},1000);
`

export async function leaveMeasurementWal(file) {
  const reset = new DatabaseSync(file)
  try {
    reset.exec(
      "DELETE FROM events WHERE id='measurement-wal' OR (id >= 'measurement-tail-' AND id < 'measurement-tail.'); PRAGMA wal_checkpoint(TRUNCATE)",
    )
  } finally {
    reset.close()
  }
  const child = spawn(process.execPath, ['--input-type=module', '-e', WAL_WRITER, file], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let problem = ''
  let spawnError = null
  child.on('error', (error) => {
    spawnError = error
  })
  child.stdout.on('data', (part) => {
    output += part.toString()
  })
  child.stderr.on('data', (part) => {
    problem = (problem + part.toString()).slice(-4000)
  })
  try {
    const ready = await until(
      () => {
        if (spawnError) throw spawnError
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`The WAL seeder ended before committing: ${problem}`)
        return output.includes('\n') ? JSON.parse(output.trim()) : null
      },
      60_000,
      50,
    )
    requireEvidence(
      ready?.committed && ready.pid === child.pid,
      'The owned WAL seeder did not acknowledge its committed state.',
    )
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      // Stop this owned writer without checkpointing away its committed WAL tail.
      const ended = once(child, 'exit')
      child.kill('SIGKILL')
      await ended
    }
  }
  requireEvidence(
    lstatSync(`${file}-wal`).size <= 64 * 1024 * 1024,
    'The WAL fixture exceeded its64MiB budget.',
  )
  const probe = `${file}.main-only`
  cloneMeasurementFile(file, probe)
  const main = new DatabaseSync(probe, { readOnly: true })
  try {
    requireEvidence(
      !main.prepare("SELECT id FROM events WHERE id='measurement-wal'").get(),
      'The final needle was already in the main database.',
    )
  } finally {
    main.close()
    rmSync(probe)
  }
  return readMeasurementFacts(file)
}

function readMeasurementFacts(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return measurementFacts(db)
  } finally {
    db.close()
  }
}

function seedState(root) {
  writeFileSync(
    join(root, 'drafts.json'),
    JSON.stringify({
      version: 1,
      drafts: [
        { slot: 'session:measurement-oracle', text: 'Fictional measurement draft.', attached: [] },
      ],
    }),
  )
  writeFileSync(
    join(root, 'workspace.json'),
    JSON.stringify({ name: 'Fictional measurement workspace' }),
  )
  const skill = join(root, 'skills', 'measurement-support')
  mkdirSync(skill, { recursive: true })
  writeFileSync(
    join(skill, 'SKILL.md'),
    '---\nname: measurement-support\ndescription: Fictional measurement support.\n---\nFictional fixture support.\n',
  )
  writeFileSync(
    join(skill, 'support.txt'),
    'Fictional support data.\n'.repeat(Math.ceil((28 * 1024 * 1024) / 23)),
  )
}

function stateAt(root, names) {
  return Object.fromEntries(
    names
      .filter((name) => existsSync(join(root, name)))
      .map((name) => [name, readStateEntry(join(root, name))]),
  )
}

export async function checkedProofCopy(
  copy,
  expected,
  state,
  stateFiles,
  assert = requireEvidence,
) {
  assert(copy !== null, 'A real completed v1 manifest was published.')
  const files = Object.fromEntries(
    stateFiles
      .filter((name) => existsSync(join(copy.folder, name)))
      .map((name) => [name, readStateEntry(join(copy.folder, name))]),
  )
  const file = join(copy.folder, 'database.sqlite')
  const databaseDigest = { bytes: lstatSync(file).size, sha256: await digest(file) }
  const checked = verifyCheckpoint(copy.manifest, files, {
    ...expected,
    folder: basename(copy.folder),
    stateFiles,
    state,
    workspaceId: readFileSync(join(dirname(copy.folder), 'workspace-id'), 'utf8').trim(),
    databaseDigest,
  })
  return { ...checked, manifest: copy.manifest, observedDatabase: databaseDigest }
}

async function validateCopy(copy, expected, state, names) {
  const checked = await checkedProofCopy(copy, expected, state, names)
  const facts = readMeasurementFacts(join(copy.folder, 'database.sqlite'))
  requireEvidence(
    facts.needles.some((row) => row.id === 'measurement-wal'),
    'The copied database lost the committed WAL needle.',
  )
  return { ...checked, folder: copy.folder, facts }
}

async function runMeasurementSize({ bytes, old, next, source, version, migrations, app, keep }) {
  requireEvidence(bytes > 0, 'Measurement needs a positive populated size.')
  const root = mkdtempSync(join(tmpdir(), 'card214-measure-'))
  const result = {
    root,
    bytes,
    source,
    version,
    trials: [],
    conditions: 'Sequential; cache state unpurged and not claimed cold.',
    allocationMeaning:
      'fileBlocks sums per-file allocation and may count shared extents repeatedly; free space is observed separately.',
    baseline: { root: old.root, program: old.program, facts: old.facts },
    samplingMs: 100,
    fixtureClone:
      'Darwin clonefile via Python; fixture/probe/reset only, not production cp evidence.',
    filesystemCommands: [],
  }
  const names = stateFileNames(
    readFileSync(join(migrations, '../../recovery/state-files.ts'), 'utf8'),
  )
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
  const sqlOf = (tag) => readFileSync(join(migrations, `${tag}.sql`), 'utf8')
  const workspace = join(root, 'case')
  let success = false
  try {
    const fs = measurementFilesystem(root, result.filesystemCommands)
    const probe = join(root, 'clone-probe')
    writeFileSync(probe, 'Fictional clone probe.')
    cloneMeasurementFile(probe, `${probe}.clone`)
    requireMeasurementCapacity({
      bytes,
      free: freeAt(root),
      filesystem: fs.FilesystemType ?? fs.TypeBundle,
      cloned: true,
    })
    rmSync(probe)
    rmSync(`${probe}.clone`)
    result.admission = { filesystem: fs, ...allocation(root) }
    result.runtimePreflight = await packagedCopyComparisons({ next, source, version, root })
    requireEvidence(
      result.runtimePreflight.success && result.runtimePreflight.child.code === 0,
      'Packaged runtime/Vite/source prerequisite failed before populated seeding.',
    )
    mkdirSync(workspace)
    const seed = (earlier) => {
      const db = new DatabaseSync(join(workspace, 'brobot2.sqlite'))
      try {
        return seedMeasurementDatabase(db, {
          journal,
          sqlOf,
          bytes,
          earlier,
          beforeBatch: () =>
            requireEvidence(
              freeAt(root) >= bytes + HEADROOM + STATE_AND_WAL,
              'Seeding would consume the next required database budget.',
            ),
        })
      } finally {
        db.close()
      }
    }
    const baselineSeed = seed(false)
    seedState(workspace)
    result.copyComparisons = await packagedCopyComparisons({
      next,
      source,
      version,
      root,
      file: join(workspace, 'brobot2.sqlite'),
    })
    requireEvidence(
      result.copyComparisons.success && result.copyComparisons.child.code === 0,
      'The packaged adapter comparison failed; retained JSON has its actual prerequisite/error.',
    )
    const baselineWal = await leaveMeasurementWal(join(workspace, 'brobot2.sqlite'))
    requireEvidence(
      baselineWal.needles.some((row) => row.id === 'measurement-wal'),
      'The seeded complete family lacks its WAL needle.',
    )
    result.seed = { ...baselineSeed, facts: baselineWal, allocation: allocation(root) }
    requireEvidence(
      freeAt(root) >= baselineSeed.bytes + HEADROOM + STATE_AND_WAL,
      'There is no measured space for the baseline copy.',
    )

    const trial = async (program, label, lineage, background, expectedFacts) => {
      const checkpointLine =
        program === old
          ? 'BroCrew made a checked recovery copy before changing its data.'
          : CHECKPOINT_LINE
      const ids = new Set((await proofManifests(workspace)).map((one) => one.manifest.id))
      const state = stateAt(workspace, names)
      requireEvidence(
        freeAt(root) >=
          expectedFacts.pages *
            expectedFacts.pageSize *
            (label === 'candidate-synchronous' ? 2 : 1) +
            HEADROOM +
            STATE_AND_WAL,
        'The next application phase lacks a full-copy budget above10GB.',
      )
      const record = {
        label,
        path:
          program === old
            ? 'actual019 recovery flow'
            : 'actual candidate recovery flow; cp-c may full-copy',
        before: allocation(root),
        observed: [],
        completed: null,
      }
      result.trials.push(record)
      let sampleError = null
      let rejectStorage
      const storageFailed = new Promise((_resolve, reject) => {
        rejectStorage = reject
      })
      let pending = Promise.resolve()
      let busy = false
      const sample = () => {
        if (busy || sampleError) return
        busy = true
        pending = (async () => {
          const at = performance.now()
          const free = freeAt(root)
          requireEvidence(
            free >= HEADROOM + OVERSHOOT,
            'Unbudgeted allocation reached the measurement stop margin.',
          )
          const copies = await proofManifests(workspace)
          const completed = copies.find((one) => !ids.has(one.manifest.id))
          if (completed && !record.completed)
            record.completed = { at: performance.now(), copy: completed }
          const backups = join(workspace, 'backups')
          let captured = false
          if (existsSync(backups))
            for (const folder of readdirSync(backups, { withFileTypes: true })) {
              if (!folder.isDirectory() || ids.has(folder.name)) continue
              const marker = join(backups, folder.name, 'unfinished')
              try {
                const text = readFileSync(marker, 'utf8')
                if (text.trim()) captured ||= JSON.parse(text).database?.file === 'database.sqlite'
              } catch (error) {
                if (error.code !== 'ENOENT') throw error
              }
            }
          record.observed.push({ at, free, captured, completed: Boolean(completed) })
        })()
          .catch((error) => {
            sampleError = error
            rejectStorage(error)
          })
          .finally(() => {
            busy = false
          })
      }
      const timer = setInterval(sample, 100)
      sample()
      let running
      try {
        running = await Promise.race([
          app.start(program, workspace, `${bytes}-${label}`, 9364),
          storageFailed,
        ])
        const info = await running.cdp.evaluate('return await window.api.getAppInfo()')
        record.launched = running.launchedMono
        record.responsive = performance.now()
        requireEvidence(
          info.version === (program === old ? '0.2.19' : version),
          'The measured binary version is not the intended one.',
        )
        if (program !== old)
          requireEvidence(info.build?.commit === source, 'The measured candidate source differs.')
        record.manifestAbsent = !(await proofManifests(workspace)).some(
          (one) => !ids.has(one.manifest.id),
        )
        record.absent = performance.now()
        const completed = await until(
          () => {
            if (sampleError) throw sampleError
            return record.completed
          },
          900_000,
          100,
        )
        requireEvidence(completed, 'No completed v1 was observed within the measurement budget.')
        record.confirmedCompletionAt = performance.now()
        await until(() => readFileSync(running.log, 'utf8').includes(checkpointLine), 10_000, 100)
        record.order = measurementOrder(readFileSync(running.log, 'utf8'), record, {
          checkpointLine,
          background,
          confirmed: record.confirmedCompletionAt,
        })
        record.windowMs = record.responsive - record.launched
        record.publicationObservedMs = completed.at - record.launched
        record.remainingAfterWindowMs = record.manifestAbsent
          ? completed.at - record.responsive
          : null
        record.publicationMinusWindowObservedMs = completed.at - record.responsive
        record.captureObserved = record.observed.find((one) => one.captured)?.at ?? null
        clearInterval(timer)
        await pending
        if (sampleError) throw sampleError
        requireEvidence(await app.quit(label), 'The measured application did not close normally.')
        record.after = allocation(root)
        record.validationStarted = performance.now()
        record.copy = await validateCopy(
          completed.copy,
          {
            reason:
              label === 'candidate-synchronous' ? 'before-migration' : 'first-start-of-release',
            version: program === old ? '0.2.19' : version,
            build: info.build?.commit,
            lineage,
          },
          state,
          names,
        )
        if (program !== old)
          requireEvidence(
            completed.copy.manifest.madeBy.build === source,
            'The completed copy has another source identity.',
          )
        const live = readMeasurementFacts(join(workspace, 'brobot2.sqlite'))
        requireEvidence(
          JSON.stringify(live.lineage) === JSON.stringify(baselineSeed.lineage),
          'The measured candidate did not apply the actual remaining migration.',
        )
        requireEvidence(
          record.copy.facts.rows === expectedFacts.rows && live.rows >= expectedFacts.rows,
          'A measured startup lost fixture event rows.',
        )
        for (const facts of [record.copy.facts, live]) {
          requireEvidence(
            JSON.stringify(facts.bulk) === JSON.stringify(expectedFacts.bulk),
            'A measured startup changed the populated event aggregate.',
          )
          requireEvidence(
            JSON.stringify(facts.needles) === JSON.stringify(expectedFacts.needles),
            'A measured startup changed its exact history needles.',
          )
        }
        requireEvidence(
          live.needles.some((row) => row.id === 'measurement-wal'),
          'Live committed data was lost.',
        )
        requireEvidence(
          stateKept(state, stateAt(workspace, names), names).lost.length === 0,
          'Coupled fixture state changed during startup.',
        )
        record.validationFinished = performance.now()
      } finally {
        clearInterval(timer)
        await pending
        record.maxObservedSampleGapMs = record.observed.reduce(
          (gap, one, index) =>
            index === 0 ? gap : Math.max(gap, one.at - record.observed[index - 1].at),
          0,
        )
        await app.stop()
      }
      if (sampleError) throw sampleError
      return record
    }

    const baseline = await trial(old, 'baseline-019', baselineSeed.lineage, false, baselineWal)
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      rmSync(join(workspace, `brobot2.sqlite${suffix}`), { force: true })
    cloneMeasurementFile(
      join(baseline.copy.folder, 'database.sqlite'),
      join(workspace, 'brobot2.sqlite'),
    )
    for (const name of names) {
      rmSync(join(workspace, name), { recursive: true, force: true })
      const from = join(baseline.copy.folder, name)
      if (existsSync(from)) cpSync(from, join(workspace, name), { recursive: true })
    }
    const candidateWal = await leaveMeasurementWal(join(workspace, 'brobot2.sqlite'))
    await trial(next, 'candidate-background', baselineSeed.lineage, true, candidateWal)
    rmSync(workspace, { recursive: true })
    mkdirSync(workspace)
    const earlier = seed(true)
    seedState(workspace)
    const prefixWal = await leaveMeasurementWal(join(workspace, 'brobot2.sqlite'))
    requireEvidence(
      (await proofManifests(workspace)).length === 0 &&
        !existsSync(join(workspace, 'backups', 'retention.json')),
      'The synchronous fixture unexpectedly has a completed fallback or receipt.',
    )
    await trial(next, 'candidate-synchronous', earlier.lineage, false, prefixWal)
    success = true
    return result
  } finally {
    await app.stop()
    result.success = success
    result.finalAllocation = allocation(root)
    if (success) {
      rmSync(root, { recursive: true })
      result.cleanupVerified = !existsSync(root)
    }
    keep('recovery-measurement.json', result)
  }
}

export async function runRecoveryMeasurement(options) {
  const next = await options.candidate()
  const free = freeAt(tmpdir()),
    sizes = measurementSizes(options.bytes, free),
    results = []
  const result = {
    source: options.source,
    requestedCeiling: options.bytes,
    postBuildFree: free,
    floor: HEADROOM,
    routeSetupReserve: STATE_AND_WAL,
    success: false,
    sizes,
    results,
  }
  try {
    requireEvidence(sizes.length === 2, 'Two distinct populated sizes are required for scaling.')
    for (const bytes of sizes) {
      results.push(
        await runMeasurementSize({
          ...options,
          next,
          bytes,
          keep: (name, facts) => options.keep(`size-${bytes}-${name}`, facts),
        }),
      )
    }
    result.success = true
    return result
  } finally {
    if (result.success) rmSync(options.old.root, { recursive: true })
    options.keep('recovery-measurement.json', result)
  }
}

if (process.argv[2] === '--embedded-copy-comparison')
  await embeddedCopyComparisons(JSON.parse(process.argv[3]))
