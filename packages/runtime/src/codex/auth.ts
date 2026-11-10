import { writeAtomicallySync } from '../atomic-write'
import {
  type BigIntStats,
  type Stats,
  closeSync,
  constants as fsConstants,
  lstatSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AuthUnavailableError, type AuthHealth, type ReprovisionOutcome } from '../internal/auth'
import {
  type TrustedAncestry,
  exactLstatOrNull,
  isTheSameFile,
  trustProviderHomeAncestry,
  withProviderHomeLock,
} from '../internal/provider-home'
import { transientSetupFailureOf } from '../runtime'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}



/**
 * No Codex sign-in for a profile to copy at its first start: this computer has none, and BroBot's
 * own profile has none inside BroBot's data folder. Its own class, because signing in again does
 * not fix it where the sign-in is kept per profile: there was never one to renew.
 */
export class NoCodexSignInOnThisComputerError extends AuthUnavailableError {
  constructor(message: string) {
    super('codex', message)
    this.name = 'NoCodexSignInOnThisComputerError'
  }
}

/**
 * What tells one copy of a Codex sign-in from another without reading it: the file itself, its
 * size, and when it was last written. A copy Codex renewed in place keeps the file and changes the
 * other two; a copy replaced by another is another file.
 */
export interface CodexCopyIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

/**
 * Codex itself said it cannot use the sign-in this profile holds: the running program was asked,
 * and answered that a sign-in is there and names no account. Its own class, because this is the
 * one refusal a fresher copy answers. A sign-in refused before Codex was asked (a file's mode, its
 * shape) is not this.
 */
export class CodexRefusedItsSignInError extends AuthUnavailableError {
  /**
   * The copy that was refused: the one the home held before Codex was started and still held,
   * unchanged, when Codex answered. Null where the home held none, or held another by then: which
   * copy Codex refused is then not known, and none is replaced.
   */
  readonly refusedCopy: CodexCopyIdentity | null

  constructor(message: string, refusedCopy: CodexCopyIdentity | null) {
    super('codex', message)
    this.name = 'CodexRefusedItsSignInError'
    this.refusedCopy = refusedCopy
  }
}

// --- Codex: copy auth.json once into the profile home (0600, atomic) ---

const CODEX_AUTH_FILE = 'auth.json'

/** The personal Codex credential path (`~/.codex/auth.json`) — the copy source. */
export function personalCodexAuthPath(): string {
  return join(homedir(), '.codex', CODEX_AUTH_FILE)
}

/**
 * Copy the personal Codex `auth.json` into the profile home **once**, atomically, at
 * mode `0600` (022, from 015). It copies **only** `auth.json` (never history/config/
 * db), copies its **content** (never symlinks the profile to the personal file,
 * which Codex may truncate/rewrite), and **never overwrites** an existing profile
 * credential — that copy may have been refreshed independently, and re-copying the
 * personal one on an mtime change would clobber it.
 *
 * Where the computer has no Codex sign-in, it copies `fallbackAuthPath` instead when one is given:
 * BroBot's own profile's sign-in, so an agent can start on a computer signed in to Codex only
 * inside BroBot. Both copies then share one renewing sign-in, and whichever renews first spends
 * the other's. The fallback is read only under `managedRoot`, through a folder chain with no link
 * in it, and must be a regular file holding a whole JSON object. With neither, it throws
 * {@link NoCodexSignInOnThisComputerError}; it never falls back to `~/.codex` itself.
 */
