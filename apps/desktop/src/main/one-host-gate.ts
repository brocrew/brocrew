import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync, statSync, unlinkSync, type Stats } from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type {
  UpdateWorkspace,
  UpdateWorkspaceId,
  WorkspaceUpdateRequest,
} from './update-workspaces'

export interface WorkspaceUpdateConnection {
  details(): UpdateWorkspace
  receive(request: WorkspaceUpdateRequest): Promise<void>
}

/** Workspace presence for the chooser. Startup ownership comes from Electron's OS lock. */
export type HostGateVerdict =
  /** The launch holds Electron's OS lock. */
  | 'sole'
  /** The OS lock was not acquired. */
  | 'taken'
  /** No lock decision is available to this caller. */
  | 'unknown'

/**
 * Bound listener startup and presence queries: a full socket backlog can leave a connection
 * pending indefinitely.
 */
const ANSWER_MS = 1500

/** A timed-out question gets one retry with more time for a busy host to answer. */
const RETRY_ANSWER_MS = 3000

/** Presence listeners are held for the process lifetime without keeping it alive. */
const holding = new Set<Server>()

/**
 * One presence endpoint per data folder keeps separate workspaces and test profiles independent.
 * Windows uses a pipe name derived from the directory; its digest only distinguishes directories.
 * POSIX resolves directory aliases and uses {@link OutsideGates} when the socket path would exceed
 * {@link socketPathMax}, so long workspace paths still have a reachable endpoint.
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
 * External sockets use the home from the OS user database so launches with different HOME or
 * TMPDIR values still find the same endpoint. Socket kind, liveness and the protocol identify
 * presence; filesystem ownership does not supply that answer.
 */
export interface OutsideGates {
  /** `~/Library/Caches/brobot2-gates` on macOS, `~/.cache/brobot2-gates` elsewhere. */
  readonly folder: string
  readonly lstat: (path: string) => GateEntry
  /** Where a link the person made at the folder leads. */
  readonly stat: (path: string) => GateEntry
}

/** Filesystem facts used to locate a presence socket. */
type GateEntry = Pick<Stats, 'uid' | 'mode' | 'isDirectory' | 'isSocket'>

/**
 * This user's {@link OutsideGates}, with a test's changes; null when the user database names no home.
 */
