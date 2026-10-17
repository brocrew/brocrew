import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

/**
 * The measurement probes — **NOT part of `pnpm run ci`** (255).
 *
 * ⛔ **Deliberately not a fourth entry in the root config's `projects` array.** A millisecond
 * threshold in the gate is a report about the machine that ran it rather than a claim about the app;
 * `175` and `212` are both about the ways that goes wrong, and a perf assertion that reddens
 * whenever CI is busy gets regenerated until it means nothing. So the MECHANISM lives in the `dom`
 * project — `event-fold.dom.test.ts` holds the row count, the fold, the engine's own
 * `checkVisibility` and the scrollbar — and the NUMBERS those mechanisms were chosen on live here,
 * where a reader can re-derive them instead of taking them from a response document.
 *
 * ⚑ **The same shape as `vitest.smoke.config.ts`**: a config outside the gate, run by an explicit
 * script. It is a browser config rather than a node one because everything it measures — layout,
 * paint, containment, a scrollbar — is something only a real engine has.
 *
 *     pnpm run probe:event-fold      # 255 — what OPENING a full window costs
 *     pnpm run probe:event-append    # 263 — what ONE ARRIVING EVENT costs, once opening is cheap
 *
 * ⛔ **Each script names its own file, and that is not decoration** (263). Every probe here reports
 * by THROWING, so a script that collected all of them would hand back one failure per file and make
 * the two measurements read as one broken run. The positional argument is the filter.
 *
 * ⚠️ `*.probe.ts`, not `*.dom.test.ts`, so `vitest.dom.config.ts` cannot pick these up and neither
 * can `apps/desktop/vitest.config.ts`, which excludes `test/dom/**` outright.
 */
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { include: ['vue', 'markdown-it'] },
  test: {
    name: 'probe',
    // ⚠️ Stated, not inferred. A config reached through the root project list takes its root from
    // its own directory; one passed to `--config` takes it from the working directory, so without
    // this the include glob resolves against the repo root and finds nothing.
    root: dirname(fileURLToPath(import.meta.url)),
    include: ['test/dom/**/*.probe.ts'],
    // A probe reports by failing (see `event-fold-scale.probe.ts`), so one file at a time and no
    // retry — a retried measurement is two measurements averaged by accident.
    retry: 0,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
})
