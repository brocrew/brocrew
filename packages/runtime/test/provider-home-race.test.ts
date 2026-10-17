import { execFileSync, spawn } from 'node:child_process'
import {
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  linkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  lstatSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { provisionCodexAuth } from '../src/internal/auth'
import { provisionProviderHome, withProviderHomeLock } from '../src/internal/provider-home'

/**
 * ## 🔴 238 · two contenders, one lockfile, and a judgement nobody checked (208 M1)
 *
 * `202` taught the provisioning lock to break a dead owner's lockfile. `208` M1 found what that
 * repair let through: the break carried the judged file's **bytes**, and restored what it had moved
 * only when those bytes were non-empty and had changed. An owner-less lockfile has no bytes — so two
 * processes that both snapshotted the same aged, empty sidecar (a crash between the create and the
 * stamp, or a pre-202 build's lockfile) each judged with nothing to compare. The first broke it and
 * stamped its own live lock; the second then renamed **that** away, could not tell empty from empty,
 * skipped the restore, unlinked the winner's inode and entered the critical section beside it.
 *
 * The protected sections are home creation (`provisionProviderHome`) and the Codex credential
 * copy/reprovision (`auth.ts`) — a credential write, on every launch.
 *
 * ## ⛔ Why these tests spawn processes
 *
 * ⚠️ **`208` says a sequential test cannot fail on this, and that is the reason it survived two
 * rounds.** `provider-home.test.ts` writes lockfiles by hand and manufactures pids, which proves
 * what ONE acquisition decides about a file; M1 is two acquisitions deciding about each other.
 *
 * ⚑ **Two shapes, because neither alone is proof.**
 *
 *  - **Deterministic (§1).** The interleaving is microseconds wide, so it is *placed* rather than
 *    raced for: the contender is parked inside its own judgement — blocked in `open()` on a FIFO at
 *    the lock path — while the test puts a live lock there. When it wakes, its judgement is of the
 *    FIFO and the file at the path is somebody else's. That is exactly the state M1 describes, with
 *    no timing left in it. ⚠️ It leans on a FIFO's `open` blocking until a writer arrives, which is
 *    also a pre-existing property of this lock: a FIFO planted at a lock path would hang a
 *    provisioning rather than time it out. Not a shape the app creates — the lock lives inside a
 *    `0700` managed root — and not something 238 changes.
 *  - **Two-process barrier (§2).** The real race, run for real, many times, with the two contenders
 *    released within microseconds of one another. It is the end-to-end assurance; §1 is what makes
 *    the mutation row for this defect die every time rather than most times.
 */

const CONTENDER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/lock-contender.mjs')

/** Type stripping is experimental and says so on stderr; the fixture's stderr is for real failures. */
const QUIET = '--disable-warning=ExperimentalWarning'

interface ContenderSaid {
  round?: number
  role?: string
  entered: boolean
  overlapped?: boolean
  released?: boolean
  pid?: number
  error: string | null
}

interface ContenderRun {
  said: ContenderSaid[]
  stderr: string
  code: number | null
}

/** Run the fixture to completion and give back every line it said. */
function contend(args: string[]): Promise<ContenderRun> {
  const child = spawn(process.execPath, [QUIET, CONTENDER, ...args], { env: process.env })
  let out = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => (out += chunk))
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  // Unconditional teardown, so a failed assertion cannot orphan a contender still spinning at a
  // barrier — the rule `codex-transport.test.ts` writes down for its own children.
  onTestFinished(() => {
    child.kill('SIGKILL')
  })
  return new Promise((resolve) => {
    child.on('close', (code) => {
      const said = out
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ContenderSaid)
      resolve({ said, stderr, code })
    })
  })
}

/** Is this pid alive? `ownerIsGone` asks the same question, so the test has to be able to ask it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Sleep without a timer — the parent has to wait on other PROCESSES, not on its own event loop. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run the fixture and read what it says AS it says it (240).
 *
 * {@link contend} resolves on `close`, which is exactly wrong for `hold`: that mode's whole value is
 * that it is still running when the assertions are made.
 */
function contendLive(args: string[]): { said: ContenderSaid[]; stderr: () => string } {
  const child = spawn(process.execPath, [QUIET, CONTENDER, ...args], { env: process.env })
  const said: ContenderSaid[] = []
  let stderr = ''
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.length > 0) said.push(JSON.parse(line) as ContenderSaid)
    }
  })
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  onTestFinished(() => {
    child.kill('SIGKILL')
  })
  return { said, stderr: () => stderr }
}