export async function provisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string; managedRoot?: string; fallbackAuthPath?: string } = {},
): Promise<void> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  if (opts.fallbackAuthPath !== undefined && opts.managedRoot === undefined) {
    throw new Error('A fallback Codex sign-in is read only under a managed root.')
  }
  // 🔴 **This is the step that puts the credential on disk, so it re-proves the home it is writing
  // into** (293 §1). `provisionProviderHome` now survives its own lock, but it RETURNS — and the
  // ancestor can be swapped between that return and this call, which is the same escape one
  // function later. ⚠️ **Optional, and a caller that does not know the managed root gets the
  // behaviour it always had**: every test that copies into a bare temp directory, and
  // `reprovisionCodexAuth`, which is 098's separate writer.
  const ancestry =
    opts.managedRoot === undefined
      ? null
      : trustProviderHomeAncestry(opts.managedRoot, providerHome, { includeLeaf: true })
  try {
    await provisionCodexAuthLocked(
      providerHome,
      source,
      ancestry,
      opts.fallbackAuthPath === undefined || opts.managedRoot === undefined
        ? undefined
        : { path: opts.fallbackAuthPath, managedRoot: opts.managedRoot },
    )
  } finally {
    ancestry?.release()
  }
}

/** A fallback sign-in, and the managed root its folder chain must stay under. */
export interface Fallback {
  readonly path: string
  readonly managedRoot: string
}

/**
 * The fallback sign-in's bytes, or null when there is none: only when the file, or a folder above
 * it, is not there. Read only from inside the managed root:
 *
 * - its folder chain under the managed root is pinned, with no link anywhere in it, and re-proved
 *   before the file is looked at and again after it is read. The file opened must be the regular
 *   file looked at, by device and inode. A process of the same person racing these paths between
 *   two checks and restoring them is out of reach here: it could read both files itself;
 * - anything else that keeps it from being read is a sign-in that could not be used: a link, a
 *   folder, a file too large or not a whole JSON object, a chain that is not BroBot's, or one that
 *   moved. A machine that ran short is said as itself. Codex rewrites its file in place, so a read
 *   that meets it half-written is tried again first.
 *
 * `between` is called between the look and the open, for a test to act in. ⚠️ Windows has no
 * `O_NOFOLLOW`, so its open follows a link put at the path: there the path is looked at again once
 * the file is open, and must still be that very regular file.
 */
export function fallbackSignIn(
  { path, managedRoot }: Fallback,
  between: () => void = () => {},
  platform: NodeJS.Platform = process.platform,
): Buffer | null {
  const unusable = (why: string, error?: unknown): Error => {
    if (error !== undefined && transientSetupFailureOf(error) !== null) return error as Error
    return new AuthUnavailableError(
      'codex',
      `BroBot's own Codex sign-in ${why}: ${path}` +
        (error === undefined ? '' : ` (${error instanceof Error ? error.message : String(error)})`),
    )
  }
  const absent = (error: unknown): boolean =>
    isRecord(error) && (error['code'] === 'ENOENT' || error['code'] === 'ENOTDIR')
  // Resolving it tells a file that is not there from one that cannot be read; whether it stays
  // inside the managed root is the pin's to judge.
  try {
    realpathSync.native(path)
  } catch (error) {
    if (absent(error)) return null
    throw unusable('could not be read', error)
  }
  let ancestry: TrustedAncestry
  try {
    ancestry = trustProviderHomeAncestry(managedRoot, dirname(path), { includeLeaf: true })
  } catch (error) {
    throw unusable('is not where BroCrew keeps it', error)
  }
  const reproved = (): void => {
    try {
      ancestry.verify()
    } catch (error) {
      throw unusable('moved while it was read', error)
    }
  }
  try {
    for (let attempt = 1; ; attempt += 1) {
      reproved()
      let found: BigIntStats
      try {
        found = lstatSync(path, { bigint: true })
      } catch (error) {
        if (absent(error)) return null
        throw unusable('could not be read', error)
      }
      if (!found.isFile() || found.size > BigInt(CODEX_AUTH_FILE_MAX)) {
        throw unusable('is not a file')
      }
      between()
      let data: Buffer
      try {
        const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
        try {
          const opened = fstatSync(fd, { bigint: true })
          if (!opened.isFile() || !isTheSameFile(opened, found)) {
            throw unusable('moved while it was read')
          }
          if (platform === 'win32') {
            const now = lstatSync(path, { bigint: true })
            if (!now.isFile() || !isTheSameFile(now, opened)) throw unusable('could not be read')
          }
          data = readFileSync(fd)
        } finally {
          closeSync(fd)
        }
      } catch (error) {
        if (error instanceof AuthUnavailableError) throw error
        throw unusable('could not be read', error)
      }
      reproved()
      try {
        const parsed: unknown = JSON.parse(data.toString('utf8'))
        if (isRecord(parsed) && !Array.isArray(parsed)) return data
      } catch {
        // Not whole yet: read again below.
      }
      if (attempt === 3) throw unusable('could not be read whole')
    }
  } finally {
    ancestry.release()
  }
}

