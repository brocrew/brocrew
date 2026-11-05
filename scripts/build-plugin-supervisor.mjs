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
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'apps/desktop/src/main/plugins/supervisor/entry.ts')],
    outfile: out,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    bundle: true,
    legalComments: 'eof',
    metafile: true,
    plugins: [
      {
        name: 'standalone-node-sqlite',
        setup(builder) {
          builder.onResolve({ filter: /(?:^|\/)sqlite-contract$/ }, () => ({
            path: resolve(root, 'apps/desktop/src/main/plugins/supervisor/sqlite-adapter.ts'),
          }))
        },
      },
    ],
  })
  const inputs = Object.keys(result.metafile.inputs)
  if (inputs.some((input) => input.includes('better-sqlite3') || /\.node$/.test(input)))
    throw new Error('Standalone supervisor must not include a native SQLite module')
  const external = Object.values(result.metafile.outputs).flatMap((output) => output.imports)
  if (external.some((input) => input.path === 'better-sqlite3' || /\.node$/.test(input.path)))
    throw new Error('Standalone supervisor must not import a native SQLite module')
  if (!external.some((input) => input.path === 'node:sqlite'))
    throw new Error('Standalone supervisor must use node:sqlite')
  return result.metafile
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPluginSupervisor()
