import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CODEX_AUTH,
  DEFAULT_PROFILE_LABEL,
  HOME_FOLDER,
  HOMES_DIRNAME,
} from '../lib/clean-base.mjs'
import { DATA_FOLDER_NAME, pastedImagesRoot } from '../lib/user-data.mjs'
import {
  fixture,
  HIS_PROFILES,
  mustNameScratch,
  plantUserData,
  removeFixtures,
} from '../test/fixtures/a-planted-user-data.mjs'

/**
 * ⛔ **717 · R45 · this is the half of `clean-base`'s tests that SPAWNS it**, and only that half.
 *
 * ⚑ The tests that never start the script — the source censuses, the manifest's constants, the
 * `planCleanBase` / `planProviderHomes` units — went back to
 * `scripts/test/clean-base-without-running-it.test.mjs` (the PM's ruling R45), so the mutation rows
 * they kill can be re-verified RED by `verify_row.py` again. ⚠️ Every test left here runs
 * `node scripts/clean-base.mjs`, so this file runs only inside the whole `pnpm run ci`
 * (`vitest.gate-only.config.ts`), and the rows only it kills keep the verdicts they last earned.
 * The section numbers are the old file's, so `§1`, `§2` and parts of `§7`, `§9` and `§11` are over there.
 */

/**
 * ⚠️ **A bound on the MACHINE, not on the product** (352).
 *
 * Nearly every test below spawns a real `node scripts/clean-base.mjs`, and that script reads the
 * whole process table — ~900 rows on this machine — and opens a socket, each under its own internal
 * deadline (`PS_TIMEOUT_MS` 5 s, `ANSWER_MS` 1.5 s). Two spawns therefore have an honest worst case
 * in the low tens of seconds, and vitest's 5 s default is under it: 🔴 **the dry-run parity test
 * timed out at 5 s under the load of a full `vitest run` while passing in 26 s when the file ran
 * alone.** ⛔ An intermittently red gate is worse than a generous one — it is how a real red gets
 * waved through — so the number here is set from the script's own deadlines rather than from a
 * guess about how busy the machine is.
 */
vi.setConfig({ testTimeout: 30_000 })

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SCRIPTS)
const CLI = join(SCRIPTS, 'clean-base.mjs')

afterEach(removeFixtures)

/**
 * The lines of one report group — everything indented under `    <name> — …` up to the next group.
 *
 * ⚠️ Scoped on purpose: an assertion over the WHOLE report is satisfied by any line in it, which is
 * how a negative about one group passes because a different group happens to supply the string.
 */
