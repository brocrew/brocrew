import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import { connect } from 'node:net'
import { hostname } from 'node:os'
import { join } from 'node:path'

/**
 * Determine whether a BroBot is running on this userData: running, stopped or unknown.
 * A destructive caller must refuse unknown, never interpret an observation failure as stopped.
 *
 * Use three independent observations. A live gate token proves a listener, but an absent
 * socket does not prove a stopped app: binding can fail on an overlong POSIX socket path.
 * A surviving socket name does not prove liveness either. Distinguish connection errnos
 * that mean no listener from permission, descriptor, timeout and other observation failures.
 *
 * The process table sees explicit `--user-data-dir` launches but cannot name a default
 * folder absent from argv. Chromium's `<userData>/SingletonLock` symlink supplies an
 * attributable hostname/pid observation for that case. Any instrument can refuse the check.
 */

/** The name `one-host-gate.ts` links inside `userData` on POSIX. */
export const GATE_SOCKET = 'one-host.sock'

/**
 * How long a live host has to say its token. ⚠️ **The app's own bound**
 * (`one-host-gate.ts:85`), not a longer one: this runs before every reset, and the two clients that
 * chose 5 s and 10 s were waiting for an app they had just launched.
 */
export const ANSWER_MS = 1500

/**
 * ⛔ **The only two errnos that mean nothing is listening.**
 *
 * `ENOENT` — there is no name. `ECONNREFUSED` — there is a name and the kernel refuses the connect,
 * which on POSIX is precisely the artefact a finished process leaves behind and is the whole reason
 * a listening socket was chosen over a lock file.
 *
 * ⚠️ **Everything else is `unknown` and that is not a formality.** `EACCES` is a gate this user may
 * not connect to; `ENOTSOCK` is something that is not a socket wearing the gate's name; `ELOOP` is a
 * symlink chain; `EMFILE` is this process out of descriptors. None of them is evidence that BroBot
 * is not running, and a reset that read them as one would delete on the strength of its own bad day.
 */
export const NOT_LISTENING_CODES = Object.freeze(['ENOENT', 'ECONNREFUSED'])

/** How long `ps` has to answer before the answer is `unknown`. */
export const PS_TIMEOUT_MS = 5000
/** How much of a process table this will hold. Beyond it, `unknown` — never a partial table. */
export const PS_MAX_BUFFER = 16 * 1024 * 1024

/** What `one-host-gate.ts` writes: a `randomUUID()`, and nothing else ever should. */
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Connect to the gate and read whatever is said.
 *
 * @param {string} socketPath
 * @param {{ answerMs?: number, open?: typeof connect }} [options]
 * @returns {Promise<{ kind: 'answered', token: string } | { kind: 'nothing-listening', code: string } | { kind: 'unknown', why: string }>}
 */
export function askGate(socketPath, options = {}) {
  const answerMs = options.answerMs ?? ANSWER_MS
  const open = options.open ?? connect
  return new Promise((resolve) => {
    let said = ''
    let settled = false
    const socket = open(socketPath)
    const settle = (answer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(
      () =>
        settle({
          kind: 'unknown',
          why: `nothing answered within ${String(answerMs)} ms — something holds the name and will not say what`,
        }),
      answerMs,
    )
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (said += chunk))
    socket.on('end', () => {
      if (said === '') {
        settle({ kind: 'unknown', why: 'the connection opened and closed without a word' })
        return
      }
      if (!TOKEN.test(said.trim())) {
        settle({
          kind: 'unknown',
          why: `the answer was not the UUID one-host-gate.ts ends every connection with — something else owns this name`,
        })
        return
      }
      settle({ kind: 'answered', token: said.trim() })
    })
    socket.on('error', (error) => {
      const code = error?.code ?? 'no errno'
      if (NOT_LISTENING_CODES.includes(code)) {
        settle({ kind: 'nothing-listening', code })
        return
      }
      settle({ kind: 'unknown', why: `connecting failed ${code}` })
    })
  })
}

/**
 * The whole process table, with each row's full command line.
 *
 * ⚠️ **Not `readProcessTable` from `owned-teardown.mjs`**, which reads `pid=,ppid=` only — two
 * fields, on purpose, because it feeds a BFS and a command string with embedded whitespace is what
 * makes such a parse drop rows silently. This one needs the command, so it parses the two numbers
 * off the front and takes the rest verbatim.
 *
 * ⛔ **A `ps` that fails is `unknown`, never an empty table**, which is this module's whole subject.
 *
 * @returns {{ kind: 'read', rows: { pid: number, ppid: number, command: string }[] } | { kind: 'unknown', why: string }}
 */
