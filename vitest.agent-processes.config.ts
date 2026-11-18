import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'

export default defineConfig({
  test: {
    include: ['apps/desktop/smoke/claude-command-cleanup.smoke.ts'],
    env: theTestsEnv(),
    setupFiles: [THE_GUARD],
    maxWorkers: 1,
  },
})
