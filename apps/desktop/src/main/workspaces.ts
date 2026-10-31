import { PACKAGED_WORKSPACE_LIST } from './workspace-routing'
import {
  packagedWorkspaceIsForbidden,
  routingWarning,
  WORKSPACE_POLICY_FILE,
} from './workspace-routing-store'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { WorkspaceFolderVerdict, WorkspaceRow, WorkspaceState } from '../shared/workspaces'
import {
  DATA_FOLDER,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_FILE,
  WORKSPACE_NAME_MAX,
} from './data-folder'
import { gateFits } from './one-host-gate'
import { keepToThisUser, NotKeptToThisUser, type AccessLists } from './recovery/windows-privacy'
import { PROVIDER_HOMES_DIRNAME } from './runtime/provider-homes'
import { insideBySpelling, samePath } from './same-folder'

/**
 * Packaged and development builds keep separate lists beside their workspaces. Hidden copies
 * keep a private list. Explicit restarts keep their folder; a packaged Finder launch can reopen
 * its last workspace without inspecting other workspace contents.
 */

/** One workspace in the list file. */
export interface ListedWorkspace {
  readonly path: string
  readonly lastOpenedAt: number
}

/** Where the list is: beside the default folder for a person's launch; a hidden one keeps its own. */
export function workspaceListFile(where: {
  readonly appData: string
  readonly userData: string
  readonly hidden: boolean
  readonly packaged?: boolean
}): string {
  return where.hidden
    ? join(where.userData, 'workspaces.json')
    : join(
        where.appData,
        DATA_FOLDER[0],
        where.packaged ? PACKAGED_WORKSPACE_LIST : 'workspaces.json',
      )
}

/** The newest list format this build writes; a newer one is left as it is. */
const LIST_VERSION = 1

/** A list file's rows as they were read — any field this build does not know is kept. */
type ListRow = ListedWorkspace & Record<string, unknown>

/** The rows of a list's parsed JSON that name a folder and a time. */
function rowsOf(said: unknown): ListRow[] {
  const rows =
    typeof said === 'object' && said !== null ? (said as { workspaces?: unknown }).workspaces : null
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (row: unknown): row is ListRow =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as { path?: unknown }).path === 'string' &&
      (row as { path: string }).path !== '' &&
      typeof (row as { lastOpenedAt?: unknown }).lastOpenedAt === 'number',
  )
}

/** The workspaces a list's parsed JSON names, for a reader that did its own reading. */
export function workspacesIn(said: unknown): ListedWorkspace[] {
  return rowsOf(said).map(({ path, lastOpenedAt }) => ({ path, lastOpenedAt }))
}

/** The list in `file`, for the chooser: nothing for a file that is not there or not one it can read. */
export function readWorkspaceList(file: string): ListedWorkspace[] {
  try {
    return rowsOf(JSON.parse(readFileSync(file, 'utf8'))).map(({ path, lastOpenedAt }) => ({
      path,
      lastOpenedAt,
    }))
  } catch {
    return []
  }
}

/**
 * The list in `file`, to be written again. ⛔ Only "not there" or "not JSON" is an empty list: a
 * file that cannot be read now (antivirus holding it) or one in a newer format throws, so it is
 * never overwritten with one row.
 */
function readToRewrite(file: string): ListRow[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let said: unknown
  try {
    said = JSON.parse(text)
  } catch {
    return []
  }
  const version =
    typeof said === 'object' && said !== null ? (said as { version?: unknown }).version : undefined
  if (typeof version === 'number' && version > LIST_VERSION) {
    throw new Error(`the workspace list is a newer one (version ${String(version)})`)
  }
  return rowsOf(said)
}

/**
 * Write `content` to `file` whole: through a temporary file of this process's own, renamed over it,
 * so two writers can lose a change but never tear the file; one that fails takes its temporary
 * file with it.
 */
function writeWhole(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, content)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** A temporary file a write left (a kill inside it) is taken away after this long. */
const STALE_TEMPORARY_MS = 60_000

