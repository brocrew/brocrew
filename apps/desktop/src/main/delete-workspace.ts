import { readlinkSync, realpathSync } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { WorkspaceDeleted, WorkspaceDeleteVerdict } from '../shared/workspaces'
import {
  DRAFTS_PART,
  EXPORTS_DIRNAME,
  GATE_PRIVATE,
  MANIFEST,
  UPDATE_SETTINGS_PART,
  WORKSPACES_PART,
} from '../../../../scripts/lib/clean-base.mjs'
import { isAncestor, trustedAnchor, whereItStands } from '../../../../scripts/lib/safe-remove.mjs'
import { isPastedImageName } from '../shared/runtime-ipc'
import { PASTED_PART, pastedImagesRoot } from './runtime/pasted-image'
import { WORKSPACE_DIRNAME } from './runtime/workspace'
import { workspaceInstructionNames } from './providers/definitions'
import { insideBySpelling, sameFolder, samePath } from './same-folder'
import { asStartedOn, BROBOT_FOLDER_SIGNS, forgetWorkspace, isBroBotsFolder } from './workspaces'

/**
 * 🔴 **W4.151 · F092 — deleting a workspace a person made and no longer wants**: its folder goes to
 * the Trash, so it can be put back, and its row leaves the list. ⛔ **Never `rm`**: nothing here
 * removes a file; the system's Trash takes the folder whole ({@link deleteWorkspace}'s `trash`,
 * Electron's `shell.trashItem` in the app).
 *
 * ⛔ **What is never deleted**, each refused in words (`deleteVerdict`):
 *  - the Default workspace, and the one this window runs on;
 *  - one that is open — its gate answers, or Chromium's lock names a live process;
 *  - a folder that is not in the list;
 *  - a folder that is not BroBot's: it must hold BroBot's own files, and nothing at its top but
 *    what BroBot and the browser it is built on write (`BROBOTS_OWN`, `THE_BROWSERS`);
 *  - a folder that is, holds, or is inside a home directory, a provider's own folder (`~/.claude`,
 *    `~/.codex`, a `CLAUDE_CONFIG_DIR` or `CODEX_HOME`), or the directory this app runs from — the
 *    reset's own anchor (`scripts/lib/safe-remove.mjs`' `trustedAnchor`, W4.124), which compares
 *    what folders ARE (device and file id, both of macOS's spellings), never how they are spelled;
 *  - a folder that holds another workspace, or is inside one — the default, this one, a listed one
 *    (W4.155: where each listed folder IS, every link followed, never only how the list spells it),
 *    or any folder above or below it with a sign of one — or another disk mounted inside it.
 *
 * ⚑ **Its pasted pictures go with it**: `<folder>-pasted-images`, a sibling only that workspace ever
 * sweeps, which would otherwise stay on the disk for good — when it holds nothing but BroBot's own
 * pasted pictures.
 */

/** BroBot's own names at the top of a workspace — the reset's manifest, which a source census keeps
 * whole (`scripts/test/clean-base-without-running-it.test.mjs` §1). */
const BROBOTS_OWN = new Set(MANIFEST.map((entry) => entry.name))
/** The instructions BroBot writes into a workspace's working folder: not the person's. */
const INSTRUCTIONS = new Set(workspaceInstructionNames)
const BROBOTS_OWN_PARTS = [DRAFTS_PART, UPDATE_SETTINGS_PART, WORKSPACES_PART, GATE_PRIVATE]

/**
 * ⚑ **What the browser BroBot is built on writes at the top of its data folder** — Chromium's
 * profile, measured on a packaged launch of this build (`DevToolsActivePort` is a launch's with a
 * debugging port), and the names a profile gains once it
 * has been online (`clean-base.mjs`' note lists the ones measured in a person's folder). ⚠️ **A name not here refuses the delete**, by its name: a person reading it can
 * move it out, or delete the folder themselves. That is the safe way to be wrong.
 */
