import { lstatSync, readdirSync, readlinkSync, realpathSync, rmdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { identityOf, isAncestor, mayRemove, removeChecked, whereItStands } from './safe-remove.mjs'
import { defaultUserData } from './user-data.mjs'

/**
 * Describe kept and explained clean-base entries; do not infer every disposable Chromium
 * filename from one observed launch. Report unfamiliar names literally as `OTHER`.
 * A production-source census flags new durable userData writes before removal policy drifts.
 *
 * Fail closed on unexpected managed-home directories or invalid path segments. When keeping
 * profile auth, require managed `auth.json` to be a regular `0600` file. Files at any depth
 * of provider homes, including Finder metadata, are removed and named as not app-authored;
 * owned provider lock remnants removed with the tree are not strays.
 *
 * In the pasted-images sibling root, remove only product-owned names and retain unfamiliar
 * entries. Under unrecognised userData entries, any `NESTED_USERDATA_SIGNS` occurrence
 * refuses the target as containing another data tree.
 */

/** What an entry is for, in the report. */
export const LEDGER = 'ledger'
export const WORKSPACE = 'workspace'
export const EXPORTS = 'exports'
/**
 * 🔴 **D-016 · the files kept for pieces of work** (`<userData>/resources/<sha256>/<name>`) — and
 * they are REMOVED, with the ledger they belong to.
 *
 * ⛔ **Not kept the way `exports/` is kept, and the difference is that a resource is HALF a fact.**
 * An export is a finished file a person asked for; a kept resource is bytes whose identity — the
 * piece it belongs to, its hash, who handed it in — is a `work_resource` row in `brobot2.sqlite`,
 * and this reset removes that. ⚠️ Left standing, every file would be orphaned: a fresh base has no
 * row that names one, so nothing could ever read or remove it.
 */
export const RESOURCES = 'resources'
export const HOMES = 'provider homes'
export const GATE = 'one-host gate'
export const OTHER = 'other'
export const PASTED = 'pasted images'
/**
 * 🔴 **744 · the unsent drafts** (R100) — REMOVED, with the ledger their slots name.
 *
 * ⚠️ **Every conversation a draft is kept for is a row in `brobot2.sqlite`**, and this reset removes
 * that; the next launch would drop those slots anyway (`restoreSavedDrafts`: a conversation that no
 * longer exists takes its draft with it). ⚑ The launcher's own slot goes too: a clean base starts
 * with an empty front door, as a fresh install does.
 */
export const DRAFTS = 'unsent drafts'
/**
 * 🔴 **The updater's, in a hidden launch's data folder** — REMOVED: a fresh install has neither.
 *
 * ⚑ Only a hidden launch (a test, a smoke, a probe) writes them: its own update switch, which
 * starts off (`main/update-settings.ts`), and the Mac image it downloads, which a person's launch
 * puts in Downloads (`main/updates-in-the-app.ts`). ⚠️ A person's switch is one per computer, in
 * `<appData>/@brobot2/settings.json`, beside every data folder — so no reset of one touches it.
 */
export const UPDATES = 'updates'
/**
 * 🔴 **W4.131 · A2 — a workspace's own name, and a hidden launch's list of workspaces** — REMOVED: a
 * fresh install has neither.
 *
 * ⚑ The name is the folder's own (`workspace.json`, written when a person renames it or makes a new
 * one); the list is a hidden launch's own (`workspaces.json`: a test's). ⚠️ A person's list is one
 * per computer, `<appData>/@brobot2/workspaces.json`, beside every data folder — so no reset of one
 * touches it.
 */
export const WORKSPACES = 'workspaces'
/**
 * 🔴 **F096 — each provider's newest usage readings, kept across a restart** — REMOVED: a fresh
 * install has none, and the providers say them again with their next frame
 * (`main/provider-usage-file.ts`). ⚑ So is the account they were read on
 * (`main/provider-accounts-file.ts`), which the next Claude conversation names again.
 */
export const USAGE = 'usage readings'
/**
 * The workspace's own recovery copies (`backups/`) and the records of a restore (`recovery/`) —
 * REMOVED, with the ledger they copy.
 *
 * A copy is the same conversations as the ledger, sealed keys included, so a reset that removes the
 * ledger and keeps its copies would keep exactly what it was asked to remove. The files inside are
 * never named `brobot2.sqlite`, so neither folder looks like a nested workspace.
 */
export const RECOVERY = 'recovery copies'

/**
 * The order the report groups appear in — BroBot's own first, its neighbours' last.
 *
 * ⚠️ **Fixed rather than insertion-ordered.** A `readdir` orders by whatever the filesystem returns,
 * so two runs of the same reset printed their sections in different orders, and a person comparing
 * yesterday's output to today's would be diffing the directory rather than the run.
 */
export const REPORT_ORDER = Object.freeze([
  LEDGER,
  WORKSPACE,
  RESOURCES,
  EXPORTS,
  HOMES,
  DRAFTS,
  UPDATES,
  WORKSPACES,
  USAGE,
  RECOVERY,
  GATE,
  OTHER,
  PASTED,
])

/**
 * BroBot's own entries at the top level of `userData`, each with the source that writes it.
 *
 * ⚠️ **`brobot2.sqlite-journal` is the one name here that is NOT established from this source.** The
 * connection sets `journal_mode = WAL` (`db/connection.ts:19`) and nothing in the repository opens a
 * rollback journal, so the name is SQLite's behaviour rather than BroBot's — it is listed only so
 * that, if it ever appears, the report calls it the ledger instead of {@link OTHER}.
 */
export const MANIFEST = Object.freeze([
  { name: 'active-theme.json', expect: 'file', why: WORKSPACE, source: 'main/themes/state.ts' },
  { name: 'dock-label.json', expect: 'file', why: WORKSPACE, source: 'main/dock-label.ts' },
  {
    name: 'transcript-retention.json',
    expect: 'file',
    why: WORKSPACE,
    source: 'main/transcript-retention.ts',
  },
  { name: 'themes', expect: 'dir', why: WORKSPACE, source: 'main/themes/state.ts' },
  { name: 'brobot2.sqlite', expect: 'file', why: LEDGER, source: 'main/index.ts:218' },
  { name: 'brobot2.sqlite-wal', expect: 'file', why: LEDGER, source: 'main/db/connection.ts:19' },
  { name: 'brobot2.sqlite-shm', expect: 'file', why: LEDGER, source: 'main/db/connection.ts:19' },
  { name: 'brobot2.sqlite-journal', expect: 'file', why: LEDGER, source: "SQLite's, not BroBot's" },
  {
    name: 'brobot-workspace',
    expect: 'dir',
    why: WORKSPACE,
    source: 'main/runtime/workspace.ts:45',
  },
  {
    name: 'resources',
    expect: 'dir',
    why: RESOURCES,
    source: 'main/resources/resources.ts (resourcesRoot)',
  },
  { name: 'drafts.json', expect: 'file', why: DRAFTS, source: 'main/drafts-file.ts (744)' },
  // The conversations a person archived, named by their rows in the ledger it goes with.
  { name: 'archived.json', expect: 'file', why: LEDGER, source: 'main/archived-file.ts' },
  { name: 'exports', expect: 'dir', why: EXPORTS, source: 'main/index.ts:415' },
  { name: 'worker-output', expect: 'dir', why: WORKSPACE, source: 'main/worker-piece-folder.ts' },
  {
    name: 'provider-homes',
    expect: 'dir',
    why: HOMES,
    source: 'main/runtime/provider-homes.ts:80',
  },
  { name: 'one-host.sock', expect: 'unlink', why: GATE, source: 'main/one-host-gate.ts:127' },
  {
    name: 'update-settings.json',
    expect: 'file',
    why: UPDATES,
    source: 'main/update-settings.ts (updateSettingsOf)',
  },
  { name: 'updates', expect: 'dir', why: UPDATES, source: 'main/updates-in-the-app.ts (guide)' },
  {
    name: 'sign-in-changes.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/sign-in-changes.ts (signInChangesIn)',
  },
  {
    name: 'schedule-attempts.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/schedule-attempts-file.ts (scheduleAttemptsFile)',
  },
  {
    name: 'profile-execution.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/profile-execution-file.ts (profileExecutionFile)',
  },
  {
    name: 'turns-the-app-cut.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/turns-the-app-cut-file.ts (turnsTheAppCutFile)',
  },
  {
    name: 'start-attempts.jsonl',
    expect: 'file',
    why: LEDGER,
    source: 'main/start-attempts-log.ts (aStartAttemptsLog)',
  },
  {
    name: 'start-attempts.1.jsonl',
    expect: 'file',
    why: LEDGER,
    source: 'main/start-attempts-log.ts (aStartAttemptsLog)',
  },
  {
    name: 'workspace.json',
    expect: 'file',
    why: WORKSPACES,
    source: 'main/workspaces.ts (nameWorkspace)',
  },
  {
    name: 'workspaces.json',
    expect: 'file',
    why: WORKSPACES,
    source: 'main/workspaces.ts (workspaceListFile)',
  },
  {
    name: 'provider-usage.json',
    expect: 'file',
    why: USAGE,
    source: 'main/provider-usage-file.ts (providerUsageFile)',
  },
  {
    name: 'provider-accounts.json',
    expect: 'file',
    why: USAGE,
    source: 'main/provider-accounts-file.ts (providerAccountsFile)',
  },
  {
    name: 'backups',
    expect: 'dir',
    why: RECOVERY,
    source: 'main/recovery/layout.ts (BACKUPS_DIRNAME)',
  },
  {
    name: 'recovery',
    expect: 'dir',
    why: RECOVERY,
    source: 'main/recovery/layout.ts (RECOVERY_DIRNAME)',
  },
])

export const ACTIVE_THEME_PART = /^active-theme\.json\.\d+\.[0-9a-f-]{36}\.tmp$/

/**
 * 🔴 **744 · the private name one drafts save is written to before it is renamed into place** —
 * `DRAFTS_PART` in `apps/desktop/src/main/drafts-file.ts`. ⚠️ A kill inside a save leaves one, and it
 * holds somebody's words: it is the drafts file's, and is reported as the unsent drafts, not as
 * something BroBot did not write.
 */
export const DRAFTS_PART = /^drafts\.json\.[0-9a-f]{12}\.part$/

/**
 * The name one write of a hidden launch's update settings goes to before it is renamed into place —
 * `<file>.<pid>.tmp`, in `apps/desktop/src/main/update-settings.ts`. ⚠️ A kill inside a write leaves
 * one: it is the updater's, and goes with the updater's files.
 */
export const UPDATE_SETTINGS_PART = /^update-settings\.json\.\d+\.tmp$/

/**
 * The name one write of a workspace's Dock label goes to before it is renamed into place —
 * `<file>.<pid>.<uuid>.tmp`, from `writeWorkspaceFile` in `apps/desktop/src/main/themes/state.ts`.
 * ⚠️ A kill inside a write leaves one: it goes with the workspace's files.
 */
export const DOCK_LABEL_PART = /^dock-label\.json\.\d+\.[0-9a-f-]{36}\.tmp$/
export const TRANSCRIPT_RETENTION_PART = /^transcript-retention\.json\.\d+\.[0-9a-f-]{36}\.tmp$/

/**
 * The name one write of a workspace's name, or of a hidden launch's list, goes to before it is
 * renamed into place — `<file>.<pid>.tmp`, in `apps/desktop/src/main/workspaces.ts`. ⚠️ A kill
 * inside a write leaves one: it goes with the workspace's files.
 */
export const WORKSPACES_PART = /^workspaces?\.json\.\d+\.tmp$/

/**
 * The name one write of the kept usage readings, or of the account they were read on, goes to
 * before it is renamed into place — `<file>.<pid>.tmp`, in `apps/desktop/src/main/provider-usage-file.ts`
 * and `provider-accounts-file.ts`. ⚠️ A kill inside a write leaves one: it goes with the readings.
 */
export const PROVIDER_USAGE_PART = /^provider-(?:usage|accounts)\.json\.\d+\.tmp$/

/**
 * W4.172 · the name one write of the sign-in changes goes to before it is renamed into place —
 * `<file>.<pid>.tmp`, in `apps/desktop/src/main/sign-in-changes.ts`. ⚠️ A kill inside a write leaves
 * one: it goes with the moments it would have held, which go with the ledger whose limits they end.
 */
export const SIGN_IN_CHANGES_PART = /^sign-in-changes\.json\.\d+\.tmp$/

/**
 * The name one write of what the app did about scheduled jobs goes to before it is renamed into
 * place — `<file>.<pid>.tmp`, in `apps/desktop/src/main/schedule-attempts-file.ts`. ⚠️ A kill inside
 * a write leaves one: it goes with the ledger whose conversations it is about.
 */
export const SCHEDULE_ATTEMPTS_PART = /^schedule-attempts\.json\.\d+\.tmp$/

/**
 * The name one write of how each profile runs its work goes to before it is renamed into place —
 * `<file>.<pid>.tmp`, in `apps/desktop/src/main/profile-execution-file.ts`. ⚠️ A kill inside a write
 * leaves one: it goes with the ledger whose profiles and conversations it names.
 */
export const PROFILE_EXECUTION_PART = /^profile-execution\.json\.\d+\.tmp$/

/**
 * The gate's PRIVATE name, which `claimSoleHost` normally unlinks itself
 * (`main/one-host-gate.ts:227`). ⚠️ Eight lowercase hex, from a digest — not a glob on `.oh`.
 */
export const GATE_PRIVATE = /^\.oh-[0-9a-f]{8}$/

/**
 * What a folder or profile directory under `provider-homes/` may be named.
 *
 * ⚠️ **Copied from `apps/desktop/src/shared/runtime-ipc.ts:53-54`, and a test holds the two in
 * step.** It cannot be imported: the constant lives in TypeScript that this `.mjs` has no build step
 * for, and a second spelling that drifts would let a directory the app can never have created pass
 * as one it did.
 */
export const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const PATH_SEGMENT_MAX = 64

/** The two provider leaves, and nothing else may sit at that depth. */
export const PROVIDERS = Object.freeze(['claude', 'codex'])

/**
 * 🔴 **The one folder under `provider-homes/` every home lives in** — `HOME_FOLDER` in
 * `provider-homes.ts`, and a test holds the two spellings in step for the same reason
 * {@link PATH_SEGMENT} has one.
 *
 * ⚠️ **`listProviderHomes` and `listProfileIds` read only it**, so a home in any other folder is
 * removed by this reset and was never in the menu. ⛔ Saying *"the launcher still offers every one
 * of these"* over everything under `provider-homes/` is an over-claim (352 review), and the report
 * splits them rather than blurring them.
 */
export const HOME_FOLDER = 'default'

/**
 * 🔴 **620 · how this app NAMES its own profile to a person** — `DEFAULT_PROFILE_LABEL`, and a test
 * holds the two in step for the same reason {@link PATH_SEGMENT} has one.
 *
 * ⛔ **Read the line above before you read this one.** {@link HOME_FOLDER} is the string
 * `default` and is still correct; the PROFILE stopped being called that at `592`. ⚠️ **One word,
 * two subjects** (`two-questions-about-one-address`) — which is exactly how a sweep for the word
 * `default` drowns, and how the sentence this constant now feeds survived one.
 *
 * ⚑ **`592` repaired the footnote by writing the product's name as a literal**, on the reasoning
 * that this `.mjs` cannot import the slug and a spelling here would be one rename from false again.
 * ⛔ **The first half of that is true and the second half is what this constant answers**: the
 * spelling is imported from ONE place and held to `apps/desktop/src/shared/runtime-ipc.ts` by a
 * test, which is the same boundary {@link PATH_SEGMENT}, {@link BUNDLE_NAME} and
 * {@link HOME_FOLDER} already cross. ⚠️ **It is the LABEL and never the id** — the id is what
 * goes in a path and on the wire, and no sentence here is about a path.
 */
export const DEFAULT_PROFILE_LABEL = 'BroBot'

/** `<provider>.lock` and its steal remnant — siblings of the leaf, not children of it. */
export const HOME_LOCK = /^(claude|codex)\.lock(\.stale-\d+-\d+)?$/

/** The finished clipboard copy — `shared/runtime-ipc.ts:3141`, character for character. */
export const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\.png$/
/** The half-written one — `main/runtime/pasted-image.ts:139-140`, character for character. */
export const PASTED_PART = /^pasted-[0-9a-f]{32}\.png\.[0-9a-f]{12}\.part$/

/** The credential kept by default: a regular file at exactly this mode, or the run refuses. */
export const CODEX_AUTH = 'auth.json'
export const CODEX_AUTH_MODE = 0o600

/** The directory name, so the string is spelled once. */
export const HOMES_DIRNAME = 'provider-homes'

/**
 * The kept tree's, for the same reason. ⚠️ **{@link MANIFEST} spells it literally** — it is declared
 * above this line and a `const` cannot be read before it is initialised — so a test pins the two
 * equal rather than a reader keeping them so.
 */
export const EXPORTS_DIRNAME = 'exports'

/**
 * 🔴 **The names no program but BroBot writes** — the signal that a directory this reset does NOT
 * recognise is a userData of ours, nested inside the one it was pointed at (539).
 *
 * ## ⛔ The defect this exists for, measured rather than imagined
 *
 * `--dir <userData>/..` — the PARENT — is one keystroke from the right answer and reads the same in
 * a shell. The whole userData then arrives at the bottom of {@link planCleanBase} as ONE entry the
 * manifest does not name, is classified {@link OTHER}, and is removed recursively with everything
 * under it: the ledger, `exports/`, and every managed `auth.json` the run had just promised to keep.
 * ⚠️ **Measured on a fixture against `2d473821`**: the report printed `other — 19 paths · 98 B /
 * desktop`, exit 0, and the last line still said *"provider-homes/ still stands"*.
 *
 * ⛔ **The guard and the act were measured at different DEPTHS.** `--keep-profile-auth` is keyed to
 * `provider-homes` being a CHILD of the anchor — {@link planCleanBase}'s `named` lookup, one level
 * — while the removal walks every level under an unrecognised name. 🔴 **A promise checked at depth
 * one cannot hold a removal that reaches depth n**, and that is the shape rather than the instance.
 *
 * ## ⚑ Why these names and not the whole {@link MANIFEST}
 *
 * ⛔ `resources`, `exports` and (since `744`) `drafts.json` are ORDINARY WORDS, and a refusal keyed to one would fire on any
 * unfamiliar Chromium subdirectory that happens to hold a folder of that name — the routed-around
 * reset `351` §1 rules worse than none. ⚑ Every name below is one only this app writes, so a
 * directory holding one IS a BroBot userData and the target is the wrong directory. A test pins this
 * list against {@link MANIFEST}, so a name added there has to be classified here.
 *
 * ## 🔴 And the tree a CLEANED userData leaves, which the names above cannot see
 *
 * ⛔ **A successful default run leaves exactly one thing at the top level: `exports/`** — the keep
 * whose own reason is *"a new export cannot be regenerated once the provider's file is gone"*. ⚠️ **So the
 * tree with no sign left to read is precisely the tree whose only content is the one thing this
 * script refuses to take.** Reset on Monday, `--dir` one level too high on Tuesday, and the
 * exports go with exit 0 and no `--drop-exports`.
 *
 * ⚑ **{@link BUNDLE_NAME} closes it, and it is a name rather than a folder.** A file the product
 * wrote as `<sessionId>.brobot-session.json` is BroBot's and nothing else's, so it is a sign
 * wherever it is — which is stronger than keying on a directory called `exports`, an ordinary word
 * this list refuses to use for exactly that reason.
 */
export const NESTED_USERDATA_SIGNS = Object.freeze([
  'brobot2.sqlite',
  'brobot2.sqlite-wal',
  'brobot2.sqlite-shm',
  'brobot2.sqlite-journal',
  'brobot-workspace',
  HOMES_DIRNAME,
  'one-host.sock',
])

/**
 * ⚑ **What the product writes an export as** — `BUNDLE_SUFFIX` in
 * `apps/desktop/src/shared/runtime-ipc.ts:2612`, and a test holds the two spellings in step for the
 * same reason {@link PATH_SEGMENT} has one: this `.mjs` has no build step for that TypeScript.
 *
 * ⛔ **A sign in its own right**, and the only one that is not a top-level manifest name: an export
 * is the one file under `userData` that cannot be regenerated, and a directory holding one is a
 * BroBot tree whatever else has been removed from it.
 */
export const BUNDLE_NAME = /\.brobot-session\.json$/

function isSegment(name) {
  return name.length <= PATH_SEGMENT_MAX && PATH_SEGMENT.test(name)
}

function listing(path) {
  try {
    return { kind: 'read', entries: readdirSync(path, { withFileTypes: true }) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'absent', entries: [] }
    return { kind: 'unknown', why: `${path} could not be listed: ${error?.code ?? 'unknown'}` }
  }
}

/**
 * 🔴 **W4.117 · where a path LEADS** — every link in the part that exists followed, and the part
 * that does not exist yet, as typed.
 *
 * ⚑ **`realpathSync.native`, the call `trustedAnchor` makes**, so the warning and the anchor never
 * disagree about a path. On macOS it also gives the case the disk holds: `SHARED/inner` comes back
 * as the `Shared/Inner` it is, where `realpathSync` keeps what was typed.
 *
 * ⚠️ **`..` is cancelled against the spelling first** — `resolve()`, as `trustedAnchor` does — so
 * this names the folder the run would anchor on.
 *
 * ⛔ **Not exported.** The test fixtures keep a function of this name, and
 * `clean-base-runs-only-in-the-gate.test.mjs` reads a library function's name in a file that also
 * removes as a plan carried out by hand — which the fixtures' cleanup would then be.
 */
function whereItLeads(path) {
  let rest = ''
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      return join(realpathSync.native(at), rest)
    } catch {
      if (dirname(at) === at) return resolve(path)
      rest = join(basename(at), rest)
    }
  }
}