/**
 * The sign-in a first start copies: the computer's own, else BroBot's own where the computer has
 * none and a fallback is named. A computer's sign-in that is missing with no fallback to copy
 * fails as the read failed.
 */
function theSignInToCopy(source: string, fallback: Fallback | undefined): Buffer {
  try {
    return readFileSync(source)
  } catch (error) {
    if (!(isRecord(error) && error['code'] === 'ENOENT') || fallback === undefined) throw error
    const own = fallbackSignIn(fallback)
    if (own === null) throw error
    return own
  }
}

async function provisionCodexAuthLocked(
  providerHome: string,
  source: string,
  ancestry: TrustedAncestry | null,
  fallback: Fallback | undefined,
): Promise<void> {
  // Serialize concurrent provisioning/auth writes for this home (027 P1-H).
  // ⚠️ `async` since 243: the copy is the same synchronous sequence it always was, and only the
  // WAIT for another process's copy stopped blocking the thread. See `withProviderHomeLock`.
  await withProviderHomeLock(
    providerHome,
    () => {
      ancestry?.verify()
      const dest = join(providerHome, CODEX_AUTH_FILE)

      // Copy exactly once: never clobber a possibly-refreshed profile credential. A link the
      // person made to a sign-in file is kept as the file it leads to.
      const destStat = statOrNull(dest)
      // A link that leads nowhere is no sign-in: it goes, and a fresh copy takes its place.
      if (destStat === null && lstatOrNull(dest)?.isSymbolicLink()) unlinkSync(dest)
      if (destStat) {
        if (!destStat.isFile()) {
          throw new AuthUnavailableError(
            'codex',
            `profile auth.json is not a regular file: ${dest}`,
          )
        }
        return
      }

      let data: Buffer
      try {
        // Read the CONTENT; the profile is never symlinked to it.
        data = theSignInToCopy(source, fallback)
      } catch (error) {
        // BroBot's own sign-in was there and could not be used: said as it came.
        if (error instanceof AuthUnavailableError) throw error
        // A file that is not there, and no sign-in of BroBot's own to copy instead, is a computer
        // with no Codex sign-in; one that is there and could not be read is a sign-in that could
        // not be used, which the lines below say.
        if (isRecord(error) && error['code'] === 'ENOENT') {
          throw new NoCodexSignInOnThisComputerError(
            `personal Codex auth.json not found at ${source}` +
              (fallback === undefined ? '' : `, and BroBot's own has none at ${fallback.path}`),
          )
        }
        // 🔴 **710 · R52 — a machine that ran short did not lose a credential.** ⛔ Until `710` an
        // `EMFILE` here told a person *"personal Codex auth.json not found at <home>"* — a sign-in to
        // fix, with a path in it, about a file that was there. ⚑ Thrown as it came, for the door
        // that asked to say in its own words — the doors {@link defaultKeychainReader}'s note lists.
        if (transientSetupFailureOf(error) !== null) throw error
        throw new AuthUnavailableError('codex', `personal Codex auth.json not found at ${source}`)
      }
      // ⛔ **Immediately before the bytes exist anywhere**, not only before the lock (293 §1). This
      // is the last instruction that can still refuse; after it a credential is on some disk.
      ancestry?.verify()
      writeAtomicallySync(dest, data, { exclusive: true })
    },
    { verify: ancestry?.verify },
  )
}