describe('238 · the provisioning lock, contended by real processes (208 M1)', () => {
  let root: string
  let home: string
  let lock: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-lock-238-'))
    home = join(root, 'profile')
    mkdirSync(home, { recursive: true })
    lock = `${home}.lock`
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  describe('⛔ §1 · a contender parked inside its own judgement', () => {
    /**
     * Plant a FIFO at the lock path, aged past {@link LOCK_UNSTAMPED_GRACE_MS}'s two seconds.
     *
     * ⚑ A FIFO reads as *the* corpse M1 needs: `fstat` says old, the read says nothing, so the
     * contender judges "unstamped and aged" — and then blocks in `open()` until this process opens
     * the write end, which is the handle the test needs on a window that is otherwise microseconds.
     */
    const plantAgedFifo = (): void => {
      execFileSync('mkfifo', [lock])
      const old = Date.now() / 1000 - 60
      utimesSync(lock, old, old)
    }

    /** Open the write end once the contender has opened the read end — the handshake, without a hang. */
    const meetTheReader = (): number => {
      const until = Date.now() + 10_000
      for (;;) {
        try {
          // ⚠️ NON-blocking, so a contender that died on its way here fails this test instead of
          // wedging it: a plain `open(fifo, 'w')` would block forever with no reader.
          return openSync(lock, constants.O_WRONLY | constants.O_NONBLOCK)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENXIO') throw error
        }
        if (Date.now() > until) throw new Error('the contender never opened the fifo')
        pause(2)
      }
    }

    it('🔴 breaks nothing when the file at the path is not the file it judged', async () => {
      plantAgedFifo()
      // 900 ms of timeout: long enough that a contender which DOES take the lock has said so, short
      // enough that the honest outcome (waiting on a live holder) arrives inside the test.
      const run = contend(['once', home, '900', '20'])
      const writer = meetTheReader()

      // ⛔ **The live lock, placed while the contender is parked.** Stamped with THIS process's pid,
      // which is alive, so once the contender re-judges it must wait rather than break again.
      const live = `${lock}.incoming`
      const bytes = `${hostname()}\n${process.pid}\n2026-08-28T00:00:00.000Z\n`
      writeFileSync(live, bytes)
      renameSync(live, lock)
      pause(5) // so the install's own ctime cannot be mistaken for the contender's, below
      const before = statSync(lock)

      closeSync(writer) // EOF: the contender's read returns, and it acts on a judgement of the FIFO
      const { said, stderr, code } = await run

      expect(said, `contender said nothing (stderr: ${stderr})`).toHaveLength(1)
      expect(said[0]!.entered, 'a second process entered the critical section over one home').toBe(
        false,
      )
      expect(said[0]!.error).toMatch(/timed out acquiring provisioning lock/)
      // ⚑ …and it waited on the RIGHT holder, which is how we know it re-read the restored file
      // rather than simply failing to find anything.
      expect(said[0]!.error).toContain(`held by pid ${process.pid}`)
      expect(code).toBe(0)

      // ⛔ The live lock is still there, and it is the SAME FILE — restored by `link`, so the inode
      // the holder has open by fd is the inode the path still names.
      expect(existsSync(lock), 'the live lock was destroyed by somebody else’s break').toBe(true)
      const after = statSync(lock)
      expect(after.ino).toBe(before.ino)
      expect(readFileSync(lock, 'utf8')).toBe(bytes)

      // ⛔ **ANTI-VACUITY, and it has to be this rather than the obvious pairing.** A contender that
      // never reached `breakStaleLock` at all would leave the live lock untouched too and report the
      // same timeout — so "untouched" alone measures nothing. `ctime` is the witness that it DID:
      // `rename` + `link` + `unlink` each bump it while leaving `ino` and `mtime` alone, which is
      // also why {@link isSameFile} compares mtime and not ctime.
      //
      // ⚠️ The pairing one reaches for first — the same park with nothing swapped in — cannot be
      // written: the file at the path would still be the FIFO, and the break's confirming read
      // would block in `open()` forever. That is a pre-existing property of a FIFO planted at a lock
      // path (the pre-238 code read it with `readFileSync` and blocked identically), not something
      // this change introduces. The next test carries that half instead.
      expect(
        after.ctimeMs,
        'the contender never touched the file — the test proved nothing',
      ).not.toBe(before.ctimeMs)
    })

    it('⚑ …the pairing: a judgement made through this construction still ACQUIRES the home', async () => {
      // The third outcome, and the one that says the fix costs nothing when it fires wrongly: the
      // file swapped in is a DIFFERENT inode but an equally dead one, so the break is refused once
      // (identity mismatch) and then made properly on the next iteration.
      //
      // ⚠️ **What this does NOT witness, said rather than implied** (review). `entered === true`
      // holds whether or not the put-back happened — measured: with the 238 fix reverted this test
      // stays green, 5 runs out of 5. Its job is the anti-vacuity half of the construction above
      // (a contender parked on a FIFO can reach a break and come out the other side); the assertion
      // that the RESTORE happened is the `ctimeMs` witness in the previous test, and the assertion
      // that a refused break is not a wedge is `entered === true` here.
      plantAgedFifo()
      const run = contend(['once', home, '2000', '20'])
      const writer = meetTheReader()

      const corpse = `${lock}.incoming`
      writeFileSync(corpse, '')
      const old = Date.now() / 1000 - 60
      utimesSync(corpse, old, old)
      renameSync(corpse, lock)

      closeSync(writer)
      const { said, stderr } = await run

      expect(said, `contender said nothing (stderr: ${stderr})`).toHaveLength(1)
      expect(said[0]!.entered, 'one refused break left the home unacquirable').toBe(true)
      expect(said[0]!.error).toBeNull()
    })
  })

  describe('⛔ §2 · the two-process barrier', () => {
    /**
     * ⚠️ **Rounds, because one round proves nothing about a race.** The bad interleaving needs both
     * contenders to judge before either breaks — a band microseconds wide out of the scheduling
     * jitter between two processes released at once. Measured against the pre-238 code this fires in
     * a minority of rounds, so the count is what turns "it can happen" into "it will be seen".
     */
    const ROUNDS = 40

    it('🔴 two processes racing an aged empty sidecar never both enter the critical section', async () => {
      const barrier = join(root, 'barrier')
      mkdirSync(barrier, { recursive: true })
      const left = contend(['rounds', home, 'left', barrier, String(ROUNDS)])
      const right = contend(['rounds', home, 'right', barrier, String(ROUNDS)])

      const waitFor = async (path: string, what: string): Promise<void> => {
        const until = Date.now() + 20_000
        while (!existsSync(path)) {
          if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      }

      for (let round = 0; round < ROUNDS; round++) {
        // ⛔ **The pre-202 sidecar, re-made every round**: empty, and older than the two-second
        // grace, so both contenders judge it a corpse with no owner to compare.
        writeFileSync(lock, '')
        const old = Date.now() / 1000 - 60
        utimesSync(lock, old, old)

        writeFileSync(join(barrier, `go-${round}`), '')
        await waitFor(join(barrier, `done-left-${round}`), `left to finish round ${round}`)
        await waitFor(join(barrier, `done-right-${round}`), `right to finish round ${round}`)

        // ⚑ **Anti-vacuity, per round.** The corpse can only leave the path by being broken — the
        // release only unlinks a lock its own holder created — so a round where the file is gone is
        // a round where the stale path really ran. A round that never got there would leave it.
        expect(
          existsSync(lock),
          `round ${round} never broke the stale lock — nothing was raced`,
        ).toBe(false)
      }

      const [a, b] = await Promise.all([left, right])
      const every = [...a.said, ...b.said]
      expect(every, `left stderr: ${a.stderr}\nright stderr: ${b.stderr}`).toHaveLength(ROUNDS * 2)
      // 🔴 The finding itself: two processes inside one home's critical section.
      expect(every.filter((said) => said.overlapped === true)).toEqual([])
      // ⚑ …and the pairing that keeps the assertion above from being satisfied by a lock that
      // simply refuses everybody: both contenders got in, in every round.
      expect(every.filter((said) => said.entered !== true)).toEqual([])
      expect(every.filter((said) => said.error !== null)).toEqual([])
    }, 60_000)
  })
})

/**
 * ## 🔴 240 §2 · the lock a holder released and nobody could remove (238 §3's residual)
 *
 * `238` found this in its own adversarial pass and wrote it down rather than closing it:
 *
 * > *"The `link` succeeds onto a lock whose holder already finished. Its `unlink` hit `ENOENT`, so
 * > the file we put back has nobody to remove it, and its stamp names a live pid — every later
 * > contender waits it out for the life of that process."*
 *
 * ⛔ **Two real processes, because the finding is about a pid being alive.** The holder is a child
 * that acquires the lock, releases it when told, and then **keeps running** — which is what makes
 * the restored lockfile undecidable, since `ownerIsGone` asks `kill(pid, 0)`. A single-process
 * version of this test would have to fake the stamp, and a faked stamp is a claim about the code
 * rather than a run of it.
 *
 * ⚑ **The interleaving is placed, not raced** — 238's §1 technique. The parent performs the
 * contender's two halves (`rename`, then `link`) around a release it opens the gate for, so the
 * microsecond window is a sequence of file operations with the timing taken out.
 */
describe('240 §2 · a release lets go of its own lock, and of nothing else', () => {
  let root: string
  let home: string
  let lock: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-lock-240-'))
    home = join(root, 'profile')
    mkdirSync(home, { recursive: true })
    lock = `${home}.lock`
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const waitFor = async (pred: () => boolean, what: string, ms = 20_000): Promise<void> => {
    const until = Date.now() + ms
    while (!pred()) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }

  it('🔴 a lockfile restored after its holder released does not outlive that holder', async () => {
    const ready = join(root, 'ready')
    const release = join(root, 'release')
    const quit = join(root, 'quit')
    const holder = contendLive(['hold', home, ready, release, quit])

    await waitFor(() => existsSync(ready), `the holder to take the lock (${holder.stderr()})`)
    const holderPid = Number(readFileSync(ready, 'utf8').trim())
    expect(holderPid, 'the holder must report a real pid').toBeGreaterThan(0)
    // ⚑ Anti-vacuity: the lock really is stamped by a process that is really alive, so the
    // "unbreakable" half of the finding has its premises in place before anything is moved.
    expect(readFileSync(lock, 'utf8')).toContain(`\n${holderPid}\n`)

    // ⛔ **The contender's first half**, while the holder is still inside `fn()`.
    const stolen = `${lock}.stale-test`
    renameSync(lock, stolen)

    // …the holder releases here. Its own `unlink` finds nothing at the path.
    writeFileSync(release, '')
    await waitFor(
      () => holder.said.some((s) => s.released === true),
      `the holder to release (${holder.stderr()})`,
    )
    expect(existsSync(lock), 'nothing should be at the lock path yet').toBe(false)

    // ⛔ **The contender's second half**, landing after the release.
    linkSync(stolen, lock)
    unlinkSync(stolen)

    // 🔴 **The finding, in one assertion.** Before 240 this file still carried the holder's stamp,
    // and the holder is still running — so `ownerIsGone` said no for the rest of its life.
    expect(
      readFileSync(lock, 'utf8'),
      'the restored lockfile still names a live holder that has let go',
    ).toBe('')

    // ⚑ …and the consequence, rather than only its cause: the home is usable again. Aged by hand
    // because two seconds of real time is what this file would otherwise cost every run — the age
    // is the mechanism under test, not the clock.
    const old = Date.now() / 1000 - 60
    utimesSync(lock, old, old)
    let entered = false
    await withProviderHomeLock(home, () => (entered = true), { timeoutMs: 2_000, pollMs: 10 })
    expect(entered, 'the home stayed locked by a file nobody holds').toBe(true)

    // ⚠️ The holder is STILL alive at this point, which is the whole reason the test needed one.
    expect(isAlive(holderPid), 'the holder exited early — the finding needs it running').toBe(true)
    writeFileSync(quit, '')
  }, 60_000)

  it('⛔ …and a release leaves a lock that somebody else took while we were inside fn()', async () => {
    // A second process broke our lock and took the path — the tail of 238's own M1 story, which it
    // described (*"the first one's unconditional release then removed the second one's lock for a
    // third"*) and did not close, because it fixed the break rather than the release.
    const impostor = `${hostname()}\n${process.pid}\n2026-01-01T00:00:00.000Z\n`
    await withProviderHomeLock(home, () => {
      renameSync(lock, `${lock}.somebody-broke-it`)
      writeFileSync(lock, impostor)
    })

    expect(existsSync(lock), 'the release destroyed a lock it did not create').toBe(true)
    expect(readFileSync(lock, 'utf8')).toBe(impostor)
  })

  it('⚑ …while an ordinary release still removes the lock it did create', async () => {
    // The pairing. Without it, both assertions above are satisfied by a release that never unlinks
    // anything at all — which would wedge every home in the app and pass this file.
    let entered = false
    await withProviderHomeLock(home, () => (entered = true))
    expect(entered).toBe(true)
    expect(existsSync(lock), 'an ordinary release must remove its own lock').toBe(false)
  })
})

/**
 * ## 🔴 243 · a contended acquisition must not stop the thread that asked for it
 *
 * ⛔ **`provider-home.ts` used to wait with `Atomics.wait`, under a comment that said *"Node main
 * thread OK"*.** True of a CLI, false of Electron, where that thread is the main process and also
 * the one that pumps the window — which is why `codex/home-boot.ts` built a SECOND, in-process gate
 * rather than use the real lock, in its own words *"the cross-process lock that WOULD cover it …
 * is synchronous"*.
 *
 * ⚠️ **A promise resolving proves nothing about a thread.** `Atomics.wait` blocks the thread and
 * every promise resolves afterwards, on time, looking perfectly healthy — so a test that awaited the
 * acquisition and asserted it succeeded passed identically before and after. The observation has to
 * be something the thread was supposed to DO while it waited, and the only way to owe it something
 * is a timer.
 *
 * ⚑ **So: a real second process takes the real lock and holds it; this process arms a
 * {@link TICK_MS} interval, asks for the same lock, and counts.** Measured with the wait reverted
 * to `Atomics.wait`, the first two `it`s below fail on their tick assertion — `0` ticks recorded
 * across the whole wait, against `137` for the same 1.5 s in the probe's idle control. ⚠️ **The
 * other three in this block are not about the thread**: they guard the `await`s the change had to
 * add, and each was verified separately by reverting the one `await` it names.
 */
describe('243 · a contended acquisition does not stop the thread that asked for it', () => {
  /** The observer's cadence. Small enough to be a frame's worth of work, big enough to be signal. */
  const TICK_MS = 10

  let root: string
  let home: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-lock-243-'))
    home = join(root, 'profile')
    mkdirSync(home, { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Wait for a condition without blocking — the parent may not use `pause()` in these tests. */
  async function until(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const start = Date.now()
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  /**
   * Run `body` with an interval armed, and report what the thread managed to do while it ran.
   *
   * ⛔ **`ticks` is the assertion and `elapsed` is the context.** A thread that ran nothing recorded
   * nothing, whatever the clock says.
   */
  async function observing<T>(
    body: () => Promise<T>,
  ): Promise<{ result: T | Error; ticks: number; elapsed: number }> {
    let ticks = 0
    const timer = setInterval(() => (ticks += 1), TICK_MS)
    const started = Date.now()
    let result: T | Error
    try {
      result = await body()
    } catch (error) {
      result = error instanceof Error ? error : new Error(String(error))
    } finally {
      clearInterval(timer)
    }
    return { result, ticks, elapsed: Date.now() - started }
  }

  it('🔴 the waiting process keeps running its timers while another process holds the lock', async () => {
    const ready = join(root, 'held')
    const holder = contendLive(['hold-ms', home, ready, '700'])
    await until(() => existsSync(ready), 30_000, 'the other process to take the lock')

    let entered = false
    const { result, ticks, elapsed } = await observing(() =>
      withProviderHomeLock(home, () => (entered = true), { timeoutMs: 10_000, pollMs: 25 }),
    )

    expect(result, 'the acquisition itself still succeeds').not.toBeInstanceOf(Error)
    expect(entered, 'and the critical section ran, after the holder let go').toBe(true)
    // ⚠️ It really did have to wait — otherwise the tick count below is measuring nothing.
    expect(elapsed, 'the holder was still holding when we asked').toBeGreaterThan(400)
    // ⛔ **The line that fails before 243.** `Atomics.wait` records zero here, every time.
    expect(ticks, 'the thread ran nothing at all while it waited').toBeGreaterThan(20)
    await until(() => holder.said.length > 0, 5_000, 'the holder to report')
    expect(holder.said[0]?.entered, 'the other process really held it').toBe(true)
  })

  it('⚑ …and so does a wait that ends in the honest refusal', async () => {
    // ⚠️ The failing path is a wait too, and before 243 it was the LONGEST one the product could
    // reach: `LOCK_TIMEOUT_MS` is ten seconds, and that was ten seconds of dead window.
    const ready = join(root, 'held')
    const holder = contendLive(['hold-ms', home, ready, '3000'])
    await until(() => existsSync(ready), 30_000, 'the other process to take the lock')

    const { result, ticks } = await observing(() =>
      withProviderHomeLock(home, () => {}, { timeoutMs: 600, pollMs: 25 }),
    )

    expect(result, 'a live holder is still honoured').toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/timed out acquiring provisioning lock/)
    expect(ticks, 'a refusal must not be a freeze either').toBeGreaterThan(20)
    expect(holder.said.length, 'and the holder was never disturbed').toBe(0)
  })

  /**
   * 🔴 **A body that returns a promise is HELD, not silently let go.**
   *
   * ⛔ **The signature admits one now** — `fn: () => T | Promise<T>` — and that is a footgun unless
   * the lock `await`s it. The old code did `return fn()` and released in `finally` the moment `fn`
   * RETURNED, which for an `async` body is the moment it first suspends. ⚠️ **After 243 that call
   * type-checks perfectly and reads correctly**, so nothing but this test stands between the
   * signature and a lock that lets go while its critical section is still running.
   *
   * ⚑ **`O_EXCL` is the overlap detector**, the same instrument the `rounds` fixture uses: if a
   * second body is inside the critical section, the file is already there. Measured with
   * `await fn()` reverted to `fn()`: `overlapped` is **true**, both bodies run together, and the
   * lockfile is gone before either has finished.
   */
  it('🔴 the lock is held across an `await` inside fn(), not released when it suspends', async () => {
    const critical = join(root, 'critical')
    let overlapped = false
    const enter = (): Promise<void> =>
      withProviderHomeLock(
        home,
        async () => {
          try {
            closeSync(openSync(critical, 'wx'))
          } catch {
            overlapped = true // somebody else is inside the critical section right now
            return
          }
          await new Promise((r) => setTimeout(r, 60))
          unlinkSync(critical)
        },
        { timeoutMs: 5_000, pollMs: 10 },
      )

    await Promise.all([enter(), enter()])

    expect(overlapped, 'two bodies were inside one home at the same time').toBe(false)
    expect(existsSync(critical), 'and each body ran to its end before the next started').toBe(false)
    expect(existsSync(`${home}.lock`), 'both releases ran').toBe(false)
  })
  /**
   * ⛔ **The cascade's `await`s, made killable.**
   *
   * `provisionProviderHome` and `provisionCodexAuth` wrap their whole body in the lock, so when the
   * lock became a promise they had to `await` it. ⚠️ **An UNCONTENDED call cannot tell the
   * difference**: `withProviderHomeLock` runs synchronously as far as its first suspension, which is
   * `await fn()` — so the directory and the credential are already on disk before the caller could
   * have awaited anything. The missing `await` only shows itself when the lock is genuinely held by
   * somebody else, which is what these two ask for.
   *
   * ⛔ **Each asserts its own premise, and that is not decoration** (review). The holder writes its
   * ready file INSIDE the critical section and then sleeps; if it died any time after that write it
   * would leave a lockfile naming a dead pid, `ownerIsGone` would break it, and the `continue` that
   * follows a break **skips the poll** — so the acquisition would run synchronously as far as
   * `await fn()` and the row would go green over a dropped `await`. `elapsed` and the holder's own
   * report are what make "contended" a fact rather than an intention.
   */
  it('🔴 a contended provisionProviderHome has made the home by the time it resolves', async () => {
    const managed = join(root, 'managed')
    const target = join(managed, 'proj', 'profile', 'codex')
    mkdirSync(dirname(target), { recursive: true })
    const ready = join(root, 'held-provision')
    const holder = contendLive(['hold-ms', target, ready, '400'])
    await until(() => existsSync(ready), 30_000, 'the other process to take the home lock')

    const started = Date.now()
    await provisionProviderHome(managed, target)
    const elapsed = Date.now() - started

    expect(existsSync(target), 'it resolved before it had made the directory').toBe(true)
    expect(lstatSync(target).isDirectory()).toBe(true)
    expect(lstatSync(target).mode & 0o777).toBe(0o700)
    // ⚠️ The premise: this really did wait for another process, rather than breaking a corpse.
    expect(elapsed, 'the holder was still holding when we asked').toBeGreaterThan(300)
    await until(() => holder.said.length > 0, 5_000, 'the holder to report')
    expect(holder.said[0]?.entered, 'the other process really held the lock').toBe(true)
  })

  it('🔴 a contended provisionCodexAuth has copied the credential by the time it resolves', async () => {
    const source = join(root, 'personal-auth.json')
    writeFileSync(source, '{"tokens":{"access_token":"contended"}}')
    const ready = join(root, 'held-auth')
    const holder = contendLive(['hold-ms', home, ready, '400'])
    await until(() => existsSync(ready), 30_000, 'the other process to take the home lock')

    const started = Date.now()
    await provisionCodexAuth(home, { sourceAuthPath: source })
    const elapsed = Date.now() - started

    const dest = join(home, 'auth.json')
    expect(existsSync(dest), 'it resolved before it had written the credential').toBe(true)
    expect(readFileSync(dest, 'utf8')).toContain('contended')
    expect(lstatSync(dest).mode & 0o777).toBe(0o600)
    expect(elapsed, 'the holder was still holding when we asked').toBeGreaterThan(300)
    await until(() => holder.said.length > 0, 5_000, 'the holder to report')
    expect(holder.said[0]?.entered, 'the other process really held the lock').toBe(true)
  })
  /**
   * ⚠️ **An asserted GAP, not a feature** — the one thing the new signature makes easy and that must
   * not be done (review, measured).
   *
   * Since `fn` may return a promise, `await withProviderHomeLock(home, async () => { await
   * provisionCodexAuth(home) })` type-checks and reads correctly. It is a self-deadlock:
   * {@link ownerIsGone} refuses to break a lockfile stamped with our own pid, so the inner
   * acquisition polls until `timeoutMs` and then throws *"held by pid <ours>"* — the least
   * actionable sentence this app can print. ⛔ **There is deliberately no re-entrant grant**: one
   * would let an inner body run outside the exclusion the outer body was promised. This test exists
   * so the cost is a recorded fact rather than a discovery, and so that anyone who adds re-entrancy
   * has to delete an assertion that says why it was refused.
   */
  it('⚠️ a NESTED acquisition of the same home self-deadlocks and says so — an asserted gap', async () => {
    let inner: unknown = null
    await withProviderHomeLock(
      home,
      async () => {
        inner = await withProviderHomeLock(home, () => 'got in', {
          timeoutMs: 200,
          pollMs: 20,
        }).catch((error: unknown) => error)
      },
      { timeoutMs: 5_000, pollMs: 20 },
    )

    expect(inner, 'nesting must not quietly succeed').toBeInstanceOf(Error)
    expect((inner as Error).message).toMatch(/timed out acquiring provisioning lock/)
    // ⛔ The part that makes it unactionable, asserted so the sentence is not a surprise later.
    expect((inner as Error).message).toContain(`held by pid ${process.pid}`)
    expect(existsSync(`${home}.lock`), 'the outer release still ran').toBe(false)
  })
})

/**
 * ## 🔴 293 §1 · a path that stopped being the path (289 rank 1, REPRODUCED by the reviewer)
 *
 * `provisionProviderHome` walked root → home rejecting every symlink component, and then **awaited**
 * the per-home lock. A contested lock yields; the `openSync` of the lockfile and the leaf
 * `lstat`/`mkdir` afterwards used **the original string path again**. So:
 *
 * > *Process A waits behind a live `codex.lock`. While it sleeps, B renames the already-validated
 * > profile ancestor and replaces it with a symlink to an outside directory. A retries through the
 * > symlink, creates `outside/codex`, and returns success.* — `{"escapedHomeCreated":true}`
 *
 * ⛔ **Then the ordinary Codex path copies `auth.json` into it.** A credential leaves the managed
 * root through the one function whose advertised guarantee is that it cannot.
 *
 * ## ⛔ Why neither existing file could reach it, and what that means for this one
 *
 * `provider-home.test.ts` plants its symlink **before** the call and asserts a rejection: it proves
 * the check works, and never asks whether the check still holds after the wait. This file's nine
 * other tests are all lock contention with no symlink in them. ⚑ **The defect lives in the seam, so
 * the test has to cross it: real contention AND a real swap, in one case.**
 *
 * ⚠️ **Not a 243 regression.** Verified against the pre-243 source: the ordering is identical and
 * the wait was ten seconds in both versions. The attack is cross-PROCESS — which is why the holder
 * below is a real child and not a hand-written lockfile.
 */
describe('293 §1 · the ancestry check survives the wait that follows it', () => {
  let root: string
  let managed: string
  let outside: string
  let profile: string
  let target: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-escape-293-'))
    managed = join(root, 'managed')
    outside = join(root, 'outside')
    profile = join(managed, 'proj', 'profile')
    target = join(profile, 'codex')
    mkdirSync(profile, { recursive: true })
    mkdirSync(outside, { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const until = async (pred: () => boolean, what: string, ms = 30_000): Promise<void> => {
    const deadline = Date.now() + ms
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((r) => setTimeout(r, 2))
    }
  }

  /** Rename the validated ancestor away and leave a symlink to `outside` wearing its name. */
  const swapTheAncestor = (): void => {
    renameSync(profile, join(root, 'profile-moved'))
    symlinkSync(outside, profile)
  }

  /** A real second process holding the real lock on the home, for `holdMs`. */
  const holdTheLock = async (home: string, holdMs: number): Promise<void> => {
    const ready = join(root, `held-${holdMs}-${home.length}`)
    const holder = contendLive(['hold-ms', home, ready, String(holdMs)])
    await until(() => existsSync(ready), `the holder to take the lock (${holder.stderr()})`)
  }

  it('🔴 refuses the home when the validated ancestor becomes a symlink during the wait', async () => {
    await holdTheLock(target, 900)

    // ⛔ Started, not awaited: the walk runs, the acquisition finds the lock held, and the swap
    // below lands while it is in `await delay(pollMs)` — which is the whole interleaving.
    const provisioning = provisionProviderHome(managed, target).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
    await new Promise((r) => setTimeout(r, 60))
    swapTheAncestor()

    const refusal = await provisioning
    expect(refusal, 'a provisioning that escaped the managed root reported success').toBeInstanceOf(
      Error,
    )
    expect((refusal as Error).message).toMatch(/symlink|replaced|no longer the directory/)

    // 🔴 **The finding itself.** Before 293 this directory was created, and `prepareProviderHome`
    // copied `auth.json` into it on the next line of the real caller.
    expect(existsSync(join(outside, 'codex')), 'a provider home was created OUTSIDE the root').toBe(
      false,
    )
    // ⚠️ …and not the sidecar either: the lockfile is derived from the same path, so a check that
    // ran only after acquisition would leave `codex.lock` out here as its own escape.
    expect(readdirSync(outside), 'something was written outside the managed root').toEqual([])
  }, 30_000)

  it('⚑ …the pairing: the same contended provisioning still succeeds when nothing is swapped', async () => {
    // Without this, the assertion above is satisfied by a provisioning that refuses every contended
    // call — which would break every second launch of the app and pass the test above.
    await holdTheLock(target, 400)

    await provisionProviderHome(managed, target)

    expect(existsSync(target), 'the contended provisioning never made the home').toBe(true)
    expect(lstatSync(target).isDirectory()).toBe(true)
    expect(lstatSync(target).mode & 0o777).toBe(0o700)
    expect(readdirSync(outside)).toEqual([])
  }, 30_000)

  it('🔴 refuses the CREDENTIAL when the ancestor is swapped while its copy waits', async () => {
    // The consequence rather than its cause, and one function later: `provisionProviderHome` can
    // return honestly and the ancestor still be swapped before the credential is written.
    mkdirSync(target, { recursive: true, mode: 0o700 })
    // ⛔ **The escape has to be LANDABLE, or the test measures `ENOENT`** (measured: without this
    // line the copy failed for want of a directory, the assertions all held, and the check under
    // test never ran). So the outside tree is complete before the swap and a credential written
    // through the symlink has somewhere to go.
    mkdirSync(join(outside, 'codex'), { recursive: true, mode: 0o700 })
    const source = join(root, 'personal-auth.json')
    writeFileSync(source, '{"tokens":{"access_token":"must-not-escape"}}')
    await holdTheLock(target, 900)

    const copying = provisionCodexAuth(target, {
      sourceAuthPath: source,
      managedRoot: managed,
    }).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
    await new Promise((r) => setTimeout(r, 60))
    swapTheAncestor()

    const refusal = await copying
    expect(refusal, 'a credential write into an escaped home reported success').toBeInstanceOf(
      Error,
    )
    // ⚠️ …and refused by the ancestry check rather than by a missing directory, which is the
    // difference between this test and the vacuous first draft of it.
    expect((refusal as Error).message).toMatch(/symlink|replaced|no longer the directory/)
    expect(
      existsSync(join(outside, 'codex', 'auth.json')),
      'the Codex credential was written outside the managed root',
    ).toBe(false)
  }, 30_000)

  it('⚑ …and the pairing for the credential: an undisturbed contended copy still lands', async () => {
    mkdirSync(target, { recursive: true, mode: 0o700 })
    const source = join(root, 'personal-auth.json')
    writeFileSync(source, '{"tokens":{"access_token":"contended"}}')
    await holdTheLock(target, 400)

    await provisionCodexAuth(target, { sourceAuthPath: source, managedRoot: managed })

    expect(readFileSync(join(target, 'auth.json'), 'utf8')).toContain('contended')
    expect(lstatSync(join(target, 'auth.json')).mode & 0o777).toBe(0o600)
  }, 30_000)
})
