import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aLinkThatLeadsNowhere,
  BUNDLE_NAME,
  DEFAULT_PROFILE_LABEL,
  DRAFTS,
  DRAFTS_PART,
  EXPORTS_DIRNAME,
  HOME_FOLDER,
  HOMES_DIRNAME,
  LEDGER,
  MANIFEST,
  NESTED_USERDATA_SIGNS,
  PASTED_IMAGE_NAME,
  PASTED_PART,
  PATH_SEGMENT,
  PATH_SEGMENT_MAX,
  planCleanBase,
  planProviderHomes,
  REPORT_ORDER,
  UPDATE_SETTINGS_PART,
  UPDATES,
  WORKSPACE,
  WORKSPACES,
  WORKSPACES_PART,
  SIGN_IN_CHANGES_PART,
  SCHEDULE_ATTEMPTS_PART,
  PROFILE_EXECUTION_PART,
} from '../lib/clean-base.mjs'
import { trustedAnchor } from '../lib/safe-remove.mjs'
import { defaultUserData, pastedImagesRoot } from '../lib/user-data.mjs'
import {
  fixture,
  HIS_PROFILES,
  plantUserData,
  removeFixtures,
} from './fixtures/a-planted-user-data.mjs'

/**
 * # ⛔ 717 · R45 · what `clean-base` is, asked WITHOUT running it
 *
 * ⚑ **The PM's ruling, pasted:** *"Split `gate-only/clean-base.test.mjs`. Its assertions that never
 * spawn the script (constants, source censuses, `planCleanBase` units) go back to `scripts/test/`, so
 * the rows they kill can be re-verified by `verify_row.py` again. The half that spawns the script
 * stays gate-only."*
 *
 * ⚑ **So nothing in this file starts a process.** It reads source as TEXT, compares the library's
 * constants with the product's, and asks the two planners what they WOULD do to a userData planted
 * under `/tmp/b351-cb-*` — a plan is a list, and nothing here applies one. ⛔ It imports the
 * library's planners and constants and names none of the acts, and it reads the CLI's source once,
 * as text, through `readFileSync`. `clean-base-runs-only-in-the-gate.test.mjs` exempts exactly those
 * two shapes, and still calls every other way of naming the script or the library a start — ⚠️ it
 * cannot see source that is read and then evaluated, and says so; this file does not evaluate it.
 *
 * ⚠️ **Before `706` these tests sat beside the ones that spawn the script, and `706` moved the whole
 * file into the gate** — correct for the spawning half, and it took these with it, so every mutation
 * row only they kill stopped being re-verifiable by anything. The sections keep their numbers from
 * that file (`§1`, `§2`, `§7`, `§9`, `§11`), so a table's note naming one still finds it.
 */

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SCRIPTS)
/** ⚑ The CLI's source, READ — once, here, and never run. */
const CLI_SOURCE = readFileSync(join(SCRIPTS, 'clean-base.mjs'), 'utf8')

afterEach(removeFixtures)

/**
 * ⚑ **Source read as CODE, never as prose** (from `346`'s census defect).
 *
 * Only executable calls belong in the census. Comments may quote the same paths without adding
 * another writer.
 */
