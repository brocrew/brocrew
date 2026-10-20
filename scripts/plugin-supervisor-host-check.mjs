// Offline only: explicit fresh package and app runtime; never discovers live plugin data.
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, mkdir, realpath, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { buildPluginSupervisor } from './build-plugin-supervisor.mjs'
if (!process.argv[2] || !process.argv[3]) throw new Error('Supply archive and evidence directory')
const root = await realpath(await mkdtemp('/tmp/fictional-supervisor-proof-'))
const req = createRequire(resolve('apps/desktop/package.json'))
const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
let clean = false
try {
  await buildPluginSupervisor()
  const bundle = join(root, 'proof.cjs')
  await build({
    entryPoints: [resolve('apps/desktop/smoke/plugin-supervisor-host.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    plugins: [
      {
        name: 'native-fence',
        setup(builder) {
          builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            path: req.resolve('better-sqlite3'),
            external: true,
          }))
        },
      },
    ],
  })
  const result = await createRequire(import.meta.url)(bundle).proof({
    root: join(root, 'data'),
    archive: resolve(process.argv[2]),
    resources: resolve('apps/desktop/resources'),
  })
  clean = result.passed === true
  const out = resolve(process.argv[3])
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'supervisor-host-proof.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally {
  // Retain the private fence/receipts after any unproved cleanup. Never erase a live guard.
  if (clean) await rm(root, { recursive: true, force: true })
}
