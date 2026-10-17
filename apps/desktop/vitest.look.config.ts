import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

/**
 * 🎨 **A DESIGN TOOL, not a test** — `pnpm run look:capture -- <scene> <out.png>` renders one
 * surface of the window, headless, with fake data, and saves a PNG to compare with a mock.
 *
 * ⛔ **Not part of `pnpm run test`, `test:dom` or `ci`**, and not an entry in the root config's
 * `projects`, so it costs the suite nothing: it runs only when someone asks for a picture. Its
 * scenes are `look/scenes/*.look.ts`, a suffix no test project picks up.
 *
 * ⚑ **The DOM project's engine, on purpose**: the same Chromium, the same real stylesheet
 * (`test/dom/harness.ts` imports `base.css`), the same harness and fixtures — so a picture shows the
 * window as it paints, with nothing to keep in step. ⛔ It never touches the running app: no
 * Electron, no port of the app's, no userData — a headless browser of its own, closed with the run.
 *
 * ⚑ The PNG is written by a browser command running in node ({@link saveLook}), because the page
 * may not write outside the repo itself.
 */
const saveLook: BrowserCommand<[path: string, base64: string]> = (_context, path, base64) => {
  const out = isAbsolute(path) ? path : resolve(process.env['LOOK_CWD'] ?? process.cwd(), path)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(base64, 'base64'))
}

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { include: ['vue', 'markdown-it'] },
  // ⚑ `LOOK_OUT`, `LOOK_WIDTH` and `LOOK_HEIGHT` reach the scene as `import.meta.env`.
  envPrefix: ['VITE_', 'LOOK_'],
  test: {
    name: 'look',
    // ⚠️ Stated, not inferred — see `vitest.probe.config.ts`.
    root: dirname(fileURLToPath(import.meta.url)),
    include: ['look/scenes/**/*.look.ts'],
    setupFiles: ['test/dom/setup/the-window-is-a-wire.ts'],
    retry: 0,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      // ⚑ The scene's frame is scaled down to fit the browser's own page (1280×720 by default),
      // which would save a 1280×860 picture at 1072×720. A page larger than any picture keeps 1:1.
      provider: playwright({ contextOptions: { viewport: { width: 3000, height: 2000 } } }),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
      commands: { saveLook },
    },
  },
})
