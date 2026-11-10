// The state files a candidate moves into its database, rebuilt from their rows so the upgrade-path
// check (`scripts/upgrade-path.mjs`) compares them with what the beta wrote, as it does a file.

/** Each row as an entry named by its `key` column. */
const keyed = (rows, key, value) => Object.fromEntries(rows.map((row) => [row[key], value(row)]))

/** Files the candidate imports into its database, each rebuilt from its rows to be compared. */
const MOVED_INTO_TABLES = {
  'drafts.json': (rows) => ({
    version: 1,
    drafts: rows('draft').map((row) => JSON.parse(row.entry)),
  }),
  'archived.json': (rows) => ({
    version: 1,
    archived: keyed(rows('archived_conversation'), 'conversation_id', (row) => ({
      at: row.archived_at,
    })),
  }),
  'profile-execution.json': (rows) => ({
    version: 2,
    ...(rows('profile_execution_state')[0]?.services_off === 1 ? { servicesOff: true } : {}),
    profiles: keyed(rows('profile_execution'), 'identity_id', (row) => JSON.parse(row.entry)),
  }),
  'provider-usage.json': (rows) => {
    // The beta's file listed both providers, each with an empty list when it had nothing.
    const byProvider = (table, entry) =>
      [...rows(table)]
        .sort((a, b) => a.position - b.position)
        .reduce(
          (all, row) => ({ ...all, [row.provider]: [...(all[row.provider] ?? []), entry(row)] }),
          { claude: [], codex: [] },
        )
    const readOn = keyed(rows('provider_usage_read_on'), 'provider', (row) => row.tag)
    return {
      readings: byProvider(
        'provider_usage_reading',
        ({ window, used_percent, resets_at, at, account }) => ({
          window,
          usedPercent: used_percent,
          resetsAt: resets_at,
          at,
          ...(account === null ? {} : { account }),
        }),
      ),
      seen: byProvider('provider_usage_window_seen', ({ window, first, last }) => ({
        window,
        first,
        last,
      })),
      ...(Object.keys(readOn).length === 0 ? {} : { readOn }),
    }
  },
  'schedule-attempts.json': (rows) => ({
    conversations: keyed(rows('schedule_attempt'), 'conversation_id', (row) => ({
      ...JSON.parse(row.record),
      at: row.at,
    })),
  }),
  'sign-in-changes.json': (rows) => ({
    version: 1,
    changed: keyed(rows('sign_in_change'), 'provider', (row) => row.changed_at),
  }),
}

/** `state` with each moved file the database marks as imported rebuilt from its rows. */
export function withMovedFiles(state, tables) {
  const found = { ...state }
  const rows = (table) => tables[table] ?? []
  const imported = new Set(rows('imported_side_file').map((row) => row.name))
  for (const [name, rebuild] of Object.entries(MOVED_INTO_TABLES)) {
    if (found[name] === undefined && imported.has(name))
      found[name] = Buffer.from(JSON.stringify(rebuild(rows)))
  }
  return found
}
