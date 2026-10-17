import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import base from './vitest.config'
import browser from './apps/desktop/vitest.dom.config'
import desktop from './apps/desktop/vitest.config'

const root = import.meta.dirname
const mode = process.env.COVERAGE_PROJECT_SET ?? 'all'
const step = process.env.COVERAGE_STEP ?? 'diagnostic'
const artifacts = process.env.COVERAGE_ARTIFACT_ROOT ?? resolve(root, 'coverage')
const out = resolve(artifacts, 'runs', step)
const projects = base
  .test!.projects!.filter((project) => {
    const dom = project === './apps/desktop/vitest.dom.config.ts'
    return mode === 'all' || (mode === 'dom' ? dom : !dom)
  })
  .map((project) =>
    project === './apps/desktop/vitest.dom.config.ts'
      ? {
          ...browser,
          root: resolve(root, 'apps/desktop'),
          cacheDir: resolve(artifacts, 'cache', 'dom'),
          resolve: {
            alias: {
              '@vitest/coverage-v8/browser': fileURLToPath(
                import.meta.resolve('@vitest/coverage-v8/browser'),
              ),
            },
          },
          server: {
            fs: {
              allow: [
                root,
                fileURLToPath(new URL('./node_modules/', import.meta.url)),
                fileURLToPath(new URL('.', import.meta.resolve('@vitest/coverage-v8/browser'))),
              ],
            },
          },
        }
      : project === './apps/desktop'
        ? {
            ...desktop,
            root: resolve(root, 'apps/desktop'),
            test: { ...desktop.test, testTimeout: 120_000 },
          }
        : project,
  )
if (mode === 'dom' || mode === 'all') {
  // Unused host source is transformed by Node, away from the browser dependency optimizer.
  projects.unshift({
    plugins: [vue()],
    test: {
      ...base.test!.projects![0].test,
      name: 'coverage-source',
      root,
      environment: 'node',
      include: [],
    },
  })
}

export default defineConfig({
  root,
  plugins: [vue()],
  test: {
    ...base.test,
    projects,
    reporters: ['json', 'blob'],
    outputFile: { json: resolve(out, 'tests.json'), blob: resolve(out, 'blob.json') },
    coverage: {
      provider: 'v8',
      enabled: true,
      reportOnFailure: true,
      reporter: ['json', 'json-summary'],
      reportsDirectory: resolve(out, 'coverage'),
      include: [
        resolve(root, 'apps/desktop/src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue}'),
        resolve(root, 'packages/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue}'),
      ],
      exclude: [
        '**/node_modules/**',
        '**/*.d.ts',
        '**/*.d.mts',
        '**/*.d.cts',
        '**/*.test.*',
        '**/*.spec.*',
        '**/test/**',
        '**/tests/**',
        '**/look/**',
        '**/fixtures/**',
        '**/*.fixture.*',
        resolve(root, 'packages/runtime/src/codex/protocol/**'),
      ],
      allowExternal: true,
      excludeAfterRemap: true,
      processingConcurrency: 1,
    },
  },
})
