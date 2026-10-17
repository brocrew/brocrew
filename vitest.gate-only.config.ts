import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'

/**
 * ⛔ **706 · the tests that run `clean-base`, and ONLY `pnpm run ci` runs them** (PM ruling, `702` F-1).
 *
 * ⚑ **Standing rule §6**: *"Never run `clean-base`, not even `--dry-run`"* — and *"`pnpm run ci` IS
 * PERMITTED, whole."* Two tests spawn the real `node scripts/clean-base.mjs --dir <temp>`, and until
 * `706` both sat in projects a seat runs every day: `apps/desktop/test/…` under `--project desktop`
 * (which `698`, `703` and `702`'s own pre-check ran), and `scripts/test/…` under `--project scripts`
 * and a bare `vitest run`. ⚑ **So they moved OUT of every project in `vitest.config.ts`**, into a
 * `gate-only/` beside each `test/` — at the same depth, so every path either file derives from its
 * own location is unchanged — and this config is the only one whose globs reach them.
 *
 * ⚑ **`pnpm run gate-only:check` runs it, and `ci` runs that.** ⛔ Never run it yourself: it IS
 * running `clean-base`. `scripts/test/clean-base-runs-only-in-the-gate.test.mjs` keeps both halves
 * true — nothing an ordinary project reaches starts the script, and the gate still does.
 *
 * ⚠️ **The priced cost**: a mutation row whose only killer is one of these files cannot be re-verified
 * RED by anything any more — `verify_row.py` refuses the killer and says why, no project a table run
 * starts reaches it, and `ci` runs it only on the unmutated tree. `383` M5's note at `699` already
 * recorded this for its row; `706`'s response doc names the tables and asks for a ruling.
 *
 * ⚑ **717 · the ruling, R45: only what SPAWNS the script stays here.** The tests that never start it
 * — the source censuses, the manifest's constants, the two planners' units — went back to
 * `scripts/test/clean-base-without-running-it.test.mjs`, and `pnpm seed`'s two (which started
 * `seed-demo.mjs`, never `clean-base`) went back to `scripts/test` too, until D-016 deleted the seed.
 * Of `706`'s 67 rows, 14 went RED alone against those and name them as killers now; the other 53 are
 * killed only by a spawn and still carry the cost above. ⛔ And every start in
 * `scripts/gate-only/clean-base.test.mjs` asks R46's `mustNameScratch` first
 * (`scripts/test/fixtures/a-planted-user-data.mjs`) — ⚑ and since `722` (`717` F-6) so does each of
 * `apps/desktop/gate-only/`'s two, `cleanBase` and `cleanBaseRefuses`, on a `--dir` under that
 * module's `fixture()` rather than a `mkdtemp` of their own.
 * `scripts/test/clean-base-starts-only-on-scratch.test.mjs` reads every one of those helpers as text.
 */
// As every other project's: a fictional home, and no run where the real one can be seen.
const sealed = { env: theTestsEnv(), setupFiles: [THE_GUARD] }

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'gate-only-desktop',
          root: './apps/desktop',
          environment: 'node',
          ...sealed,
          include: ['gate-only/**/*.test.ts'],
          // ⚑ The desktop project's own bound, for the same reason (`apps/desktop/vitest.config.ts`).
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'gate-only-scripts',
          root: './scripts',
          environment: 'node',
          ...sealed,
          include: ['gate-only/**/*.test.mjs'],
        },
      },
    ],
  },
})