/** Where a fresh copy of a Codex sign-in may come from: this computer's own, or BroBot's own. */
export type CodexCopySource = 'the-computers' | 'brobots-own'

/** One place a fresh copy may be read from; BroBot's own is read as {@link fallbackSignIn} reads it. */
export type CodexCopyCandidate =
  | { readonly from: 'the-computers'; readonly sourceAuthPath: string }
  | { readonly from: 'brobots-own'; readonly fallback: Fallback }

/**
 * Replace a profile's Codex sign-in that Codex has just refused with a fresh copy of the same
 * account, from whichever candidate Codex refreshed last. Under the profile home's lock, and only
 * when all of this holds: the home holds a regular file naming an account; the candidate names that
 * same account; and Codex refreshed the candidate later than the copy, by the date each file
 * carries. So a copy that is as new as its sources is never replaced, the same bytes are never
 * copied again, and one replacement leaves nothing later to replace it with again. A home on an API key, on another
 * account, or whose account or date cannot be read is left as it is, and a candidate that cannot be
 * read, or names no date, is not used. Of a file, only its account and that date are read.
 * ⚑ And only the copy that was refused: `refused` says which it was, and a copy on disk that is no
 * longer that file, unchanged, is left as it is.
 */
export async function replaceARefusedCodexCopy(
  providerHome: string,
  opts: {
    managedRoot: string
    candidates: readonly CodexCopyCandidate[]
    /** The copy Codex refused, as it stood then. A copy that is no longer that one is left alone. */
    refused: CodexCopyIdentity
    /**
     * Whether whoever asked still wants this: asked under the lock, which may have been waited
     * for. A conversation stopped, or an app closing, meanwhile replaces nothing.
     */
    stillWanted: () => boolean
  },
): Promise<CodexCopySource | 'not-tried'> {
  const ancestry = trustProviderHomeAncestry(opts.managedRoot, providerHome, { includeLeaf: true })
  try {
    return await withProviderHomeLock(
      providerHome,
      () => {
        // ⛔ First, before the copy or any candidate is read: the wait for this lock may have
        // outlasted the conversation or the launch that asked.
        if (!opts.stillWanted()) return 'not-tried'
        ancestry.verify()
        const dest = join(providerHome, CODEX_AUTH_FILE)
        const held = exactLstatOrNull(dest)
        if (held === null || !held.isFile() || held.size > BigInt(CODEX_AUTH_FILE_MAX)) {
          return 'not-tried'
        }
        // ⛔ Only the copy that was refused. Codex has renewed this one in place since, or
        // something else has replaced it: it is not the refused copy any more, and may work.
        if (!isTheSameCopy(held, opts.refused)) return 'not-tried'
        const refused = readOrNull(dest)
        if (refused === null) return 'not-tried'
        const account = codexAccountOf(refused.toString('utf8'))
        const refreshed = codexRefreshedAt(refused.toString('utf8'))
        if (account === null || account === 'api-key' || refreshed === null) return 'not-tried'
        let fresh: { from: CodexCopySource; bytes: Buffer; refreshed: number } | null = null
        for (const candidate of opts.candidates) {
          let bytes: Buffer | null
          try {
            bytes =
              candidate.from === 'the-computers'
                ? readFileSync(candidate.sourceAuthPath)
                : fallbackSignIn(candidate.fallback)
          } catch {
            continue
          }
          if (bytes === null || bytes.length > CODEX_AUTH_FILE_MAX) continue
          const text = bytes.toString('utf8')
          const when = codexRefreshedAt(text)
          if (codexAccountOf(text) !== account || when === null || when <= refreshed) continue
          if (fresh === null || when > fresh.refreshed) {
            fresh = { from: candidate.from, bytes, refreshed: when }
          }
        }
        if (fresh === null) return 'not-tried'
        ancestry.verify()
        writeAtomicallySync(dest, fresh.bytes)
        return fresh.from
      },
      { verify: ancestry.verify },
    )
  } finally {
    ancestry.release()
  }
}

