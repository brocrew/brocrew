import type { AppDatabase } from './connection'
import { agentIdentityRowId, ownNotesRowId } from './identity'
import { agentName, foldProfileName } from '../../shared/runtime-ipc'
import type { RulesAuthor } from '../../shared/own-instructions'
import {
  ownNotesTextFits,
  type OwnNotesBaseline,
  type OwnNotesPage,
  type OwnNotesReading,
  type OwnNotesUnread,
  type OwnNotesVersion,
  type OwnNotesWrite,
} from '../../shared/own-notes'
import type { ActedBy } from '../../shared/who-did-it'

export interface OwnNotesStore {
  currentOwnNotesOf(profile: string): OwnNotesPage | null
  ownNotesOf(profile: string): OwnNotesReading | null
  writeOwnNotes(
    profile: string,
    said: OwnNotesWrite,
    by: ActedBy,
    at: number,
  ): OwnNotesVersion | null
  undoOwnNotes(
    profile: string,
    baseline: OwnNotesBaseline,
    by: ActedBy,
    at: number,
  ): OwnNotesVersion | null
  ownNotesUnread(profile: string): OwnNotesUnread
  markOwnNotesSeen(profile: string, throughVersion: number, by: ActedBy): boolean
}

type Identity = { id: string; slug: string; displayName: string | null }
type Row = {
  version: number
  text: string
  author: string | null
  actor: string
  reason: string
  restored_from_version: number | null
  created_at: number
}
const fromRow = (row: Row): OwnNotesVersion => ({
  version: row.version,
  text: row.text,
  author: row.author === null ? null : (JSON.parse(row.author) as RulesAuthor),
  by: JSON.parse(row.actor) as ActedBy,
  reason: row.reason,
  restoredFromVersion: row.restored_from_version,
  writtenAt: row.created_at,
})

