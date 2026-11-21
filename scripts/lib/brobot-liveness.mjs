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
 * How long a live host has to say its token: the app's own bound (`one-host-gate.ts:85`), not a
 * longer one, since this runs before every reset.
 */
export const ANSWER_MS = 1500

/**
 * The only two errnos that mean nothing is listening: `ENOENT` (no name) and `ECONNREFUSED` (a name
 * the kernel refuses, which is what a finished process leaves behind).
 *
 * Everything else is `unknown`: `EACCES`, `ENOTSOCK`, `ELOOP` and `EMFILE` are not evidence that
 * BroBot is stopped, and a reset must not delete on the strength of its own bad day.
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
 * Not `readProcessTable` from `owned-teardown.mjs`, which reads `pid=,ppid=` only because it feeds a
 * BFS and embedded whitespace would drop rows; this parses the two numbers off the front and takes
 * the rest verbatim. A `ps` that fails is `unknown`, never an empty table.
 *
 * @returns {{ kind: 'read', rows: { pid: number, ppid: number, command: string }[] } | { kind: 'unknown', why: string }}
 */
export function readCommandTable({ exec = execFileSync } = {}) {
  let text
  try {
    text = exec('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // Both bounds turn into `unknown`: a wedged `ps` would hang a reset meant to take under a second,
      // and a table larger than Node's default buffer throws `ENOBUFS`, which the `catch` below reports
      // as "could not ask" rather than as an empty machine.
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
  // A `ps` that answered with nothing parseable is not an empty machine: this process is in its own
  // output, so zero rows means the parse or the instrument is wrong.
  if (rows.length === 0) return { kind: 'unknown', why: 'ps answered, and no row could be parsed' }
  return { kind: 'read', rows }
}

/**
 * Every row whose command line names one of `spellings`.
 *
 * Both spellings are needed: Chromium resolves `--user-data-dir` before `app.getPath('userData')`
 * answers (`/tmp/x` comes back as `/private/tmp/x`, see `scripts/lib/smoke-run.mjs:87-92`), so the
 * app derives its paths from the real one while its argv carries what the launcher typed.
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
 * This process and every ancestor of it. Excluding only our own pid made `pnpm clean-base --dir
 * <path>` always refuse, because `pnpm` and its `sh -c` both carry the path in their command lines.
 * The chain is walked rather than assumed to have a fixed depth.
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
 * Does `command` name `path`, as a path rather than as a prefix of a longer one? `includes` alone
 * would match `/tmp/ud` against a process on `/tmp/ud2`; the character after the match has to end
 * the path or continue it downward.
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
 * Chromium's own lock inside the target: the instrument that works when argv is silent.
 *
 * Three answers. `absent` is the ordinary state after a clean quit (all three `Singleton*` names are
 * `ENOENT`). `held` names a pid; whether it is alive is the caller's question. Anything else (a
 * target that will not parse, a name that is not a symlink, a `readlink` failing for a reason other
 * than absence) is `unknown`. A lock naming another host is `unknown` too: Chromium supports a
 * userData on a network share, and a remote pid means nothing here.
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
 * The verdict a reset acts on: `running`, `not-running`, or `unknown`.
 *
 * Takes a named target rather than a positional array, so it is explicit which spelling probes the
 * socket. Three instruments, any one of which refuses: the one-host gate, the process table, and
 * Chromium's `SingletonLock` (the process table is blind on the default userData).
 *
 * `not-running` is a narrow claim: a provider child holds its home through `CODEX_HOME` /
 * `CLAUDE_CONFIG_DIR` in its environment, which no process table shows, so a detached child
 * orphaned by a crash names this userData nowhere.
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
    // Anything that is not one of the two known kinds, including a kind added later, is `unknown`: a
    // `switch` with a silent default is how a third state becomes two again.
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
    // A lock naming a pid that is gone is what a crash leaves behind. Said out loud rather than
    // swallowed: it hints that the last run did not end cleanly.
    reasons.push(
      `Chromium's SingletonLock names pid ${String(lock.pid)}, which is not in the table — a crash left it behind`,
    )
  } else {
    reasons.push('no SingletonLock, which is what a clean quit leaves')
  }
  return { verdict: 'not-running', reasons, processes: [] }
}