/** A profile home's copy of a Codex sign-in as it stands now, by what tells it apart; null where it holds none. */
export function codexCopyIdentityIn(providerHome: string): CodexCopyIdentity | null {
  const held = exactLstatOrNull(join(providerHome, CODEX_AUTH_FILE))
  if (held === null || !held.isFile()) return null
  return { dev: held.dev, ino: held.ino, size: held.size, mtimeNs: held.mtimeNs }
}

/** Whether two looks at a home found the same copy, unchanged; never where either found none. */
export function isTheSameCodexCopy(
  one: CodexCopyIdentity | null | undefined,
  other: CodexCopyIdentity | null | undefined,
): boolean {
  return (
    one !== null &&
    one !== undefined &&
    other !== null &&
    other !== undefined &&
    isTheSameFile(one, other) &&
    one.size === other.size &&
    one.mtimeNs === other.mtimeNs
  )
}

function isTheSameCopy(held: BigIntStats, refused: CodexCopyIdentity): boolean {
  return (
    isTheSameFile(held, refused) && held.size === refused.size && held.mtimeNs === refused.mtimeNs
  )
}

/**
 * Copy the personal Codex `auth.json` into the profile home **again**, replacing what is there
 * (098) — the one sanctioned writer over a credential {@link provisionCodexAuth} refuses to touch.
 *
 * ## Why this is a second function and not a flag on the first
 *
 * `provisionCodexAuth`'s copy-once rule is correct and stays exactly as it was. It runs on **every**
 * session launch, and an overwrite there would clobber a profile credential that had refreshed
 * independently — silently, on a schedule, for the whole life of the app. That is the stomp the rule
 * exists to prevent, and a parameter that switched it off would put the stomp one careless call site
 * away.
 *
 * What the rule did not anticipate is that a copy can go **stale**, and then nothing could ever
 * replace it: the app had no way back short of deleting a file by hand. So the overwrite lives here,
 * in a function whose only caller is a person pressing a button. Automatic callers get the safe one;
 * this one is reachable only by asking for it by name.
 *
 * ⚠️ **This does not end the sharing.** The copy and `~/.codex` hold one rotating refresh token
 * between them, so the next refresh by either side breaks the other again — see `codex-login.ts` for
 * the measurement and for the remedy that does end it. Any surface offering this must say so.
 *
 * Everything else is {@link provisionCodexAuth}'s: the per-home lock, `0600`, content-not-symlink,
 * a temp created `O_EXCL|O_NOFOLLOW`, and a refusal if the destination has been replaced by a
 * symlink or a directory. Only the final install differs — `rename` (which replaces atomically)
 * where the first uses `link` (which refuses to).
 */
export async function reprovisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string } = {},
): Promise<ReprovisionOutcome> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  return await withProviderHomeLock(providerHome, () => {
    const dest = join(providerHome, CODEX_AUTH_FILE)

    // A directory here is no sign-in. A link is replaced by the copy: `rename` replaces the link
    // itself, never the file it leads to.
    const destStat = lstatOrNull(dest)
    if (destStat && !destStat.isFile() && !destStat.isSymbolicLink()) {
      throw new AuthUnavailableError('codex', `profile auth.json is not a regular file: ${dest}`)
    }

    let data: Buffer
    try {
      data = readFileSync(source) // the CONTENT, never a symlink to it
    } catch (error) {
      // 🔴 **716 · `710` F-4 — the launch copy's rethrow, on the re-copy** (R52's class). ⛔ Until
      // `716` a machine that ran short told a person *"personal Codex auth.json not found … sign in
      // with the codex CLI first"* — a sign-in to redo, about a file that was there. ⚑ Thrown as it
      // came; `RuntimeHost.reprovisionProviderAuth` says it in a person's words, by the code.
      if (transientSetupFailureOf(error) !== null) throw error
      throw new AuthUnavailableError(
        'codex',
        `personal Codex auth.json not found at ${source} — sign in with the codex CLI first, then try again`,
      )
    }

    // Report honestly when there was nothing to do. A surface that says "re-copied" over identical
    // bytes teaches the user that the button does nothing, which is worse than saying so.
    const existing = destStat?.isFile() ? readOrNull(dest) : null
    if (existing && existing.equals(data)) return 'unchanged'

    writeAtomicallySync(dest, data)
    return 'replaced'
  })
}

