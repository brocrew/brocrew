import { proveGzipRestore } from './upgrade-gzip-restore.mjs'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  requireEvidence,
  keptTables,
  rowsPreserved,
  CONNECTION_UPGRADE_DEFAULTS,
} from './upgrade-path.mjs'
import { readDatabase } from './upgrade-database.mjs'
import { retainedFixtureTables } from './upgrade-retention.mjs'
import { until } from './update-rehearsal-app.mjs'
import { createSafetyVolume } from './upgrade-space-volume.mjs'
import {
  backupFacts,
  fillForRefusal,
  proveMigrationSpaceRefusal,
} from './upgrade-space-refusal.mjs'

export function keepSafetyBaseline(folder) {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-safety-baseline-'))
  cpSync(folder, root, { recursive: true })
  return root
}

function database(folder, body, readOnly = true) {
  const db = new DatabaseSync(join(folder, 'brobot2.sqlite'), { readOnly, timeout: 0 })
  try {
    return body(db)
  } finally {
    db.close()
  }
}

function protectedFacts(folder) {
  return database(folder, (db) => {
    requireEvidence(
      db.prepare('PRAGMA quick_check').get().quick_check === 'ok',
      'The interrupted workspace failed quick_check.',
    )
    const hash = createHash('sha256')
    let rows = 0
    for (const row of db
      .prepare("SELECT id,payload FROM events WHERE session_id='safety-protected' ORDER BY ordinal")
      .iterate()) {
      hash.update(JSON.stringify([row.id, row.payload]) + '\n')
      rows++
    }
    return {
      rows,
      sha256: hash.digest('hex'),
      mode: db.prepare('PRAGMA auto_vacuum').get().auto_vacuum,
    }
  })
}