export function readCommandTable({ exec = execFileSync } = {}) {
  let text
  try {
    text = exec('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // ⚠️ **Both bounds, and both turn into `unknown`** (351 review). Without them a wedged `ps`
      // hangs a reset that is meant to take under a second, and a process table larger than Node's
      // default buffer throws `ENOBUFS` — which is *"I could not ask"*, and the `catch` below is
      // what makes sure it is reported as that rather than as an empty machine.
      timeout: PS_TIMEOUT_MS,
      maxBuffer: PS_MAX_BUFFER,
    })
  } catch (error) {
    return { kind: 'unknown', why: `ps could not be read: ${error?.message ?? String(error)}` }
  }
  const rows = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (match === null) continue
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] })
  }
  // ⛔ A `ps` that answered with nothing parseable is not an empty machine. This process is in its
  // own output, so zero rows means the parse — or the instrument — is wrong, not that nothing runs.
  if (rows.length === 0) return { kind: 'unknown', why: 'ps answered, and no row could be parsed' }
  return { kind: 'read', rows }
}

/**
 * Every row whose command line NAMES one of `spellings`.
 *
 * ⚠️ **Both spellings of the target, and that is measured rather than defensive.** Chromium resolves
 * `--user-data-dir` before `app.getPath('userData')` answers — `/tmp/x` comes back as
 * `/private/tmp/x` (`scripts/lib/smoke-run.mjs:87-92`) — so the app DERIVES its paths from the real
 * one while its own argv still carries whatever the launcher typed. A scan for one of them misses
 * the app when the other was used.
 */
export function processesNaming(spellings, rows, { self = process.pid } = {}) {
  const wanted = [
    ...new Set(spellings.filter((value) => typeof value === 'string' && value !== '')),
  ]
  const mine = ownAncestry(rows, self)
  return rows.filter(
    (row) => !mine.has(row.pid) && wanted.some((spelling) => namesPath(row.command, spelling)),
  )
}

/**
 * ⛔ **This process AND every ancestor of it** (351 review).
 *
 * 🔴 **Excluding only our own pid made the documented invocation always refuse.** `pnpm clean-base
 * --dir <path>` runs through `pnpm` and a `sh -c`, and BOTH of their command lines contain the path
 * — so the scan found two processes "naming this userData", reported `running`, and removed nothing,
 * every single time. Measured before the fix: `⛔ refused · BroBot is running on this userData` on an
 * empty fixture directory with no app anywhere near it.
 *
 * ⚠️ **The chain is walked, not guessed at a fixed depth**: `node` under `sh` under `pnpm` under a
 * shell under the terminal is five, and a different runner is a different number.
 */
export function ownAncestry(rows, self) {
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]))
  const mine = new Set()
  let pid = self
  // `pid > 1` stops at init; `mine.has` stops a torn `ps` read that named a cycle.
  while (pid > 1 && !mine.has(pid)) {
    mine.add(pid)
    const next = parent.get(pid)
    if (next === undefined) break
    pid = next
  }
  return mine
}

/**
 * Does `command` name `path` — as a path, rather than as a prefix of a longer one?
 *
 * ⛔ **`includes` alone made `/tmp/ud` match a process on `/tmp/ud2`** (351 review), so a reset on
 * one directory refused because a different app was running on a directory whose name started the
 * same way. The character after the match has to end the path or continue it downward.
 */
export function namesPath(command, path) {
  let from = 0
  for (;;) {
    const at = command.indexOf(path, from)
    if (at === -1) return false
    const after = command[at + path.length]
    if (after === undefined || after === '/' || after === ' ' || after === '"' || after === "'") {
      return true
    }
    from = at + 1
  }
}

/** `<hostname>-<pid>`, which is what Chromium's ProcessSingleton links `SingletonLock` to. */
const SINGLETON_TARGET = /^(.*)-(\d+)$/

/**
 * 🔴 **The instrument that works when argv is silent** — Chromium's own lock, inside the target.
 *
 * ⚠️ **Three answers, like everything else here.** `absent` is the ordinary state after a clean quit
 * (measured: all three `Singleton*` names are `ENOENT` once the app is down). `held` names a pid,
 * and whether that pid is alive is the caller's question. Anything else — a target that will not
 * parse, a name that is not a symlink, a `readlink` that fails for a reason other than absence — is
 * `unknown`, because something is at a name Chromium owns and this cannot say what.
 *
 * ⛔ **A lock naming another HOST is `unknown`, not `held`.** Chromium supports a userData on a
 * network share; a pid from another machine means nothing here and must not be evaluated as if it
 * were local.
 */