const THE_BROWSERS = new Set([
  'Cache',
  'Code Cache',
  'Cookies',
  'Cookies-journal',
  'Crashpad',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'DevToolsActivePort',
  'DIPS',
  'DIPS-journal',
  'DIPS-wal',
  'Dictionaries',
  'GPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'IndexedDB',
  'Local State',
  'Local Storage',
  'Network',
  'Network Persistent State',
  'Partitions',
  'Preferences',
  'Service Worker',
  'Session Storage',
  'Shared Dictionary',
  'SharedStorage',
  'SharedStorage-wal',
  'ShaderCache',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'VideoDecodeStats',
  'WebStorage',
  'blob_storage',
  'databases',
  'lockfile',
])

/**
 * A file Chromium writes whole through a temporary one (`.<app id>.XXXXXX`, renamed into place): a
 * crash inside the write leaves it.
 */
const THE_BROWSERS_PARTS = [
  /^\.(com\.brobot2\.desktop|org\.chromium\.Chromium|com\.github\.Electron)\.\w{6}$/,
]

/** What a system leaves in a folder nobody put there — and macOS's `._` twins on a disk of another kind. */
const THE_SYSTEMS = new Set([
  '.DS_Store',
  '.localized',
  '.apdisk',
  'Icon\r',
  'Thumbs.db',
  'desktop.ini',
])
const isTheSystems = (name: string): boolean => THE_SYSTEMS.has(name) || name.startsWith('._')

const isBroBotsOwn = (name: string): boolean =>
  BROBOTS_OWN.has(name) || BROBOTS_OWN_PARTS.some((part) => part.test(name))
const isTheBrowsers = (name: string): boolean =>
  THE_BROWSERS.has(name) || THE_BROWSERS_PARTS.some((part) => part.test(name))

/** What the delete is checked against: the app's facts, handed in so a test can give its own. */
export interface DeleteContext {
  /** The list's folders, as it spells them. */
  readonly listed: readonly string[]
  /** The folder this window runs on, and the default one. */
  readonly thisOne: string
  readonly defaultFolder: string
  /** ⛔ The account's home and environment: the folders no delete may touch are read from them. */
  readonly home: string
  readonly env: NodeJS.ProcessEnv
  /** The directory this app runs from: never taken with a folder. */
  readonly cwd: string
  readonly platform: NodeJS.Platform
  /** Whether a BroBot runs on a folder now: its gate, asked. */
  readonly ask: (folder: string) => Promise<'open' | 'closed' | 'unknown'>
  /** A refusal for a folder this launch may not touch (a hidden launch's), or `null`. */
  readonly outOfReach: (folder: string) => string | null
}

/** A verdict, with what the delete itself needs: the list's spelling, and the folder's identity. */
type Checked =
  | (Extract<WorkspaceDeleteVerdict, { ok: true }> & {
      readonly listedAs: string
      /** Every row of the list that is this folder: its own, and any other spelling of it. */
      readonly rows: readonly string[]
      readonly identity: string
    })
  | Extract<WorkspaceDeleteVerdict, { ok: false }>

const refused = (refusal: string): Extract<WorkspaceDeleteVerdict, { ok: false }> => ({
  ok: false,
  refusal,
})

/** How long a folder is waited on to say what it is: a share that is gone never answers. */
const IDENTITY_WAIT_MS = 3_000

/**
 * The lookups still running, by what they ask. ⛔ **A lookup that is no longer waited on still
 * runs**: on a share that has gone dead it holds one of Node's four file threads until the system
 * gives up, and a second ask of the same folder would hold another — two deletes would leave the
 * main process's file work queued behind them. So an ask of a folder already being asked waits on
 * that lookup again, and starts none.
 */
const stillAsking = new Map<string, Promise<unknown>>()

