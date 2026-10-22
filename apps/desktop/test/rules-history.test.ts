import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import * as instructions from '../src/shared/own-instructions'
import type { OwnInstructionsVersion, OwnInstructionsWrite } from '../src/shared/own-instructions'
import type { ActedBy } from '../src/shared/who-did-it'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const

// These fixture conversations have empty roots, which must go before their owner rows.
const discardConversation = (connection: AppDatabase, id: string): void => {
  connection.prepare('DELETE FROM work WHERE owner_session_id = ?').run(id)
  connection.prepare('DELETE FROM provider_session WHERE id = ?').run(id)
}
const { OWN_INSTRUCTIONS_CHARS } = instructions

// Keep the expected contract local so the tests also compile before the feature exists.
type HistoryOrigin = OwnInstructionsWrite['whoWroteIt'] | 'an-agent-direct'
type Author = { readonly profile: string; readonly name: string }
type HistoryWrite = Omit<OwnInstructionsWrite, 'whoWroteIt'> & {
  readonly whoWroteIt: HistoryOrigin
  readonly author?: Author
  readonly expectedVersion?: number
  readonly currentText?: string
}
type HistoryVersion = Omit<OwnInstructionsVersion, 'whoWroteIt'> & {
  readonly whoWroteIt: HistoryOrigin
  readonly author?: Author
}
type Unread = {
  readonly seenThrough: number
  readonly newestDirectVersion: number | null
  readonly unread: boolean
}
type HistoryStore = Omit<SessionStore, 'ownInstructionsOf' | 'writeOwnInstructions'> & {
  ownInstructionsOf(profile: string): { readonly versions: readonly HistoryVersion[] }
  writeOwnInstructions(said: HistoryWrite, at: number): HistoryVersion | null
  undoOwnInstructions(
    profile: string,
    version: number,
    by: ActedBy,
    at: number,
  ): HistoryVersion | null
  instructionUnread(profile: string): Unread
  markInstructionsSeen(profile: string, version: number, by: ActedBy): boolean
}
const rulesChangeLabel = (said: Pick<HistoryVersion, 'whoWroteIt' | 'author'>): string => {
  const label: unknown = Reflect.get(instructions, 'rulesChangeLabel')
  if (typeof label !== 'function') throw new Error('Rule change labels are unavailable')
  return label(said) as string
}

