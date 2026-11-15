import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { requireEvidence, sha256 } from './upgrade-path.mjs'
import { until } from './update-rehearsal-app.mjs'

/** Exercises the installed candidate's existing Restore/Return UI on fictional data. */
export async function proveGzipRestore({ folder, checkpoint, conversations, launch, quit, keep }) {
  requireEvidence(
    checkpoint?.database?.compression === 'gzip',
    'Gzip restore needs an actual compressed checkpoint.',
  )
  const file = join(folder, 'brobot2.sqlite')
  const db = new DatabaseSync(file)
  let future
  try {
    const latest = Number(
      db.prepare('SELECT max(created_at) AS at FROM __drizzle_migrations').get().at,
    )
    future = {
      hash: sha256('fictional future migration for gzip Restore/Return'),
      createdAt: latest + 1,
    }
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
      future.hash,
      future.createdAt,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
  const before = sha256(readFileSync(file))
  const cdp = await launch()
  const verdict = await until(
    async () => {
      const value = await cdp.evaluate('return window.recovery?.verdict()')
      return value?.kind === 'working' ? null : value
    },
    120_000,
    100,
  )
  requireEvidence(
    verdict?.kind === 'newer' && verdict.offers?.id === checkpoint.id,
    'The installed candidate did not offer its gzip checkpoint for the synthetic future database.',
  )
  await cdp.evaluate('document.querySelector("[data-cy=recovery-restore]").click(); return true')
  const restored = await until(
    async () =>
      (await cdp.evaluate('return window.recovery.verdict()'))?.kind === 'history-only' || null,
    120_000,
    100,
  )
  requireEvidence(
    restored === true,
    'The installed candidate did not restore the gzip checkpoint into history.',
  )
  const transcripts = []
  for (const { id, text } of conversations) {
    const value = await cdp.evaluate(
      `return JSON.stringify(await window.recovery.history.transcript(${JSON.stringify(id)}))`,
    )
    requireEvidence(
      value.includes(text),
      'The restored gzip history did not contain the fictional recorded answer.',
    )
    transcripts.push({ id, answerPresent: true })
  }
  await cdp.evaluate('document.querySelector("[data-cy=recovery-return]").click(); return true')
  const returned = await until(
    async () => (await cdp.evaluate('return window.recovery.verdict()'))?.kind === 'newer' || null,
    120_000,
    100,
  )
  requireEvidence(returned === true, 'Return did not reopen the synthetic future state.')
  await quit()
  const after = sha256(readFileSync(file))
  requireEvidence(after === before, 'Restore/Return changed the newer live database.')
  const result = {
    checkpointId: checkpoint.id,
    compression: 'gzip',
    syntheticFuture: future,
    transcripts,
    before,
    after,
    returned: true,
  }
  keep('gzip-restore.json', result)
  return result
}