/** `ask()`, shared with any ask of the same `key` still running, and waited on for a while at most. */
async function askedOnce<T>(key: string, ask: () => Promise<T>, late: T): Promise<T> {
  let asking = stillAsking.get(key) as Promise<T> | undefined
  if (asking === undefined) {
    const started = ask()
    asking = started
    stillAsking.set(key, started)
    void started.then(() => stillAsking.delete(key))
  }
  let timer: NodeJS.Timeout | undefined
  const waited = new Promise<T>((settle) => {
    timer = setTimeout(() => settle(late), IDENTITY_WAIT_MS)
  })
  try {
    return await Promise.race([asking, waited])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * What `path` is — device and 64-bit file id — asked without blocking, and waited on for a few
 * seconds at most; `null` when it cannot say (not there, no answer, or a disk with no file ids).
 */
async function identityOf(path: string, fresh = false): Promise<string | null> {
  return askedOnce(
    // ⚑ The last ask before the Trash joins no lookup started earlier: it reads the disk now.
    `${fresh ? 'stat-now' : 'stat'}:${path}`,
    () =>
      stat(path, { bigint: true }).then(
        (seen) => (seen.ino === 0n ? null : `${String(seen.dev)}:${String(seen.ino)}`),
        () => null,
      ),
    null,
  )
}

/**
 * 🔴 **W4.155 · where a listed workspace is on the disk**: its real path, every link followed
 * (`realpath(3)`, as `trustedAnchor` asks), asked without blocking and waited on for a few seconds
 * at most. `null` when it is not there — nothing of it can be taken — and `undefined` when it does
 * not answer.
 */
async function whereItIs(folder: string): Promise<string | null | undefined> {
  return askedOnce<string | null | undefined>(
    `realpath:${folder}`,
    () =>
      realpath(folder).then(
        (real) => real,
        (error: NodeJS.ErrnoException) => {
          // ⚑ A path that leads to no folder — gone, through a file, a loop, or too long to be one.
          if (['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'].includes(error.code ?? '')) return null
          // ⚑ Windows' `realpath` refuses some drives that are there (a RAM disk, a cloud drive's):
          // the folder is, and its identity says which, under the spelling it has.
          if (error.code === 'EISDIR') return resolve(folder)
          return undefined
        },
      ),
    undefined,
  )
}

/**
 * The list's own spelling of `asked`: exactly as asked, or as BroBot would be started on it; else
 * by spelling with case folded where disks usually fold it — confirmed by what the folders are, for
 * a disk that does not — else by what the folders are, each asked without blocking and for a few
 * seconds at most, so a listed folder on a share that is gone holds up no window.
 */
async function listedSpelling(asked: string, listed: readonly string[]): Promise<string | null> {
  const started = asStartedOn(asked)
  const exactly = listed.find((one) => one === asked || one === started)
  if (exactly !== undefined) return exactly
  const folded = listed.find((one) => samePath(one, asked) || samePath(one, started))
  if (folded !== undefined) return sameFolder(folded, asked) ? folded : null
  const it = await identityOf(asked)
  if (it === null) return null
  for (const one of listed) if ((await identityOf(one)) === it) return one
  return null
}

/**
 * Whether a browser holds `folder` now, by Chromium's own lock (`SingletonLock`, a link to
 * `<host>-<pid>`), which every running BroBot takes before anything else. ⚑ On macOS and Linux;
 * Windows keeps no such link.
 */
function aBrowserHolds(folder: string): 'open' | 'closed' | { unknown: string } {
  let said: string
  try {
    said = readlinkSync(join(folder, 'SingletonLock'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'closed'
    return {
      unknown:
        'BroCrew cannot read this workspace’s lock, so it cannot tell whether it is open. If nothing has it open, delete the folder yourself.',
    }
  }
  const named = /^(.*)-(\d+)$/.exec(said)
  const pid = Number(named?.[2])
  if (named === null || !Number.isSafeInteger(pid) || pid <= 0) {
    return {
      unknown:
        'BroCrew cannot read this workspace’s lock, so it cannot tell whether it is open. If nothing has it open, delete the folder yourself.',
    }
  }
  // ⚑ A lock another computer took — a folder on a disk two share, or one copied from another.
  if (named[1] !== hostname()) {
    return {
      unknown: `This workspace was last opened on another computer (${named[1]}), and BroCrew cannot tell whether it is open there. If it is not, delete the folder yourself.`,
    }
  }
  try {
    process.kill(pid, 0)
    return 'open'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'closed' : 'open'
  }
}

/**
 * Whether a BroBot runs on `folder` now: a refusal when one does, or when nothing can say.
 *
 * ⛔ **A silent gate is not proof**: the gate fails open — a BroBot runs on when it could not make
 * its socket (a disk that cannot hold one, a path too long for it, a check of its own that came too
 * late) — so off Windows, Chromium's lock is read whenever the gate did not answer, and a lock that
 * names a live process, or one this computer cannot read, refuses too.
 */
async function runsOn(folder: string, context: DeleteContext): Promise<string | null> {
  const gate = await context.ask(folder)
  const lock = gate !== 'open' && context.platform !== 'win32' ? aBrowserHolds(folder) : null
  if (gate === 'open' || lock === 'open') {
    return 'This workspace is open. Quit it first, then delete it.'
  }
  if (lock !== null && lock !== 'closed') return lock.unknown
  if (gate === 'unknown' && lock === null) {
    return 'BroCrew cannot tell whether this workspace is open. Quit it if it is, then try again.'
  }
  return null
}

/** The anchor's names for the folders it guards, in a person's words. */
const PLAIN_WORDS: readonly (readonly [string | RegExp, string])[] = [
  ['your home directory', 'your home folder'],
  ["the machine's conventional Claude home", 'Claude’s own folder'],
  ["the machine's conventional Codex home", 'Codex’s own folder'],
  [
    'the CLAUDE_CONFIG_DIR this shell redirects to',
    'the folder Claude is set to keep its files in',
  ],
  ['the CODEX_HOME this shell redirects to', 'the folder Codex is set to keep its files in'],
  ['the directory this was run from', 'the folder BroCrew runs from'],
  ['is, or contains,', 'is, or holds,'],
  [' contains ', ' holds '],
  [/is owned by uid \d+, not by uid \d+/g, 'belongs to another account'],
  ['resolves to the filesystem root', 'is the top of the disk'],
  ['could not be resolved', 'could not be read'],
]

/**
 * Why the anchor refused `folder`, as a sentence for a person: `This folder …`. ⚑ The anchor names
 * the folder as the disk spells it, so that spelling is the one replaced.
 */
function inPlainWords(why: string, folder: string): string {
  let real = folder
  try {
    real = realpathSync.native(folder)
  } catch {
    // The anchor could not read it either, and says so.
  }
  let said = why.startsWith(`${real} `) ? `This folder ${why.slice(real.length + 1)}` : why
  // ⚑ The words, never the folder a sentence names: its path, in brackets at the end, stays as it is.
  const named = /\s\((\/|[A-Za-z]:\\).*\)$/.exec(said)
  const path = named === null ? '' : said.slice(named.index)
  said = named === null ? said : said.slice(0, named.index)
  for (const [from, to] of PLAIN_WORDS) said = said.replaceAll(from, to)
  return `${said.replace(/^the target /, 'This folder ')}${path}.`
}

/** Where `real` stands against a workspace that is never deleted: a refusal, or `null`. */
function againstAWorkspace(real: string, folder: string, what: string): string | null {
  const where = whereItStands(real, folder)
  if (where === undefined) return `BroCrew cannot compare this folder with ${what} (${folder}).`
  if (where === 'is') return `This folder is ${what}.`
  if (where === 'holds') return `This folder holds ${what}: ${folder}`
  if (where === 'inside') return `This folder is inside ${what}: ${folder}`
  return null
}

/**
 * What the folder holds, read without following a link and without blocking: its size, or a
 * refusal — a folder below it with a sign of a workspace, another disk mounted inside it, or a part
 * it cannot read.
 */
async function whatItHolds(
  root: string,
  device: bigint,
): Promise<
  { bytes: number; files: number; workingFiles: number; exports: number } | { refusal: string }
> {
  let bytes = 0
  let files = 0
  let workingFiles = 0
  let exports = 0
  const working = join(root, WORKSPACE_DIRNAME)
  const exported = join(root, EXPORTS_DIRNAME)
  const folders = [root]
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    let names: string[]
    try {
      names = await readdir(folder)
    } catch {
      return { refusal: `BroCrew cannot read part of this folder: ${folder}` }
    }
    if (folder !== root && names.some((name) => BROBOT_FOLDER_SIGNS.includes(name))) {
      return { refusal: `This folder holds another workspace: ${folder}` }
    }
    for (const name of names) {
      const path = join(folder, name)
      let seen
      try {
        seen = await lstat(path, { bigint: true })
      } catch (error) {
        // ⚑ Gone since it was listed: a browser's temporary file.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        return { refusal: `BroCrew cannot read part of this folder: ${path}` }
      }
      if (seen.isDirectory()) {
        if (seen.dev !== device) {
          return { refusal: `Another disk is mounted inside this folder: ${path}` }
        }
        folders.push(path)
      } else {
        files += 1
        bytes += Number(seen.size)
        // ⚑ What the person's conversations made, beside the instructions BroBot writes there.
        const its = folder === working && INSTRUCTIONS.has(name)
        if (isAncestor(working, path) && !its) workingFiles += 1
        if (isAncestor(exported, path)) exports += 1
      }
    }
  }
  return { bytes, files, workingFiles, exports }
}

/**
 * Its pasted pictures' folder, when it goes with it: there, a real folder of this account's, and
 * holding nothing but BroBot's pasted pictures. Else `null`, and a warning when one is there but
 * holds something else.
 */
async function itsPastedImages(
  real: string,
  uid: number | null,
): Promise<{ folder: string | null; bytes: number; files: number; warning: string | null }> {
  const folder = pastedImagesRoot(real)
  let seen
  try {
    seen = await lstat(folder)
  } catch {
    return { folder: null, bytes: 0, files: 0, warning: null }
  }
  const stays = {
    folder: null,
    bytes: 0,
    files: 0,
    warning: `Its pasted pictures’ folder holds something else, so it stays: ${folder}`,
  }
  if (!seen.isDirectory() || (uid !== null && seen.uid !== uid)) return stays
  try {
    let bytes = 0
    const names = await readdir(folder)
    for (const name of names) {
      if (!isPastedImageName(name) && !PASTED_PART.test(name) && !isTheSystems(name)) return stays
      const one = await lstat(join(folder, name))
      if (!one.isFile()) return stays
      bytes += one.size
    }
    return { folder, bytes, files: names.length, warning: null }
  } catch {
    return stays
  }
}

/** The account this app runs as, where the system has one. */
const thisAccount = (): number | null =>
  typeof process.getuid === 'function' ? process.getuid() : null

/**
 * 🔴 **Whether `asked` may be deleted, and what would go** — every refusal in words, and for a
 * folder that may go, its size and its pasted pictures' folder. See this module's note for the
 * rules, in the order they are asked.
 */
async function check(asked: string, context: DeleteContext): Promise<Checked> {
  // ⚑ The two that are never deleted are named first, listed or not (a hidden launch lists none).
  if (sameFolder(asked, context.thisOne)) {
    return refused('This is the workspace this window runs on.')
  }
  if (sameFolder(asked, context.defaultFolder)) {
    return refused('The Default workspace cannot be deleted.')
  }
  const listedAs = await listedSpelling(asked, context.listed)
  if (listedAs === null) return refused(`This folder is not in the list of workspaces: ${asked}`)
  if (sameFolder(listedAs, context.thisOne)) {
    return refused('This is the workspace this window runs on.')
  }
  if (sameFolder(listedAs, context.defaultFolder)) {
    return refused('The Default workspace cannot be deleted.')
  }
  const outside = context.outOfReach(listedAs)
  if (outside !== null) return refused(outside)

  // ⛔ The reset's own anchor: not a home, not a provider's folder, nothing that holds one.
  const anchor = trustedAnchor(listedAs, {
    home: context.home,
    env: context.env,
    cwd: context.cwd,
    repoRoot: null,
  }) as { kind: 'trusted'; real: string } | { kind: 'absent' } | { kind: 'refused'; why: string }
  if (anchor.kind === 'absent') {
    return refused(`Not found — ${listedAs}. Remove it from the list instead.`)
  }
  if (anchor.kind === 'refused') return refused(inPlainWords(anchor.why, listedAs))
  const { real } = anchor

  // ⛔ Never with the default workspace or this one, by what the folders are.
  for (const [folder, what] of [
    [context.defaultFolder, 'the Default workspace'],
    [context.thisOne, 'the workspace this window runs on'],
  ] as const) {
    const theirs = await whereItIs(folder)
    if (theirs === null) continue
    if (theirs === undefined) return refused(`BroCrew cannot reach ${what} (${folder}) to compare.`)
    const refusal = againstAWorkspace(real, theirs, what)
    if (refusal !== null) return refused(refusal)
  }
  // ⛔ …nor with a listed one: by its spelling, and — W4.155 — by where it is. A list can hold a
  // workspace only by a link to it, and then its spelling says nothing about the folder it leads to:
  // `real/brobot-workspace/inner`, with `link → real` listed, was accepted and its outer workspace's
  // working folder lost a part. So every listed folder is followed to where it is, and compared with
  // this one by what the folders ARE (`whereItStands`: device and file id, both of macOS's
  // spellings — W4.117, W4.124). ⚠️ The lookup is waited on for a few seconds at most; the
  // comparison after it reads the folder and the ones above it directly, as the reset's does — a
  // share that answers the lookup and then stalls can hold the window while it is compared.
  // ⚑ Every row that is this same folder, by another spelling: each is asked whether it is open,
  // and each leaves the list with it.
  const rows = [listedAs]
  for (const other of context.listed) {
    // ⛔ Its own row by its exact spelling only: a row spelled like it, case or `..` aside, may lead
    // somewhere else, and is followed like any other.
    if (other === listedAs) continue
    if ([listedAs, real].some((spelling) => insideBySpelling(other, spelling, context.platform))) {
      return refused(`This folder holds the workspace ${other}.`)
    }
    if ([listedAs, real].some((spelling) => insideBySpelling(spelling, other, context.platform))) {
      return refused(`This folder is inside the workspace ${other}.`)
    }
    const otherReal = await whereItIs(other)
    // ⚑ Not there: nothing of it can be taken.
    if (otherReal === null) continue
    // ⛔ One that does not answer cannot be ruled out: the delete waits for it, or for its row to go.
    if (otherReal === undefined) {
      return refused(
        `BroCrew cannot reach the workspace ${other} to make sure this folder is not part of it. If that workspace is gone, remove it from the list, then try again.`,
      )
    }
    const where = whereItStands(real, otherReal)
    if (where === undefined) {
      return refused(`BroCrew cannot compare this folder with the workspace ${other}.`)
    }
    if (where === 'is') rows.push(other)
    if (where === 'holds') return refused(`This folder holds the workspace ${other}.`)
    if (where === 'inside') return refused(`This folder is inside the workspace ${other}.`)
  }
  // ⛔ …nor inside any workspace at all, listed or not: a folder above it, on the disk, with a sign
  // of one — the walk A2's open asks of a folder (`checkWorkspaceFolder`).
  for (let above = dirname(real); ; above = dirname(above)) {
    if (isBroBotsFolder(above)) return refused(`This folder is inside the workspace ${above}.`)
    if (dirname(above) === above) break
  }

  // ⛔ Not while it runs — asked before what it holds, so an open one is told so: by every row it
  // has, since Windows' gate is named by the spelling it was opened by.
  for (const row of rows) {
    const running = await runsOn(row, context)
    if (running !== null) return refused(running)
  }

  // ⛔ BroBot's, and nothing at its top that BroBot or its browser did not write.
  let names: string[]
  try {
    names = await readdir(real)
  } catch (error) {
    return refused(`BroCrew cannot read this folder: ${(error as Error).message}`)
  }
  const strangers = names.filter(
    (name) => !isBroBotsOwn(name) && !isTheBrowsers(name) && !isTheSystems(name),
  )
  if (strangers.length > 0) {
    const named = strangers.sort().slice(0, 5).join(', ')
    const more = strangers.length > 5 ? `, and ${String(strangers.length - 5)} more` : ''
    return refused(
      `This folder holds files BroCrew did not write: ${named}${more}. Move them out first, or delete the folder yourself.`,
    )
  }
  if (!names.some((name) => BROBOT_FOLDER_SIGNS.includes(name) || name === 'workspace.json')) {
    return refused('This folder holds nothing of BroCrew’s. Remove it from the list instead.')
  }

  // ⛔ Which folder it is, so the one moved is the one checked: a disk that cannot say is refused.
  const identity = await identityOf(real)
  if (identity === null) {
    return refused(
      'BroCrew cannot tell this folder apart from another on its disk, so it deletes nothing. Delete it yourself.',
    )
  }
  let device: bigint
  try {
    device = (await lstat(real, { bigint: true })).dev
  } catch {
    return refused(`Not found — ${listedAs}. Remove it from the list instead.`)
  }
  const held = await whatItHolds(real, device)
  if ('refusal' in held) return refused(held.refusal)
  const pasted = await itsPastedImages(real, thisAccount())
  return {
    ok: true,
    path: real,
    bytes: held.bytes + pasted.bytes,
    files: held.files + pasted.files,
    workingFiles: held.workingFiles,
    exports: held.exports,
    pastedImages: pasted.folder,
    warning: pasted.warning,
    listedAs,
    rows,
    identity,
  }
}

/** Where a deleted folder goes, by the name its system gives the place. */
export function whereDeletedFoldersGo(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'the Recycle Bin' : 'the Trash'
}

/** 🔴 **Whether `asked` may be deleted, and what would go** — for the confirmation. */
export async function deleteVerdict(
  asked: string,
  context: DeleteContext,
): Promise<WorkspaceDeleteVerdict> {
  const checked = await check(asked, context)
  if (!checked.ok) return checked
  const { path, bytes, files, workingFiles, exports, pastedImages, warning } = checked
  return { ok: true, path, bytes, files, workingFiles, exports, pastedImages, warning }
}

/**
 * 🔴 **Delete `asked`**: every check again, the gate asked once more just before, then its folder
 * to the Trash, its pasted pictures' folder after it, and its row off the list.
 *
 * ⛔ **The Trash or nothing**: a folder the Trash will not take stays where it is, and the answer
 * says so — nothing here removes a file. ⚠️ A BroBot that starts on the folder between the last ask
 * and the move keeps running from the Trash; the folder is put back from there.
 */
export async function deleteWorkspace(
  asked: string,
  context: DeleteContext & {
    /** Move a folder to the system's Trash (`shell.trashItem`). */
    readonly trash: (folder: string) => Promise<void>
    readonly listFile: string
    readonly now: number
  },
): Promise<WorkspaceDeleted> {
  const checked = await check(asked, context)
  if (!checked.ok) return { deleted: false, refusal: checked.refusal }
  for (const row of checked.rows) {
    const running = await runsOn(row, context)
    if (running !== null) return { deleted: false, refusal: running }
  }
  const identity = await identityOf(checked.path, true)
  if (identity === null) {
    return { deleted: false, refusal: 'BroCrew cannot reach this folder now. Try again.' }
  }
  if (identity !== checked.identity) {
    return { deleted: false, refusal: 'This folder changed while BroCrew checked it. Try again.' }
  }
  try {
    await context.trash(checked.path)
  } catch (error) {
    return {
      deleted: false,
      refusal: `BroCrew could not move this folder to ${whereDeletedFoldersGo(context.platform)}, so nothing was deleted: ${(error as Error).message}`,
    }
  }
  const trashed = [checked.path]
  const warnings = checked.warning === null ? [] : [checked.warning]
  // ⚑ Asked again just before it goes, as the folder was.
  const pasted =
    checked.pastedImages === null
      ? null
      : (await itsPastedImages(checked.path, thisAccount())).folder
  if (checked.pastedImages !== null && pasted === null) {
    warnings.push(`Its pasted pictures’ folder changed, so it stays: ${checked.pastedImages}`)
  }
  if (pasted !== null) {
    try {
      await context.trash(pasted)
      trashed.push(pasted)
    } catch (error) {
      warnings.push(
        `Its pasted pictures’ folder stays: ${checked.pastedImages} (${(error as Error).message})`,
      )
    }
  }
  try {
    // ⚑ Every spelling it was asked and listed by: none would be anything but a missing row.
    for (const spelling of new Set([...checked.rows, asked, checked.path])) {
      forgetWorkspace(context.listFile, spelling, context.now)
    }
  } catch (error) {
    warnings.push(
      `It is in ${whereDeletedFoldersGo(context.platform)}, but BroCrew could not take it off its list: ${(error as Error).message}`,
    )
  }
  return { deleted: true, trashed, warning: warnings.length > 0 ? warnings.join(' ') : null }
}