function stripProse(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

function code(path) {
  return stripProse(readFileSync(join(REPO, path), 'utf8'))
}

/** Every production TypeScript file — main, preload, shared and the packages. No tests, no smokes. */
function productionSources() {
  const roots = [
    'apps/desktop/src/main',
    'apps/desktop/src/preload',
    'apps/desktop/src/shared',
    'packages/runtime/src',
    'packages/shared/src',
    'packages/orchestration/src',
  ]
  const out = []
  const walk = (relative) => {
    for (const entry of readdirSync(join(REPO, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(next)
    }
  }
  for (const root of roots) walk(root)
  return out
}

describe('§1 · the source census — a new durable write under userData must not slip past', () => {
  /**
   * Disposable Chromium files and application-owned data need different checks. A new BroBot data
   * file arrives with a source change, so CI must flag it before a reset can silently discard it.
   */
  it('⛔ every literal joined to userData in production source is classified', () => {
    // ⚑ **The roster is WALKED, not listed** (351 review). A hand-written list of five files is a
    // census that cannot see a sixth — which is the only thing this test exists to catch.
    const sources = productionSources()
    expect(sources.length, 'the walk found no production source at all').toBeGreaterThan(50)
    const found = new Set()
    for (const source of sources) {
      // ⚠️ One level of nesting is allowed in the argument, because one of the eight sites is
      // `join(userData, \`.oh-${digest(token).slice(0, 8)}\`)`. A `[^)]` capture stops inside
      // `digest(` and pins half an expression — true, and unreadable as a census row.
      // ⚑ **And `userData` as a FIELD too** (`where.userData`): the updater's settings are joined to
      // one, and a census that read only the bare name let that durable write past it.
      for (const match of code(source).matchAll(
        /join\(\s*(?:(?:\w+\.)?(?:userData|userDataPath)|app\.getPath\('userData'\))\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\)/g,
      )) {
        found.add(match[1].trim())
      }
    }
    expect([...found].sort()).toEqual([
      "'brobot2.sqlite'",
      "'exports'",
      "'one-host.sock'",
      // Which profiles are services, and each service's one conversation. REMOVED with the ledger
      // whose profiles and conversations it names (`LEDGER`).
      "'profile-execution.json'",
      // ⚑ The account the usage readings were read on. REMOVED with them (`USAGE`).
      "'provider-accounts.json'",
      // ⚑ **F096 · each provider's newest usage readings**, kept across a restart. REMOVED (`USAGE`).
      "'provider-usage.json'",
      // What the app already did about each stopped conversation's scheduled jobs. REMOVED with
      // the ledger whose conversations it is about (`LEDGER`).
      "'schedule-attempts.json'",
      // ⚑ **W4.172 · F095 — the moments each provider's sign-in changed**, which end the limits the
      // sign-in before reached. REMOVED with the ledger whose limits they end (`LEDGER`).
      "'sign-in-changes.json'",
      // The turns the app's quit, or a crash, cut, and what it did about each. REMOVED with the
      // ledger whose turns they are (`LEDGER`).
      "'turns-the-app-cut.json'",
      // ⚑ **The updater's, in a hidden launch's data folder** — its own switch and the Mac image it
      // downloads. REMOVED: a fresh install has neither (`UPDATES`).
      "'update-settings.json'",
      "'updates'",
      "'updates', 'staging'",
      // ⚑ **W4.131 · A2** — a hidden launch's own list of workspaces. REMOVED (`WORKSPACES`).
      "'workspaces.json'",
      // The conversations a person archived, removed with the ledger whose rows they name (`LEDGER`).
      'ARCHIVED_FILE',
      // The workspace's recovery copies, removed with the ledger they copy (`RECOVERY`).
      'BACKUPS_DIRNAME',
      // The ledger itself, as the recovery code names it (`brobot2.sqlite`, `LEDGER`).
      'DATABASE_FILE',
      // Shared skill folders and their import receipts are removed with the workspace.
      'OFF_SKILLS_DIRNAME',
      'PROVIDER_HOMES_DIRNAME',
      // The records of a restore, and the database a restore set aside (`RECOVERY`).
      'RECOVERY_DIRNAME',
      // ⚑ **D-016 · the files kept for pieces of work**, and this census is what put them in the
      // manifest, as it put `380`'s documents tree there before them. A durable BroBot write under
      // `userData`, so a reset has to decide about it — and the answer is REMOVE: a resource is named
      // only by its `work_resource` row, in the ledger this reset deletes.
      'RESOURCES_DIRNAME',
      // ⚑ **744's unsent drafts** (R100) — removed with the ledger their slots name (`DRAFTS`).
      'SAVED_DRAFTS_FILE',
      'SHARED_SKILLS_DIRNAME',
      'SKILLS_CONVERSION_FILE',
      // Each launch's timing, and the file it is moved to once full. REMOVED with the ledger whose
      // conversations they time (`LEDGER`).
      'START_ATTEMPTS_FILE',
      'START_ATTEMPTS_OLDER_FILE',
      // A hidden launch's theme library is reset with its workspace.
      'THEME_LIBRARY_FOLDER',
      'TRANSCRIPT_RETENTION_FILE',
      'WORKER_OUTPUT_DIRNAME',
      'WORKSPACE_DIRNAME',
      '`.oh-${digest(token).slice(0, 8)}`',
      // The app's state files a recovery copy takes, each named in `APP_STATE_FILES`; the test
      // below holds every name there to this manifest.
      'segment(file.name)',
    ])
  })

  it('⚑ …and the constants among them resolve to names this manifest knows', () => {
    const named = new Set(MANIFEST.map((entry) => entry.name))
    expect(code('apps/desktop/src/main/runtime/workspace.ts')).toContain(
      "export const WORKSPACE_DIRNAME = 'brobot-workspace'",
    )
    expect(code('apps/desktop/src/main/runtime/provider-homes.ts')).toContain(
      "export const PROVIDER_HOMES_DIRNAME = 'provider-homes'",
    )
    const sharedSkills = code('apps/desktop/src/main/skills/shared-paths.ts')
    expect(sharedSkills).toContain("export const SHARED_SKILLS_DIRNAME = 'skills'")
    expect(sharedSkills).toContain("export const OFF_SKILLS_DIRNAME = 'skills-off'")
    expect(sharedSkills).toContain("export const SKILLS_CONVERSION_FILE = 'skills-conversion.json'")
    expect(code('apps/desktop/src/main/resources/resources.ts')).toContain(
      "export const RESOURCES_DIRNAME = 'resources'",
    )
    expect(code('apps/desktop/src/main/drafts-file.ts')).toContain(
      "export const SAVED_DRAFTS_FILE = 'drafts.json'",
    )
    expect(code('apps/desktop/src/main/archived-file.ts')).toContain(
      "export const ARCHIVED_FILE = 'archived.json'",
    )
    expect(code('apps/desktop/src/main/themes/state.ts')).toContain(
      "export const THEME_LIBRARY_FOLDER = 'themes'",
    )
    expect(code('apps/desktop/src/main/worker-piece-folder.ts')).toContain(
      "export const WORKER_OUTPUT_DIRNAME = 'worker-output'",
    )
    const startAttempts = code('apps/desktop/src/main/start-attempts-log.ts')
    expect(startAttempts).toContain("export const START_ATTEMPTS_FILE = 'start-attempts.jsonl'")
    expect(startAttempts).toContain(
      "export const START_ATTEMPTS_OLDER_FILE = 'start-attempts.1.jsonl'",
    )
    const layout = code('apps/desktop/src/main/recovery/layout.ts')
    expect(layout).toContain("export const DATABASE_FILE = 'brobot2.sqlite'")
    expect(layout).toContain("export const BACKUPS_DIRNAME = 'backups'")
    expect(layout).toContain("export const RECOVERY_DIRNAME = 'recovery'")
    // ⚑ The state files the recovery code joins by name: every one of them is in the manifest.
    const registry = code('apps/desktop/src/main/recovery/state-files.ts')
    const states = registry.slice(
      registry.indexOf('export const APP_STATE_FILES'),
      registry.indexOf('export const NOT_STATE'),
    )
    const stateNames = [...states.matchAll(/name: '([^']+)'/g)].map((match) => match[1])
    expect(stateNames.length, 'the state-file registry names no file').toBeGreaterThan(4)
    for (const name of stateNames) {
      expect(named, `${name} is a state file and the manifest does not name it`).toContain(name)
    }
    for (const name of [
      'brobot2.sqlite',
      'exports',
      'one-host.sock',
      'brobot-workspace',
      'provider-homes',
      'resources',
      'worker-output',
      'drafts.json',
      'archived.json',
      'sign-in-changes.json',
      'schedule-attempts.json',
      'profile-execution.json',
      'turns-the-app-cut.json',
      'start-attempts.jsonl',
      'start-attempts.1.jsonl',
      'update-settings.json',
      'updates',
      'workspace.json',
      'workspaces.json',
      'provider-usage.json',
      'provider-accounts.json',
      'backups',
      'recovery',
      'themes',
      'active-theme.json',
      'dock-label.json',
      'transcript-retention.json',
    ]) {
      expect(
        named,
        `${name} is written under userData and the manifest does not name it`,
      ).toContain(name)
    }
  })

  it('⛔ the census strips prose without hiding executable paths', () => {
    const prose = "// `join(userData, 'fictional.sqlite')` is an example, not a writer."
    const executable = "const file = join(userData, 'fictional.sqlite')"
    expect(stripProse(`${prose}\n${executable}`)).toBe(executable)
    expect(stripProse(`/* ${executable} */\n${executable}`)).toBe(`\n${executable}`)
  })

  it('⚑ one userData for every build — the one the app pins at launch (W4.90)', () => {
    expect(defaultUserData('darwin').replaceAll('\\', '/')).toContain(
      'Library/Application Support/@brobot2/desktop',
    )
    // ⚑ The same folder the app pins: a development build and an installed BroBot share it.
    expect(code('apps/desktop/src/main/data-folder.ts')).toContain(
      "export const DATA_FOLDER = ['@brobot2', 'desktop'] as const",
    )
  })

  it('⛔ and it says so: with no `--dir`, the run names it as every BroBot’s data, and `--packaged` is gone', () => {
    expect(CLI_SOURCE).toContain(
      'the data of every BroBot on this machine not started with its own --user-data-dir',
    )
    // ⚑ Said whenever the target IS the shared folder, named with `--dir` or fallen back to — and,
    // since W4.117, wherever its links lead (`clean-base-names-the-shared-folder-…` asks how).
    expect(CLI_SOURCE).toContain('const shared = againstTheSharedFolder(target)')
    expect(CLI_SOURCE).toContain('if (shared !== null) {')
    expect(CLI_SOURCE).not.toContain("'--packaged'")
  })

  it('the pasted-image root is the SIBLING the product builds, not a folder of that name', () => {
    expect(code('apps/desktop/src/main/runtime/pasted-image.ts')).toContain(
      'join(dirname(userData), `${basename(userData)}-${PASTED_IMAGES_DIRNAME}`)',
    )
    expect(pastedImagesRoot(resolve('/a/b/@brobot2/desktop'))).toBe(
      resolve('/a/b/@brobot2/desktop-pasted-images'),
    )
    expect(pastedImagesRoot(resolve('/a/b/ud'))).not.toBe(resolve('/a/b/pasted-images'))
  })
})

describe('§2 · the manifest agrees with the product it is a manifest of', () => {
  it('the two pasted-image patterns are the product’s own, character for character', () => {
    expect(code('apps/desktop/src/shared/runtime-ipc.ts')).toContain(
      'const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\\.png$/',
    )
    expect(code('apps/desktop/src/main/runtime/pasted-image.ts')).toContain(
      'const PASTED_PART = /^pasted-[0-9a-f]{32}\\.png\\.[0-9a-f]{12}\\.part$/',
    )
    expect(PASTED_IMAGE_NAME.source).toBe('^pasted-[0-9a-f]{32}\\.png$')
    expect(PASTED_PART.source).toBe('^pasted-[0-9a-f]{32}\\.png\\.[0-9a-f]{12}\\.part$')
    // ⚑ Positive and negative, because a pattern that matched nothing would pass the pair above.
    expect(PASTED_IMAGE_NAME.test('pasted-0123456789abcdef0123456789abcdef.png')).toBe(true)
    expect(PASTED_IMAGE_NAME.test('pasted-0123456789abcdef0123456789abcde.png')).toBe(false)
    expect(PASTED_IMAGE_NAME.test('notes.txt')).toBe(false)
    expect(PASTED_PART.test('pasted-0123456789abcdef0123456789abcdef.png.aabbccddeeff.part')).toBe(
      true,
    )
  })

  /**
   * ⚑ **539 · the export name, which is a SIGN rather than a manifest entry.** A `<U>` whose only
   * remaining content is `exports/` has no other sign left to read, and that is exactly the tree
   * whose one file cannot be regenerated — so the bundle name has to be spelled here, and held to
   * the product's own constant the way {@link PATH_SEGMENT} is.
   */
  it('⚑ the export bundle name is the product’s own suffix', () => {
    expect(code('apps/desktop/src/shared/runtime-ipc.ts')).toContain(
      "const BUNDLE_SUFFIX = '.brobot-session.json'",
    )
    expect(BUNDLE_NAME.source).toBe('\\.brobot-session\\.json$')
    // ⚑ Positive and negative, because a pattern matching nothing would pass the pair above.
    expect(BUNDLE_NAME.test('a1.brobot-session.json')).toBe(true)
    expect(BUNDLE_NAME.test('brobot-session.json.bak')).toBe(false)
    expect(BUNDLE_NAME.test('data_0')).toBe(false)
    // ⚑ …and the directory name the holder is derived from is the manifest's own, not a second
    // spelling of it — `MANIFEST` is declared above the constant, so nothing but this holds them.
    expect(MANIFEST.map((entry) => entry.name)).toContain(EXPORTS_DIRNAME)
  })

  /**
   * 🔴 **620 · D23 · the profile LABEL, held to the product's own constant.**
   *
   * ⛔ **`592` renamed the profile slug and repaired one of the two sentences that named it.** The
   * repair wrote `BroBot` as a literal, with the reason beside it: *"this file cannot import
   * `DEFAULT_PROFILE_ID`"*. ⚑ True — and this repository crosses that exact boundary three times
   * already ({@link PATH_SEGMENT}, {@link BUNDLE_NAME}, {@link HOME_FOLDER}), by copying the
   * value and pinning it here. ⚠️ So the sentences now READ the name, and this is what stops the
   * copy drifting.
   *
   * 🔴 **And the pair below is the whole trap in two lines**: one of these words is still
   * `default` and the other stopped being it at `592`. ⛔ A sweep that treats them as one word
   * finds 1,086 occurrences and no answer. ⚑ D-016 renamed the first — it was the project, and is
   * now the one folder every home lives in — and left it `default`.
   */
  it('⚑ the profile label is the product’s own, and the HOME FOLDER is still a different word', () => {
    const shared = code('apps/desktop/src/shared/runtime-ipc.ts')
    expect(shared).toContain("export const DEFAULT_PROFILE_LABEL = 'BroBot'")
    expect(DEFAULT_PROFILE_LABEL).toBe('BroBot')
    // ⛔ **The id is NOT the label and NOT the home folder**, which is what makes the sentences
    // that use this constant say something rather than repeat a word.
    expect(shared).toContain("export const DEFAULT_PROFILE_ID = 'brobot'")
    expect(DEFAULT_PROFILE_LABEL).not.toBe(HOME_FOLDER)
    expect(HOME_FOLDER).toBe('default')
    // ⚑ **And the profile is no longer called `default` anywhere the product decides it** — the
    // one-line fact the two repaired sentences rest on.
    expect(shared).not.toContain("export const DEFAULT_PROFILE_ID = 'default'")
  })

  it('the path-segment rule is the one the app validates ids with', () => {
    const shared = code('apps/desktop/src/shared/runtime-ipc.ts')
    expect(shared).toContain('export const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/')
    expect(shared).toContain('export const PATH_SEGMENT_MAX_LENGTH = 64')
    expect(PATH_SEGMENT.source).toBe('^[A-Za-z0-9][A-Za-z0-9._-]*$')
    expect(PATH_SEGMENT_MAX).toBe(64)
    expect(PATH_SEGMENT.test('default')).toBe(true)
    expect(PATH_SEGMENT.test('..'), 'a leading dot is what keeps `..` out').toBe(false)
    expect(PATH_SEGMENT.test('a/b')).toBe(false)
  })

  /**
   * ⛔ **The launcher's menu reads one folder and this reset walks them all** (352 review). A
   * `provider-homes/staging/qa/codex` home is removed by this reset and was NEVER in the menu, so
   * saying *"the launcher still offers every one of these"* over everything under `provider-homes/`
   * is an over-claim. This pins both halves: the spelling, and the fact that the scoping really is
   * in the product.
   *
   * ⚑ **D-016 moved the scoping, it did not remove it.** `listProfileIds` filtered on the project;
   * now `listProviderHomes`, which it reads, walks only `HOME_FOLDER` — and that folder is
   * `provider-homes.ts`'s own constant rather than the project id in `runtime-ipc.ts`.
   */
  it('⚑ the folder the launcher menu reads is the one the app pins', () => {
    const homes = code('apps/desktop/src/main/runtime/provider-homes.ts')
    expect(homes).toContain("export const HOME_FOLDER = 'default'")
    expect(HOME_FOLDER).toBe('default')
    expect(
      homes,
      'listProviderHomes reads only the home folder — if it stops, the report stops needing to split',
    ).toContain('const root = join(providerHomesRoot(userData), HOME_FOLDER)')
  })

  it('the report order covers every reason an entry can carry', () => {
    for (const entry of MANIFEST) {
      if (entry.name === 'exports' || entry.name === HOMES_DIRNAME) continue
      expect(REPORT_ORDER, `${entry.why} is never printed`).toContain(entry.why)
    }
    expect(new Set(REPORT_ORDER).size).toBe(REPORT_ORDER.length)
  })

  it('⚑ the fresh-launch sentence states the migration count this repo actually has', () => {
    const migrations = readdirSync(join(REPO, 'apps/desktop/src/main/db/migrations')).filter(
      (name) => name.endsWith('.sql'),
    )
    const cli = CLI_SOURCE
    expect(cli).toContain(`const MIGRATIONS = ${String(migrations.length)}`)
    expect(cli).toContain('no personal skills or skill choices')
    expect(cli).toContain('no standing rules or saved method change history')
  })
})

describe('parallel piece results on reset', () => {
  it('keeps the output folder with or without dropping exports', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const output = join(userData, 'worker-output')
    mkdirSync(output)
    writeFileSync(join(output, 'result.md'), 'Fictional result for the person.')
    const anchor = trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} })
    for (const dropExports of [false, true]) {
      const plan = planCleanBase(anchor, { dropExports })
      expect(plan.refusals).toEqual([])
      expect(plan.actions.some((one) => one.rel === 'worker-output')).toBe(false)
      expect(plan.keeps).toContainEqual({
        rel: 'worker-output',
        why: "A person's results written for parallel pieces are kept on reset.",
      })
      expect(readFileSync(join(output, 'result.md'), 'utf8')).toBe(
        'Fictional result for the person.',
      )
    }
  })
})

