import {
  type FSWatcher,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  watch,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { writeAtomicallySync } from '../atomic-write'
import { withProviderHomeLock } from '../internal/provider-home'
import {
  NoCodexSignInOnThisComputerError,
  codexAccountOf,
  codexRefreshedAt,
  lstatOrNull,
  statOrNull,
} from './auth'

/**
 * One Codex sign-in per workspace: the one BroBot's own profile holds, which Settings shows. Every
 * other Codex home reads and renews that one file.
 *
 * Each agent's `auth.json` is a link to BroBot's own `auth.json`. Codex keeps the link when it
 * renews: it resolves the link, writes the target by rename, takes its commit lock beside the
 * target, and reloads the file before it renews, so a renewal one agent made is adopted by the
 * others instead of spent again (codex-rs `login/src/auth/storage_file.rs`, `storage_commit.rs`,
 * `manager.rs` `refresh_token_with_reason`, at 0.167.1).
 *
 * An agent's own earlier sign-in, whatever account it names, is never read as a source: it is
 * replaced. Where this computer refuses a link (Windows without Developer Mode or admin rights), a
 * home holds a copy of the workspace's sign-in, and every renewal Codex writes in one home is put
 * in the workspace's file and in the other homes at once. Codex reads the file again before it
 * renews, so the others take that renewal instead of spending the key again.
 */

const AUTH_FILE = 'auth.json'
const AUTH_FILE_MAX = 1024 * 1024

/**
 * The workspace's one sign-in, which every Codex home links to: a file of its own beside the homes,
 * so a key login or a sign-in under way in any home never touches it.
 */
function theWorkspaceSignIn(managedRoot: string): string {
  return join(managedRoot, 'codex-sign-ins', 'workspace', AUTH_FILE)
}

/** The file the workspace's sign-in is, behind any link; null while there is none. */
function theWorkspaceFile(managedRoot: string): string | null {
  try {
    return realpathSync(theWorkspaceSignIn(managedRoot))
  } catch {
    return null
  }
}

/** The account a sign-in's text names; null for none, or for an API key. */
function accountOfASignIn(text: string): string | null {
  const account = codexAccountOf(text)
  return account === 'api-key' ? null : account
}

/** The account the workspace is signed in to; null while it has none. */
function theWorkspaceAccount(managedRoot: string): string | null {
  const file = theWorkspaceFile(managedRoot)
  return file === null ? null : accountOfASignIn(readOrNull(file)?.toString('utf8') ?? '')
}

/** Whether this workspace keeps a Codex sign-in for its agents, by the file's presence alone. */
export function aCodexSignInIsKept(managedRoot: string): boolean {
  return statOrNull(theWorkspaceSignIn(managedRoot))?.isFile() === true
}

/** Whether a home holds the workspace's sign-in as a copy kept in step, for want of a link. */
export function codexSignInIsKeptAsAFile(providerHome: string, managedRoot: string): boolean {
  const dest = join(providerHome, AUTH_FILE)
  if (lstatOrNull(dest)?.isFile() !== true) return false
  const account = accountOfASignIn(readOrNull(dest)?.toString('utf8') ?? '')
  return account !== null && account === theWorkspaceAccount(managedRoot)
}

/** What {@link shareCodexSignIn} did to a home. */
type SharedSignInOutcome = 'joined' | 'unchanged'

/** How a home is put on a sign-in: a link, as `symlinkSync` makes one. Tests stand in for a refusal. */
type LinkMaker = (target: string, path: string) => void

interface ShareOptions {
  readonly managedRoot: string
  readonly ownHome: string
  readonly link?: LinkMaker
  readonly platform?: NodeJS.Platform
}

/**
 * Make a link, answering false only where Windows refuses link rights (no Developer Mode, no admin
 * rights): the one case a home keeps a copy instead. Any other failure is thrown as it came.
 */
function linked(link: LinkMaker, platform: NodeJS.Platform, target: string, path: string): boolean {
  try {
    link(target, path)
    return true
  } catch (error) {
    if (platform === 'win32' && (error as { code?: unknown }).code === 'EPERM') return false
    throw error
  }
}

/**
 * Put a Codex home on the workspace's one sign-in, under the home's lock.
 *
 * - BroBot's own home (`ownHome`) holds the sign-in Settings shows. A sign-in of its own there that
 *   the workspace's does not have yet (none kept, another account, or renewed later) becomes the
 *   workspace's; that is how a sign-in reaches every agent.
 * - Any other home is made a link to the workspace's, or where Windows refuses links a copy kept in
 *   step. What it held before, whatever account it names, is replaced, never read.
 * - An API-key login is left as it is.
 * - With no sign-in in the workspace it throws {@link NoCodexSignInOnThisComputerError}, and the
 *   home is left as it is.
 */
export async function shareCodexSignIn(
  providerHome: string,
  opts: ShareOptions,
): Promise<SharedSignInOutcome> {
  const given = opts.link ?? symlinkSync
  const platform = opts.platform ?? process.platform
  const link = (target: string, path: string): boolean => linked(given, platform, target, path)
  const own = resolve(opts.ownHome)
  const isOwn = resolve(providerHome) === own
  const place = theWorkspaceSignIn(opts.managedRoot)
  // An agent that starts before BroBot's own has: the workspace's sign-in comes from Settings.
  if (!isOwn && theWorkspaceFile(opts.managedRoot) === null && statOrNull(own)?.isDirectory()) {
    await withProviderHomeLock(own, () => takeTheSettingsSignIn(own, opts.managedRoot, link))
  }
  return await withProviderHomeLock(providerHome, () => {
    const dest = join(providerHome, AUTH_FILE)
    const was = lstatOrNull(dest)
    const bytes = was?.isFile() === true && was.size <= AUTH_FILE_MAX ? readOrNull(dest) : null
    if (codexAccountOf(bytes?.toString('utf8') ?? '') === 'api-key') return 'unchanged'
    if (isOwn && takeTheSettingsSignIn(own, opts.managedRoot, link)) return 'joined'
    // A link that leads nowhere is no sign-in.
    if (lstatOrNull(dest)?.isSymbolicLink() === true && statOrNull(dest) === null) unlinkSync(dest)
    const held = lstatOrNull(dest)
    const target = relative(dirname(dest), place)
    if (theWorkspaceAccount(opts.managedRoot) === null) {
      throw new NoCodexSignInOnThisComputerError('this workspace has no Codex sign-in yet')
    }
    if (held?.isSymbolicLink() === true && readlinkOrNull(dest) === target) return 'unchanged'
    // The link is made beside the home's file first, so a computer that refuses links has lost
    // nothing, and a running Codex never finds the file missing.
    const staged = stagedLink(dest)
    if (link(target, staged)) {
      renameSync(staged, dest)
      return 'joined'
    }
    // No link here: the home holds a copy of the workspace's sign-in, kept in step with it. A copy
    // kept in step in this run that Codex renewed is passed on first; any other is replaced.
    if (keptInStep.has(resolve(providerHome))) passOnARenewal(resolve(providerHome))
    const workspace = theWorkspaceFile(opts.managedRoot)
    const kept = workspace === null ? null : readOrNull(workspace)
    if (kept !== null && !(readOrNull(dest)?.equals(kept) ?? false)) {
      writeAtomicallySync(dest, kept, { mode: 0o600 })
    }
    keepInStep(providerHome, opts.managedRoot, isOwn)
    return 'joined'
  })
}

/**
 * Under BroBot's own home's lock: make the sign-in Settings shows the workspace's. Says whether it
 * moved one there and left the home linked to it. An API-key login there is left as it is.
 */
function takeTheSettingsSignIn(
  own: string,
  managedRoot: string,
  link: (target: string, path: string) => boolean,
): boolean {
  const dest = join(own, AUTH_FILE)
  const place = theWorkspaceSignIn(managedRoot)
  const held = lstatOrNull(dest)
  if (held === null) return false
  if (held.isSymbolicLink()) {
    if (statOrNull(dest) === null) {
      // A link that leads nowhere is no sign-in.
      unlinkSync(dest)
      return false
    }
    // Kept by an earlier BroCrew as a link to an account's own place: that file becomes the
    // workspace's, where the workspace keeps none yet.
    const behind = realpathOrNull(dest)
    if (theWorkspaceFile(managedRoot) === null && behind !== null) {
      if (accountOfASignIn(readOrNull(behind)?.toString('utf8') ?? '') !== null) {
        mkdirSync(dirname(place), { recursive: true, mode: 0o700 })
        if (lstatOrNull(place) !== null) unlinkSync(place)
        if (!link(relative(dirname(place), behind), place)) {
          // No link here any more: the workspace's sign-in starts as that file's content.
          const content = readOrNull(behind)
          if (content !== null) writeAtomicallySync(place, content, { mode: 0o600 })
        }
      }
    }
    return false
  }
  if (!held.isFile() || held.size > AUTH_FILE_MAX) return false
  const bytes = readOrNull(dest)
  const text = bytes?.toString('utf8') ?? ''
  if (
    bytes === null ||
    accountOfASignIn(text) === null ||
    !itBeatsTheWorkspace(text, managedRoot)
  ) {
    return false
  }
  mkdirSync(dirname(place), { recursive: true, mode: 0o700 })
  const into = theWorkspaceFile(managedRoot) ?? place
  const staged = stagedLink(dest)
  if (link(relative(dirname(dest), place), staged)) {
    renameSync(dest, into)
    renameSync(staged, dest)
  } else {
    writeAtomicallySync(into, bytes, { mode: 0o600 })
    keepInStep(own, managedRoot, true)
  }
  return true
}

/** A free name beside a home's `auth.json` for a link made before it replaces the file. */
function stagedLink(dest: string): string {
  const staged = `${dest}.link`
  if (lstatOrNull(staged) !== null) unlinkSync(staged)
  return staged
}

/**
 * Whether a sign-in in BroBot's own home is newer than the workspace's: the workspace keeps none,
 * keeps another account's, or one Codex renewed earlier.
 */
function itBeatsTheWorkspace(text: string, managedRoot: string): boolean {
  const workspace = theWorkspaceFile(managedRoot)
  const kept = workspace === null ? '' : (readOrNull(workspace)?.toString('utf8') ?? '')
  const keptAccount = accountOfASignIn(kept)
  if (keptAccount === null || keptAccount !== accountOfASignIn(text)) return true
  const at = codexRefreshedAt(text)
  const keptAt = codexRefreshedAt(kept)
  return at !== null && (keptAt === null || at > keptAt)
}

/**
 * Leave a home with no link, so a sign-in or a key login started there writes a file of its own
 * instead of replacing the one the workspace's agents share. Answers how to put the link back,
 * which it does only while the home still holds no sign-in: one cancelled, failed or that wrote
 * nothing leaves the home as it was.
 */
export async function makeRoomForACodexSignIn(providerHome: string): Promise<() => Promise<void>> {
  const dest = join(providerHome, AUTH_FILE)
  const removed = await withProviderHomeLock(providerHome, () => {
    if (lstatOrNull(dest)?.isSymbolicLink() !== true) return null
    const target = readlinkSync(dest)
    unlinkSync(dest)
    return target
  })
  return async () => {
    if (removed === null) return
    await withProviderHomeLock(providerHome, () => {
      if (lstatOrNull(dest) === null) symlinkSync(removed, dest)
    })
  }
}

/** Homes that hold the workspace's sign-in as a copy, by home, each with the watch on it. */
const keptInStep = new Map<
  string,
  { readonly managedRoot: string; readonly isOwn: boolean; readonly watcher: FSWatcher }
>()

/** One watch per workspace on the folder its sign-in's file is in, which a linked Codex renews. */
const workspacesWatched = new Map<string, FSWatcher>()

/**
 * Watch a home that holds a copy, so a renewal Codex writes there reaches the others; and the
 * workspace's file, so a sign-in or a renewal written there reaches it. Links stay once made, so
 * linked and copied homes can stay mixed on one computer. `isOwn` marks BroBot's own home, whose
 * sign-in Settings shows.
 */
function keepInStep(providerHome: string, managedRoot: string, isOwn: boolean): void {
  watchTheWorkspace(managedRoot)
  const home = resolve(providerHome)
  if (keptInStep.has(home)) return
  let timer: NodeJS.Timeout | undefined
  const watcher = watch(home, (_event, name) => {
    if (name !== null && name !== AUTH_FILE) return
    // Codex writes by rename: one look once the burst of events has passed.
    clearTimeout(timer)
    timer = setTimeout(() => passOnARenewal(home), 25)
    timer.unref()
  })
  // A watch that fails is closed, and the home stays kept in step: the check before each turn.
  watcher.on('error', () => watcher.close())
  watcher.unref()
  keptInStep.set(home, { managedRoot, isOwn, watcher })
}

function watchTheWorkspace(managedRoot: string): void {
  if (workspacesWatched.has(managedRoot)) return
  const file = theWorkspaceFile(managedRoot)
  if (file === null) return
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher
  try {
    watcher = watch(dirname(file), (_event, name) => {
      if (name !== null && name !== basename(file)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const [home, entry] of keptInStep) {
          if (entry.managedRoot === managedRoot) passOnARenewal(home)
        }
      }, 25)
      timer.unref()
    })
  } catch {
    // Without this watch, the check before each turn still brings a home up to date.
    return
  }
  // A watch that fails is closed; the check before each turn still covers every home.
  watcher.on('error', () => watcher.close())
  watcher.unref()
  workspacesWatched.set(managedRoot, watcher)
}

