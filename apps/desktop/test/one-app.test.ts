import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProcessExit, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentRuntime,
  ModelChoice,
  ProviderRuntimeContext,
  ResumeOptions,
  SessionHandle,
  SessionRef,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { joinLiveHosts, workRunningElsewhere } from '../src/main/runtime/live-hosts'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import {
  SECOND_LAUNCH_NOTICE,
  STOOD_DOWN_NOTICE,
  ownershipFrom,
  runAsSoleInstance,
  type SoleInstanceDeps,
} from '../src/main/single-instance'
import type { GateEntry, HostGateVerdict } from '../src/main/one-host-gate'
import { claimSoleHost, gateFits, hostGatePath, whoIsOn } from '../src/main/one-host-gate'

/**
 * **One app, one database** (198, from 191 H6/H7/H8 and 194 H1/H2).
 *
 * Two reviewers who never spoke to each other reported five HIGH findings with one cause, and the
 * PM verified it in the source: `requestSingleInstanceLock` appeared nowhere in `apps/desktop/src`.
 *
 * This file holds both halves, and the split is the point.
 *
 *  - **The lock** is what makes a second PROCESS impossible. Its policy is `single-instance.ts`,
 *    and the tests below assert the consequence rather than a boolean: a launch that cannot take
 *    the lock opens no database, constructs no host and shows no window, because `start` is never
 *    called.
 *  - **The ownership test** is what makes the startup repair safe *regardless of how many apps are
 *    running*. 194 H1's mechanism is *"constructing a second `RuntimeHost`"*, which is reachable
 *    inside one process — every test does it. ⛔ **Nothing in the second half of this file touches
 *    the lock at all**, which is the acceptance criterion: the repair must be able to tell *"nobody
 *    is running this"* from *"I am not the one running this"* on its own.
 *
 * ## What is measured elsewhere, and where
 *
 * That the lock is keyed to `userData` rather than global — on which every live smoke depends,
 * because each one launches its own app with its own `--user-data-dir` — is not assertable from
 * here and was measured with a twenty-line Electron main before any of this was built. So was the
 * stale-lock case: a SIGKILLed instance leaves `SingletonLock -> <hostname>-<pid>` behind and the
 * successor takes it rather than waiting on it. `single-instance.ts` carries the table; smoke step
 * 44 is the same thing against the real app, and it is the reason there is **no lock of our own**
 * anywhere in this change.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

/** What a caught rejection actually says — never `String(error)`, which prints `[object Object]`. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : `not an Error: ${JSON.stringify(error)}`

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** The id of the user the tests run as; -1 where there are none. */
const UID = process.getuid?.() ?? -1

/** A folder in `root` too long for a socket inside it, made. */
function aLongFolderIn(root: string): string {
  const long = join(root, 'x'.repeat(Math.max(20, 120 - root.length)))
  mkdirSync(long, { recursive: true })
  return long
}

/** A socket name nothing listens on any more, as a process that ended leaves it. */
async function aDeadSocketAt(path: string): Promise<void> {
  const bound = `${path}.bound`
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(bound, resolve)
  })
  linkSync(bound, path)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(bound, { force: true })
}

/** What the gate reads of `path`, as `lstat` gives it, with another owner when one is named. */
function asEntry(path: string, uid?: number): GateEntry {
  const seen = lstatSync(path)
  return {
    uid: uid ?? seen.uid,
    mode: seen.mode,
    isDirectory: () => seen.isDirectory(),
    isSocket: () => seen.isSocket(),
  }
}

/**
 * A provider that never answers, so its session stays RESERVED and never registers (062).
 *
 * Everything but `start` is the fake's, because nothing here is about resume or the model list —
 * the whole point is one window in one method.
 */
class NeverArrives implements AgentRuntime {
  readonly provider = 'claude' as const
  private readonly inner = new FakeRuntime('claude')

  start(): Promise<SessionHandle> {
    return new Promise<SessionHandle>(() => {})
  }

  resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    return this.inner.resume(ref, options)
  }

  listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    return this.inner.listModels(context)
  }
}