function section(stdout, name) {
  const lines = stdout.split('\n')
  const at = lines.findIndex((line) => line.startsWith(`    ${name} — `))
  if (at === -1) return ''
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => /^ {4}\S/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * The lines under `  kept on purpose`, for the same reason {@link section} exists.
 *
 * 🔴 **Written because a claim about this block passed on the strength of the LAST LINE** (352).
 * ⚠️ **539 replaced the sentence it quoted** — *"each with the auth.json it already had"* is gone
 * and the last line now reads *"…and the N managed auth.json under it were kept"* — ⛔ **and the
 * reason is untouched**: that line still carries the string `auth.json`, so
 * `not.toContain('auth.json')` over the whole report is still satisfied by a neighbour, which is
 * how a negative comes to measure nothing.
 */
function keptBlock(stdout) {
  const lines = stdout.split('\n')
  const at = lines.indexOf('  kept on purpose')
  if (at === -1) return ''
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => /^ {2}\S/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * ⛔ **Every start of the script in this file is this one call** (`717` R46), and it asks
 * {@link mustNameScratch} first: a `--dir` that is not a fixture, or a call that falls back to a
 * directory derived from `HOME` without a scratch `HOME`, throws here and nothing is spawned.
 * `clean-base-starts-only-on-scratch.test.mjs` holds both halves of that true from the ordinary suite.
 */
function run(args, env = {}) {
  mustNameScratch(args, { env })
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      status: error.status ?? -1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

describe('§3 · what it removes, keeps and refuses', () => {
  it('⛔ empties the userData and takes the whole provider-homes tree with it', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    // ⚑ **The paired positive** (352 §3). `351` left all five of these standing, and a predicate
    // that only empties the `<provider>` leaves leaves them standing again — so the fixture has to
    // hold profiles a wrong answer keeps, or "no profile survives" is a sentence about an empty
    // directory. BroBot's own profile alone could never have shown the difference: it is in the
    // launcher's menu whether or not it is on disk.
    // ⛔ **620 · this named that profile `default`**, which `592` renamed.
    expect(readdirSync(join(userData, HOMES_DIRNAME, 'default')).sort()).toEqual([...HIS_PROFILES])
    const result = run(['--dir', userData])

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(false)
    expect(existsSync(join(userData, 'brobot2.sqlite-wal'))).toBe(false)
    expect(existsSync(join(userData, 'brobot-workspace'))).toBe(false)
    // 🔴 **The resources tree goes with the ledger** (D-016, as `380`'s documents tree did). ⛔ A kept
    // tree would leave every kept file orphaned — its row, the one thing that names it, lives in the
    // database this reset removes.
    expect(existsSync(join(userData, 'resources'))).toBe(false)
    expect(existsSync(join(userData, 'Cache'))).toBe(false)
    expect(existsSync(join(userData, 'Local Storage'))).toBe(false)
    expect(
      readdirSync(userData).filter((name) => name.startsWith('Singleton')),
      'the top-level symlinks are unlinked by name',
    ).toEqual([])

    expect(readFileSync(join(userData, 'exports', 'a1.brobot-session.json'), 'utf8')).toBe(
      '{"version":1}\n',
    )
    expect(
      existsSync(join(userData, HOMES_DIRNAME)),
      'a fresh install has no provider-homes at all, and that is what a clean base is',
    ).toBe(false)
    // ⚑ **Said out loud, not only done** — §2.1's acceptance test is a sentence a person reads.
    expect(section(result.stdout, 'provider homes')).toContain('default/repo-investigation')
    expect(section(result.stdout, 'provider homes')).toContain(
      // ⚑ **592 · the sentence names WHOSE profile, not which word** (`HO-078` §2) — see the
      // note beside it in `clean-base.mjs`: this file cannot import the slug, so a spelling here
      // would be one rename from false again.
      `the launcher will offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`,
    )
    // ⛔ **And it does not claim to have kept something it removed.** `351`'s report carried a
    // "kept on purpose" line for the credential on every run; the default keeps nothing here, so
    // the flag must not be named at all.
    expect(result.stdout, 'the default has nothing to explain with a flag').not.toContain(
      'keep-profile-auth',
    )
  })

  it("⚑ …and --keep-profile-auth is 351's behaviour, asked for by name", () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status, result.stderr).toBe(0)

    expect(readdirSync(join(userData, HOMES_DIRNAME, 'default')).sort()).toEqual([...HIS_PROFILES])
    for (const profile of HIS_PROFILES) {
      const codex = join(userData, HOMES_DIRNAME, 'default', profile, 'codex')
      // ⚠️ The bytes, not merely the name: each home's credential differs, so a keep that took one
      // profile's file and installed it in another would read as a pass on `existsSync` alone.
      expect(readFileSync(join(codex, CODEX_AUTH), 'utf8')).toBe(
        `not-a-real-credential-${profile}\n`,
      )
      expect(existsSync(join(codex, 'config.toml')), 'what it remembered still goes').toBe(false)
      expect(existsSync(join(codex, 'sessions'))).toBe(false)
      expect(
        readdirSync(join(userData, HOMES_DIRNAME, 'default', profile, 'claude')),
        'the claude home is emptied but stays',
      ).toEqual([])
    }
    // ⛔ **And the report says the profiles stayed**, which is the half `351` printed backwards.
    expect(section(result.stdout, 'provider homes')).toContain('the profile homes STAY')
    expect(existsSync(join(userData, 'brobot2.sqlite')), 'the flag is not a no-op run').toBe(false)
  })

  it('⚑ a dry run removes nothing and reports the same counts the real run then produces', () => {
    const previewed = plantUserData(fixture())
    const removed = plantUserData(fixture())
    const counts = (text) => text.match(/^ {4}\S.* — (\d+) paths? · /gm)?.join('|')

    const preview = run(['--dir', previewed, '--dry-run'])
    expect(preview.status, preview.stderr).toBe(0)
    expect(preview.stdout).toContain('would remove')
    expect(existsSync(join(previewed, 'brobot2.sqlite')), 'the dry run removed something').toBe(
      true,
    )

    const real = run(['--dir', removed])
    expect(real.status, real.stderr).toBe(0)
    expect(counts(preview.stdout)).toBe(counts(real.stdout))
    expect(counts(real.stdout)).toBeTruthy()
  })

  /**
   * ⛔ **A preview may not speak in the past tense** (352 review). `351`'s sentence was wrong on
   * every run and that is what `352` is about; a `--dry-run` that ends *"provider-homes/ is gone, so
   * the launcher offers `default`"* after removing nothing is the same defect in a new place.
   *
   * ⚠️ **620 · the sentence quoted above kept the word `default` until this dispatch**, eighteen
   * days after `352` fixed its MOOD and one after `592` renamed the profile it names. ⛔ Two
   * dispatches repaired the same line for two different reasons and neither noticed the third
   * thing wrong with it — which is why the `nextLaunch` clause is now pinned by name in §4.
   *
   * ⚠️ **And the parity test above cannot see it** — it compares only the `— N paths ·` group
   * headers, and it plants one profile, so no dry run in this file ever met a menu worth reporting.
   */
  it('⛔ a dry run says what WOULD happen, and leaves the tree standing', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const result = run(['--dir', userData, '--dry-run'])
    expect(result.status, result.stderr).toBe(0)

    const homes = section(result.stdout, 'provider homes')
    expect(homes).toContain('profile homes that would go')
    expect(homes).toContain('default/repo-investigation')
    expect(homes).toContain(
      `afterwards the launcher would offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`,
    )
    expect(homes, 'the indicative belongs to the run that did it').not.toContain(
      'profile homes gone',
    )

    const last = result.stdout.trimEnd().split('\n').at(-1)
    expect(last).toContain('if you run this without --dry-run')
    // ⛔ **539 · a preview predicts from the PLAN, never from the tree it did not touch.** The
    // post-state the last line now reports is read off the disk after a real run — and a preview
    // has no post-state, so reading one here would describe the five profiles still standing in
    // the sentence whose job is to say they would go. ⚑ Same shape as `352`'s pasted-root defect.
    expect(last, 'the preview may not report the directory it deliberately left alone').toContain(
      'no profiles',
    )

    expect(
      readdirSync(join(userData, HOMES_DIRNAME, 'default')).sort(),
      'a preview that removed the thing it was previewing',
    ).toEqual([...HIS_PROFILES])
  })

  /**
   * 🔴 **One byte that will not come off leaves a profile on disk AND in the launcher** (352
   * review). The footnote and the last line used to be computed from the PLAN, so they said the
   * homes were gone while `⛔ left in place` two lines above named the file that stopped them —
   * which is the half-clean base `351` §3.3 calls worse than not running at all.
   */
  it('⛔ a run that could not finish does not claim the profiles are gone', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const locked = join(userData, HOMES_DIRNAME, 'default', 'mem-1', 'codex')
    // A directory the owner may read and list but not write, so the `unlink` inside it fails.
    chmodSync(locked, 0o555)
    try {
      const result = run(['--dir', userData])
      expect(result.status, 'a partial removal must not exit 0').toBe(1)
      expect(result.stdout).toContain('⛔ PARTLY')
      expect(result.stdout).toContain('left in place')

      const homes = section(result.stdout, 'provider homes')
      expect(homes).toContain('this run did NOT finish')
      expect(homes).not.toContain('profile homes gone')
      expect(homes).not.toContain(
        `the launcher will offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`,
      )

      const last = result.stdout.trimEnd().split('\n').at(-1)
      expect(last).toContain('NOT a clean base')
      expect(last, 'the sentence that would have been false').not.toContain(
        'is gone, so the launcher',
      )
      expect(existsSync(locked), 'the fixture must really have survived').toBe(true)
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  it('--drop-exports and --keep-profile-auth each move exactly one default', () => {
    const a = plantUserData(fixture())
    const dropped = run(['--dir', a, '--drop-exports'])
    expect(dropped.status).toBe(0)
    expect(existsSync(join(a, 'exports'))).toBe(false)
    // ⛔ **And it has to SAY so** (351 review). `EXPORTS` was missing from `REPORT_ORDER`, so the one
    // thing in the userData that cannot be regenerated was deleted and named in no section and
    // counted in no total — while the code's own comment promised "every name, never an elision".
    expect(section(dropped.stdout, 'exports')).toContain('exports')
    expect(dropped.stdout).not.toContain('kept on purpose\n    exports')
    expect(
      existsSync(join(a, HOMES_DIRNAME)),
      '--drop-exports changes nothing about the homes, which the default already removes',
    ).toBe(false)

    const b = plantUserData(fixture())
    expect(run(['--dir', b, '--keep-profile-auth']).status).toBe(0)
    expect(existsSync(join(b, HOMES_DIRNAME, 'default', 'default', 'codex', CODEX_AUTH))).toBe(true)
    expect(existsSync(join(b, 'exports')), 'and it must not take exports').toBe(true)
    expect(existsSync(join(b, 'brobot2.sqlite')), 'nor stop being a clean base').toBe(false)
  })

  it('names the entries it does not know rather than calling them Chromium', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        mkdirSync(join(at, 'Segmentation Platform'), { recursive: true })
        writeFileSync(join(at, 'heavy_ad_intervention_opt_out.db'), 'x\n')
      },
    })
    const result = run(['--dir', userData, '--dry-run'])
    const other = section(result.stdout, 'other')

    expect(other).toContain('Segmentation Platform')
    expect(other).toContain('heavy_ad_intervention_opt_out.db')
    // ⚑ **The paired positive.** `not.toMatch(/chromium/i)` over the whole output was the first
    // draft, and a review showed it could not fail under any mutation — the word appeared nowhere.
    // Then the SingletonLock instrument landed and the report says "Chromium's SingletonLock",
    // so it went red for a reason that had nothing to do with the rule. What the rule actually
    // says is that an entry the manifest KNOWS is not in this group and an entry it does not know
    // is, under its own literal name.
    expect(other).not.toContain('brobot2.sqlite')
    expect(other).not.toContain('provider-homes')
    expect(section(result.stdout, 'ledger')).toContain('brobot2.sqlite')
  })

  it('keeps a stray in the pasted-image sibling, and the root with it', () => {
    const root = fixture()
    const userData = plantUserData(root)
    const pasted = pastedImagesRoot(userData)
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')
    writeFileSync(join(pasted, 'holiday.png'), 'not ours\n')

    expect(run(['--dir', userData]).status).toBe(0)
    expect(existsSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'))).toBe(false)
    expect(readFileSync(join(pasted, 'holiday.png'), 'utf8')).toBe('not ours\n')
    expect(existsSync(pasted), 'a root it did not empty is a root it must not remove').toBe(true)
  })
})

