import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentName } from '../src/shared/runtime-ipc'
import type { ActedBy } from '../src/shared/who-did-it'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const lark = { who: 'an-agent', agent: 'ses-lark' } as const
const wren = { who: 'an-agent', agent: 'ses-wren' } as const
// Local contracts keep this tests-only commit compilable before the store gains the methods.
type Baseline = { expectedVersion: number; currentText: string }
type Version = {
  version: number
  text: string
  by: ActedBy
  author: { profile: string; name: string } | null
  reason: string
  restoredFromVersion: number | null
  writtenAt: number
}
type Notes = {
  ownNotesOf(profile: string): { profile: string; versions: Version[] } | null
  writeOwnNotes(
    profile: string,
    said: Baseline & { text: string; why: string },
    by: ActedBy,
    at: number,
  ): Version | null
  undoOwnNotes(profile: string, baseline: Baseline, by: ActedBy, at: number): Version | null
  ownNotesUnread(profile: string): { unread: boolean; seenThrough: number; newestAgentVersion: number }
  markOwnNotesSeen(profile: string, throughVersion: number, by: ActedBy): boolean
}

describe('own notes belong to an identity and retain exact attributable history', () => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  const notes = (): Notes => {
    expect(store, 'the store must expose durable own notes').toHaveProperty('ownNotesOf')
    return store as unknown as Notes
  }
  const write = (
    text = 'Keep the agreed review order.',
    by: ActedBy = lark,
    profile = 'lark',
    baseline: Baseline = { expectedVersion: 0, currentText: '' },
    why = 'The person asked me to remember the review order.',
  ) => notes().writeOwnNotes(profile, { ...baseline, text, why }, by, clock++)

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'own-notes-'))
    db = openDatabase(join(folder, 'app.sqlite'))
    applyMigrations(db, migrations)
    clock = 1000
    store = createSessionStore(db, () => clock++)
    for (const profile of ['lark', 'wren'])
      store.create({
        id: `ses-${profile}`,
        profileId: profile,
        provider: profile === 'lark' ? 'codex' : 'claude',
        cwd: folder,
        approvalMode: 'ask',
      })
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('distinguishes an empty known profile from an unknown profile without creating either', () => {
    expect(notes().ownNotesOf('LARK')).toEqual({ profile: 'lark', versions: [] })
    expect(notes().ownNotesOf('missing')).toBeNull()
    expect(write('No', lark, 'missing')).toBeNull()
    expect(write('No', person, 'missing')).toBeNull()
    expect(notes().undoOwnNotes('missing', { expectedVersion: 0, currentText: '' }, person, clock++)).toBeNull()
    expect(store.capabilitiesOf('missing')).toBeNull()
  })

  it('derives the agent author from its conversation and preserves exact text and reason', () => {
    const writtenAt = clock
    const written = write('  Keep punctuation.\r\nSecond line.  ')
    expect(written).toMatchObject({
      version: 1,
      text: '  Keep punctuation.\r\nSecond line.  ',
      by: lark,
      author: { profile: 'lark', name: expect.any(String) },
      reason: 'The person asked me to remember the review order.',
      restoredFromVersion: null,
      writtenAt,
    })
    expect(written!.author!.name.trim()).not.toBe('')
    expect(notes().ownNotesOf('LARK')!.versions).toEqual([written])
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('refuses another profile, an unknown conversation and app actors without changing history', () => {
    expect(write('Not mine', wren)).toBeNull()
    expect(write('Unknown', { who: 'an-agent', agent: 'missing-session' })).toBeNull()
    expect(write('App', { who: 'the-app-itself' })).toBeNull()
    expect(write('Unknown caller', { who: 'a-caller-this-app-cannot-name' })).toBeNull()
    expect(notes().ownNotesOf('lark')!.versions).toEqual([])
    expect(write()).not.toBeNull()
  })

  it('rejects stale reads from another connection by checking both exact baseline values', () => {
    const otherDb = openDatabase(join(folder, 'app.sqlite'))
    try {
      const other = createSessionStore(otherDb, () => clock++) as unknown as Notes
      const first = write('First')!
      expect(other.writeOwnNotes('lark', { expectedVersion: 0, currentText: '', text: 'Lost', why: 'Race' }, lark, clock++)).toBeNull()
      expect(write('Lost', lark, 'lark', { expectedVersion: 1, currentText: ' First' })).toBeNull()
      expect(write('Lost', lark, 'lark', { expectedVersion: 0, currentText: 'First' })).toBeNull()
      const second = write('Second', lark, 'lark', { expectedVersion: 1, currentText: 'First' })!
      expect(second.version).toBe(2)
      expect(notes().ownNotesOf('lark')!.versions).toEqual([second, first])
    } finally {
      otherDb.close()
    }
  })

  it('enforces 4000 characters without counting accented or astral characters as extra', () => {
    const text = '🪶'.repeat(4000)
    expect(write(text)!.text).toBe(text)
    const baseline = { expectedVersion: 1, currentText: text }
    expect(write(text + 'é', lark, 'lark', baseline)).toBeNull()
    expect(write('Fine', person, 'wren', { expectedVersion: 0, currentText: '' }, 'x'.repeat(4001))).toBeNull()
    expect(write('Fine', lark, 'wren', { expectedVersion: 0, currentText: '' })).toBeNull()
    expect(write('Fine', person, 'wren', { expectedVersion: 0, currentText: '' })).not.toBeNull()
  })

  it('rejects blank reasons and malformed baseline versions, and saves clearing as a new version', () => {
    expect(write('No reason', lark, 'lark', { expectedVersion: 0, currentText: '' }, ' \n ')).toBeNull()
    for (const expectedVersion of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(write('Bad version', lark, 'lark', { expectedVersion, currentText: '' })).toBeNull()
    const first = write('First')!
    const empty = write('', lark, 'lark', { expectedVersion: 1, currentText: 'First' })!
    expect(empty).toMatchObject({ version: 2, text: '' })
    expect(notes().ownNotesOf('lark')!.versions).toEqual([empty, first])
  })

  it('records a person edit honestly, and Undo appends only against the exact latest baseline', () => {
    const first = write('Agent text')!
    const second = write('Person text', person, 'lark', { expectedVersion: 1, currentText: first.text })!
    expect(second).toMatchObject({ by: person, author: null, version: 2 })
    const baseline = { expectedVersion: 2, currentText: 'Person text' }
    expect(notes().undoOwnNotes('lark', baseline, lark, clock++)).toBeNull()
    expect(notes().undoOwnNotes('lark', { ...baseline, currentText: 'Wrong' }, person, clock++)).toBeNull()
    const undone = notes().undoOwnNotes('lark', baseline, person, clock++)!
    expect(undone).toMatchObject({ version: 3, text: first.text, by: person, author: null, restoredFromVersion: 1, reason: 'Undo latest change' })
    expect(notes().undoOwnNotes('lark', baseline, person, clock++)).toBeNull()
    expect(notes().ownNotesOf('lark')!.versions).toEqual([undone, second, first])
  })

  it('refuses an in-transaction version collision without reporting a save or leaving history', () => {
    notes()
    db.exec(`CREATE TRIGGER notes_version_collision BEFORE INSERT ON identity_own_notes
      BEGIN
        INSERT INTO identity_own_notes
          (id, identity_id, version, text, author, actor, reason, restored_from_version, created_at)
        VALUES
          (NEW.id, NEW.identity_id, NEW.version, NEW.text, NEW.author, NEW.actor,
           NEW.reason, NEW.restored_from_version, NEW.created_at);
      END`)
    try {
      expect(write()).toBeNull()
      expect(notes().ownNotesOf('lark')!.versions).toEqual([])
    } finally {
      db.exec('DROP TRIGGER notes_version_collision')
    }
    expect(write()).not.toBeNull()
  })

  it('refuses text that cannot round-trip through SQLite or has a malformed exact baseline', () => {
    for (const text of ['nul\0text', 'high\ud800', 'low\udc00'])
      expect(write(text)).toBeNull()
    expect(write('Fine', person, 'lark', { expectedVersion: 0, currentText: '' }, ' \n ')).toBeNull()
    expect(notes().ownNotesOf('lark')!.versions).toEqual([])
    expect(write('é 🪶')).not.toBeNull()
  })

  it('undoes an agent latest change and undo-of-undo, but never invents an earlier version', () => {
    expect(notes().undoOwnNotes('lark', { expectedVersion: 0, currentText: '' }, person, clock++)).toBeNull()
    write('Agent first')
    write('Agent second', lark, 'lark', { expectedVersion: 1, currentText: 'Agent first' })
    const undone = notes().undoOwnNotes('lark', { expectedVersion: 2, currentText: 'Agent second' }, person, clock++)!
    expect(undone).toMatchObject({ version: 3, text: 'Agent first', restoredFromVersion: 1, by: person })
    const redone = notes().undoOwnNotes('lark', { expectedVersion: 3, currentText: 'Agent first' }, person, clock++)!
    expect(redone).toMatchObject({ version: 4, text: 'Agent second', restoredFromVersion: 2, by: person })
    expect(notes().ownNotesOf('lark')!.versions.map((v) => v.version)).toEqual([4, 3, 2, 1])
  })

  it('keeps rules and notes histories and acknowledgements separate, while person changes are seen', () => {
    write('Notes')
    const rules = store.writeOwnInstructions({ profileSlug: 'lark', text: 'Standing rule', whoWroteIt: 'an-agent-direct', author: { profile: 'wren', name: agentName('wren', store.agentIdentities()) }, by: wren, conversation: 'ses-wren', said: 'Clarify', broughtBack: null, expectedVersion: 0, currentText: '' }, clock++)!
    expect(rules).not.toBeNull()
    expect(notes().ownNotesOf('lark')!.versions.map((v) => v.text)).toEqual(['Notes'])
    expect(store.markInstructionsSeen('lark', 1, person)).toBe(true)
    expect(notes().ownNotesUnread('lark').unread).toBe(true)
    const edited = write('Person notes', person, 'lark', { expectedVersion: 1, currentText: 'Notes' })!
    expect(notes().ownNotesUnread('lark').unread).toBe(false)
    // A later rules change stays unread when notes are acknowledged or undone.
    store.writeOwnInstructions({ profileSlug: 'lark', text: 'New standing rule', whoWroteIt: 'an-agent-direct', author: { profile: 'wren', name: agentName('wren', store.agentIdentities()) }, by: wren, conversation: 'ses-wren', said: 'Clarify again', broughtBack: null, expectedVersion: 1, currentText: 'Standing rule' }, clock++)
    expect(notes().markOwnNotesSeen('lark', edited.version, person)).toBe(true)
    expect(store.instructionUnread('lark').unread).toBe(true)
    notes().undoOwnNotes('lark', { expectedVersion: 2, currentText: 'Person notes' }, person, clock++)
    expect(notes().ownNotesUnread('lark').unread).toBe(false)
    expect(store.instructionUnread('lark').unread).toBe(true)
  })

  it('Undo of the first version appends empty notes and survives restart', () => {
    write('First')
    const undone = notes().undoOwnNotes('lark', { expectedVersion: 1, currentText: 'First' }, person, clock++)!
    expect(undone).toMatchObject({ version: 2, text: '', restoredFromVersion: 0 })
    db.close()
    db = openDatabase(join(folder, 'app.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db, () => clock++)
    expect(notes().ownNotesOf('lark')!.versions[0]).toEqual(undone)
  })

  it('keeps a newer agent write unread after a person save and after a person Undo', () => {
    write('Agent one')
    write('Person two', person, 'lark', { expectedVersion: 1, currentText: 'Agent one' })
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: false, newestAgentVersion: 1, seenThrough: 2 })
    write('Agent three', lark, 'lark', { expectedVersion: 2, currentText: 'Person two' })
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: true, newestAgentVersion: 3, seenThrough: 2 })
    notes().undoOwnNotes('lark', { expectedVersion: 3, currentText: 'Agent three' }, person, clock++)
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: false, newestAgentVersion: 3, seenThrough: 4 })
    write('Agent five', lark, 'lark', { expectedVersion: 4, currentText: 'Person two' })
    expect(notes().markOwnNotesSeen('lark', 2, person)).toBe(true)
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: true, newestAgentVersion: 5, seenThrough: 4 })
  })

  it('acknowledges only the version a person saw and retains a later agent change as unread', () => {
    write('One')
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: true, newestAgentVersion: 1, seenThrough: 0 })
    expect(notes().markOwnNotesSeen('lark', 1, lark)).toBe(false)
    expect(notes().markOwnNotesSeen('lark', 2, person)).toBe(false)
    write('Two', lark, 'lark', { expectedVersion: 1, currentText: 'One' })
    expect(notes().markOwnNotesSeen('lark', 1, person)).toBe(true)
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: true, newestAgentVersion: 2, seenThrough: 1 })
    expect(notes().markOwnNotesSeen('lark', 2, person)).toBe(true)
    expect(notes().markOwnNotesSeen('lark', 1, person)).toBe(true)
    expect(notes().ownNotesUnread('lark')).toEqual({ unread: false, newestAgentVersion: 2, seenThrough: 2 })
    expect(notes().markOwnNotesSeen('missing', 0, person)).toBe(false)
    expect(notes().ownNotesUnread('wren').unread).toBe(false)
  })
})
