import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { DigestReading } from '../src/shared/digest'

/**
 * 🔴 **D-016 · a digest is ONE list, and the words it says about that list are counted, not typed.**
 *
 * ⛔ **What this file pins, and why it is a file of its own.** D-016 took projects out of the
 * digest, which turned a digest per project into ONE window over every conversation an agent of
 * this app holds. ⚠️ **That moved four numbers and six sentences onto the flat reading**, and the
 * tests that already stood there each use a fixture where the wrong derivation and the right one
 * AGREE — one row per covered conversation, one agent, one conversation nobody holds, a walk word
 * this build can spell, a count of one or of two and never of both.
 *
 * ## ⚑ The numbers, over a fixture where they all differ
 *
 * ⛔ **`ledgers`, `sessions`, the rows and the line's count are four different numbers**, and a
 * fixture in which two of them coincide cannot tell one derivation from the other. §1 plants
 * THREE placed conversations under two agents, TWO of which recorded something, in FOUR rows, and
 * then adopts a fifth conversation no agent holds: 3, 2, 4 and 4. ⚠️ **It is a real database and a
 * real `RuntimeHost`**, because the count of what was walked is the store's and the count of what
 * was covered is the host's, and a fold handed a list can be wrong about neither.
 *
 * The window no longer draws this reading (Recent activity reads its own); what is here is the
 * host's count.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const HOUR = 3_600_000
const TO = 1_800_000_000_000
const FROM = TO - 12 * HOUR
/** Comfortably inside the window, and not on either boundary. */
const INSIDE = TO - HOUR

const ONE_LIST = 'one-window-over-every-agents-conversation' as const

