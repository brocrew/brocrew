import { DEFAULT_IDENTITY_PROVIDER } from '@brobot2/shared'
import type { AppDatabase, AppStatement } from './connection'
import {
  agentIdentityRowId,
  foldProfileName,
  memoryAmendmentRowId,
  ownInstructionsRowId,
} from './identity'
import { agentName, type AgentIdentityName } from '../../shared/runtime-ipc'
import {
  actedByFrom,
  isWhoDidIt,
  THE_APP_DID_IT,
  type ActedBy,
} from '../../shared/who-did-it'
import {
  MEMORY_AMENDMENT,
  type MemoryAmendment,
  type MemoryAmendmentAct,
  type MemoryAmendmentWrite,
  type MemoryObservation,
  type MemoryOutcome,
} from '../../shared/agent-memory'
import {
  WHO_WROTE_IT,
  OWN_INSTRUCTIONS_CHARS,
  configuredLayerOf,
  type InstructionUnread,
  type RulesAuthor,
  type OwnInstructions,
  type OwnInstructionsVersion,
  type OwnInstructionsWrite,
  type WhoWroteIt,
} from '../../shared/own-instructions'
import {
  type createMemoryRecoveryStore,
  validMemoryIntent,
  knownMemorySource,
  memoryObservation,
} from './memory-recovery'
import { parseProvider } from './session-store-parts/model-choice-storage'

interface KnowledgeHistoryReceiver {
  identityOf(sessionId: string): { profileSlug: string } | null
  writeOwnInstructions(said: OwnInstructionsWrite, at: number): OwnInstructionsVersion | null
}

interface AgentKnowledgeHistory {
  ownInstructionsOf(profileSlug: string): OwnInstructions
  configuredLayerFor(profileSlug: string): string | null
  writeOwnInstructions(
    receiver: KnowledgeHistoryReceiver,
    said: OwnInstructionsWrite,
    at: number,
  ): OwnInstructionsVersion | null
  undoOwnInstructions(
    receiver: KnowledgeHistoryReceiver,
    profileSlug: string,
    expectedVersion: number,
    by: ActedBy,
    at: number,
  ): OwnInstructionsVersion | null
  instructionUnread(profileSlug: string): InstructionUnread
  markInstructionsSeen(profileSlug: string, version: number): boolean
  memoryAmendmentsOf(profileSlug: string): readonly MemoryAmendment[]
  writeMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  beginMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  settleMemoryAmendment(
    profileSlug: string,
    id: string,
    actual: MemoryObservation,
    by: ActedBy,
  ): boolean
  hasPendingMemoryAmendment(profileSlug: string): boolean
  memoryAmendment(profileSlug: string, id: string): MemoryAmendment | null
}

