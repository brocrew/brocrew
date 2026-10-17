import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bindOnce, couldBindPort, runLsof, whoHoldsPort } from '../lib/port-probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 🔴 **326 · three answers about a port, and what the third one may never become.**
 *
 * ⛔ **Every *"the port is free"* this repository ever printed came out of a `catch` block.**
 * `lsof -t` exits 1 when it matches nothing, so the ORDINARY answer arrives as a thrown
 * `Command failed` — and the `holdersOf` this replaces returned `[]` from that catch, which its own
 * callers read as *"nothing is listening"*. `325` measured the cost: a stand-in `lsof` that exits
 * non-zero declares a held port free in 4 ms, 3 of 3.
 *
 * ⚠️ **The tests below are the classification, not the plumbing.** A healthy machine produces
 * exactly one of the five shapes; the other four are the ones that matter and the only way to see
 * them is to hand them in. They are transcribed from what Node actually produced on this machine
 * (`lsof 4.91`, Node 24.0.2) rather than from what the documentation implies.
 */

/** The five `execFileSync` outcomes, measured — see the table in `port-probe.mjs`. */
const failing = (fields) => () => {
  const error = new Error('Command failed')
  Object.assign(error, { status: null, signal: null, stderr: '', ...fields })
  throw error
}

describe('runLsof · the ordinary answer arrives as an error, and so do four failures', () => {
  it('reads a match as `found`', () => {
    const result = runLsof(4242, { exec: () => '9001\n9002\n' })
    expect(result).toEqual({ found: '9001\n9002\n' })
  })

  it('reads exit 1 with a silent stderr as EMPTY — the one shape that may become "free"', () => {
    expect(runLsof(4242, { exec: failing({ status: 1 }) })).toEqual({ empty: true })
  })

  it('refuses to read exit 1 as empty when lsof COMPLAINED', () => {
    // ⛔ The same status code as "nothing listening". `stderr` is the discriminator, and the
    // instrument this replaces threw it away (`stdio: […, 'ignore']`).
    const result = runLsof(4242, {
      exec: failing({ status: 1, stderr: 'lsof: unknown service nope for tcp in: -i TCP:nope\n' }),
    })
    expect(result.empty).toBeUndefined()
    expect(result.failed).toContain('unknown service')
  })

  it('refuses to read a MISSING lsof as empty', () => {
    // `stderr` is `undefined` rather than a string on a spawn failure — the classifier may not
    // assume it can be trimmed.
    const result = runLsof(4242, {
      exec: failing({ status: null, code: 'ENOENT', stderr: undefined }),
    })
    expect(result.empty).toBeUndefined()
    expect(result.failed).toContain('ENOENT')
  })

  it('refuses to read a TIMED OUT lsof as empty', () => {
    // 🔴 The reason `326` §1 says bounding `lsof` used to turn a false red into a false green: with
    // two states a timeout landed in the same catch as an empty result. Here it has a name.
    const result = runLsof(4242, {
      exec: failing({ status: null, signal: 'SIGTERM', code: 'ETIMEDOUT' }),
    })
    expect(result.empty).toBeUndefined()
    expect(result.failed).toContain('ETIMEDOUT')
  })

  it('refuses to read any other exit status as empty', () => {
    expect(runLsof(4242, { exec: failing({ status: 2 }) }).empty).toBeUndefined()
  })
})

describe('whoHoldsPort · held, free, or "I do not know" — and never the wrong two', () => {
  it('names the pids it was given', () => {
    const answer = whoHoldsPort(4242, { run: () => ({ found: '9001\n9002\n' }) })
    expect(answer).toEqual({ state: 'held', pids: [9001, 9002] })
  })

  it('is free ONLY for the empty result', () => {
    expect(whoHoldsPort(4242, { run: () => ({ empty: true }) })).toEqual({ state: 'free' })
  })

  it('is unknown for a failure, and carries the reason', () => {
    const answer = whoHoldsPort(4242, { run: () => ({ failed: 'lsof failed with ENOENT' }) })
    expect(answer.state).toBe('unknown')
    expect(answer.why).toBe('lsof failed with ENOENT')
    // ⛔ The pair that is the whole point: a failure is not the free answer, and it is not the held
    // one either. Asserting only `!== 'free'` would pass on a probe that called everything `held`.
    expect(answer.state).not.toBe('free')
    expect(answer.state).not.toBe('held')
  })

  it('does not call a MATCH it cannot read an empty port', () => {
    // A zero exit means lsof matched. Parsing nothing out of it is this check failing to read an
    // answer, not the kernel saying there is nobody there.
    const answer = whoHoldsPort(4242, { run: () => ({ found: 'lsof: WARNING: ...\n' }) })
    expect(answer.state).toBe('unknown')
  })

  // This oracle asks the POSIX lsof executable, which Windows does not provide.
  it.skipIf(process.platform === 'win32')(
    'answers about the REAL lsof on this machine, both ways',
    async () => {
      // ⚑ **The oracle.** Everything above is this file's model of `lsof`'s conventions; this is
      // `lsof`. Without it the five classification tests are a closed loop between the model and a
      // test of the model, and `M20` is the row that proves this one is doing work.
      //
      // 🔴 **This test caught itself doing 326's own disease.** Written as
      // `expect(whileHeld.state).toBe('held')` on vitest's 5 s default, it went RED inside 326's
      // first table baseline — not because anything was wrong, but because `lsof` took longer than
      // five seconds on a machine at load ≈ 60 with a second mutation run on it. ⛔ **An assertion
      // that fails when the host is busy is the thing this whole dispatch is about**, so it is
      // three-valued now and bounded on purpose:
      //
      //  - `free` while something IS listening is the fail-open, and no amount of load produces it.
      //  - `held` after it stopped is the opposite error, and the same is true.
      //  - `unknown` in ONE direction is the machine, and is tolerated — but not in both, because
      //    then this test asserted nothing at all (193), which is exactly what `M20` does to it.
      const server = createServer()
      const port = await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port))
      })
      let whileHeld
      try {
        whileHeld = whoHoldsPort(port)
        expect(whileHeld.state).not.toBe('free')
        if (whileHeld.state === 'held') expect(whileHeld.pids).toContain(process.pid)
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
      const afterClose = whoHoldsPort(port)
      expect(afterClose.state).not.toBe('held')
      // ⛔ …and at least one direction was actually ANSWERED.
      expect(whileHeld.state === 'held' || afterClose.state === 'free').toBe(true)
    },
    90_000,
  ) // ⚠️ Two `lsof` calls, each bounded by `LSOF_TIMEOUT_MS`. The default 5 s is what went red.
})