describe('§4 · ⛔ one refusal stops everything, and nothing is removed', () => {
  const refusesWholeRun = (name, plant) =>
    it(name, () => {
      const userData = plantUserData(fixture(), { extra: plant })
      const result = run(['--dir', userData])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('refused')
      expect(result.stderr).toContain('Nothing was removed')
      // ⚑ Not just the guilty path — the ledger, three directories away, is still there.
      expect(existsSync(join(userData, 'brobot2.sqlite')), 'it removed something anyway').toBe(true)
      expect(existsSync(join(userData, 'Cache'))).toBe(true)
      expect(existsSync(join(userData, 'brobot-workspace'))).toBe(true)
      return result
    })

  refusesWholeRun('a folder BroBot could not have created', ({ userData }) => {
    mkdirSync(join(userData, HOMES_DIRNAME, '..sneaky'), { recursive: true })
  })

  refusesWholeRun('a leaf that is neither claude nor codex', ({ userData }) => {
    mkdirSync(join(userData, HOMES_DIRNAME, 'default', 'default', 'gemini'), { recursive: true })
  })

  refusesWholeRun('a symlink where a provider home belongs', ({ userData }) => {
    symlinkSync(join(userData, '..'), join(userData, HOMES_DIRNAME, 'default', 'default', 'link'))
  })

  /**
   * ⛔ **The refusal that used to arrive mid-removal.** `brobot2.sqlite` is first in the manifest and
   * `Cache` is early alphabetically, so a contradiction discovered while applying would have left
   * everything before it gone. The check pass exists so that nothing is removed at all.
   */
  it('⛔ a manifest entry whose KIND contradicts the manifest refuses before anything is removed', () => {
    const root = fixture()
    const userData = plantUserData(root)
    rmSync(join(userData, 'brobot2.sqlite'))
    mkdirSync(join(userData, 'brobot2.sqlite'))
    writeFileSync(join(userData, 'brobot2.sqlite', 'not-a-database.txt'), 'x\n')

    const result = run(['--dir', userData])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is a dir where the manifest expects file')
    expect(result.stderr).toContain('Nothing was removed')
    expect(existsSync(join(userData, 'Cache')), 'it removed something anyway').toBe(true)
    expect(existsSync(join(userData, 'brobot-workspace'))).toBe(true)
    expect(existsSync(join(userData, 'brobot2.sqlite', 'not-a-database.txt'))).toBe(true)
  })

  /**
   * ⛔ **The credential question is asked where the answer DECIDES something** (352 review).
   *
   * `352`'s first draft widened this to both paths, on the reading that an unaccountable shape is
   * unaccountable either way. 🔴 **That made a `0644` managed credential — one a restore, a `cp`
   * under a permissive umask or a sync tool can produce — refuse `pnpm clean-base` in EVERY mode**,
   * with no flag past it and no remedy in the message: a reset a person cannot run and cannot clear
   * without chmod'ing a file they cannot see. ⚑ `351` §1 rules that outcome worse than no reset, so
   * the check is back where `351` had it, and the two tests below are the two halves of the rule.
   */
  it('⛔ a credential that is not a regular 0600 file refuses a run that would KEEP it', () => {
    const userData = plantUserData(fixture(), { authMode: 0o644 })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('mode 0644')
    expect(result.stderr).toContain('this reset will not decide what it is')
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(true)
  })

  /** ⚑ The paired positive: the SAME fixture at 0600 keeps it, so the refusal is about the mode. */
  it('⚑ …and at 0600 the same fixture keeps it and runs to completion', () => {
    const userData = plantUserData(fixture(), { authMode: 0o600 })
    expect(run(['--dir', userData, '--keep-profile-auth']).status).toBe(0)
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(false)
    expect(
      existsSync(join(userData, HOMES_DIRNAME, 'default', 'default', 'codex', CODEX_AUTH)),
    ).toBe(true)
  })

  /**
   * 🔴 **The trap the widening created, closed and pinned.** Nothing turns on what this file is when
   * the whole tree is going, and `removeChecked` unlinks a symlink by name rather than following it
   * — so there is nothing to decide and nothing to guard.
   */
  it('⚑ …while the DEFAULT path runs anyway, because nothing there turns on the answer', () => {
    const userData = plantUserData(fixture(), { authMode: 0o644 })
    const result = run(['--dir', userData])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).not.toContain('mode 0644')
    expect(existsSync(join(userData, HOMES_DIRNAME))).toBe(false)
  })

  /**
   * ⚑ **The other half of the same `mayRemove` call, which had no test at all** (352 review): the
   * kind check, not the mode check. A symlink where the managed credential belongs is tampering.
   */
  it('⛔ a managed credential that is a SYMLINK refuses a run that would keep it', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ codex }) => {
        rmSync(join(codex, CODEX_AUTH))
        symlinkSync('/etc/hosts', join(codex, CODEX_AUTH))
      },
    })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(CODEX_AUTH)
    expect(result.stderr).toContain('Nothing was removed')
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(true)
  })

  it('⛔ refuses the home directory itself, and everything in it survives', () => {
    const root = fixture()
    const home = join(root, 'home')
    mkdirSync(join(home, 'Documents'), { recursive: true })
    writeFileSync(join(home, 'Documents', 'thesis.txt'), 'years of work\n')

    const result = run(['--dir', home], { HOME: home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('your home directory')
    expect(readFileSync(join(home, 'Documents', 'thesis.txt'), 'utf8')).toBe('years of work\n')
  })

  it('⛔ refuses the conventional Codex home when it is named directly', () => {
    const root = fixture()
    const home = join(root, 'home')
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex', 'auth.json'), 'the real one\n')

    const result = run(['--dir', join(home, '.codex')], { HOME: home })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("is the machine's conventional Codex home")
    expect(readFileSync(join(home, '.codex', 'auth.json'), 'utf8')).toBe('the real one\n')
  })

  /**
   * ⛔ **The other direction, which is the one a `--dir` typo reaches.** A target that CONTAINS a
   * never-touch root would take it with the tree, and `$CODEX_HOME` is the redirect `350` §3 lists
   * as never-reset — the only forbidden root that can legitimately sit anywhere on the disk.
   */
  it('⛔ refuses a directory that CONTAINS a redirected provider home', () => {
    const root = fixture()
    const home = join(root, 'home')
    const target = join(root, 'target')
    const redirected = join(target, 'redirected-codex')
    mkdirSync(home, { recursive: true })
    mkdirSync(redirected, { recursive: true })
    writeFileSync(join(redirected, 'auth.json'), 'the real one\n')

    const result = run(['--dir', target], { HOME: home, CODEX_HOME: redirected })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contains the CODEX_HOME this shell redirects to')
    expect(readFileSync(join(redirected, 'auth.json'), 'utf8')).toBe('the real one\n')
  })
})

describe('§4b · ⛔ it scans BOTH spellings of the target', () => {
  /**
   * ⚑ **Measured, not defensive.** Chromium resolves `--user-data-dir` before
   * `app.getPath('userData')` answers — `/tmp/x` comes back as `/private/tmp/x`
   * (`scripts/lib/smoke-run.mjs:87-92`) — so a running app may name the REAL spelling in its argv
   * while the person resetting types the symlinked one. A scan for only the spelling on the command
   * line misses the app it is about to delete under.
   *
   * ⚠️ On macOS `/tmp` is a symlink to `/private/tmp`, so this fixture has two spellings for free.
   */
  it('a process naming only the real path stops a reset asked for by the lexical one', () => {
    // ⛔ **Two spellings where NEITHER contains the other** (351 review). The first draft used
    // `/tmp/X` and `/private/tmp/X` — and `/private/tmp/X` contains `/tmp/X` as a substring, so a
    // scan of the lexical spelling alone would have found the process too. The test named the
    // mechanism and measured nothing. A sibling symlink gives two genuinely different strings.
    const root = fixture()
    mkdirSync(join(root, 'real'), { recursive: true })
    symlinkSync(join(root, 'real'), join(root, 'alias'))
    const userData = plantUserData(join(root, 'real'))
    const lexical = join(root, 'alias', 'ud')
    const realSpelling = realpathSync(userData)

    expect(realSpelling.includes(lexical), 'the two spellings must not overlap').toBe(false)
    expect(lexical.includes(realSpelling), 'the two spellings must not overlap').toBe(false)
    expect(realpathSync(lexical)).toBe(realSpelling)

    let pid = 0
    try {
      const sleeper = spawnSync('sh', [
        '-c',
        `nohup node -e 'setTimeout(()=>{},6000)' ${JSON.stringify(realSpelling)} >/dev/null 2>&1 & echo $!`,
      ])
      pid = Number(String(sleeper.stdout).trim())
      expect(Number.isInteger(pid) && pid > 0, 'the sleeper did not start').toBe(true)

      const result = run(['--dir', lexical])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('BroBot is running on this userData')
      expect(result.stderr).toContain(String(pid))
      expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(true)
    } finally {
      // ⚑ Inside the finally from the first line that can create it, so a failed assertion above
      // cannot leak a background process (351 review).
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // it had already exited, which is the other acceptable end for it
        }
      }
    }
  })
})

