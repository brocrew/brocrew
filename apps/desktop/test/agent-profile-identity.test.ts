import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { agentIdentityRowId } from '../src/main/db/identity'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * **The identity the database could not name** (Slice 2 · 204, from 194 H5).
 *
 * The finding: start two sessions for the exact profile `developer` and you get two unrelated rows
 * that happen to spell one name, sharing one provider home, both saying `profile_id='developer',
 * rotation=0` — so the database held two rows for one target identity and could not say which was
 * current. The first domain model had specified the answer since Slice 1 (a profile is keyed
 * `project + slug`; a provider session is keyed `agent_profile + rotation`) and `schema.ts:14-18`
 * listed the tables as a Slice-2 extension point. Nothing built them.
 *
 * ⛔ **What is asserted here is the identity, and what is NOT is one-live-per-profile.** The domain
 * model's *"at most one live provider session per profile"* cannot be armed against this app: one
 * real `smoke:ui` pass has 232 overlapping same-profile live pairs, 83 of them both mid-turn, 5 even
 * when scoped to a single folder — and 166's shipped *"a developer remembers across projects"* is
 * one of them. `§"a profile may hold more than one LIVE session, and that is measured rather than
 * assumed"` pins that decision so it cannot be quietly reversed.
 *
 * ⚑ **D-016 · a conversation is found by its agent, and the identity is `agent_identity`.** D-016
 * stopped writing the `agent_profile` binding, and its commit 3 made the database ONE migration
 * (`0000_the_tree.sql`) without the `agent_profile` and `project` tables, `agent_profile_id` or the
 * `rotation` column. So every case below asks the identity (`agent_identity`, keyed by its folded
 * slug) what it used to ask the binding; `currentSessionFor` — which had no product caller — went
 * with it, and so did every case about a session's position (`rotation`), the SQL twin of an id
 * derivation (no migration derives one now) and the binding's `display_name`. ⚑ The provider's own
 * rotation in the REF is still kept, and is still pinned.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

interface SessionRow {
  id: string
  profile_id: string | null
  agent_identity_id: string | null
  adopted_at: number | null
}

