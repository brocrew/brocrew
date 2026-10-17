import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { HOME_FOLDER } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **369 · an identity that outlives a project** (HO-009 §4, HO-010 ruling 6, `359` §2.5).
 *
 * A profile such as `notes-app-explorer` must keep its expertise across projects.
 * Project-scoped identity would create a fresh home and empty memory for each ticket.
 *
 * ⚑ **The shape built here, and it is additive:** a global `agentIdentityRowId` row carrying
 * what accumulates, an explicit home locator replacing path-derivation-by-convention, today's
 * `agent_profile` rows re-read as execution-project BINDINGS, and a SESSION — not an identity —
 * supplying the project.
 *
 * 🔴 **The hard constraint every section below is written around: every existing id and every
 * existing provider-home path stays byte-identical. Nothing moves on disk.**
 *
 * ⚑ **D-016 · the second project is gone.** Every case that placed a conversation in one — through
 * the store's `projectSlug`, which D-016 removed — went with it (§1's two bindings and its two
 * project-naming cases, §2's home in a second project, §4's list over two bindings). What stays is
 * the identity, its home, its grant, the migrations and the launch rail, none of which needed a
 * second project to be true.
 *
 * ⚑ **D-016 commit 2 · a conversation is found by its agent, and every home lives under
 * `default`.** The home locator went — `agent_identity_home` and `home_project_segment` are no
 * longer written or read, `homeSegmentOf`, `sessionHomeSegment` and `homeAddress` are deleted, and a
 * home is `provider-homes/<HOME_FOLDER>/<profile>/<provider>` — so §2, which measured the locator,
 * went whole; §1's numbering is `agent-profile-identity.test.ts`'s (and §5's), and went too.
 *
 * ⚑ **D-016 commit 3 · the tree.** The database is ONE migration (`0000_the_tree.sql`), so `0018` on
 * an upgrading ledger (§3) and the role it added (§7) went with the history, and so did the
 * `agent_profile` table whose kept columns §6 censused. `spawn_agent` is gone and with it
 * `profile-already-live`: a give REACHES the giver's existing conversation with that agent instead of
 * refusing, so §5's refusal and the census of its readers went too. ⛔ What is left is the grant (§4)
 * and a person opening one identity twice with no rail at all (§5).
 */

/** Any channel at all — none of these tests is about who is behind one. */
class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'owner:1'
  alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('369 · an identity that outlives a project', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-identity-'))
  })
  afterEach(() => {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const migrated = (): AppDatabase => {
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    return db
  }

  // ⚑ **D-016 · §1 and §2 are gone.** §1 numbered two conversations of one identity across two
  // projects; with no second project that is the per-identity rotation `agent-profile-identity.test.ts`
  // measures, and §5's person-opened pair below. §2 measured the home LOCATOR — a recorded segment
  // per identity and per session, and `main/index.ts`'s `homeAddress` reading it — which D-016
  // deleted: every home is under `HOME_FOLDER`, and a session's own `profile_id` spelling is the
  // directory it resumes into (`profile-collision.test.ts` §1 and §3).

  // ⚑ **D-016 commit 3 · §3 is gone** — `0018` on an upgrading ledger. The database is ONE
  // migration, so there is no ledger from before it to upgrade.

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what the grant surface shows, and what a grant belongs to
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('🔴 §4 · a grant belongs to the IDENTITY, not to the binding', () => {
    let userData: string
    let store: SessionStore
    let host: RuntimeHost
    let folders: string[]
    let counter: number

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-identity-grant-'))
      folders = ['default']
      counter = 0
      migrated()
      store = createSessionStore(db)
      host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        listProfiles: () => folders,
        prepareProviderHome: (provider, profileId) => {
          const home = join(userData, 'provider-homes', HOME_FOLDER, profileId, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider, profileId) =>
          join(userData, 'provider-homes', HOME_FOLDER, profileId, provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    })
    afterEach(async () => {
      await host.closeAll()
      rmSync(userData, { recursive: true, force: true })
    })

    // ⚑ **D-016 · *lists one row for an identity that has worked in two projects* went with
    // placement** — its two bindings came from the store's `projectSlug`, which D-016 removed.

    /**
     * ⛔ **The write and the read-back key on ONE row now**, which is why
     * `assertThePinnedProject` is gone: `355`'s review found the write keyed on the constant while
     * the read-back keyed on the caller's slug — *"a silent write into the wrong row, reported as
     * there is nothing here"* — and a global identity leaves nothing for the two to disagree about.
     */
    it('⛔ a grant made while working one ticket is what the door reads on the next', async () => {
      store.create({
        id: 'sess_a',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'explorer',
      })
      // ⚑ **D-016 · `takesWorkFrom` is gone from the grant**, so the edit names the five that are left.
      const saved = host.setCapabilities('explorer', {
        maxDepth: 3,
        canCreateAgents: null,
        canWriteRules: null,
        canMessage: null,
        canAssignWork: null,
      })
      expect(saved?.capabilities.maxDepth).toBe(3)
      expect(saved?.chosen).toEqual({
        maxDepth: 'chosen',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      })

      // ⚑ **D-016 · the next ticket's conversation binds to `default` like the first** — it was
      // placed in a second project, and placement is gone.
      store.create({
        id: 'sess_b',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'explorer',
      })
      expect(store.capabilitiesOf('explorer')?.maxDepth).toBe(3)
      // ⚑ **D-016 commit 3** · there is no binding table at all any more, so there is no row but the
      // identity's for the grant to be on.
    })

    /**
     * ⛔ **Criterion 12 through the configuration door, unchanged.** An identity exists when the
     * database says so, and the grant surface may not bring one into being.
     *
     * ⚠️ **This said *"— after a conversation has actually run as it —"* until 558**, and `419` had
     * falsified it: `createAgentIdentity` writes a row and nothing else, so an identity that has
     * never run is an ordinary member of the list. ⛔ **The test is unchanged and so is what it
     * measures** — a slug with NO row, configured, stays absent — which is the half that was never
     * about how a row comes to exist.
     */
    it('⛔ still refuses to configure an identity that does not exist, and creates nothing', () => {
      expect(
        host.setCapabilities('nobody', {
          maxDepth: 3,
          canCreateAgents: null,
          canWriteRules: null,
          canMessage: null,
          canAssignWork: null,
        }),
      ).toBeNull()
      expect(db.prepare('SELECT count(*) AS n FROM agent_identity').get()).toEqual({ n: 0 })
    })

    /**
     * ⚑ **A folder without a row is still reported as what it is.** The comparison's folder side
     * reads the pinned subtree and its row side now reads identities — the set difference is the
     * same question it always was.
     */
    it('⚑ a directory with no identity row is still named as an orphan, and creates nothing', () => {
      folders = ['default', 'Explorer', 'ghost']
      store.create({
        id: 'sess_a',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'Explorer',
      })
      const list = host.agentIdentities()
      // ⛔ Folded before compared: `Explorer/` and the row `explorer` are one identity.
      expect(list.foldersWithoutARow).toEqual(['default', 'ghost'])
      expect(db.prepare('SELECT count(*) AS n FROM agent_identity').get()).toEqual({ n: 1 })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the live-session refusal, and the chokepoint it is held to
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('🔴 §5 · what `profile-already-live` is keyed by, and where it applies', () => {
    // ⚑ **D-016 commit 3 · `profile-already-live` is gone**, with `spawn_agent`: a give REACHES the
    // giver's existing conversation with that agent (one conversation per helper per giver) instead
    // of refusing a second, so the provider-blind refusal and the census of the liveness fact's
    // readers went with the rail. ⛔ What stays is the half that was never about the rail: a PERSON
    // opening one identity twice meets nothing at all.

    /**
     * ⚑ **The asymmetry, stated as a test rather than left as a comment.** A PERSON opens the same
     * identity on both providers with no friction at all, and each open is a conversation of its own
     * (an agent's give, since D-016, reaches the one conversation it already has with that agent).
     */
    it('⚑ a PERSON may open the same identity twice, on either provider, with no rail at all', async () => {
      const userData = mkdtempSync(join(tmpdir(), 'brobot2-identity-person-'))
      const work = mkdtempSync(join(tmpdir(), 'brobot2-identity-person-work-'))
      migrated()
      let counter = 0
      const host = new RuntimeHost({
        store: createSessionStore(db),
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        listProfiles: () => ['default', 'worker'],
        prepareProviderHome: (provider, profileId) => {
          const home = join(userData, 'provider-homes', HOME_FOLDER, profileId, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider, profileId) =>
          join(userData, 'provider-homes', HOME_FOLDER, profileId, provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      try {
        const sink = new NullSink()
        const a = await host.createSession(
          { provider: 'codex', profileId: 'worker', cwd: work, approvalMode: 'ask' },
          sink,
        )
        const b = await host.createSession(
          { provider: 'claude', profileId: 'worker', cwd: work, approvalMode: 'ask' },
          sink,
        )
        expect(a.sessionId).not.toBe(b.sessionId)
        // ⛔ …and both are the one identity, because the identity is the life.
        expect(
          db.prepare('SELECT id, agent_identity_id FROM provider_session ORDER BY id').all(),
        ).toEqual([
          { id: a.sessionId, agent_identity_id: 'aid:worker' },
          { id: b.sessionId, agent_identity_id: 'aid:worker' },
        ])
      } finally {
        await host.closeAll()
        rmSync(userData, { recursive: true, force: true })
        rmSync(work, { recursive: true, force: true })
      }
    })
  })

  // ⚑ **D-016 commit 3 · §6 and §7 are gone** — the capability columns `0018` kept on
  // `agent_profile` and the `role` column it added. Neither the table nor the column is in the one
  // migration, so there is nothing left to read or to leave unwritten.
})
