// Build-time only: bundle JS and substitute Node's built-in SQLite behind the fence API.
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(resolve(root, 'apps/desktop/package.json'))
export async function buildPluginSupervisor(
  out = resolve(root, 'apps/desktop/resources/plugin-supervisor/entry.cjs'),
) {
  const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'apps/desktop/src/main/plugins/supervisor/entry.ts')],
    outfile: out,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    bundle: true,
    legalComments: 'eof',
    plugins: [
      {
        name: 'standalone-node-sqlite',
        setup(builder) {
          builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            path: resolve(root, 'apps/desktop/src/main/plugins/supervisor/sqlite-adapter.ts'),
          }))
        },
      },
    ],
  })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPluginSupervisor()