function writeWorkspaceList(file: string, workspaces: readonly ListRow[], now: number): void {
  writeWhole(file, `${JSON.stringify({ version: LIST_VERSION, workspaces }, null, 2)}\n`)
  const name = basename(file)
  try {
    for (const entry of readdirSync(dirname(file))) {
      if (!entry.startsWith(`${name}.`) || !/\.\d+\.tmp$/.test(entry)) continue
      const left = join(dirname(file), entry)
      if (now - statSync(left).mtimeMs > STALE_TEMPORARY_MS) rmSync(left, { force: true })
    }
  } catch {
    // A leftover that cannot be taken away now is taken at the next write.
  }
}

/**
 * `folder` as BroBot is started on it, so the list spells it as the BroBot there will: on macOS and
 * Linux, every link resolved, as Chromium resolves `--user-data-dir` (`/tmp/x` reads
 * `/private/tmp/x`). ⚑ On Windows as it is: a mapped drive resolved would read as a network path,
 * and the gate's pipe is named by the spelling.
 */
export function asStartedOn(folder: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return folder
  try {
    return realpathSync.native(folder)
  } catch {
    return folder
  }
}

/**
 * 🔴 **A person's launch puts its own folder first in the list**, with now as when it was opened.
 * ⚑ Matched by spelling only ({@link samePath}): it reads no other listed folder, so it cannot wait
 * on one. ⚑ Called once the launch runs, never before; a list it cannot write leaves the launch as
 * it is (the caller logs it).
 */
export function rememberWorkspace(file: string, path: string, now: number): void {
  if (
    basename(file) === PACKAGED_WORKSPACE_LIST &&
    packagedWorkspaceIsForbidden(dirname(dirname(file)), path)
  ) {
    routingWarning(
      'forbidden-workspace-write',
      file,
      path,
      join(dirname(file), WORKSPACE_POLICY_FILE),
    )
    return
  }
  const others = readToRewrite(file).filter((one) => !samePath(one.path, path))
  writeWorkspaceList(file, [{ path, lastOpenedAt: now }, ...others], now)
}

/** Take `path` off the list. Its folder is left as it is. */
export function forgetWorkspace(file: string, path: string, now: number): void {
  writeWorkspaceList(
    file,
    readToRewrite(file).filter((one) => !samePath(one.path, path)),
    now,
  )
}

/**
 * ⚑ **What makes a folder a BroBot workspace**: a database, a provider home, its own working folder
 * or its gate — the signs `scripts/lib/clean-base.mjs` reads a nested data folder by
 * (`NESTED_USERDATA_SIGNS`), and a test holds the two lists in step.
 */
export const BROBOT_FOLDER_SIGNS = Object.freeze([
  'skills-conversion.json',
  'brobot2.sqlite',
  'brobot2.sqlite-wal',
  'brobot2.sqlite-shm',
  'brobot2.sqlite-journal',
  'brobot-workspace',
  PROVIDER_HOMES_DIRNAME,
  'one-host.sock',
])

/** Whether `folder` is a BroBot workspace. */
export function isBroBotsFolder(folder: string): boolean {
  return BROBOT_FOLDER_SIGNS.some((sign) => existsSync(join(folder, sign)))
}

/**
 * What a folder may hold and still be empty: what an OS leaves in a folder nobody used — and the
 * name and starting look a new workspace was given before it first started, so one whose start
 * failed can be opened.
 */
function isNothingOfAnyones(entry: string): boolean {
  return (
    entry === '.DS_Store' ||
    entry === 'Thumbs.db' ||
    entry === 'desktop.ini' ||
    entry === WORKSPACE_FILE ||
    /^workspace\.json\.\d+\.tmp$/.test(entry) ||
    entry === 'active-theme.json' ||
    /^active-theme\.json\.\d+\.[0-9a-f-]+\.tmp$/.test(entry)
  )
}

