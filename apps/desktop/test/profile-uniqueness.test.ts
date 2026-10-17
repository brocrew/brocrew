import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  HOME_FOLDER,
  assertProfileMayBeOpened,
  createProviderAuthOps,
  deriveProviderHome,
  listProfileIds,
  listProviderHomes,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { DEFAULT_PROFILE_ID, profileAlreadyNamed } from '../src/shared/runtime-ipc'

/**
 * ⛔ **Profile uniqueness, enforced where the caller will not be a person** (187 §1, from 168 M5).
 *
 * ## What was measured at `a333ba3`
 *
 * The case-fold rule existed in exactly one place: `NewConversation.vue`. The IPC schema validated
 * SHAPE (`isPathSegment`) and stopped; `prepareProviderHome` provisioned the raw spelling. So
 * `Developer` beside an existing `developer` gave **two homes on a case-sensitive volume, or two row
 * identities over ONE directory on macOS** — same profile id, two ledgers, one memory.
 *
 * A project manager creates agents through an MCP tool without touching the renderer. Profile
 * uniqueness must therefore be enforced beyond the Vue path.
 *
 * ## How the two ends are made to agree
 *
 * ⚠️ **169 §1's shape, one field over.** There is ONE matcher — `profileAlreadyNamed`, in
 * `shared/runtime-ipc.ts` — and neither end restates it: the launcher's `profileRefusal` called it,
 * and `prepareProviderHome` calls it. What differs is the POLICY over its answer, and only in the
 * one case where the two callers genuinely want different things (see the exact-match tests below).
 * A drift would need somebody to write a second matcher, which is what `M1` in
 * `scripts/mutations/187/` does.
 *
 * ## 🔴 417 (HO-022 §2) removed the launcher end, and this file is now the WHOLE of the rule
 *
 * ⛔ **`profile-select`, the `+ New profile…` row, the name box and `profile-refusal` are gone** —
 * *"Opening a new conversation opens a conversation with BroBot. That is all."* — so no person can
 * name a profile through the app at all, and the front door sends `profileId: 'default'`, a
 * constant. ⚑ **Nothing in this file changed, and that is the finding, not a coincidence**: every
 * test below goes through the WIRE (schema → dispatch → host) or straight at `profileAlreadyNamed`
 * and `prepareProviderHome`, exactly as `187 §1` designed it — *"a rule that lives only in a Vue
 * file is a rule the path on the roadmap does not have."* The Vue file is gone; the rule is not.
 *
 * ⚠️ **So this file has stopped being the second half of a pair and become the only half.** 187's
 * own premise — the MCP-spawning PM that never touches the renderer — is now the ONLY caller
 * shape there is, which makes the boundary enforcement load-bearing rather than defence in depth.
 * ⛔ **Do not narrow anything here on the grounds that the UI cannot reach it.**
 *
 * ⛔ **The ruling is REFUSE, not fold.** Folding `Developer` to `developer` would send a value that
 * is not the one on screen — the objection this codebase already records for trimming a profile
 * name — and refusing is the only answer that is correct on a case-insensitive volume (where they
 * are one directory) and on a case-sensitive one (where they are two) at the same time.
 */