export function createAgentKnowledgeHistory(
  db: AppDatabase,
  memoryRecoveryStore: ReturnType<typeof createMemoryRecoveryStore>,
  identityBySlug: () => AppStatement,
  identityNameById: () => AppStatement,
): AgentKnowledgeHistory {
  let ownInstructionStatements: {
    versionsOf: AppStatement
    newestOf: AppStatement
    insertVersion: AppStatement
    versionOf: AppStatement
    seenOf: AppStatement
    markSeen: AppStatement
    newestDirect: AppStatement
  } | null = null
  const ownInstructionSql = (): NonNullable<typeof ownInstructionStatements> =>
    (ownInstructionStatements ??= {
      versionsOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC`,
      ),
      newestOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC LIMIT 1`,
      ),
      insertVersion: db.prepare(
        `INSERT INTO identity_instruction
           (id, identity_id, version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      versionOf: db.prepare(
        'SELECT text FROM identity_instruction WHERE identity_id = ? AND version = ?',
      ),
      seenOf: db.prepare(
        'SELECT seen_through FROM identity_instruction_seen WHERE identity_id = ?',
      ),
      markSeen:
        db.prepare(`INSERT INTO identity_instruction_seen (identity_id, seen_through) VALUES (?, ?)
        ON CONFLICT(identity_id) DO UPDATE SET seen_through = max(seen_through, excluded.seen_through)`),
      newestDirect: db.prepare(`SELECT max(version) AS version FROM identity_instruction
        WHERE identity_id = ? AND wrote_it = 'an-agent-direct'`),
    })

  /** One `identity_instruction` row as `better-sqlite3` hands it back. */
  type OwnInstructionRow = {
    version: number
    text: string
    wrote_it: unknown
    author: string | null
    by: unknown
    conversation_id: string | null
    said: string | null
    brought_back: number | null
    created_at: number
  }

  const foldWhoWroteIt = (stored: unknown): WhoWroteIt =>
    typeof stored === 'string' && (WHO_WROTE_IT as readonly string[]).includes(stored)
      ? (stored as WhoWroteIt)
      : 'an-agents-proposal'

  const actorOf = (stored: unknown): ActedBy => {
    if (typeof stored !== 'string') return actedByFrom(stored)
    try {
      return actedByFrom(JSON.parse(stored) as unknown)
    } catch {
      return THE_APP_DID_IT
    }
  }

  const authorFrom = (stored: string | null): RulesAuthor | undefined => {
    if (stored === null) return undefined
    try {
      const value: unknown = JSON.parse(stored)
      if (value === null || typeof value !== 'object') return undefined
      const fields = value as Record<string, unknown>
      return typeof fields['profile'] === 'string' && typeof fields['name'] === 'string'
        ? { profile: fields['profile'], name: fields['name'] }
        : undefined
    } catch {
      return undefined
    }
  }

  const ownInstructionFrom = (row: OwnInstructionRow): OwnInstructionsVersion => {
    const author = authorFrom(row.author)
    return {
      version: row.version,
      text: row.text,
      whoWroteIt: foldWhoWroteIt(row.wrote_it),
      by: actorOf(row.by),
      conversation: row.conversation_id,
      said: row.said,
      broughtBack: row.brought_back,
      writtenAt: row.created_at,
      ...(author === undefined ? {} : { author }),
    }
  }

  let memoryAmendmentStatements: {
    amendmentsOf: AppStatement
    newestOf: AppStatement
    newestForEntry: AppStatement
    amendmentById: AppStatement
    insertAmendment: AppStatement
  } | null = null
  const memoryAmendmentSql = (): NonNullable<typeof memoryAmendmentStatements> =>
    (memoryAmendmentStatements ??= {
      amendmentsOf: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC`,
      ),
      newestOf: db.prepare(
        `SELECT seq FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC LIMIT 1`,
      ),
      newestForEntry: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? AND provider = ? AND entry = ? AND outcome NOT IN ('pending', 'unchanged') ORDER BY seq DESC LIMIT 1`,
      ),
      amendmentById: db.prepare(
        'SELECT * FROM identity_memory_amendment WHERE identity_id = ? AND id = ?',
      ),
      insertAmendment: db.prepare(
        `INSERT INTO identity_memory_amendment
           (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    })

  /** One `identity_memory_amendment` row as `better-sqlite3` hands it back. */
  type MemoryAmendmentRow = {
    id: string
    seq: number
    provider: string
    entry: string
    act: unknown
    by: unknown
    text_before: string | null
    text_after: string | null
    created_at: number
    source_id: string | null
    outcome: MemoryOutcome
    actual: string | null
    settled_by: string | null
    settled_at: number | null
  }

  const foldAmendmentAct = (stored: unknown): MemoryAmendmentAct =>
    typeof stored === 'string' && (MEMORY_AMENDMENT as readonly string[]).includes(stored)
      ? (stored as MemoryAmendmentAct)
      : 'corrected'

  const memoryRecoveryFrom = (
    row: MemoryAmendmentRow,
  ): Pick<MemoryAmendment, 'outcome' | 'actual' | 'settlement'> => {
    if (
      row.outcome === 'done' &&
      row.actual === null &&
      row.settled_by === null &&
      row.settled_at === null
    )
      return {}
    if (
      row.outcome === 'pending' &&
      row.actual === null &&
      row.settled_by === null &&
      row.settled_at === null
    )
      return { outcome: 'pending' }
    const actual = row.actual === null ? null : memoryObservation(JSON.parse(row.actual))
    const observer = row.settled_by === null ? null : JSON.parse(row.settled_by)
    if (
      !['done', 'partial', 'unchanged'].includes(row.outcome) ||
      actual === null ||
      observer === null ||
      !isWhoDidIt(observer.who) ||
      (observer.who === 'an-agent' &&
        (typeof observer.agent !== 'string' || observer.agent === '')) ||
      !Number.isSafeInteger(row.settled_at) ||
      row.settled_at === null ||
      row.settled_at < 0
    )
      throw new Error('Memory recovery observation is unreadable')
    return {
      outcome: row.outcome,
      actual,
      settlement: { by: actedByFrom(observer), at: row.settled_at },
    }
  }

  const memoryAmendmentFrom = (row: MemoryAmendmentRow): MemoryAmendment => ({
    id: row.id,
    seq: row.seq,
    provider: parseProvider(row.provider) ?? DEFAULT_IDENTITY_PROVIDER,
    entry: row.entry,
    act: foldAmendmentAct(row.act),
    by: actorOf(row.by),
    textBefore: row.text_before,
    textAfter: row.text_after,
    at: row.created_at,
    ...memoryRecoveryFrom(row),
    ...(row.source_id === null ? {} : { sourceId: row.source_id }),
  })

  const appendMemoryAmendment = (
    said: MemoryAmendmentWrite,
    at: number,
    outcome: 'pending' | 'done',
  ): MemoryAmendment | null => {
    if (outcome === 'pending' && !validMemoryIntent(said, at)) return null
    const rowId = agentIdentityRowId(said.profileSlug)
    return db.transaction((): MemoryAmendment | null => {
      if (identityBySlug().get(foldProfileName(said.profileSlug)) === undefined) {
        return null
      }
      if (memoryRecoveryStore.hasPending(rowId)) return null
      const linked = said.act === 'restored' || said.sourceId !== undefined
      if (linked) {
        if (typeof said.sourceId !== 'string' || !Number.isSafeInteger(at) || at < 0) return null
        const raw = memoryAmendmentSql().newestForEntry.get(rowId, said.provider, said.entry) as
          MemoryAmendmentRow | undefined
        if (raw === undefined || raw.id !== said.sourceId) return null
        const source = memoryAmendmentFrom(raw)
        if (said.act === 'restored') {
          if (
            source.act !== 'removed' ||
            typeof source.textBefore !== 'string' ||
            said.textBefore !== null ||
            said.textAfter !== source.textBefore
          )
            return null
        } else if (said.act === 'removed') {
          if (
            source.act !== 'restored' ||
            typeof source.textAfter !== 'string' ||
            said.textBefore !== source.textAfter ||
            said.textAfter !== null
          )
            return null
        } else if (said.act === 'corrected' && outcome === 'pending') {
          if (
            source.act !== 'corrected' ||
            said.textBefore !== source.textAfter ||
            said.textAfter !== source.textBefore
          )
            return null
        } else return null
        if (!knownMemorySource(source, said.textBefore)) return null
      }
      const by = said.by
      const newest = memoryAmendmentSql().newestOf.get(rowId) as { seq: number } | undefined
      const seq = (newest?.seq ?? 0) + 1
      const id = memoryAmendmentRowId(said.profileSlug, seq)
      memoryAmendmentSql().insertAmendment.run(
        id,
        rowId,
        seq,
        said.provider,
        said.entry,
        said.act,
        JSON.stringify(by),
        said.textBefore,
        said.textAfter,
        at,
        said.sourceId ?? null,
        outcome,
      )
      return {
        id,
        seq,
        provider: said.provider,
        entry: said.entry,
        act: said.act,
        by,
        textBefore: said.textBefore,
        textAfter: said.textAfter,
        at,
        ...(outcome === 'pending' ? { outcome } : {}),
        ...(said.sourceId === undefined ? {} : { sourceId: said.sourceId }),
      }
    })()
  }

  return {
    ownInstructionsOf(profileSlug) {
      const identity = foldProfileName(profileSlug)
      const rows = ownInstructionSql().versionsOf.all(
        agentIdentityRowId(profileSlug),
      ) as OwnInstructionRow[]
      return { identity, versions: rows.map(ownInstructionFrom) }
    },

    configuredLayerFor(profileSlug) {
      const row = ownInstructionSql().newestOf.get(agentIdentityRowId(profileSlug)) as
        OwnInstructionRow | undefined
      return row === undefined
        ? null
        : configuredLayerOf({
            identity: foldProfileName(profileSlug),
            versions: [ownInstructionFrom(row)],
          })
    },

    writeOwnInstructions(receiver, said, at) {
      const rowId = agentIdentityRowId(said.profileSlug)
      return db.transaction((): OwnInstructionsVersion | null => {
        if (identityBySlug().get(foldProfileName(said.profileSlug)) === undefined) {
          return null
        }
        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined
        if (said.whoWroteIt === 'a-person' && said.by.who !== 'a-person') return null
        if (said.expectedVersion !== undefined && said.expectedVersion !== (newest?.version ?? 0))
          return null
        let text = said.text
        if (said.broughtBack !== null) {
          if (said.by.who !== 'a-person' || said.whoWroteIt !== 'a-person') return null
          if (said.broughtBack < 1 || said.broughtBack >= (newest?.version ?? 0) + 1) return null
          const historical = ownInstructionSql().versionOf.get(rowId, said.broughtBack) as
            { text: string } | undefined
          if (historical === undefined) return null
          if (said.text !== '' && said.text !== historical.text) return null
          text = historical.text
        }
        if (
          said.whoWroteIt === 'an-agent-direct' &&
          (said.by.who !== 'an-agent' ||
            said.author === undefined ||
            said.said === null ||
            said.said.trim() === '' ||
            said.text.length > OWN_INSTRUCTIONS_CHARS ||
            said.said.length > OWN_INSTRUCTIONS_CHARS ||
            said.expectedVersion === undefined)
        )
          return null
        if (said.whoWroteIt === 'an-agent-direct' && said.by.who === 'an-agent') {
          const identity = receiver.identityOf(said.by.agent)
          if (identity === null || said.conversation !== said.by.agent) return null
          const named = identityNameById().get(
            agentIdentityRowId(identity.profileSlug),
          ) as AgentIdentityName | undefined
          if (
            named === undefined ||
            said.author?.profile !== named.slug ||
            said.author.name !== agentName(named.slug, [named])
          )
            return null
        }
        const version = (newest?.version ?? 0) + 1
        ownInstructionSql().insertVersion.run(
          ownInstructionsRowId(said.profileSlug, version),
          rowId,
          version,
          text,
          said.whoWroteIt,
          said.author === undefined ? null : JSON.stringify(said.author),
          JSON.stringify(said.by),
          said.conversation,
          said.said,
          said.broughtBack,
          at,
        )
        return {
          version,
          text,
          whoWroteIt: said.whoWroteIt,
          by: said.by,
          conversation: said.conversation,
          said: said.said,
          broughtBack: said.broughtBack,
          writtenAt: at,
          ...(said.author === undefined ? {} : { author: said.author }),
        }
      })()
    },

    undoOwnInstructions(receiver, profileSlug, expectedVersion, by, at) {
      return db.transaction(() => {
        if (by.who !== 'a-person' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
          return null
        const newest = ownInstructionSql().newestOf.get(agentIdentityRowId(profileSlug)) as
          OwnInstructionRow | undefined
        if (newest?.version !== expectedVersion) return null
        return receiver.writeOwnInstructions(
          {
            profileSlug,
            text: '',
            expectedVersion,
            whoWroteIt: 'a-person',
            by,
            conversation: null,
            said: null,
            broughtBack: expectedVersion === 1 ? null : expectedVersion - 1,
          },
          at,
        )
      })()
    },

    instructionUnread(profileSlug) {
      const rowId = agentIdentityRowId(profileSlug)
      const seen = ownInstructionSql().seenOf.get(rowId) as { seen_through: number } | undefined
      const direct = ownInstructionSql().newestDirect.get(rowId) as { version: number | null }
      const seenThrough = seen?.seen_through ?? 0
      const newestDirectVersion = direct.version ?? 0
      return { seenThrough, newestDirectVersion, unread: newestDirectVersion > seenThrough }
    },

    markInstructionsSeen(profileSlug, version) {
      return db.transaction(() => {
        if (!Number.isSafeInteger(version) || version < 0) return false
        const rowId = agentIdentityRowId(profileSlug)
        if (identityBySlug().get(foldProfileName(profileSlug)) === undefined) return false
        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined
        if (version > (newest?.version ?? 0)) return false
        ownInstructionSql().markSeen.run(rowId, version)
        return true
      })()
    },
    memoryAmendmentsOf(profileSlug) {
      const rows = memoryAmendmentSql().amendmentsOf.all(
        agentIdentityRowId(profileSlug),
      ) as MemoryAmendmentRow[]
      return rows.map(memoryAmendmentFrom)
    },

    writeMemoryAmendment(said, at) {
      return appendMemoryAmendment(said, at, 'done')
    },
    beginMemoryAmendment(said, at) {
      return appendMemoryAmendment(said, at, 'pending')
    },
    settleMemoryAmendment(profileSlug, id, actual, by) {
      return memoryRecoveryStore.settle(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
        actual,
        by,
      )
    },
    hasPendingMemoryAmendment(profileSlug) {
      return memoryRecoveryStore.hasPending(agentIdentityRowId(foldProfileName(profileSlug)))
    },
    memoryAmendment(profileSlug, id) {
      const row = memoryAmendmentSql().amendmentById.get(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
      ) as MemoryAmendmentRow | undefined
      return row === undefined ? null : memoryAmendmentFrom(row)
    },
  }
}
