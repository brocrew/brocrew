import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, claudeProjectDirName } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { linesOf } from './helpers/provider-lines'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { ImportedRecording } from '../src/shared/runtime-ipc'

/**
 * # 🔴 293 §4 · two hosts can import the same ledger generation (289 rank 3)
 *
 * Every `RuntimeHost` constructs a **private** archive coordinator, and `importRecordedSession`
 * checked only `this.slots.has(sessionId)` — ⚠️ **while `rebuildLedger`, three hundred lines away,
 * correctly consults `workRunningElsewhere`. The asymmetry is the defect.**
 *
 * > *Two RuntimeHosts over one SessionStore press Import on the same no-ledger recording. Their
 * > independent coordinators both pass the absent-ledger check. A starts generation G1; B starts G2,
 * > replacing the single `building` marker. A's guarded promotion changes zero rows and still returns
 * > `imported`. During A's post-promotion collection, G2 is classified dead because `active` is still
 * > the old generation; it can delete B's first batch. B then promotes an empty or prefix-missing G2
 * > and also returns `imported`.*
 *
 * ⛔ **The user is told the import succeeded, twice, about a transcript whose active projection may
 * be empty or truncated.**
 *
 * ## ⚠️ Two real hosts, and the interleaving is PLACED
 *
 * The brief and the reviewer both insist on two real hosts, and they are right: a stand-in
 * `LiveHost` planted in the directory proves what `workRunningElsewhere` answers, not what two
 * importers do to each other. ⚑ **And the moment is placed rather than raced** — host A's
 * `nativeTranscriptPath` seam is where host B presses Import, which is a point inside A's own
 * import, after A has taken whatever claim it takes and before it has read a byte. B's check runs on
 * the microtasks that follow, which all run before A's first read of the file comes back. No sleep,
 * no poll, no dependence on how fast this disk is. ⚑ An import reads files and asks for no
 * credential, so it never calls `prepareProviderHome`, which was this seam until then.
 */

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const migrations = join(here, '../src/main/db/migrations')
const ID = 'sess_child'