/**
 * 🔴 **W4.117 · is the target the data folder every BroBot here shares, or inside it?** Asked of the
 * FOLDERS, never of how they are spelled.
 *
 * ⛔ **`resolve(target) === resolve(defaultUserData())` stood in the script, and `resolve()` follows
 * no link.** A `--dir` that was a link to the shared folder, or that ran through a linked parent, or
 * typed its case another way, passed as some other folder — and the run, which anchors on the REAL
 * path, emptied the shared folder all the same, with no word about whose data it was.
 *
 * ⚑ **So the target is followed to where it leads, and folders are compared by device and inode**
 * — `safe-remove.mjs`' `whereItStands`, the comparison `trustedAnchor` makes (W4.124). A firmlink is
 * the same folder too: `/System/Volumes/Data/private/tmp/x` is `/private/tmp/x`, and `realpath(3)`
 * returns either spelling as it was given. The shared folder where the target leads is `'is'`, and
 * the shared folder above it is `'inside'`.
 *
 * ⚑ **And the other way up: a target that HOLDS the shared folder is `'holds'`** — `--dir
 * <appData>/@brobot2` removes it whole, and so does `/System/Volumes/Data`, which holds it in its other
 * spelling. ⚠️ The 539 refusal stops that run while the shared folder holds a sign of a userData; once
 * a clean base has left none, the warning is what is left to say it.
 *
 * ⚠️ **A machine with no shared folder yet has no identity to compare**, and nothing there to empty;
 * the spellings are compared instead, each followed through every link that exists.
 *
 * @returns {'is' | 'inside' | 'holds' | null}
 */
