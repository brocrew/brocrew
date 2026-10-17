import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { provisionCodexAuth } from '@brobot2/runtime'
import {
  DEFAULT_PROFILE_ID,
  HOME_FOLDER,
  listProfileIds,
  prepareProviderHome,
  providerHomesRoot,
} from '../src/main/runtime/provider-homes'
import {
  fixture,
  mustNameScratch,
  removeFixtures,
} from '../../../scripts/test/fixtures/a-planted-user-data.mjs'

/**
 * 🔴 **What `pnpm clean-base` does to the launcher's profile menu — asked of the product** (352).
 *
 * ## ⛔ Why this test is in `apps/desktop` and not beside the script
 *
 * The launcher’s profile menu is read through {@link listProfileIds}. Script-only assertions
 * about removed paths cannot establish that the product menu is empty.
 *
 * ⚑ **Two derivations — in the tests that run the script.** The fixture is built by hand from
 * `providerHomesRoot`/`HOME_FOLDER`, torn down by the SCRIPT (which spells that layout for
 * itself, in `.mjs` that imports none of it), and read back through the product function the
 * launcher calls. Rename `PROVIDER_HOMES_DIRNAME` and those tests go red.
 *
 * ⚠️ **The first test is deliberately ONE derivation and proves something narrower** (352 review):
 * it plants and reads through the same two constants and never runs the script, so what it
 * establishes is that `listProfileIds` ignores what is INSIDE a leaf — the reading `351` got wrong
 * — and nothing about the address.
 *
 * ## 🔴 539 · this file's TITLE is the DEFAULT's headline, not the script's property
 *
 * ⛔ **`--keep-profile-auth` promises the opposite of the name on this file, and both behaviours
 * have tests here** — the default at `after a clean base the launcher offers default` and the flag
 * two tests below it. ⚑ **So the title is under-scoped rather than false**, and the `it` that
 * carries the exception opens by continuing its sentence (*"…and --keep-profile-auth keeps every
 * one of them"*) rather than contradicting it in silence. ⚠️ A test title is a claim in this
 * project, like a docblock and a column name, and this one is left as it is with its scope written
 * down instead.
 *
 * 🔴 **What WAS wrong is that the flag's credential half had no oracle whose subject was the
 * credential.** *"credential and name together"* asserted only the name: `listProfileIds` plus
 * *"it is still a clean base"*, and nothing in the body opened a file. ⛔ **A flag that stopped
 * keeping credentials tomorrow would have gone red only in the STALENESS test at the foot of this
 * file, whose stated subject is the hazard of keeping.** The bytes are asserted there now.
 */
const REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const CLI = join(REPO, 'scripts', 'clean-base.mjs')

/**
 * The five profiles his machine had. ⚠️ **`default` alone could not have caught this**: it is in
 * the menu whether or not it is on disk (`provider-homes.ts:164`), so a one-profile fixture reports
 * the same `['default']` before and after and the assertion measures nothing.
 */
const HIS_PROFILES = ['default', 'developer', 'mem-1', 'mem-2', 'repo-investigation'] as const

/**
 * 🔴 **What the menu ANSWERS for his tree — his five ON DISK, plus the seeded slug, which is in
 * the answer whether or not anything was ever written for it** (`provider-homes.ts:190`).
 *
 * ## ⚑ 592 · the two used to be the same list, and `HO-078` §2 parted them
 *
 * ⛔ **`default` was both one of his five AND the seeded slug**, so `[...HIS_PROFILES]` was the
 * right answer by coincidence — `a-comparison-tested-where-both-sides-agree-measures-nothing`,
 * sitting in the expectation rather than in the code. ⚑ **The rename separates them**, and the
 * assertion is stronger for it: the always-present member is now visibly not one of his.
 *
 * ⚠️ **Derived in the reader's own order** — the seeded slug first, then the rest sorted — rather
 * than typed, so this cannot drift from `listProfileIds` the next time either moves.
 */
