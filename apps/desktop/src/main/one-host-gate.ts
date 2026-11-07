import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  type Stats,
} from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import { userInfo } from 'node:os'
import { join } from 'node:path'

/** Workspace presence for the chooser. Startup ownership comes from Electron's OS lock. */
export type HostGateVerdict =
  /** The launch holds Electron's OS lock. */
  | 'sole'
  /** The OS lock was not acquired. */
  | 'taken'
  /** No lock decision is available to this caller. */
  | 'unknown'

/**
 * How long a listener or the first question may take before it times out.
 *
 * ⚠️ **A gate with no timeout is a startup that can hang**, which is worse than the two-host window
 * it exists to close: a connect to a listener whose backlog is full neither succeeds nor fails.
 * Generous by the standard of a local socket — the answer is a single write from a process on this
 * machine — and short by the standard of a person watching an icon bounce.
 */
const ANSWER_MS = 1500

/** A timed-out question gets one retry with more time for a busy host to answer. */
const RETRY_ANSWER_MS = 3000

/** Presence listeners are held for the process lifetime without keeping it alive. */
const holding = new Set<Server>()

/**
 * Where the listener lives, per `userData`.
 *
 * ⚠️ **Per `userData` and not global**, which is the rule `198` §1 measured the whole feature
 * against: every live smoke launches its own app with its own `--user-data-dir`, and a gate that
 * was global would break every instrument in this repository on the first run.
 *
 * ⛔ **A Windows pipe is not a file**, so it takes a name derived from the directory rather than a
 * path inside it. The hash is short and non-cryptographic in purpose — it only has to distinguish
 * two directories on one machine.
 *
 * A POSIX socket path has a length limit ({@link socketPathMax}). A folder too long for
 * `one-host.sock` inside it keeps its gate in {@link OutsideGates}' folder instead, so a long
 * workspace path still has a working gate. Either way the folder is read as it is on the disk, so
 * two spellings of one folder (a link to it, say) find one gate.
 */
export function hostGatePath(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): string {
  if (platform === 'win32') return `\\\\.\\pipe\\brobot2-one-host-${digest(userData)}`
  return posixGate(userData, platform, outside).public
}

/**
 * Where the gates of folders too long for one inside them live, and how that place is checked.
 *
 * The folder is in this user's home as the user database records it, never read from the
 * environment: two launches on one folder that disagree about `HOME` or `TMPDIR` would otherwise
 * find two gates, and both answer `sole`. No other user can write there, so none can take the
 * place first. It is made private and checked before every use all the same: a folder or a name
 * there that is not this user's own answers `unknown`, never `sole` or `taken`.
 */
export interface OutsideGates {
  /** `~/Library/Caches/brobot2-gates` on macOS, `~/.cache/brobot2-gates` elsewhere. */
  readonly folder: string
  /** The id of the user this process runs as, who must own the folder and every name in it. */
  readonly uid: number
  readonly lstat: (path: string) => GateEntry
  /** Where a link the person made at the folder leads. */
  readonly stat: (path: string) => GateEntry
  readonly chmod: (path: string, mode: number) => void
  readonly warn: (line: string) => void
}

/** What a gate reads of a folder or a name it is about to trust. */
export type GateEntry = Pick<Stats, 'uid' | 'mode' | 'isDirectory' | 'isSocket'>

/**
 * This user's {@link OutsideGates}, with a test's changes; null where there are no user ids or the
 * user database names no home.
 */
function outsideGates(changes: Partial<OutsideGates>, platform: string): OutsideGates | null {
  const uid = changes.uid ?? process.getuid?.()
  if (uid === undefined) return null
  const folder = changes.folder ?? theGatesFolder(platform)
  if (folder === null) return null
  return {
    lstat: lstatSync,
    stat: statSync,
    chmod: chmodSync,
    warn: (line) => console.warn(line),
    ...changes,
    folder,
    uid,
  }
}

function theGatesFolder(platform: string): string | null {
  let home: string
  try {
    home = userInfo().homedir
  } catch {
    return null
  }
  if (home === '') return null
  return platform === 'darwin'
    ? join(home, 'Library', 'Caches', 'brobot2-gates')
    : join(home, '.cache', 'brobot2-gates')
}

/** A workspace's presence endpoint, inside or outside its data folder. */
interface PosixGate {
  /** The name every launch asks. */
  readonly public: string
  /** Set when the names are in {@link OutsideGates}' folder. */
  readonly outside: OutsideGates | null
}