export function againstTheSharedFolder(target, shared = defaultUserData()) {
  const leads = whereItLeads(target)
  const sharedLeads = whereItLeads(shared)
  // ⚠️ Where the folders cannot be compared — no shared folder yet, or one that could not be read on
  // the way — the spellings are, each followed through every link that exists: a warning says what
  // it can (`--dir <shared>/locked/x`, with `locked` unreadable, is still inside).
  const stands = identityOf(sharedLeads) === null ? undefined : whereItStands(leads, sharedLeads)
  if (stands !== undefined) return stands
  if (leads === sharedLeads) return 'is'
  if (isAncestor(sharedLeads, leads)) return 'inside'
  return isAncestor(leads, sharedLeads) ? 'holds' : null
}

/**
 * ⛔ **W4.117 · a link on the way to the target that leads to nothing — named, and refused.**
 *
 * `realpath(3)` answers ENOENT for it exactly as for a typo, so the run said *"nothing at this
 * path"* and exited 0 about a path where something IS: a link whose own target is missing. ⚑ Which
 * end is wrong is the person's to say, so this names the link and what it points at.
 *
 * ⚠️ **Asked only once the anchor found nothing** (`kind: 'absent'`), of the spelling it anchored
 * (`anchor.lexical`). A loop never reaches it: `trustedAnchor` already refuses what it cannot resolve.
 *
 * @returns {string | null} the refusal, or null when no link on the way leads nowhere
 */
