import { linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  askGate,
  GATE_SOCKET,
  NOT_LISTENING_CODES,
  namesPath,
  ownAncestry,
  processesNaming,
  readCommandTable,
  readSingletonLock,
  whatIsRunning,
} from '../lib/brobot-liveness.mjs'

/**
 * 🔴 **Three states, and the whole file is about the two that used to be one** (351).
 *
 * ⚠️ Sockets live under `/tmp` rather than `tmpdir()`: macOS's `sun_path` holds 103 bytes and
 * `os.tmpdir()` alone is 48 of them, which is the trap `241` §3 and `242` spent a hundred dispatches
 * inside. A fixture that cannot bind would make every negative below pass for the wrong reason.
 */
const roots = []
const servers = []
// Windows uses a named pipe instead of a Unix socket file and has no POSIX ps or SingletonLock.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe
const itOnPosix = process.platform === 'win32' ? it.skip : it
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve))
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'b351-live-'))
  roots.push(root)
  if (process.platform !== 'win32') {
    expect(join(root, GATE_SOCKET).length, 'the fixture socket path is over sun_path').toBeLessThan(
      104,
    )
  }
  return root
}

/** A listener at `path` that says `says` and closes, exactly as `one-host-gate.ts` does. */
function listenSaying(path, says) {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      if (says === null) socket.end()
      else socket.end(says)
      socket.on('error', () => {
        // a client that hung up first is not this fixture's problem
      })
    })
    servers.push(server)
    server.listen(path, () => resolve(server))
  })
}

const UUID = '81434f1f-f967-482f-93c3-799c8bd6d504'

describeOnPosix('the gate, asked the way a caller that DELETES has to ask', () => {
  it('a live host answering with its token is `answered`', async () => {
    const root = fixture()
    await listenSaying(join(root, GATE_SOCKET), UUID)
    expect(await askGate(join(root, GATE_SOCKET))).toEqual({ kind: 'answered', token: UUID })
  })

  it('⚑ no name at all is `nothing-listening` ENOENT — the ordinary case, and it is not an error', async () => {
    const root = fixture()
    expect(await askGate(join(root, GATE_SOCKET))).toEqual({
      kind: 'nothing-listening',
      code: 'ENOENT',
    })
  })

  /**
   * Reproduce the gate's hard-linked socket names. Closing the bound private name leaves the public
   * link behind, so a leftover path after exit must mean nothing is listening, not a liveness error.
   */
  it('⚑ a socket whose listener is gone is `nothing-listening` ECONNREFUSED', async () => {
    const root = fixture()
    const server = await listenSaying(join(root, 'priv.sock'), UUID)
    linkSync(join(root, 'priv.sock'), join(root, GATE_SOCKET))
    await new Promise((resolve) => server.close(resolve))
    servers.splice(servers.indexOf(server), 1)

    expect(await askGate(join(root, GATE_SOCKET))).toEqual({
      kind: 'nothing-listening',
      code: 'ECONNREFUSED',
    })
  })

  it('⛔ something that is NOT a socket wearing the gate name is `unknown`, not absence', async (ctx) => {
    // ⚠️ **darwin only** (T-001): a Mac says `ENOTSOCK` for a connect to a file; Linux says `ECONNREFUSED`.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const root = fixture()
    writeFileSync(join(root, GATE_SOCKET), 'not a socket')
    const said = await askGate(join(root, GATE_SOCKET))
    expect(said.kind, `a regular file at the name read as ${said.kind}`).toBe('unknown')
    expect(NOT_LISTENING_CODES).not.toContain('ENOTSOCK')
  })

  it('⛔ a listener that opens and says nothing is `unknown`', async () => {
    const root = fixture()
    await listenSaying(join(root, GATE_SOCKET), null)
    const said = await askGate(join(root, GATE_SOCKET))
    expect(said.kind).toBe('unknown')
    // ⚑ **Which unknown, and not just that it is one.** Asserting `.kind` alone passes on the
    // TIMEOUT branch too, so the test could not tell "it said nothing and hung up" from "it never
    // answered" — two different facts about the app, reached by two different lines.
    expect(said.why).toContain('without a word')
    expect(said.why).not.toContain('will not say what')
  })

  it('⛔ an answer that is not the UUID means something else owns the name — `unknown`', async () => {
    const root = fixture()
    await listenSaying(join(root, GATE_SOCKET), 'hello')
    const said = await askGate(join(root, GATE_SOCKET))
    expect(said.kind).toBe('unknown')
    expect(said.why).toContain('something else owns this name')
  })

  it('⛔ a listener that never speaks times out as `unknown` rather than as absence', async () => {
    const root = fixture()
    const server = createServer(() => {
      // deliberately silent: the connection is accepted and nothing is ever written
    })
    servers.push(server)
    await new Promise((resolve) => server.listen(join(root, GATE_SOCKET), resolve))
    const said = await askGate(join(root, GATE_SOCKET), { answerMs: 120 })
    expect(said.kind).toBe('unknown')
    expect(said.why).toContain('will not say what')
  })
})