describe('§7 · the report survives the pipe it is read through — what the source says', () => {
  it('⛔ the script never calls process.exit — it sets the code and lets node drain', () => {
    const source = CLI_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(source).not.toContain('process.exit(')
    expect(source).toContain('process.exitCode')
  })
})

describe('§9 · the module defaults, for a caller that does not pass options', () => {
  /**
   * ⛔ **Nothing above this line can reach these defaults, and a default nobody reaches is a
   * default nobody has checked.** The CLI always passes `keepAuth` explicitly, so `352`'s mutation
   * rows `M8` and `M9` — which invert both defaults to `351`'s — survived the entire suite.
   *
   * ⚑ **The rule is real.** A second caller that forgets the option (an MCP tool, a smoke, a future
   * CLI) must get the clean base and never `351`'s skeleton, because the failure of the second is
   * silent: the directory looks emptied and the launcher still offers every profile.
   */
  it('⚑ planProviderHomes with no options at all removes the tree', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const anchor = trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} })
    expect(anchor.kind, 'the fixture must be a directory the predicate trusts').toBe('trusted')

    const plan = planProviderHomes(anchor)
    expect(plan.refusals).toEqual([])
    expect(plan.actions.map((action) => action.rel)).toEqual([HOMES_DIRNAME])
    expect(plan.profiles).toEqual(HIS_PROFILES.map((profile) => `default/${profile}`))
  })

  it('⚑ …and so does planCleanBase, which keeps nothing that needs a flag to explain it', () => {
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    const anchor = trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} })
    const plan = planCleanBase(anchor)

    expect(
      plan.actions.some((action) => action.rel === HOMES_DIRNAME && action.expect === 'dir'),
    ).toBe(true)
    expect(
      plan.actions.some((action) => action.rel.startsWith(`${HOMES_DIRNAME}/`)),
      'a leaf action here would be the 351 shape nested inside the tree it also removes',
    ).toBe(false)
    expect(plan.keeps.some((keep) => keep.flag === '--keep-profile-auth')).toBe(false)
  })

  it('⚑ 744 · the unsent drafts and a save a kill left half-written go as the unsent drafts — and the pattern is the product’s own', () => {
    expect(code('apps/desktop/src/main/drafts-file.ts')).toContain(
      'export const DRAFTS_PART = /^drafts\\.json\\.[0-9a-f]{12}\\.part$/',
    )
    expect(DRAFTS_PART.source).toBe('^drafts\\.json\\.[0-9a-f]{12}\\.part$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    writeFileSync(join(userData, 'drafts.json'), '{"version":1,"drafts":[]}')
    writeFileSync(join(userData, 'drafts.json.0123456789ab.part'), 'words a kill left')
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of ['drafts.json', 'drafts.json.0123456789ab.part']) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: DRAFTS })
    }
  })

  it('⚑ W4.120 · a hidden launch’s update settings and a write a kill left go with the updater’s files — and the name is the product’s own', () => {
    expect(code('apps/desktop/src/main/update-settings.ts')).toContain(
      'const temporary = `${file}.${String(process.pid)}.tmp`',
    )
    expect(UPDATE_SETTINGS_PART.source).toBe('^update-settings\\.json\\.\\d+\\.tmp$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    writeFileSync(join(userData, 'update-settings.json'), '{"updates":{}}')
    writeFileSync(join(userData, 'update-settings.json.4242.tmp'), '{"upd')
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of ['update-settings.json', 'update-settings.json.4242.tmp']) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: UPDATES })
    }
  })
})