export function aLinkThatLeadsNowhere(lexical) {
  const chain = []
  for (let at = lexical; ; at = dirname(at)) {
    chain.unshift(at)
    if (dirname(at) === at) break
  }
  for (const at of chain) {
    let stat
    try {
      stat = lstatSync(at)
    } catch {
      // ⚑ nothing here at all — the ordinary "nothing at this path": a typo, or a folder never made
      return null
    }
    if (!stat.isSymbolicLink()) continue
    try {
      statSync(at)
    } catch {
      return (
        `${at} is a link to ${readlinkSync(at)}, which leads nowhere — point --dir at the folder ` +
        `you mean, or make that link lead to a folder that exists`
      )
    }
  }
  return null
}

/**
 * 🔴 **Is one of {@link NESTED_USERDATA_SIGNS} anywhere under this path?** (539)
 *
 * ⚑ **Every level, because the removal reaches every level.** ⚠️ **It is not free, and the header's
 * cost line says so now:** a run that finds nothing walks every unrecognised subtree TWICE, once
 * here and once in `removeChecked` — and a run that refuses still scans the remaining top-level
 * entries, because {@link planCleanBase} collects every refusal rather than stopping at the first
 * (`351` §3.3: *stop, say WHICH, and remove nothing*). ⛔ Returning on the first sign bounds one
 * subtree, not the run.
 *
 * ⛔ **A directory it cannot read is `unknown`, and unknown is a refusal** — this file's own rule. A
 * tree this walk could not account for is a tree no removal can be proved safe over, and the same
 * directory would have failed the removal a moment later with half the base already gone.
 *
 * ⚠️ **It never follows a symlink.** `isDirectory()` is false for one, so a link is compared by name
 * and never descended into — the same reason {@link planCleanBase} takes the kind from the dirent.
 *
 * ⚑ **It returns the HOLDER as well as the evidence** (539 review). A manifest name is a top-level
 * name of a userData, so the directory it sits in IS one; a {@link BUNDLE_NAME} file is two levels
 * down, under `exports/`, so the userData is that directory's parent. ⛔ **A bundle anywhere ELSE
 * is not a sign at all** — a loose `.brobot-session.json` in a Chromium cache says nothing about
 * where a userData is, and a holder this walk cannot name is advice it must not give.
 *
 * @returns {{ kind: 'found', at: string, holder: string } | { kind: 'clean' }
 *   | { kind: 'unknown', why: string }}
 */
