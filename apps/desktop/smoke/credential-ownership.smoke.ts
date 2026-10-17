import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  requireMarkers,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { createProviderAuthOps } from '../src/main/runtime/provider-homes'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * ⛔ **A `codex app-server` that outlives the gesture that spawned it** (185, from 182 H2).
 *
 * `pnpm run probe:credential-ownership`. This is the half of 185 no `vitest` unit can reach, and it
 * is the instrument the dispatch is measured by: 180's standard is *a rate, not a story*.
 *
 * ## What it reproduces
 *
 * Both credential paths spawn a **detached** app-server and then await `initialize` with nothing
 * that can stop the child if the answer never comes:
 *
 * | | the waiter is released by | the child was owned by |
 * |---|---|---|
 * | **A · the auth check** | `withDeadline(ops.check, 10 s)` in `RuntimeHost` | ⛔ **nothing** — `probeCodexAuthInHome`'s `finally` cannot run until `initialize` settles |
 * | **B · sign-in** | ⛔ **nothing** — the 5-minute deadline is armed only after `ops.signIn` returns | ⛔ **nothing** — `PENDING_SIGN_IN.cancel` is a no-op |
 *
 * `withDeadline`'s own docblock says it: *"Rejecting only releases the AWAITER; it does not release
 * the work."* Everywhere else in the app that is fine. Here the work is a process.
 *
 * ## How `initialize` is made to never answer — with a REAL app-server
 *
 * A stubbed transport would prove nothing about a child, so the child is the pinned binary: the
 * transport spawns a two-line shim that `exec`s the bundled `codex app-server` with **stdout
 * redirected to `/dev/null`**. The process is therefore the real thing — same binary, same pinned
 * `CODEX_HOME`, same sanitized env, creating its own sqlite state — and the app's `initialize`
 * request is never answered because the answer has nowhere to go. `exec` means the process the
 * kernel runs IS `codex`, which is what makes the attribution below possible.
 *
 * ## 🔒 What it touches
 *
 * ⛔ **No credential, anywhere.** No `auth.json` is copied, read or written; `CODEX_HOME` and
 * `CODEX_SQLITE_HOME` are pinned to a temp root that is removed at the end. (The app-server starts
 * and holds without a credential — measured; it is `initialize` that never returns, not the boot.)
 * `176`'s `personal-home-guard` scans both personal homes for anything of this run's afterwards.
 *
 * ⛔ **Kill only what we spawn.** Every child is attributed by **the bundled binary path AND its
 * cwd**, never `pgrep -f codex` — 180 found three foreign `codex app-server` processes on this
 * machine and 183 saw a foreign `~/.codex` write. Anything still alive at the end is killed by pid,
 * and only from that attributed list.
 */

const TRIALS = Number(process.env['CREDENTIAL_OWNERSHIP_TRIALS'] ?? 5)
/** Long enough for the spawn and the (unanswerable) handshake to be in flight. */
const SPAWN_SETTLE_MS = 1_500
/** A second check that has to wait this long has not reached a spawn: the gate is still held. */
const GATE_HELD_MS = 5_000

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The codex the app SHIPS, resolved the way the app resolves it (014) — `require.resolve` from this
 * package, which is where the optional dependency actually lives. Never a PATH lookup: a probe that
 * measured somebody else's codex would be measuring somebody else's machine.
 */
function bundledCodexBinary(): string {
  const desktopRequire = createRequire(join(import.meta.dirname, '..', 'package.json'))
  return realpathSync(
    join(
      dirname(desktopRequire.resolve('@openai/codex-darwin-arm64/package.json')),
      'vendor',
      'aarch64-apple-darwin',
      'bin',
      'codex',
    ),
  )
}

/**
 * Every live `codex app-server` that is **ours**: the pinned binary, running under `root`.
 *
 * Two independent facts, both required. `ps -eo args` gives the executable — matched against the
 * absolute bundled path, so a global install or another repo's copy is not us — and `lsof -d cwd`
 * gives the working directory, which for these two paths is the profile home this run created.
 */
function ourChildren(binary: string, root: string): number[] {
  const listing = execFileSync('/bin/ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  const pids: number[] = []
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    if (!match[2]?.startsWith(`${binary} app-server`)) continue
    const pid = Number(match[1])
    let cwd: string
    try {
      cwd =
        execFileSync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .split('\n')
          .find((row) => row.startsWith('n'))
          ?.slice(1) ?? ''
    } catch {
      continue // the process exited between the listing and the lookup — not ours to claim
    }
    if (cwd.startsWith(root)) pids.push(pid)
  }
  return pids
}

/** Which of `pids` are still alive — signal 0, so nothing is killed by asking. */
function stillAlive(pids: readonly number[]): number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
}

