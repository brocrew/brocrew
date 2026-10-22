import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  lutimesSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provisionProviderHome, withProviderHomeLock } from '../src/internal/provider-home'
import { whoElseCanOpen } from '../../../scripts/lib/readable-only-by-this-user.mjs'

/**
 * Unit tests for the safe provisioning helper (021, hardened in 027 / 023 P1-H). It
 * must create the home as a REAL directory at mode 0700 under a validated managed
 * root, repair a loose mode, reject a regular file / path escape / symlink component,
 * and take a per-home cross-process lock. Uses the real filesystem in a throwaway root.
 */

describe('provisionProviderHome (021)', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot-home-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot-outside-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('creates the nested provider home under the managed root at 0700', async () => {
    const home = join(root, 'proj', 'profile')
    await provisionProviderHome(root, home)
    expect(existsSync(home)).toBe(true)
    expect(whoElseCanOpen(home, 0o700)).toEqual([])
    expect(whoElseCanOpen(join(root, 'proj'), 0o700)).toEqual([])
  })

  it('is idempotent when the home already exists', async () => {
    const home = join(root, 'proj', 'profile')
    await provisionProviderHome(root, home)
    await expect(provisionProviderHome(root, home)).resolves.not.toThrow()
  })

  it('rejects a provider home that escapes the managed root', async () => {
    await expect(provisionProviderHome(root, join(root, '..', 'escape'))).rejects.toThrow(
      /not under the managed root/,
    )
  })

  it('rejects a path that passes through a symlink component (redirection out of the root)', async () => {
    // A symlink INSIDE the root pointing outside it: creating under it would land
    // outside the managed root, defeating isolation.
    const link = join(root, 'link')
    symlinkSync(outside, link)
    await expect(provisionProviderHome(root, join(link, 'profile'))).rejects.toThrow(/symlink/)
    // And nothing was created through the link.
    expect(existsSync(join(outside, 'profile'))).toBe(false)
  })

  // --- 027 P1-H hardening ---

  it('enforces 0700 on an existing home, repairing a loose 0755', async (ctx) => {
    ctx.skip(process.platform === 'win32', 'Windows keeps no mode to loosen or repair')
    const home = join(root, 'proj', 'profile')
    mkdirSync(home, { recursive: true })
    chmodSync(home, 0o755)
    expect(lstatSync(home).mode & 0o777).toBe(0o755)
    await provisionProviderHome(root, home)
    expect(lstatSync(home).mode & 0o777).toBe(0o700) // repaired to owner-only
  })

  it('rejects an existing regular file at the home path (must be a real directory)', async () => {
    const home = join(root, 'proj', 'profile')
    mkdirSync(dirname(home), { recursive: true })
    writeFileSync(home, 'not a directory')
    await expect(provisionProviderHome(root, home)).rejects.toThrow(/not a directory/)
  })

  it('rejects a non-directory ancestor on the path', async () => {
    const file = join(root, 'proj')
    writeFileSync(file, 'a file, not a dir')
    await expect(provisionProviderHome(root, join(file, 'profile'))).rejects.toThrow(
      /not a directory/,
    )
  })

  it('takes an exclusive per-home lock: blocks + fails closed while held, succeeds once released', async () => {
    const home = join(root, 'profile')
    mkdirSync(home, { recursive: true })
    // Simulate another process holding the lock by pre-creating the O_EXCL lockfile.
    const lock = `${home}.lock`
    closeSync(openSync(lock, 'wx'))
    let ranWhileHeld = false
    await expect(
      withProviderHomeLock(
        home,
        () => {
          ranWhileHeld = true
        },
        { timeoutMs: 150, pollMs: 20 },
      ),
    ).rejects.toThrow(/timed out acquiring provisioning lock/)
    expect(ranWhileHeld).toBe(false) // never entered the critical section while held

    unlinkSync(lock) // the other holder releases
    let ranAfter = false
    await withProviderHomeLock(home, () => {
      ranAfter = true
    })
    expect(ranAfter).toBe(true) // now acquirable; lock is cleaned up in finally
    expect(existsSync(lock)).toBe(false)
  })
})