/** Stop every watch, between tests. The watches never hold the app open on their own. */
export function stopKeepingCodexSignInsInStep(): void {
  for (const { watcher } of keptInStep.values()) watcher.close()
  keptInStep.clear()
  for (const watcher of workspacesWatched.values()) watcher.close()
  workspacesWatched.clear()
}

/**
 * Before a turn: a home holding a copy takes the workspace's newest sign-in, in case a watch
 * missed a renewal. Every copy in the workspace first passes on what it holds, so the workspace's
 * file is the newest any of them has; then this home takes it. Never on a home that links (it
 * reads the workspace's file already), and never an older sign-in over a newer one.
 */
export function catchUpCodexSignIn(providerHome: string): void {
  const home = resolve(providerHome)
  const entry = keptInStep.get(home)
  if (entry === undefined) return
  for (const [other, { managedRoot }] of keptInStep) {
    if (managedRoot === entry.managedRoot) passOnARenewal(other)
  }
}

/**
 * A copy changed, or the workspace's sign-in did. A copy Codex renewed later than the workspace's
 * becomes the workspace's, as does a sign-in of another account in BroBot's own home; the other
 * copies then take it. Any other copy that differs takes the workspace's: an agent's own account
 * never wins.
 */
function passOnARenewal(home: string): void {
  const entry = keptInStep.get(home)
  if (entry === undefined) return
  const dest = join(home, AUTH_FILE)
  if (lstatOrNull(dest)?.isFile() !== true) return
  const workspace = theWorkspaceFile(entry.managedRoot)
  const kept = workspace === null ? null : readOrNull(workspace)
  const keptText = kept?.toString('utf8') ?? ''
  const keptAccount = accountOfASignIn(keptText)
  if (workspace === null || kept === null || keptAccount === null) return
  const bytes = readOrNull(dest)
  const text = bytes?.toString('utf8') ?? ''
  const account = codexAccountOf(text)
  // An API key saved for this agent is its own login, and stays.
  if (bytes === null || account === 'api-key' || bytes.equals(kept)) return
  const at = codexRefreshedAt(text)
  const keptAt = codexRefreshedAt(keptText)
  const renewedLater = account === keptAccount && at !== null && (keptAt === null || at > keptAt)
  const signedInHere = entry.isOwn && account !== null && account !== keptAccount
  try {
    if (!renewedLater && !signedInHere) {
      writeAtomicallySync(dest, kept, { mode: 0o600 })
      return
    }
    writeAtomicallySync(workspace, bytes, { mode: 0o600 })
    for (const [other, { managedRoot }] of keptInStep) {
      if (other === home || managedRoot !== entry.managedRoot) continue
      const theirs = join(other, AUTH_FILE)
      if (lstatOrNull(theirs)?.isFile() !== true) continue
      const held = readOrNull(theirs)
      if (held === null || codexAccountOf(held.toString('utf8')) === 'api-key') continue
      if (!held.equals(bytes)) writeAtomicallySync(theirs, bytes, { mode: 0o600 })
    }
  } catch (error) {
    console.warn(
      `could not pass a Codex renewal to the workspace's other agents: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function readlinkOrNull(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}
