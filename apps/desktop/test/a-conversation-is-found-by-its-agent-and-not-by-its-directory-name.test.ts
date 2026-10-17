import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { ForestConversation, TheWholeForest } from '../src/shared/the-whole-forest'

/**
 * D-016a, second commit: a conversation this app placed is the one with an agent identity
 * (`provider_session.agent_identity_id`), and every reader that used to key on the caller's
 * directory name (`provider_session.profile_id`) keys on the identity.
 *
 * The tree removed the old `agent_profile` binding table (`0000_the_tree` dropped it), so there is
 * no binding to plant and none of this file reads one.
 *
 * ## Why a fixture that separates the columns
 *
 * Every older fixture writes `profile_id` and `agent_identity_id` together, so the two columns
 * always agree and a reader keyed on the wrong one passes them all. This file builds the rows
 * where they differ:
 *
 *  - `sess_mixed` has the directory spelling `Worker` and the identity `worker`;
 *  - `sess_pre` has a real identity and NO directory name (a pre-profile row);
 *  - `sess_swept` has neither (adopted out of a home, held by no agent).
 *
 * The counts are chosen so that a wrong key cannot agree by coincidence: by identity 4 are placed
 * and 1 is held, by `profile_id` 3 and 2.
 *
 * The provider is a double, every directory is temporary, and no live app, port, provider home or
 * `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const FROM = NOW - HOUR
const TO = NOW + HOUR

function conversationsOf(forest: TheWholeForest): readonly ForestConversation[] {
  return forest.nodes.rows.filter((row): row is ForestConversation => row.node === 'a-conversation')
}

function nodeFor(forest: TheWholeForest, conversation: string): ForestConversation {
  const found = conversationsOf(forest).find((row) => row.conversation === conversation)
  if (found === undefined) throw new Error(`no node for ${conversation}`)
  return found
}

describe('a conversation is found by its agent and not by its directory name', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let ordinals: Map<string, number>

  const tick = (): number => clock++

  /** Append one event to a session's ledger, allocating the next ordinal. */
  const at = (
    sessionId: string,
    createdAt: number,
    event: Parameters<SessionStore['append']>[2],
  ): void => {
    const next = ordinals.get(sessionId) ?? 0
    ordinals.set(sessionId, next + 1)
    store.append(sessionId, next, event, createdAt)
  }

  const rowCount = (where: string): number =>
    (
      db.prepare(`SELECT count(*) AS n FROM provider_session WHERE ${where}`).get() as {
        n: number
      }
    ).n

  const rawProfileId = (sessionId: string): string | null =>
    (
      db.prepare('SELECT profile_id FROM provider_session WHERE id = ?').get(sessionId) as {
        profile_id: string | null
      }
    ).profile_id

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-by-identity-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-by-identity-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    ordinals = new Map()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_by_identity_${String(tick())}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

    // The placed conversation every other row hangs off.
    store.create({
      id: 'sess_pm',
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId: 'project-manager',
    })
    // The directory spelling `Worker` and the identity `worker`, spawned by the manager.
    store.create({
      id: 'sess_mixed',
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId: 'Worker',
      parentSessionId: 'sess_pm',
    })
    // A pre-profile row: a real identity and no directory name.
    store.create({
      id: 'sess_pre',
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId: DEFAULT_PROFILE_ID,
    })
    db.prepare("UPDATE provider_session SET profile_id = NULL WHERE id = 'sess_pre'").run()
    // Swept out of a provider home: no identity and no directory name, held by no agent.
    store.adopt({
      id: 'sess_swept',
      provider: 'claude',
      sessionId: 'ext_1',
      cwd: workspace,
      profileId: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    // A placed child of the unplaced conversation.
    store.create({
      id: 'sess_kid',
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId: 'builder',
      parentSessionId: 'sess_swept',
    })

    at('sess_pre', NOW, { type: 'turn', state: 'completed' })
    at('sess_swept', NOW, { type: 'turn', state: 'completed' })
    at('sess_mixed', NOW, { type: 'turn', state: 'completed' })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  it('a conversation is placed by its identity: one with no directory name is placed, and one with no identity is held by no agent', () => {
    // Premise: the fixture separates the columns, or nothing below means anything.
    expect(rowCount('1 = 1')).toBe(5)
    expect(rowCount('profile_id IS NULL')).toBe(2)
    expect(rowCount('agent_identity_id IS NULL')).toBe(1)
    expect(rawProfileId('sess_mixed')).toBe('Worker')
    expect(rawProfileId('sess_pre')).toBeNull()
    expect(rawProfileId('sess_swept')).toBeNull()

    const forest = host.theWholeForest()

    // The set first, so a missing node fails as a set mismatch and not as a helper throw.
    expect(
      conversationsOf(forest)
        .map((row) => row.conversation)
        .sort(),
    ).toEqual(['sess_kid', 'sess_mixed', 'sess_pm', 'sess_pre'])
    expect(nodeFor(forest, 'sess_pre').identity).toBe('brobot')
    expect(nodeFor(forest, 'sess_mixed').identity).toBe('worker')

    // The positive: four are placed, the pre-profile row among them. The negative: the one with no
    // identity is held by no agent. By profile_id these would be 3 and 2.
    expect(forest.conversations).toBe(4)
    expect(forest.heldByNoAgent).toBe(1)
    expect(store.placedConversations()).toBe(4)
    expect(store.conversationsHeldByNoAgent()).toBe(1)
    expect(store.placedConversations() + store.conversationsHeldByNoAgent()).toBe(rowCount('1 = 1'))
  })

  it('the digest window reads placed conversations by identity, so a pre-profile row is in it and a conversation no agent holds is not', () => {
    const window = store.digestWindow(FROM, TO)

    const inTheWindow = [...new Set(window.rows.map((row) => row.sessionId))].sort()
    // The positive: the pre-profile row (identity, no directory name) and the mixed-case row.
    expect(inTheWindow).toContain('sess_pre')
    expect(inTheWindow).toContain('sess_mixed')
    // The negative from the same read: the stranger has an event and no identity, and is out.
    expect(inTheWindow).not.toContain('sess_swept')
    expect(inTheWindow).toEqual(['sess_mixed', 'sess_pre'])
    // The ledgers are the placed conversations, whether or not they produced an event.
    expect(window.ledgers).toBe(4)

    expect(host.digest(FROM, TO).heldByNoAgent).toBe(1)
  })

  it("every reader answers the identity's folded slug and never the directory's spelling", () => {
    // The fixture really does separate the two spellings.
    expect(rawProfileId('sess_mixed')).toBe('Worker')
    expect(store.conversationBinding('sess_pm')?.identity).toBe('project-manager')

    expect(store.identityOf('sess_mixed')).toEqual({ profileSlug: 'worker' })
    expect(store.conversationBinding('sess_mixed')).toEqual({
      provider: 'codex',
      identity: 'worker',
    })
    // The pre-profile row answers its identity although its directory name is NULL.
    expect(store.conversationBinding('sess_pre')?.identity).toBe('brobot')

    const children = store.spawnedBy('sess_pm')
    expect(children.rows.map((row) => row.conversation)).toEqual(['sess_mixed'])
    expect(children.rows[0]?.identity).toBe('worker')

    // The negative, over everything a reader hands out: the directory's spelling reaches no answer,
    // and the identity's does.
    const text = JSON.stringify({
      forest: host.theWholeForest(),
      children,
      breadcrumb: host.whoCalledWhom('sess_mixed'),
      binding: store.conversationBinding('sess_mixed'),
    })
    expect(text).toContain('"identity":"worker"')
    expect(text).not.toContain('Worker')
  })

  it('a conversation no agent holds is still a row a breadcrumb can point at, and still has a child list', () => {
    // The placed parent reads in the same shape, so the unplaced one differs only in its identity.
    expect(host.whoCalledWhom('sess_mixed').parent).toEqual({
      conversation: 'sess_pm',
      identity: 'project-manager',
      provider: 'codex',
      running: 'not-running',
    })

    expect(store.conversationBinding('sess_swept')).toEqual({ provider: 'claude', identity: null })
    expect(host.whoCalledWhom('sess_kid').parent).toEqual({
      conversation: 'sess_swept',
      identity: null,
      provider: 'claude',
      running: 'not-running',
    })

    const children = host.whoCalledWhom('sess_swept').children
    expect(children.walk).toBe('every-conversation-this-one-spawned')
    expect(children.rows).toEqual([
      {
        conversation: 'sess_kid',
        identity: 'builder',
        provider: 'codex',
        running: 'not-running',
      },
    ])
  })
})
