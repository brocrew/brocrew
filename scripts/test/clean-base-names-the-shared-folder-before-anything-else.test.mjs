import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { againstTheSharedFolder } from '../lib/clean-base.mjs'
import { trustedAnchor } from '../lib/safe-remove.mjs'
import { DATA_FOLDER_NAME, defaultUserData, pastedImagesRoot } from '../lib/user-data.mjs'
import { fixture, removeFixtures } from './fixtures/a-planted-user-data.mjs'

/**
 * # ⚑ W4.90 · the reset says whose data it is, at the head of its report — asked WITHOUT running it
 *
 * `6c0262e7`: the warning used to hang on *"no `--dir` was given"*; it now hangs on *"the target IS
 * the shared folder"*, however it was reached. `clean-base-without-running-it.test.mjs` pins the
 * condition's text and the sentence; the gate-only test runs both cases on a Mac. ⚑ This file holds
 * what neither does without a start: the sentence is said BEFORE the run can be refused or found
 * empty, on a dry run as on a real one, and the folder it compares against is the one every
 * platform's build falls back to.
 *
 * 🔴 **W4.117 · and "however it was reached" now includes a link.** The condition compared
 * `resolve()`d spellings, which follow no link, so a `--dir` that was a link to the shared folder
 * passed as another folder while the run anchored on the real one. ⚑ `againstTheSharedFolder`
 * asks it of the folders, and is asked here of a planted "shared" folder under `/tmp/b351-cb-*`;
 * ⛔ never of the real one: every call below names its own.
 *
 * ⛔ **Nothing here starts a process.** The CLI's source is read once, as text, and never
 * evaluated. The library is asked what a path IS and where the run would anchor, which reads the
 * disk and removes nothing; the folders it is asked about are the fixture module's, removed by it.
 */

afterEach(removeFixtures)

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
/** ⚑ The CLI's source, READ — once, here, and never run. */
const CLI_SOURCE = readFileSync(join(SCRIPTS, 'clean-base.mjs'), 'utf8')

const MAIN = CLI_SOURCE.slice(CLI_SOURCE.indexOf('async function main() {'))
const WHOSE = 'the data of every BroBot on this machine not started with its own --user-data-dir'
const SAID = MAIN.indexOf(WHOSE)
/** The `if (…) {` line the sentence hangs on — the last one opened above it. */
const GUARD_AT = MAIN.lastIndexOf('if (', SAID)
const GUARD = MAIN.slice(GUARD_AT, MAIN.indexOf('\n', GUARD_AT)).trim()

/** How many blocks are open at `at`, counted from `main`'s own brace. */
function depthAt(text, at) {
  let depth = 0
  for (const one of text.slice(0, at)) {
    if (one === '{') depth += 1
    if (one === '}') depth -= 1
  }
  return depth
}