export function readSingletonLock(userData, { readLink = readlinkSync, host = hostname() } = {}) {
  let target
  try {
    target = readLink(join(userData, 'SingletonLock'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { kind: 'absent' }
    if (error?.code === 'EINVAL') {
      return { kind: 'unknown', why: 'SingletonLock is there and is not a symlink' }
    }
    return { kind: 'unknown', why: `SingletonLock could not be read: ${error?.code ?? 'unknown'}` }
  }
  const match = SINGLETON_TARGET.exec(target)
  if (match === null) {
    return { kind: 'unknown', why: `SingletonLock points at ${JSON.stringify(target)}` }
  }
  if (match[1] !== host) {
    return {
      kind: 'unknown',
      why: `SingletonLock was written by ${match[1]}, not by this machine — its pid is not ours to judge`,
    }
  }
  return { kind: 'held', pid: Number(match[2]), host: match[1] }
}

/**
 * 🔴 **The verdict a reset acts on** — `running`, `not-running`, or `unknown`.
 *
 * ⚠️ **A named target, not a positional array** (351 review). The first draft took
 * `spellings[0]` for the socket path and the rest for the argv scan, so the ORDER of two
 * indistinguishable strings decided which directory was probed, and nothing said so.
 *
 * ⛔ **Three instruments and any one of them refuses**: the one-host gate, the process table, and
 * Chromium's `SingletonLock`. The third exists because the second is structurally blind on the
 * default userData — see the module header.
 *
 * ⚠️ **`not-running` is still the narrow claim it sounds like.** ⛔ It is not a claim that nothing
 * this app started is still alive: a provider child holds its home through `CODEX_HOME` /
 * `CLAUDE_CONFIG_DIR` in its ENVIRONMENT, which no process table shows, so a detached child orphaned
 * by a crash names this userData nowhere. That is `350` §4.3's unclosed product fact; this reports
 * it as a limit rather than covering it.
 *
 * @param {{ lexical: string, real: string }} target the two spellings of one directory
 * @returns {Promise<{ verdict: 'running'|'not-running'|'unknown', reasons: string[], processes: {pid:number,command:string}[] }>}
 */
export async function whatIsRunning(
  target,
  {
    ask = askGate,
    readTable = readCommandTable,
    readLock = readSingletonLock,
    answerMs = ANSWER_MS,
    self = process.pid,
  } = {},
) {
  const reasons = []
  const spellings = [target.lexical, target.real]
  const socket = join(target.real, GATE_SOCKET)

  const gate = await ask(socket, { answerMs })
  if (gate.kind === 'answered') {
    return {
      verdict: 'running',
      reasons: [`a live BroBot answered on ${socket} — quit it first`],
      processes: [],
    }
  }
  if (gate.kind !== 'nothing-listening') {
    // ⛔ Anything that is not one of the two known kinds — including a kind added later and not
    // handled here — is `unknown`. A `switch` with a silent default is how a third state becomes
    // two again.
    return {
      verdict: 'unknown',
      reasons: [`the one-host gate: ${gate.why ?? `unrecognised answer ${gate.kind}`}`],
      processes: [],
    }
  }
  reasons.push(
    gate.code === 'ENOENT'
      ? 'no gate socket in the userData directory'
      : 'the gate socket is there and nothing listens on it (ECONNREFUSED — the artefact a finished process leaves behind)',
  )

  const table = readTable()
  if (table.kind !== 'read') {
    return { verdict: 'unknown', reasons: [...reasons, table.why], processes: [] }
  }
  const naming = processesNaming(spellings, table.rows, { self })
  if (naming.length > 0) {
    return {
      verdict: 'running',
      reasons: [
        ...reasons,
        `${String(naming.length)} process(es) name this userData in their command line`,
      ],
      processes: naming.map((row) => ({ pid: row.pid, command: row.command })),
    }
  }
  reasons.push(`no process in the table names it (${String(table.rows.length)} rows read)`)

  const lock = readLock(target.real)
  if (lock.kind === 'unknown') {
    return { verdict: 'unknown', reasons: [...reasons, lock.why], processes: [] }
  }
  if (lock.kind === 'held') {
    const holder = table.rows.find((row) => row.pid === lock.pid)
    if (holder !== undefined) {
      return {
        verdict: 'running',
        reasons: [
          ...reasons,
          `Chromium's SingletonLock names pid ${String(lock.pid)}, which is alive`,
        ],
        processes: [{ pid: holder.pid, command: holder.command }],
      }
    }
    // ⚠️ A lock naming a pid that is gone is what a crash leaves behind. Said out loud rather than
    // swallowed: it is the one thing on this path that hints the last run did not end cleanly.
    reasons.push(
      `Chromium's SingletonLock names pid ${String(lock.pid)}, which is not in the table — a crash left it behind`,
    )
  } else {
    reasons.push('no SingletonLock, which is what a clean quit leaves')
  }
  return { verdict: 'not-running', reasons, processes: [] }
}