const THE_MENU_FOR_HIS_TREE = [
  DEFAULT_PROFILE_ID,
  // ⛔ **Widened to `string[]` deliberately, and the COMPILER is why it has to be.** ⚑ `as const`
  // makes `HIS_PROFILES` a union of his five literals, and `tsc` refuses to compare it with the
  // seeded slug at all — *"types … and `'brobot'` have no overlap"*. ⚠️ **That refusal is this
  // constant's own claim, asserted by the type system rather than by an expectation**: the seeded
  // slug is not one of his, which is exactly what `592` parted. 🔴 The filter is kept rather than
  // dropped, because the day somebody adds the seeded slug to his five it must not appear twice.
  ...([...HIS_PROFILES] as string[]).filter((id) => id !== DEFAULT_PROFILE_ID).sort(),
]

/**
 * ⛔ **Synthetic, and it never comes from `~/.codex`.** `provisionCodexAuth` takes an explicit
 * `sourceAuthPath`, so the copy path can be exercised end to end without the machine credential
 * being read, copied or named anywhere in this repository.
 */
const MACHINE_CREDENTIAL = '{"tokens":{"refresh_token":"not-a-real-machine-token"}}\n'

/**
 * ⛔ **722 · `717` F-6 · R46 · the only two starts of the script in this file**, and each asks
 * {@link mustNameScratch} FIRST — before its `try`, so a refusal of the guard's is never read as one
 * of the script's. ⚑ Its directories are {@link fixture}'s now rather than a `mkdtemp` of this
 * file's own, because the guard knows only the fixtures that module made: a `--dir` anywhere else —
 * his userData included — throws before anything is spawned.
 *
 * ⚠️ **Module-level, with no return type after the parameters, on purpose.**
 * `clean-base-starts-only-on-scratch.test.mjs` reads these two as TEXT the way it reads
 * `clean-base.test.mjs`'s `run` — `function <helper>(…) {` at column 0 and the guard its first line —
 * and TypeScript infers the same `void` and `string` the annotations said. ⚑ The fixture module is
 * plain `.mjs`, typed through `tsconfig.node.json`'s `allowJs` with no `.d.mts`, the way
 * `test/a-window-nobody-sees.test.ts` imports `scripts/lib/hidden-launch.mjs`.
 */
function cleanBase(userData: string, ...flags: string[]) {
  mustNameScratch(['--dir', userData, ...flags])
  execFileSync(process.execPath, [CLI, '--dir', userData, ...flags], { encoding: 'utf8' })
}

/**
 * ⛔ **539 · the same script, on a target it must REFUSE** — and the refusal is the assertion.
 * `execFileSync` throws on a non-zero exit, so a run that succeeded reaches the `throw` below
 * rather than passing quietly.
 */
function cleanBaseRefuses(target: string, ...flags: string[]) {
  mustNameScratch(['--dir', target, ...flags])
  try {
    execFileSync(process.execPath, [CLI, '--dir', target, ...flags], { encoding: 'utf8' })
  } catch (error) {
    const refused = error as { status?: number; stderr?: string }
    expect(refused.status, 'a refusal exits 1').toBe(1)
    return refused.stderr ?? ''
  }
  throw new Error('clean-base finished instead of refusing')
}

