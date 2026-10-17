import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { agentIdentityRowId, foldProfileName } from '../src/main/db/identity'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { isPathSegment, profileAlreadyNamed } from '../src/shared/runtime-ipc'

/**
 * # 🔴 238 · two names, one home (208 H1, re-verified by 231)
 *
 * `Developer` and `developer` are ONE directory on the shipped macOS volume format — **measured,
 * not assumed**: the volume holding `~/Library/Application Support/@brobot2/desktop/provider-homes`
 * answers `lstat` for either spelling and `mkdir` of the variant creates no second dirent (APFS,
 * case-insensitive and case-preserving). An identity keyed on the stored spelling verbatim lets the
 * ledger hold two identities over one home, each with its own answer to *"whose memory is this"*.
 *
 * ⛔ **166 makes that consequential**: memory follows the identity, so two rows would disagree about
 * whose memory a home holds. ⚠️ **And the caller that meets it is not a person** — a PM giving work
 * through an MCP tool never touches the renderer, where case-insensitive uniqueness is enforced
 * (168 M5).
 *
 * ## ⛔ What was decided, and why it is 187's ruling rather than a new one
 *
 * 187 ruled that a case-fold variant is **REFUSED, never folded**, and that ruling is about
 * CREATION. It is also volume-independent on purpose: *"recording the variant spelling would make a
 * profile a different profile depending on the disk it lives on."* So the app has already decided
 * that two spellings are ONE profile on both volume types — and the database says the same thing:
 *
 *  - the derived id folds (`db/identity.ts`), so one identity has one key (`aid:<folded slug>`);
 *  - `agent_identity.slug` is stored folded (`agent_identity_slug_folded_ck`), so `id` and `slug`
 *    re-derive from each other;
 *  - `agent_identity_slug_uq` is `COLLATE NOCASE`, so the TABLE refuses the second row;
 *  - ⚑ **`provider_session.profile_id` is untouched.** It is the free string that names a
 *    DIRECTORY, four path derivations read it, and a row recorded under `Developer` still resumes
 *    into `Developer`'s home. What folded is the identity, not the path.
 *
 * ⚠️ **On a case-SENSITIVE volume** `Developer` and `developer` really are two directories, and
 * folding them makes one identity out of two homes. That is still the right answer — it is 187's,
 * and the alternative is a profile that means something different depending on the disk.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * U+212A, which looks exactly like an ASCII `K` and is not one. Written as an escape because a
 * test whose subject is which characters fold together cannot afford an invisible one.
 */
const KELVIN_SIGN = '\u212A'

interface SessionRow {
  id: string
  profile_id: string | null
  agent_identity_id: string | null
}
interface IdentityRow {
  id: string
  slug: string
}