/** A `codex` whose stdout goes nowhere: the real binary, an `initialize` that cannot answer. */
function deafCodexShim(root: string, binary: string): string {
  const shim = join(root, 'deaf-codex.sh')
  writeFileSync(shim, `#!/bin/sh\nexec "${binary}" "$@" >/dev/null\n`)
  chmodSync(shim, 0o755)
  return shim
}

function hostWith(userData: string, codex: string): RuntimeHost {
  return new RuntimeHost({
    store: NULL_SESSION_STORE,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: () => {
      throw new Error('no session is started in this probe')
    },
    prepareProviderHome: (provider, profileId) =>
      join(userData, 'provider-homes', profileId, provider),
    providerHomePath: (provider, profileId) =>
      join(userData, 'provider-homes', profileId, provider),
    resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
    newSessionId: () => 'sess_probe',
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'unused here',
      authNote: null,
      files: [],
    }),
    providerAuth: createProviderAuthOps(userData, { codexCommand: () => codex }),
    // Prevent browser side effects: `signInProvider` calls `openExternal` without awaiting
    // it. Although this probe stops at `initialize`, a real `shell.openExternal` would still
    // open a browser.
    openExternal: async () => {},
  })
}

interface Row {
  readonly trial: number
  /** ms from the gesture to the UI having an answer (or to Cancel, on the sign-in path). */
  readonly gaveUpMs: number
  /**
   * ⚑ **The witness**: children attributed to this trial WHILE the gesture was still in flight.
   *
   * It exists because the first version of this probe took its anti-vacuity evidence from the same
   * scan as its verdict — so a fix that reaps the child promptly reported "nothing was ever
   * spawned", and the guard fired instead of the assertion. A scan taken during the gesture cannot
   * be turned off by the gesture ending well.
   */
  readonly spawnedDuring: number
  /** Of those, how many were still alive once the UI had its answer. */
  readonly aliveAtGiveUp: number
  /** ms a following credential check spent before it could boot — `>= GATE_HELD_MS` is held. */
  readonly gateMs: number
  /** Of those, how many survived `closeAll()`. */
  readonly survivedQuit: number
}

function report(path: string, rows: readonly Row[]): void {
  const rate = (n: number): string => `${n}/${rows.length}`
  const alive = rows.filter((r) => r.aliveAtGiveUp > 0).length
  const held = rows.filter((r) => r.gateMs >= GATE_HELD_MS).length
  const survived = rows.filter((r) => r.survivedQuit > 0).length
  const witnessed = rows.filter((r) => r.spawnedDuring > 0).length
  console.log(`\n=== ${path} — ${rows.length} trials ===`)
  for (const row of rows) {
    console.log(
      `  trial ${row.trial}: gave up at ${row.gaveUpMs} ms · ` +
        `spawned ${row.spawnedDuring} · ${row.aliveAtGiveUp} still alive · ` +
        `next boot waited ${row.gateMs} ms · ${row.survivedQuit} survived quit`,
    )
  }
  console.log(`  ⚑ an app-server really was spawned    : ${rate(witnessed)}`)
  console.log(`  ⛔ a child alive after the UI gave up : ${rate(alive)}`)
  console.log(`  ⛔ the home's boot gate still held    : ${rate(held)}`)
  console.log(`  ⛔ survived closeAll() (the quit)     : ${rate(survived)}`)
}