describe('§5 · the command line refuses before it acts', () => {
  /**
   * Give this one call a scratch HOME because it names no --dir. If the unknown-option check fails,
   * fallback must still stay in scratch. Other calls keep their own environment unless they can fall
   * back; forbidden-root tests need the real provider-home roots.
   */
  it('an unknown option is an error, not a run against the default directory', () => {
    const home = fixture()
    const fallback = join(home, 'Library', 'Application Support', DATA_FOLDER_NAME)
    mkdirSync(fallback, { recursive: true })
    writeFileSync(join(fallback, 'brobot2.sqlite'), 'ledger\n')

    const result = run(['--wipe-everything'], { HOME: home })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown option')
    expect(result.stdout).not.toContain('removed')
    // ⚑ The directory it would have fallen back to, read afterwards: the refusal is measured by what
    // it protected. That this IS where the script falls back under this `HOME` is held in-process,
    // with nothing started, by `clean-base-starts-only-on-scratch.test.mjs` (`fallbacksUnder`).
    expect(readFileSync(join(fallback, 'brobot2.sqlite'), 'utf8')).toBe('ledger\n')
  })

  it('⛔ --packaged is gone, and refused as an unknown option — there is one data folder (W4.90)', () => {
    // ⚑ A development build and an installed BroBot share one folder, so `--packaged` named a
    // folder no build used. ⛔ **717 · R46** — a scratch `HOME` all the same: were it ever accepted,
    // it would fall back to a directory derived from `HOME`.
    const home = fixture()
    const result = run(['--packaged'], { HOME: home })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown option --packaged')
    expect(result.stdout).not.toContain('removed')
  })

  it('⚑ W4.90 · a run on the shared folder says whose data it is, and a run on another folder does not', (ctx) => {
    // ⚠️ **darwin only**: the fallback is the Mac's app data derived from HOME alone.
    ctx.skip(process.platform !== 'darwin')
    const WHOSE =
      'the data of every BroBot on this machine not started with its own --user-data-dir'
    // ⛔ **717 · R46** — the call falls back, so a scratch `HOME` for it; and a dry run, on a folder
    // that is not there.
    const shared = run(['--dry-run'], { HOME: fixture() })
    expect(shared.status).toBe(0)
    expect(shared.stdout).toContain(WHOSE)
    // ⚑ One fact over: a folder of its own is not everybody's.
    const other = run(['--dir', plantUserData(fixture()), '--dry-run'])
    expect(other.status).toBe(0)
    expect(other.stdout).not.toContain(WHOSE)
  })

  it('⛔ --dir given twice is refused rather than last-wins, because it names what gets deleted', () => {
    const kept = plantUserData(fixture())
    const other = plantUserData(fixture())
    const result = run(['--dir', kept, '--dir', other])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--dir was given twice')
    expect(existsSync(join(kept, 'brobot2.sqlite'))).toBe(true)
    expect(existsSync(join(other, 'brobot2.sqlite'))).toBe(true)
  })

  it('--dir with no value is refused rather than defaulted', () => {
    // ⛔ **717 · R46** — "defaulted" is the directory derived from `HOME`, so a scratch one.
    const result = run(['--dir'], { HOME: fixture() })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--dir needs a path')
  })

  /**
   * ⚠️ **A statement about the PATH, not about BroBot's history** (352 review). The old wording —
   * *"BroBot has never written to this directory"* — asserts something this script cannot know, and
   * prints it with exit 0. ⛔ **That is what a typo in `--dir` looks like**, and a success-shaped
   * report is the worst possible answer to one.
   */
  it('an absent directory is a clean no-op that does not claim to know why', () => {
    const result = run(['--dir', join(fixture(), 'never-launched')])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('nothing at this path')
    expect(result.stdout).toContain('check the spelling')
    expect(result.stdout).not.toContain('BroBot has never written')
  })

  it('⚑ the last line says what the next launch gives, and it is not “empty”', () => {
    const result = run(['--dir', plantUserData(fixture(), { profiles: HIS_PROFILES })])
    const last = result.stdout.trimEnd().split('\n').at(-1)
    expect(last).toContain('next launch')
    expect(last).toContain('MIGRATED AND UNSEEDED, not empty')
    // ⚑ **DERIVED since 374, because the literal `19` here drifted the moment a migration landed**
    // — and it drifted in a file whose whole subject is a sentence that must state a fact rather
    // than a memory. The test above already reads the folder to pin the CLI's constant; this reads
    // the same folder so the two cannot come to disagree about what they are checking.
    const migrationCount = readdirSync(join(REPO, 'apps/desktop/src/main/db/migrations')).filter(
      (name) => name.endsWith('.sql'),
    ).length
    // ⚑ D-016 · one migration, and the sentence says it in the singular.
    expect(last).toContain(
      `${String(migrationCount)} migration${migrationCount === 1 ? '' : 's'}, one app-policy row`,
    )
    expect(migrationCount, 'the walk found no migration at all').toBeGreaterThan(0)
    expect(last).toContain('no profiles')
    // 🔴 **620 · D23 · the clause this line spent a day and a half saying wrongly.**
    // ⛔ `592` repaired {@link homesFootnote}'s copy of this claim and missed THIS one, and the
    // reason it missed it is here: **nothing pinned it.** ⚠️ A sweep guided by what the tests
    // assert cannot see a sentence no test asserts, which is `a-negative-is-only-as-strong-as-the-
    // search-shape` pointed at a suite instead of a grep.
    expect(last).toContain(`${DEFAULT_PROFILE_LABEL}'s own profile and nothing else`)
    // ⚠️ **The negative is about the CLAIM, not the word.** ⛔ What must never come back is the
    // word used as the name of a PROFILE. ⚑ Its control is the positive above: the line names the
    // profile, as `DEFAULT_PROFILE_LABEL`, in the very place the wrong name stood.
    expect(last, 'the profile is named `default` again — 592 renamed it').not.toContain(
      'offers `default`',
    )
    // ⚑ D-016 · and no project: the clause that named the default one went with projects.
    expect(last, 'the line still claims a project a fresh base no longer has').not.toContain(
      'project',
    )
    // 🔴 **516 · and what `0032`'s two NEW tables hold on a fresh base, said rather than left to be
    // discovered.** ⛔ `a-new-durable-write-under-userdata-owes-clean-base-a-decision`: a durable
    // write that this sentence does not mention is a person reading *MIGRATED AND UNSEEDED* over a
    // state it does not describe. ⚑ Both tables are created EMPTY and no migration seeds either —
    // there is no built-in `brobot` registry row, because BroBot2's own in-process server is product
    // plumbing with no URL to store (`507` §2.3).
    expect(last).toContain('no external MCP servers and no grants')
    expect(last, 'the sentence 351 printed is the defect 352 exists to correct').not.toContain(
      'the profile names',
    )
  })

  /**
   * Assert different final messages for keeping and removing profile authentication. The report must
   * describe the action performed, not an unconditional default.
   */
  it('⛔ …and it says the OPPOSITE thing under --keep-profile-auth', () => {
    const kept = run([
      '--dir',
      plantUserData(fixture(), { profiles: HIS_PROFILES }),
      '--keep-profile-auth',
    ])
    const last = kept.stdout.trimEnd().split('\n').at(-1)
    expect(kept.status, kept.stderr).toBe(0)
    expect(last).toContain('--keep-profile-auth')
    // ⚠️ **539 re-aimed this from `still in the launcher` to what the line now says.** ⛔ Not a
    // weakening: `homesOnDisk` counts every folder and `listProfileIds` is scoped to `default`,
    // so attaching a count to *the launcher* blurred what the `provider homes` footnote above
    // prints apart. ⚑ The clause this test exists for — the two behaviours say OPPOSITE things —
    // is unchanged and is asserted in both directions.
    expect(last).toContain(`${HOMES_DIRNAME}/ still stands`)
    expect(last).toContain('every profile home you made is still there')
    expect(last, 'the default sentence must not survive the flag').not.toContain('no profiles')
  })
})

describe('§7 · the report survives the pipe it is read through', () => {
  /**
   * 🔴 **Measured, and it is the failure `351` §3.2 names.** On POSIX, writes to a PIPED stdout or
   * stderr are asynchronous and `process.exit()` does not wait for them: a script that logged
   * 20 000 lines and then called `process.exit(1)` delivered **937** of them. ⛔ The paths that exit
   * non-zero are exactly the ones whose output is the only record of what happened.
   */
  it('⛔ a refusal long enough to fill the pipe buffer still reaches its last line', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        // Directories with invalid segment names: each produces one refusal line, and 1 500 of them
        // is roughly 190 kB — well past the 64 kB a macOS pipe holds.
        for (let i = 0; i < 1500; i += 1) {
          mkdirSync(join(at, HOMES_DIRNAME, `.p${String(i).padStart(4, '0')}`), { recursive: true })
        }
      },
    })
    const result = run(['--dir', userData])

    expect(result.status).toBe(1)
    expect(result.stderr.length).toBeGreaterThan(120_000)
    expect(result.stderr, 'the first refusal').toContain('provider-homes/.p0000')
    expect(result.stderr, 'the LAST refusal — this is the one a truncated pipe eats').toContain(
      'provider-homes/.p1499',
    )
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(true)
  })
})