function seed(folder, compact) {
  return database(
    folder,
    (db) => {
      db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE')
      try {
        const session = db.prepare(
          "INSERT INTO provider_session(id,provider,cwd,status,created_at,updated_at) VALUES(?,'claude','.','ended',1,1)",
        )
        session.run('safety-protected')
        session.run('safety-trim')
        const insert = db.prepare(
          'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,0)',
        )
        const text = compact
          ? 'Fictional protected answer. '.repeat(19_000)
          : 'Fictional protected answer.'
        let protectedBytes = 0
        for (let n = 0; n < (compact ? 128 : 2); n++) {
          const payload = JSON.stringify({
            type: 'assistant_message',
            phase: 'final',
            text: `${n}:${text}`,
          })
          protectedBytes += Buffer.byteLength(payload)
          insert.run(
            `safety-protected-${n}`,
            'safety-protected',
            n,
            'assistant_message',
            payload,
            Date.now(),
          )
        }
        const history = compact ? 'Fictional discarded filler. '.repeat(19_000) : ''
        const count = compact ? 512 : 4000
        for (let n = 0; n < count; n++)
          insert.run(
            `safety-trim-${n}`,
            'safety-trim',
            n,
            'tool_inventory',
            JSON.stringify({
              type: 'tool_inventory',
              source: 'declaration',
              tools: [],
              filler: history,
            }),
            Date.now(),
          )
        if (compact) db.prepare("DELETE FROM events WHERE session_id='safety-trim'").run()
        db.exec('COMMIT')
        return { protectedBytes, trimRows: compact ? 0 : count }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    false,
  )
}

const remaining = (folder) =>
  database(folder, (db) =>
    Number(db.prepare("SELECT count(*) AS n FROM events WHERE session_id='safety-trim'").get().n),
  )
const sameProtected = (before, after) =>
  before.rows === after.rows && before.sha256 === after.sha256

/** Uses the upgrade runner's actual packaged launch, PID kill, restart and quit operations. */
async function proveTrimKills({
  os,
  baseline,
  version,
  candidateSkills,
  launch,
  kill,
  ready,
  quit,
  alive,
  keep,
  settle,
}) {
  const results = {}
  const original = readDatabase(baseline)
  const verifyOriginal = (folder) => {
    const tables = database(folder, (db) =>
      Object.fromEntries(
        Object.keys(keptTables(original.tables)).map((name) => {
          const quoted = '"' + name.replaceAll('"', '""') + '"'
          return [
            name,
            db
              .prepare(
                `SELECT * FROM ${quoted}${name === 'events' ? " WHERE session_id NOT IN ('safety-trim','safety-protected')" : ''}`,
              )
              .all(),
          ]
        }),
      ),
    )
    const retained = retainedFixtureTables(original.tables, tables, version)
    const compared = rowsPreserved(
      keptTables(retained.tables),
      tables,
      undefined,
      original.keys,
      candidateSkills,
      CONNECTION_UPGRADE_DEFAULTS,
    )
    requireEvidence(
      compared.lost.length === 0,
      `The interrupted upgrade lost original workspace data: ${JSON.stringify(compared.lost).slice(0, 2000)}`,
    )
    return {
      originalEvents: original.tables.events.length,
      permittedHistoryRemovals: retained.removed,
    }
  }
  const trimRoot = mkdtempSync(join(tmpdir(), 'upgrade-trim-kill-'))
  cpSync(baseline, trimRoot, { recursive: true })
  const recipe = seed(trimRoot, false)
  const before = protectedFacts(trimRoot)
  let observed
  await launch('trim-kill', trimRoot, async ({ pid }) => {
    observed = await until(
      () => {
        try {
          const count = remaining(trimRoot)
          requireEvidence(alive(pid), 'The app exited before the mid-trim kill.')
          return count > 1 && count < recipe.trimRows
            ? { pid, remaining: count, at: Date.now() }
            : null
        } catch (error) {
          if ([5, 6].includes(error.errcode)) return null
          throw error
        }
      },
      120_000,
      5,
    )
    requireEvidence(
      observed,
      'No actual partly committed trim was observed; this is NOT a mid-trim result.',
    )
    await kill('actual mid-trim')
    return false
  })
  const stoppedRows = remaining(trimRoot)
  requireEvidence(
    stoppedRows > 1 && stoppedRows < recipe.trimRows,
    'The stopped trim was not between committed batches.',
  )
  requireEvidence(
    sameProtected(before, protectedFacts(trimRoot)),
    'A kill during trim changed protected final answers.',
  )
  verifyOriginal(trimRoot)
  await launch('trim-resume', trimRoot)
  await ready()
  const finished = await until(() => remaining(trimRoot) === 1 || null, 120_000, 25)
  requireEvidence(finished === true, 'The next launch did not finish the remaining trim.')
  await quit('trim resume')
  const after = protectedFacts(trimRoot)
  requireEvidence(sameProtected(before, after), 'Resumed trim changed protected answers.')
  results.trim = {
    observed,
    stoppedRows,
    expectedRemaining: 1,
    before,
    after,
    workspace: verifyOriginal(trimRoot),
  }
  keep('mid-trim.json', results.trim)
  rmSync(trimRoot, { recursive: true })

  const volume = createSafetyVolume(os, keep)
  const compactRoot = join(volume.root, 'workspace')
  mkdirSync(compactRoot)
  cpSync(baseline, compactRoot, { recursive: true })
  const compactRecipe = seed(compactRoot, true)
  const compactBefore = protectedFacts(compactRoot)
  const sourceDatabaseBytes = lstatSync(join(compactRoot, 'brobot2.sqlite')).size
  const output = join(compactRoot, 'brobot2.sqlite.compact-events')
  let compactObserved
  const samples = []
  let sampler
  try {
    const filler = fillForRefusal(compactRoot, volume, true)
    await launch('compact-space-wait', compactRoot)
    await ready()
    await quit('compaction waits for space')
    requireEvidence(
      !existsSync(output) && sameProtected(compactBefore, protectedFacts(compactRoot)),
      'The low-space compaction damaged protected data or left an output.',
    )
    verifyOriginal(compactRoot)
    requireEvidence(
      protectedFacts(compactRoot).mode === compactBefore.mode &&
        JSON.stringify(backupFacts(compactRoot)) === JSON.stringify(filler.backups),
      'The preliminary low-space deferral retired the existing backup or installed a new database.',
    )
    results.lowSpace = {
      needed: filler.needed,
      free: filler.free,
      backupPreserved: true,
      protected: compactBefore,
      outputAbsent: true,
    }
    keep('compact-space-wait.json', results.lowSpace)
    filler.release()
    samples.push({ at: Date.now(), free: volume.free() })
    sampler = setInterval(() => samples.push({ at: Date.now(), free: volume.free() }), 10)
    await launch('compact-kill', compactRoot, async ({ pid }) => {
      compactObserved = await until(
        () => {
          requireEvidence(alive(pid), 'The app exited before the mid-compaction kill.')
          const size = existsSync(output) ? lstatSync(output).size : 0
          return size > 0 && size < compactRecipe.protectedBytes
            ? { pid, bytes: size, at: Date.now() }
            : null
        },
        120_000,
        5,
      )
      requireEvidence(
        compactObserved,
        'No incomplete compacted output was observed; this is NOT a mid-compaction result.',
      )
      await kill('actual mid-compaction')
      return false
    })
    const stoppedBytes = existsSync(output) ? lstatSync(output).size : 0
    requireEvidence(
      stoppedBytes > 0 && stoppedBytes < compactRecipe.protectedBytes,
      'The stopped output was complete or already installed; no mid-compaction credit.',
    )
    requireEvidence(
      sameProtected(compactBefore, protectedFacts(compactRoot)),
      'Mid-compaction kill damaged protected answers.',
    )
    verifyOriginal(compactRoot)
    await launch('compact-resume', compactRoot)
    await ready()
    await quit('compaction resume')
    const compactAfter = protectedFacts(compactRoot)
    requireEvidence(
      sameProtected(compactBefore, compactAfter) && compactAfter.mode === 2,
      'The resumed compaction lost protected data or did not install incremental mode.',
    )
    requireEvidence(!existsSync(output), 'The resumed compaction left its output behind.')
    const completed = readdirSync(join(compactRoot, 'backups')).filter((name) =>
      existsSync(join(compactRoot, 'backups', name, 'manifest.json')),
    )
    requireEvidence(
      completed.length === 1,
      'The resumed compaction did not leave exactly one backup.',
    )
    const manifest = JSON.parse(
      readFileSync(join(compactRoot, 'backups', completed[0], 'manifest.json'), 'utf8'),
    )
    requireEvidence(
      manifest.reason === 'after-compaction' && manifest.database.compression === 'gzip',
      'The resumed compaction did not capture one compressed checkpoint.',
    )
    samples.push({ at: Date.now(), free: volume.free() })
    results.compact = {
      observed: compactObserved,
      stoppedBytes,
      protectedBytes: compactRecipe.protectedBytes,
      sourceDatabaseBytes,
      liveDatabaseBytes: lstatSync(join(compactRoot, 'brobot2.sqlite')).size,
      compressedBackupBytes: manifest.database.bytes,
      rawBackupBytes: manifest.database.uncompressedBytes,
      before: compactBefore,
      after: compactAfter,
      workspace: verifyOriginal(compactRoot),
      backupCount: completed.length,
      sampledFreeMinimum: Math.min(...samples.map((sample) => sample.free)),
      sampledVolumeBytesSinceAttach:
        volume.record.freeAtAttach - Math.min(...samples.map((sample) => sample.free)),
      sampleCount: samples.length,
      peakScope: 'sampled volume allocation lower bound; filler removed before sampling',
    }
    keep('mid-compact.json', results.compact)
    keep('mid-compact-space-samples.json', samples)
  } finally {
    clearInterval(sampler)
    await settle()
    volume.dispose()
  }
  return results
}

export async function runTrimUpgradeSafety(
  {
    os,
    betaVersion,
    version,
    source,
    data,
    safetyBaseline,
    candidateSkills,
    conversations,
    answers,
    summary,
  },
  { phase, launch, verdict, bridge, current, stop, alive, crash, quit, copies, keep, must },
) {
  if (betaVersion === '0.2.23') {
    await phase('migration space refusal', async () => {
      summary.migrationSpace = await proveMigrationSpaceRefusal({
        os,
        baseline: safetyBaseline,
        keep,
        launch: (stage, folder, recovery) =>
          launch(stage, 9362, { workspace: folder, hidden: true, recovery }),
        evaluate: (source) => current().cdp.evaluate(source),
        ready: async () => {
          await verdict('space retry')
          await bridge('space retry')
          const info = await current().cdp.evaluate('return await window.api.getAppInfo()')
          must(
            info.version === version && info.build?.commit === source,
            'the space retry is the bound candidate',
            info,
          )
        },
        quit,
        settle: async () => {
          const pid = current()?.pid
          await stop()
          must(!pid || !alive(pid), 'the space-case app stopped before volume cleanup', { pid })
        },
      })
    })
    await phase('gzip Restore and Return', async () => {
      const retained = (await copies()).filter(
        (copy) => copy.manifest?.database?.compression === 'gzip',
      )
      must(
        retained.length === 1,
        'the gzip Restore case has exactly one completed compressed checkpoint',
      )
      summary.gzipRestore = await proveGzipRestore({
        folder: data,
        checkpoint: retained[0].manifest,
        conversations: conversations.map((id) => ({ id, text: answers[id] })),
        launch: async () => {
          await launch('gzip-restore', 9360, { workspace: data, hidden: true, recovery: true })
          return current().cdp
        },
        quit: () => quit('gzip Restore and Return'),
        keep,
      })
    })
  }

  if (betaVersion === '0.2.26') {
    await phase('trim and compaction kills', async () => {
      summary.trimSafety = await proveTrimKills({
        os,
        baseline: safetyBaseline,
        version: version,
        candidateSkills,
        alive,
        keep,
        launch: (stage, folder, beforeConnect) =>
          launch(stage, 9361, { workspace: folder, hidden: true, beforeConnect }),
        ready: async () => {
          await verdict('safety restart')
          await bridge('safety restart')
          const info = await current().cdp.evaluate('return await window.api.getAppInfo()')
          must(
            info.version === version && info.build?.commit === source,
            'the safety restart is the bound candidate',
            info,
          )
        },
        kill: crash,
        quit,
        settle: async () => {
          const pid = current()?.pid
          await stop()
          must(!pid || !alive(pid), 'the safety app stopped before volume cleanup', { pid })
        },
      })
    })
  }
}
