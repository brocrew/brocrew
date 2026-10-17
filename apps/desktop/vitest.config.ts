import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { THE_GUARD, theTestsEnv } from '../../scripts/lib/tests-run-in-a-fictional-home.mjs'

/**
 * The desktop package's own test config, so a test can import a `.vue` file.
 *
 * It exists for one reason: a component whose whole job is to map a state to a colour has to be
 * checked by RENDERING it, not by reading the map beside it. `@vitejs/plugin-vue` and `vue` are
 * already this package's dependencies (they build the app), and Vue ships its own server renderer —
 * so this adds a capability without adding anything to install.
 *
 * The environment stays `node`: these are still logic tests, and the one component test renders to
 * a string rather than to a DOM.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    name: 'desktop',
    environment: 'node',
    // The tests run in a fictional home, and refuse to run where they can see the real one.
    env: theTestsEnv(),
    setupFiles: [THE_GUARD],
    include: ['test/**/*.test.ts'],
    /**
     * ⚠️ **`test/dom` belongs to the OTHER project** (083, `vitest.dom.config.ts`). The glob above
     * is recursive, so without this line every DOM test would also be collected here and run in an
     * environment with no `document` — failing for a reason that has nothing to do with what it
     * asserts, and taking the real signal with it.
     *
     * Spread onto the DEFAULTS rather than replacing them: this key overrides vitest's own
     * `node_modules`/`dist` exclusions wholesale, and dropping those would have this project try to
     * collect its dependencies' tests.
     */
    exclude: [...configDefaults.exclude, 'test/dom/**'],
    /**
     * ⚠️ **A bound on the MACHINE, not on the code** (064, carried from 061).
     *
     * 061 reported two streaming-export cases in `whole-session-reads.test.ts` timing out against
     * vitest's 5 s default under CPU contention. Measured while fixing it, the same run also took
     * down `session-reader`'s real-transcript read (6.5 s) and `unknown-payload-bound`'s
     * source-tree walk (8.2 s), and the heaviest export case reached **32 s** — all three pass in
     * about two seconds each when run on their own. So it is not two tests: it is every test in
     * this project that touches the real filesystem or imports a synthetic corpus, racing a clock
     * that is measuring the runner's load.
     *
     * Scoped to `desktop` deliberately. The runtime, shared and orchestration suites are in-memory
     * and fast, and they keep the 5 s default — where a test that overruns really is a test that
     * has stopped making progress.
     *
     * ⚠️ **Not a licence for a slow path.** The bounds that actually matter here — the export frame
     * batch, the archive frame batch, the history window ceiling — are asserted directly, by tests
     * that count the widest read a path ever makes. This only stops the clock becoming a fourth
     * assertion nobody wrote, about a machine nobody measured.
     */
    testTimeout: 60_000,
  },
})