export function firstNestedSign(root, rel) {
  const stack = [[rel, root]]
  while (stack.length > 0) {
    const [at, path] = stack.pop()
    const here = listing(path)
    if (here.kind === 'unknown') return { kind: 'unknown', why: here.why }
    // ⚠️ **Sorted by BYTES, so two machines with the same tree name the same path.** `readdir`
    // returns whatever the filesystem holds, which is the drift {@link REPORT_ORDER} exists for one
    // report over — and a refusal a person cannot reproduce is a refusal they cannot act on.
    // ⛔ **Not `localeCompare`**: it resolves against the runtime's locale and ICU build, which is
    // machine state rather than tree state, and it returns 0 for names that differ only by
    // ignorable characters — leaving `readdir` order to break the tie it was called to remove.
    const entries = [...here.entries].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      if (NESTED_USERDATA_SIGNS.includes(entry.name)) {
        return { kind: 'found', at: `${at}/${entry.name}`, holder: at }
      }
      if (entry.isFile() && BUNDLE_NAME.test(entry.name) && at.endsWith(`/${EXPORTS_DIRNAME}`)) {
        return {
          kind: 'found',
          at: `${at}/${entry.name}`,
          holder: at.slice(0, at.length - EXPORTS_DIRNAME.length - 1),
        }
      }
    }
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].isDirectory())
        stack.push([`${at}/${entries[i].name}`, `${path}/${entries[i].name}`])
    }
  }
  return { kind: 'clean' }
}

/**
 * 🔴 **What `provider-homes/` holds NOW** — the post-state, read off the disk (539).
 *
 * ⛔ **The last line may not be computed from the flag**, and this is the measurement that replaces
 * it. `--keep-profile-auth` printed *"provider-homes/ still stands … each with the auth.json it
 * already had"* on a run that had just deleted both, because the sentence was selected by
 * `parsed.flags.has('--keep-profile-auth')` and by nothing else.
 *
 * ⚠️ **Only a REAL run has a post-state to read.** A preview removed nothing, so reading the disk
 * after one would describe the state it deliberately did not produce — `--dry-run` predicts from the
 * plan instead, which is what {@link planCleanBase} returns `sawHomes` and `kept` for.
 *
 * ⚑ **`lstat`, so a SYMLINK named `auth.json` is not counted as a managed credential** and a
 * symlinked `provider-homes` is not counted as the tree standing. ⛔ **That is NOT the same answer
 * {@link planProviderHomes} gives** — it REFUSES the whole run on that shape (`expect: 'dir'`),
 * where this returns the positive claim *the tree is gone*. They are opposite, and the difference
 * only matters if that refusal ever narrows the way the `0600` check already did once.
 *
 * ⚠️ **No mutation can kill that `isFile()` today, and it is kept anyway — the reason, so nobody
 * re-derives it:** under `--keep-profile-auth` a non-regular `auth.json` refuses the whole run
 * before this is reached ({@link planProviderHomes}'s `expect: 'file'`), and on the default path
 * the tree is gone, so both readings answer the same. ⛔ `a-line-no-mutation-can-kill-is-not-
 * carrying-its-rule` says to notice that, not to delete the line: this function is what would be
 * left measuring the credential the day that guard moves.
 */
export function homesOnDisk(anchor) {
  const root = `${anchor.real}/${HOMES_DIRNAME}`
  let stat
  try {
    stat = lstatSync(root)
  } catch {
    // ⚑ the ordinary answer after a default run, and after every run on a fresh install
    return { standing: false, credentials: 0 }
  }
  if (!stat.isDirectory()) return { standing: false, credentials: 0 }
  let credentials = 0
  // ⛔ **`?? []`, because {@link listing} returns no `entries` when it could not READ.** Every
  // other caller in this file discriminates on `kind` and pushes a refusal; this one counts, so the
  // bare property would be a `TypeError` thrown AFTER the removals — which would take the whole
  // report with it, and the report is the only record of what went.
  //
  // ⚠️ **Be exact about what the fallback costs**: a subtree this could not read is folded into
  // `credentials = 0` and rendered as the POSITIVE claim *no managed auth.json was kept*, not as
  // *I could not tell*. ⛔ **Unreachable today** — a directory under `provider-homes/` that cannot
  // be listed refuses the run in {@link planProviderHomes} before anything is applied, and on the
  // default path the tree is gone before this line — so what is left is the check-to-syscall
  // window `safe-remove.mjs`'s header already declines to claim it closed. ⚑ No third arm is built
  // for it: an arm no test can enter is the thing this file spent 352 removing.
  for (const folder of listing(root).entries ?? []) {
    if (!folder.isDirectory()) continue
    for (const profile of listing(`${root}/${folder.name}`).entries ?? []) {
      if (!profile.isDirectory()) continue
      let auth
      try {
        auth = lstatSync(`${root}/${folder.name}/${profile.name}/codex/${CODEX_AUTH}`)
      } catch {
        // ⚑ the ordinary state of a codex home whose first conversation has not run
        continue
      }
      if (auth.isFile()) credentials += 1
    }
  }
  return { standing: true, credentials }
}