/**
 * ## 🔴 202 · a stale sidecar lock must not brick provisioning (191 M5, ranked #1 by 198)
 *
 * The lockfile carried **no owner**, so a hard death while holding it left a file nothing could ever
 * decide was dead: every later provisioning of that home spent ten seconds of `Atomics.wait` and
 * threw, for the life of the installation. 198's words — *"the most likely way to brick the app"* —
 * and it measured Chromium doing the opposite in the same `userData`: `SingletonLock` names
 * `<hostname>-<pid>`, so a successor onto a SIGKILLed instance's directory takes the lock cleanly.
 */
describe('202 · the provisioning lock survives its owner dying (191 M5)', () => {
  let root: string
  let home: string
  let lock: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-lock-202-'))
    home = join(root, 'profile')
    mkdirSync(home, { recursive: true })
    lock = `${home}.lock`
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** A pid that certainly belongs to no live process: a child that has already exited. */
  const deadPid = (): number => {
    const done = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    if (done.pid === undefined) throw new Error('could not produce a dead pid')
    return done.pid
  }

  const held = (by: string): void => writeFileSync(lock, by)

  /** Older than {@link LOCK_UNSTAMPED_GRACE_MS}'s two seconds, by a margin nothing can round away. */
  const AGED = Date.now() / 1000 - 60

  it('🔴 a lock left by a DEAD process is broken, and provisioning proceeds', async () => {
    held(`${hostname()}\n${deadPid()}\n2026-08-21T00:00:00.000Z\n`)

    let ran = false
    const started = Date.now()
    await withProviderHomeLock(home, () => (ran = true), { timeoutMs: 3_000, pollMs: 20 })

    expect(ran, 'the critical section ran rather than throwing forever').toBe(true)
    // ⛔ And it did not sit out a timeout to get there: a corpse costs one syscall.
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(existsSync(lock), 'and the lock it took was released').toBe(false)
  })

  it('⚑ …and a lock held by a LIVE process is still honoured', async () => {
    // The pairing, and it is the assertion that matters most: a lock that breaks itself for
    // everybody is not a lock. A real second process, not this one — `withProviderHomeLock` treats
    // its OWN pid as re-entrant and would wait on it for a different reason.
    const alive = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'])
    try {
      held(`${hostname()}\n${alive.pid}\n2026-08-21T00:00:00.000Z\n`)
      let ran = false
      await expect(
        withProviderHomeLock(home, () => (ran = true), { timeoutMs: 150, pollMs: 20 }),
      ).rejects.toThrow(/timed out acquiring provisioning lock/)
      expect(ran).toBe(false)
      // ⚠️ …and the refusal now NAMES the holder, so a person who meets it can go and look.
      await expect(
        withProviderHomeLock(home, () => {}, { timeoutMs: 60, pollMs: 20 }),
      ).rejects.toThrow(new RegExp(`held by pid ${alive.pid}`))
    } finally {
      alive.kill('SIGKILL')
    }
  })

  it('⚑ a lock stamped by ANOTHER machine is not ours to judge', async () => {
    // ⛔ `process.kill(pid, 0)` answers about THIS host. A pid from somewhere else would be read
    // against our own process table, which is how a live holder on a shared filesystem gets its
    // lock broken. The honest answer is the old one: wait, then fail closed.
    held(`some-other-machine\n${deadPid()}\n2026-08-21T00:00:00.000Z\n`)
    await expect(
      withProviderHomeLock(home, () => {}, { timeoutMs: 120, pollMs: 20 }),
    ).rejects.toThrow(/timed out acquiring provisioning lock/)
  })

  it('⛔ an UNSTAMPED lock is decided by age — old is a corpse, fresh is a holder', async () => {
    // A crash between the create and the stamp, or a lockfile written by a build from before the
    // stamp existed. A live holder always has one within microseconds, so age is decidable.
    held('')
    const old = Date.now() / 1000 - 60
    utimesSync(lock, old, old)
    let ran = false
    await withProviderHomeLock(home, () => (ran = true), { timeoutMs: 2_000, pollMs: 20 })
    expect(ran).toBe(true)

    // The pairing: the same empty file, freshly written, is somebody who has just taken the lock
    // and not yet said who they are. Breaking that would be breaking a live lock.
    held('')
    await expect(
      withProviderHomeLock(home, () => {}, { timeoutMs: 120, pollMs: 20 }),
    ).rejects.toThrow(/timed out acquiring provisioning lock/)
  })

  /**
   * ⛔ **A regression this dispatch had to not introduce, in three shapes** (238, review).
   *
   * 238 replaced the judgement's two reads with one descriptor, and the first draft answered "no
   * judgement" whenever that descriptor could not be had — which made every shape below
   * **unbreakable**, so provisioning that home timed out forever. That is 191 M5's *"fails forever"*
   * arriving as the fix for a different finding, and it was measured against `cb7b7e4`: each of
   * these entered in single-digit milliseconds before 238 and sat out the whole timeout after it.
   *
   * ⚠️ **Two of the three do not even OPEN**, which the first repair (a `try/catch` around the read)
   * did not reach. Breaking them never needed to read them: `rename` needs write on the directory.
   */
  const unreadable: [string, (aged: boolean) => void][] = [
    [
      'a directory',
      (aged) => {
        mkdirSync(lock)
        if (aged) utimesSync(lock, AGED, AGED)
      },
    ],
    [
      'a file nobody may read',
      (aged) => {
        writeFileSync(lock, '')
        chmodSync(lock, 0o000)
        if (aged) utimesSync(lock, AGED, AGED)
      },
    ],
    [
      'a dangling symlink',
      (aged) => {
        symlinkSync(join(root, 'nothing-here'), lock)
        // ⚠️ `lutimes`, not `utimes`: the target does not exist, and it is the LINK's own mtime that
        // `lstat` reports and the judgement reads.
        if (aged) lutimesSync(lock, AGED, AGED)
      },
    ],
  ]
  it.each(unreadable)(
    '⛔ …and an aged %s at the lock path is still broken by age (238)',
    async (_what, plant) => {
      rmSync(lock, { recursive: true, force: true })
      plant(true)

      let ran = false
      await withProviderHomeLock(home, () => (ran = true), { timeoutMs: 2_000, pollMs: 20 })
      expect(ran, 'an unreadable corpse at the lock path could never be broken').toBe(true)
      // ⚑ …and it left nothing behind. `unlink` raises EPERM on a directory, so the steal name would
      // otherwise sit in the managed root for ever.
      expect(
        readdirSync(root).filter((entry) => entry.includes('.stale-')),
        'the break leaked its steal file',
      ).toEqual([])

      // ⚑ The pairing, so this is AGE and not "unreadable means break it": the same shape, freshly
      // made, is somebody who has just taken the lock and not yet said who they are.
      rmSync(lock, { recursive: true, force: true })
      plant(false)
      await expect(
        withProviderHomeLock(home, () => {}, { timeoutMs: 120, pollMs: 20 }),
      ).rejects.toThrow(/timed out acquiring provisioning lock/)
      rmSync(lock, { recursive: true, force: true })
    },
  )

  it('⛔ the lock this function takes says who holds it', async () => {
    // Without this the repair is one-sided: every lock we take would be undecidable to the NEXT
    // process, which is the state 191 M5 reported.
    let stamp = ''
    await withProviderHomeLock(home, () => (stamp = readFileSync(lock, 'utf8')))
    const [host, pid] = stamp.split('\n')
    expect(host).toBe(hostname())
    expect(Number(pid)).toBe(process.pid)
  })

  it('🔴 provisionProviderHome itself recovers from a dead owner', async () => {
    // ⚑ The end of the finding, at the level a person meets it: the home could not be provisioned
    // again, ever, after one hard death. This is that sentence, reversed.
    const managed = join(root, 'managed')
    const target = join(managed, 'proj', 'profile', 'codex')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(`${target}.lock`, `${hostname()}\n${deadPid()}\n2026-08-21T00:00:00.000Z\n`)

    await provisionProviderHome(managed, target)
    expect(lstatSync(target).isDirectory()).toBe(true)
    expect(whoElseCanOpen(target, 0o700)).toEqual([])
  })
})
