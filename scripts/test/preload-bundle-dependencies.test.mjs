import { isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const { build } = await import(desktopRequire.resolve('vite'))
const workspacePackages = ['@brobot2/shared', '@brobot2/runtime', '@brobot2/orchestration']

describe('sandboxed preload bundles', () => {
  it.each(['index', 'recovery', 'plugin-ui'])(
    '%s needs only the Electron module provided by the sandbox',
    async (name) => {
      // Workspace packages are inlined, while installed dependencies stay external in the app.
      const result = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          target: 'node22',
          lib: {
            entry: join(root, 'apps/desktop/src/preload', `${name}.ts`),
            formats: ['cjs'],
          },
          rollupOptions: {
            external: (id) =>
              !id.startsWith('.') &&
              !isAbsolute(id) &&
              !workspacePackages.some((name) => id === name || id.startsWith(`${name}/`)),
            output: { inlineDynamicImports: true },
          },
        },
      })
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
      const chunks = outputs.filter((item) => item.type === 'chunk')
      expect(chunks).toHaveLength(1)
      expect(chunks[0].isEntry).toBe(true)
      expect([...chunks[0].imports, ...chunks[0].dynamicImports]).toEqual(['electron'])
    },
    30_000,
  )
})
