import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CodexRuntime } from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * ⛔ **Two Codex launches on one cold home, the way the app makes them** (180).
 *
 * `pnpm run probe:codex-home-race`. This is the half of 180 that no `vitest` unit can reach:
 * `codex-home-boot.test.ts` pins that the second spawn WAITS, and only a real pair of app-servers
 * on a real cold `CODEX_SQLITE_HOME` can show what happens when it does not.
 *
 * ## The failure this is the instrument for
 *
 * `codex app-server` creates `state_5.sqlite` (and `logs_2`, `memories_1`, `goals_1`) as it starts.
 * Two doing that in one home at the same moment is not serialized by the provider; the loser exits:
 *
 * ```
 * Error: failed to initialize sqlite state runtime under <home>
 * ```
 *
 * …which the app forwarded to the launcher as the whole of what a first message got you.
 *
 * ⚑ **Measured before the fix, against this same binary: 7 trials in 10 lost an app-server** with
 * both spawns in one tick, 2/10 at +15 ms, 0/10 from +20 ms. The window is the ~20 ms of CREATION —
 * a live app-server holding an EXISTING db blocks nothing (0/10 at every overlap from 50 ms to 1 s).
 *
 * ⛔ **So this probe is only meaningful on a home that has never been opened**, and it makes a fresh
 * one per trial for exactly that reason. A warm home is the shape that was always green.
 *
 * ## 🔒 What it touches
 *
 * A temp home per trial, and `~/.codex/auth.json` READ once — the same copy `provisionCodexAuth`
 * makes, since an app-server with no credential exits before it would have raced. Nothing under
 * `~/.codex` or `~/.claude` is written, and the run fails if a trial's home is left behind.
 */

const TRIALS = Number(process.env['CODEX_HOME_RACE_TRIALS'] ?? 10)
const SQLITE_FAILURE = /failed to initialize sqlite state runtime|could not open its own database/i

it(
  'a model probe and a session launching together on a cold home do not kill each other',
  { timeout: 300_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-home-race-'))
    const runtime = new CodexRuntime(bundledCodexTransportFactory())
    const losses: string[] = []

    try {
      for (let trial = 0; trial < TRIALS; trial++) {
        const home = join(root, `home-${trial}`)
        mkdirSync(home, { recursive: true, mode: 0o700 })
        copyFileSync(join(homedir(), '.codex', 'auth.json'), join(home, 'auth.json'))
        const cwd = join(root, `project-${trial}`)
        mkdirSync(cwd, { recursive: true })

        // ⚠️ **Both in ONE tick, which is the app's shape compressed, not a shape invented for the
        // probe.** The launcher asks for models on mount and the session spawns on Send; 180
        // measured 159 ms between them on an idle machine, with nothing holding them apart. This
        // removes the luck rather than the mechanism.
        const probing = runtime.listModels({ providerHome: home })
        const starting = runtime.start({ cwd, providerHome: home })

        const [probe, session] = await Promise.allSettled([probing, starting])
        if (session.status === 'fulfilled') await session.value.close()

        for (const [what, outcome] of [
          ['model probe', probe],
          ['session', session],
        ] as const) {
          if (outcome.status !== 'rejected') continue
          const message = String(outcome.reason?.message ?? outcome.reason)
          // Only the sqlite death is this probe's subject. A provider that refused for any other
          // reason — an expired credential, a network that is down — is not evidence about a race,
          // and counting it would make this instrument agree with itself for the wrong reason.
          if (SQLITE_FAILURE.test(message)) losses.push(`trial ${trial} · ${what}: ${message}`)
        }
      }

      expect(losses, `${losses.length}/${TRIALS} trials lost an app-server`).toEqual([])
      // The paired positive: the trials really did open homes. An empty `losses` over a loop that
      // never launched anything would read exactly the same (`176` §12).
      const opened = readdirSync(root)
        .filter((entry) => entry.startsWith('home-'))
        .filter((entry) => readdirSync(join(root, entry)).some((f) => f.startsWith('state_')))
      expect(opened, 'every trial home carries the state db an app-server creates').toHaveLength(
        TRIALS,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