describe('the process table', () => {
  itOnPosix('reads this very process out of the real `ps`, so the parse is not vacuous', () => {
    const table = readCommandTable()
    expect(table.kind).toBe('read')
    expect(table.rows.length).toBeGreaterThan(5)
    expect(table.rows.map((row) => row.pid)).toContain(process.pid)
    const self = table.rows.find((row) => row.pid === process.pid)
    expect(self.command, 'a command line with spaces must survive the parse').toContain('node')
    expect(self.ppid).toBeGreaterThan(0)
  })

  /** ⛔ 321's defect, in the instrument that would carry it: `ps` failing is not an empty machine. */
  it('⛔ a `ps` that cannot be run is `unknown`, never an empty table', () => {
    const table = readCommandTable({
      exec: () => {
        throw Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT' })
      },
    })
    expect(table.kind).toBe('unknown')
    expect(table.rows).toBeUndefined()
  })

  it('⛔ a `ps` that answers with nothing parseable is `unknown` too', () => {
    expect(readCommandTable({ exec: () => '\n\n' }).kind).toBe('unknown')
  })

  it('matches either spelling of the target and never this process itself', () => {
    const rows = [
      { pid: 10, ppid: 1, command: '/x/Electron --user-data-dir=/tmp/ud .' },
      { pid: 11, ppid: 10, command: '/x/Electron --user-data-dir=/private/tmp/ud --type=gpu' },
      // ⛔ **`/tmp/ud2`, not `/tmp/other`** — a neighbour whose name STARTS the same way is the
      // only row that can tell `namesPath` from a plain `includes` at this call site.
      { pid: 12, ppid: 1, command: '/x/Electron --user-data-dir=/tmp/ud2 .' },
      { pid: 99, ppid: 1, command: 'node grep /tmp/ud' },
    ]
    const found = processesNaming(['/tmp/ud', '/private/tmp/ud'], rows, { self: 99 })
    expect(found.map((row) => row.pid)).toEqual([10, 11])
  })

  it('⚠️ an empty or undefined spelling matches nothing rather than everything', () => {
    const rows = [{ pid: 1, ppid: 0, command: 'launchd' }]
    expect(processesNaming(['', undefined, null], rows, { self: 99 })).toEqual([])
  })
})

describe('⛔ the verdict, and unknown is a refusal', () => {
  const table = (rows) => () => ({ kind: 'read', rows })
  const quiet = async () => ({ kind: 'nothing-listening', code: 'ENOENT' })

  it('a live gate is `running` and the process table is not even consulted', async () => {
    let asked = false
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: async () => ({ kind: 'answered', token: UUID }),
        readTable: () => {
          asked = true
          return { kind: 'read', rows: [] }
        },
        readLock: () => ({ kind: 'absent' }),
      },
    )
    expect(verdict.verdict).toBe('running')
    expect(asked, 'a positive answer settles it; asking further can only weaken it').toBe(false)
  })

  it('a process naming the userData is `running` even with a silent gate', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: quiet,
        readTable: table([{ pid: 7, ppid: 1, command: 'Electron --user-data-dir=/tmp/ud .' }]),
        readLock: () => ({ kind: 'absent' }),
        self: 99,
      },
    )
    expect(verdict.verdict).toBe('running')
    expect(verdict.processes).toEqual([{ pid: 7, command: 'Electron --user-data-dir=/tmp/ud .' }])
  })

  /**
   * 🔴 **The load-bearing pair.** Both runs see a machine with nothing of ours on it; they differ
   * only in whether the instrument answered. ⛔ A reset that collapses them deletes on the strength
   * of its own bad minute — which is `325`'s measured failure, four milliseconds after a `lsof` that
   * exited non-zero.
   */
  it('⛔ a `ps` that could not be read is `unknown`, where the same machine is otherwise `not-running`', async () => {
    const machine = [{ pid: 1, ppid: 0, command: '/sbin/launchd' }]
    const answered = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: quiet,
        readTable: table(machine),
        readLock: () => ({ kind: 'absent' }),
        self: 99,
      },
    )
    const couldNotAsk = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: quiet,
        readTable: () => ({ kind: 'unknown', why: 'ps could not be read: EPERM' }),
        readLock: () => ({ kind: 'absent' }),
        self: 99,
      },
    )

    expect(answered.verdict).toBe('not-running')
    expect(couldNotAsk.verdict).toBe('unknown')
    expect(couldNotAsk.reasons.join(' ')).toContain('EPERM')
  })

  it('⛔ a gate that could not be asked is `unknown`, and the table is not consulted either', async () => {
    let asked = false
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: async () => ({ kind: 'unknown', why: 'connecting failed EACCES' }),
        readTable: () => {
          asked = true
          return { kind: 'read', rows: [] }
        },
        readLock: () => ({ kind: 'absent' }),
      },
    )
    expect(verdict.verdict).toBe('unknown')
    expect(asked).toBe(false)
  })

  it('the ordinary case says WHICH negative it saw, because a stale socket is normal', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/tmp/ud' },
      {
        ask: async () => ({ kind: 'nothing-listening', code: 'ECONNREFUSED' }),
        readTable: table([{ pid: 1, ppid: 0, command: '/sbin/launchd' }]),
        readLock: () => ({ kind: 'absent' }),
        self: 99,
      },
    )
    expect(verdict.verdict).toBe('not-running')
    expect(verdict.reasons[0]).toContain('ECONNREFUSED')
    expect(verdict.reasons[1]).toContain('1 rows read')
  })
})

