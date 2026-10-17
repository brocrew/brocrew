import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  CodexRuntime,
  ResumeError,
  type CodexIncoming,
  type CodexTransport,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  CodexHomeBootAbandoned,
  beginCodexHomeBoot,
  resetCodexHomeBoots,
} from '../src/codex/home-boot'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'

/**
 * 180 — **no two `codex app-server` processes may boot on the same home at once.**
 *
 * ⛔ **What these tests can and cannot pin, said plainly.** They pin the SERIALIZATION — that the
 * second spawn does not happen until the first handshake has answered, and that the gate lets go
 * where it says it does. They do **not** reproduce the sqlite failure itself: that is the provider's
 * own first-creation race, it needs two real app-servers and a real cold `CODEX_SQLITE_HOME`, and it
 * lands about 7 times in 10 with the two spawns in one tick. `codex-home-race.smoke.ts` is the
 * instrument for that half, and no mutation of this file can red it (`175`'s point, unchanged).
 *
 * So: this file guards the mechanism, the smoke guards the effect, and neither is the whole proof.
 */

const CONFORMANT_USER_AGENT = `codex-app-server/0.146.0 (protocol ${CODEX_PROTOCOL_VERSION})`

/**
 * A transport whose handshake answers only when the test says so, and whose **work never answers at
 * all** until it is closed.
 *
 * ⚠️ **The second half is not decoration, and the mutation table is what found that out.** An
 * earlier version of this fake resolved `model/list` immediately, which made "the gate lets go at
 * the handshake" and "the gate lets go at the end of the work" produce identical timelines — so the
 * mutation that holds the home across the whole probe came back GREEN. A fake that finishes its work
 * instantly cannot measure when a lock is released. Answering only on `close()` is also the real
 * transport's own contract: *"`request` settles when the child answers, when it EXITS, or when the
 * transport is closed."*
 */
class GatedTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly pending = new Set<(error: Error) => void>()
  private releaseHandshake: (() => void) | null = null
  readonly requests: string[] = []
  closes = 0

  constructor(
    readonly home: string,
    readonly label: string,
    private readonly log: string[],
  ) {
    log.push(`spawn:${label}`)
  }

  /** Let this transport's pending `initialize` answer. */
  answerHandshake(): void {
    this.releaseHandshake?.()
    this.releaseHandshake = null
  }

  request(method: string): Promise<unknown> {
    this.requests.push(method)
    if (method === 'initialize') {
      return new Promise((resolve) => {
        this.releaseHandshake = () => {
          this.log.push(`handshake:${this.label}`)
          resolve({ userAgent: CONFORMANT_USER_AGENT, codexHome: this.home })
        }
      })
    }
    return new Promise((_resolve, reject) => this.pending.add(reject))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.closes += 1
    for (const reject of this.pending) reject(new Error('transport closed'))
    this.pending.clear()
    this.queue.close()
  }
}