it(
  'neither credential path leaves a codex app-server nobody can stop',
  { timeout: 900_000 },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-own-')))
    const binary = bundledCodexBinary()
    const deaf = deafCodexShim(root, binary)
    const spawnedEver: number[] = []
    const checks: Row[] = []
    const signIns: Row[] = []

    try {
      for (let trial = 0; trial < TRIALS; trial++) {
        // A fresh userData per trial, so a held gate from the previous one cannot be mistaken for
        // this one's — the boot gate is keyed by the home's real path.
        const userData = join(root, `check-${trial}`)
        const stuck = hostWith(userData, deaf)
        const normal = hostWith(userData, binary)

        const t0 = Date.now()
        const checking = stuck.checkProviderAuth('codex', 'default')
        // ⚑ The witness, taken WHILE the check is still in flight. ⚠️ Scoped to THIS trial's
        // userData, not the whole temp root: a leak from an earlier trial is still alive at this
        // point (it is reaped only at the very end), and counting it here would credit one path
        // with another path's child.
        await settle(SPAWN_SETTLE_MS)
        const spawnedNow = ourChildren(binary, userData)
        spawnedEver.push(...spawnedNow)

        const state = await checking
        const gaveUpMs = Date.now() - t0
        const alive = stillAlive(spawnedNow)

        // ⛔ Is the home still locked? Asked the way the app would ask it — a second credential
        // check — so the answer is about the app, not about a private map. A gate that was released
        // answers in about a second; a held one burns its whole budget without reaching a spawn.
        const t1 = Date.now()
        await normal.checkProviderAuth('codex', 'default')
        const gateMs = Date.now() - t1
        await settle(300)

        await stuck.closeAll()
        await normal.closeAll()
        await settle(500)

        checks.push({
          trial,
          gaveUpMs,
          spawnedDuring: spawnedNow.length,
          aliveAtGiveUp: alive.length,
          gateMs,
          survivedQuit: stillAlive(spawnedNow).length,
        })
        // 🔒 The state is printed by name only — an `AuthState` can carry the account it belongs to.
        console.log(`check trial ${trial}: answered '${state.state}' after ${gaveUpMs} ms`)
      }

      for (let trial = 0; trial < TRIALS; trial++) {
        const userData = join(root, `signin-${trial}`)
        const stuck = hostWith(userData, deaf)
        const normal = hostWith(userData, binary)

        const t0 = Date.now()
        // ⚠️ Not awaited: before the fix this promise NEVER settles, which is the defect. The
        // rejection arm is attached so a fixed build does not fail on an unhandled rejection.
        const pending = stuck.signInProvider('codex', 'default')
        pending.catch(() => {})
        await settle(SPAWN_SETTLE_MS)
        const spawnedNow = ourChildren(binary, userData)
        spawnedEver.push(...spawnedNow)

        // The user presses Cancel — the only "give up" this path has, since its deadline is not
        // armed until the start it is waiting on returns.
        await stuck.cancelProviderSignIn('codex', 'default')
        const gaveUpMs = Date.now() - t0
        await settle(500)
        const aliveAfterCancel = stillAlive(spawnedNow)

        const t1 = Date.now()
        await normal.checkProviderAuth('codex', 'default')
        const gateMs = Date.now() - t1
        await settle(300)

        await stuck.closeAll()
        await normal.closeAll()
        await settle(500)

        signIns.push({
          trial,
          gaveUpMs,
          spawnedDuring: spawnedNow.length,
          aliveAtGiveUp: aliveAfterCancel.length,
          gateMs,
          survivedQuit: stillAlive(spawnedNow).length,
        })
      }

      // ────────────────────────────────────────────────────────────────────────────────────────
      // ⛔ 202 · the two routes 191 H1 and H2 name — a quit that leaves NO live child
      // ────────────────────────────────────────────────────────────────────────────────────────
      //
      // ⚑ These are not the trials above with a quit on the end. They are the two windows the quit
      // itself opens: a gesture that STARTS after the shutdown pass has read its maps, and one that
      // is already mid-teardown when the shutdown stops waiting. Both used to leave a real
      // `codex app-server` holding a loopback listener behind an app that had exited.
      const late: number[] = []
      const lateWitness: number[] = []
      const midTeardown: number[] = []
      for (let trial = 0; trial < TRIALS; trial++) {
        // ── H1 · the gesture that arrives after the snapshot ──────────────────────────────────
        {
          const userData = join(root, `late-${trial}`)
          // ⚑ **The positive control, on THIS trial's own userData** (176 §12). Without it, "no
          // child after the quit" passes for a run in which the shim never spawned anything at all
          // — and the A/B sections below prove that about a DIFFERENT directory, which is adjacent
          // evidence rather than this trial's. The same gesture, before any quit, must spawn.
          const control = hostWith(userData, deaf)
          const controlAsking = control.checkProviderAuth('codex', 'default')
          controlAsking.catch(() => {})
          await settle(SPAWN_SETTLE_MS)
          const controlSpawned = ourChildren(binary, userData)
          spawnedEver.push(...controlSpawned)
          lateWitness.push(controlSpawned.length)
          await control.closeAll()
          await controlAsking
          await settle(300)

          const host = hostWith(userData, deaf)
          // The quit and the command are genuinely concurrent — the IPC handler stays callable
          // while `before-quit` is deferred, which is how a queued renderer command lands here.
          const quitting = host.closeAll()
          const asking = host.checkProviderAuth('codex', 'default')
          const signing = host.signInProvider('codex', 'default')
          signing.catch(() => {})
          await quitting
          await asking
          await signing.catch(() => {})
          await settle(SPAWN_SETTLE_MS)
          // ⚠️ Only what is ALIVE: the control above spawned into this same directory, and a pid it
          // left behind for a moment is not a child the late gesture created.
          const after = stillAlive(ourChildren(binary, userData))
          spawnedEver.push(...after)
          late.push(after.length)
        }
        // ── H2 · the gesture already in flight when the quit lands ────────────────────────────
        {
          const userData = join(root, `mid-${trial}`)
          const host = hostWith(userData, deaf)
          const signing = host.signInProvider('codex', 'default')
          signing.catch(() => {})
          await settle(SPAWN_SETTLE_MS)
          const spawnedNow = ourChildren(binary, userData)
          spawnedEver.push(...spawnedNow)
          await host.closeAll()
          await signing.catch(() => {})
          midTeardown.push(spawnedNow.length === 0 ? -1 : stillAlive(spawnedNow).length)
          console.log(
            `202 H2 trial ${trial}: spawned ${spawnedNow.length} · ` +
              `${stillAlive(spawnedNow).length} alive once closeAll() returned`,
          )
        }
      }
      console.log(`\n=== 202 · what the quit left behind ===`)
      console.log(`  ⚑ H1 · the control spawned (per trial)        : ${lateWitness.join(', ')}`)
      console.log(`  ⛔ H1 · children spawned AFTER the quit began : ${late.join(', ')}`)
      console.log(`  ⛔ H2 · children alive when closeAll returned : ${midTeardown.join(', ')}`)

      report('A · the auth check', checks)
      report('B · sign-in', signIns)

      // 🔒 176's guard: is anything of OURS in a personal home? Markers are this run's own names —
      // the temp root and the profile-home segment the ops derive.
      const markers: readonly Marker[] = requireMarkers([
        { label: 'probe temp root', value: root.split('/').pop() ?? root },
        { label: 'provider-homes segment', value: 'provider-homes' },
      ])
      // ⛔ **`hits.map` threw `is not a function` here until 202**, because `pathsNaming` returns
      // a scan and the declaration said `Hit[]` — so this probe, the instrument 202's own acceptance
      // 2 is measured by, could not reach the end of its own run. ⚠️ **And the `limit: 5` went with
      // it**: a cap turns a walk that found six things into one that reports five and says so only
      // through `truncated`, which nothing here read. `describeScan` reads it.
      for (const personal of [join(homedir(), '.codex'), join(homedir(), '.claude')]) {
        expect(
          describeScan(pathsNaming(personal, markers)),
          `🔒 nothing of this run may appear under ${personal}`,
        ).toBe('none')
      }

      // ⛔ The claim. Zero surviving children, on both paths, at every stage.
      expect(
        checks.filter((row) => row.aliveAtGiveUp > 0).map((row) => row.trial),
        'A · a child was still alive after the UI had given up',
      ).toEqual([])
      expect(
        signIns.filter((row) => row.aliveAtGiveUp > 0).map((row) => row.trial),
        'B · a child was still alive after Cancel',
      ).toEqual([])
      expect(
        [...checks, ...signIns].filter((row) => row.survivedQuit > 0).map((row) => row.trial),
        'a child survived closeAll() — the quit',
      ).toEqual([])
      expect(
        [...checks, ...signIns].filter((row) => row.gateMs >= GATE_HELD_MS).map((row) => row.trial),
        "the home's boot gate was still held after the gesture gave up",
      ).toEqual([])

      // ⛔ **202's own claim, both routes.** `-1` marks a trial that spawned nothing at all, which
      // would make its verdict vacuous — H2 is asserted against it below.
      expect(
        late.filter((n) => n > 0),
        '⛔ H1 · a credential gesture spawned a child AFTER the quit had begun',
      ).toEqual([])
      expect(
        midTeardown.filter((n) => n > 0),
        '⛔ H2 · a sign-in child was still alive when closeAll() returned',
      ).toEqual([])
      expect(
        midTeardown.filter((n) => n === -1),
        'an H2 trial spawned no app-server at all — its verdict is about nothing',
      ).toEqual([])
      expect(
        lateWitness.filter((n) => n === 0),
        'an H1 trial could not spawn at all before the quit — its verdict is about nothing',
      ).toEqual([])

      // ⚑ The paired positive, and it is not decoration: every assertion above passes vacuously on a
      // run where nothing was ever spawned (176 §12). The witness is taken DURING each gesture, so
      // it cannot be switched off by the gesture ending well — which is exactly how the first
      // version of this line failed the moment the fix worked.
      expect(
        [...checks, ...signIns].filter((row) => row.spawnedDuring === 0).map((row) => row.trial),
        'a trial spawned no app-server at all — its three verdicts are about nothing',
      ).toEqual([])
    } finally {
      // ⛔ Only what we spawned, attributed by binary AND cwd, and only what is still alive.
      const leaked = stillAlive([...new Set(spawnedEver)])
      for (const pid of leaked) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      if (leaked.length > 0) console.log(`\ncleanup: killed ${leaked.length} leaked app-server(s)`)
      rmSync(root, { recursive: true, force: true })
    }
  },
)