describeOnPosix("Chromium's SingletonLock — the instrument that works when argv is silent", () => {
  /**
   * ⚑ **The target shape is measured, not assumed.** A real launch of this build wrote
   * `SingletonLock -> alex-laptop.local-3541` and removed it on a clean quit.
   */
  it('a well-formed lock naming a local pid is `held`', () => {
    const root = fixture()
    symlinkSync(`${hostname()}-4321`, join(root, 'SingletonLock'))
    expect(readSingletonLock(root)).toEqual({ kind: 'held', pid: 4321, host: hostname() })
  })

  it('⚑ no lock at all is `absent` — what a clean quit leaves', () => {
    expect(readSingletonLock(fixture())).toEqual({ kind: 'absent' })
  })

  it('⛔ a lock written by another machine is `unknown`, because its pid is not ours to judge', () => {
    const root = fixture()
    symlinkSync('some-other-mac.local-4321', join(root, 'SingletonLock'))
    const lock = readSingletonLock(root)
    expect(lock.kind).toBe('unknown')
    expect(lock.why).toContain('some-other-mac.local')
  })

  it('⛔ a target that will not parse is `unknown`', () => {
    const root = fixture()
    symlinkSync('/somewhere/else', join(root, 'SingletonLock'))
    expect(readSingletonLock(root).kind).toBe('unknown')
  })

  it('⛔ something that is not a symlink at that name is `unknown`, not absence', () => {
    const root = fixture()
    writeFileSync(join(root, 'SingletonLock'), 'not a link')
    const lock = readSingletonLock(root)
    expect(lock.kind).toBe('unknown')
    expect(lock.why).toContain('not a symlink')
  })
})

describe('⛔ the ancestor chain, which made the documented invocation always refuse', () => {
  /**
   * 🔴 **Measured before the fix**: `pnpm clean-base --dir <empty fixture>` printed
   * `⛔ refused · BroBot is running on this userData` with no app anywhere near it. `pnpm` and the
   * `sh -c` it spawns both carry the path in their own command lines, and excluding only the
   * caller's own pid left both of them in the scan.
   */
  const chain = [
    { pid: 400, ppid: 1, command: '/bin/zsh -l' },
    { pid: 401, ppid: 400, command: 'node /usr/local/bin/pnpm clean-base --dir /tmp/ud' },
    { pid: 402, ppid: 401, command: 'sh -c node scripts/clean-base.mjs --dir /tmp/ud' },
    { pid: 403, ppid: 402, command: 'node scripts/clean-base.mjs --dir /tmp/ud' },
    { pid: 900, ppid: 1, command: 'Electron --user-data-dir=/tmp/ud .' },
  ]

  it('excludes every ancestor of the running process, not just the process itself', () => {
    expect([...ownAncestry(chain, 403)]).toEqual([403, 402, 401, 400])
    expect(processesNaming(['/tmp/ud'], chain, { self: 403 }).map((r) => r.pid)).toEqual([900])
  })

  it('⚑ …and a REAL app is still found — the exclusion is not a blanket', () => {
    const withoutTheApp = chain.filter((row) => row.pid !== 900)
    expect(processesNaming(['/tmp/ud'], withoutTheApp, { self: 403 })).toEqual([])
    expect(processesNaming(['/tmp/ud'], chain, { self: 403 })).toHaveLength(1)
  })

  it('terminates on a torn `ps` read that names a cycle', () => {
    const cycle = [
      { pid: 10, ppid: 11, command: 'a' },
      { pid: 11, ppid: 10, command: 'b' },
    ]
    expect([...ownAncestry(cycle, 10)]).toEqual([10, 11])
  })
})