function outsideGates(changes: Partial<OutsideGates>, platform: string): OutsideGates | null {
  const folder = changes.folder ?? theGatesFolder(platform)
  if (folder === null) return null
  return {
    lstat: lstatSync,
    stat: statSync,
    ...changes,
    folder,
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
  // Without a home for the outside folder, a name too long here is never claimed.
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
 * Whether the outside gate folder exists as a directory, following a link the person made.
 * Create it first when `make` is set; actual filesystem errors prevent its use.
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
  return 'private'
}

/** What is at a public name outside the data folder: nothing, a socket, or anything else. */
function atThePublicName(path: string, outside: OutsideGates): 'nothing' | 'ours' | 'not-ours' {
  try {
    const seen = outside.lstat(path)
    return seen.isSocket() ? 'ours' : 'not-ours'
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
  /** No definite presence answer. */
  | { kind: 'unclear' }

/**
 * Listen at `path`, answering every caller with `token`.
 *
 * Keep the error handler attached for the listener's lifetime: an unhandled accept error would
 * otherwise terminate the process after startup has settled.
 */
function listen(
  path: string,
  token: string,
  updates?: WorkspaceUpdateConnection,
): Promise<Server | 'in-use' | 'failed'> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on('error', () => {})
      if (updates === undefined) {
        socket.end(token)
        return
      }
      socket.write(`${JSON.stringify({ ...updates.details(), token, updateProtocol: 1 })}\n`)
      // Older presence callers wait for EOF instead of reading the first line.
      socket.setTimeout(ANSWER_MS, () => socket.end())
      socket.setEncoding('utf8')
      let request = ''
      socket.on('data', (chunk: string) => {
        request += chunk
        if (!request.includes('\n')) return
        socket.setTimeout(0)
        socket.removeAllListeners('data')
        void Promise.resolve()
          .then(() => updates.receive(JSON.parse(request) as WorkspaceUpdateRequest))
          .then(
            () => socket.end(`${JSON.stringify({ ok: true })}\n`),
            (error: unknown) =>
              socket.end(
                `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
              ),
          )
      })
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
    socket.on('data', (chunk: string) => {
      said += chunk
      const newline = said.indexOf('\n')
      if (newline >= 0) settle({ kind: 'token', token: said.slice(0, newline) })
    })
    // A listener that closes without identifying itself leaves presence unknown.
    socket.on('end', () =>
      settle(said === '' ? { kind: 'unclear' } : { kind: 'token', token: said }),
    )
    socket.on('error', (error: NodeJS.ErrnoException) =>
      settle(
        error.code === 'ECONNREFUSED' || error.code === 'ENOENT'
          ? { kind: 'silent' }
          : { kind: 'unclear' },
      ),
    )
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
  updates?: WorkspaceUpdateConnection,
): Promise<() => Promise<void>> {
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
  const bound = await listen(path, token, updates)
  if (typeof bound === 'string') throw new Error(`The workspace presence listener ${bound}.`)
  keep(bound)
  if (external) letGoAtExit(path)
  return () =>
    new Promise((resolve, reject) => {
      holding.delete(bound)
      bound.close((error) => (error ? reject(error) : resolve()))
    })
}

/** A live older workspace is an unsupported participant, never a closed one. */
export async function readWorkspaceForUpdate(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): Promise<UpdateWorkspace | null> {
  const answer = await ask(hostGatePath(userData, platform, outside))
  if (answer.kind === 'silent') return null
  if (answer.kind === 'token') {
    try {
      const value = JSON.parse(answer.token) as UpdateWorkspace & { updateProtocol?: number }
      if (value.updateProtocol === 1) return value
    } catch {
      // A legacy presence reply is a token rather than an update participant.
    }
  }
  throw new Error(`BroCrew could not prepare the running workspace ${userData}`)
}

/** Preparation has no deadline: only a completed reply acknowledges saved drafts and teardown. */
export function requestWorkspaceUpdate(
  peer: UpdateWorkspaceId,
  request: WorkspaceUpdateRequest,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(hostGatePath(peer.folder, platform, outside))
    let buffer = ''
    let identified = false
    let acknowledged = false
    let refused = false
    const timer = setTimeout(
      () => socket.destroy(new Error(`BroCrew could not reach ${peer.folder}`)),
      ANSWER_MS,
    )
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const value = JSON.parse(line) as UpdateWorkspace & { ok?: boolean; error?: string }
          if (!identified) {
            if (value.pid !== peer.pid || value.folder !== peer.folder) {
              throw new Error(`The workspace ${peer.folder} restarted while preparing the update`)
            }
            identified = true
            clearTimeout(timer)
            socket.write(`${JSON.stringify(request)}\n`)
          } else {
            if (value.error !== undefined) {
              refused = true
              throw new Error(value.error)
            }
            if (value.ok !== true)
              throw new Error('The workspace did not finish preparing the update')
            acknowledged = true
            socket.end()
            resolve()
          }
        } catch (error) {
          socket.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
    socket.on('error', (error) =>
      reject(Object.assign(error, { updateRequestSent: identified && !refused })),
    )
    socket.on('close', () => {
      clearTimeout(timer)
      if (!acknowledged)
        reject(
          Object.assign(
            new Error(`The workspace ${peer.folder} closed before acknowledging the update`),
            { updateRequestSent: identified && !refused },
          ),
        )
    })
  })
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

/** Remove a socket name and report whether it is gone. */
function tidy(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch (error) {
    // An absent socket is already clean; other filesystem failures leave cleanup unsuccessful.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