const here = dirname(fileURLToPath(import.meta.url))

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('a profile name is unique at the boundary — since 417, the only place it is (187 §1)', () => {
  let userData: string
  let runtimes: Map<Provider, FakeRuntime>

  /** The real provisioning: a launch is what CREATES a profile, so the directory has to land. */
  async function realHome(provider: Provider, profileId: string): Promise<string> {
    return await prepareProviderHome(
      userData,
      { profileId, provider },
      // Only the CREDENTIAL seams are stubbed. `provisionHome` is the real one: the whole subject
      // here is what is on disk afterwards.
      { provisionCodexAuth: () => {}, claudeAuthHealth: () => ({ ok: true }) },
    )
  }

  function buildHost(
    overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
  ): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      // ⚠️ One adapter per provider for the whole test, not one per host: a resume asks the
      // provider for a session it issued, and a fresh double has never issued anything.
      createRuntime: (provider) => {
        const known = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, known)
        return known
      },
      prepareProviderHome: realHome,
      providerHomePath: (provider, profileId) =>
        deriveProviderHome(userData, { profileId, provider }),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      listProfiles: () => listProfileIds(userData),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'x',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  /** Launch through the WIRE — schema, dispatch, host. No renderer, no Vue, no component. */
  async function launch(host: RuntimeHost, profileId: string): Promise<void> {
    await executeRuntimeCommand(host, new NullSink(), {
      kind: 'createSession',
      provider: 'claude',
      profileId,
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-profile-unique-'))
    runtimes = new Map()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * ⚑ **592 · a spelling of BroBot's own slug that differs only in CASE, derived rather than
   * typed** (`HO-078` §2).
   *
   * ⛔ **This file spelled it `'Default'` in four places**, and the rename made every one of them a
   * variant of a name nothing answers to — **so four refusals stopped being refused and the suite
   * said so.** ⚠️ `a-fixture-that-types-the-value-it-is-about` does not survive a rename of that
   * value; this one does.
   *
   * 🔴 **It is asserted to DIFFER from the stored spelling below**, because a loud variant equal to
   * the stored one would ask the fold about a string that never needed folding
   * (`a-positive-assertion-must-differ-from-the-default`).
   */
  const A_LOUD_SPELLING_OF_IT = DEFAULT_PROFILE_ID.toUpperCase()

  describe('the matcher itself — one rule, and it answers one question', () => {
    it('⚑ 592 · the case variant this file drives really is a DIFFERENT spelling', () => {
      expect(A_LOUD_SPELLING_OF_IT).not.toBe(DEFAULT_PROFILE_ID)
      expect(A_LOUD_SPELLING_OF_IT.toLowerCase()).toBe(DEFAULT_PROFILE_ID)
    })

    it('an exact spelling is the profile it names', () => {
      expect(profileAlreadyNamed('developer', ['default', 'developer'])).toBe('developer')
    })

    it('⛔ a case variant is the SAME profile, spelled differently', () => {
      expect(profileAlreadyNamed('Developer', ['default', 'developer'])).toBe('developer')
      expect(profileAlreadyNamed('DEVELOPER', ['default', 'developer'])).toBe('developer')
      expect(profileAlreadyNamed('deVeLoPeR', ['default', 'developer'])).toBe('developer')
    })

    it('⚠️ …and the DEFAULT profile is not exempt from it', () => {
      // `listProfileIds` always puts the default in the answer, on disk or not, so this is the one
      // collision that is reachable on a fresh install with nothing provisioned at all.
      expect(profileAlreadyNamed(A_LOUD_SPELLING_OF_IT, [DEFAULT_PROFILE_ID])).toBe(
        DEFAULT_PROFILE_ID,
      )
    })

    it('⚑ a genuinely new name is null — the paired positive, or the rule refuses everything', () => {
      expect(profileAlreadyNamed('writer', ['default', 'developer'])).toBeNull()
      expect(profileAlreadyNamed('developer2', ['default', 'developer'])).toBeNull()
      // Not a substring match, not a prefix match: `dev` is its own profile.
      expect(profileAlreadyNamed('dev', ['default', 'developer'])).toBeNull()
    })

    it('⛔ on a tree that already holds BOTH spellings, the exact one wins', () => {
      // Reachable: a case-sensitive volume, or a tree copied from one. Answering `Developer` with
      // `developer` there would send a session to the other profile's memory.
      expect(profileAlreadyNamed('Developer', ['developer', 'Developer'])).toBe('Developer')
      expect(profileAlreadyNamed('developer', ['Developer', 'developer'])).toBe('developer')
    })
  })

  describe('⛔ through the IPC path, with no renderer involved', () => {
    it('refuses a case variant of a profile that exists, and NAMES the one it collided with', async () => {
      const host = buildHost()
      await launch(host, 'developer')
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])

      // ⛔ This is the MCP tool's path: a command on the wire, a schema that passes it (the spelling
      // is a perfectly legal path segment), and a host that has to be the one to say no.
      await expect(launch(host, 'Developer')).rejects.toThrow(/spelled differently/)
      await expect(launch(host, 'Developer')).rejects.toThrow(/"developer"/)
      await host.closeAll()
    })

    it('⛔ …and the refused launch created NOTHING — the rule does not unlock itself on retry', async () => {
      const host = buildHost()
      await launch(host, 'developer')
      await expect(launch(host, 'Developer')).rejects.toThrow()

      // ⚠️ The listing, not `existsSync`: this test runs on a case-insensitive volume, where
      // `existsSync(.../Developer)` is TRUE the moment `developer` exists and can prove nothing.
      // `listProfileIds` reads real dirents, so it answers with the spelling that is actually there.
      // Had the check run AFTER provisioning, a `Developer` would be in this list, the second
      // attempt would find an exact match, and the third would be allowed.
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      await expect(launch(host, 'Developer')).rejects.toThrow()
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      await host.closeAll()
    })

    it('⚑ the paired positive — the SAME spelling launches, and lands in the one home', async () => {
      // Without this, a rule that refused every profile id would satisfy the test above.
      const host = buildHost()
      await launch(host, 'developer')
      await launch(host, 'developer')

      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      expect(existsSync(join(userData, 'provider-homes', HOME_FOLDER, 'developer'))).toBe(true)
      await host.closeAll()
    })

    it('⚑ …and a genuinely new profile is still created — a launch IS how one comes into existence', async () => {
      const host = buildHost()
      await launch(host, 'developer')
      await launch(host, 'writer')
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer', 'writer'])
      await host.closeAll()
    })

    it('⛔ a variant of the DEFAULT profile is refused on a fresh install, with nothing on disk', async () => {
      // The default is in `listProfileIds`'s answer whether or not anything has been written for it,
      // so this collision exists before the first launch — and it is the one that would have split
      // BroBot's own identity in two.
      const host = buildHost()
      await expect(launch(host, A_LOUD_SPELLING_OF_IT)).rejects.toThrow(/spelled differently/)
      await host.closeAll()
    })
  })

  /**
   * 🟠 **265 §4 · the awaited home lock is a new interleaving point** (259 lens B finding 4).
   *
   * ⛔ **A correct fix moved a cost somewhere nobody was looking, for the eighth time in this
   * slice.** `243` made the provider-home wait yield in-process rather than block the main thread —
   * right, and it fixed a real freeze. But uniqueness is decided synchronously and the home is then
   * awaited, while `provisionProviderHome` creates the profile ANCESTOR before awaiting the provider
   * LEAF lock and `listProfileIds` counts a profile only once a leaf exists. So for the whole of a
   * contended wait the profile is half-made and invisible, and a second creation differing only in
   * case passed the same check. On the shipped case-insensitive volume both spellings then alias one
   * folder, credential set and memory; on a case-sensitive one they are two homes the database
   * deliberately folds to a single `agent_profile` identity.
   *
   * ⚠️ **Not the old sequential finding** (`187` §1, above): those checks are all issued after the
   * first creation has finished. This one is issued while it is suspended, which is a state that did
   * not exist before 243.
   */
  describe('265 §4 · a creation in flight is a profile that exists', () => {
    /** A home that does not land until a test says so — 243's contended leaf lock, made explicit. */
    function heldHome(): {
      release: () => void
      prepareProviderHome: (provider: Provider, profileId: string) => Promise<string>
    } {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let first = true
      return {
        release,
        prepareProviderHome: async (provider, profileId) => {
          if (first) {
            first = false
            await held
          }
          return await realHome(provider, profileId)
        },
      }
    }

    it('🔴 a case variant asked for while the first creation waits on its home is refused', async () => {
      const gate = heldHome()
      const host = buildHost({ prepareProviderHome: gate.prepareProviderHome })
      const creating = launch(host, 'developer')

      // ⚠️ **Non-vacuity, and it is the whole mechanism.** The first creation really is suspended,
      // and while it is, nothing on disk names the profile — which is why the second one used to
      // pass a check that reads the disk.
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID])

      await expect(launch(host, 'Developer')).rejects.toThrow(/spelled differently/)
      await expect(launch(host, 'Developer')).rejects.toThrow(/"developer"/)

      gate.release()
      await creating
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      await host.closeAll()
    })

    it('⚑ …and the SAME spelling asked for while it waits is still admitted', async () => {
      // Without this, the refusal above is satisfied by a host that serialized every creation — and
      // two conversations starting in one profile at once is the ordinary case, not a collision.
      const gate = heldHome()
      const host = buildHost({ prepareProviderHome: gate.prepareProviderHome })
      const creating = launch(host, 'developer')
      const beside = launch(host, 'developer')

      gate.release()
      await Promise.all([creating, beside])
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      await host.closeAll()
    })

    it('⛔ a creation that FAILS releases the name, rather than reserving it for the app run', async () => {
      // The claim is held across an await and dropped in a `finally`. A version that released only
      // on success would make one failed launch refuse that profile for the rest of the session —
      // 149's stranded conversation, arriving through the fix for a race.
      const host = buildHost({
        prepareProviderHome: () => Promise.reject(new Error('the home could not be prepared')),
      })
      await expect(launch(host, 'developer')).rejects.toThrow(/could not be prepared/)

      const second = buildHost()
      await launch(second, 'developer')
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])
      await host.closeAll()
      await second.closeAll()
    })

    it('⛔ a variant that appears from OUTSIDE this host while the home is prepared is refused', async () => {
      // ⚠️ **The revalidation, and it is not the same check twice.** The claim above covers this
      // host; the triggering lock can be held by another process, so the answer given before the
      // await can be stale by the time it lands. Modelled as the reviewer describes it: the other
      // spelling exists by the time we look again. ⛔ Our OWN spelling is filtered out of the list,
      // which is what stops this being an assertion that cannot fail — the home has just been
      // created, so an unfiltered list answers with us every time.
      let landed = false
      const host = buildHost({
        prepareProviderHome: async (provider, profileId) => {
          const home = await realHome(provider, profileId)
          landed = true
          return home
        },
        listProfiles: () =>
          landed ? [...listProfileIds(userData), 'Developer'] : listProfileIds(userData),
      })

      await expect(launch(host, 'developer')).rejects.toThrow(/spelled differently/)
      await host.closeAll()
    })

    it('⚑ …and a tree that has ALWAYS held both spellings still launches into the exact one', async () => {
      // 🔴 **The regression the revalidation nearly shipped, found by reading the diff back.**
      // `187`'s ruling is that on a tree holding both `dev` and `Dev` — a case-sensitive volume, or
      // one copied from it — *"the exact one wins"*, and the matcher test above pins it. A
      // revalidation that asked its question against the whole list would refuse a launch into
      // EITHER spelling, permanently, on a tree the app itself may have written. So it asks only
      // about spellings that APPEARED while the home was being prepared.
      const host = buildHost({ listProfiles: () => [DEFAULT_PROFILE_ID, 'dev', 'Dev'] })
      await launch(host, 'dev')
      await launch(host, 'Dev')
      await host.closeAll()
    })
  })

  describe('⛔ RESUME is not creation, and refusing there would strand a conversation', () => {
    /**
     * ⚠️ **This is the finding a test written for the first draft produced.**
     *
     * The check started life inside `prepareProviderHome`, which is the resume path too. On the
     * default macOS volume format `mkdir Developer` beside `developer` creates nothing — the
     * listing keeps saying `developer` — so a row recorded under `Developer` **before** this rule
     * existed (which is precisely what 168 M5 describes happening) has no `Developer` in
     * `listProfileIds`, and the resume of that conversation was refused. 149's failure shape,
     * arriving as the fix for a different one.
     */
    it('the home derivation itself refuses nothing — it is a path, not a policy', async () => {
      mkdirSync(join(userData, 'provider-homes', HOME_FOLDER, 'developer', 'claude'), {
        recursive: true,
      })
      // The id a legacy row carries. `prepareProviderHome` is what resume calls with it.
      await expect(realHome('claude', 'Developer')).resolves.not.toThrow()
      expect(await realHome('claude', 'Developer')).toContain(`${HOME_FOLDER}/Developer/`)
    })

    it('⚑ …and on this volume that path IS the folder the session already ran in', async () => {
      // The fact the whole ruling rests on, asserted rather than assumed: these two spellings are
      // one directory here, which is why letting the recorded one through loses nothing.
      const home = await realHome('claude', 'developer')
      mkdirSync(home, { recursive: true })
      expect(existsSync(await realHome('claude', 'Developer'))).toBe(true)
    })
  })

  /* ------------------- 197 §2 · the doors that are not a launch (from 190 H2) */

  describe('⛔ a credential gesture may OPEN a profile and may not create one (from 190 H2)', () => {
    /**
     * ## ⛔ What 190 measured
     *
     * `assertProfileMayBeCreated` is on session creation and nowhere else — deliberately, because
     * putting it on `prepareProviderHome` strands the rows the describe above protects. ⚠️ **But the
     * three credential gestures never touch session creation, and every one of them PROVISIONS a
     * home before it asks its question.** So `{kind:"checkProviderAuth", provider:"codex",
     * profileId:"Default"}` — a schema-valid command a stale renderer or an MCP caller can send —
     * manufactured the exact second spelling the create boundary promises to refuse.
     *
     * ⛔ **A read-looking question created identity**, and a gesture that then FAILED left the
     * directory behind: `homeFor` provisions before the transport is built, and nothing rolls back.
     */
    const ops = (): ReturnType<typeof createProviderAuthOps> =>
      createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-such-codex') })

    /** The profile directories really on disk, by their real dirent spelling, once each. */
    const spellings = (): string[] => [
      ...new Set(listProviderHomes(userData).map((home) => home.profileId)),
    ]

    it('the matcher: exact opens, a variant is refused by name, and a new name is refused', () => {
      expect(() => assertProfileMayBeOpened('developer', ['default', 'developer'])).not.toThrow()
      expect(() => assertProfileMayBeOpened('Developer', ['default', 'developer'])).toThrow(
        /spelled differently/,
      )
      expect(() => assertProfileMayBeOpened('Developer', ['default', 'developer'])).toThrow(
        /"developer"/,
      )
      expect(() => assertProfileMayBeOpened('writer', ['default', 'developer'])).toThrow(
        /there is no profile "writer"/,
      )
      // ⚑ The default needs no exception: `listProfileIds` always contains it, on disk or not, so
      // the app's own first Codex sign-in is an exact hit.
      expect(() => assertProfileMayBeOpened(DEFAULT_PROFILE_ID, [DEFAULT_PROFILE_ID])).not.toThrow()
    })

    it('⛔ `checkProviderAuth` on a case variant of the DEFAULT profile creates nothing', async () => {
      // 190 H2's exact command, on a fresh install where no physical default home exists.
      await expect(ops().check('codex', A_LOUD_SPELLING_OF_IT)).rejects.toThrow(
        /spelled differently/,
      )
      expect(spellings()).toEqual([])
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID])
    })

    it('⛔ …and on a case variant of a REAL profile, which is the two-homes half', async () => {
      const host = buildHost()
      await launch(host, 'developer')
      await host.closeAll()

      await expect(ops().check('codex', 'Developer')).rejects.toThrow(/"developer"/)
      // ⚠️ The dirent spellings, not `existsSync`: this volume is case-insensitive, so
      // `existsSync(.../Developer)` is true the moment `developer` exists and proves nothing.
      expect(spellings()).toEqual(['developer'])
    })

    it('⛔ …and a profile nobody has ever started is refused rather than brought into being', async () => {
      await expect(ops().check('codex', 'writer')).rejects.toThrow(/there is no profile "writer"/)
      expect(spellings()).toEqual([])
    })

    it('⛔ all THREE gestures take the same door — it is fixed for the class, not the command', async () => {
      // ⚑ `homeFor` is the one function each of them calls, so the rule is on the door rather than
      // repeated at three call sites: the fourth gesture gets it without anybody remembering.
      await expect(ops().check('codex', 'writer')).rejects.toThrow(/no profile/)
      expect(() => ops().reprovision('codex', 'writer')).toThrow(/no profile/)
      await expect(ops().signIn('codex', 'writer')).rejects.toThrow(/no profile/)
      expect(spellings()).toEqual([])
    })

    it('⚑ the paired positive — the exact spelling opens, and provisions its Codex home', async () => {
      // Without this, "refuse everything" would pass every test above. A gesture against a profile
      // that exists must still reach the provider: this one gets past the rule and dies on the
      // deliberately absent binary, having created the home it was asked about.
      const host = buildHost()
      await launch(host, 'developer') // a Claude launch: the codex home does not exist yet
      await host.closeAll()
      expect(existsSync(join(userData, 'provider-homes', HOME_FOLDER, 'developer', 'codex'))).toBe(
        false,
      )

      await ops()
        .check('codex', 'developer')
        .catch(() => undefined)
      expect(existsSync(join(userData, 'provider-homes', HOME_FOLDER, 'developer', 'codex'))).toBe(
        true,
      )
      expect(spellings()).toEqual(['developer'])
    })

    it('⛔ the host says WHY, instead of reporting it as a provider that would not answer', async () => {
      // ⚠️ **086, at the one place this refusal crosses to a person.** `checkProviderAuth` turns
      // every throw into *"Could not ask codex about this profile's sign-in"* — true of a spawn
      // that hung, and false of this, where the app declined to ask and knows exactly why. Still
      // `unknown`, because we genuinely did not ask; the sentence is what differs.
      const host = buildHost({ providerAuth: ops() })
      const said = await host.checkProviderAuth('codex', A_LOUD_SPELLING_OF_IT)
      expect(said.state).toBe('unknown')
      const reason = said.state === 'usable' ? '' : said.reason
      expect(reason).toMatch(/spelled differently/)
      expect(reason).not.toMatch(/Could not ask/)
      expect(spellings()).toEqual([])
      await host.closeAll()
    })

    it('⚠️ Claude gestures never reach a home at all, so the rule is not theirs to apply', () => {
      // Claude keeps no credential in the profile home — `claudeKeychainTokenProvider` re-reads the
      // machine login per launch — and these two arms refuse before `homeFor` is called. Asserted
      // through the arms that touch neither the Keychain nor the disk.
      expect(() => ops().reprovision('claude', 'writer')).toThrow(/machine login/)
      expect(spellings()).toEqual([])
    })
  })

  describe('⛔ …and the door 197 must NOT put a rule on: resuming a pre-187 row', () => {
    /**
     * ⚠️ **187's measured trap, asserted through the real resume path this time.**
     *
     * The describe above proves `prepareProviderHome` refuses nothing. This proves the consequence
     * that matters: a conversation whose row was written under `Developer` — before the create rule
     * existed, on a volume where `mkdir Developer` beside `developer` creates nothing, so
     * `listProfileIds` has never contained it — **still reopens**. ⛔ A refusal on this path would
     * strand it permanently, which is 149's failure shape arriving as the fix for a different one.
     */
    it('a row recorded under a spelling that is not in the profile list still reopens', async (ctx) => {
      // ⚠️ **darwin only** (T-001): its premise is a case-insensitive disk (APFS), where `Developer` is `developer`.
      // CI runs on Linux and skips it; the Mac's own gate runs it.
      ctx.skip(process.platform !== 'darwin')
      const dir = mkdtempSync(join(tmpdir(), 'brobot2-profile-resume-'))
      const db = openDatabase(join(dir, 'brobot2.sqlite'))
      try {
        applyMigrations(db, join(here, '../src/main/db/migrations'))
        const store = createSessionStore(db)
        const host = buildHost({ store })
        // Launched under `Developer` while the rule did not exist — which is exactly what 168 M5
        // describes happening, and what the create boundary refuses today.
        const sink = new NullSink()
        const created = await host.createSession(
          { provider: 'claude', profileId: 'Developer' },
          sink,
        )
        await host.close(created.sessionId, sink)

        // ⛔ **And then the folder is the other spelling.** A tree copied from a case-sensitive
        // volume, or a directory made by an earlier launch — either way the dirent says `developer`
        // and the row says `Developer`, so `listProfileIds` has never contained the recorded id.
        const homes = join(userData, 'provider-homes', HOME_FOLDER)
        renameSync(join(homes, 'Developer'), join(homes, 'developer'))
        expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID, 'developer'])

        const relaunched = buildHost({ store })
        const resumed = await relaunched.resumeSession(created.sessionId, new NullSink())
        expect(resumed.sessionId).toBe(created.sessionId)
        // ⚑ …and it landed in the folder it already ran in, rather than making a second one.
        expect([...new Set(listProviderHomes(userData).map((home) => home.profileId))]).toEqual([
          'developer',
        ])
        await relaunched.closeAll()
        await host.closeAll()
      } finally {
        db.close()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('the rule is asked against the list the HOST sees', () => {
    it('a profile under another project is not a collision here', () => {
      // `listProfileIds` walks only `HOME_FOLDER` (D-016), and the host asks it: a `developer` in a
      // folder beside it names a home no launch can open, so refusing against it would refuse a
      // name for a reason the caller could neither see nor act on.
      // ⚑ It read "the list the launcher sees" until 417 (HO-022 §2) — there is no launcher menu
      // any more, and the scoping is the HOST's, which is where it always had to be enforced.
      mkdirSync(join(userData, 'provider-homes', 'other', 'developer', 'claude'), {
        recursive: true,
      })
      expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID])
      expect(profileAlreadyNamed('Developer', listProfileIds(userData))).toBeNull()
    })
  })
})