describe('standing rules retain their author and can be restored without losing newer work', () => {
  let folder: string
  let db: AppDatabase
  let store: HistoryStore
  let now: number

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'rules-history-'))
    db = openDatabase(join(folder, 'history.sqlite'))
    applyMigrations(db, migrations)
    now = 1000
    store = createSessionStore(db, () => now++) as unknown as HistoryStore
    store.create({
      id: 'ses-lark',
      profileId: 'lark',
      provider: 'codex',
      cwd: folder,
      approvalMode: 'ask',
    })
    store.create({
      id: 'ses-wren',
      profileId: 'wren',
      provider: 'codex',
      cwd: folder,
      approvalMode: 'ask',
    })
    db.prepare('UPDATE agent_identity SET display_name = ? WHERE slug = ?').run('Wren', 'wren')
  })

  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const write = (text: string, extra: Partial<HistoryWrite> = {}) =>
    store.writeOwnInstructions(
      {
        profileSlug: 'lark',
        text,
        whoWroteIt: 'a-person',
        by: person,
        conversation: null,
        said: null,
        broughtBack: null,
        ...extra,
      },
      now++,
    )

  it('names the agent who changed the rules and distinguishes a person change', () => {
    expect(
      rulesChangeLabel({
        whoWroteIt: 'an-agent-direct',
        author: { profile: 'wren', name: 'Wren' },
      }),
    ).toBe('Wren changed this')
    expect(rulesChangeLabel({ whoWroteIt: 'an-agent-direct' })).toBe('An agent changed this')
    expect(rulesChangeLabel({ whoWroteIt: 'a-person' })).toBe('You changed this')
  })

  it('preserves every legacy origin and its foreign keys when the history table is migrated', () => {
    const legacy = openDatabase(':memory:')
    try {
      const oldFolder = join(folder, 'old-migrations')
      mkdirSync(join(oldFolder, 'meta'), { recursive: true })
      const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
        entries: { idx: number; tag: string }[]
      }
      journal.entries = journal.entries.filter((entry) => entry.idx < 13)
      for (const entry of journal.entries)
        copyFileSync(join(migrations, `${entry.tag}.sql`), join(oldFolder, `${entry.tag}.sql`))
      writeFileSync(join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal))
      applyMigrations(legacy, oldFolder)
      const beforeStore = createSessionStore(legacy, () => now++)
      beforeStore.create({
        id: 'origin',
        profileId: 'wren',
        provider: 'codex',
        cwd: folder,
        approvalMode: 'ask',
      })
      for (const [index, origin] of [
        'a-person',
        'an-agents-proposal',
        'relayed-from-user',
        'its-creator',
      ].entries()) {
        const identity = `bird-${index}`
        beforeStore.create({
          id: `ses-${identity}`,
          profileId: identity,
          provider: 'codex',
          cwd: folder,
          approvalMode: 'ask',
        })
        legacy
          .prepare(
            `INSERT INTO identity_instruction
          (id,identity_id,version,text,wrote_it,by,conversation_id,said,brought_back,created_at)
          VALUES (?,?,1,?,?,?, ?,NULL,NULL,100)`,
          )
          .run(
            identity,
            `aid:${identity}`,
            `Rules ${index}`,
            origin,
            JSON.stringify(person),
            origin === 'a-person' ? null : 'origin',
          )
      }
      const before = legacy.prepare('SELECT * FROM identity_instruction ORDER BY id').all()
      applyMigrations(legacy, migrations)
      applyMigrations(legacy, migrations)
      const after = legacy
        .prepare('SELECT * FROM identity_instruction ORDER BY id')
        .all() as Record<string, unknown>[]
      expect(
        after.map((row) => {
          const legacyRow = { ...row }
          delete legacyRow['author']
          return legacyRow
        }),
      ).toEqual(before)
      expect(after.every((row) => row['author'] === null)).toBe(true)
      discardConversation(legacy, 'origin')
      expect(
        legacy
          .prepare('SELECT conversation_id FROM identity_instruction WHERE id = ?')
          .get('bird-1'),
      ).toEqual({ conversation_id: null })
      const indexes = legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'identity_instruction'",
        )
        .all() as { name: string }[]
      expect(indexes.map((one) => one.name)).toEqual(
        expect.arrayContaining([
          'identity_instruction_identity_idx',
          'identity_instruction_version_uq',
        ]),
      )
      expect(() =>
        legacy
          .prepare(
            `INSERT INTO identity_instruction
        (id,identity_id,version,text,wrote_it,by,created_at) VALUES ('duplicate','aid:bird-0',1,'Duplicate','a-person','{}',101)`,
          )
          .run(),
      ).toThrow()
      discardConversation(legacy, 'ses-bird-0')
      legacy.prepare('DELETE FROM agent_identity WHERE id = ?').run('aid:bird-0')
      expect(
        legacy
          .prepare('SELECT id FROM identity_instruction WHERE identity_id = ?')
          .all('aid:bird-0'),
      ).toEqual([])
      expect(legacy.pragma('foreign_key_check')).toEqual([])
    } finally {
      legacy.close()
    }
  })

  it('refuses a stale version or mismatched current text inside the writer', () => {
    expect(write('First', { expectedVersion: 0, currentText: '' })?.version).toBe(1)
    expect(write('Outdated', { expectedVersion: 0, currentText: '' })).toBeNull()
    expect(write('Mistaken', { expectedVersion: 1, currentText: 'Different' })).toBeNull()
    expect(store.ownInstructionsOf('lark').versions.map((one) => one.text)).toEqual(['First'])
  })

  it('keeps the content author separately from the person who approved it', () => {
    const author = { profile: 'wren', name: 'Wren' }
    write('Review carefully', {
      whoWroteIt: 'an-agents-proposal',
      author,
      conversation: 'ses-wren',
      said: 'Keep reviews readable',
    })
    discardConversation(db, 'ses-wren')
    store = createSessionStore(db, () => now++) as unknown as HistoryStore
    const saved = store.ownInstructionsOf('lark').versions[0]
    expect(saved?.author).toEqual(author)
    expect(saved?.by).toEqual(person)
    expect(saved?.conversation).toBeNull()
  })

  it('loads restore text from the historical row instead of trusting the supplied text', () => {
    write('First')
    write('Second')
    expect(write('Forged historical text', { broughtBack: 1, expectedVersion: 2 })).toBeNull()
    const restored = write('', { broughtBack: 1, expectedVersion: 2 })
    expect(restored?.text).toBe('First')
    expect(restored?.broughtBack).toBe(1)
    expect(store.ownInstructionsOf('lark').versions.map((one) => one.text)).toEqual([
      'First',
      'Second',
      'First',
    ])
  })

  it('undoes only the expected latest version, including the first and a clear', () => {
    write('First')
    expect(store.undoOwnInstructions('lark', 1, person, now++)?.text).toBe('')
    expect(store.undoOwnInstructions('lark', 1, person, now++)).toBeNull()
    expect(store.undoOwnInstructions('lark', 2, person, now++)?.text).toBe('First')
    expect(store.ownInstructionsOf('lark').versions).toHaveLength(3)
  })

  it('does not record an agent action as a person save or restore', () => {
    const by = { who: 'an-agent', agent: 'ses-wren' } as const
    expect(write('Pretend person', { by })).toBeNull()
    write('Person rules')
    expect(store.undoOwnInstructions('lark', 1, by, now++)).toBeNull()
    expect(write('', { by, whoWroteIt: 'an-agents-proposal', broughtBack: 1 })).toBeNull()
    expect(store.ownInstructionsOf('lark').versions).toHaveLength(1)
  })

  it('refuses a forged direct author or origin conversation', () => {
    const direct = {
      whoWroteIt: 'an-agent-direct',
      by: { who: 'an-agent', agent: 'ses-wren' },
      conversation: 'ses-wren',
      said: 'Clarify rules',
      author: { profile: 'lark', name: 'Lark' },
      expectedVersion: 0,
      currentText: '',
    } as const
    const real = { ...direct, author: { profile: 'wren', name: 'Wren' } }
    expect(write('x'.repeat(OWN_INSTRUCTIONS_CHARS + 1), real)).toBeNull()
    expect(
      write('Oversized reason', { ...real, said: 'x'.repeat(OWN_INSTRUCTIONS_CHARS + 1) }),
    ).toBeNull()
    expect(write('Forged profile', direct)).toBeNull()
    expect(
      write('Forged name', { ...direct, author: { profile: 'wren', name: 'Other' } }),
    ).toBeNull()
    expect(
      write('Forged conversation', {
        ...direct,
        author: { profile: 'wren', name: 'Wren' },
        conversation: 'ses-lark',
      }),
    ).toBeNull()
    expect(
      write('Real author', { ...direct, author: { profile: 'wren', name: 'Wren' } })?.version,
    ).toBe(1)
  })

  it('records the profile label when the acting agent has no display name', () => {
    db.prepare('UPDATE agent_identity SET display_name = NULL WHERE slug = ?').run('wren')
    expect(
      write('Direct rules', {
        whoWroteIt: 'an-agent-direct',
        by: { who: 'an-agent', agent: 'ses-wren' },
        conversation: 'ses-wren',
        author: { profile: 'wren', name: 'wren' },
        said: 'Clarify',
        expectedVersion: 0,
        currentText: '',
      })?.author,
    ).toEqual({ profile: 'wren', name: 'wren' })
  })

  it('retains unread direct changes through later person edits and old acknowledgements', () => {
    write('Direct first', {
      whoWroteIt: 'an-agent-direct',
      by: { who: 'an-agent', agent: 'ses-wren' },
      conversation: 'ses-wren',
      said: 'Record the change',
      author: { profile: 'wren', name: 'Wren' },
      expectedVersion: 0,
      currentText: '',
    })
    expect(store.instructionUnread('lark')).toEqual({
      seenThrough: 0,
      newestDirectVersion: 1,
      unread: true,
    })
    expect(store.markInstructionsSeen('lark', 1, { who: 'an-agent', agent: 'ses-wren' })).toBe(
      false,
    )
    store = createSessionStore(db, () => now++) as unknown as HistoryStore
    expect(store.instructionUnread('lark').unread).toBe(true)
    expect(store.markInstructionsSeen('lark', 1, person)).toBe(true)
    write('Direct second', {
      whoWroteIt: 'an-agent-direct',
      by: { who: 'an-agent', agent: 'ses-wren' },
      conversation: 'ses-wren',
      said: 'Clarify the change',
      author: { profile: 'wren', name: 'Wren' },
      expectedVersion: 1,
      currentText: 'Direct first',
    })
    write('Person edit')
    expect(store.markInstructionsSeen('lark', 1, person)).toBe(true)
    expect(store.markInstructionsSeen('lark', 10, person)).toBe(false)
    expect(store.instructionUnread('lark')).toEqual({
      seenThrough: 1,
      newestDirectVersion: 2,
      unread: true,
    })
    store = createSessionStore(db, () => now++) as unknown as HistoryStore
    expect(store.instructionUnread('lark').unread).toBe(true)
    expect(store.markInstructionsSeen('lark', 2, person)).toBe(true)
    expect(store.instructionUnread('lark').unread).toBe(false)
  })
})