it('classifies private update staging as disposable updates, never durable state', () => {
  const userData = fixture()
  mkdirSync(join(userData, 'updates', 'staging'), { recursive: true })
  writeFileSync(
    join(userData, 'updates', 'staging', 'Fern.partial'),
    'A fictional interrupted download',
  )
  const plan = planCleanBase(trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }))
  expect(MANIFEST).toContainEqual(
    expect.objectContaining({ name: 'updates', expect: 'dir', why: UPDATES }),
  )
  expect(plan.actions).toContainEqual({ rel: 'updates', expect: 'dir', why: UPDATES })
  expect(plan.actions.some((action) => action.rel.startsWith('updates/'))).toBe(false)
})

describe('§10d · what the app did about scheduled jobs', () => {
  it('⚑ goes with the ledger whose conversations it is about, a write a kill left too — and the pattern is the product’s own', () => {
    expect(code('apps/desktop/src/main/schedule-attempts-file.ts')).toContain(
      'const temporary = `${file}.${String(process.pid)}.tmp`',
    )
    expect(SCHEDULE_ATTEMPTS_PART.source).toBe('^schedule-attempts\\.json\\.\\d+\\.tmp$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    for (const name of ['schedule-attempts.json', 'schedule-attempts.json.4242.tmp']) {
      writeFileSync(join(userData, name), '{}')
    }
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of ['schedule-attempts.json', 'schedule-attempts.json.4242.tmp']) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: LEDGER })
    }
  })
})

