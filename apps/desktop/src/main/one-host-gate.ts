import { createHash, randomUUID } from 'node:crypto'
import {
  linkSync,
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

/**
 * ⛔ **The cross-process backstop Chromium's own lock does not give us** (236 §3, from `231` #4).
 *
 * ## The measurement this exists for, made before it was built
 *
 * `202` §7 recorded *"same instant → 3 / 12 trials with BOTH `requestSingleInstanceLock()` true"*
 * and `209` recorded the residual. ⚑ **Re-measured at 236 with `scripts/one-app-probe.mjs`:
 * 8 / 24, with `+50 ms` and `+200 ms` clean at 0 / 4 each and a positive control at 2 / 2.** The
 * rate did not shrink over a hundred dispatches — it is roughly one launch pair in three — so a
 * double-click repeated fast enough, or a launcher that starts two, can still put two hosts on one
 * database, which is the very thing `198` exists to prevent.
 *
 * ⚠️ **The first shape of that probe was wrong and its own controls caught it**: it recorded the
 * verdict and exited, so `+200 ms` came back 4 / 4 both-true — two launches that never overlapped.
 * Every launch holds the lock for 2.5 s now. A rate measured by an instrument nobody checked is
 * exactly what the dispatch says a fix would be aimed at.
 *
 * ## ⛔ Why a LISTENER and not a lock file
 *
 * `single-instance.ts` says in as many words that it adds no lock of its own, because *"a second
 * gate we invented is a second gate that can go stale, and `191` M5 is already the report of one
 * that has"* — a durable ownership lease that bricked provisioning until a file was hand-deleted.
 * ⚠️ **That objection is about STALENESS, and it rules out every design whose liveness is a guess.**
 *
 *  - **A pid file** is the obvious one and it is the one `191` M5 was. A pid outlives nothing it
 *    can prove: after a SIGKILL the file remains, and `process.kill(pid, 0)` answers "alive" the
 *    moment that pid is reused by anything at all — at which point BroBot refuses to start and the
 *    only way out is deleting a file by hand.
 *  - **A listening socket** cannot go stale, because the kernel closes it when the process dies and
 *    asking is a decision rather than an inference: something answers, or nothing does.
 *
 * ## 🔴 The unlink race, which the first version of this file lost — every launch
 *
 * ⛔ **A POSIX socket leaves its PATH behind, and a clean quit leaves it too**, so "the path exists
 * but nothing answers" is not a rare corner: **it is the normal state of every launch after the
 * first.** The obvious algorithm — bind, and on `EADDRINUSE` connect, and if nothing answers unlink
 * and bind again — therefore runs its stale branch every time, and two simultaneous launches both
 * take it: both unlink, both bind, and the one that unlinks second removes the other's file. ⚠️ A
 * backstop that holds only on the first launch of a fresh directory is a guard nobody is guarded
 * by, which is the exact shape this dispatch is about.
 *
 * ⚑ **So the path is claimed with `link`, which is atomic, and then VERIFIED.** Each process binds
 * a socket at a private name only it knows, hard-links that name to the shared one — `link` fails
 * with `EEXIST` rather than overwriting, so of two arrivals exactly one wins — and then asks the
 * shared name who is there. ⛔ **The verification is what closes the double-unlink case**: if the
 * other process removed our link and put its own in place, the answer comes back with somebody
 * else's token and we stand down. Owning the name for a moment is not the same as owning it, and
 * only asking can tell those apart.
 *
 * ⚠️ **Windows takes the simple path, and correctly.** A named pipe is not a filesystem entry, it
 * cannot be hard-linked, and it cannot be stale — it dies with the process that made it — so `bind`
 * alone is already the atomic claim there, and the stale branch is unreachable rather than skipped.
 *
 * ## 🔴 Fail-open, by construction, so this gate can never be the one that bricks
 *
 * ⛔ **Every outcome that is not "someone else answered" is {@link HostGateVerdict} `unknown`, and
 * `unknown` proceeds.** A refused bind we cannot explain, a link we are not allowed to make, a
 * connection that neither answers nor fails inside {@link ANSWER_MS} — all of them land the app
 * exactly where it is today, with Chromium's lock and nothing else. ⚑ **So the worst this gate can
 * do is nothing**, which is the only way to add a second gate over a first one that has already
 * cost this project a hand-deleted file. `180` made the same argument for its own and chose the
 * same direction.
 */
export type HostGateVerdict =
  /** Nothing else holds this `userData`. The caller runs the app. */
  | 'sole'
  /** Another live BroBot answered on this `userData`'s socket. The caller stands down. */
  | 'taken'
  /** We could not decide. ⛔ The caller RUNS — see the fail-open note above. */
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

/**
 * How many times a claim may be taken away from us before we stop arguing about it.
 *
 * ⚠️ Every round is one atomic `link` and one local connect, and exactly one of two racing
 * processes wins each round — so this is a bound on a loop that converges, not a retry budget for
 * a flaky operation. See {@link claimed} for the measurement that put it above one.
 */
const ROUNDS = 3

/**
 * ⛔ **There is no `release`, and that is a decision** (236 §3).
 *
 * ⚠️ **The kernel is the release** — the listener dies with the process, which is the whole reason
 * this mechanism was chosen over a lease. What survives on POSIX is the path, and the next launch
 * breaks it on the evidence of an unanswered connection. A `release()` written for tidiness and
 * called by nobody would be the dead function this dispatch's §2 is about. Outside its data folder
 * a name is also removed as its process exits ({@link letGoAtExit}), so that folder does not fill
 * with names; whether a gate is live never depends on that.
 *
 * ⛔ **The servers are held here, and `unref`'d.** Held, because a listening server nothing
 * references may be collected and closed, and a gate that quietly stopped answering would let the
 * next launch through. `unref`'d, because a gate that kept the process alive would be a gate that
 * changed when the app can exit.
 */
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
  return { lstat: lstatSync, ...changes, folder, uid }
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

/** A POSIX gate's two names, and the checks they need when they are outside their folder. */
interface PosixGate {
  /** The name every launch asks. */
  readonly public: string
  /** The name a claim binds first, known only to the claiming process. */
  readonly privateName: (token: string) => string
  /** Set when the names are in {@link OutsideGates}' folder. */
  readonly outside: OutsideGates | null
}

/**
 * The gate of the folder `spelled` names. Its names sit side by side on one filesystem, so `link`
 * can give the privately bound socket the public name.
 */
function posixGate(spelled: string, platform: string, changes: Partial<OutsideGates>): PosixGate {
  const userData = onTheDisk(spelled)
  const outside = outsideGates(changes, platform)
  // With no user ids there is no private folder outside, and a name too long here is never claimed.
  if (Buffer.byteLength(join(userData, 'one-host.sock')) <= socketPathMax(platform) || !outside) {
    return {
      public: join(userData, 'one-host.sock'),
      privateName: (token) => join(userData, `.oh-${digest(token).slice(0, 8)}`),
      outside: null,
    }
  }
  const stem = join(outside.folder, digest(userData))
  return {
    public: `${stem}.sock`,
    privateName: (token) => `${stem}-${digest(token).slice(0, 8)}`,
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

/**
 * Whether both of a gate's names fit a socket path. Inside the folder the public name is the
 * longer, outside it the private one; a gate whose longer name does not fit cannot be claimed.
 */
export function gateFits(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): boolean {
  if (platform === 'win32') return true
  return namesFit(posixGate(userData, platform, outside), platform)
}

function namesFit(gate: PosixGate, platform: string): boolean {
  const longest = Math.max(Buffer.byteLength(gate.public), Buffer.byteLength(gate.privateName('')))
  return longest <= socketPathMax(platform)
}

/**
 * Whether the folder of gates outside their data folders is this user's alone: a real folder, not
 * a link, owned by this user, with no permission for anyone else. Made first when `make` is set.
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
  return seen.isDirectory() && seen.uid === outside.uid && (seen.mode & 0o077) === 0
    ? 'private'
    : 'not-private'
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
 * the checks a claim makes there. The gate is found where {@link claimSoleHost} puts it.
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

/**
 * Claim this `userData` for this process, or find out that another live BroBot already has it.
 *
 * See the module note for why the POSIX path binds privately and then links, and why the answer is
 * verified rather than inferred from a successful claim.
 */
export async function claimSoleHost(
  userData: string,
  platform: string = process.platform,
  outside: Partial<OutsideGates> = {},
): Promise<HostGateVerdict> {
  const token = randomUUID()
  if (platform === 'win32') {
    const bound = await listen(hostGatePath(userData, platform), token)
    if (typeof bound !== 'string') return keep(bound)
    // A pipe cannot outlive its owner, so in-use means exactly what it says.
    return bound === 'in-use' ? 'taken' : 'unknown'
  }

  const gate = posixGate(userData, platform, outside)
  if (!namesFit(gate, platform)) return 'unknown'
  if (gate.outside !== null && thePrivateFolder(gate.outside, true) !== 'private') return 'unknown'
  // Bound at a name only this process knows, so nothing races us for it; `link` below is where the
  // claim happens.
  const mine = gate.privateName(token)
  const bound = await listen(mine, token)
  if (typeof bound === 'string') return 'unknown'
  const verdict = await claimed(mine, gate.public, token, gate.outside)
  // ⛔ **Only the sole instance keeps a listener.** A server left running on a name nothing links
  // to would answer nobody and hold a descriptor for the life of the process — and, worse, would
  // make this module look like it was guarding something.
  if (verdict === 'sole') keep(bound)
  else bound.close()
  // The socket stays bound to its inode; `path` is its public name now, and the private one has
  // done its job. Left behind it would be one file per launch.
  tidy(mine)
  if (verdict === 'sole' && gate.outside !== null) letGoAtExit(gate.public)
  return verdict
}

/**
 * The claim and its verification, so {@link claimSoleHost} can own the listener's fate.
 *
 * ⛔ **Winning the link is not owning the name.** Two processes that both broke the same stale path
 * can both have linked; the one whose link was removed is still listening on a socket nobody can
 * reach. Only the answer at the shared name says which of those we are.
 *
 * ## 🔴 The two things the probe found here, neither of which reasoning had produced
 *
 * ⚠️ **Measured with `PROBE_ONLY=gate`: over a directory a finished run had left a path in — which
 * is every launch after the first — two same-instant claims BOTH ran 4 times in 12.** Traced, the
 * failing shape is an `unlink` that was DECIDED about one file and PERFORMED on another:
 *
 *  1. Both find the old artefact and ask it; both hear nothing; both conclude "stale".
 *  2. One of them removes it, links its own socket, asks, hears itself, and is sole — correctly.
 *  3. The other then performs the removal it decided on in step 1, and takes away the winner's
 *     link. It links its own, asks, hears itself, and is also sole.
 *
 * ⛔ **Step 3 removes a name that is not the name it tested**, and no amount of re-asking afterwards
 * can see it: the loser's verification passed, and it was true when it was made.
 *
 * ⚑ **So the removal is guarded by the file's identity.** The `dev`/`ino` pair is read before the
 * question and again immediately before the `unlink`, with two adjacent syscalls between them
 * rather than a whole connect round trip — and a name that changed under us is not removed at all;
 * we simply look again. ⚠️ POSIX has no atomic *"unlink if it is this inode"*, so this narrows the
 * window rather than closing it, and the retry is what makes narrow enough.
 *
 * ⛔ **A TIMEOUT is different from silence and still fails open** — something is at the name and
 * will not say what, which is not ours to take.
 *
 * Outside the data folder, whatever is at the public name is first checked to be this user's own
 * socket: anything else there is neither asked, broken nor believed, and the answer is `unknown`.
 */
async function claimed(
  mine: string,
  path: string,
  token: string,
  outside: OutsideGates | null,
): Promise<HostGateVerdict> {
  const notOurs = (): boolean => outside !== null && atThePublicName(path, outside) === 'not-ours'
  for (let round = 0; round < ROUNDS; round += 1) {
    const linked = link(mine, path)
    if (linked === 'failed') return 'unknown'
    if (notOurs()) return 'unknown'
    if (linked === 'in-use') {
      // ⚠️ Read BEFORE the question, because the question is what takes time.
      const was = identityOf(path)
      const there = await ask(path)
      if (there.kind === 'token') return 'taken'
      if (there.kind === 'unclear') return 'unknown'
      // Silent: an artefact — unless what is there now is not what was asked.
      if (was !== null && identityOf(path) === was && !tidy(path)) return 'unknown'
      continue
    }
    const there = await ask(path)
    if (there.kind === 'token') return there.token === token ? 'sole' : 'taken'
    if (there.kind === 'unclear') return 'unknown'
    // ⛔ Silent at our OWN link means the link is gone: somebody took the name while we were
    // asking. That is a fact about a live competitor, not an undecidable one — so we claim again.
  }
  return 'unknown'
}

/** `link`, with its one interesting failure named. */
function link(mine: string, path: string): 'linked' | 'in-use' | 'failed' {
  try {
    linkSync(mine, path)
    return 'linked'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'in-use' : 'failed'
  }
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
function keep(server: Server): HostGateVerdict {
  server.unref()
  holding.add(server)
  return 'sole'
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