/** `path` as the disk has it: its nearest existing folder resolved through every link, and the rest. */
function onTheDisk(path: string): string {
  let existing = path
  const rest: string[] = []
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  try {
    return join(realpathSync(existing), ...rest)
  } catch {
    return path
  }
}

/** A folder a cloud service syncs: its database would be copied while BroBot writes it. */
const CLOUD_SYNCED =
  /[\\/]Library[\\/](Mobile Documents|CloudStorage)[\\/]|[\\/](OneDrive|Dropbox|Google Drive|iCloud Drive)( - [^\\/]+| \([^\\/]+\))?([\\/]|$)/i

/**
 * 🔴 **Whether `folder` may be a workspace** — opened, or made for a new one:
 *  - it is a BroBot workspace already, or it is empty (or not there yet, when `toMake`) — so BroBot
 *    never fills somebody's `Documents` with its files;
 *  - ⛔ it is not inside another workspace — the nested data folder `clean-base` refuses on — read
 *    on the disk, through links, up to and including the root; nor inside a listed one, by its
 *    spelling as asked and as it is on the disk, so no listed folder is read: one on a share that
 *    is gone cannot hold the window up;
 *  - ⛔ not a network share (`\\server\share`): SQLite cannot keep a database whole on one, and the
 *    gate guards one computer only;
 *  - ⚑ warned, not refused: a gate whose socket names are longer than the system allows, wherever
 *    the gate is kept (the folder still opens, without the backstop against a second BroBot
 *    starting on it at the same moment), and a folder a cloud service syncs.
 */
export function checkWorkspaceFolder(
  folder: string,
  options: {
    readonly toMake: boolean
    readonly listed: readonly string[]
    readonly platform: NodeJS.Platform
  },
): WorkspaceFolderVerdict {
  const path = resolve(folder)
  let exists = false
  let isDirectory = false
  try {
    const seen = statSync(path)
    exists = true
    isDirectory = seen.isDirectory()
  } catch {
    // Not there.
  }
  const isBroBots = isDirectory && isBroBotsFolder(path)
  const real = onTheDisk(path)
  const warnings = [
    !gateFits(real, options.platform)
      ? 'This folder’s path is long: BroCrew opens it, but cannot stop a second copy of BroCrew from starting on it at the same moment.'
      : null,
    CLOUD_SYNCED.test(real)
      ? 'A cloud service syncs this folder: BroCrew’s database may be copied while it is being written.'
      : null,
  ].filter((one): one is string => one !== null)
  const verdict = (refusal: string | null): WorkspaceFolderVerdict => ({
    path,
    ok: refusal === null,
    refusal,
    warning: refusal === null && warnings.length > 0 ? warnings.join(' ') : null,
    exists,
    isBroBots,
  })
  if (options.platform === 'win32' && /^[\\/]{2}/.test(folder)) {
    return verdict('A workspace cannot be on a network share. Choose a folder on this computer.')
  }
  if (exists && !isDirectory) return verdict(`This is a file, not a folder: ${path}`)
  if (!exists && !options.toMake) return verdict(`Not found — ${path}`)
  // ⛔ Every folder above it, on the disk, up to and including the root.
  for (let above = dirname(real); ; above = dirname(above)) {
    if (isBroBotsFolder(above)) return verdict(`This folder is inside the workspace ${above}.`)
    if (dirname(above) === above) break
  }
  const inside = options.listed.find((one) =>
    [path, real].some((spelling) => insideBySpelling(spelling, one, options.platform)),
  )
  if (inside !== undefined) return verdict(`This folder is inside the workspace ${inside}.`)
  if (exists && !isBroBots) {
    let entries: string[]
    try {
      entries = readdirSync(path)
    } catch (error) {
      return verdict(`BroCrew cannot read this folder: ${(error as Error).message}`)
    }
    if (entries.some((entry) => !isNothingOfAnyones(entry))) {
      return verdict(
        'This folder has files in it. A workspace is a folder of its own: choose an empty one, or a BroCrew workspace.',
      )
    }
  }
  return verdict(null)
}