describe('couldBindPort · the kernel is asked instead of a subprocess', () => {
  it('is held while something listens and free once it stops — against real sockets', async () => {
    const server = createServer()
    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    })
    // ⛔ The positive half. Without it, a probe that answered `free` unconditionally would pass the
    // half below and `quit:check`'s port assertion would be vacuous (193, 241).
    expect(await couldBindPort(port)).toEqual({ state: 'held' })
    await new Promise((resolve) => server.close(resolve))
    expect(await couldBindPort(port)).toEqual({ state: 'free' })
  })

  it('says held WITHOUT pids, so a caller cannot print an identification it never made', async () => {
    const server = createServer()
    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    })
    try {
      expect((await couldBindPort(port)).pids).toBeUndefined()
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('is UNKNOWN for any bind failure that is not EADDRINUSE', async () => {
    // 🔴 `EACCES` on a privileged port and `EMFILE` on a machine out of descriptors are this check
    // being unable to ask. Reporting either as an answer about the app is the mistake this module
    // exists to make impossible — and a machine out of descriptors is exactly a LOADED machine,
    // which is when every failure in this dispatch's family happens.
    const refusing = () => ({
      once: (_event, handler) => {
        const error = new Error('permission denied')
        error.code = 'EACCES'
        setTimeout(() => handler(error), 0)
      },
      listen: () => {},
    })
    const answer = await bindOnce(80, { openServer: refusing })
    expect(answer.state).toBe('unknown')
    expect(answer.why).toContain('EACCES')
    expect(answer.state).not.toBe('free')
    expect(answer.state).not.toBe('held')
  })
})

/**
 * ⛔ **…and the two gates actually go through it** — a rule is worth nothing if a check keeps its
 * own copy of the question. ⚠️ `ci` covers these files going red when the product breaks; it does
 * not cover them being quietly rewritten, and a green run and a run that measured its own `lsof`
 * look identical from outside.
 */
describe('…and the gates ask the port through this module', () => {
  const quit = readFileSync(join(HERE, '../app-closes-check.mjs'), 'utf8')
  const window = readFileSync(join(HERE, '../window-opens-check.mjs'), 'utf8')

  it('leaves no fail-open `holdersOf` CALL in either gate', () => {
    // ⚠️ The call, not the word: `app-closes-check.mjs`'s header quotes the probe line from the run
    // that made 326 exist (`holdersOf 21295ms`), and that evidence stays where a reader finds it.
    expect(quit).not.toContain('holdersOf(port)')
    expect(quit).not.toContain('function holdersOf')
    expect(window).not.toContain('holdersOf')
    // The positive half: they do still ask about the port, through the two named instruments.
    expect(quit).toContain('whoHoldsPort(port)')
    expect(quit).toContain('couldBindPort(port)')
  })

  it('samples the FREE fact — which costs nothing — before the two that cost something', () => {
    // 🔴 326 §1's subject in one assertion. `alive()` used to run third, so "has the app gone?" was
    // stamped only after a CDP probe and an `lsof` had returned — one of which was measured at
    // 21,295 ms, and the gate reported that as the app still running.
    const alive = quit.indexOf('if (processGoneAt === null && !alive(appPid))')
    const port = quit.indexOf('const answer = await couldBindPort(port)')
    const cdp = quit.indexOf('if (windowGoneAt === null) {\n      const list = await targets(port)')
    expect(alive).toBeGreaterThan(0)
    expect(port).toBeGreaterThan(alive)
    expect(cdp).toBeGreaterThan(port)
  })

  it('stamps the two cheap facts when they are ASKED, not when the answer came back', () => {
    expect(quit).toContain(
      'if (processGoneAt === null && !alive(appPid)) processGoneAt = askingProcess',
    )
    expect(quit).toContain("if (answer.state === 'free') portFreeAt = askingPort")
  })

  it('measures the port budget from the process, not from the gesture', () => {
    // ⛔ The old assertion charged the app for the time this check spent inside its own `lsof`.
    expect(quit).toContain('portFreeAt - processGoneAt > PORT_RELEASE_MS')
    expect(quit).not.toContain('portFreeAt - askedAt')
  })

  it('proves the port instrument can see this app before depending on it', () => {
    // 241's lesson aimed at the new probe: without this line `couldBindPort` could answer `free`
    // unconditionally and nothing in that file would go red.
    expect(quit).toContain('const heldWhileUp = await couldBindPort(port)')
    expect(quit).toContain("if (heldWhileUp.state !== 'held')")
  })
})