describe('§8 · the provider-homes tree, in the shapes a real machine produces', () => {
  it('⚑ a `.DS_Store` beside the folders is removed and NAMED, not a permanent refusal', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        writeFileSync(join(at, HOMES_DIRNAME, '.DS_Store'), 'finder\n')
        writeFileSync(join(at, HOMES_DIRNAME, 'default', '.DS_Store'), 'finder\n')
      },
    })
    const result = run(['--dir', userData])
    expect(result.status, result.stderr).toBe(0)
    // ⚠️ **Named under the tree it leaves with, since 352.** The default removes `provider-homes/`
    // whole, so a stray inside it is no longer an action of its own — but `350`'s rule is that an
    // entry this reset does not know is NAMED rather than re-labelled, and it still is.
    const homes = section(result.stdout, 'provider homes')
    expect(homes).toContain('entries BroBot did not write')
    expect(homes).toContain(`${HOMES_DIRNAME}/.DS_Store`)
    expect(homes).toContain(`${HOMES_DIRNAME}/default/.DS_Store`)
    expect(existsSync(join(userData, HOMES_DIRNAME, '.DS_Store'))).toBe(false)
  })

  /**
   * ⚑ The paired positive for the line above: with `--keep-profile-auth` the tree survives, so the
   * stray is an action of its own again and lands in `other` under its own literal name — which is
   * the shape `351` had, and the one `350`'s rule was written against.
   */
  it('⚑ …and it is its own named removal when the tree is kept', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        writeFileSync(join(at, HOMES_DIRNAME, '.DS_Store'), 'finder\n')
      },
    })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status, result.stderr).toBe(0)
    expect(section(result.stdout, 'other')).toContain(`${HOMES_DIRNAME}/.DS_Store`)
    expect(existsSync(join(userData, HOMES_DIRNAME, '.DS_Store'))).toBe(false)
    expect(existsSync(join(userData, HOMES_DIRNAME, 'default', 'default', 'codex'))).toBe(true)
  })

  /**
   * 🔴 **The level the `.DS_Store` exception was never applied to** (352 review).
   *
   * ⛔ **Open `provider-homes/default/default` in Finder** — the natural thing to do to look at your
   * `claude` and `codex` homes — **and macOS writes `.DS_Store` beside them.** Until this, that file
   * matched neither `HOME_LOCK` nor `PROVIDERS`, so every `pnpm clean-base` and every `--dry-run`
   * exited 1 and removed nothing, for good, until a person deleted an invisible file by hand.
   *
   * ⚑ **And it is not a shape the product cannot account for**: `listProviderHomes` skips a
   * non-directory at this depth in silence (`provider-homes.ts:141`).
   */
  it('⚑ …and one BESIDE the provider homes, which used to make the reset unrunnable', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        writeFileSync(join(at, HOMES_DIRNAME, 'default', 'default', '.DS_Store'), 'finder\n')
      },
    })
    const result = run(['--dir', userData])
    expect(result.status, result.stderr).toBe(0)
    expect(section(result.stdout, 'provider homes')).toContain(
      `${HOMES_DIRNAME}/default/default/.DS_Store`,
    )
    expect(existsSync(join(userData, HOMES_DIRNAME))).toBe(false)

    // ⚑ …and under the flag that keeps the tree it is an `other` action, removed and named, while
    // the homes beside it survive — the same rule, on the path where the file outlives the walk.
    const kept = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        writeFileSync(join(at, HOMES_DIRNAME, 'default', 'default', '.DS_Store'), 'finder\n')
      },
    })
    expect(run(['--dir', kept, '--keep-profile-auth']).status).toBe(0)
    expect(existsSync(join(kept, HOMES_DIRNAME, 'default', 'default', '.DS_Store'))).toBe(false)
    expect(existsSync(join(kept, HOMES_DIRNAME, 'default', 'default', 'codex'))).toBe(true)
  })

  it('⚑ …while a DIRECTORY with a name BroBot could not have made still refuses the run', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        mkdirSync(join(at, HOMES_DIRNAME, '.hidden-folder'), { recursive: true })
      },
    })
    const result = run(['--dir', userData])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a valid folder name')
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(true)
  })

  it('⛔ a folder name longer than the app allows refuses too', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        mkdirSync(join(at, HOMES_DIRNAME, 'a'.repeat(65)), { recursive: true })
      },
    })
    const result = run(['--dir', userData])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a valid folder name')
  })

  it('⚑ …and exactly 64 characters is fine, so the bound is the bound', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        mkdirSync(join(at, HOMES_DIRNAME, 'a'.repeat(64), 'p', 'codex'), { recursive: true })
      },
    })
    expect(run(['--dir', userData]).status).toBe(0)
  })

  it('removes a provisioning lock and its steal remnant, both beside the leaf', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        const profile = join(at, HOMES_DIRNAME, 'default', 'default')
        writeFileSync(join(profile, 'codex.lock'), '')
        writeFileSync(join(profile, 'claude.lock.stale-1234-0'), '')
      },
    })
    const profile = join(userData, HOMES_DIRNAME, 'default', 'default')
    expect(existsSync(join(profile, 'codex.lock'))).toBe(true)

    // ⚑ **A lock is not an unknown shape**, and that is the whole point of naming it: without the
    // {@link HOME_LOCK} rule it is "neither a claude/codex home nor a provisioning lock" and the run
    // refuses. The default removes the tree it sits in, so what this asserts is that the run
    // SUCCEEDS — a refusal here would leave `brobot2.sqlite` behind.
    expect(run(['--dir', userData]).status).toBe(0)
    expect(existsSync(join(userData, HOMES_DIRNAME)), 'the tree goes, lock and all').toBe(false)

    // ⚠️ And under the flag that keeps the tree, the lock is still removed BESIDE the leaf it
    // guards — the shape `351` had, which is the one that can still go wrong.
    const kept = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        const home = join(at, HOMES_DIRNAME, 'default', 'default')
        writeFileSync(join(home, 'codex.lock'), '')
        writeFileSync(join(home, 'claude.lock.stale-1234-0'), '')
      },
    })
    const keptProfile = join(kept, HOMES_DIRNAME, 'default', 'default')
    expect(run(['--dir', kept, '--keep-profile-auth']).status).toBe(0)
    expect(existsSync(join(keptProfile, 'codex.lock'))).toBe(false)
    expect(existsSync(join(keptProfile, 'claude.lock.stale-1234-0'))).toBe(false)
    expect(existsSync(join(keptProfile, 'codex')), 'the home itself stays').toBe(true)
  })
})

describe('§9 · the module defaults, for a caller that does not pass options', () => {
  /**
   * ⛔ **A `kept on purpose` line has to have something to keep** (352 review). It used to be pushed
   * the moment `provider-homes/` appeared in the top-level listing — before any `codex` home had
   * been walked — so a tree with no Codex credential in it printed a promise about a file that was
   * never there.
   */
  it('⚑ …and the credential keep is claimed only when a credential was really kept', () => {
    const bare = fixture()
    const userData = join(bare, 'ud')
    // ⚑ **A Codex home whose first session never ran** — `provisionProviderHome` makes the
    // directory and `provisionCodexAuth` writes the credential, so this is a real state, and it is
    // the one that tells "a codex home exists" apart from "a credential is here to keep".
    mkdirSync(join(userData, HOMES_DIRNAME, HOME_FOLDER, 'writer', 'codex'), {
      recursive: true,
    })
    mkdirSync(join(userData, HOMES_DIRNAME, HOME_FOLDER, 'writer', 'claude'), {
      recursive: true,
    })
    writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')

    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status, result.stderr).toBe(0)
    expect(keptBlock(result.stdout), 'nothing here holds a credential').not.toContain(CODEX_AUTH)

    // ⚑ The paired positive: the same run over a tree that does hold one names it.
    const withAuth = plantUserData(fixture())
    const kept = run(['--dir', withAuth, '--keep-profile-auth'])
    expect(kept.status, kept.stderr).toBe(0)
    expect(keptBlock(kept.stdout)).toContain(`${HOMES_DIRNAME}/*/*/codex/${CODEX_AUTH}`)
  })

  /**
   * ⛔ **A home in a folder beside `default` is removed and was never in the menu** (352 review).
   * The launcher lists only the homes under {@link HOME_FOLDER} (D-016 commit 2), so the report has
   * to print the others apart rather than say "the launcher offers" over both.
   */
  it('⚑ a home in a folder beside `default` is named apart from the launcher’s menu', () => {
    const userData = plantUserData(fixture(), {
      extra: ({ userData: at }) => {
        mkdirSync(join(at, HOMES_DIRNAME, 'staging', 'qa', 'codex'), { recursive: true })
      },
    })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    expect(result.status, result.stderr).toBe(0)

    const homes = section(result.stdout, 'provider homes')
    const menuLine = homes
      .split('\n')
      .findIndex((line) => line.includes('the launcher still offers'))
    const apartLine = homes
      .split('\n')
      .findIndex((line) => line.includes('the launcher never listed'))
    expect(menuLine, 'the menu sentence must be printed').toBeGreaterThan(-1)
    expect(apartLine, 'and the other folder must be printed apart from it').toBeGreaterThan(
      menuLine,
    )
    expect(homes.split('\n').slice(apartLine).join('\n')).toContain('staging/qa')
    expect(
      homes.split('\n').slice(menuLine, apartLine).join('\n'),
      'a home the launcher never listed must not sit under the sentence that says it does',
    ).not.toContain('staging/qa')
  })
})

