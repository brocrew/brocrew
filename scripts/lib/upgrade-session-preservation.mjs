import { isDeepStrictEqual } from 'node:util'
import { lineageFits, MAY_MOVE_AT_A_START } from './upgrade-path.mjs'

const SOURCE_ALIASES = 'source_session_ids'
const INTRODUCED_AT = 33
const MIGRATION = {
  createdAt: 1795480348532,
  hashes: [
    'aea1feadc2db1e66d794a569b60918329f570711808c9d169093d9e587f72f38',
    'd964da42133cf0491d1c72c67a6b7c5482185409107ad0b7af32658b7448e522',
  ],
}

function aliasState(row) {
  if (!Object.hasOwn(row, SOURCE_ALIASES)) return 'absent'
  if (row[SOURCE_ALIASES] === undefined) return 'undefined'
  return row[SOURCE_ALIASES] === null ? 'null' : 'non-null'
}

/** Only the exact SQL migration can extend the expectations of an ordinary live row check. */
export function liveProviderSessions(before, after, candidateLineage, defaults = {}) {
  const matchesLineage =
    after.lineage.length === candidateLineage.length &&
    lineageFits(after.lineage, candidateLineage) &&
    isDeepStrictEqual(after.lineage.slice(0, before.lineage.length), before.lineage)
  const aliasMigration = after.lineage[INTRODUCED_AT]
  const introducedAliases =
    matchesLineage &&
    before.lineage.length <= INTRODUCED_AT &&
    aliasMigration?.createdAt === MIGRATION.createdAt &&
    MIGRATION.hashes.includes(aliasMigration.hash)
  const oldRows = before.tables.provider_session ?? []
  const newRows = after.tables.provider_session ?? []
  const byId = new Map(newRows.map((row) => [row.id, row]))
  const rows = oldRows.map((old) => {
    const next = byId.get(old.id)
    byId.delete(old.id)
    const beforeAlias = aliasState(old)
    const afterAlias = next === undefined ? 'missing row' : aliasState(next)
    return {
      id: old.id,
      beforeAlias,
      afterAlias,
      aliasChanged:
        next === undefined
          ? null
          : beforeAlias !== afterAlias ||
            !isDeepStrictEqual(old[SOURCE_ALIASES], next[SOURCE_ALIASES]),
      changedLegacyFields:
        next === undefined
          ? []
          : [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(
              (key) =>
                key !== SOURCE_ALIASES &&
                !MAY_MOVE_AT_A_START.provider_session.includes(key) &&
                (Object.hasOwn(old, key) !== Object.hasOwn(next, key) ||
                  !isDeepStrictEqual(old[key], next[key])),
            ),
    }
  })
  return {
    additions: introducedAliases
      ? { ...defaults, provider_session: { ...defaults.provider_session, [SOURCE_ALIASES]: null } }
      : defaults,
    receipt: {
      matchesLineage,
      introducedAliases,
      beforeLineage: before.lineage,
      afterLineage: after.lineage,
      beforeCount: oldRows.length,
      afterCount: newRows.length,
      extraIds: [...byId.keys()],
      rows,
    },
  }
}