describe('one app per userData (198)', () => {
  describe('the second launch', () => {
    /**
     * A launch, with every consequence recorded rather than performed.
     *
     * `start` is in here for the same reason `orphan-runs.test.ts` ends with a test that constructs
     * a host: a correct policy that nothing calls leaves the defect where it was, and every
     * assertion about the verdict would still pass.
     */
    const launch = async (
      lock: boolean,
      over: Partial<SoleInstanceDeps> = {},
    ): Promise<{
      verdict: string
      started: number
      stoodDown: number
      asked: number
      focused: number
      announced: string[]
      logged: string[]
      secondLaunch: (() => void) | null
    }> => {
      let started = 0
      let stoodDown = 0
      let asked = 0
      let focused = 0
      const announced: string[] = []
      const logged: string[] = []
      let secondLaunch: (() => void) | null = null
      const verdict = await runAsSoleInstance({
        requestLock: () => {
          asked += 1
          return lock
        },
        // ⛔ **Sole by default** (236 §3): every test written before the gate existed is about
        // Chromium's verdict, and a gate that answered anything else here would silently change
        // what each of them measures. The gate's own two verdicts are driven by `over`.
        claimGate: () => Promise.resolve('sole'),
        onSecondLaunch: (handler) => {
          secondLaunch = handler
        },
        focusExisting: () => {
          focused += 1
        },
        announce: (message) => announced.push(message),
        standDown: () => {
          stoodDown += 1
        },
        start: () => {
          started += 1
        },
        log: (message) => logged.push(message),
        ...over,
      })
      return { verdict, started, stoodDown, asked, focused, announced, logged, secondLaunch }
    }

    it('⛔ starts NOTHING when the lock is already held', async () => {
      const run = await launch(false)

      expect(run.verdict).toBe('already-running')
      // The finding, stated as the call that did not happen. `start` is the database, the migrations,
      // the `RuntimeHost` — and constructing that host is 194 H1's entire mechanism.
      expect(run.started).toBe(0)
      expect(run.stoodDown).toBe(1)
      expect(run.logged).toEqual([STOOD_DOWN_NOTICE])
    })

    it('says why before it stands down, whether the lock or the gate stood it down', async () => {
      // The stand-down exits at once, so the notice is written before it, never queued after.
      for (const [lock, gate] of [
        [false, 'sole'],
        [true, 'taken'],
      ] as const) {
        const order: string[] = []
        await launch(lock, {
          claimGate: () => Promise.resolve(gate),
          log: (message) => order.push(message),
          standDown: () => order.push('stood down'),
        })
        expect(order).toEqual([STOOD_DOWN_NOTICE, 'stood down'])
      }
    })

    it('does not register a second-launch handler from the instance that lost', async () => {
      // Registering one would be a listener on a process about to exit, and — worse — an app that
      // answered `second-instance` for a `userData` it does not hold.
      expect((await launch(false)).secondLaunch).toBeNull()
    })

    it('⛔ …and the paired positive: the launch that DOES take it starts the app, once', async () => {
      const run = await launch(true)

      expect(run.verdict).toBe('sole')
      expect(run.started).toBe(1)
      expect(run.stoodDown).toBe(0)
      expect(run.logged).toEqual([])
    })

    it('hands start the gate’s own answer, so the start knows whether it alone holds the folder', async () => {
      // The start-up check changes the data before opening it only on `sole`; a gate that could not
      // decide, or threw, is `unknown`, and is never asked a second time.
      const told: string[] = []
      const start = (ownership: string): void => void told.push(ownership)
      await launch(true, { start })
      await launch(true, { claimGate: () => Promise.resolve('unknown'), start })
      await launch(true, { claimGate: () => Promise.reject(new Error('no socket')), start })
      expect(told).toEqual(['sole', 'unknown', 'unknown'])
    })

    it('asks the gate again on a retry only while its answer is unknown, and one claim at a time', async () => {
      const claims: HostGateVerdict[] = ['unknown', 'sole', 'taken']
      let claimed = 0
      const asked = ownershipFrom('unknown', () => {
        claimed += 1
        return Promise.resolve(claims.shift() ?? 'unknown')
      })
      // The launch's own answer first, with no second claim.
      expect(await asked.ask()).toBe('unknown')
      expect(claimed).toBe(0)
      // Two asks at once make one claim.
      expect(await Promise.all([asked.ask(), asked.ask()])).toEqual(['unknown', 'unknown'])
      expect(claimed).toBe(1)
      expect(await asked.ask()).toBe('sole')
      expect(asked.held()).toBe('sole')
      // `sole` stands: no claim is made again.
      expect(await asked.ask()).toBe('sole')
      expect(claimed).toBe(2)

      const failing = ownershipFrom('unknown', () => Promise.reject(new Error('no socket')))
      await failing.ask()
      expect(await failing.ask()).toBe('unknown')
      const sole = ownershipFrom('sole', () => Promise.reject(new Error('never asked')))
      expect([await sole.ask(), await sole.ask()]).toEqual(['sole', 'sole'])
    })

    it('brings the running window forward and says why — a double-click never does nothing', async () => {
      // 106's rule reaches the launcher too. The second process cannot say anything: it has no
      // window and it is exiting. So the running instance both comes forward and speaks.
      const order: string[] = []
      const run = await launch(true, {
        focusExisting: () => order.push('focus'),
        announce: (message) => order.push(`announce:${message}`),
      })

      expect(run.secondLaunch).not.toBeNull()
      run.secondLaunch?.()

      // Focus FIRST: a sheet is attached to a window, and announcing to a window that is still
      // behind another application is the silent double-click with extra steps.
      expect(order).toEqual(['focus', `announce:${SECOND_LAUNCH_NOTICE}`])
    })

    it('says what happened to the person, not what Chromium calls it', () => {
      // The sentence names the consequence — one database, one set of provider homes — because
      // "the single-instance lock was already held" is a fact about Chromium and not about anything
      // the reader owns.
      expect(SECOND_LAUNCH_NOTICE).toContain('already running')
      expect(SECOND_LAUNCH_NOTICE).toContain('database')
      expect(SECOND_LAUNCH_NOTICE.toLowerCase()).not.toContain('lock')
    })

    it('🔒 asks the lock exactly once, so a launch can never sit in a retry', async () => {
      // A gate that polls is a gate that can hang, and 191 M5 is the report of one that does:
      // `Atomics.wait` on the main thread for ten seconds against a lock file whose owner was
      // SIGKILLed. One question, one answer.
      expect((await launch(true)).asked).toBe(1)
      expect((await launch(false)).asked).toBe(1)
    })

    it('⛔ is the ONLY thing that starts the app — asserted in the composition root', () => {
      // `index.ts` imports `electron` as a value, so no test can load it. What a test CAN do is read
      // it, and the shape is the finding: everything a second instance must not do — the database,
      // the migrations, the `RuntimeHost`, the window — has to live inside `start`, and `start` has
      // to be reachable only through the lock. A policy module with a perfect verdict and a
      // composition root that calls `whenReady` beside it would pass every other test in this file.
      const root = readFileSync(join(here, '../src/main/index.ts'), 'utf8')

      const opensStart = root.indexOf('function start(ownership: HostGateVerdict): void {')
      const claims = root.indexOf('runAsSoleInstance({')
      expect(opensStart, 'index.ts no longer declares start()').toBeGreaterThan(-1)
      expect(claims, 'index.ts no longer claims the instance').toBeGreaterThan(opensStart)

      // Everything a second process must never do, inside `start` — the database, the window, the
      // ready hook and the two quit handlers that would otherwise defer its own exit.
      const body = root.slice(opensStart, claims)
      const gestures = [
        'createRuntimeHost(initDatabase())',
        'createWindow()',
        '.whenReady()',
        "app.on('before-quit'",
        "app.on('window-all-closed'",
      ]
      for (const call of gestures) {
        expect(body, `${call} is no longer inside start()`).toContain(call)
      }

      // ⚠️ **And the negative, which is the half that can rot.** `createWindow` is excluded because
      // it is DECLARED above `start`; the rest have no declaration here, so finding one before
      // `start` means it runs on every launch, refused or not.
      const beforeStart = root.slice(0, opensStart)
      for (const call of gestures.filter((call) => call !== 'createWindow()')) {
        expect(beforeStart, `${call} runs outside start()`).not.toContain(call)
      }

      // ⚠️ **`start` is passed, never called.** A second reference that invoked it would be the same
      // defect wearing the guard's own name.
      //
      // ⚠️ **Comments stripped first, and 241 is why** (`app-menu.test.ts` made the same move for
      // the same reason). `index.ts` now DISCUSSES `start()` at length — it has to, because the
      // reason the app stopped opening is a fact about when that function runs — and a guard that
      // cannot tell a call from a sentence about a call forbids writing the sentence down.
      const code = root.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const bareStartsIn = (source: string): string[] =>
        source.match(/(?<!function )(?<![\w$.])start\s*\(/g) ?? []
      expect(bareStartsIn(code)).toHaveLength(0)
      expect(bareStartsIn(`${code}\nstart()`)).toHaveLength(1)
      expect(bareStartsIn(`${code}\nstart(ownership)`)).toHaveLength(1)
      expect(bareStartsIn(`${code}\nx.start()`)).toHaveLength(0)
      expect(bareStartsIn(`${code}\nx?.start()`)).toHaveLength(0)
      // ⛔ **The paired positive, so the stripping cannot be what makes this pass.** The declaration
      // is code, survives the strip, and is still exactly one.
      expect(
        code.match(/function start\(ownership: HostGateVerdict\): void \{/g) ?? [],
      ).toHaveLength(1)
      expect(root).toMatch(/^ {2}start,$/m)
      expect(root).toMatch(/requestLock: \(\) => app\.requestSingleInstanceLock\(\)/)
    })

    /**
     * ⛔ **Two shipped comments said something false about this pair, and 142's rule is that a
     * committed comment stating a false machine fact is worse than none** (208 H2).
     *
     *  - `single-instance.ts` said *"The other half of the answer, `live-hosts.ts`, is cross-process
     *    and still holds"* — of a module-level `Set`, which is the opposite of cross-process. It
     *    told a future implementer that a backstop exists for the 1 ms double-launch window, and
     *    none does.
     *  - `home-boot.ts` said *"The app does NOT call `requestSingleInstanceLock`"*, which `198`
     *    made false at `index.ts` and nobody went back for.
     *
     * ⚠️ **Asserted as FACTS, not as prose.** A test that only grepped the comments would go green
     * the day someone deleted them. The first half measures the directory's reach; the second is
     * `index.ts`'s own call, which the test above already reads. The greps are the second net, and
     * they exist because the rot happened INSIDE a sentence that was otherwise true.
     */
    describe('what the other half actually covers (208 H2)', () => {
      it('⛔ the live-host directory cannot see another PROCESS — it is module-local', async () => {
        const ledger = { theSameDatabase: true }
        const mine = { ledger, workInFlight: () => ['sess_mine'] }
        const leave = joinLiveHosts(mine)
        try {
          // The paired positive first, or the negative below proves only that something is broken:
          // within ONE module instance the directory sees the other host perfectly well.
          const alsoHere = joinLiveHosts({ ledger, workInFlight: () => ['sess_theirs'] })
          expect([...workRunningElsewhere(mine)]).toEqual(['sess_theirs'])
          alsoHere()

          // ⛔ A SECOND module instance — the closest a unit test gets to a second process, and the
          // relevant property is identical: a `Set` that is not shared cannot answer for work it
          // has never been told about.
          vi.resetModules()
          const elsewhere = (await import('../src/main/runtime/live-hosts')) as {
            workRunningElsewhere: typeof workRunningElsewhere
            joinLiveHosts: typeof joinLiveHosts
          }
          const theirs = { ledger, workInFlight: () => ['sess_theirs'] }
          const theirLeave = elsewhere.joinLiveHosts(theirs)
          try {
            // Each one is alone in its own directory: neither can see the other's live work, which
            // is what "not cross-process" means and what the comment claimed the opposite of.
            expect([...workRunningElsewhere(mine)]).toEqual([])
            expect([...elsewhere.workRunningElsewhere(theirs)]).toEqual([])
          } finally {
            theirLeave()
          }
        } finally {
          leave()
        }
      })

      it('⚠️ …and where either false sentence survives, it survives as a QUOTED correction', () => {
        // 142: the sentence is the artefact a future implementer acts on. Both are still in the
        // tree on purpose — deleting a wrong claim leaves nobody knowing it was ever made — so what
        // is asserted is that each one is attributed to the past and carries the fact beside it.
        // ⚠️ A plain `not.toContain` would fail on the correction itself, which is how this test
        // failed the first time it ran.
        const policy = readFileSync(join(here, '../src/main/single-instance.ts'), 'utf8')
        const boot = readFileSync(
          join(here, '../../../packages/runtime/src/codex/home-boot.ts'),
          'utf8',
        )

        for (const [file, claim] of [
          [policy, '`live-hosts.ts`, is cross-process'],
          [boot, 'does NOT call `requestSingleInstanceLock`'],
        ] as const) {
          const lines = file.split('\n').filter((line) => line.includes(claim))
          expect(lines.length, `"${claim}" is gone entirely — nobody will know it was made`).toBe(1)
          // ⛔ **The attribution has to be on the claim's OWN LINE, and 209's `M16` is why.** This
          // read `file.slice(at - 400, at)` — the paragraph above — and the paragraph above is
          // HEADED *"this comment used to say…"*. So a mutation that stripped the sentence's own
          // framing and left the bare false claim behind still found the words nearby and the test
          // stayed green: the row survived, and the assertion was measuring a heading rather than
          // the sentence it is about. ⚑ Both files carry the attribution inline, so this is the
          // stricter check AND the true one.
          expect(
            lines[0],
            `"${claim}" is stated on its own account — a reader has nothing telling them it is a ` +
              `sentence this file no longer stands behind`,
          ).toMatch(/It read:|used to say/)
          // ⚠️ Whitespace-collapsed: a doc-comment wraps, and `(208\n * H2)` is the same citation.
          expect(file.replace(/\s+\*?\s*/g, ' ')).toContain('208 H2')
        }

        // …and the corrected fact is present in each, so deleting the paragraph is not a pass.
        expect(policy).toContain('module-level `Set<LiveHost>`')
        expect(boot).toContain('It does')
      })
    })

    /**
     * ⛔ **The cross-process backstop** (236 §3, from `231` #4).
     *
     * ⚑ **Measured before it was built**, which the dispatch asked for in as many words:
     * `scripts/one-app-probe.mjs` drove 24 same-instant double launches on this Electron and
     * **8 of them had BOTH processes told `true`** — against `202`'s 3 / 12, with `+50 ms` and
     * `+200 ms` clean at 0 / 4 and a positive control at 2 / 2. The window did not close by itself.
     */
    describe('236 §3 · the gate under the lock', () => {
      it('🔴 stands down when something LIVE already holds this userData', async () => {
        // ⛔ The case Chromium cannot see: it told this process `true`, so nothing above would have
        // stopped it. The consequence is the finding — no database, no second `RuntimeHost`, no
        // startup repair settling somebody else's live sessions as orphans.
        const run = await launch(true, { claimGate: () => Promise.resolve('taken') })

        expect(run.verdict).toBe('already-running')
        expect(run.started).toBe(0)
        expect(run.stoodDown).toBe(1)
        expect(run.logged).toEqual([STOOD_DOWN_NOTICE])
      })

      it('🔴 …and an UNDECIDED gate runs the app — fail-open is the whole licence to add it', async () => {
        // ⛔ `191` M5 is the report of a second gate that bricked provisioning until a file was
        // hand-deleted. This one may only ever subtract from what Chromium already decided, so
        // every answer that is not "something live answered" has to land here.
        const run = await launch(true, { claimGate: () => Promise.resolve('unknown') })

        expect(run.verdict).toBe('sole')
        expect(run.started).toBe(1)
        expect(run.stoodDown).toBe(0)
      })

      it('⛔ …and a gate that THROWS runs the app, rather than taking the launch down with it', async () => {
        // ⚠️ The seam's own fail-open, not the gate's. A backstop that can stop the launch by
        // failing is the brick `191` M5 was, wearing an exception.
        const run = await launch(true, { claimGate: () => Promise.reject(new Error('no socket')) })

        expect(run.verdict).toBe('sole')
        expect(run.started).toBe(1)
      })

      it('⛔ the launch the GATE stood down registers no second-instance handler either', async () => {
        // The same rule the lock's losing launch has always had: an app that answered
        // `second-instance` for a `userData` it does not hold is a process about to exit
        // pretending to be the one that owns the directory.
        const run = await launch(true, { claimGate: () => Promise.resolve('taken') })

        expect(run.secondLaunch).toBeNull()
      })

      it('⛔ …and the launch that RUNS still registers one', async () => {
        // The paired positive: moving the registration after the gate must not lose it.
        expect((await launch(true)).secondLaunch).not.toBeNull()
      })

      it('⛔ is asked AFTER the lock, and not at all by the launch that already lost', async () => {
        // Two answers to one question is what 198 was about. The ordinary second launch is
        // Chromium's to refuse, and a gate consulted first would be a second opinion on it.
        let asked = 0
        const run = await launch(false, {
          claimGate: () => {
            asked += 1
            return Promise.resolve('sole')
          },
        })

        expect(run.verdict).toBe('already-running')
        expect(asked).toBe(0)
      })
    })

    /**
     * ⛔ **The gate itself, against real sockets** — the tests above drive the policy, and a policy
     * with a perfect verdict over a mechanism that never refuses anything is `216` M11's shape.
     */
    describe('236 §3 · the mechanism', () => {
      let dir = ''

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'brobot2-gate-'))
      })

      afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
      })

      it('🔴 the SECOND claim on one userData loses — which is the race Chromium loses', async () => {
        expect(await claimSoleHost(dir, 'darwin')).toBe('sole')
        expect(await claimSoleHost(dir, 'darwin')).toBe('taken')
      })

      it('⛔ …and a DIFFERENT userData is untouched, or every live smoke would break', async () => {
        // 198 §1's rule: every smoke launches its own app with its own `--user-data-dir`, and a
        // gate that was global rather than per-directory would refuse all of them.
        const other = mkdtempSync(join(tmpdir(), 'brobot2-gate-'))
        try {
          expect(await claimSoleHost(dir, 'darwin')).toBe('sole')
          expect(await claimSoleHost(other, 'darwin')).toBe('sole')
        } finally {
          rmSync(other, { recursive: true, force: true })
        }
      })

      it('🔴 a path left behind by a dead process is BROKEN, not honoured', async () => {
        // ⛔ This is the branch that answers `191` M5, and it is not a corner: a clean quit leaves
        // the path behind, so every launch after the first one takes it. A gate that honoured the
        // artefact would refuse to start the app and there would be no way out but `rm`.
        writeFileSync(hostGatePath(dir, 'darwin'), 'not a socket')

        expect(await claimSoleHost(dir, 'darwin')).toBe('sole')
      })

      it('⛔ the path is inside the userData, and a Windows pipe is not a path at all', () => {
        expect(hostGatePath(dir, 'darwin')).toBe(join(realpathSync.native(dir), 'one-host.sock'))
        expect(hostGatePath(dir, 'win32')).toMatch(/^\\\\\.\\pipe\\brobot2-one-host-[0-9a-f]{16}$/)
        // Two directories are two gates — the name carries the directory, not just its basename.
        expect(hostGatePath('/one/x', 'win32')).not.toBe(hostGatePath('/two/x', 'win32'))
      })

      /**
       * A `userData` too long for a socket inside it keeps its gate in a folder of this user's home,
       * under a name derived from the folder's path on the disk. Without that the gate could not
       * bind there at all, every claim answered `unknown`, and a start that must be the only app on
       * its folder (a recovery copy, a migration) was refused on every launch.
       *
       * The smoke-shaped length is computed, never created: a test must never write inside an
       * instrument's evidence root. The claims below use a gates folder the test owns, so a test
       * never writes in the home's.
       */
      it('🔴 a smoke-shaped userData is too long for a socket inside it, so its gate is outside', (ctx) => {
        // The premise is the Mac's long `tmpdir()` against a 104-byte socket path.
        ctx.skip(process.platform !== 'darwin')
        const smokeShaped = join(
          tmpdir(),
          'brobot2-ui-smoke',
          '2026-01-01T00-00-00-000Z-12345',
          'user-data',
        )
        expect(
          Buffer.byteLength(join(smokeShaped, 'one-host.sock')),
          'this machine’s tmpdir is short enough that a smoke-shaped folder fits — re-derive this',
        ).toBeGreaterThan(104)
        const outside = hostGatePath(smokeShaped, 'darwin')
        expect(dirname(outside)).toBe(
          join(userInfo().homedir, 'Library', 'Caches', 'brobot2-gates'),
        )
        expect(basename(outside)).toMatch(/^[0-9a-f]{16}\.sock$/)
        expect(gateFits(smokeShaped, 'darwin')).toBe(true)
        // Elsewhere, the home's cache folder.
        expect(dirname(hostGatePath(join('/', 'u'.repeat(120)), 'linux'))).toBe(
          join(userInfo().homedir, '.cache', 'brobot2-gates'),
        )
      })

      it('🔴 …and that gate is live: the first claim is sole, the second is taken', async (ctx) => {
        ctx.skip(process.platform === 'win32')
        const long = aLongFolderIn(dir)
        const seams = { folder: join(dir, 'g') }
        const outside = hostGatePath(long, process.platform, seams)
        try {
          expect(Buffer.byteLength(join(long, 'one-host.sock'))).toBeGreaterThan(108)
          expect(dirname(outside)).toBe(seams.folder)
          expect(await claimSoleHost(long, process.platform, seams)).toBe('sole')
          expect(await claimSoleHost(long, process.platform, seams)).toBe('taken')
          expect(await whoIsOn(long, process.platform, seams)).toBe('open')
          // The folder is this user's alone, the public name is a socket, nothing is written inside
          // the data folder, and the private names are gone from beside the public one.
          const folder = lstatSync(dirname(outside))
          expect(folder.isDirectory()).toBe(true)
          expect(folder.uid).toBe(UID)
          expect(folder.mode & 0o077).toBe(0)
          expect(lstatSync(outside).isSocket()).toBe(true)
          expect(readdirSync(long)).toEqual([])
          const prefix = basename(outside, '.sock')
          expect(readdirSync(dirname(outside)).filter((n) => n.startsWith(`${prefix}-`))).toEqual(
            [],
          )
        } finally {
          rmSync(outside, { force: true })
        }
      })

      it('⛔ …and two long folders are two gates, and a socket a dead process left there is broken', async (ctx) => {
        ctx.skip(process.platform === 'win32')
        const one = aLongFolderIn(join(dir, 'one'))
        const two = aLongFolderIn(join(dir, 'two'))
        const seams = { folder: join(dir, 'g') }
        const gates = [
          hostGatePath(one, process.platform, seams),
          hostGatePath(two, process.platform, seams),
        ]
        try {
          expect(gates[0]).not.toBe(gates[1])
          // The folder a claim makes, made here first so a dead socket can be left in it.
          mkdirSync(seams.folder, { recursive: true, mode: 0o700 })
          await aDeadSocketAt(gates[0] ?? '')
          expect(await whoIsOn(one, process.platform, seams)).toBe('closed')
          expect(await claimSoleHost(one, process.platform, seams)).toBe('sole')
          expect(await claimSoleHost(two, process.platform, seams)).toBe('sole')
        } finally {
          for (const gate of gates) rmSync(gate ?? '', { force: true })
        }
      })

      it('⛔ …and a SHORT userData keeps its gate inside, where it binds', async () => {
        expect(hostGatePath(dir, 'darwin').length).toBeLessThanOrEqual(104)
        expect(hostGatePath(dir, 'darwin')).toBe(join(realpathSync.native(dir), 'one-host.sock'))
        expect(await claimSoleHost(dir, 'darwin')).toBe('sole')
        expect(await claimSoleHost(dir, 'darwin')).toBe('taken')
      })
    })

    /**
     * A long folder's gate lives outside it. Its folder and names are checked before they are
     * trusted, so nothing that is not this user's own makes a launch `sole` or `taken`: the answer
     * is `unknown`, and nothing there is removed. These move the folder somewhere the test owns, so
     * the real one is never touched.
     */
    describe.skipIf(process.platform === 'win32')('a gate outside its data folder', () => {
      let dir = ''
      let gates = ''
      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'brobot2-gate-'))
        gates = mkdtempSync(join(tmpdir(), 'g-'))
      })
      afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
        rmSync(gates, { recursive: true, force: true })
      })

      it('🔴 is in one place whatever TMPDIR or HOME says, so two launches cannot find two gates', () => {
        const long = aLongFolderIn(dir)
        const before = hostGatePath(long)
        const said = { TMPDIR: process.env['TMPDIR'], HOME: process.env['HOME'] }
        process.env['TMPDIR'] = join(dir, 'elsewhere')
        process.env['HOME'] = join(dir, 'another-home')
        try {
          expect(hostGatePath(long)).toBe(before)
        } finally {
          for (const [name, value] of Object.entries(said)) {
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
          }
        }
      })

      it('🔴 two spellings of one folder find one gate: a link to a long folder, and a long link', async () => {
        const long = aLongFolderIn(dir)
        const alias = join(dir, 'a')
        symlinkSync(long, alias)
        expect(hostGatePath(alias, process.platform, { folder: gates })).toBe(
          hostGatePath(long, process.platform, { folder: gates }),
        )
        expect(await claimSoleHost(long, process.platform, { folder: gates })).toBe('sole')
        expect(await claimSoleHost(alias, process.platform, { folder: gates })).toBe('taken')
        expect(await whoIsOn(alias, process.platform, { folder: gates })).toBe('open')
        // A short folder reached through a long link keeps its gate inside, under either name.
        const short = join(dir, 's')
        mkdirSync(short)
        const longLink = join(dir, 'l'.repeat(120))
        symlinkSync(short, longLink)
        expect(hostGatePath(longLink)).toBe(join(realpathSync.native(short), 'one-host.sock'))
        expect(await claimSoleHost(longLink)).toBe('sole')
        expect(await claimSoleHost(short)).toBe('taken')
      })

      it('🔴 a file, a folder or a link planted at the public name is not asked, broken or believed', async () => {
        const long = aLongFolderIn(dir)
        const seams = { folder: gates }
        const name = hostGatePath(long, process.platform, seams)
        writeFileSync(name, 'planted')
        expect(await claimSoleHost(long, process.platform, seams)).toBe('unknown')
        expect(await whoIsOn(long, process.platform, seams)).toBe('unknown')
        expect(readFileSync(name, 'utf8')).toBe('planted')
        rmSync(name)
        mkdirSync(name)
        expect(await claimSoleHost(long, process.platform, seams)).toBe('unknown')
        rmSync(name, { recursive: true })
        // A link to a live socket would otherwise answer with that app's token.
        const other = aLongFolderIn(join(dir, 'other'))
        expect(await claimSoleHost(other, process.platform, seams)).toBe('sole')
        symlinkSync(hostGatePath(other, process.platform, seams), name)
        expect(await claimSoleHost(long, process.platform, seams)).toBe('unknown')
        expect(await whoIsOn(long, process.platform, seams)).toBe('unknown')
        expect(lstatSync(name).isSymbolicLink()).toBe(true)
        // The positive control: a socket of this user's that nothing answers is broken.
        rmSync(name)
        await aDeadSocketAt(name)
        expect(await claimSoleHost(long, process.platform, seams)).toBe('sole')
      })

      it('🔴 …and a socket at the name that is another user’s answers unknown', async () => {
        const long = aLongFolderIn(dir)
        const name = hostGatePath(long, process.platform, { folder: gates })
        await aDeadSocketAt(name)
        const theirs = {
          folder: gates,
          lstat: (path: string) => asEntry(path, path === name ? UID + 1 : undefined),
        }
        expect(await claimSoleHost(long, process.platform, theirs)).toBe('unknown')
        expect(await whoIsOn(long, process.platform, theirs)).toBe('unknown')
        expect(lstatSync(name).isSocket()).toBe(true)
      })

      it('🔴 a folder with group or other permissions, another user’s, or a link answers unknown', async () => {
        const long = aLongFolderIn(dir)
        chmodSync(gates, 0o750)
        expect(await claimSoleHost(long, process.platform, { folder: gates })).toBe('unknown')
        expect(await whoIsOn(long, process.platform, { folder: gates })).toBe('unknown')
        chmodSync(gates, 0o707)
        expect(await claimSoleHost(long, process.platform, { folder: gates })).toBe('unknown')
        expect(readdirSync(gates)).toEqual([])
        chmodSync(gates, 0o700)
        const anothers = {
          folder: gates,
          lstat: (path: string) => asEntry(path, path === gates ? UID + 1 : undefined),
        }
        expect(await claimSoleHost(long, process.platform, anothers)).toBe('unknown')
        expect(await whoIsOn(long, process.platform, anothers)).toBe('unknown')
        const linked = join(dir, 'linked-gates')
        symlinkSync(gates, linked)
        expect(await claimSoleHost(long, process.platform, { folder: linked })).toBe('unknown')
        expect(readdirSync(gates)).toEqual([])
        // The positive control: the same folder, this user's alone.
        expect(await claimSoleHost(long, process.platform, { folder: gates })).toBe('sole')
      })

      it('⛔ a folder not made yet is made private; asking it before then answers closed', async () => {
        const long = aLongFolderIn(dir)
        const fresh = join(gates, 'fresh')
        expect(await whoIsOn(long, process.platform, { folder: fresh })).toBe('closed')
        expect(readdirSync(gates)).toEqual([])
        expect(await claimSoleHost(long, process.platform, { folder: fresh })).toBe('sole')
        expect(lstatSync(fresh).mode & 0o777).toBe(0o700)
        expect(await whoIsOn(long, process.platform, { folder: fresh })).toBe('open')
      })

      it('🔴 the private name, the longer one outside, is the one held to the socket limit', async () => {
        // Outside, the public name is `<16 hex>.sock` and the private one `<16 hex>-<8 hex>`: four
        // bytes longer. A folder of 80 bytes fits the first in macOS's 103, not the second.
        const long = join('/', 'u'.repeat(120))
        const tight = { folder: join('/', 'f'.repeat(79)) }
        expect(Buffer.byteLength(hostGatePath(long, 'darwin', tight))).toBeLessThanOrEqual(103)
        expect(gateFits(long, 'darwin', tight)).toBe(false)
        expect(await claimSoleHost(long, 'darwin', tight)).toBe('unknown')
        expect(await whoIsOn(long, 'darwin', tight)).toBe('unknown')
        expect(gateFits(long, 'darwin', { folder: join('/', 'f'.repeat(76)) })).toBe(true)
        // Inside, the public name is the longer, and fits up to the limit exactly.
        const atTheLimit = join('/', 'w'.repeat(103 - '/one-host.sock'.length - 1))
        expect(Buffer.byteLength(join(atTheLimit, 'one-host.sock'))).toBe(103)
        expect(gateFits(atTheLimit, 'darwin')).toBe(true)
        expect(hostGatePath(atTheLimit, 'darwin')).toBe(join(atTheLimit, 'one-host.sock'))
        expect(gateFits(long, 'win32')).toBe(true)
      })
    })

    /**
     * 🔴 **What must happen before Chromium is ready, and why `start` is no longer where it goes**
     * (241 §2).
     *
     * ⛔ **At `0602acb` this app opened no window at all**, on any machine, with `pnpm run ci` at
     * EXIT 0 over 4,873 tests and a full live smoke at 96/98. `236` §3 put an `await` in front of
     * `deps.start()`; `index.ts` opened `start` with `protocol.registerSchemesAsPrivileged`, which
     * Electron requires before `ready` and which THROWS after it — so `start` died at its first
     * statement and the database, the host and the window never happened.
     *
     * ⚠️ **The composition-root test above encodes the rule this was hiding behind** — *"everything
     * a second process must not do has to live inside `start`"* — and it is still right. This block
     * is its counterweight: **what must happen before `ready` cannot live in `start`**, because
     * `start` is reached through an `await` and `await` is the other side of `ready`.
     */
    describe('241 · what must happen before ready', () => {
      const root = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
      const REGISTER = [
        'protocol.registerSchemesAsPrivileged([',
        '  ASSET_SCHEME_PRIVILEGES,',
        '  THEME_SCHEME_PRIVILEGES,',
        '  PLUGIN_SCHEME,',
        '])',
      ].join('\n')

      it('declares both asset schemes and the isolated plugin scheme at module scope before ready', () => {
        const at = root.indexOf(`\n${REGISTER}`)
        // ⚑ **Column 0 is the assertion.** Anywhere indented is inside something, and inside
        // something is inside a call somebody can put an `await` in front of — which is exactly
        // what happened.
        expect(at, `${REGISTER} is not at module scope in index.ts`).toBeGreaterThan(-1)
        expect(at).toBeLessThan(root.indexOf('function start(ownership: HostGateVerdict): void {'))
        expect(at).toBeLessThan(root.indexOf('runAsSoleInstance({'))
      })

      it('the scheme guard rejects a missing scheme, a late call and a duplicate call', () => {
        const beforeReady = (source: string): boolean => {
          const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          const at = code.indexOf(`\n${REGISTER}`)
          return (
            at >= 0 &&
            at < code.indexOf('function start(ownership: HostGateVerdict): void {') &&
            at < code.indexOf('.whenReady()') &&
            at < code.indexOf('runAsSoleInstance({') &&
            (code.match(/registerSchemesAsPrivileged\(/g) ?? []).length === 1
          )
        }
        expect(beforeReady(root)).toBe(true)
        expect(
          beforeReady(
            root.replace(
              REGISTER,
              'protocol.registerSchemesAsPrivileged([ASSET_SCHEME_PRIVILEGES])',
            ),
          ),
        ).toBe(false)
        expect(beforeReady(root.replace(`\n${REGISTER}`, `\n  ${REGISTER}`))).toBe(false)
        expect(beforeReady(`${root}\n${REGISTER}`)).toBe(false)
        expect(beforeReady(`${root.replace(REGISTER, '')}\n${REGISTER}`)).toBe(false)
        expect(beforeReady(root.replace(REGISTER, ''))).toBe(false)
      })

      it('⛔ …and NOT inside start(), which is where it was when the app stopped opening', () => {
        const body = root.slice(
          root.indexOf('function start(ownership: HostGateVerdict): void {'),
          root.indexOf('runAsSoleInstance({'),
        )
        expect(body).not.toContain(REGISTER)
        // ⚠️ The positive control for both halves: comments stripped, the call is made exactly
        // once. Without this, deleting the line entirely passes every assertion above — and the
        // symptom of never registering is an `<img>` that silently never loads.
        const code = root.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        expect(code.match(/registerSchemesAsPrivileged\(/g) ?? []).toHaveLength(1)
      })

      it('🔴 start() is reached through an await — which is what makes pre-ready work illegal in it', async () => {
        // ⛔ **The mechanism, as a fact rather than a comment.** Not "the gate is slow": the gate is
        // resolved on this thread, and Chromium owns this thread until it emits `ready`. Measured
        // on Electron 43: `listen` completes at 4-8 ms, the verification connect at 53-69 ms, and
        // `ready` fires at 47-63 ms. Anything awaited lands on the far side of it.
        const order: string[] = []
        const deps: SoleInstanceDeps = {
          requestLock: () => true,
          claimGate: () => Promise.resolve('sole' as const),
          onSecondLaunch: () => {},
          focusExisting: () => {},
          announce: () => {},
          standDown: () => {},
          start: () => order.push('start'),
          log: () => {},
        }
        const running = runAsSoleInstance(deps)
        // Even with a gate that is ALREADY resolved, `start` has not run when the call returns.
        expect(order, 'start ran synchronously — 241 §2 no longer describes this code').toEqual([])
        await running
        expect(order).toEqual(['start'])
      })

      /**
       * ⛔ **The instrument, and the rule that a policy nothing calls is not a policy.**
       *
       * ⚑ `orphan-runs.test.ts` states it about its own repair and `single-instance.ts` about
       * `start`: *"a correct policy that nothing calls leaves the defect exactly where it was, and
       * every assertion about the policy still passes."* ⚠️ A window check that is not in `ci` is
       * that sentence about the only instrument which can see this class of defect.
       */
      it('⛔ the window instrument exists, is in the ci chain, and agrees with the gate', () => {
        const check = readFileSync(join(here, '../../../scripts/window-opens-check.mjs'), 'utf8')
        const pkg: { scripts: Record<string, string> } = JSON.parse(
          readFileSync(join(here, '../../../package.json'), 'utf8'),
        ) as { scripts: Record<string, string> }

        expect(pkg.scripts['window:check']).toBe('node scripts/window-opens-check.mjs')
        const ci = pkg.scripts.ci ?? ''
        expect(ci, 'window:check is not in the gate — nothing runs it').toContain(
          'pnpm run window:check',
        )
        // ⚠️ **After `build`**, because it launches what `build` produces. Before it, it would check
        // whatever the previous run left on disk — a green about a stale bundle.
        expect(ci.indexOf('pnpm run window:check')).toBeGreaterThan(ci.indexOf('pnpm run build'))

        // ⛔ **The two constants that would let it drift back into the masked configuration.** If
        // the socket were renamed, the check's second assertion would look for a file that is never
        // written and the launch would report a broken gate; if the limit were raised, the check
        // could run on a path where the gate fails open — which is the blindness itself.
        expect(check).toContain(`const GATE_SOCKET = 'one-host.sock'`)
        expect(hostGatePath('/x', 'darwin')).toBe(join('/x', 'one-host.sock'))
        // ⚠️ **A regex with an end-of-line, and `toContain('… = 104')` was VACUOUS** (found by this
        // dispatch's own mutation run, `M5`, which survived): `104` is a prefix of `1040`, so the
        // assertion passed against a limit raised tenfold — the precise weakening it exists to stop.
        expect(check).toMatch(/const SUN_PATH_MAX = 104\n/)
      })

      /**
       * ⛔ **What the instrument DEMANDS, pinned in its source — because a weakened check still
       * passes.**
       *
       * ⚠️ `window:check` runs in `ci`, so unlike `ui-live-smoke.mjs` this file is executed by the
       * gate. That covers it going RED when the product breaks. ⛔ **It does not cover the check
       * asking for less**: every assertion below could be deleted and the run would stay green,
       * which is the same shape as a smoke step that asserts nothing (`193`). The four things here
       * are the ones whose removal would make the green mean less than it says.
       */
      it('⛔ …and cannot quietly ask for less than it says it does', () => {
        const check = readFileSync(join(here, '../../../scripts/window-opens-check.mjs'), 'utf8')

        // ⚑ A page target exists the moment `new BrowserWindow()` runs. Without this the check goes
        // green on an empty window — measured at 0.8 s, reporting `(untitled)`.
        expect(check).toContain(`target.url !== 'about:blank'`)
        // ⛔ The gate assertion, which is what keeps this in a PERSON's configuration rather than
        // the smokes' masked one.
        expect(check).toContain('const gateRan = existsSync(socketPath)')
        expect(check).toContain('if (!gateRan)')
        // 🔴 **And that it reaps what it launched.** `node_modules/.bin/electron` is a shim, so the
        // direct child is not the app, and an Electron whose parent dies is reparented to init and
        // out of every group anyone can signal — at which point `kill(-pid, 0)` answers ESRCH, which
        // reads exactly like "it is gone". ⛔ **The first version of this check did that and left a
        // full Electron running for six hours**, and the corpse turned two rows of 241's own
        // mutation table into `INVALID`/`RED`.
        expect(check).toContain('detached: true')

        // ⚠️ **241 answered that by chasing the PORT, and 326 §2 replaced it — the premise of the
        // two pins that used to be here is overturned rather than relaxed.** 325 measured both
        // halves of why: the port is one socket of one of five processes, so at the instant it reads
        // empty four Electron processes are still in the table; and the wait FAILED OPEN, because
        // `lsof -t` exits non-zero when it matches nothing, so *"nothing holds it"* and *"I could not
        // ask"* were one value — every "the port is free" this file printed came out of a `catch`.
        //
        // ⚑ **The reap is by IDENTITY now** (`owned-process.mjs`, 287/294): what was seen while the
        // launch was alive, re-read beside every signal, `complete` only when nothing is alive AND
        // nothing was unverifiable. ⛔ And the directory comes off only after that verdict, which is
        // the ordering `325` exists for. `scripts/test/owned-teardown.test.mjs` holds the positional
        // half; these are the four lines whose deletion would make this green mean less.
        expect(check).toContain('createOwnedProcessLifecycle({')
        expect(check).toContain('discoverDescendants: descendantsOf')
        expect(check).toContain('tearDownAndRemove({ lifecycle, directory: userDataDir })')
        expect(check).toContain('if (!outcome.complete)')
        // ⛔ …and the fail-open may not come back under any name.
        expect(check).not.toContain('holdersOf')
      })

      /**
       * 🔴 **The sibling that did not exist until 271, and its absence is `270`'s whole finding.**
       *
       * `window:check` proves an app OPENS. Nothing proved one closes — and worse, the file above
       * reaps its app with SIGKILL, in as many words: *"its orderly teardown takes up to 20 s"*.
       * Every live smoke does the same. ⛔ So the one gesture no instrument in this repository had
       * ever performed was letting BroBot quit, which is exactly the gesture `270` refused to adopt
       * the app over: ⌘Q blanked the window and left the process and `:9444` alive for 60.489 s.
       *
       * ⚠️ **Same rule as above and for the same reason**: an instrument outside `ci` is a policy
       * nothing calls.
       */
      it('⛔ the CLOSING instrument exists, is in the ci chain, and cannot ask for less', () => {
        const check = readFileSync(join(here, '../../../scripts/app-closes-check.mjs'), 'utf8')
        const pkg: { scripts: Record<string, string> } = JSON.parse(
          readFileSync(join(here, '../../../package.json'), 'utf8'),
        ) as { scripts: Record<string, string> }

        expect(pkg.scripts['quit:check']).toBe('node scripts/app-closes-check.mjs')
        const ci = pkg.scripts.ci ?? ''
        expect(ci, 'quit:check is not in the gate — nothing runs it').toContain(
          'pnpm run quit:check',
        )
        // After `build`, for the same reason its sibling is: it launches what `build` produced.
        expect(ci.indexOf('pnpm run quit:check')).toBeGreaterThan(ci.indexOf('pnpm run build'))
        // ⚑ …and `window:check` is still there, which 241 M10 exists to keep true. The two are one
        // pair — an app that opens and does not close is not a green.
        expect(ci).toContain('pnpm run window:check')

        // ⛔ **The numbers, with an end-of-line, because `toContain('… = 104')` was VACUOUS** — 241's
        // own mutation run proved `104` is a prefix of `1040` and the pin held against a limit
        // raised tenfold. Both budgets here are measured (see the file); both would hide the defect
        // if raised.
        expect(check).toMatch(/const QUIT_BUDGET_MS = 5_000\n/)
        // ⚑ **4,000 since 294, and it is a DERIVED number rather than a widened one.** The window
        // goes at ~350 ms and the process is now stopped at the app's own 2,000 ms promise plus the
        // cost of the process that enforces it, so a lag of ~1,850 ms is what the fix WORKING looks
        // like. At 2,500 the gate had 650 ms of margin and the PM measured a run at 2,502 ms — it
        // was firing on the mechanism. It still catches the bound not being enforced, which lags by
        // tens of seconds. See `WINDOW_LAG_MS` in the check for the arithmetic.
        expect(check).toMatch(/const WINDOW_LAG_MS = 4_000\n/)

        // ⛔ **What makes the green mean something.** Each of these could be deleted and the check
        // would still pass on a healthy app while going blind to the thing it is for.
        //
        // The wall clock — `270`'s finding as a number.
        expect(check).toContain('THE APP DID NOT CLOSE')
        // The port, asked of the kernel: *"the old instance still owns the port"*.
        expect(check).toContain('still holds port')
        // The lock — and that the question is who ANSWERS, not whether the path is there.
        expect(check).toContain('gateAnswers(socketPath)')
        // The black window: gone long before the process was.
        expect(check).toContain('the window disappeared')
        // ⚑ **The instrument's own instrument.** On the tree before 271 there was no shutdown
        // report at all, which is why 60.489 s still cannot be attributed to a step.
        expect(check).toContain('BroCrew shut down in')
        expect(check).toContain("reached Electron's will-quit")
        // 🔴 **294 turned this one around, and the reversal is the finding.** It used to require
        // that an idle quit did NOT reach 271's escape hatch. That hatch never fired in its life —
        // no timer in this process runs once Electron begins its quit — and the thing it was
        // guessing about is not ours: bare Electron 43.2.0 hangs in 5 of 6 loaded quits. Failing a
        // run because the bound did its job would put the flakiness back, on the fix. So the check
        // must NAME it and pass, and what still stops an app force-exiting every time is the
        // graceful-door pair above, which is stamped at ~106 ms, long before any stop.
        //
        // 🔴 **514 gave that report its own verdict, and moved the sentence where a test can plant
        // it.** ⛔ `294`'s tolerance is unreversed — the firing is reported, the run is green, the
        // exit code has not moved — but both outcomes carried the same `✔` and the one fact that
        // told them apart was the LAST thing on the line. ⚑ The cells, the sentence the detector
        // matches, and the head of the line now live in `scripts/lib/quit-verdict.mjs`, because the
        // stopped arm is only ever executed by a machine under load and `ci` cannot summon one.
        const verdicts = readFileSync(join(here, '../../../scripts/lib/quit-verdict.mjs'), 'utf8')
        expect(verdicts).toContain("export const LAST_RESORT_SAID = 'is being stopped now'")
        expect(verdicts).toContain('the last resort stopped it')
        expect(check).toContain("import { quitHeadline } from './lib/quit-verdict.mjs'")
        expect(check).toContain('quitHeadline({')
        expect(check).not.toContain("an IDLE quit had to use 271's last-resort exit")
        // ⚠️ **And the sentence the gate matches must be the sentence the app actually prints** —
        // the same rule, and the same reason, as the `ipc.ts` refusal at the foot of this test: the
        // two files cannot import each other, so this is what keeps them in step.
        const closer = readFileSync(join(here, '../src/main/last-resort-exit.ts'), 'utf8')
        expect(closer).toContain('so it is being stopped now')
        // ⚑ …and the gate's own docblock names both cells, because a reader of this file is one of
        // the readers the change is for.
        expect(check).toContain('`quit:check ✔ closed …`')
        expect(check).toContain('`quit:check ⚠️ STOPPED …`')
        // The reap, with the same pins its sibling carries — by identity since 326, for the two
        // reasons written out beside them there.
        expect(check).toContain('detached: true')
        expect(check).toContain('createOwnedProcessLifecycle({')
        expect(check).toContain('tearDownAndRemove({ lifecycle, directory: userDataDir })')
        expect(check).not.toContain('holdersOf(port)')

        // 🔴 **326: the number this gate exists to report was ~100% instrument, and it went falsely
        // RED twice in one day.** The three observations were read in one pass in written order,
        // each stamped when its own answer came back, so *"has the app gone?"* — which costs nothing
        // — could not be sampled until a CDP probe and an `lsof` had both returned. One of those
        // `lsof` calls was measured at **21,295 ms**, on a run where the app had already exited
        // before it was issued, and the gate printed *"still running 21304ms later"*.
        //
        // ⛔ Four pins, and each one is a way the repair could be undone while the check still
        // passed on a healthy machine: the cheap fact is sampled first, it is stamped when it is
        // ASKED rather than when the answer arrives, the port budget is measured from the PROCESS
        // rather than from the gesture, and the port instrument is proved able to see this app at
        // all before anything depends on it (241's lesson, aimed at the new probe).
        const aliveAt = check.indexOf('if (processGoneAt === null && !alive(appPid))')
        const portAt = check.indexOf('const answer = await couldBindPort(port)')
        expect(aliveAt).toBeGreaterThan(0)
        expect(portAt).toBeGreaterThan(aliveAt)
        expect(check).toContain('processGoneAt = askingProcess')
        expect(check).toContain('portFreeAt = askingPort')
        expect(check).toContain('portFreeAt - processGoneAt > PORT_RELEASE_MS')
        expect(check).not.toContain('portFreeAt - askedAt')
        expect(check).toContain("if (heldWhileUp.state !== 'held')")
        // ⚑ …and the third answer is spent rather than swallowed: an `unknown` may not become
        // either outcome, so the run is red and the message names the instrument, not the app.
        expect(check).toContain('THIS CHECK COULD NOT FIND OUT')
        // ⚠️ **…and the failure message's own number is stamped before the diagnostic.**
        // `whatIsItDoing` runs `sample` for three seconds; read after it, `still running Nms later`
        // said 16,441 ms about a loop that gave up at 9,000 — measured by 326's own red/green pair.
        const stampedAt = check.indexOf('const stillThereAt = processGoneAt ?? Date.now()')
        expect(stampedAt).toBeGreaterThan(0)
        expect(check.indexOf('whatIsItDoing(appPid, userDataDir)')).toBeGreaterThan(stampedAt)

        // 🔴 **273: the check must still be ASKING while the app quits, and it must be refused.**
        //
        // ⛔ The two assertions are a pair and neither survives alone. Without the first, the check
        // goes back to quitting an app nobody is talking to and `272`'s defect is invisible again;
        // without the second, a probe that had gone quiet — a dead bridge, an early teardown —
        // would satisfy "nothing reached a closed database" by reaching nothing at all.
        expect(check).toContain('database connection is not open')
        expect(check).toContain(
          'BroCrew is shutting down, so ${kind} was not asked of its database',
        )
        // ⚠️ **And the ask must not be on a TIMER**, which is the correction that made this
        // reproduce at all: Chromium throttles timers in a window that is not in front, and the
        // window this looks into is ~100ms wide. The chain re-asks from its own settlement.
        expect(check).toContain('askAgain(name)')
        expect(check).not.toMatch(/setInterval\(\(\) => \{ ask/)
        // ⚑ **And the probe proves ITSELF before the quit** — that it is answered at all, and that
        // it is answered fast enough to fall inside a ~100ms window. Delete either and the check
        // still passes on a healthy app while going blind to exactly what it is for.
        expect(check).toContain('could not answer listResumable/listUnresumable')
        expect(check).toContain('answered only')
        // The refusal spelled in `.mjs` must be the sentence `ipc.ts` actually produces — the two
        // cannot import each other, so this is what keeps them in step.
        const ipc = readFileSync(join(here, '../src/main/runtime/ipc.ts'), 'utf8')
        expect(ipc).toContain(
          'return `BroCrew is shutting down, so ${kind} was not asked of its database`',
        )
      })
    })

    it('🔒 keeps NO state of its own, so a stale lock cannot brick the next launch', async () => {
      // ⛔ **The stale-lock case, at the only level a unit test can reach it.** Chromium breaks a
      // `SingletonLock` whose pid is gone and answers `true` — measured, see `single-instance.ts` —
      // and the whole of this module's part is to have nothing that could disagree. So a launch
      // that stood down leaves nothing behind: the very next one, told the lock is free, starts the
      // app in full.
      expect((await launch(false)).started).toBe(0)
      expect((await launch(false)).started).toBe(0)

      const successor = await launch(true)
      expect(successor.verdict).toBe('sole')
      expect(successor.started).toBe(1)
    })
  })

  /**
   * ⛔ **Not one line of this describe mentions the lock**, and that is criterion 4. The repair has
   * to be able to tell the two sentences apart on its own, because 194 H1's mechanism —
   * constructing a second `RuntimeHost` — needs no second process.
   */
  describe('work another live host is running', () => {
    let dir: string
    let db: AppDatabase
    let store: SessionStore
    const leaves: (() => void)[] = []

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-one-app-'))
      db = openDatabase(join(dir, 'db.sqlite'))
      applyMigrations(db, migrations)
      store = createSessionStore(db)
    })

    afterEach(() => {
      for (const leave of leaves.splice(0)) leave()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    const SINK = {
      ownerId: 'test',
      aPersonIsBehindIt: false,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }

    const buildHost = (over: Partial<RuntimeHostDeps> = {}): RuntimeHost =>
      new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(dir, 'exports'),
        createRuntime: (provider) => new FakeRuntime(provider),
        prepareProviderHome: (provider) => join(dir, 'homes', provider),
        providerHomePath: (provider) => join(dir, 'homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
        newSessionId: () => `sess_${Math.random().toString(16).slice(2)}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'x',
          authNote: null,
          files: [],
        }),
        ...over,
      })

    /**
     * Another host, standing in the process-wide directory and holding `ids`.
     *
     * ⚠️ **A stand-in and not a second `RuntimeHost`, deliberately.** What the repair consumes is
     * the directory's answer; what a real host CONTRIBUTES to that answer is asserted separately
     * against a real one, two tests below. Splitting them is what stops either half passing on the
     * other's behalf — a single test driving two real hosts would go green if `workInFlight` were
     * honest and the repair ignored it, or the other way round.
     */
    const anotherHostRunning = (...ids: string[]): void => {
      // ⚠️ **Over THIS store**, which is the whole of what makes its ids mean anything here: a host
      // over another database running `sess_1` is running a different conversation, and excluding
      // ours because of it would be 074's defect reintroduced by its own guard.
      leaves.push(joinLiveHosts({ ledger: store, workInFlight: () => ids }))
    }

    /** The same stand-in, over somebody else's database — the control for the line above. */
    const anotherLedgerRunning = (...ids: string[]): void => {
      leaves.push(joinLiveHosts({ ledger: { notThisStore: true }, workInFlight: () => ids }))
    }

    /** A session a dead process left mid-turn — `orphan-runs.test.ts`'s fixture, in one place. */
    const crashedMidTurn = (id: string): void => {
      store.create({
        id,
        provider: 'claude',
        cwd: '/work',
        approvalMode: 'ask',
        profileId: 'default',
      })
      store.append(
        id,
        0,
        {
          type: 'session',
          state: 'started',
          ref: { provider: 'claude', sessionId: `p_${id}`, cwd: '/work', rotation: 0 },
        },
        1_700_000_000_000,
      )
      store.append(id, 1, { type: 'user_turn', text: 'run the tests' }, 1_700_000_000_001)
      store.append(id, 2, { type: 'status', state: 'working' }, 1_700_000_000_002)
    }

    const statusOf = (id: string): string | undefined =>
      store.resumable().find((row) => row.sessionId === id)?.status

    const adopted = (id: string): void => {
      store.adopt({
        id,
        provider: 'claude',
        sessionId: `p_${id}`,
        cwd: '/work',
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
    }

    it('⛔ is left exactly as it is when a second host is constructed', () => {
      crashedMidTurn('sess_live')
      anotherHostRunning('sess_live')

      buildHost()

      // 194 H1, failure 1: B closes A's open turn as `unknown` and writes `idle` over a session
      // whose provider is mid-answer. A's real turn terminal can never replace that `unknown`,
      // because `appendTx` closes only the turn that is currently open.
      expect(statusOf('sess_live')).toBe('working')
      expect(store.turns('sess_live')[0]?.endReason).toBeNull()
    })

    it('⛔ …and the paired positive: the SAME construction settles one nobody is running', () => {
      // Without this beside it, the test above is satisfied by a repair that does nothing at all.
      crashedMidTurn('sess_stranded')

      buildHost()

      expect(statusOf('sess_stranded')).toBe('idle')
      expect(store.turns('sess_stranded')[0]?.endReason).toBe('unknown')
    })

    it('⛔ …and a host over ANOTHER database holds nothing here, whatever it calls its sessions', () => {
      // A session id is meaningless without the database it lives in. A guard that forgot this
      // would leave a genuinely stranded row claiming to be busy forever because something
      // unrelated happened to use the same string — 074's defect, reintroduced by its own fix.
      crashedMidTurn('sess_stranded')
      anotherLedgerRunning('sess_stranded')

      buildHost()

      expect(statusOf('sess_stranded')).toBe('idle')
    })

    it('reports what it SETTLED, not what it looked at', () => {
      crashedMidTurn('sess_live')
      crashedMidTurn('sess_stranded')
      anotherHostRunning('sess_live')

      // The number the launch log puts in front of the user. Counting the rows scanned would have
      // it announce repairs to conversations it deliberately left alone.
      expect(store.settleOrphanRuns(1_700_000_100_000, new Set(['sess_live']))).toBe(1)
      expect(statusOf('sess_live')).toBe('working')
      expect(statusOf('sess_stranded')).toBe('idle')
    })

    it("⛔ leaves another host's rebuild marker alone, and clears the one nobody holds", () => {
      // 194 H1, failure 2: B clears A's `building = G`, A goes on writing rows into a generation
      // nothing will promote, `promoteGeneration` then updates zero rows — and the derive still
      // returns success, so the caller is told the import worked.
      adopted('sess_building')
      adopted('sess_abandoned')
      expect(store.beginGeneration('sess_building')).toBeGreaterThan(0)
      expect(store.beginGeneration('sess_abandoned')).toBeGreaterThan(0)
      anotherHostRunning('sess_building')

      buildHost()

      expect(store.ledgerStatus('sess_building').derived).toBe('rebuilding')
      expect(store.ledgerStatus('sess_abandoned').derived).not.toBe('rebuilding')
    })

    it('a live host says a session in a slot is work in flight', async () => {
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)

      expect([...host.workInFlight()]).toContain(created.sessionId)

      await host.close(created.sessionId, SINK)
      expect([...host.workInFlight()]).not.toContain(created.sessionId)
    })

    it('⛔ …and one that is only RESERVED, whose provider has not arrived', async () => {
      // 062's rule: ownership begins when the id is taken, before the provider answers. That window
      // is exactly where a second host's repair would land — the row is `working`, nothing is
      // registered, and `sessionIds` (which filters to sessions with a handle to drive) would report
      // silence. `workInFlight` reads the slot MAP for this reason.
      const host = buildHost({
        createRuntime: () => new NeverArrives(),
        newSessionId: () => 'sess_reserved',
        // ⚠️ **Short deadlines, because the WAIT is not what is under test.** A launch that never
        // arrives is given up on at `launchTimeoutMs` (102), and the default fifteen seconds is
        // fifteen seconds of `pnpm run ci` spent asserting nothing. The reservation is taken
        // synchronously inside `createSession`, so the assertion below is already true before this
        // clock has ticked at all.
        launchTimeoutMs: 500,
        closeDrainTimeoutMs: 25,
      })
      const opening = host.createSession({ provider: 'claude', cwd: dir }, SINK)
      void opening.catch(() => {})

      await waitFor(() => [...host.workInFlight()].includes('sess_reserved'), 'the reservation')

      // Handed back, so the pending launch ends rather than running out this file's clock.
      await host.closeAll()
      await opening.catch(() => {})
      // 🔴 **This line used to assert silence, and the silence was the defect** (265 §3, from 259
      // lens B finding 3). The reservation really is gone — `awaitLaunch` abandons it when the bound
      // expires — but the LAUNCH is deliberately retained, because a handshake that never answered
      // never confirmed its child died. `closeAll` says so out loud in the same breath: *"1 provider
      // launch(es) had not confirmed termination … a provider process may still be running"*. So the
      // honest answer to *"what is this host holding"* is this id, and the old `[]` is exactly what
      // a second host could not see before it started a provider onto the same transcript.
      //
      // ⚑ **The pairing is a separate test** — *"a host that has closed everything stops holding its
      // work"* — where the provider DOES confirm and this method goes empty. Without it, the
      // assertion below would be satisfied by a host that never let anything go.
      expect([...host.workInFlight()]).toEqual(['sess_reserved'])
    })

    it('⛔ …and a REBUILD, which no slot ever names', async () => {
      // `rebuildLedger` refuses a session that is in `slots` as `in-use`, so every in-flight rebuild
      // is by construction a session no slot names. A slots-only answer would report silence here.
      adopted('sess_rebuilding')
      const path = join(dir, 'fictional-rebuild.jsonl')
      writeFileSync(path, '{"type":"user","message":{"role":"user","content":"fictional"}}\n')
      const host = buildHost({ nativeTranscriptPath: () => path })

      const pending = host.rebuildLedger('sess_rebuilding')
      // Synchronous on purpose: the count is taken before the first suspension, which is the window
      // a host constructed beside this one would land in.
      expect([...host.workInFlight()]).toContain('sess_rebuilding')

      await pending
      expect([...host.workInFlight()]).not.toContain('sess_rebuilding')
    })

    it('is not asked about itself', async () => {
      // A host that counted its own work would refuse to repair anything it happened to be running,
      // which at construction is nothing — but the day it is not, the guard would be silently
      // permanent rather than about other hosts.
      const host = buildHost()
      const created = await host.createSession({ provider: 'claude', cwd: dir }, SINK)

      expect([...workRunningElsewhere(host)]).not.toContain(created.sessionId)

      await host.close(created.sessionId, SINK)
    })

    it('⛔ refuses to resume a conversation another live host is running', async () => {
      // 191 H7 / 194 H2: reservation is synchronous, and that is what makes it a lock — over this
      // host's own map only. Two hosts both find the id free, both read the same `nextOrdinal`, and
      // the one that loses the unique-index race stops recording for the rest of that session's life
      // while its provider goes on producing output nobody writes down.
      crashedMidTurn('sess_contested')
      anotherHostRunning('sess_contested')
      const host = buildHost()

      const refusal = await host
        .resumeSession('sess_contested', SINK)
        .catch((error: unknown) => error)

      // ⚠️ **The SENTENCE, because that is what crosses IPC.** `refusalTranslated` logs the
      // diagnostic — which carries the id — and throws a hand-written, id-free line in its place
      // (100). Asserting the discriminant here would pin a value the surface never receives.
      expect(errorText(refusal)).toBe(describeUnavailable('run-by-another-host'))
      expect(errorText(refusal)).not.toContain('sess_contested')
      // ⛔ **And it did not settle the row on its way to refusing.** `resumeSession` closes the open
      // turn as `unknown` before it launches; a refusal that ran that first would have done 194 H1's
      // damage in the course of preventing 194 H2's.
      expect(statusOf('sess_contested')).toBe('working')
    })

    it('⛔ refuses to REBUILD a conversation another live host is running', async () => {
      // 191 H8: `slots` is host-local, so a second host finds the id free and promotes a new active
      // generation underneath the first. The first's already-written tail becomes unreachable and
      // its next append reuses ordinals in a generation that is no longer the active one.
      adopted('sess_contested_build')
      anotherHostRunning('sess_contested_build')

      const refused = await buildHost().rebuildLedger('sess_contested_build')

      expect(refused.outcome).toBe('in-use')
    })

    it('⛔ …and the paired positive: it rebuilds one nobody is running', async () => {
      // Without this, the test above is satisfied by a `rebuildLedger` that refuses everything.
      adopted('sess_free_build')

      const allowed = await buildHost().rebuildLedger('sess_free_build')

      expect(allowed.outcome).not.toBe('in-use')
    })

    /**
     * 🔴 **265 §3 · the retained launch tail, asked by the host that cannot see it**
     * (259 lens B finding 3).
     *
     * ⛔ **The launch registry is private to one host; cross-host exclusion runs over the shared
     * ledger.** `finish(launch, terminated)` deliberately keeps owning a subject after a bounded stop
     * gives up — that is 068 finding 2 — but the only question that reaches it is
     * `LaunchRegistry.refuse`, and host B asks its OWN registry, which has never heard of A's entry.
     * Meanwhile finalization has already deleted A's slot, so `workInFlight` advertised nothing.
     * B then started a second provider against the same provider reference and native transcript
     * while A's first may still have been alive and writing it.
     *
     * ⚠️ **Two REAL hosts, because this is about what a host CONTRIBUTES**, not about what the
     * directory does with it — the stand-in above answers the other half.
     */
    it('🔴 265 §3 · a retained launch tail is refused to another host over the same ledger', async () => {
      const exit = new FakeProcessExit()
      const sessions = new FakeProviderSessions()
      const createRuntime = (provider: 'claude' | 'codex'): AgentRuntime =>
        new FakeRuntime(provider, { exit, sessions })
      const first = buildHost({ createRuntime, newSessionId: () => 'sess_tail' })
      await first.createSession({ provider: 'claude', cwd: dir }, SINK)
      await first.close('sess_tail', SINK)

      // ⛔ **The exact state the finding describes**, and all three halves are asserted because any
      // one of them alone would make the refusal below mean something different: the slot is gone,
      // the process was never confirmed dead, and the launch is still owned.
      expect(first.sessionIds, 'the slot is gone').toEqual([])
      expect(exit.isConfirmed, 'and nothing confirmed the process died').toBe(false)
      expect([...first.workInFlight()], 'so the host still advertises it').toContain('sess_tail')

      const second = buildHost({ createRuntime })
      const refusal = await second.resumeSession('sess_tail', SINK).catch((error: unknown) => error)
      expect(errorText(refusal)).toBe(describeUnavailable('run-by-another-host'))
      expect(errorText(refusal)).not.toContain('sess_tail')

      // ⚑ **Paired: confirming the exit releases it.** Without this the test would pass against a
      // host that refused every cross-host resume forever — which is 149's stranded conversation
      // arriving through the fix for 068's double provider.
      exit.confirm()
      await waitFor(
        () => ![...first.workInFlight()].includes('sess_tail'),
        'the retained tail to be released',
      )
      const reopened = await second.resumeSession('sess_tail', SINK)
      expect(reopened.sessionId).toBe('sess_tail')
      await second.closeAll()
      await first.closeAll()
    })

    it('a host that has closed everything stops holding its work — by closing it', async () => {
      // ⛔ **The first version of this test passed for the wrong reason**, and 198's mutation table
      // is what said so: M12 removed the `closeAll` that used to leave the directory and came back
      // GREEN. The host it built held no sessions, so the guard it was meant to prove was never
      // asked anything. The host holds a REAL session now, and what is asserted is the mechanism
      // that actually releases it: `closeAll` closes every session, so the slots empty — the
      // directory has nothing to do with it, and `live-hosts.ts` carries why the leave was removed
      // rather than repaired.
      const first = buildHost()
      const created = await first.createSession({ provider: 'claude', cwd: dir }, SINK)
      expect([...first.workInFlight()]).toContain(created.sessionId)

      crashedMidTurn('sess_handover')
      await first.closeAll()
      expect([...first.workInFlight()]).toEqual([])

      // The guard must not be permanent: an app that quit and relaunched in one process — which is
      // what a test file is — has to repair the row the previous host left.
      buildHost()

      expect(statusOf('sess_handover')).toBe('idle')
    })
  })
})