describe('238 · one identity per home, in the database (208 H1)', () => {
  let dir: string
  let db: AppDatabase

  const sessions = (): SessionRow[] =>
    db
      .prepare('SELECT id, profile_id, agent_identity_id FROM provider_session ORDER BY id')
      .all() as SessionRow[]
  const identities = (): IdentityRow[] =>
    db.prepare('SELECT id, slug FROM agent_identity ORDER BY id').all() as IdentityRow[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-collision-'))
  })
  afterEach(() => {
    try {
      db.close()
    } catch {
      // some tests close it themselves
    }
    rmSync(dir, { recursive: true, force: true })
  })

  describe('⛔ §1 · the writer cannot make a second identity out of a second spelling', () => {
    let store: SessionStore

    beforeEach(() => {
      db = openDatabase(join(dir, 'db.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
    })

    const start = (id: string, profileId: string): void => {
      store.create({ id, provider: 'claude', cwd: dir, approvalMode: 'ask', profileId })
    }

    it('🔴 two spellings are ONE identity, not two', () => {
      start('sess_upper', 'Developer')
      start('sess_lower', 'developer')

      expect(identities()).toEqual([{ id: agentIdentityRowId('developer'), slug: 'developer' }])
      // ⛔ The defect, stated as its inverse: before 238 these were two identities — one per
      // spelling — over one directory.
      expect(sessions().map((row) => [row.id, row.agent_identity_id])).toEqual([
        ['sess_lower', agentIdentityRowId('developer')],
        ['sess_upper', agentIdentityRowId('developer')],
      ])
    })

    it('⚑ …and the free string keeps every spelling, because it is the DIRECTORY name', () => {
      start('sess_upper', 'Developer')
      start('sess_lower', 'developer')

      // ⚠️ The half that must NOT fold. `resumeSession` derives the home from this column, so
      // folding it would send a session to a directory it never ran in — 149's failure shape.
      expect(sessions().map((row) => row.profile_id)).toEqual(['developer', 'Developer'])
    })

    // ⚑ **D-016 · *the CURRENT session answers for either spelling* went with `currentSessionFor`**,
    // which no product code called; the fold it measured is the identity's, and the case above and
    // the one below still measure it.

    it('⛔ …and the identity NAMES itself in the folded form, however it was spelled', () => {
      start('sess_upper', 'Developer')
      expect(store.identityOf('sess_upper')).toEqual({ profileSlug: 'developer' })
    })

    it('🔴 the TABLE refuses the second spelling, past every caller', () => {
      start('sess_lower', 'developer')
      // Straight at the schema, and since D-016 the schema that answers is `agent_identity`'s —
      // `agent_identity_slug_folded_ck` beside `agent_identity_slug_uq COLLATE NOCASE` — not
      // `identityRowFor` remembering to fold. Without it, a hand-written id and slug could put the
      // two rows back.
      expect(() =>
        db
          .prepare('INSERT INTO agent_identity (id, slug, created_at) VALUES (?,?,1)')
          .run('aid:Developer', 'Developer'),
      ).toThrow(/CHECK constraint failed: agent_identity_slug_folded_ck/)
      expect(identities()).toHaveLength(1)

      // ⚑ The pairing: a genuinely different identity is still a different row. A guard that
      // refused everything would pass the assertion above and break the product.
      db.prepare('INSERT INTO agent_identity (id, slug, created_at) VALUES (?,?,1)').run(
        agentIdentityRowId('writer'),
        'writer',
      )
      expect(identities()).toHaveLength(2)
    })

    it('⚠️ the fold is ASCII, because SQLite’s is — and `toLowerCase` is not', () => {
      // ⛔ Three folders have to agree: `foldProfileName`, the schema's `lower()` CHECK, and the
      // index's `NOCASE`. SQLite without ICU folds `A`-`Z` and nothing else, so a JavaScript
      // `toLowerCase()` would derive `aid:dév` for a row the database keys as `dÉv` — one identity
      // split in two, which is 208 H1 with the fix in place.
      const sqliteLower = (value: string): string =>
        (db.prepare('SELECT lower(?) AS folded').get(value) as { folded: string }).folded
      for (const name of ['Developer', 'DEV_1', 'dÉv', 'ÅÄÖ', 'default', 'ß', 'İstanbul']) {
        expect(foldProfileName(name), `foldProfileName disagreed with SQLite on ${name}`).toBe(
          sqliteLower(name),
        )
      }
      // …and the one that proves the corpus is not vacuous: `toLowerCase` really does differ here.
      expect('dÉv'.toLowerCase()).not.toBe(foldProfileName('dÉv'))
    })

    it('⚠️ …and it is deliberately NOT the matcher’s fold, because the VOLUME folds more than ASCII', () => {
      // ⛔ **Measured on the volume this ships to**, not assumed: `mkdir K` (U+212A, the Kelvin sign)
      // beside an existing `k` creates no second dirent, and `Éx` resolves to `éx`. So
      // `profileAlreadyNamed` — which asks *which DIRECTORY does this name name* — has to keep
      // folding the way the disk does, while `foldProfileName` has to keep agreeing with SQLite.
      // Unifying them would make one of the two wrong, and this is the assertion that says so.
      expect(profileAlreadyNamed(KELVIN_SIGN, ['k'])).toBe('k')
      expect(foldProfileName(KELVIN_SIGN)).not.toBe('k')

      // ⚠️ **Outside ASCII the two folds do disagree** — this is what that costs, and what stops it
      // from mattering. ⛔ The guard is the ALPHABET: `isPathSegment` bounds every name that can
      // reach `agent_identity`, and not only at the wire — `listProviderHomes` filters every DIRENT
      // through it and `read-bundle.ts` refines `meta.profileId` with it (203). So the pair below
      // cannot both exist as profiles, and the assertions after it are what would break first if
      // either of those two guards were ever relaxed.
      expect(agentIdentityRowId('Éx')).not.toBe(agentIdentityRowId('éx'))
      expect(isPathSegment('Éx'), 'the alphabet stopped bounding the fold').toBe(false)
      expect(isPathSegment(KELVIN_SIGN), 'the alphabet stopped bounding the fold').toBe(false)
      // ⚑ …and the paired positive: an ASCII variant, which IS legal, folds the same way in both.
      expect(isPathSegment('Developer')).toBe(true)
      expect(profileAlreadyNamed('Developer', ['developer'])).toBe('developer')
      expect(agentIdentityRowId('Developer')).toBe(agentIdentityRowId('developer'))
    })
  })

  describe('⛔ §2 · a bundle that names the variant joins the identity', () => {
    it('⛔ …and a bundle that arrives naming the variant joins that identity instead of forking it', async () => {
      // ⚠️ The door `assertProfileMayBeCreated` does not guard: `adopt` and `importSnapshot` reach
      // `identityRowFor` without passing the create rule, so before 238 this is how a second identity
      // appeared on a machine that had never typed the variant — from a `.brobot` bundle, or from a
      // dirent the sweep found. (`isPathSegment` bounds the ALPHABET at both, and permits any case.)
      //
      // ⛔ **The bundle arrives FIRST, and the order is the whole test** (review). With a native
      // `developer` session created before it, the folded row already exists and the adopt's
      // `INSERT OR IGNORE` is ignored — so the assertion was satisfied by the OTHER writer and stayed
      // green under the mutation that stops `identityRowFor` folding. This way round, the bundle's
      // spelling is the one that creates the row.
      db = openDatabase(join(dir, 'db.sqlite'))
      applyMigrations(db, migrationsFolder)
      mkdirSync(join(dir, 'cwd'), { recursive: true })
      const store = createSessionStore(db)
      store.adopt({
        id: 'sess_from_bundle',
        provider: 'claude',
        sessionId: 'thread-from-a-bundle',
        cwd: join(dir, 'cwd'),
        profileId: 'DEVELOPER',
        createdAt: 1,
        updatedAt: 2,
      })
      // ⛔ The row the bundle brought into existence is the folded one, keyed and NAMED that way —
      // the identity since D-016, which writes no binding.
      expect(identities()).toEqual([{ id: 'aid:developer', slug: 'developer' }])
      expect(store.identityOf('sess_from_bundle')?.profileSlug).toBe('developer')

      // …and a native launch in the same profile then JOINS it rather than forking a second one.
      store.create({
        id: 'sess_native',
        provider: 'claude',
        cwd: join(dir, 'cwd'),
        approvalMode: 'ask',
        profileId: 'developer',
      })
      expect(identities()).toHaveLength(1)
      expect(sessions().map((row) => [row.id, row.agent_identity_id])).toEqual([
        ['sess_from_bundle', 'aid:developer'],
        ['sess_native', 'aid:developer'],
      ])
      // ⚑ …while the bundle's own spelling is still on its row, so its home is still its home.
      expect(sessions().find((row) => row.id === 'sess_from_bundle')?.profile_id).toBe('DEVELOPER')
    })
  })
})