/** A name as a person typed it, made one that may be shown: `null` when nothing is left. */
export function aWorkspaceName(typed: string): string | null {
  const shown = [...typed.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()]
    .slice(0, WORKSPACE_NAME_MAX)
    .join('')
  return shown === '' ? null : shown
}

/**
 * The names Windows keeps for devices, which no file or folder may have: Windows reads the name
 * before its first dot, so `nul.txt` is `nul`.
 */
const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\..*)?$/i

/**
 * A name made a folder's name: no character a file system refuses, no trailing dot or space, none
 * of the names Windows keeps for devices, and short enough for any disk (100 bytes).
 */
function aFolderName(name: string): string {
  let safe = name
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  if (safe === '') return 'Workspace'
  if (RESERVED_ON_WINDOWS.test(safe)) safe = `Workspace ${safe}`
  while (Buffer.byteLength(safe) > 100) safe = [...safe].slice(0, -1).join('')
  return safe
}

/** Where new workspaces go unless the person chooses: `~/BroBot workspaces/`. */
export const NEW_WORKSPACES_FOLDER = 'BroBot workspaces'

/**
 * The folder a new workspace named `name` is offered: `<home>/BroBot workspaces/<name>`, or
 * `<name> 2`, `<name> 3`… when that one is taken (there, and not empty).
 */