describe('293 §4 · one ledger, two hosts, one import', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let hostA: RuntimeHost
  let hostB: RuntimeHost
  /** Host B's press, made from inside host A's import. Null until A gets that far. */
  let pressedByB: Promise<ImportedRecording> | null
  /**
   * How many times host B got as far as looking for the transcript.
   *
   * ⛔ **The reviewer's own standard, in the one form this path can express it**: *"neither losing
   * operation may enter its provider writer"*. An outcome word says what B was told; this says
   * whether B went and did the work anyway.
   */
  let bReachedTheHome: number

  /** Everything a host needs, minus the one seam each test wants to reach into. */
  const deps = (
    lookUp: typeof nativeTranscriptPath,
  ): ConstructorParameters<typeof RuntimeHost>[0] => ({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: lookUp,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    prepareProviderHome: (provider, profileId) => homeOf(provider, profileId),
    providerHomePath: (provider, profileId) => join(dir, 'homes', profileId ?? 'none', provider),
    resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
    newSessionId: () => `sess_${Math.floor(1)}`,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'X',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })

  const homeOf = (provider: Provider, profileId: string): string =>
    join(dir, 'homes', profileId, provider)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-two-hosts-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    pressedByB = null
    bReachedTheHome = 0

    // ⛔ **Host B is built FIRST**, so host A's seam can name it. Construction order is otherwise
    // immaterial: `joinLiveHosts` puts both in the same directory and each excludes itself.
    hostB = new RuntimeHost(
      deps((provider, home, ref) => {
        bReachedTheHome += 1
        return nativeTranscriptPath(provider, home, ref)
      }),
    )
    hostA = new RuntimeHost(
      deps((provider, home, ref) => {
        // ⚑ **The placed moment.** This runs inside A's import, after its check and its claim, and
        // before A reads a byte: B's press starts here, and its check runs on the microtasks after
        // it — before A's first read comes back. Guarded, because B's own import calls its own
        // (plain) seam.
        if (pressedByB === null) pressedByB = hostB.importRecordedSession(ID)
        return nativeTranscriptPath(provider, home, ref)
      }),
    )
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** An app-owned adopted row: found in a home we provisioned, so it carries a profile. */
  function adoptChild(): void {
    store.adopt({
      id: ID,
      provider: 'claude',
      sessionId: `${ID}-thread`,
      cwd: join(dir, 'work'),
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
      child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing' },
    })
  }

  /** The conversation, in the home this app provisioned for it. */
  function plantOwnTranscript(): void {
    const projectDir = join(
      homeOf('claude', 'default'),
      'projects',
      claudeProjectDirName(join(dir, 'work')),
    )
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${ID}-thread.jsonl`), readFileSync(CLAUDE_FIXTURE, 'utf8'))
  }

  it('🔴 admits exactly one claimant, and the other is told the work is in flight', async () => {
    adoptChild()
    plantOwnTranscript()
    expect(store.recorded()[0]?.hasTranscript, 'the fixture must start with nothing to read').toBe(
      false,
    )

    const fromA = await hostA.importRecordedSession(ID)
    const fromB = await pressedByB

    // ⚑ Non-vacuity: B really did press, from inside A's import.
    expect(pressedByB, 'host B never pressed Import — nothing was contended').not.toBeNull()
    // 🔴 The finding: before 293 nothing refused the second press, and both hosts went and did the
    // work — measured, with the claim removed: `['imported', 'skipped']`, two independent derives
    // over one row.
    expect([fromA.outcome, fromB?.outcome].sort()).toEqual(['imported', 'in-use'].sort())
    expect(fromB?.note, 'the loser must say what it saw, not fail').toContain('open right now')
    // ⛔ **And the loser never entered the writer**, which is the reviewer's own standard: an
    // outcome word says what B was told, this says whether B went anyway.
    expect(bReachedTheHome, 'the refused host archived and derived regardless').toBe(0)

    // ⛔ …and the transcript the reader gets is COMPLETE, which is the half an outcome word cannot
    // establish. A truncated projection is exactly what the losing collection could produce.
    const whole = store.events(ID)
    expect(whole.length).toBeGreaterThan(0)
    expect(store.ledgerStatus(ID).present).toBe(true)
    expect(store.ledgerStatus(ID).derived).not.toBe('rebuilding')

    // ⚑ **The control, at the same moment**: with nothing contending, the same row imports the same
    // conversation — so "one claimant" is a rule about contention and not about refusing imports.
    // A second press is `skipped`, which is 119's own answer and proves nothing was left half-done.
    const again = await hostB.importRecordedSession(ID)
    expect(again.outcome).toBe('skipped')
    expect(store.events(ID)).toHaveLength(whole.length)
  })

  /**
   * 🔴 **The other half of rank 3: a promotion that changed nothing used to report an import.**
   *
   * ⚠️ **A store-level test, deliberately, and the reason is that the fix above makes the two-host
   * route to it unreachable.** The ownership claim is what stops a second host opening a generation
   * over the first — so the only way to reach a refused flip now is to open one directly, which is
   * exactly what the losing host used to do. `one-app.test.ts` has described this consequence in a
   * comment since 198 (*"the derive still returns success, so the caller is told the import
   * worked"*) with nothing asserting it.
   */
  it('🔴 the flip reports whether it flipped, and both answers are distinguishable', async () => {
    adoptChild()
    // The losing host's exact position: it opened a generation, and somebody else then replaced the
    // single `building` marker with theirs.
    const mine = store.beginGeneration(ID)
    const theirs = store.beginGeneration(ID)
    expect(theirs, 'the second open must replace the first').toBeGreaterThan(mine)

    expect(
      store.promoteGeneration(ID, mine, { normalizerVersion: 1, derivedThrough: 0 }),
      'a promotion of a generation nobody is holding must say it flipped nothing',
    ).toBe(false)
    // ⚑ The pairing. Without it, a `promoteGeneration` that returned `false` unconditionally would
    // satisfy the line above and break every import in the app.
    expect(
      store.promoteGeneration(ID, theirs, { normalizerVersion: 1, derivedThrough: 0 }),
      'and the holder’s promotion must still flip',
    ).toBe(true)
  })

  it('🔴 a derive whose promotion is refused says `superseded` and leaves the reader whole', async () => {
    adoptChild()
    plantOwnTranscript()
    const archived = await hostB.importRecordedSession(ID)
    expect(archived.outcome, 'the fixture needs a real projection behind it').toBe('imported')
    const wasReadable = store.events(ID).length
    expect(wasReadable).toBeGreaterThan(0)

    // ⚠️ **Placed through `cancelled`, which the derive asks at the top of every batch** — the one
    // hook inside that function a test can reach, and the marker has to be replaced AFTER its own
    // `beginGeneration` rather than before. Keyed on the marker existing rather than on a call
    // count, because `collectDeadGenerations` asks the same predicate first and how many times it
    // asks is not this test's business.
    let replaced = false
    const lines = readFileSync(CLAUDE_FIXTURE, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
    const outcome = await deriveLedger(store, ID, 'claude', linesOf(lines), {
      fallbackAt: 1_000,
      rebuild: true,
      cancelled: () => {
        if (!replaced && store.ledgerStatus(ID).derived === 'rebuilding') {
          replaced = true
          store.beginGeneration(ID) // somebody else's derive, opening its own
        }
        return false
      },
    })

    expect(replaced, 'the marker was never replaced — the derive promoted its own generation').toBe(
      true,
    )
    expect(outcome, 'a derive whose promotion was refused reported success').toBe('superseded')
    // ⛔ **And the reader is untouched.** The projection that is active is still the one that was
    // promoted honestly; a refused flip must cost nothing but the rows it wrote.
    expect(store.events(ID)).toHaveLength(wasReadable)
    expect(store.ledgerStatus(ID).present).toBe(true)
  })
})
