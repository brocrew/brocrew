import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  canonicalAddressOf,
  describeConversationForRead,
  resolveConversationAddress,
} from '../src/main/runtime/conversation-address'

/**
 * # A conversation's address is its first task, in the order tasks were stored
 *
 * The address is the label of the first task recorded in the conversation, root or not, ended or
 * open, never chosen by clock time, and it never changes. No column, no migration: stored order is
 * the `work` row's insertion order.
 *
 * | § | what it pins |
 * |---|---|
 * | 1 | none while it has no task; then its first task's label; a person's conversation opens with its root |
 * | 2 | a later task, and a root added later, leave it unchanged |
 * | 3 | a task stored later with an earlier clock time does not take it over |
 * | 4 | it survives VACUUM, VACUUM INTO and a backup, each reopened |
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const AT = 1_700_000_000_000

describe("a conversation's first task", () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  const ordinals = new Map<string, number>()

  const open = (path: string): void => {
    db = openDatabase(path)
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  }

  /** A conversation; one with no parent is a person's and opens with its root as its first task. */
  const conversation = (id: string, parentSessionId?: string, profileId = 'default'): void => {
    store.create({
      id,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
  }

  /** A piece `giver`'s root gives to `holder`, written at `at`; its label. */
  const given = (giver: string, holder: string, piece: string, at: number): string => {
    const root = store.ensurePersonalRoot(giver, AT)
    const number = store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const ordinal = ordinals.get(holder) ?? 0
    ordinals.set(holder, ordinal + 1)
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title: `the ${piece}`,
        brief: `do ${piece}`,
        folder: null,
        inputs: [],
      },
      ordinal,
      {
        type: 'work_given',
        piece,
        label,
        parent: root.piece,
        givenBy: giver,
        title: `the ${piece}`,
        brief: `do ${piece}`,
      },
      at,
    )
    return label
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-first-task-'))
    ordinals.clear()
    open(join(dir, 'db.sqlite'))
    conversation('sess_pm')
    conversation('sess_lead')
    conversation('sess_dev', 'sess_pm')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('§1 none while it has no task; then the first task’s label; a person’s is its root', () => {
    expect(store.firstTaskOf('sess_pm')).toEqual({
      piece: store.rootOf('sess_pm')?.piece,
      label: store.rootOf('sess_pm')?.label,
    })
    expect(store.firstTaskOf('sess_dev')).toBeNull()
    expect(canonicalAddressOf(store, 'sess_dev')).toBe('sess_dev')
    const first = given('sess_pm', 'sess_dev', 'work_first', AT + 1)
    expect(store.firstTaskOf('sess_dev')).toEqual({ piece: 'work_first', label: first })
  })

  it('§2 a later task, and a root added later, leave it unchanged', () => {
    const first = given('sess_pm', 'sess_dev', 'work_first', AT + 1)
    const later = given('sess_lead', 'sess_dev', 'work_second', AT + 2)
    const root = store.ensurePersonalRoot('sess_dev', AT + 3)
    expect(root.label).not.toBe(first)
    expect(store.firstTaskOf('sess_dev')).toEqual({ piece: 'work_first', label: first })
    for (const address of ['sess_dev', first, later, root.label]) {
      const conversation = resolveConversationAddress(address, store)
      expect(conversation, address).toBe('sess_dev')
      expect(canonicalAddressOf(store, conversation), address).toBe(first)
    }
  })

  it('uses a recorded conversation title, then the latest task title, then the profile', () => {
    store.createAgentIdentity(
      { slug: 'fictional-reader', displayName: 'Fictional Reader', provider: 'claude' },
      null,
    )
    conversation('sess_without_tasks', 'sess_pm', 'fictional-reader')
    expect(describeConversationForRead(store, 'sess_without_tasks').title).toBe('Fictional Reader')
    const address = given('sess_pm', 'sess_dev', 'work_first', AT + 20)
    given('sess_lead', 'sess_dev', 'work_second', AT + 1)
    expect(describeConversationForRead(store, 'sess_dev').line).toBe(
      `conversation ${address} · the work_second`,
    )
    store.append(
      'sess_dev',
      2,
      { type: 'work_retitled', piece: 'work_second', title: 'Current task title', by: null },
      AT + 10,
    )
    expect(describeConversationForRead(store, 'sess_dev').title).toBe('Current task title')
    store.titleConversation(
      'sess_dev',
      3,
      { type: 'titled', title: 'Fictional project', author: { kind: 'person' } },
      AT + 11,
    )
    expect(describeConversationForRead(store, 'sess_dev').line).toBe(
      `conversation ${address} · Fictional project`,
    )
  })

  it('§3 a task stored later with an earlier clock time does not take it over', () => {
    const first = given('sess_pm', 'sess_dev', 'work_stored_first', AT + 50)
    given('sess_lead', 'sess_dev', 'work_stored_later', AT + 1)
    given('sess_pm', 'sess_dev', 'work_same_time', AT + 50)
    expect(store.firstTaskOf('sess_dev')?.label).toBe(first)
  })

  it('§4 it survives VACUUM, VACUUM INTO and a backup, each reopened', async () => {
    given('sess_lead', 'sess_pm', 'work_noise', AT + 1)
    const first = given('sess_pm', 'sess_dev', 'work_first', AT + 9)
    given('sess_lead', 'sess_dev', 'work_second', AT + 2)
    const expected = { piece: 'work_first', label: first }

    db.exec('VACUUM')
    expect(store.firstTaskOf('sess_dev')).toEqual(expected)

    const copy = join(dir, 'vacuumed.sqlite')
    db.prepare('VACUUM INTO ?').run(copy)
    const backup = join(dir, 'backup.sqlite')
    await db.backup(backup)
    db.close()

    for (const path of [copy, backup]) {
      open(path)
      expect(store.firstTaskOf('sess_dev'), path).toEqual(expected)
      db.close()
    }
    open(join(dir, 'db.sqlite'))
  })
})