describe('§10 · the pasted-image root', () => {
  it('⚑ goes when it is empty — 350: "then remove the root only if empty"', () => {
    const userData = plantUserData(fixture())
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')

    const result = run(['--dir', userData])
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(pasted), 'an emptied root is removed').toBe(false)
    expect(result.stdout).toContain('and the root itself, now empty')
  })

  /**
   * ⛔ **A LEAF symlink, which is the only shape where the two spellings reach different
   * directories.** A symlinked PREFIX (`/tmp` → `/private/tmp`) gives two spellings of one
   * directory, so a sweep of either finds the same files and the bug is invisible. With the link on
   * the leaf, `dirname(lexical)` and `dirname(real)` are genuinely different parents.
   */
  it('⛔ is the sibling of the RESOLVED userData, not of the spelling that was typed', () => {
    const root = fixture()
    const userData = plantUserData(join(root, 'real'))
    const alias = join(root, 'alias-ud')
    symlinkSync(userData, alias)
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')

    expect(pastedImagesRoot(alias), 'the fixture must give two different roots').not.toBe(pasted)
    expect(run(['--dir', alias]).status).toBe(0)
    expect(existsSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'))).toBe(false)
  })

  /**
   * ⛔ **A preview may not predict from a directory the preview did not empty** (352 review). The
   * dry run used to `readdir` a root still holding every `pasted-*.png`, report *"the root stays (it
   * is not empty)"*, and be immediately contradicted by the run it was previewing.
   */
  it('⛔ a dry run says the root would go, and does not say the opposite of the real run', () => {
    const userData = plantUserData(fixture())
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')

    const preview = run(['--dir', userData, '--dry-run'])
    expect(preview.status, preview.stderr).toBe(0)
    expect(preview.stdout).toContain('a real run would then leave empty')
    expect(preview.stdout, 'the preview promised the opposite of the run').not.toContain(
      'the root stays',
    )
    expect(existsSync(pasted), 'a preview that removed it').toBe(true)

    // ⚑ …and the real run, on the same shape, does what the preview said.
    expect(run(['--dir', userData]).status).toBe(0)
    expect(existsSync(pasted)).toBe(false)
  })

  /**
   * ⛔ **A removal that failed has to reach the exit code** (352 review). This was the one path
   * where a partial failure was printed and the process still exited 0 — in a script whose own
   * header says a silent success and a silent partial failure must not look identical.
   */
  it('⛔ a root it could not remove exits non-zero and says so', () => {
    const root = fixture()
    const userData = plantUserData(root)
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')
    // The PARENT is unwritable, so the files inside come off and the `rmdir` of the root cannot.
    chmodSync(dirname(pasted), 0o555)
    try {
      const result = run(['--dir', userData])
      expect(result.status, 'a failed rmdir that exits 0').toBe(1)
      expect(result.stdout).toContain('⛔ the root stays')
      expect(existsSync(pasted), 'the fixture must really have kept it').toBe(true)
    } finally {
      chmodSync(dirname(pasted), 0o755)
    }
  })

  /**
   * ⛔ **`anchor.real`, in the `kept on purpose` list too** (352 review) — the mistake the CLI's own
   * comment warns against 100 lines earlier. On a leaf-symlinked userData the lexical spelling names
   * a sibling that does not exist, so the report told a person their file was kept somewhere they
   * would find nothing.
   */
  it('⛔ the stray it keeps is named at the path it is really at', () => {
    const root = fixture()
    const userData = plantUserData(join(root, 'real'))
    const alias = join(root, 'alias-ud')
    symlinkSync(userData, alias)
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'holiday.png'), 'not ours\n')

    const result = run(['--dir', alias])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(join(pasted, 'holiday.png'))
    expect(result.stdout, 'a path nothing is at').not.toContain(
      join(pastedImagesRoot(alias), 'holiday.png'),
    )
    expect(existsSync(join(pasted, 'holiday.png'))).toBe(true)
  })

  /**
   * ⚑ **A directory came off disk and the total said nothing did** (352 review). `totalPaths` is the
   * one number a person reads to know whether the command did anything, and the pasted-image root
   * was removed outside every group and counted in none of them.
   *
   * ⚠️ **Differential rather than absolute**, so the assertion does not pin a fixture's exact size:
   * the same userData with and without the root, and the difference is the png plus the root.
   */
  it('⚑ the root it removes is in the total, not outside it', () => {
    const total = (text) => Number(/^ {2}(\d+) paths? · /m.exec(text)?.[1] ?? -1)

    const without = plantUserData(fixture())
    const bare = run(['--dir', without])
    expect(bare.status, bare.stderr).toBe(0)

    const withRoot = plantUserData(fixture())
    const pasted = pastedImagesRoot(realpathSync(withRoot))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')
    const full = run(['--dir', withRoot])
    expect(full.status, full.stderr).toBe(0)

    expect(total(bare.stdout)).toBeGreaterThan(0)
    expect(total(full.stdout) - total(bare.stdout), 'the png and the root it left empty').toBe(2)
  })

  it('⚑ …and stays when something it does not own is in it', () => {
    const userData = plantUserData(fixture())
    const pasted = pastedImagesRoot(realpathSync(userData))
    mkdirSync(pasted, { recursive: true })
    writeFileSync(join(pasted, 'pasted-0123456789abcdef0123456789abcdef.png'), 'PNG\n')
    writeFileSync(join(pasted, 'holiday.png'), 'not ours\n')

    expect(run(['--dir', userData]).status).toBe(0)
    expect(existsSync(pasted)).toBe(true)
    expect(readFileSync(join(pasted, 'holiday.png'), 'utf8')).toBe('not ours\n')
  })
})

/**
 * 🔴 **539 · a flag that kept nothing and said it did.**
 *
 * ## ⛔ The run that produced this section
 *
 * `--dir <userData>/.. --keep-profile-auth`, twice, an hour apart, on a real machine. Both runs
 * printed `other — 232 paths · 12 MB` over one entry named `desktop`, exited 0, and both ended
 * *"…but you passed --keep-profile-auth, so provider-homes/ still stands: every profile you made is
 * still in the launcher, each with the auth.json it already had."* ⛔ **Both runs had just deleted
 * every one of them.** Reproduced on a fixture against `2d473821` before a line was changed.
 *
 * ## ⚑ Two defects, and the report only ever showed the second
 *
 *  - 🔴 **the classification.** `--keep-profile-auth` is keyed to `provider-homes` being a CHILD of
 *    the target, and an unrecognised entry is removed RECURSIVELY — so a userData nested inside the
 *    target took the whole tree with it while the guard was looking one level up. ⚠️ The guard and
 *    the act were measured at different depths, which is the shape rather than the instance;
 *  - 🔴 **the verdict.** `nextLaunch(keepAuth, …)` was handed the flag and nothing else, so the
 *    sentence was selected by the ARGUMENT. ⚑ The `kept on purpose` block on the same page was
 *    already outcome-derived (`keepAuth && homes.kept > 0`) and said nothing at all — the two
 *    halves of one report contradicted each other and only the false one was read.
 *
 * ⛔ **Where a credential is the subject these read BYTES.** A directory the next launch recreates
 * makes an `existsSync` assertion pass over exactly this defect, and the bytes differ per profile
 * so a keep that took the wrong file cannot pass either.
 */