describe('§10e · how each profile runs its work', () => {
  it('⚑ goes with the ledger whose profiles and conversations it names, a write a kill left too — and the pattern is the product’s own', () => {
    expect(code('apps/desktop/src/main/profile-execution-file.ts')).toContain(
      'const temporary = `${file}.${String(process.pid)}.tmp`',
    )
    expect(PROFILE_EXECUTION_PART.source).toBe('^profile-execution\\.json\\.\\d+\\.tmp$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    for (const name of ['profile-execution.json', 'profile-execution.json.4242.tmp']) {
      writeFileSync(join(userData, name), '{}')
    }
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of ['profile-execution.json', 'profile-execution.json.4242.tmp']) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: LEDGER })
    }
  })
})

describe('§10c · W4.172 · the moments each provider’s sign-in changed', () => {
  it('⚑ go with the ledger whose limits they end, a write a kill left too — and the pattern is the product’s own', () => {
    expect(code('apps/desktop/src/main/sign-in-changes.ts')).toContain(
      'const temporary = `${file}.${String(process.pid)}.tmp`',
    )
    expect(SIGN_IN_CHANGES_PART.source).toBe('^sign-in-changes\\.json\\.\\d+\\.tmp$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    for (const name of ['sign-in-changes.json', 'sign-in-changes.json.4242.tmp']) {
      writeFileSync(join(userData, name), '{}')
    }
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of ['sign-in-changes.json', 'sign-in-changes.json.4242.tmp']) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: LEDGER })
    }
  })
})

