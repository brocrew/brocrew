import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

/**
 * The second project: components in a real engine (083).
 *
 * SSR checks markup but has no layout, compositing or computed styles, so a green SSR suite can miss visual defects. Add a DOM lens on the same components alongside the existing checks.
 *
 * ⚠️ **The board asked for jsdom and jsdom is the wrong tool.** jsdom has no layout engine and does
 * not resolve `var()` through the cascade — measured, not assumed — so it could not have caught
 * either escape. What both escapes turned on was *"what does this element, where it actually sits,
 * resolve to"*, and only a real cascade answers that. Hence Chromium.
 *
 * **Not a second runner** (083's constraint): same vitest 4, one more entry in the root config's
 * `projects` array. `@vitest/browser` is a provider for the runner that is already here.
 *
 * ⚠️ **A fresh checkout must run `pnpm run setup:browser` once.** `playwright@1.62.1` ships NO
 * postinstall script — verified in the pnpm store — so `pnpm install` does not fetch a browser
 * under any `onlyBuiltDependencies` setting, and this project dies before its first test with
 * playwright's own "Executable doesn't exist" message. `.github/workflows/ci.yml` has the
 * equivalent step. Found in review, which is the only reason it is not a trap.
 */
export default defineConfig({
  plugins: [vue()],
  /**
   * ⚠️ **Pre-declared, because otherwise the first run RELOADS mid-test.** Vite discovers these two
   * while the suite is already running, re-optimises, and reloads the page — vitest says so out
   * loud: *"this may cause tests to fail, lead to flaky behaviour or duplicated test runs"*. A
   * flaky new harness would be worse than no harness, so the discovery is done here instead.
   */
  optimizeDeps: { include: ['vue', 'markdown-it', 'd3-force'] },
  test: {
    name: 'dom',
    /**
     * Its own directory and its own suffix, and the node project excludes it by the same glob.
     * Two projects picking up one file would run every DOM test twice — once in an environment
     * with no `document`, where every one of them would fail for the wrong reason.
     */
    include: ['test/dom/**/*.dom.test.ts'],
    /**
     * 🔴 **`window.api` is a wire, and this is what makes it one** (361 §2).
     *
     * ⛔ **A setup file rather than a helper, because the helper is what decayed.** See
     * `test/dom/setup/the-window-is-a-wire.ts` for why the interception is on the assignment and
     * why it lives on `Window.prototype`. ⚠️ Removing this line disarms every clone assertion in
     * this project and turns nothing red — `the-bridge-that-clones-nothing.test.ts` reads this
     * file and fails if the line is gone, which is the only reason that is safe to write down.
     */
    setupFiles: ['test/dom/setup/the-window-is-a-wire.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      /**
       * ⚠️ **Off deliberately.** A failure here is a NUMBER — a resolved rgba, a measured px — and
       * the assertion prints it. A screenshot would suggest this suite diffs images, which is the
       * tier (C) 083 costed and did not buy.
       */
      screenshotFailures: false,
    },
  },
})