/**
 * A fresh install removes the whole managed provider-home tree; --keep-profile-auth preserves it.
 * Empty leaves still appear in the launcher, so retaining their directories would not produce a
 * fresh install. Check unexplained directory shapes in either mode. Credential shape and
 * permissions matter only when preserving authentication: removing the tree must not be blocked by
 * a credential it will not keep. Use one tree action to avoid double-counting nested profiles in
 * the dry-run preview, and report profile names separately.
 */
export function planProviderHomes(anchor, { keepAuth = false } = {}) {
  const actions = []
  const refusals = []
  /** `<folder>/<profile>` for every home this walk finds; those under {@link HOME_FOLDER} are the menu. */
  const profiles = new Set()
  /** Names inside the tree that BroBot did not write, so the report can still name them. */
  const strays = []
  /**
   * ⚠️ **How many managed credentials a `--keep-profile-auth` run really keeps** (352 review).
   * The `kept on purpose` entry used to be pushed the moment `provider-homes/` appeared in the
   * top-level listing — before any `codex` home had been seen — so a tree with no Codex home at all
   * printed a promise about a file nothing kept.
   */
  let kept = 0
  const root = mayRemove(anchor, HOMES_DIRNAME, { expect: 'dir' })
  const empty = { actions, refusals, profiles: [], strays, kept: 0 }
  if (root.kind === 'absent') return empty
  if (root.kind === 'refused') return { ...empty, refusals: [root.why] }

  const folders = listing(root.path)
  if (folders.kind === 'unknown') return { ...empty, refusals: [folders.why] }
  for (const folder of folders.entries) {
    const folderRel = `${HOMES_DIRNAME}/${folder.name}`
    if (folder.isFile()) {
      // ⚠️ **A FILE here was never a home folder, and refusing on one is a refusal you cannot
      // clear** (351 review). Finder writes `.DS_Store` into any directory a person opens, so a
      // rule that stopped the whole reset on it would stop it permanently. It is removed and NAMED
      // — as its own action while the tree survives, and as a named stray when the tree does not.
      //
      // ⛔ **`isFile()`, not `!isDirectory()`** (352 review). Nothing ordinary puts a SYMLINK, a
      // socket or a device beside these directories; `.DS_Store` is a regular file and the
      // exception is for it alone. Everything else that is not a directory falls to the refusal
      // below, which is `350`'s rule and the shape `351` §4's symlink test pins.
      if (keepAuth) actions.push({ rel: folderRel, expect: 'unlink', why: OTHER })
      else strays.push(folderRel)
      continue
    }
    if (!folder.isDirectory()) {
      refusals.push(
        `${folderRel} is neither a folder nor an ordinary file — this reset does not know what it is`,
      )
      continue
    }
    if (!isSegment(folder.name)) {
      refusals.push(
        `${folderRel} is not a valid folder name — BroBot cannot have created it, so this reset will not remove it`,
      )
      continue
    }
    const profileEntries = listing(`${root.path}/${folder.name}`)
    if (profileEntries.kind === 'unknown') {
      refusals.push(profileEntries.why)
      continue
    }
    for (const profile of profileEntries.entries) {
      const profileRel = `${folderRel}/${profile.name}`
      if (profile.isFile()) {
        if (keepAuth) actions.push({ rel: profileRel, expect: 'unlink', why: OTHER })
        else strays.push(profileRel)
        continue
      }
      if (!profile.isDirectory()) {
        refusals.push(
          `${profileRel} is neither a profile directory nor an ordinary file — this reset does not know what it is`,
        )
        continue
      }
      if (!isSegment(profile.name)) {
        refusals.push(`${profileRel} is not a valid profile directory`)
        continue
      }
      const leaves = listing(`${root.path}/${folder.name}/${profile.name}`)
      if (leaves.kind === 'unknown') {
        refusals.push(leaves.why)
        continue
      }
      for (const leaf of leaves.entries) {
        const rel = `${profileRel}/${leaf.name}`
        if (HOME_LOCK.test(leaf.name)) {
          // ⚠️ `breakStaleLock` RENAMES the lock out of the way and then tries `unlink` and `rmdir`
          // in turn (`provider-home.ts:264,279,287`), so a remnant can be either kind. The dirent
          // already knows; nothing here has to guess.
          if (keepAuth) {
            actions.push({
              rel,
              expect: leaf.isDirectory() ? 'dir' : 'unlink',
              why: HOMES,
              note: 'a provisioning lock',
            })
          }
          continue
        }
        if (leaf.isFile()) {
          // ⛔ **The `.DS_Store` exception, at the level it was missing from** (352 review). The two
          // levels above have carried it since `351`; this one did not, and macOS writes that file
          // into **any** directory a person opens in Finder — including the profile folder somebody
          // opens to look at their `claude` and `codex` homes. 🔴 **From then on every run refused
          // and removed nothing**, which is `351` §1's routed-around reset arriving as a bug.
          // ⚑ **And it is not a shape the product cannot account for**: `listProviderHomes` skips a
          // non-directory here in silence (`provider-homes.ts:141`). A DIRECTORY with an unknown
          // name still refuses, one line down — that would be a home BroBot did not make.
          if (keepAuth) actions.push({ rel, expect: 'unlink', why: OTHER })
          else strays.push(rel)
          continue
        }
        if (!leaf.isDirectory() || !PROVIDERS.includes(leaf.name)) {
          refusals.push(
            `${rel} is neither a ${PROVIDERS.join('/')} home nor a provisioning lock — this reset does not know what it is`,
          )
          continue
        }
        // ⛔ **Asked where the answer DECIDES something, and only there** (352 review, correcting
        // this dispatch's own first draft). The question is *"is this the managed credential we are
        // about to keep?"* — on the path that removes the whole tree nothing turns on the answer,
        // and `removeChecked` unlinks a symlink by name rather than following it
        // (`safe-remove.mjs:450`), so there is nothing unsafe to guard against either.
        //
        // 🔴 **352 widened this to both paths and that was wrong.** A managed `auth.json` left at
        // `0644` by a restore, a `cp` under a permissive umask or a sync tool would then have made
        // `pnpm clean-base` refuse in EVERY mode — a reset a person cannot run and cannot clear
        // without chmod'ing a file they cannot see. ⚑ `351`'s scope was right for the reason
        // `351` §1 gives, and this is it restored.
        if (keepAuth && leaf.name === 'codex') {
          const auth = mayRemove(anchor, `${rel}/${CODEX_AUTH}`, { expect: 'file' })
          if (auth.kind === 'refused') {
            refusals.push(`${rel}/${CODEX_AUTH}: ${auth.why}`)
            continue
          }
          if (auth.kind === 'ok' && (auth.stat.mode & 0o777) !== CODEX_AUTH_MODE) {
            refusals.push(
              `${rel}/${CODEX_AUTH} is mode 0${(auth.stat.mode & 0o777).toString(8)} where a managed credential is 0600 — this reset will not decide what it is`,
            )
            continue
          }
          // ⚑ **A credential that is really there** — `absent` is the ordinary state of a Codex home
          // whose first session has not run, and counting it would put the same promise in the
          // report as a home that has one.
          if (auth.kind === 'ok') kept += 1
        }
        // ⚑ **The menu, as this walk sees it** — the same levels and the same two leaf names
        // `listProviderHomes` accepts under {@link HOME_FOLDER}, so what the report promises to
        // remove is what the launcher was actually offering.
        profiles.add(`${folder.name}/${profile.name}`)
        if (!keepAuth) continue
        actions.push({
          rel,
          expect: 'dir',
          why: HOMES,
          empty: true,
          keep: leaf.name === 'codex' ? CODEX_AUTH : null,
          note: leaf.name === 'codex' ? `emptied, keeping ${CODEX_AUTH}` : 'emptied',
        })
      }
    }
  }
  if (!keepAuth) {
    actions.push({
      rel: HOMES_DIRNAME,
      expect: 'dir',
      why: HOMES,
      note: 'the whole tree — a fresh install has no such directory',
    })
  }
  return { actions, refusals, profiles: [...profiles].sort(), strays, kept }
}