describe('§10b · W4.131 · a workspace’s name and a hidden launch’s list', () => {
  it('⚑ go with the workspace’s files, a write a kill left too — and the pattern is the product’s own', () => {
    expect(code('apps/desktop/src/main/workspaces.ts')).toContain(
      'const temporary = `${file}.${String(process.pid)}.tmp`',
    )
    expect(WORKSPACES_PART.source).toBe('^workspaces?\\.json\\.\\d+\\.tmp$')
    const userData = plantUserData(fixture(), { profiles: HIS_PROFILES })
    for (const name of [
      'workspace.json',
      'workspaces.json',
      'workspace.json.4242.tmp',
      'workspaces.json.4242.tmp',
    ]) {
      writeFileSync(join(userData, name), '{}')
    }
    const plan = planCleanBase(
      trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} }),
    )
    for (const rel of [
      'workspace.json',
      'workspaces.json',
      'workspace.json.4242.tmp',
      'workspaces.json.4242.tmp',
    ]) {
      expect(plan.actions).toContainEqual({ rel, expect: 'file', why: WORKSPACES })
    }
  })
})

describe('§11 · ⛔ 539 · the signs a nested userData is recognised by', () => {
  /**
   * 🔴 **A census is only as strong as what it would have to classify tomorrow.**
   *
   * ⛔ A durable write added to {@link MANIFEST} is a new way for a nested userData to be
   * recognisable — or a new ordinary word that must NOT be one. This fails on the day a name is
   * added and nobody decided which, rather than silently widening or silently missing it.
   */
  it('⚑ the signs are derived from the manifest, and the two it leaves out are named', () => {
    const manifest = MANIFEST.map((entry) => entry.name)
    for (const sign of NESTED_USERDATA_SIGNS) {
      expect(manifest, `${sign} is not a name this reset knows at all`).toContain(sign)
    }
    expect(
      manifest.filter((name) => !NESTED_USERDATA_SIGNS.includes(name)),
      'ordinary words, deliberately not a signal — see NESTED_USERDATA_SIGNS',
      // ⚑ **744 · `drafts.json` is an ordinary word** — a folder of anybody's may hold a file of that
      // name — so it is classified here, deliberately not a sign. ⚑ So are the updater's two: any
      // program may keep an `updates` folder or an `update-settings.json`. ⚑ F096's
      // `provider-usage.json` too: a name any program reading a provider's usage could pick.
    ).toEqual([
      // Other apps can keep skill folders; the BroCrew conversion receipt is a sign.
      'skills',
      'skills-off',
      'active-theme.json',
      // Any program may keep a label of its own in a file of this name.
      'dock-label.json',
      'transcript-retention.json',
      'themes',
      'resources',
      'drafts.json',
      // Any program may keep a list of what it archived in a file of this name.
      'archived.json',
      'exports',
      'worker-output',
      'update-settings.json',
      'updates',
      // ⚑ W4.172 · any program may keep its sign-ins' moments in a file of this name.
      'sign-in-changes.json',
      // Any scheduler may keep its attempts in a file of this name.
      'schedule-attempts.json',
      // Any program with profiles may keep how they run in a file of this name.
      'profile-execution.json',
      // Any program may keep the turns it cut in a file of this name.
      'turns-the-app-cut.json',
      // Any program may time its own starts in files of these names.
      'start-attempts.jsonl',
      'start-attempts.1.jsonl',
      'workspace.json',
      'workspaces.json',
      'provider-usage.json',
      // Any program keeping who it is signed in as may pick this name.
      'provider-accounts.json',
      // The recovery folders: any program may keep a `backups` or a `recovery` folder.
      'backups',
      'recovery',
    ])
  })
})

