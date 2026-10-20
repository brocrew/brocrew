import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from '../../scripts/lib/tests-run-in-a-fictional-home.mjs'
export default defineConfig({
  test: {
    name: 'chrome-plugin',
    environment: 'node',
    env: theTestsEnv(),
    setupFiles: [THE_GUARD],
    include: ['plugins/chrome/test/**/*.test.ts'],
  },
})