describe('§11 · ⛔ 539 · a flag that says it keeps something keeps it', () => {
  /** His shape: the userData one level down, and `--dir` naming the directory above it. */
  function parentOfAUserData(profiles = ['default'], enclosing = ['@brobot2']) {
    const root = fixture()
    const parent = join(root, ...enclosing)
    const userData = plantUserData(parent, { profiles })
    return { target: join(root, enclosing[0]), parent, userData }
  }

  /** Every planted credential, still holding the bytes its own profile was given. */
  function credentialsSurvive(userData, profiles) {
    for (const profile of profiles) {
      expect(
        readFileSync(
          join(userData, HOMES_DIRNAME, HOME_FOLDER, profile, 'codex', CODEX_AUTH),
          'utf8',
        ),
        `${profile}'s credential`,
      ).toBe(`not-a-real-credential-${profile}\n`)
    }
  }

  it('🔴 the reported run — one level too high took the credentials and said it kept them', () => {
    const { target, userData } = parentOfAUserData(HIS_PROFILES)
    // ⚑ **The premise, asserted.** Five credentials with five different bodies, so "they survived"
    // cannot be satisfied by a tree that was never populated.
    credentialsSurvive(userData, HIS_PROFILES)

    const result = run(['--dir', target, '--keep-profile-auth'])

    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('Nothing was removed')
    expect(result.stderr, 'it names the nested userData, not just the entry').toContain(
      `${realpathSync.native(userData)} looks like one`,
    )
    expect(result.stderr).toContain('point --dir at it if that is the one you meant')
    // ⚑ **Which sign it names is pinned, because a refusal a person cannot reproduce is one they
    // cannot act on.** ⛔ Byte order puts `brobot-workspace` first (`-` is 0x2d, `2` is 0x32);
    // `localeCompare` ignores the punctuation and would name `brobot2.sqlite` instead, which is
    // the machine's collation deciding what a report says.
    expect(result.stderr, 'the first sign by BYTE order').toContain(
      'ud/brobot-workspace is under it',
    )
    // ⛔ **The bytes, which is the whole assertion** — `existsSync` on a directory the next launch
    // recreates would pass over the defect this test exists for.
    credentialsSurvive(userData, HIS_PROFILES)
    expect(existsSync(join(userData, 'brobot2.sqlite')), 'a refusal removes NOTHING').toBe(true)
    expect(
      `${result.stdout}${result.stderr}`,
      'and it may not print the sentence it used to print here',
    ).not.toContain('still stands')
  })

  it('⛔ …and the same target with no flag at all refuses too — the directory is wrong either way', () => {
    const { target, userData } = parentOfAUserData(HIS_PROFILES)
    const result = run(['--dir', target])

    expect(result.status, result.stdout).toBe(1)
    credentialsSurvive(userData, HIS_PROFILES)
    expect(
      readFileSync(join(userData, 'exports', 'a1.brobot-session.json'), 'utf8'),
      'the export nothing asked to drop is still there',
    ).toBe('{"version":1}\n')
  })

  it('⚠️ …and the PREVIEW told the same lie, which is where a careful person would have looked', () => {
    const { target } = parentOfAUserData()
    const preview = run(['--dir', target, '--keep-profile-auth', '--dry-run'])

    // ⛔ **A refusal is checked before anything is applied, so `--dry-run` reaches it too.** Before
    // this dispatch the preview printed `would remove / other / ud` and the same keep sentence:
    // the one instrument that exists to be run FIRST agreed with the run that destroyed the files.
    expect(preview.status, preview.stdout).toBe(1)
    expect(`${preview.stdout}${preview.stderr}`).not.toContain('still stands')
    // ⛔ **Not a byte check here** (539 review). A dry run reaches no mutating syscall at all —
    // every one is behind the `apply` guard — so `credentialsSurvive` after one is an assertion
    // that passes under the defect and the repair alike. ⚑ What DISCRIMINATES is that the preview
    // no longer previews the removal: before this dispatch it printed `would remove / other / ud`.
    expect(preview.stdout, 'a refused run previews nothing').not.toContain('would remove')
    expect(preview.stderr).toContain('Nothing was removed')
  })

  it('⚑ a userData nested TWO levels down is found at the depth it is really at', () => {
    const { target, userData } = parentOfAUserData(['default'], ['Application Support', '@brobot2'])
    const result = run(['--dir', target, '--keep-profile-auth'])

    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr, 'the entry it would have removed').toContain(
      '@brobot2 is not a name this reset knows',
    )
    expect(result.stderr, 'and the sign, at the depth it is at').toContain(`@brobot2/ud/`)
    // 🔴 **The remedy has to name the userData, not the entry** (539 review). It used to
    // interpolate the depth-one entry, so at two levels it sent a person to
    // `…/Application Support/@brobot2` — one directory too high, into the same mistake they were
    // being warned about. ⚑ Derived from the SIGN now, so depth one and depth two agree.
    expect(result.stderr, 'the target it offers is the userData itself').toContain(
      `${realpathSync.native(userData)} looks like one`,
    )
    credentialsSurvive(userData, ['default'])
  })

  /**
   * ⚑ **The paired positive, and the reason {@link NESTED_USERDATA_SIGNS} is not the whole manifest.**
   *
   * ⛔ A refusal keyed to `exports` or `resources` would fire on any unfamiliar Chromium directory
   * holding a folder of that name, and a reset a person cannot run is the one `351` §1 rules worse
   * than none. This plants both ordinary words inside an `other` entry and requires the run to
   * finish — so the scan is measured where it must NOT fire as well as where it must.
   */
  it('⚑ …while an ordinary userData with those words nested inside it is not refused', () => {
    const userData = plantUserData(fixture(), {
      profiles: HIS_PROFILES,
      extra: ({ userData: at }) => {
        mkdirSync(join(at, 'Cache', 'exports'), { recursive: true })
        mkdirSync(join(at, 'Local Storage', 'leveldb', 'resources'), { recursive: true })
        writeFileSync(join(at, 'Cache', 'exports', 'x.bin'), 'chromium\n')
        // ⛔ **And a bundle NAME somewhere that is not an exports directory.** `BUNDLE_NAME` is a
        // sign only under `exports/`, because that is the only place the holder can be derived
        // from — a loose copy in a cache says nothing about where a userData is, and advice this
        // walk cannot compute is advice it must not give.
        mkdirSync(join(at, 'Cache', 'stray'), { recursive: true })
        writeFileSync(join(at, 'Cache', 'stray', 'a1.brobot-session.json'), '{"v":1}\n')
      },
    })
    // ⛔ **The premise, because the subject removes its own evidence** (539 review). `Cache` goes
    // with the run, so after it there is nothing left to show the two ordinary words were ever
    // under an unrecognised entry — and the control would then verify nothing.
    expect(existsSync(join(userData, 'Cache', 'exports')), 'the planted word').toBe(true)
    expect(existsSync(join(userData, 'Local Storage', 'leveldb', 'resources'))).toBe(true)
    expect(existsSync(join(userData, 'Cache', 'stray', 'a1.brobot-session.json'))).toBe(true)
    const result = run(['--dir', userData])

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(userData, 'Cache')), 'the unfamiliar entry still goes').toBe(false)
    expect(existsSync(join(userData, HOMES_DIRNAME))).toBe(false)
  })

  it('🔴 the verdict, arm one — something survived and the line says how much', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const result = run(['--dir', userData, '--keep-profile-auth'])
    const last = result.stdout.trimEnd().split('\n').at(-1)

    expect(result.status, result.stderr).toBe(0)
    expect(last).toContain(
      `the ${String(HIS_PROFILES.length)} managed ${CODEX_AUTH} under it were kept`,
    )
    // ⚑ **And the count is the disk's, not the fixture's** — the assertion above is only worth
    // having because these five files are really still there, with their own bytes.
    credentialsSurvive(userData, HIS_PROFILES)
  })

  it('🔴 arm two — the flag was passed, nothing was kept, and the line says THAT', () => {
    // ⚑ **A userData with no `provider-homes` at all**, which is the state a fresh install is in
    // and the state a clean base leaves behind. ⛔ Before this dispatch the last line here read
    // *"provider-homes/ still stands … each with the auth.json it already had"*.
    const root = fixture()
    const userData = join(root, 'ud')
    mkdirSync(join(userData, 'exports'), { recursive: true })
    writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')
    const result = run(['--dir', userData, '--keep-profile-auth'])
    const last = result.stdout.trimEnd().split('\n').at(-1)

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(userData, HOMES_DIRNAME)), 'the premise: there was never a tree').toBe(
      false,
    )
    // ⚑ **The whole clause, including the tense token.** ⛔ `${dryRun ? '' : ' now'}` is the one
    // byte that separates the real run's reading from the preview's, and a substring that stopped
    // at *"for it to keep"* left it asserted in the negative only (539 review).
    expect(last).toContain(
      `You passed --keep-profile-auth and there is nothing here for it to keep: this path has no ${HOMES_DIRNAME}/ now.`,
    )
    expect(last, 'the sentence that was wrong is the one that must not appear').not.toContain(
      'still stands',
    )
    expect(keptBlock(result.stdout), 'and the other half of the page agrees').not.toContain(
      CODEX_AUTH,
    )

    // ⚑ **And the preview of the same run says it in the conditional mood.** ⛔ `352`'s rule is
    // that a preview may not claim the past tense; this clause has two spellings for that reason
    // and both are entered here rather than one being carried by a reader's goodwill.
    const preview = run(['--dir', userData, '--keep-profile-auth', '--dry-run'])
    const previewLast = preview.stdout.trimEnd().split('\n').at(-1)
    expect(preview.status, preview.stderr).toBe(0)
    expect(previewLast).toContain('there is nothing here for it to keep: this path has no')
    expect(previewLast, 'a preview has no `now` to speak of').not.toContain(
      `no ${HOMES_DIRNAME}/ now`,
    )
  })

  it('⚑ arm three — the homes stand with no credential under them, and neither half over-claims', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    // ⚠️ **A Claude-only profile is an ordinary shape**: Claude reads the machine Keychain and
    // persists no credential file, so a tree of them keeps names and nothing else.
    mkdirSync(join(userData, HOMES_DIRNAME, HOME_FOLDER, 'developer', 'claude', 'projects'), {
      recursive: true,
    })
    writeFileSync(
      join(userData, HOMES_DIRNAME, HOME_FOLDER, 'developer', 'claude', 'projects', 's.jsonl'),
      '{}\n',
    )
    writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')
    const result = run(['--dir', userData, '--keep-profile-auth'])
    const last = result.stdout.trimEnd().split('\n').at(-1)

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(userData, HOMES_DIRNAME)), 'the tree really did stay').toBe(true)
    expect(last).toContain('still stands')
    expect(last).toContain(`no managed ${CODEX_AUTH} was kept`)
    expect(last, 'the plural arm belongs to the other outcome').not.toContain('were kept')
    expect(keptBlock(result.stdout)).not.toContain(CODEX_AUTH)
  })

  /**
   * 🔴 **The preview arm of the new post-state, which nothing entered** (539 review).
   *
   * ⛔ `standing` on a preview is `keepAuth && plan.sawHomes` and `credentials` is `plan.kept` —
   * the ONLY reader of either — and every `--dry-run` run in this file either omitted the flag or
   * pointed at a tree with no `provider-homes` at all. ⚠️ **So `{ standing: false, credentials: 0 }`
   * would have passed the whole suite** while a preview of a five-profile keep told a person their
   * profiles were about to go.
   */
  it('⚑ the PREVIEW of a keep predicts the keep, and says it in the conditional mood', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const result = run(['--dir', userData, '--keep-profile-auth', '--dry-run'])
    const last = result.stdout.trimEnd().split('\n').at(-1)

    expect(result.status, result.stderr).toBe(0)
    expect(last).toContain('if you run this without --dry-run')
    expect(last).toContain(`${HOMES_DIRNAME}/ still stands`)
    expect(last).toContain(
      `the ${String(HIS_PROFILES.length)} managed ${CODEX_AUTH} under it would be kept`,
    )
    // ⛔ **A preview may not claim the past tense** — 352's rule, and this is the clause where the
    // two spellings diverge.
    expect(last, 'the indicative belongs to the run that did it').not.toContain('were kept')
    credentialsSurvive(userData, HIS_PROFILES)
  })

  /**
   * ⚑ **One credential under three profiles** (539 review), which separates two things the
   * five-and-five fixture cannot: ⛔ the count in the sentence is of CREDENTIALS, not of profile
   * homes — and it is the only fixture that enters the singular arm of the agreement, which no
   * test and no mutation row reached. ⚠️ A single-profile machine after its first Codex
   * conversation is the commonest shape there is.
   */
  it('⚑ the count is of credentials, not of homes — and one of them reads as one', () => {
    const root = fixture()
    const userData = join(root, 'ud')
    for (const profile of ['default', 'developer', 'mem-1']) {
      mkdirSync(join(userData, HOMES_DIRNAME, HOME_FOLDER, profile, 'claude'), {
        recursive: true,
      })
    }
    mkdirSync(join(userData, HOMES_DIRNAME, HOME_FOLDER, 'default', 'codex'), {
      recursive: true,
    })
    const auth = join(userData, HOMES_DIRNAME, HOME_FOLDER, 'default', 'codex', CODEX_AUTH)
    writeFileSync(auth, 'not-a-real-credential-default\n')
    chmodSync(auth, 0o600)
    writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')

    const result = run(['--dir', userData, '--keep-profile-auth'])
    const last = result.stdout.trimEnd().split('\n').at(-1)

    expect(result.status, result.stderr).toBe(0)
    expect(last, 'three homes, one credential').toContain(
      `the 1 managed ${CODEX_AUTH} under it was kept`,
    )
    expect(last, 'the plural would be the home count, which is not what this counts').not.toContain(
      'were kept',
    )
    expect(readFileSync(auth, 'utf8')).toBe('not-a-real-credential-default\n')
  })

  /**
   * 🔴 **The tree a CLEANED userData leaves, which no manifest name can mark** (539 review).
   *
   * ⛔ A successful default run leaves exactly one thing: `exports/`. ⚠️ **So the directory the
   * name-based scan cannot see is precisely the one whose only content is the file this script
   * refuses to take** — reset on Monday, `--dir` one level too high on Tuesday, exports gone with
   * exit 0 and no `--drop-exports`. ⚑ `BUNDLE_NAME` is the sign that closes it, and it is the
   * product's own suffix rather than the ordinary word `exports`.
   */
  it('🔴 an already-cleaned userData is still found, by the one file that cannot be regenerated', () => {
    const root = fixture()
    const parent = join(root, '@brobot2')
    const cleaned = join(parent, 'ud')
    mkdirSync(join(cleaned, 'exports'), { recursive: true })
    writeFileSync(join(cleaned, 'exports', 'a1.brobot-session.json'), '{"version":1}\n')
    // ⛔ **The premise: this tree has no other sign left.** If it had one the test would pass for
    // the wrong reason, and the gap this closes would be untested.
    expect(readdirSync(cleaned)).toEqual(['exports'])

    const result = run(['--dir', parent])

    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('ud/exports/a1.brobot-session.json is under it')
    // ⚑ **And the target it offers is the userData, not the `exports/` the sign is in.**
    expect(result.stderr).toContain(`${realpathSync.native(cleaned)} looks like one`)
    expect(result.stderr, 'not the directory the sign happens to sit in').not.toContain(
      `${realpathSync.native(cleaned)}/exports looks like`,
    )
    expect(readFileSync(join(cleaned, 'exports', 'a1.brobot-session.json'), 'utf8')).toBe(
      '{"version":1}\n',
    )
  })

  /**
   * ⚑ **Which sign a refusal names is the TREE's answer, not the machine's** (539 review).
   *
   * ⛔ `localeCompare` resolves against the runtime's locale and ICU build, so two machines with
   * byte-identical trees can print different paths — the drift {@link REPORT_ORDER} exists for one
   * report over, and a refusal a person cannot reproduce is a refusal they cannot act on.
   *
   * ⚠️ **Measured where the two readings DIVERGE, because everywhere else they agree.** On the
   * ordinary fixture both orders name `brobot-workspace` first and the assertion would prove
   * nothing — `a-comparison-tested-where-both-sides-agree-measures-nothing`. `Cache` and `backup`
   * are chosen for the one property that separates them: byte order puts uppercase first
   * (`C` is 0x43, `b` is 0x62) and collation does not.
   */
  it('⚑ …and which sign it names is the tree’s order, not the runtime’s collation', () => {
    const root = fixture()
    const nest = join(root, 'parent', 'nest')
    for (const side of ['Cache', 'backup']) {
      mkdirSync(join(nest, side), { recursive: true })
      writeFileSync(join(nest, side, 'brobot2.sqlite'), 'ledger\n')
    }
    const result = run(['--dir', join(root, 'parent')])

    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr, 'byte order reaches Cache first').toContain(
      'nest/Cache/brobot2.sqlite is under it',
    )
    expect(result.stderr, 'which is what a collation would have named instead').not.toContain(
      'nest/backup/brobot2.sqlite',
    )
  })

  it('⛔ a directory under an unknown name that cannot be READ is a refusal, not a half-clean base', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const locked = join(userData, 'Cache', 'locked')
    mkdirSync(locked, { recursive: true })
    chmodSync(locked, 0o000)
    try {
      // ⛔ **The premise, because a readable directory would make this pass vacuously** — a test
      // run as root, or on a filesystem that ignores the mode, has to say so rather than go green.
      expect(() => readdirSync(locked)).toThrow()
      const result = run(['--dir', userData])

      expect(result.status, result.stdout).toBe(1)
      expect(result.stderr).toContain('could not be listed')
      expect(result.stderr).toContain('Nothing was removed')
      credentialsSurvive(userData, HIS_PROFILES)
      expect(existsSync(join(userData, 'brobot2.sqlite')), 'nothing was removed at all').toBe(true)
    } finally {
      chmodSync(locked, 0o700)
    }
  })
})
