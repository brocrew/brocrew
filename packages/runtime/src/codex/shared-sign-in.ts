import {
  type FSWatcher,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  watch,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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
 * One Codex sign-in per ChatGPT account in a workspace, which every Codex agent on that account
 * reads and renews.
 *
 * Each agent's `auth.json` is a link to `<managed root>/codex-sign-ins/<account>/auth.json`.
 * Codex keeps the link when it renews: it resolves the link, writes the target by rename, takes
 * its commit lock beside the target, and reloads the file before it renews, so a renewal one agent
 * made is adopted by the others instead of spent again (codex-rs `login/src/auth/storage_file.rs`,
 * `storage_commit.rs`, `manager.rs` `refresh_token_with_reason`, at 0.167.1).
 *
 * Where this computer refuses a link (Windows without Developer Mode or admin rights), a home holds
 * the account's sign-in as a file of its own, and every renewal Codex writes in one home is put in
 * the account's place and in its other homes at once. Codex reads the file again before it renews,
 * so the others take that renewal instead of spending the key again.
 */

const AUTH_FILE = 'auth.json'
const AUTH_FILE_MAX = 1024 * 1024

/** Where a workspace keeps its Codex sign-ins, one folder per ChatGPT account. */
function codexSignInsFolder(managedRoot: string): string {
  return join(managedRoot, 'codex-sign-ins')
}

/** The account id in hex, so any id is one plain folder name. */
function signInOf(managedRoot: string, account: string): string {
  return join(codexSignInsFolder(managedRoot), Buffer.from(account).toString('hex'), AUTH_FILE)
}

/** Whether this workspace keeps any Codex sign-in. */
export function aCodexSignInIsKept(managedRoot: string): boolean {
  return keptSignIns(managedRoot).length > 0
}

function keptSignIns(managedRoot: string): string[] {
  let folders: string[]
  try {
    folders = readdirSync(codexSignInsFolder(managedRoot))
  } catch {
    return []
  }
  return folders
    .map((folder) => join(codexSignInsFolder(managedRoot), folder, AUTH_FILE))
    .filter((file) => statOrNull(file)?.isFile() === true)
}

/** Whether a home holds its account's sign-in as a file kept in step, for want of a link. */
export function codexSignInIsKeptAsAFile(providerHome: string, managedRoot: string): boolean {
  const dest = join(providerHome, AUTH_FILE)
  if (lstatOrNull(dest)?.isFile() !== true) return false
  const account = codexAccountOf(readOrNull(dest)?.toString('utf8') ?? '')
  if (account === null || account === 'api-key') return false
  return statOrNull(signInOf(managedRoot, account))?.isFile() === true
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
 * Put a Codex home on its account's one sign-in, under the home's lock.
 *
 * - A sign-in of its own (a regular file on a ChatGPT account) goes to its account's place, unless
 *   that place holds one Codex renewed later. Either way the home then reads the account's one.
 * - A home with none joins the sign-in BroBot's own profile uses, else the one renewed last. With
 *   none in the workspace it throws {@link NoCodexSignInOnThisComputerError}.
 * - An API-key login and a file that names no account are left as they are.
 *
 * `ownHome` is BroBot's own profile's home; its sign-in is put in place first, so a new agent
 * joins it rather than an older copy.
 */
export async function shareCodexSignIn(
  providerHome: string,
  opts: ShareOptions,
): Promise<SharedSignInOutcome> {
  const given = opts.link ?? symlinkSync
  const platform = opts.platform ?? process.platform
  const link = (target: string, path: string): boolean => linked(given, platform, target, path)
  const own = resolve(opts.ownHome)
  if (resolve(providerHome) !== own && statOrNull(own)?.isDirectory() === true) {
    await withProviderHomeLock(own, () => moveToItsAccount(own, opts.managedRoot, link))
  }
  return await withProviderHomeLock(providerHome, () => {
    const held = moveToItsAccount(providerHome, opts.managedRoot, link)
    if (held !== 'none') return held === 'joined' ? 'joined' : 'unchanged'
    const target = theSignInToJoin(own, opts.managedRoot)
    if (target === null) {
      throw new NoCodexSignInOnThisComputerError('this workspace has no Codex sign-in yet')
    }
    const dest = join(providerHome, AUTH_FILE)
    if (!link(relative(dirname(dest), target), dest)) {
      writeAtomicallySync(dest, readFileSync(target), { mode: 0o600 })
      keepInStep(providerHome, opts.managedRoot)
    }
    return 'joined'
  })
}

/**
 * Leave a home with no link, so a sign-in started there writes a file of its own instead of
 * replacing the one its account's agents share. {@link shareCodexSignIn} then puts it in place.
 * Answers how to put the link back, which it does only while the home still holds no sign-in: a
 * sign-in cancelled, failed or that wrote nothing leaves the home on the account it was on.
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

/** Under the home's lock: what the home held, after its own sign-in went to its account's place. */
function moveToItsAccount(
  providerHome: string,
  managedRoot: string,
  link: (target: string, path: string) => boolean,
): 'joined' | 'shared' | 'none' | 'left' {
  const dest = join(providerHome, AUTH_FILE)
  const held = lstatOrNull(dest)
  if (held === null) return 'none'
  if (held.isSymbolicLink()) {
    if (statOrNull(dest)?.isFile() === true) return 'shared'
    // A link that leads nowhere is no sign-in.
    unlinkSync(dest)
    return 'none'
  }
  if (!held.isFile() || held.size > AUTH_FILE_MAX) return 'left'
  const bytes = readFileSync(dest)
  const account = codexAccountOf(bytes.toString('utf8'))
  if (account === null || account === 'api-key') return 'left'

  const target = signInOf(managedRoot, account)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const kept = readOrNull(target)
  const keptAt = kept === null ? null : codexRefreshedAt(kept.toString('utf8'))
  const heldAt = codexRefreshedAt(bytes.toString('utf8'))
  const itsOwnIsNewer = keptAt === null || (heldAt !== null && heldAt > keptAt)
  // The link is made beside the file first, so a computer that refuses links has lost nothing.
  const staged = `${dest}.link`
  if (lstatOrNull(staged) !== null) unlinkSync(staged)
  if (!link(relative(dirname(dest), target), staged)) {
    // No link here: the home keeps a file, kept in step with its account's.
    keepInStep(providerHome, managedRoot)
    passOnARenewal(providerHome)
    return 'joined'
  }
  if (itsOwnIsNewer) renameSync(dest, target)
  renameSync(staged, dest)
  return 'joined'
}

/** The sign-in a home with none joins: BroBot's own profile's, else the one Codex renewed last. */
function theSignInToJoin(ownHome: string, managedRoot: string): string | null {
  const ownDest = join(ownHome, AUTH_FILE)
  const ownAccount = codexAccountOf(readOrNull(ownDest)?.toString('utf8') ?? '')
  if (ownAccount !== null && ownAccount !== 'api-key') {
    const target = signInOf(managedRoot, ownAccount)
    if (statOrNull(target)?.isFile() === true) return target
  }
  let newest: { file: string; at: number } | null = null
  for (const file of keptSignIns(managedRoot)) {
    const text = readOrNull(file)?.toString('utf8') ?? null
    const account = text === null ? null : codexAccountOf(text)
    if (text === null || account === null || account === 'api-key') continue
    const at = codexRefreshedAt(text) ?? Number.NEGATIVE_INFINITY
    if (newest === null || at > newest.at) newest = { file, at }
  }
  return newest?.file ?? null
}

/** Homes that hold their account's sign-in as a file, by home, each with the watch on it. */
const keptInStep = new Map<string, { readonly managedRoot: string; readonly watcher: FSWatcher }>()

/** One watch per workspace on its account places, which a linked agent's Codex renews directly. */
const placesWatched = new Map<string, FSWatcher>()

/**
 * Watch a home whose sign-in is a file, so a renewal Codex writes there reaches the others; and
 * its workspace's account places, so a renewal a linked agent's Codex writes there reaches it.
 * Links stay once made, so linked and copied homes can stay mixed on one computer.
 */
function keepInStep(providerHome: string, managedRoot: string): void {
  watchThePlaces(managedRoot)
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
  keptInStep.set(home, { managedRoot, watcher })
}

function watchThePlaces(managedRoot: string): void {
  if (placesWatched.has(managedRoot)) return
  const places = codexSignInsFolder(managedRoot)
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher
  try {
    mkdirSync(places, { recursive: true, mode: 0o700 })
    watcher = watch(places, { recursive: true }, () => {
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
  placesWatched.set(managedRoot, watcher)
}

/** Stop every watch, between tests. The watches never hold the app open on their own. */
export function stopKeepingCodexSignInsInStep(): void {
  for (const { watcher } of keptInStep.values()) watcher.close()
  keptInStep.clear()
  for (const watcher of placesWatched.values()) watcher.close()
  placesWatched.clear()
}

/**
 * Before a turn: a home kept as a file takes its account's newest sign-in, in case a watch missed
 * a renewal. Every home kept in step on its account first passes on what it holds, so the
 * account's kept file is the newest any of them has; then this home takes it, where it is later
 * than its own. Never on a home that links (it reads the account's file already), never from
 * another account, and never an older sign-in over a newer one.
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
 * A home's sign-in changed: when Codex renewed it later than its account's, it becomes the
 * account's; and every other home kept in step on that account that holds an older one takes it,
 * also when the account's was brought up to date first. A home holding an older one than its
 * account's takes the account's.
 */
function passOnARenewal(home: string): void {
  const entry = keptInStep.get(home)
  if (entry === undefined) return
  const dest = join(home, AUTH_FILE)
  if (lstatOrNull(dest)?.isFile() !== true) return
  const bytes = readOrNull(dest)
  const text = bytes?.toString('utf8') ?? ''
  const account = codexAccountOf(text)
  const at = codexRefreshedAt(text)
  if (bytes === null || account === null || account === 'api-key' || at === null) return
  const target = signInOf(entry.managedRoot, account)
  const kept = readOrNull(target)
  const keptText = kept?.toString('utf8') ?? ''
  const keptAt = codexAccountOf(keptText) === account ? codexRefreshedAt(keptText) : null
  try {
    if (kept !== null && keptAt !== null && keptAt > at) {
      // The account's is later: this home takes it, and has nothing newer to pass on.
      writeAtomicallySync(dest, kept, { mode: 0o600 })
      return
    }
    if (keptAt === null || keptAt < at) {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeAtomicallySync(target, bytes, { mode: 0o600 })
    }
    for (const [other, { managedRoot }] of keptInStep) {
      if (other === home || managedRoot !== entry.managedRoot) continue
      const theirs = join(other, AUTH_FILE)
      if (lstatOrNull(theirs)?.isFile() !== true) continue
      const held = readOrNull(theirs)?.toString('utf8') ?? ''
      if (codexAccountOf(held) !== account) continue
      if ((codexRefreshedAt(held) ?? Number.NEGATIVE_INFINITY) < at) {
        writeAtomicallySync(theirs, bytes, { mode: 0o600 })
      }
    }
  } catch (error) {
    console.warn(
      `could not pass a Codex renewal to the other agents on its account: ${
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