describe('180 · one app-server boots on a home at a time', () => {
  let root: string
  /** Every transport a test spawned, so nothing is left awaiting a request that cannot answer. */
  let spawned: GatedTransport[]
  let log: string[]

  beforeEach(() => {
    resetCodexHomeBoots()
    root = mkdtempSync(join(tmpdir(), 'brobot2-boot-'))
    spawned = []
    log = []
  })
  afterEach(() => {
    for (const transport of spawned) transport.close()
    resetCodexHomeBoots()
    rmSync(root, { recursive: true, force: true })
  })

  /** A runtime whose transports are recorded and labelled in spawn order. */
  function runtimeUnderTest(label: (index: number) => string = (i) => 'ab'[i] ?? `t${i}`) {
    return new CodexRuntime((context) => {
      const transport = new GatedTransport(context.providerHome, label(spawned.length), log)
      spawned.push(transport)
      return transport
    })
  }

  /** Start a probe and swallow its eventual rejection — every fake request ends by being closed. */
  function probe(runtime: CodexRuntime, providerHome: string): void {
    void runtime.listModels({ providerHome }).catch(() => {})
  }

  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * ⛔ **The defect, as a test.** Before 180 both spawns happened in the same tick — which is the
   * 7-in-10 shape — and this assertion read `spawn:a, spawn:b, handshake:a`.
   */
  it('the second app-server does not spawn until the first handshake has answered', async () => {
    const runtime = runtimeUnderTest()
    const home = join(root, 'codex')

    probe(runtime, home)
    probe(runtime, home)
    // Long enough for a second spawn to have happened if nothing were stopping it: the ungated code
    // reached `transportFactory` on its first microtask.
    await settle(50)

    expect(log).toEqual(['spawn:a'])

    spawned[0]!.answerHandshake()
    await settle(20)
    // …and the moment it answered, the next one went. The ORDER is the assertion, not the count:
    // a gate that never let go would also leave one spawn here.
    expect(log).toEqual(['spawn:a', 'handshake:a', 'spawn:b'])
  })

  /** The paired positive: two homes are two queues, and neither waits on the other. */
  it('a DIFFERENT home does not wait — the gate is per home, not global', async () => {
    const runtime = runtimeUnderTest()

    probe(runtime, join(root, 'alice'))
    probe(runtime, join(root, 'bob'))
    await settle(50)

    expect(log).toEqual(['spawn:a', 'spawn:b'])
  })

  /**
   * ⚠️ **Where the gate lets go is the whole design.** Held to the end of a `model/list` or a
   * `thread/start` it would be a lock across a network wait, and one slow provider would stop the
   * app launching Codex at all.
   */
  it('lets go at the handshake, not at the end of the work', async () => {
    const runtime = runtimeUnderTest()
    const home = join(root, 'codex')

    probe(runtime, home)
    await settle(10)
    spawned[0]!.answerHandshake()
    await settle(10)
    // The first probe is now inside `model/list`, which this fake never answers — exactly the shape
    // a slow provider produces. The next boot must not be waiting on it.
    expect(spawned[0]!.requests).toContain('model/list')

    probe(runtime, home)
    await settle(30)
    expect(log).toEqual(['spawn:a', 'handshake:a', 'spawn:b'])
  })

  /** A boot that never answers must not strand the home: the waiter gives up and boots anyway. */
  it('fails OPEN — a stuck app-server delays the next launch, it does not forbid it', async () => {
    const stuck = await beginCodexHomeBoot(join(root, 'codex'))
    const started = Date.now()
    const next = await beginCodexHomeBoot(join(root, 'codex'), { waitMs: 40 })
    const waited = Date.now() - started

    expect(waited).toBeGreaterThanOrEqual(35)
    next()
    stuck() // the stuck holder, arriving late — and it must not hand the slot out twice
  })

  /** …and the negative half: a holder that DOES release is not waited out. */
  it('a released slot is handed over at once', async () => {
    const first = await beginCodexHomeBoot(join(root, 'codex'))
    first()
    const started = Date.now()
    ;(await beginCodexHomeBoot(join(root, 'codex'), { waitMs: 5_000 }))()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  /**
   * ⛔ **A launch that never reached its handshake still hands the slot back.** This is the failure
   * the gate itself could cause: one refused spawn and every later Codex launch on that home would
   * wait out its whole budget.
   */
  it('a spawn that throws releases the home', async () => {
    const home = join(root, 'codex')
    const exploding = new CodexRuntime(() => {
      throw new Error('no binary')
    })
    await expect(exploding.listModels({ providerHome: home })).rejects.toThrow('no binary')

    const started = Date.now()
    ;(await beginCodexHomeBoot(home, { waitMs: 5_000 }))()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  /**
   * ⛔ **182 M1 — a successor that failed open must not erase the predecessor it gave up on.**
   *
   * The old gate stored one chain per home and deleted it on release if it was still the stored one.
   * After a fail-open that is exactly the wrong test: the successor IS the stored one, the
   * predecessor is still creating its sqlite state, and the successor's release handed the home to
   * the next launch with no wait at all — which is the 7-in-10 shape 180 measured, reintroduced by
   * 180's own mitigation.
   */
  it('a fail-open successor does not hand the home away while the first boot is still live', async () => {
    const home = join(root, 'codex')
    const stuck = await beginCodexHomeBoot(home) // never released — the wedged app-server
    const failedOpen = await beginCodexHomeBoot(home, { waitMs: 30 })
    failedOpen() // it finished its own boot and let go; `stuck` is still out there

    const started = Date.now()
    const third = await beginCodexHomeBoot(home, { waitMs: 120 })
    const waited = Date.now() - started
    third()

    // It waited out its OWN budget rather than being waved through: the still-pending boot is still
    // a boot, and the third launch is the one that would have raced it.
    expect(waited).toBeGreaterThanOrEqual(100)
    stuck()
  })

  /**
   * …and the pairing, which is what makes the assertion above about ownership rather than about
   * always waiting: once the wedged holder DOES let go, the home is free for everyone.
   */
  it('and hands it over at once when every live boot has released', async () => {
    const home = join(root, 'codex')
    const first = await beginCodexHomeBoot(home)
    const second = await beginCodexHomeBoot(home, { waitMs: 30 })
    second()
    first()

    const started = Date.now()
    ;(await beginCodexHomeBoot(home, { waitMs: 5_000 }))()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  /**
   * ⛔ **…and it waits for ALL of them, not for the most recent one.**
   *
   * ⚑ **This test exists because the mutation table said it had to.** M12 — *an arrival waits only
   * for the LAST live boot* — came back GREEN over the two tests above: with one stuck holder left
   * in the set, "all of them" and "the last of them" are the same list. The distinguishing shape is
   * a set of two where the LAST one lets go first, which is exactly what a fail-open produces.
   */
  it('waits for every live boot, not merely the most recent one', async () => {
    const home = join(root, 'codex')
    const stuck = await beginCodexHomeBoot(home) // the wedged predecessor, never released
    const failedOpen = await beginCodexHomeBoot(home, { waitMs: 30 }) // gave up on it, now live too

    let arrived = false
    void beginCodexHomeBoot(home, { waitMs: 5_000 }).then((release) => {
      arrived = true
      release()
    })
    await settle(30)
    expect(arrived, 'it is behind both of them').toBe(false)

    // The most recent boot lets go — and that is not enough, because the one it failed open on is
    // still creating its sqlite state.
    failedOpen()
    await settle(120)
    expect(arrived, 'the wedged FIRST boot still holds it').toBe(false)

    // The pairing: when that one lets go too, it goes through at once.
    stuck()
    await settle(30)
    expect(arrived).toBe(true)
  })

  /**
   * ⛔ **182 L1 — a caller that gave up stops holding a place in the queue** — and, since 202
   * (191 H4), **does not get a slot at all**.
   *
   * Waiting here is the one interval of a Codex launch with no child in it, so `cancelWith` has
   * nothing to tear down and cancellation could not reach it. A credential check whose ten-second
   * deadline expired sat in this queue for the remaining five seconds of the boot budget.
   *
   * ⚑ **What 202 changed is the RETURN, not the release.** 182 handed the abandoned caller a slot,
   * which is what a session start then spawned an app-server on — after `closeAll` had stopped
   * waiting for any. The place is still given up; the caller is now told so.
   */
  it('an abort ends the queue wait, and gives the place up with it', async () => {
    const home = join(root, 'codex')
    const stuck = await beginCodexHomeBoot(home)
    const giving = new AbortController()

    const started = Date.now()
    const queued = beginCodexHomeBoot(home, { waitMs: 5_000, signal: giving.signal })
    let settled = false
    void queued.then(
      () => (settled = true),
      () => (settled = true),
    )
    await settle(30)
    // The negative half, taken first: without the abort this caller is still waiting, so the
    // assertion below is about the signal and not about a gate that never blocks anyone.
    expect(settled).toBe(false)

    giving.abort()
    await expect(queued).rejects.toBeInstanceOf(CodexHomeBootAbandoned)
    expect(Date.now() - started).toBeLessThan(1_000)

    // ⛔ And the place is given up, not merely stopped being waited on: a caller that abandoned its
    // launch must not be something the NEXT one queues behind.
    const after = Date.now()
    const next = await beginCodexHomeBoot(home, { waitMs: 60 })
    expect(Date.now() - after).toBeGreaterThanOrEqual(50) // still behind `stuck`, correctly
    next()
    stuck()
  })

  /** A signal that had already aborted never waits at all — 180's rule, in this file's terms. */
  it('a caller who gave up before it arrived does not queue', async () => {
    const home = join(root, 'codex')
    const stuck = await beginCodexHomeBoot(home)

    const started = Date.now()
    await expect(
      beginCodexHomeBoot(home, { waitMs: 5_000, signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(CodexHomeBootAbandoned)
    expect(Date.now() - started).toBeLessThan(1_000)
    stuck()
  })

  /** `/var/…` and `/private/var/…` are one home. 178 lost an assertion to exactly this. */
  it('two spellings of one home are one queue', async (ctx) => {
    // ⚠️ **darwin only** (T-001): `/private/tmp` exists only on a Mac.
    // CI runs on Linux and skips it; the Mac's own gate runs it.
    ctx.skip(process.platform !== 'darwin')
    const real = mkdtempSync(join('/private', tmpdir().replace(/^\/private/, ''), 'brobot2-spell-'))
    try {
      const holder = await beginCodexHomeBoot(real)
      let second = false
      void beginCodexHomeBoot(real.replace(/^\/private/, ''), { waitMs: 5_000 }).then((release) => {
        second = true
        release()
      })
      await settle(30)
      expect(second).toBe(false)
      holder()
      await settle(20)
      expect(second).toBe(true)
    } finally {
      rmSync(real, { recursive: true, force: true })
    }
  })

  /**
   * ## ⛔ 202 · a queued boot that the app gave up on does not become a spawn (191 H4)
   *
   * `start`, `resume` and `listModels` each hold an `AbortSignal` and each passed none to the gate.
   * A boot queued behind another therefore waited its full {@link BOOT_WAIT_MS} whatever had
   * happened to the app in the meantime — and `closeAll` stops awaiting launch termination after two
   * five-second drains. Quit at t0 → barrier gives up at t+10 s → **spawn at t+15 s**, with nothing
   * left anywhere that was waiting for it.
   */
  describe('202 · an aborted waiter never spawns (191 H4)', () => {
    it('⛔ a start aborted while QUEUED creates no transport', async () => {
      const runtime = runtimeUnderTest()
      const home = join(root, 'codex')
      const quitting = new AbortController()

      probe(runtime, home) // holds the gate: its handshake is never answered
      await settle(20)
      expect(log).toEqual(['spawn:a'])

      const queued = runtime.start({
        cwd: join(root, 'cwd'),
        providerHome: home,
        signal: quitting.signal,
      })
      queued.catch(() => {})
      await settle(20)
      expect(log, 'still queued behind the first boot').toEqual(['spawn:a'])

      quitting.abort()
      await expect(queued).rejects.toBeInstanceOf(CodexHomeBootAbandoned)
      // ⛔ The claim: no second app-server, then or later. Before 202 one appeared when the gate's
      // own fifteen seconds ran out, long after the quit had stopped waiting for launches.
      await settle(50)
      expect(log, 'nothing was spawned for the launch that was abandoned').toEqual(['spawn:a'])
      expect(spawned).toHaveLength(1)
    })

    it('⛔ …and a model probe aborted while queued creates none either', async () => {
      const runtime = runtimeUnderTest()
      const home = join(root, 'codex')
      const quitting = new AbortController()

      probe(runtime, home)
      await settle(20)

      const queued = runtime.listModels({ providerHome: home, signal: quitting.signal })
      queued.catch(() => {})
      await settle(20)
      quitting.abort()
      await expect(queued).rejects.toThrow()
      await settle(50)
      expect(log).toEqual(['spawn:a'])
    })

    it('⚑ the pairing: an ordinary queued boot still spawns when its predecessor lets go', async () => {
      // Without this, "an aborted waiter does not spawn" would pass for a gate that had stopped
      // letting ANYTHING through — which is the deadlock 180 chose fail-open to avoid.
      const runtime = runtimeUnderTest()
      const home = join(root, 'codex')

      probe(runtime, home)
      await settle(20)
      const queued = runtime.start({ cwd: join(root, 'cwd'), providerHome: home })
      queued.catch(() => {})
      await settle(20)
      expect(log).toEqual(['spawn:a'])

      spawned[0]!.answerHandshake()
      await settle(30)
      expect(log, 'the queue moved, exactly as it did before 202').toEqual([
        'spawn:a',
        'handshake:a',
        'spawn:b',
      ])
    })

    it("⚑ …and 180's fail-open still fails OPEN — giving up is not the same as being abandoned", async () => {
      // ⛔ The distinction the whole change rests on. `gave-up` (the wait ran out) and `abandoned`
      // (the caller left) both end the wait, and only the second means nobody is there any more.
      // Folding them together would turn 180's fail-open into the refusal 180 explicitly rejected:
      // *"a Codex that never starts again for the life of the process"*.
      const home = join(root, 'codex')
      const stuck = await beginCodexHomeBoot(home) // never released within this test's budget
      const started = Date.now()

      // No signal: this waiter has not gone anywhere, its budget simply runs out.
      const release = await beginCodexHomeBoot(home, { waitMs: 60 })
      expect(
        Date.now() - started,
        'it really did wait on the stuck predecessor',
      ).toBeGreaterThanOrEqual(50)
      // ⛔ …and it got a slot. A rejection here would be 180's deadlock.
      expect(typeof release).toBe('function')
      release()
      stuck()
    })
  })
})

/**
 * 🔴 **697 · `673` F-6 — a Codex resume refused BEFORE its handshake is a `ResumeError` carrying
 * why, as Claude's always was.**
 *
 * ⛔ On `main` these three left as themselves — a plain `Error`, a `CodexHomeBootAbandoned`, the
 * factory's own throw — so the wake's classifier (`aWakeThatDidNotHappen`) knew none of them and
 * RETHREW a spawn failure that Claude's adapter, for the same failure, turned into *could not be
 * resumed*. ⚑ Driven through `CodexRuntime.resume` itself, on a real home and the real boot gate.
 */
describe('697 · 673 F-6 — what a Codex resume refuses before its handshake', () => {
  const ref = { provider: 'codex' as const, sessionId: 'thr_1', cwd: '/tmp/x', rotation: 0 }
  let root: string
  let built: number

  beforeEach(() => {
    resetCodexHomeBoots()
    root = mkdtempSync(join(tmpdir(), 'brobot2-resume-setup-'))
    built = 0
  })
  afterEach(() => {
    resetCodexHomeBoots()
    rmSync(root, { recursive: true, force: true })
  })

  const refusal = async (resuming: Promise<unknown>): Promise<ResumeError> => {
    const error = await resuming.then(
      () => null,
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(ResumeError)
    return error as ResumeError
  }

  it('🔴 a cancel already requested — nothing spawned, and the cancel is the cause', async () => {
    const runtime = new CodexRuntime(() => {
      built += 1
      throw new Error('never reached')
    })
    const error = await refusal(
      runtime.resume(ref, { providerHome: join(root, 'codex'), signal: AbortSignal.abort() }),
    )
    expect((error.cause as Error).message).toBe('codex resume was cancelled before it started')
    expect(built).toBe(0)
  })

  it('🔴 a boot gate given up while queued — the abandonment is the cause', async () => {
    const home = join(root, 'codex')
    const stuck = await beginCodexHomeBoot(home)
    const giving = new AbortController()
    const runtime = new CodexRuntime(() => {
      built += 1
      throw new Error('never reached')
    })
    const resuming = runtime.resume(ref, { providerHome: home, signal: giving.signal })
    void resuming.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 30))
    giving.abort()
    const error = await refusal(resuming)
    expect(error.cause).toBeInstanceOf(CodexHomeBootAbandoned)
    expect(built).toBe(0)
    stuck()
  })

  it('🔴 a transport that could not be spawned — its own error is the cause, and the home is free', async () => {
    // ⚑ A spawn a person must fix — the binary is not there — which is what the rail's word means.
    const boom = new Error('spawn ENOENT')
    const runtime = new CodexRuntime(() => {
      built += 1
      throw boom
    })
    const home = join(root, 'codex')
    const error = await refusal(runtime.resume(ref, { providerHome: home }))
    // ⚠️ The SAME object: a `cause` that was merely an error would not say which failure it was.
    expect(error.cause).toBe(boom)
    // ⚑ **706 · …and never a thread that is gone** — the host lets go of a conversation only for
    // `noSuchSession` (it read *"no cause"* until `705` F-3), and a missing binary says nothing
    // about the thread.
    expect(error.noSuchSession).toBe(false)
    expect(error.message).toBe('resume setup failed: spawn ENOENT')
    expect(built).toBe(1)
    const started = Date.now()
    ;(await beginCodexHomeBoot(home, { waitMs: 5_000 }))()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('⚑ controls: an unusable sign-in stays itself, and a wrong provider carries no cause', async () => {
    const runtime = new CodexRuntime(
      () => {
        built += 1
        throw new Error('never reached')
      },
      () => ({ ok: false, reason: 'expired' }),
    )
    const signIn = await runtime
      .resume(ref, { providerHome: join(root, 'codex') })
      .catch((thrown: unknown) => thrown)
    expect(signIn).toBeInstanceOf(AuthUnavailableError)
    expect(signIn).not.toBeInstanceOf(ResumeError)
    const wrong = await refusal(
      runtime.resume({ ...ref, provider: 'claude' }, { providerHome: join(root, 'codex') }),
    )
    expect(wrong.cause).toBeUndefined()
    // ⚑ **706 · causeless, and still not a thread that is gone** — the wrong adapter was asked, which
    // says nothing about the thread; the host never builds this ref (it picks the runtime by the row).
    expect(wrong.noSuchSession).toBe(false)
    expect(built).toBe(0)
  })
})