describe('W4.90 · the shared folder is said first', () => {
  it('⚑ the sentence is in main, guarded by the target being the shared folder', () => {
    expect(MAIN.startsWith('async function main() {')).toBe(true)
    expect(SAID).toBeGreaterThan(0)
    expect(GUARD).toBe('if (shared !== null) {')
    // ⚑ W4.117 · asked of the folder the target leads to, and of nothing else.
    const asked = MAIN.indexOf('const shared = againstTheSharedFolder(target)')
    expect(asked).toBeGreaterThan(0)
    expect(asked).toBeLessThan(GUARD_AT)
    // ⚑ The target it compares is the one the report's first line names.
    expect(MAIN).toContain('const target = parsed.dir ?? defaultUserData()')
    expect(MAIN.indexOf('const target = parsed.dir ?? defaultUserData()')).toBeLessThan(asked)
  })

  it('⛔ …and on nothing else: not on whether --dir was given, nor on a dry run', () => {
    expect(GUARD.includes('parsed')).toBe(false)
    expect(GUARD.includes('dryRun')).toBe(false)
    expect(GUARD.includes('anchor')).toBe(false)
    // ⚑ Said at main's own level, not inside a branch a dry run or a refusal skips.
    expect(depthAt(MAIN, GUARD_AT)).toBe(1)
  })

  it('⛔ it is said after the head line and before the run can be refused, found empty, or printed', () => {
    const head = MAIN.indexOf('out.push(`clean base${dryRun')
    const anchored = MAIN.indexOf('trustedAnchor(target')
    const refused = MAIN.indexOf('console.error(`${out.join')
    const printed = MAIN.indexOf('console.log(out.join')
    for (const at of [head, anchored, refused, printed]) expect(at).toBeGreaterThan(0)
    expect(head).toBeLessThan(GUARD_AT)
    expect(SAID).toBeLessThan(anchored)
    expect(SAID).toBeLessThan(refused)
    expect(SAID).toBeLessThan(printed)
    // ⚑ One fact over: the sentence is said once, and nowhere after the anchor.
    expect(MAIN.indexOf(WHOSE, SAID + 1)).toBe(-1)
  })

  it('⚠️ W4.117 · a folder inside it, or one holding it, is named so — never said as the folder itself', () => {
    const said = MAIN.slice(GUARD_AT, MAIN.indexOf('\n', SAID))
    expect(said).toContain("is: ''")
    expect(said).toContain('inside: `inside ${defaultUserData()}, `')
    expect(said).toContain('holds: `holding ${defaultUserData()}, `')
    expect(said).toContain('}[shared]')
    expect(said).toContain(`\`  ⚠️  \${where}${WHOSE}`)
  })
})

describe('W4.90 · the folder it compares against', () => {
  it('⚑ is the one data folder on every system, read from the variables each system uses', () => {
    const roaming = join(sep, 'scratch', 'Roaming')
    const config = join(sep, 'scratch', 'config')
    expect(defaultUserData('win32', { APPDATA: roaming })).toBe(join(roaming, DATA_FOLDER_NAME))
    expect(defaultUserData('linux', { XDG_CONFIG_HOME: config })).toBe(
      join(config, DATA_FOLDER_NAME),
    )
    expect(
      defaultUserData('darwin', {}).endsWith(join('Application Support', DATA_FOLDER_NAME)),
    ).toBe(true)
  })

  it('⛔ a --dir spelled another way is the same folder; its sibling is not, its child is inside it, its parent holds it', () => {
    const shared = plantedShared()
    // ⚠️ Raw strings, as a person types them after --dir: none of them IS the shared path's text.
    const same = [`${shared}${sep}`, `${shared}${sep}.`, `${shared}${sep}x${sep}..`]
    for (const spelled of same) {
      expect(spelled === shared).toBe(false)
      expect(againstTheSharedFolder(spelled, shared), spelled).toBe('is')
    }
    expect(againstTheSharedFolder(pastedImagesRoot(shared), shared)).toBe(null)
    expect(againstTheSharedFolder(join(shared, 'nested'), shared)).toBe('inside')
    expect(againstTheSharedFolder(dirname(shared), shared)).toBe('holds')
  })
})

/** A planted stand-in for `<appData>/@brobot2/desktop`, with a folder in it — never the real one. */
function plantedShared() {
  const shared = join(fixture(), 'appdata', DATA_FOLDER_NAME)
  mkdirSync(join(shared, 'brobot-workspace'), { recursive: true })
  return shared
}

/**
 * Where the run would anchor. ⚠️ A scratch home and no environment, so the never-touch roots it
 * checks against are scratch too, and no real `~/.claude`, `~/.codex` or provider home is looked at.
 */
const anchoredAt = (path) => trustedAnchor(path, { home: fixture(), env: {} })