let dir: string
let userData: string
let db: AppDatabase
let store: SessionStore
let hosts: RuntimeHost[]
let ordinals: Map<string, number>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-d016-digest-'))
  userData = mkdtempSync(join(tmpdir(), 'brobot2-d016-digest-host-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
  hosts = []
  ordinals = new Map()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const host of hosts) await host.closeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

/** A conversation an agent of this app holds, so the digest's join can reach it. */
function conversation(id: string, profileId: string): void {
  store.create({ id, provider: 'codex', cwd: dir, approvalMode: 'ask', profileId })
}

/** Append one event, allocating the session's next ordinal so a test never has to count. */
function at(id: string, when: number, event: Parameters<SessionStore['append']>[2]): void {
  const next = ordinals.get(id) ?? 0
  ordinals.set(id, next + 1)
  store.append(id, next, event, when)
}

/**
 * ⛔ **A row of a type the digest SELECTS whose payload cannot be parsed** — written straight into
 * the table, because no writer in this app can produce one (`the-night-the-digest-could-not-
 * describe.test.ts`'s own helper, and the same damage).
 */
function tornRow(id: string, sessionId: string, when: number): void {
  const next = ordinals.get(sessionId) ?? 0
  ordinals.set(sessionId, next + 1)
  db.prepare(
    `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, next, 'turn', '{"type":"tur', when, null, 0)
}

function aHost(): RuntimeHost {
  const sessions = new FakeProviderSessions()
  let counter = 0
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
    prepareProviderHome: (provider: Provider, profileId?: string) => {
      const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_host_${String(++counter)}`,
    now: () => TO,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
  hosts.push(host)
  return host
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the numbers · one list, every covered conversation counted once
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the host reads every agent’s conversations as one list', () => {
  /**
   * ⛔ **Three placed conversations, two agents, two that recorded something, four rows.** Each
   * of the numbers the reading carries has a DIFFERENT answer here: `ledgers` 3, `sessions` 2,
   * the rows' count 4, and the one line's count 4 beside them.
   */
  function seedTwoAgents(): void {
    conversation('sess_a1', 'agent-a')
    conversation('sess_a2', 'agent-a')
    conversation('sess_b', 'agent-b')
    at('sess_a1', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_a1', INSIDE + 1_000, { type: 'turn', state: 'completed' })
    at('sess_b', INSIDE, { type: 'turn', state: 'completed' })
    at('sess_b', INSIDE + 1_000, { type: 'turn', state: 'completed' })
    // ⚠️ **Placed and quiet**: its one row is BEFORE the window, so it is a ledger the read opened
    // and a conversation the window did not see.
    at('sess_a2', FROM - HOUR, { type: 'turn', state: 'completed' })
  }

  /** The four things the two readings below must agree on, asserted over the same fixture. */
  function pinsOneList(one: DigestReading): void {
    const { digest } = one
    expect(digest.read.walk).toBe(ONE_LIST)
    // ⛔ **The placed conversations — not the rows (4) and not the covered ones (2).**
    expect(digest.read.ledgers).toBe(3)
    // ⛔ **Distinct conversations that recorded something**, counted off the rows and never as
    // the rows: two agents, two rows each.
    expect(digest.sessions).toBe(2)
    // ⚑ **One group, one line**: two agents under two profiles fold into ONE observation, and it
    // counts all four turns. A digest per agent would draw two lines of two.
    const turns = digest.lines.filter((line) => line.kind === 'turn-ended')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.count).toBe(4)
    expect(turns[0]?.text).toBe('4 turns ended — 4 completed.')
    expect(digest.lines.map((line) => line.kind)).toEqual(['turn-ended'])
  }

  it('🔴 one digest reads every agent’s conversations as ONE list, counts each covered conversation once, and counts a conversation no agent holds only as held by no agent', () => {
    seedTwoAgents()
    const host = aHost()

    const before = host.digest(FROM, TO)
    pinsOneList(before)
    // ⚑ **The paired positive, taken BEFORE the stranger exists**: the same three numbers and the
    // same line with nothing held by no agent, so the change below is the adopted row's alone.
    expect(before.heldByNoAgent).toBe(0)

    // ⛔ **A conversation found in the user's own provider home**: no agent of this app holds it.
    store.adopt({
      id: 'sess_stranger',
      provider: 'claude',
      sessionId: 'ext_1',
      cwd: dir,
      profileId: null,
      updatedAt: INSIDE,
      createdAt: INSIDE,
    })
    // ⚠️ **A FAILED turn, on purpose**: if the stranger's row leaked into the fold the sentence
    // would read "5 turns ended — 4 completed, 1 failed", and the equality above could not hold.
    at('sess_stranger', INSIDE, { type: 'turn', state: 'failed' })

    const after = host.digest(FROM, TO)
    pinsOneList(after)
    expect(after.heldByNoAgent).toBe(1)
    const text = after.digest.lines.map((line) => line.text).join(' ')
    expect(text).not.toContain('5 turns')
    expect(text).not.toContain('failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · a torn row, in D-016's words
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · a row the digest could not read', () => {
  it('⚠️ a torn row in one agent’s conversation says, in the D-016 words, that part of what happened is missing from every line above', () => {
    // ⚑ **The row is unreadable on purpose and `console.warn` is not the subject.**
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    conversation('sess_a', 'agent-a')
    at('sess_a', INSIDE, { type: 'turn', state: 'completed' })
    const host = aHost()

    // ⚑ **The paired positive, BEFORE the row is planted**: a whole record draws no such gap and
    // the card says what happened, so the words below are the tear's and no default's.
    const whole = host.digest(FROM, TO)
    expect(whole.digest.read.rowsUnread).toBe(0)
    expect(whole.digest.gaps.map((gap) => gap.kind)).not.toContain('source-unreadable')

    tornRow('torn_1', 'sess_a', INSIDE + 1)
    const torn = host.digest(FROM, TO)
    expect(torn.digest.read.rowsUnread).toBe(1)
    expect(torn.digest.read.ledgers).toBe(1)
    const holes = torn.digest.gaps.filter((gap) => gap.kind === 'source-unreadable')
    expect(holes).toHaveLength(1)
    expect(holes[0]?.count).toBe(1)
    // ⛔ **The whole sentence, verbatim** — `the-night §1` pins only its prefix, and the second
    // half is D-016's: what THIS app dropped is a row nothing else here can stand in for.
    expect(holes[0]?.says).toBe(
      '1 row of the record this digest reads could not be read, so part of what happened here is missing from every line above. ⚠️ Nothing records why, and a row this app dropped is a row nothing else here can stand in for.',
    )
    // ⛔ **A line WAS drawn, and the torn record is still said beside it.**
    expect(torn.digest.lines.length).toBeGreaterThan(0)
  })
})
