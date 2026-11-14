import { buildLineage, lineageFits, requireEvidence } from './upgrade-path.mjs'
import { fileOfAsar } from './mac-update-test.mjs'

export function packagedCandidateLineage(archive, workspaces) {
  const migrations = 'out/main/migrations'
  const journal = JSON.parse(fileOfAsar(archive, `${migrations}/meta/_journal.json`))
  const lineage = buildLineage(journal, (tag) => fileOfAsar(archive, `${migrations}/${tag}.sql`))
  for (const workspace of workspaces) {
    const recorded = workspace.baseline.before.migrations.map((one) => ({
      createdAt: one.created_at,
      hash: one.hash,
    }))
    requireEvidence(
      lineageFits(recorded, lineage),
      'Baseline migrations are not a candidate lineage prefix.',
    )
  }
  return lineage
}

export function checkpointReason(candidateLineage, migrations) {
  return candidateLineage.length > migrations.length ? 'before-migration' : 'first-start-of-release'
}

export function checkpointMigrations(migrations) {
  return migrations.map((one) => ({ createdAt: one.created_at, hash: one.hash }))
}