describe('§12 · ⛔ W4.117 · a link that leads nowhere is refused, not read as nothing at this path', () => {
  /** Where the run would anchor — a scratch home and no environment, so nothing real is looked at. */
  const anchoredAt = (path) => trustedAnchor(path, { home: fixture(), env: {} })

  it('⛔ the anchor alone calls a broken link absent — so the script asks, and the link is named', () => {
    const scratch = fixture()
    const link = join(scratch, 'ud')
    symlinkSync(join(scratch, 'moved-away'), link)
    const anchor = anchoredAt(link)
    expect(anchor.kind).toBe('absent')
    expect(aLinkThatLeadsNowhere(anchor.lexical)).toBe(
      `${link} is a link to ${join(scratch, 'moved-away')}, which leads nowhere — point --dir at ` +
        `the folder you mean, or make that link lead to a folder that exists`,
    )
  })

  it('⛔ …and so is a broken link a parent of the target, or a link to one, named rather than the target', () => {
    const scratch = fixture()
    symlinkSync(join(scratch, 'moved-away'), join(scratch, 'appdata'))
    const target = join(scratch, 'appdata', 'ud')
    expect(anchoredAt(target).kind).toBe('absent')
    const said = aLinkThatLeadsNowhere(target)
    expect(said?.startsWith(`${join(scratch, 'appdata')} is a link to `), said).toBe(true)
    // ⚑ A link to that link: the one named is the first, and what it points at is a link that
    // exists and leads nowhere — so the sentence says "leads nowhere", not "does not exist".
    symlinkSync(join(scratch, 'appdata'), join(scratch, 'via'))
    const chained = aLinkThatLeadsNowhere(join(scratch, 'via', 'ud'))
    expect(
      chained?.startsWith(
        `${join(scratch, 'via')} is a link to ${join(scratch, 'appdata')}, which leads nowhere`,
      ),
      chained,
    ).toBe(true)
  })

  it('⚑ one fact over: nothing there, or not there yet under a folder or a link that leads somewhere, is nothing at this path', () => {
    const scratch = fixture()
    mkdirSync(join(scratch, 'real'))
    symlinkSync(join(scratch, 'real'), join(scratch, 'alias'))
    for (const target of [
      join(scratch, 'never-made'),
      join(scratch, 'real', 'ud'),
      join(scratch, 'alias', 'ud'),
    ]) {
      expect(anchoredAt(target).kind, target).toBe('absent')
      expect(aLinkThatLeadsNowhere(target), target).toBe(null)
    }
  })

  it('⛔ the script asks it before saying "nothing at this path", and refuses with what it says', () => {
    const absent = CLI_SOURCE.indexOf("if (anchor.kind === 'absent') {")
    const asked = CLI_SOURCE.indexOf('const nowhere = aLinkThatLeadsNowhere(anchor.lexical)')
    const nothing = CLI_SOURCE.indexOf('nothing at this path, so there is nothing to remove.')
    expect(absent).toBeGreaterThan(0)
    expect(asked).toBeGreaterThan(absent)
    expect(nothing).toBeGreaterThan(asked)
    const refusal = CLI_SOURCE.slice(asked, nothing)
    expect(refusal).toContain("console.error(`${out.join('\\n')}\\n\\n  ⛔ refused · ${nowhere}`)")
    expect(refusal).toContain('process.exitCode = 1')
  })
})

it('plans active/off shared trees and their conversion receipt without applying the plan', () => {
  const root = fixture()
  for (const name of ['skills', 'skills-off']) {
    mkdirSync(join(root, name, 'recipe-check'), { recursive: true })
    writeFileSync(join(root, name, 'recipe-check/SKILL.md'), 'A fictional recipe.')
  }
  writeFileSync(join(root, 'skills-conversion.json'), '{"version":1,"receipts":[]}\n')
  const plan = planCleanBase(trustedAnchor(root, { repoRoot: REPO, home: fixture(), env: {} }))
  for (const name of ['skills', 'skills-off', 'skills-conversion.json']) {
    expect(plan.actions).toContainEqual({
      rel: name,
      expect: name.endsWith('.json') ? 'file' : 'dir',
      why: WORKSPACE,
    })
    expect(
      readFileSync(
        join(root, name.endsWith('.json') ? name : `${name}/recipe-check/SKILL.md`),
        'utf8',
      ),
    ).toContain(name.endsWith('.json') ? 'receipts' : 'fictional recipe')
  }
})