describe('a clean base that leaves no profiles standing (352)', () => {
  afterEach(removeFixtures)

  function plantHisMachine(under = ''): string {
    expect(existsSync(CLI), 'the script under test was not where this test looked').toBe(true)
    // ⛔ **722 · a fixture R46's guard knows** — `fixture()` records it, so {@link cleanBase} can
    // name it scratch; the `mkdtemp` this used to make was one the guard could not know.
    const root = fixture()
    const userData = join(root, under, 'ud')
    for (const profileId of HIS_PROFILES) {
      for (const provider of ['claude', 'codex'] as const) {
        const home = join(providerHomesRoot(userData), HOME_FOLDER, profileId, provider)
        mkdirSync(join(home, 'sessions'), { recursive: true })
        writeFileSync(join(home, 'sessions', 'rollout.jsonl'), '{}\n')
      }
      // ⚠️ Different bytes per profile, and `0600`: this is the shape `provisionCodexAuth` leaves,
      // and the reset refuses a managed credential that is not a private regular file.
      const auth = join(providerHomesRoot(userData), HOME_FOLDER, profileId, 'codex', 'auth.json')
      writeFileSync(auth, `not-a-real-credential-${profileId}\n`)
      chmodSync(auth, 0o600)
    }
    writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')
    // ⛔ **An upper bound on the acceptance assertion** (352 review). `listProfileIds` returns
    // `['default']` for a `userData` that does not exist at all, so "the menu is empty of his
    // profiles" is equally true of a reset that deleted the whole directory. Something has to
    // survive, and `exports/` is the thing `350` says must.
    mkdirSync(join(userData, 'exports'), { recursive: true })
    writeFileSync(join(userData, 'exports', 'a1.brobot-session.json'), '{"version":1}\n')
    return userData
  }

  /** Every planted credential, still holding the bytes its own profile was given. */
  function credentialsSurvive(userData: string): void {
    for (const profileId of HIS_PROFILES) {
      const auth = join(providerHomesRoot(userData), HOME_FOLDER, profileId, 'codex', 'auth.json')
      expect(readFileSync(auth, 'utf8'), `${profileId}'s credential`).toBe(
        `not-a-real-credential-${profileId}\n`,
      )
    }
  }

  /**
   * 🔴 **The diagnosis, as a test.** This is exactly what `351` left behind, reproduced by hand —
   * and it is why the defect was invisible to a suite that only checked what was *inside* each
   * home. `listProfileIds` walks the directory layout; it never opens a leaf.
   */
  it('🔴 an emptied leaf is still a leaf, which is how 351 left every profile in the menu', () => {
    const userData = plantHisMachine()
    for (const profileId of HIS_PROFILES) {
      for (const provider of ['claude', 'codex'] as const) {
        const home = join(providerHomesRoot(userData), HOME_FOLDER, profileId, provider)
        for (const entry of readdirSync(home)) {
          rmSync(join(home, entry), { recursive: true, force: true })
        }
        expect(readdirSync(home), 'the leaf really is empty').toEqual([])
      }
    }
    expect(
      listProfileIds(userData),
      'the menu is the directory listing, never what is inside it',
    ).toEqual(THE_MENU_FOR_HIS_TREE)
  })

  it('⛔ after a clean base the launcher offers `default`, and nothing he made', () => {
    const userData = plantHisMachine()
    expect(listProfileIds(userData), 'the fixture has profiles a wrong answer would keep').toEqual(
      THE_MENU_FOR_HIS_TREE,
    )

    cleanBase(userData)

    expect(listProfileIds(userData)).toEqual([DEFAULT_PROFILE_ID])
    expect(
      existsSync(providerHomesRoot(userData)),
      'a fresh install has no provider-homes at all',
    ).toBe(false)
    expect(
      readFileSync(join(userData, 'exports', 'a1.brobot-session.json'), 'utf8'),
      'an empty menu is also what deleting the whole userData looks like',
    ).toBe('{"version":1}\n')
  })

  it('⚑ …and --keep-profile-auth keeps every one of them, credential and name together', () => {
    const userData = plantHisMachine()
    cleanBase(userData, '--keep-profile-auth')

    // ⛔ **The flag's real cost, measured rather than described.** The credential and the profile
    // NAME are one directory, so there is no keeping the first without the second — which is why
    // the report and the script's last line both say so.
    expect(listProfileIds(userData)).toEqual(THE_MENU_FOR_HIS_TREE)
    // 🔴 **539 · the other half of this test's own title, which it did not have.** ⛔ `together`
    // was asserted of the NAME alone; a flag that kept every directory and unlinked every
    // credential passed here and went red only in the staleness test at the foot of this file.
    // ⚠️ The bytes differ per profile, so a keep that installed one profile's copy in another is
    // red too — `existsSync` could not have told them apart.
    credentialsSurvive(userData)
    expect(existsSync(join(userData, 'brobot2.sqlite')), 'it is still a clean base').toBe(false)
  })

  /**
   * A refusal preserves the launcher’s profiles and their credentials.
   *
   * A `--dir` pointing at the parent of userData could classify the entire userData directory
   * as an unnamed manifest entry and remove it recursively while reporting that
   * `provider-homes/` remains. The fixture checks the product oracle after refusal: all five
   * profiles remain available and each credential retains its own bytes.
   */
  it('🔴 …and a --dir one level too high refuses, so the menu and the credentials both survive', () => {
    const userData = plantHisMachine('@brobot2')
    expect(
      listProfileIds(userData),
      'the fixture has profiles a wrong answer would destroy',
    ).toEqual(THE_MENU_FOR_HIS_TREE)

    const why = cleanBaseRefuses(dirname(userData), '--keep-profile-auth')

    expect(why).toContain('is not a name this reset knows')
    expect(why).toContain('Nothing was removed')
    expect(listProfileIds(userData), 'the menu the launcher reads is untouched').toEqual(
      THE_MENU_FOR_HIS_TREE,
    )
    credentialsSurvive(userData)
    expect(
      existsSync(join(userData, 'brobot2.sqlite')),
      'a refusal removes nothing at all, not even the ledger',
    ).toBe(true)
  })

  /**
   * ⚑ **`352` §2.2 asks for the re-provision to be asserted, not assumed** — and this is the
   * session-launch path itself: `prepareProviderHome` is what every Codex conversation goes through,
   * and its credential seam is pointed at a synthetic file so nothing here reads `~/.codex`.
   */
  it('⚑ the first Codex conversation after a clean base copies the machine credential back', async () => {
    const userData = plantHisMachine()
    cleanBase(userData)
    expect(existsSync(providerHomesRoot(userData))).toBe(false)

    const source = join(dirname(userData), 'machine-codex-auth.json')
    writeFileSync(source, MACHINE_CREDENTIAL)
    const home = await prepareProviderHome(
      userData,
      { profileId: DEFAULT_PROFILE_ID, provider: 'codex' },
      { provisionCodexAuth: (at) => provisionCodexAuth(at, { sourceAuthPath: source }) },
    )

    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe(MACHINE_CREDENTIAL)
    expect(statSync(join(home, 'auth.json')).mode & 0o777, 'pinned 0600 regardless of umask').toBe(
      0o600,
    )
    expect(listProfileIds(userData), 'and it is back to one profile, not none').toEqual([
      DEFAULT_PROFILE_ID,
    ])
  })

  /**
   * 🔴 **The reason the default had to flip, stated as the mechanism rather than the symptom.**
   *
   * `provisionCodexAuth` copies once and never overwrites (`internal/auth.ts:316`), so it
   * preserves a copy that refreshed independently. Starting another conversation cannot
   * repair a stale copy, despite the retry advice in the rejection notice
   * (`renderer/src/lib/transcript.ts:1354`).
   *
   * ⚠️ Keeping the copy through a clean base therefore removes the last thing that could have
   * replaced it. That is not the conservative direction; it is the permanent one.
   */
  it('🔴 …while a copy kept by the flag is NOT re-copied, so a stale one survives every reset', async () => {
    const userData = plantHisMachine()
    cleanBase(userData, '--keep-profile-auth')

    const source = join(dirname(userData), 'machine-codex-auth.json')
    writeFileSync(source, MACHINE_CREDENTIAL)
    // 🔴 **592 · the subject has to be a profile the FIXTURE planted a copy for** (`HO-078` §2).
    // ⛔ This named {@link DEFAULT_PROFILE_ID}, which was one of his five until the slug moved —
    // so after the rename it prepared a home for an identity with no kept copy at all and
    // measured the COPY path, which is the opposite of this test's subject. ⚑ Read off
    // {@link HIS_PROFILES}, the one list that decides what the flag had to keep.
    const kept = HIS_PROFILES[0]
    const home = await prepareProviderHome(
      userData,
      { profileId: kept, provider: 'codex' },
      { provisionCodexAuth: (at) => provisionCodexAuth(at, { sourceAuthPath: source }) },
    )

    expect(
      readFileSync(join(home, 'auth.json'), 'utf8'),
      'the kept copy is still there, and a new conversation did not replace it',
    ).toBe(`not-a-real-credential-${kept}\n`)
  })
})
