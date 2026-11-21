const DATABASE_MEMORY_ROLES = [
  'writer',
  'window-reader',
  'limits-reader',
  'files-library',
  'work-search',
  'past-work-search',
  'past-work-index',
  'event-retention',
  'compaction-source',
  'compaction-output',
  'recovery-check',
  'recovery-history',
  'recovery-migrations',
  'recovery-source',
  'provider-evidence',
  'plugin-state',
  'team-profile-graph',
] as const

type DatabaseRole = (typeof DATABASE_MEMORY_ROLES)[number]
interface Handle {
  readonly open: boolean
  pragma(source: string, options: { simple: true }): unknown
}
export interface DatabaseMemory {
  role: number
  generation: number
  cacheSize: number | null
}

const handles = new Map<number, { role: number; handle: WeakRef<Handle> }>()
let generation = 0
let changed: (() => void) | undefined

/** Observes an existing handle; never owns or closes it. */
export function observeDatabaseMemory(db: Handle, role: DatabaseRole): void {
  pruneDatabaseMemory()
  handles.set(++generation, { role: DATABASE_MEMORY_ROLES.indexOf(role), handle: new WeakRef(db) })
  changed?.()
}

export function pruneDatabaseMemory(): void {
  for (const [id, entry] of handles) {
    const existing = entry.handle.deref()
    if (existing === undefined || !existing.open) handles.delete(id)
  }
}

export function onDatabaseMemoryChange(sample: () => void): void {
  changed = sample
}

export function databaseMemory(): DatabaseMemory[] {
  const result: DatabaseMemory[] = []
  for (const [generation, entry] of handles) {
    const db = entry.handle.deref()
    if (db === undefined || !db.open) {
      handles.delete(generation)
      continue
    }
    let cacheSize: number | null = null
    try {
      const value = db.pragma('cache_size', { simple: true })
      if (typeof value === 'number' && Number.isSafeInteger(value)) cacheSize = value
    } catch {
      // An unavailable diagnostic must not fail the connection's actual work.
    }
    result.push({ role: entry.role, generation, cacheSize })
  }
  return result
}

export function describeDatabaseMemory(rows: readonly DatabaseMemory[]): string {
  return rows.length === 0
    ? 'no-open-connection'
    : rows
        .map(
          ({ role, generation, cacheSize }) =>
            `${DATABASE_MEMORY_ROLES[role]}#${generation}:cache_size=${cacheSize ?? 'unavailable'}` +
            (cacheSize === null ? '' : cacheSize < 0 ? '(configured-KiB)' : '(configured-pages)'),
        )
        .join(',')
}