/** The presence endpoint for the folder, with a short external name when needed. */
function posixGate(spelled: string, platform: string, changes: Partial<OutsideGates>): PosixGate {
  const userData = onTheDisk(spelled)
  const outside = outsideGates(changes, platform)
  // With no user ids there is no private folder outside, and a name too long here is never claimed.
  if (Buffer.byteLength(join(userData, 'one-host.sock')) <= socketPathMax(platform) || !outside) {
    return {
      public: join(userData, 'one-host.sock'),
      outside: null,
    }
  }
  const stem = join(outside.folder, digest(userData))
  return {
    public: `${stem}.sock`,
    outside,
  }
}

/** The folder as it is on the disk; as spelled when that cannot be read, as for one not made yet. */
function onTheDisk(spelled: string): string {
  try {
    return realpathSync.native(spelled)
  } catch {
    return spelled
  }
}

function namesFit(gate: PosixGate, platform: string): boolean {
  return Buffer.byteLength(gate.public) <= socketPathMax(platform)
}

/**
 * Whether the folder of gates outside their data folders is this user's: a folder owned by this
 * user, or a link the person made to one. Made first when `make` is set. A folder others may enter
 * is made private again, and used either way: the name in it must still be this user's socket.
 */
function thePrivateFolder(
  outside: OutsideGates,
  make: boolean,
): 'private' | 'absent' | 'not-private' {
  if (make) {
    try {
      mkdirSync(outside.folder, { recursive: true, mode: 0o700 })
    } catch {
      return 'not-private'
    }
  }
  let seen: GateEntry
  try {
    seen = outside.lstat(outside.folder)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'not-private'
  }
  if (!seen.isDirectory()) {
    try {
      seen = outside.stat(outside.folder)
    } catch {
      return 'not-private'
    }
    if (!seen.isDirectory()) return 'not-private'
  }
  if (seen.uid !== outside.uid) return 'not-private'
  if ((seen.mode & 0o077) !== 0) {
    try {
      outside.chmod(outside.folder, 0o700)
    } catch (error) {
      outside.warn(
        `BroCrew uses ${outside.folder} though others may enter it: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return 'private'
}

/** What is at a public name outside the data folder: nothing, this user's socket, or anything else. */
function atThePublicName(path: string, outside: OutsideGates): 'nothing' | 'ours' | 'not-ours' {
  try {
    const seen = outside.lstat(path)
    return seen.isSocket() && seen.uid === outside.uid ? 'ours' : 'not-ours'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'nothing' : 'not-ours'
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** What a listener says to anyone who connects: who it is, and nothing else. */
type Answer =
  /** Somebody is there, and this is their token. */
  | { kind: 'token'; token: string }
  /** Nothing is there. On POSIX that means the path is an artefact of a process that has gone. */
  | { kind: 'silent' }
  /** It neither answered nor refused. ⛔ Undecidable, so the caller must fail open. */
  | { kind: 'unclear' }

/**
 * Listen at `path`, answering every caller with `token`.
 *
 * ⛔ **The `error` handler is PERMANENT, not `once`.** A listening server that emits `error` with
 * nothing attached throws out of the event loop, and this one lives for the whole life of the
 * process — so a transient accept failure would take the app down on behalf of a gate whose worst
 * legitimate outcome is doing nothing.
 */
function listen(path: string, token: string): Promise<Server | 'in-use' | 'failed'> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      // ⚠️ `end`, so the socket is written to AND closed. A connection left open would accumulate
      // one file descriptor per launch that ever asked.
      socket.end(token)
      socket.on('error', () => {})
    })
    const settle = (answer: Server | 'in-use' | 'failed'): void => {
      clearTimeout(timer)
      resolve(answer)
    }
    const timer = setTimeout(() => {
      server.close()
      settle('failed')
    }, ANSWER_MS)
    timer.unref()
    server.on('error', (error: NodeJS.ErrnoException) => {
      settle(error.code === 'EADDRINUSE' ? 'in-use' : 'failed')
    })
    server.once('listening', () => settle(server))
    server.listen(path)
  })
}

/** Ask whoever is at `path` who they are. */
async function ask(path: string): Promise<Answer> {
  const first = await askOnce(path, ANSWER_MS)
  if (first.kind !== 'timeout') return first
  const retry = await askOnce(path, RETRY_ANSWER_MS)
  return retry.kind === 'timeout' ? { kind: 'unclear' } : retry
}

/** Ask once, keeping a timeout distinct from an empty reply or a refused connection. */
function askOnce(path: string, timeoutMs: number): Promise<Answer | { kind: 'timeout' }> {
  return new Promise((resolve) => {
    let said = ''
    const socket = connect(path)
    const settle = (answer: Answer | { kind: 'timeout' }): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs)
    timer.unref()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => (said += chunk))
    // ⚑ A connection that opened and said NOTHING is not a BroBot: something else has this name,
    // and taking it from them is not ours to do.
    socket.on('end', () =>
      settle(said === '' ? { kind: 'unclear' } : { kind: 'token', token: said }),
    )
    socket.on('error', () => settle({ kind: 'silent' }))
  })
}

/**
 * The longest a gate's socket path may be, in bytes, with room for the final NUL: macOS keeps 104
 * for it, Linux 108. A folder too long for it keeps its gate outside it (see {@link hostGatePath}).
 * A Windows pipe has no such limit.
 */
export function socketPathMax(platform: string): number {
  return platform === 'darwin' ? 103 : 107
}

/**
 * Whether a BroBot runs on `userData` now, for the chooser: its gate is asked exactly as a second
 * launch asks it, and a BroBot there answers with its token. `open`, `closed` (nothing listens), or
 * `unknown`: no answer in time, names too long to reach, or a gate outside the folder that fails
 * the checks a claim makes there. The listener is published after the OS lock is held.
 */
export async function whoIsOn(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): Promise<'open' | 'closed' | 'unknown'> {
  const heard = (answer: Answer): 'open' | 'closed' | 'unknown' =>
    answer.kind === 'token' ? 'open' : answer.kind === 'silent' ? 'closed' : 'unknown'
  if (platform === 'win32') return heard(await ask(hostGatePath(userData, platform)))
  const gate = posixGate(userData, platform, outside)
  if (!namesFit(gate, platform)) return 'unknown'
  if (gate.outside !== null) {
    const folder = thePrivateFolder(gate.outside, false)
    if (folder !== 'private') return folder === 'absent' ? 'closed' : 'unknown'
    const there = atThePublicName(gate.public, gate.outside)
    if (there !== 'ours') return there === 'nothing' ? 'closed' : 'unknown'
  }
  return heard(await ask(gate.public))
}

/** Publish presence only after Electron has granted ownership of this data folder. */
export async function publishWorkspacePresence(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): Promise<void> {
  const token = randomUUID()
  let path: string
  let external = false
  if (platform === 'win32') path = hostGatePath(userData, platform)
  else {
    const gate = posixGate(userData, platform, outside)
    if (!namesFit(gate, platform)) throw new Error('The workspace presence path is too long.')
    if (gate.outside !== null) {
      if (
        thePrivateFolder(gate.outside, true) !== 'private' ||
        atThePublicName(gate.public, gate.outside) === 'not-ours'
      )
        throw new Error('The workspace presence path could not be used.')
      external = true
    }
    path = gate.public
    // Only the OS-lock owner publishes here. The prior process may have left its socket name.
    try {
      if (lstatSync(path).isSocket()) unlinkSync(path)
      else throw new Error('The workspace presence path is not a socket.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const bound = await listen(path, token)
  if (typeof bound === 'string') throw new Error(`The workspace presence listener ${bound}.`)
  keep(bound)
  if (external) letGoAtExit(path)
}

/** Which file this name refers to right now, or null when it refers to none. */
function identityOf(path: string): string | null {
  try {
    const seen = statSync(path)
    return `${String(seen.dev)}:${String(seen.ino)}`
  } catch {
    return null
  }
}

/** Hold the listener for this process's lifetime — see {@link holding}. */
function keep(server: Server): void {
  server.unref()
  holding.add(server)
}

/** The public names outside their data folders this process holds, each with its file's identity. */
const heldOutside = new Map<string, string>()

/**
 * Removes a public name outside its data folder as this process exits, while it is still this
 * process's own socket. Nothing else removes a name there, so every long folder ever opened would
 * otherwise leave one behind for good.
 */
function letGoAtExit(path: string): void {
  const ours = identityOf(path)
  if (ours === null) return
  if (heldOutside.size === 0) {
    process.once('exit', () => {
      for (const [name, identity] of heldOutside) {
        if (identityOf(name) === identity) tidy(name)
      }
    })
  }
  heldOutside.set(path, ours)
}

/** Remove a name, and say whether it is gone — a failure here is a reason to fail open. */
function tidy(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch (error) {
    // Already gone is the outcome we wanted; anything else is a permission or a mount we should
    // not be arguing with at startup.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
