import assert from 'node:assert/strict'
import { isAbsolute, join } from 'node:path'
import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './lib/tests-run-in-a-fictional-home.mjs'

const root = process.env.STORAGE_QUALIFICATION_ROOT
assert(root && isAbsolute(root), 'qualification requires its owned stage root')

export default defineConfig({
  cacheDir: join(root, 'tool-cache'),
  test: {
    name: 'storage-qualification',
    environment: 'node',
    env: theTestsEnv(),
    setupFiles: [THE_GUARD],
    include: [
      ['control', 'timing', 'unwrapped'].includes(process.env.STORAGE_QUALIFICATION_STAGE ?? '')
        ? 'scripts/storage-qualification-timing.probe.ts'
        : 'scripts/storage-qualification.probe.ts',
    ],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    experimental: {
      fsModuleCache: false,
      fsModuleCachePath: join(root, 'module-cache'),
    },
    testTimeout: 480_000,
  },
})