/**
 * 🔴 **The plan**: every action, every refusal, everything deliberately kept.
 *
 * ⛔ **A single refusal makes the whole plan unrunnable** — `351` §3.3: *"stop, say which, and remove
 * nothing."* A half-clean base that a person believes is clean is the failure this reset exists to
 * avoid, and it is worse than no reset at all because nothing on screen says which half.
 */
export function planCleanBase(anchor, { dropExports = false, keepAuth = false } = {}) {
  const actions = []
  const refusals = []
  const keeps = []
  let profiles = []
  let homeStrays = []
  /** ⚑ **539 · what the last line is allowed to predict on a preview**, which has no post-state. */
  let sawHomes = false
  let kept = 0

  const top = listing(anchor.real)
  if (top.kind === 'unknown') {
    return { actions, refusals: [top.why], keeps, profiles, homeStrays, sawHomes, kept }
  }

  const named = new Map(MANIFEST.map((entry) => [entry.name, entry]))
  for (const entry of [...top.entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const rule = named.get(entry.name)
    if (rule?.name === 'worker-output') {
      keeps.push({
        rel: 'worker-output',
        why: "A person's results written for parallel pieces are kept on reset.",
      })
      continue
    }
    if (rule?.name === 'exports' && !dropExports) {
      keeps.push({
        rel: 'exports',
        why: "a new export cannot be regenerated once the provider's file is gone, and it loads into nothing",
        flag: '--drop-exports',
      })
      continue
    }
    if (rule?.name === HOMES_DIRNAME) {
      const homes = planProviderHomes(anchor, { keepAuth })
      actions.push(...homes.actions)
      refusals.push(...homes.refusals)
      profiles = homes.profiles
      homeStrays = homes.strays
      sawHomes = true
      kept = homes.kept
      if (keepAuth && homes.kept > 0) {
        // ⛔ **What the flag really costs, said where a person reads it** (352 §2.3/§2.4). The
        // credential and the profile NAME are the same directory, so a keep cannot be scoped to one
        // of them — and `provisionCodexAuth` copies once and never overwrites
        // (`internal/auth.ts:316`), so a copy the provider has already retired is not repaired by
        // starting another conversation. Only the launcher's own sign-in replaces it.
        keeps.push({
          rel: `${HOMES_DIRNAME}/*/*/codex/${CODEX_AUTH} — and every profile directory holding one`,
          why: 'you asked for it; the default removes this. A kept copy that has been rotated stays stale, and nothing re-copies it: provisionCodexAuth never overwrites',
          flag: '--keep-profile-auth',
        })
      }
      continue
    }
    if (rule) {
      actions.push({ rel: rule.name, expect: rule.expect, why: rule.why })
      continue
    }
    if (GATE_PRIVATE.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'unlink', why: GATE })
      continue
    }
    if (
      ACTIVE_THEME_PART.test(entry.name) ||
      DOCK_LABEL_PART.test(entry.name) ||
      TRANSCRIPT_RETENTION_PART.test(entry.name)
    ) {
      actions.push({ rel: entry.name, expect: 'file', why: WORKSPACE })
      continue
    }
    if (DRAFTS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: DRAFTS })
      continue
    }
    if (UPDATE_SETTINGS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: UPDATES })
      continue
    }
    if (WORKSPACES_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: WORKSPACES })
      continue
    }
    if (PROVIDER_USAGE_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: USAGE })
      continue
    }
    if (SIGN_IN_CHANGES_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: LEDGER })
      continue
    }
    if (SCHEDULE_ATTEMPTS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: LEDGER })
      continue
    }
    if (PROFILE_EXECUTION_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: LEDGER })
      continue
    }
    // ⛔ **539 · an unrecognised name may not SWALLOW a userData.** The entry below is removed
    // whole, at every depth, and the manifest lookup above asked about depth one only — so a
    // userData nested inside the target took `provider-homes/` and every `auth.json` with it while
    // the flag that promised to keep them was still being read as kept. ⚑ The walk asks the same
    // question the manifest asks, at the depth the removal actually reaches.
    if (entry.isDirectory()) {
      const nested = firstNestedSign(`${anchor.real}/${entry.name}`, entry.name)
      if (nested.kind === 'unknown') {
        refusals.push(nested.why)
        continue
      }
      if (nested.kind === 'found') {
        // ⛔ **The remedy comes from the SIGN, not from the entry** (539 review).
        // `${anchor.real}/${entry.name}` is the userData only when the nesting is exactly one
        // level; at two the old wording sent a person one directory too high, into the same
        // mistake they were being warned about. ⚑ {@link firstNestedSign} names the holder.
        const userData = `${anchor.real}/${nested.holder}`
        refusals.push(
          `${entry.name} is not a name this reset knows, so it would be removed whole — and ` +
            `${nested.at} is under it, which only BroBot writes. ⛔ This reset empties ONE userData ` +
            `and ${userData} looks like one, inside the directory you named: point --dir at it if ` +
            `that is the one you meant, and move or remove that tree if it is not.`,
        )
        continue
      }
    }
    // ⚑ **Named, never re-labelled** — this is the line `350`'s rule is about. An entry this file
    // does not know appears in the report under its own literal name; nothing calls it Chromium.
    // ⚠️ The KIND comes from the dirent rather than from a guess, so the three `Singleton*` symlinks
    // and any socket are unlinked by name and never followed.
    actions.push({ rel: entry.name, expect: entry.isDirectory() ? 'dir' : 'unlink', why: OTHER })
  }
  return { actions, refusals, keeps, profiles, homeStrays, sawHomes, kept }
}