/** Read a file, or null if it cannot be read — used only to detect a no-op re-copy. */
function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/**
 * Codex auth-health: ok iff a managed `auth.json` exists and is a regular file, or a link the person
 * made to one. Ordinary filesystem permissions do not change this health result.
 */
export function codexAuthHealth(providerHome: string): AuthHealth {
  const dest = join(providerHome, CODEX_AUTH_FILE)
  const stat = statOrNull(dest)
  if (!stat) return { ok: false, reason: `no managed Codex auth.json in ${providerHome}` }
  if (!stat.isFile())
    return { ok: false, reason: `Codex auth.json is not a regular file (e.g. a directory)` }
  return { ok: true }
}

/** A Codex login file larger than this is not read for its account. */
const CODEX_AUTH_FILE_MAX = 1024 * 1024

/**
 * The account a Codex home is signed in to: its `auth.json`'s
 * `tokens.account_id`, or the one name `api-key` for a home logged in with a key. Never a token:
 * Codex renewing its own tokens on the same account keeps the same name. `null` when there is no
 * login to read, or none whole (a write under way): that is *cannot tell*, never a change.
 */
export async function codexAccountIn(providerHome: string): Promise<string | null> {
  try {
    const file = join(providerHome, CODEX_AUTH_FILE)
    // ⛔ Only a regular file: a link or a pipe in a home is not read.
    const found = await lstat(file)
    if (!found.isFile() || found.size > CODEX_AUTH_FILE_MAX) return null
    return codexAccountOf(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** {@link codexAccountIn}, read at once: for a launch, just before its app-server is spawned. */
export function codexAccountInNow(providerHome: string): string | null {
  try {
    const file = join(providerHome, CODEX_AUTH_FILE)
    const found = lstatSync(file)
    if (!found.isFile() || found.size > CODEX_AUTH_FILE_MAX) return null
    return codexAccountOf(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** The account a Codex `auth.json`'s text names, by the kind of login Codex's own `auth_mode` says. */
function codexAccountOf(text: string): string | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(json)) return null
  const mode = json['auth_mode']
  const tokens = json['tokens']
  const account = isRecord(tokens) ? tokens['account_id'] : undefined
  const key = json['OPENAI_API_KEY']
  if (mode === 'apikey' || (mode === undefined && typeof key === 'string' && key !== '')) {
    return typeof key === 'string' && key !== '' ? 'api-key' : null
  }
  if ((mode === 'chatgpt' || mode === undefined) && typeof account === 'string' && account !== '') {
    return account
  }
  return null
}

/**
 * When Codex last refreshed the sign-in a Codex `auth.json`'s text holds, by the `last_refresh`
 * date Codex writes beside the tokens at a sign-in and at every renewal. Null when the file names
 * none. ⚑ Not the file's own date on disk, which for a copy is when it was copied.
 */
function codexRefreshedAt(text: string): number | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const said = isRecord(json) ? json['last_refresh'] : undefined
  const at = typeof said === 'string' ? Date.parse(said) : Number.NaN
  return Number.isFinite(at) ? at : null
}









/** `lstat` or null (path missing) — never throws for a missing path. */
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