export function folderForANewWorkspace(home: string, name: string): string {
  const base = join(home, NEW_WORKSPACES_FOLDER, aFolderName(name))
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base} ${String(n)}`
    if (!existsSync(candidate)) return candidate
    try {
      if (readdirSync(candidate).every(isNothingOfAnyones)) return candidate
    } catch {
      // Not a folder: the next name.
    }
  }
}

/**
 * Make a new workspace's folder, readable by this account only (as `~/Library` keeps the default
 * one), with its name in it: by its mode, and on Windows, where a mode means nothing, by its access
 * list, limited before anything is written in it. A folder that was there already, which a person
 * chose, keeps its permissions on every system; Settings says who else may read it. A folder made
 * here whose list could not be limited is still made, and why is returned for the log.
 */
export async function makeWorkspaceFolder(
  folder: string,
  name: string,
  options: { readonly lists?: AccessLists; readonly platform?: NodeJS.Platform } = {},
): Promise<string | null> {
  const made = mkdirSync(folder, { recursive: true, mode: 0o700 })
  let unlimited: string | null = null
  if (made !== undefined) {
    try {
      await keepToThisUser(folder, options.lists, options.platform)
    } catch (error) {
      unlimited = error instanceof NotKeptToThisUser ? error.reason : String(error)
    }
  }
  nameWorkspace(folder, name)
  return unlimited
}

/** Only the explicit create action may give a configured workspace its first database. */
export function createFirstWorkspaceDatabase(folder: string): void {
  writeFileSync(join(folder, 'brobot2.sqlite'), '', { flag: 'wx', mode: 0o600 })
}

/** Keep `name` as the workspace's own, in its folder (`workspace.json`). */
export function nameWorkspace(folder: string, name: string): void {
  writeWhole(join(folder, WORKSPACE_FILE), `${JSON.stringify({ name }, null, 2)}\n`)
}

/**
 * 🔴 **The arguments that open BroBot on `folder`** — built, never copied: the folder, and nothing
 * of this launch's own (no debugging port). ⚑ A development build is `electron <app> …`; a packaged
 * one is the app itself. ⚑ A hidden launch — a test — opens it hidden too, so no test ever puts a
 * window on a person's screen; a person's launch never passes a test's switch.
 */
export function argumentsToOpen(
  folder: string,
  how: { readonly packaged: boolean; readonly appPath: string; readonly hidden: boolean },
): string[] {
  return [
    ...(how.packaged ? [] : [how.appPath]),
    `--user-data-dir=${folder}`,
    ...(how.hidden ? ['--brobot-hidden'] : []),
  ]
}

/**
 * 🔴 **How to start it so it is nobody's child**: on macOS and Linux through `/bin/sh`, which starts
 * it in the background and leaves, so the system adopts it — a workspace is not this app's process,
 * and this app's memory watch must not count it as one of its agents. The executable and its
 * arguments are the shell's parameters, never its script, so nothing in a folder's name is run.
 * ⚑ Windows starts it directly (its memory watch reads no process tree).
 */
export function howToStart(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): { readonly command: string; readonly args: readonly string[] } {
  if (platform === 'win32') return { command: executable, args }
  return {
    command: '/bin/sh',
    args: ['-c', '"$0" "$@" </dev/null >/dev/null 2>&1 &', executable, ...args],
  }
}

/** The name `folder`'s own `workspace.json` gives, read without blocking; `null` for none. */
async function ownName(folder: string): Promise<string | null> {
  try {
    return ownNameIn(JSON.parse(await readFile(join(folder, WORKSPACE_FILE), 'utf8')) as unknown)
  } catch {
    return null
  }
}

/** The name a parsed `workspace.json` gives; `null` for none. */
export function ownNameIn(said: unknown): string | null {
  const name =
    typeof said === 'object' && said !== null ? (said as { name?: unknown }).name : undefined
  return typeof name === 'string' ? aWorkspaceName(name) : null
}

/**
 * The name a workspace goes by, as its chooser shows it: its own (`workspace.json`), else
 * `Default` for the default folder, else its folder's name.
 */
export async function workspaceNameOf(
  folder: string,
  isDefault: boolean,
  there = true,
  own: (folder: string) => Promise<string | null> = ownName,
): Promise<string> {
  const segment = aWorkspaceName(basename(resolve(folder)))
  return (
    (there ? await own(folder) : null) ?? (isDefault ? DEFAULT_WORKSPACE_NAME : (segment ?? folder))
  )
}

/** Whether `folder` is there, asked without blocking. */
async function isThere(folder: string): Promise<boolean> {
  try {
    await stat(folder)
    return true
  } catch {
    return false
  }
}

/**
 * 🔴 **The chooser's rows**: the listed workspaces, most recently opened first, and this one even
 * when it is not listed (a hidden launch's); each with its name, and whether it runs now — its
 * folder's gate asked (`ask`), or `missing` when its folder is gone. ⚑ Asked without blocking, so a
 * folder on a disk that does not answer holds up no window.
 */
export async function workspaceRows(options: {
  readonly listed: readonly ListedWorkspace[]
  readonly thisOne: string
  readonly defaultFolder: string
  readonly ask: (folder: string) => Promise<'open' | 'closed' | 'unknown'>
  /** What to tell the person about who else may read this workspace's data, or null. */
  readonly readersOfThisOne?: () => Promise<string | null>
}): Promise<WorkspaceRow[]> {
  const listed = [...options.listed].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const rows: { path: string; lastOpenedAt: number | null }[] = listed.some((one) =>
    samePath(one.path, options.thisOne),
  )
    ? listed
    : [{ path: options.thisOne, lastOpenedAt: null }, ...listed]
  return Promise.all(
    rows.map(async (row): Promise<WorkspaceRow> => {
      const isThisOne = samePath(row.path, options.thisOne)
      const isDefault = samePath(row.path, options.defaultFolder)
      const there = isThisOne || (await isThere(row.path))
      const state: WorkspaceState = isThisOne
        ? 'open'
        : !there
          ? 'missing'
          : await options.ask(row.path)
      const name = await workspaceNameOf(row.path, isDefault, there)
      const readers = isThisOne ? ((await options.readersOfThisOne?.()) ?? null) : null
      return {
        path: row.path,
        name,
        isDefault,
        isThisOne,
        state,
        lastOpenedAt: row.lastOpenedAt,
        readers,
      }
    }),
  )
}

/** Whether `path` is `folder` or inside it, on the disk (through links). */
export function isWithin(path: string, folder: string): boolean {
  const inner = onTheDisk(resolve(path))
  const outer = onTheDisk(resolve(folder))
  return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`)
}
