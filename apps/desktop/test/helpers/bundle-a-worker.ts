import { createRequire } from 'node:module'
import { dirname, join, posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/** The desktop app's own folder. */
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(APP, 'package.json'))

/** Where a package outside the bundle is required from: the app, then the workspace packages. */
const PACKAGES_FROM = [
  APP,
  resolve(APP, '../../packages/runtime'),
  resolve(APP, '../../packages/shared'),
  resolve(APP, '../../packages/orchestration'),
]

/**
 * Whether the bundle leaves `id` to be required at run time: a package from `node_modules`. This
 * repository's own code — a relative import, a resolved file by its absolute path, a workspace
 * package — goes inside. ⚠️ An absolute path is `D:\…` or `D:/…` on Windows, not only `/…`; both
 * spellings are read on every system, since no package is named either way.
 */
export function isLeftOutside(id: string): boolean {
  const absolute = posix.isAbsolute(id) || win32.isAbsolute(id)
  return !id.startsWith('.') && !absolute && !id.startsWith('@brobot2/')
}

/**
 * Bundles a worker module, as main runs it, into `outDir/fileName` as CommonJS, and returns the
 * bundle's path. `entry` is from the desktop app's folder, or absolute.
 */
export async function bundleAWorker(
  entry: string,
  outDir: string,
  fileName: string,
): Promise<string> {
  await build({
    configFile: false,
    root: APP,
    logLevel: 'error',
    plugins: [
      {
        name: 'workspace-packages',
        enforce: 'pre',
        resolveId(id) {
          return id.startsWith('@brobot2/') ? require.resolve(id, { paths: [APP] }) : null
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      lib: { entry: resolve(APP, entry), formats: ['cjs'], fileName: () => fileName },
      rollupOptions: {
        external: isLeftOutside,
        output: { paths: (id) => require.resolve(id, { paths: PACKAGES_FROM }) },
      },
    },
  })
  return join(outDir, fileName)
}