describe('W4.117 · the shared folder is the FOLDER, wherever the --dir leads', () => {
  it('🔴 a link to it is it — where `resolve()` said another folder and the run anchored on it anyway', () => {
    const shared = plantedShared()
    const link = join(fixture(), 'to-shared')
    symlinkSync(shared, link)
    // ⛔ The gap, as it stood: the spellings differ, so the old condition said "not the shared folder"…
    expect(resolve(link) === resolve(shared)).toBe(false)
    // …while the run anchors on the real folder, and empties THAT.
    const anchor = anchoredAt(link)
    expect(anchor.kind).toBe('trusted')
    expect(anchor.real).toBe(realpathSync.native(shared))
    // ⚑ Asked of the folder, it is the shared folder — as the real path is.
    expect(againstTheSharedFolder(link, shared)).toBe('is')
    expect(againstTheSharedFolder(realpathSync.native(shared), shared)).toBe('is')
  })

  it('🔴 …and so is a path through a linked PARENT, whether the folder is there yet or not', () => {
    const shared = plantedShared()
    const parentLink = join(fixture(), 'to-parent')
    symlinkSync(dirname(shared), parentLink)
    expect(againstTheSharedFolder(join(parentLink, 'desktop'), shared)).toBe('is')
    // ⚠️ A machine with no shared folder yet: nothing to compare by identity, so the spelling decides —
    // still followed through the link that does exist.
    const fresh = join(fixture(), 'appdata', DATA_FOLDER_NAME)
    mkdirSync(dirname(fresh), { recursive: true })
    const freshParent = join(fixture(), 'to-fresh')
    symlinkSync(dirname(fresh), freshParent)
    expect(againstTheSharedFolder(join(freshParent, 'desktop'), fresh)).toBe('is')
    expect(againstTheSharedFolder(fresh, fresh)).toBe('is')
  })

  it('⚠️ a folder inside it is inside it — linked to, or not made yet under a link to it', () => {
    const shared = plantedShared()
    const scratch = fixture()
    symlinkSync(join(shared, 'brobot-workspace'), join(scratch, 'to-inside'))
    symlinkSync(shared, join(scratch, 'to-shared'))
    expect(againstTheSharedFolder(join(scratch, 'to-inside'), shared)).toBe('inside')
    expect(againstTheSharedFolder(join(scratch, 'to-shared', 'not-yet'), shared)).toBe('inside')
  })

  it('⚠️ a folder that holds it holds it — linked to, and before the shared folder is made', () => {
    // ⚑ `--dir <appData>/@brobot2` removes the shared folder whole, as an entry it does not name.
    const shared = plantedShared()
    const link = join(fixture(), 'to-parent')
    symlinkSync(dirname(shared), link)
    expect(againstTheSharedFolder(link, shared)).toBe('holds')
    const fresh = join(fixture(), 'appdata', DATA_FOLDER_NAME)
    mkdirSync(dirname(fresh), { recursive: true })
    expect(againstTheSharedFolder(dirname(fresh), fresh)).toBe('holds')
  })

  it('⚑ one fact over: a link to a scratch folder elsewhere is not it, and the run anchors there', () => {
    const shared = plantedShared()
    const elsewhere = fixture()
    const link = join(fixture(), 'to-elsewhere')
    symlinkSync(elsewhere, link)
    expect(againstTheSharedFolder(link, shared)).toBe(null)
    expect(anchoredAt(link).real).toBe(realpathSync.native(elsewhere))
  })

  it('⚑ another case is the same folder where the disk ignores case, and another folder where it does not', () => {
    // ⚑ Both branches assert, as `safe-remove.test.mjs`'s mis-cased home does: the premise is
    // measured, so a case-sensitive volume — or Linux — tests the code rather than skipping it.
    const shared = plantedShared()
    const miscased = shared.toUpperCase()
    const caseInsensitive = (() => {
      try {
        return lstatSync(miscased).ino === lstatSync(shared).ino
      } catch {
        return false
      }
    })()
    expect(againstTheSharedFolder(miscased, shared)).toBe(caseInsensitive ? 'is' : null)
  })

  it('⚑ on a Mac, the Data-volume spelling reaches the same folder, and is it', (ctx) => {
    // ⚠️ **darwin only** (T-001): `/System/Volumes/Data` is the Mac's firmlink, which `realpath(3)`
    // returns as given. CI runs on Linux and skips it.
    ctx.skip(process.platform !== 'darwin')
    const shared = plantedShared()
    const link = join(fixture(), 'via-data')
    symlinkSync(join('/System/Volumes/Data', realpathSync.native(shared)), link)
    expect(realpathSync.native(link)).not.toBe(realpathSync.native(shared))
    expect(againstTheSharedFolder(link, shared)).toBe('is')
  })
})
