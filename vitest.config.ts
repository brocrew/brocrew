import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'

// Every project's tests run in a fictional home, and refuse to run where they can see the real one.
const sealed = { env: theTestsEnv(), setupFiles: [THE_GUARD] }

// Root Vitest config using per-package projects (layered, node-environment tests).
// Renderer/component tests are intentionally out of scope for Step 0.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          ...sealed,
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          root: './packages/runtime',
          environment: 'node',
          ...sealed,
          include: ['test/**/*.test.ts'],
        },
      },
      // The desktop package configures itself (apps/desktop/vitest.config.ts): one of its tests
      // renders a component, which needs the Vue plugin — and the plugin belongs in the package
      // that already depends on it.
      './apps/desktop',
      // ⚠️ **The same components, in a real engine** (083). SSR renders markup and has no layout,
      // no compositing and no computed styles — which is how 080 shipped a grey header and a dark
      // drawer beside paper past 2043 green tests. This project answers the one question the
      // string cannot: what does an element, WHERE IT ACTUALLY SITS, resolve and paint. It runs on
      // the default path deliberately; a harness gated out of the gate is debt, not coverage, and
      // debt of exactly this shape is what 083 exists to pay off.
      './apps/desktop/vitest.dom.config.ts',
      {
        // Tooling that guards the live smokes — plain ESM, so `.mjs` tests live next to it.
        test: {
          name: 'scripts',
          root: './scripts',
          environment: 'node',
          ...sealed,
          include: ['test/**/*.test.mjs'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/desktop/src/main/db/**/*.ts'],
    },
  },
})