/** A profile-wide page, independent of provider, conversation lifetime and standing-rule history. */
export function createOwnNotesStore(db: AppDatabase): OwnNotesStore {
  // Lazy statements keep the ordinary session reader independent of this optional book reading.
  let statements: ReturnType<typeof prepare> | undefined
  const prepare = () => ({
    identity: db.prepare(
      'SELECT id, slug, display_name AS displayName FROM agent_identity WHERE id = ?',
    ),
    writer: db.prepare(`SELECT i.id, i.slug, i.display_name AS displayName
      FROM provider_session s JOIN agent_identity i ON i.id = s.agent_identity_id WHERE s.id = ?`),
    versions: db.prepare(
      'SELECT * FROM identity_own_notes WHERE identity_id = ? ORDER BY version DESC',
    ),
    newest: db.prepare(
      'SELECT * FROM identity_own_notes WHERE identity_id = ? ORDER BY version DESC LIMIT 1',
    ),
    version: db.prepare(
      'SELECT text FROM identity_own_notes WHERE identity_id = ? AND version = ?',
    ),
    insert: db.prepare(`INSERT INTO identity_own_notes
      (id, identity_id, version, text, author, actor, reason, restored_from_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    seen: db.prepare('SELECT seen_through FROM identity_own_notes_seen WHERE identity_id = ?'),
    newestAgent: db.prepare(`SELECT max(version) AS version FROM identity_own_notes
      WHERE identity_id = ? AND json_extract(actor, '$.who') = 'an-agent'`),
    markSeen:
      db.prepare(`INSERT INTO identity_own_notes_seen (identity_id, seen_through) VALUES (?, ?)
      ON CONFLICT(identity_id) DO UPDATE SET seen_through = max(seen_through, excluded.seen_through)`),
  })
  const sql = () => (statements ??= prepare())
  const identity = (profile: string) =>
    sql().identity.get(agentIdentityRowId(profile)) as Identity | undefined
  const newest = (id: string) => sql().newest.get(id) as Row | undefined
  const baselineMatches = (row: Row | undefined, baseline: OwnNotesBaseline) =>
    Number.isSafeInteger(baseline.expectedVersion) &&
    baseline.expectedVersion >= 0 &&
    typeof baseline.currentText === 'string' &&
    ownNotesTextFits(baseline.currentText) &&
    baseline.expectedVersion === (row?.version ?? 0) &&
    baseline.currentText === (row?.text ?? '')

  const atomic = <T>(run: () => T): T | null => {
    try {
      return db.transaction(run).immediate()
    } catch (error) {
      // A concurrent version or the database's own invariant rejected this write. No success receipt.
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('SQLITE_CONSTRAINT')
      )
        return null
      throw error
    }
  }
  const append = (
    profile: string,
    said: OwnNotesWrite,
    by: ActedBy,
    at: number,
    restoredFromVersion: number | null,
  ): OwnNotesVersion | null => {
    const target = identity(profile)
    if (
      !target ||
      !baselineMatches(newest(target.id), said) ||
      typeof said.text !== 'string' ||
      !ownNotesTextFits(said.text) ||
      typeof said.why !== 'string' ||
      said.why.trim() === '' ||
      !ownNotesTextFits(said.why) ||
      !Number.isSafeInteger(at) ||
      at < 0
    )
      return null
    let author: RulesAuthor | null = null
    if (by.who === 'an-agent') {
      if (typeof by.agent !== 'string') return null
      const writer = sql().writer.get(by.agent) as Identity | undefined
      if (!writer || writer.id !== target.id) return null
      author = { profile: writer.slug, name: agentName(writer.slug, [writer]) }
    } else if (by.who !== 'a-person') return null
    const version = said.expectedVersion + 1
    const actor: ActedBy =
      by.who === 'an-agent' ? { who: 'an-agent', agent: by.agent } : { who: 'a-person' }
    sql().insert.run(
      ownNotesRowId(target.slug, version),
      target.id,
      version,
      said.text,
      author === null ? null : JSON.stringify(author),
      JSON.stringify(actor),
      said.why,
      restoredFromVersion,
      at,
    )
    // The person's own edit/Undo is seen; it does not acknowledge a later agent version.
    if (by.who === 'a-person') sql().markSeen.run(target.id, version)
    return {
      version,
      text: said.text,
      by: actor,
      author,
      reason: said.why,
      restoredFromVersion,
      writtenAt: at,
    }
  }
  return {
    currentOwnNotesOf(profile) {
      const known = identity(profile)
      if (!known) return null
      const row = newest(known.id)
      return { profile: known.slug, current: row === undefined ? null : fromRow(row) }
    },
    ownNotesOf(profile) {
      const known = identity(profile)
      return known
        ? { profile: known.slug, versions: (sql().versions.all(known.id) as Row[]).map(fromRow) }
        : null
    },
    writeOwnNotes(profile, said, by, at) {
      return atomic(() => append(profile, said, by, at, null))
    },
    undoOwnNotes(profile, baseline, by, at) {
      return atomic(() => {
        if (by.who !== 'a-person') return null
        const target = identity(profile)
        const current = target ? newest(target.id) : undefined
        if (!target || !current || !baselineMatches(current, baseline)) return null
        const restored = current.version - 1
        const previous =
          restored === 0
            ? { text: '' }
            : (sql().version.get(target.id, restored) as { text: string } | undefined)
        if (!previous) return null
        return append(
          profile,
          { ...baseline, text: previous.text, why: 'Undo latest change' },
          by,
          at,
          restored,
        )
      })
    },
    ownNotesUnread(profile) {
      const id = agentIdentityRowId(foldProfileName(profile))
      const seenThrough =
        (sql().seen.get(id) as { seen_through: number } | undefined)?.seen_through ?? 0
      const newestAgentVersion =
        (sql().newestAgent.get(id) as { version: number | null }).version ?? 0
      return { seenThrough, newestAgentVersion, unread: newestAgentVersion > seenThrough }
    },
    markOwnNotesSeen(profile, throughVersion, by) {
      return (
        atomic(() => {
          if (by.who !== 'a-person' || !Number.isSafeInteger(throughVersion) || throughVersion < 0)
            return false
          const target = identity(profile)
          if (!target || throughVersion > (newest(target.id)?.version ?? 0)) return false
          sql().markSeen.run(target.id, throughVersion)
          return true
        }) ?? false
      )
    },
  }
}