describe('⛔ a path is named as a PATH, not as a prefix', () => {
  it('does not match a directory whose name merely starts the same way', () => {
    expect(namesPath('Electron --user-data-dir=/tmp/ud2 .', '/tmp/ud')).toBe(false)
    expect(namesPath('Electron --user-data-dir=/tmp/udx .', '/tmp/ud')).toBe(false)
  })

  it('⚑ …and still matches the directory itself and anything under it', () => {
    expect(namesPath('Electron --user-data-dir=/tmp/ud .', '/tmp/ud')).toBe(true)
    expect(namesPath('node /tmp/ud/brobot-workspace/x.js', '/tmp/ud')).toBe(true)
    expect(namesPath('x --dir="/tmp/ud"', '/tmp/ud')).toBe(true)
    expect(namesPath('trailing /tmp/ud', '/tmp/ud')).toBe(true)
  })

  it('keeps looking past a near miss rather than giving up on the first one', () => {
    expect(namesPath('/tmp/udx and /tmp/ud', '/tmp/ud')).toBe(true)
  })
})

describe('⛔ the third instrument refuses too', () => {
  const quiet = async () => ({ kind: 'nothing-listening', code: 'ENOENT' })
  const table = (rows) => () => ({ kind: 'read', rows })
  const machine = [{ pid: 1, ppid: 0, command: '/sbin/launchd' }]

  it('a lock naming a LIVE pid is `running`, even with a silent gate and a silent argv', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/private/tmp/ud' },
      {
        ask: quiet,
        readTable: table([...machine, { pid: 555, ppid: 1, command: 'Electron' }]),
        readLock: () => ({ kind: 'held', pid: 555, host: 'here' }),
        self: 99,
      },
    )
    expect(verdict.verdict).toBe('running')
    expect(verdict.processes).toEqual([{ pid: 555, command: 'Electron' }])
  })

  it('⚑ …and a lock naming a pid that is GONE is not — it says a crash left it behind', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/private/tmp/ud' },
      {
        ask: quiet,
        readTable: table(machine),
        readLock: () => ({ kind: 'held', pid: 555, host: 'here' }),
        self: 99,
      },
    )
    expect(verdict.verdict).toBe('not-running')
    expect(verdict.reasons.join(' ')).toContain('a crash left it behind')
  })

  it('⛔ a lock it could not read is `unknown`, and nothing is removed', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/private/tmp/ud' },
      {
        ask: quiet,
        readTable: table(machine),
        readLock: () => ({ kind: 'unknown', why: 'SingletonLock could not be read: EACCES' }),
        self: 99,
      },
    )
    expect(verdict.verdict).toBe('unknown')
    expect(verdict.reasons.join(' ')).toContain('EACCES')
  })

  it('⛔ a gate kind nobody handled is `unknown` rather than falling through', async () => {
    const verdict = await whatIsRunning(
      { lexical: '/tmp/ud', real: '/private/tmp/ud' },
      { ask: async () => ({ kind: 'something-added-later' }), readTable: table(machine), self: 99 },
    )
    expect(verdict.verdict).toBe('unknown')
    expect(verdict.reasons.join(' ')).toContain('something-added-later')
  })

  it('⛔ the gate is asked on the REAL spelling, which is where the app binds it', async () => {
    const asked = []
    await whatIsRunning(
      { lexical: '/tmp/ud', real: '/private/tmp/ud' },
      {
        ask: async (path) => {
          asked.push(path)
          return { kind: 'nothing-listening', code: 'ENOENT' }
        },
        readTable: table(machine),
        readLock: () => ({ kind: 'absent' }),
        self: 99,
      },
    )
    expect(asked).toEqual([join('/private/tmp/ud', GATE_SOCKET)])
  })
})

describe('⛔ a `ps` that hits a bound is unknown, not a smaller machine', () => {
  it('a timeout is unknown', () => {
    const table = readCommandTable({
      exec: () => {
        throw Object.assign(new Error('spawnSync ps ETIMEDOUT'), { code: 'ETIMEDOUT' })
      },
    })
    expect(table.kind).toBe('unknown')
    expect(table.why).toContain('ETIMEDOUT')
  })

  it('a process table larger than the buffer is unknown', () => {
    const table = readCommandTable({
      exec: () => {
        throw Object.assign(new Error('ENOBUFS: stdout maxBuffer length exceeded'), {
          code: 'ENOBUFS',
        })
      },
    })
    expect(table.kind).toBe('unknown')
    expect(table.rows).toBeUndefined()
  })
})