/**
 * The clipboard copies, which live in a SIBLING of `userData` rather than inside it.
 *
 * ⛔ **Only the two exact names the product owns**, which is the sweeper's own bound
 * (`pasted-image.ts:334-336`: *"anything matching neither regex is skipped"*). ⚠️ An unfamiliar entry
 * is not a refusal here — it is somebody else's file in a directory we share the name of — but it
 * does keep the root, so the reset never removes a directory it did not empty.
 */
export function planPastedImages(anchor) {
  const actions = []
  const strays = []
  const top = listing(anchor.real)
  if (top.kind === 'unknown') return { actions, strays, refusals: [top.why] }
  for (const entry of top.entries) {
    if (PASTED_IMAGE_NAME.test(entry.name) || PASTED_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: PASTED })
      continue
    }
    strays.push(entry.name)
  }
  return { actions, strays, refusals: [] }
}

/**
 * 🔴 **Check every action before applying ANY of them** (351 review).
 *
 * ⛔ **The first draft checked and removed in one pass**, so an entry whose on-disk kind contradicted
 * the manifest — a `brobot2.sqlite` that had become a directory, a `Cache` that had become a symlink
 * — produced its refusal only when the walk reached it, by which time everything alphabetically
 * before it was gone. ⚠️ **That is exactly the half-clean base `351` §3.3 forbids**, and the report
 * would have shown both the removals and the refusal without saying they were in that order.
 */
export function checkPlan(anchor, actions) {
  const checked = []
  const refusals = []
  for (const action of actions) {
    const verdict = mayRemove(anchor, action.rel, { expect: action.expect })
    if (verdict.kind === 'refused') {
      refusals.push(verdict.why)
      continue
    }
    checked.push({ action, verdict })
  }
  return { checked, refusals }
}

/**
 * Apply what {@link checkPlan} approved.
 *
 * ⚠️ **`removeChecked` re-reads dev+ino beside the syscall**, so a path that changed between the
 * check pass and this one is reported as `left in place` rather than removed by a stale decision.
 */
export function applyChecked(checked, { dryRun = false } = {}) {
  const done = []
  for (const { action, verdict } of checked) {
    if (verdict.kind === 'absent') {
      done.push({ ...action, outcome: 'absent' })
      continue
    }
    const result = removeChecked(verdict.path, verdict.stat, {
      apply: !dryRun,
      removeRoot: !action.empty,
      keep: action.keep ? (relative) => relative === action.keep : undefined,
    })
    done.push({
      ...action,
      outcome: result.failed.length > 0 ? 'partly removed' : dryRun ? 'would remove' : 'removed',
      path: verdict.path,
      ...result,
    })
  }
  return done
}

/**
 * The pasted-image root itself, once nothing of ours is left in it.
 *
 * ⚑ **`350`'s ruling, which the first draft printed and did not implement**: *"351 must do the same,
 * then remove the root only if empty."* ⛔ It is removed only when the directory really is empty —
 * `rmdir` refuses a non-empty one, which is the check rather than a race around it — and only when
 * the inode is still the one that was approved.
 */
export function removeEmptyRoot(anchor, { dryRun = false } = {}) {
  let now
  try {
    now = lstatSync(anchor.real)
  } catch (error) {
    return { removed: false, why: `it could not be read: ${error?.code ?? 'unknown'}` }
  }
  if (!now.isDirectory() || now.dev !== anchor.dev || now.ino !== anchor.ino) {
    return { removed: false, why: 'it is no longer the directory that was checked' }
  }
  // ⚑ **`rmdir` IS the emptiness check** — it refuses a directory with anything in it, atomically,
  // which no `readdir` before it can do. A `readdirSync().length > 0` guard stood here and no
  // mutation could turn it red, because the only path that reaches it with a non-empty directory is
  // one where the kernel would refuse anyway. A line nothing can kill is not carrying its rule.
  if (dryRun) {
    // ⛔ **A preview may not predict from a directory the preview did not empty** (352 review). The
    // first draft ran this `readdir` against a root still holding every `pasted-*.png`, said *"the
    // root stays (it is not empty)"*, and the run it was previewing then deleted it — the opposite
    // outcome, in the sentence whose job is to say what will happen. ⚑ The caller only reaches this
    // when nothing unfamiliar is in the root (`clean-base.mjs`: `pasted.strays.length === 0`), so
    // what a real run will do is remove it; `planned` says so without claiming it already happened.
    return { removed: false, planned: true, why: null }
  }
  try {
    rmdirSync(anchor.real)
    return { removed: true, why: null }
  } catch (error) {
    // ⚠️ `ENOTEMPTY` is the ordinary answer here and reads as one: something is still in it.
    return { removed: false, why: `rmdir refused it: ${error?.code ?? 'unknown'}` }
  }
}