describe('the agent-profile identity', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  const rowsOf = (): SessionRow[] =>
    db
      .prepare(
        'SELECT id, profile_id, agent_identity_id, adopted_at FROM provider_session ORDER BY id',
      )
      .all() as SessionRow[]
  const rowFor = (id: string): SessionRow =>
    db
      .prepare(
        'SELECT id, profile_id, agent_identity_id, adopted_at FROM provider_session WHERE id = ?',
      )
      .get(id) as SessionRow

  const start = (id: string, profileId: string): void => {
    store.create({ id, provider: 'claude', cwd: dir, approvalMode: 'ask', profileId })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-identity-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the tables the domain model specified and nobody built', () => {
    it('keys an identity by its slug, and a session by its identity', () => {
      start('sess_a', 'developer')

      expect(db.prepare('SELECT id, slug FROM agent_identity').all()).toEqual([
        { id: agentIdentityRowId('developer'), slug: 'developer' },
      ])
      // ⛔ **D-016 · no binding.** A conversation is found by its agent, through this column.
      expect(rowFor('sess_a')).toMatchObject({
        agent_identity_id: agentIdentityRowId('developer'),
      })
      // ⚑ **D-016** · `identityOf` says the identity's slug and nothing else.
      expect(store.identityOf('sess_a')).toEqual({ profileSlug: 'developer' })
    })

    it('derives one row for one identity however many sessions ask for it', () => {
      start('sess_a', 'developer')
      start('sess_b', 'developer')
      start('sess_c', 'developer')

      expect(db.prepare('SELECT count(*) n FROM agent_identity').get()).toEqual({ n: 1 })
    })

    it('gives two different profiles two identities, and neither constrains the other', () => {
      start('sess_dev', 'developer')
      start('sess_def', 'default')

      expect(rowFor('sess_dev').agent_identity_id).toBe(agentIdentityRowId('developer'))
      expect(rowFor('sess_def').agent_identity_id).toBe(agentIdentityRowId('default'))
    })

    it('refuses a session that names an identity which does not exist', () => {
      start('sess_a', 'developer')

      // A real foreign key, not a free string beside the free string it replaces. Without this the
      // relation would be exactly as unenforced as `profile_id` always was.
      expect(() =>
        db
          .prepare('UPDATE provider_session SET agent_identity_id = ? WHERE id = ?')
          .run(agentIdentityRowId('nobody'), 'sess_a'),
      ).toThrow(/FOREIGN KEY constraint failed/)
      expect(rowFor('sess_a').agent_identity_id).toBe(agentIdentityRowId('developer'))
    })
  })

  describe('rotation, which used to be the provider’s zero', () => {
    // ⚑ **D-016 commit 3 · the `rotation` COLUMN is gone** — its position in a profile's life, the
    // unique index it was allocated against, and the number a profile-less bundle kept in it. What
    // is left is the provider's own number, in the REF.

    it('leaves the provider’s own rotation in the ref, untouched', () => {
      store.adopt({
        id: 'sess_bundle',
        provider: 'claude',
        sessionId: 'claude-thread',
        cwd: dir,
        profileId: 'developer',
        rotation: 7,
        createdAt: 1,
        updatedAt: 2,
      })

      const ref = JSON.parse(
        (
          db
            .prepare('SELECT external_ref FROM provider_session WHERE id = ?')
            .get('sess_bundle') as {
            external_ref: string
          }
        ).external_ref,
      ) as { rotation: number }
      // The ref is the provider's handle and resume validates against it: it keeps the 7 it arrived
      // with.
      expect(ref.rotation).toBe(7)
    })
  })

  describe('a profile may hold more than one LIVE session, and that is measured rather than assumed', () => {
    it('does not refuse a second session while the first is still live', () => {
      start('sess_0', 'developer')
      start('sess_1', 'developer')

      const live = db
        .prepare(
          `SELECT count(*) n FROM provider_session
            WHERE agent_identity_id = ? AND status IN ('idle','working','waiting_permission')`,
        )
        .get(agentIdentityRowId('developer'))
      // ⛔ **Two live sessions for one profile, on purpose.** The first domain model said *"at most one
      // live provider session"*, and a partial unique index over live rows would enforce it — at the
      // cost of refusing 232 launches measured in a single real `smoke:ui` pass, 166's
      // two-projects-one-`developer` among them.
      expect(live).toEqual({ n: 2 })
    })
  })

  describe('the two nulls in profile_id, which are not one value', () => {
    it('gives a conversation from the user’s OWN home no profile at all', () => {
      store.adopt({
        id: 'sess_user_home',
        provider: 'claude',
        sessionId: 'thread-in-user-home',
        cwd: dir,
        profileId: null,
        createdAt: 1,
        updatedAt: 2,
      })

      const row = rowFor('sess_user_home')
      expect(row.profile_id).toBeNull()
      // ⛔ NOT `default`. `homeProfileOf` (188 §1, from 168 M6): `adopted_at` non-null and
      // `profile_id` null is a conversation swept out of `~/.claude` / `~/.codex`, whose bytes we
      // never owned. Giving it a profile would claim a home of ours holds it.
      expect(row.agent_identity_id).toBeNull()
      expect(store.identityOf('sess_user_home')).toBeNull()
      expect(db.prepare('SELECT count(*) n FROM agent_identity').get()).toEqual({ n: 0 })
    })

    it('still gives an adopted conversation from OUR home a profile', () => {
      store.adopt({
        id: 'sess_our_home',
        provider: 'claude',
        sessionId: 'thread-in-our-home',
        cwd: dir,
        profileId: 'developer',
        createdAt: 1,
        updatedAt: 2,
      })

      // The paired positive: the null rule is about the null, not about adoption.
      expect(rowFor('sess_our_home').agent_identity_id).toBe(agentIdentityRowId('developer'))
      expect(store.identityOf('sess_our_home')?.profileSlug).toBe('developer')
    })

    it('does not let two user-home rows constrain each other', () => {
      for (const id of ['sess_u1', 'sess_u2', 'sess_u3']) {
        store.adopt({
          id,
          provider: 'claude',
          sessionId: `thread-${id}`,
          cwd: dir,
          profileId: null,
          createdAt: 1,
          updatedAt: 2,
        })
      }
      // All three are unattributed, and all three were written — the sweep of one user home
      // produced 22 of them.
      expect(rowsOf().map((r) => [r.id, r.agent_identity_id])).toEqual([
        ['sess_u1', null],
        ['sess_u2', null],
        ['sess_u3', null],
      ])
    })
  })

  describe('the two columns that landed as shape only (§3)', () => {
    // ⚑ **D-016 commit 3** · the other, the binding's `display_name`, went with `agent_profile`.
    it('has a parent_session_id that nothing writes, and that a real session id satisfies', () => {
      start('sess_parent', 'developer')
      start('sess_child', 'developer')
      expect(
        db
          .prepare('SELECT count(*) n FROM provider_session WHERE parent_session_id IS NOT NULL')
          .get(),
      ).toEqual({ n: 0 })

      db.prepare('UPDATE provider_session SET parent_session_id = ? WHERE id = ?').run(
        'sess_parent',
        'sess_child',
      )
      expect(
        db.prepare('SELECT parent_session_id FROM provider_session WHERE id = ?').get('sess_child'),
      ).toEqual({ parent_session_id: 'sess_parent' })

      // A real self-FK, not a free string: it is a session BroBot spawned as a session, which is
      // what makes it different from `child_descent`'s recorded JSON.
      expect(() =>
        db
          .prepare('UPDATE provider_session SET parent_session_id = ? WHERE id = ?')
          .run('sess_nothing', 'sess_child'),
      ).toThrow(/FOREIGN KEY constraint failed/)
    })
  })
})
