// Offline integration check after the Chrome package and app Node runtime have been built.
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = await mkdtemp(join(tmpdir(), 'fictional-chrome-host-proof-'))
const req = createRequire(resolve('apps/desktop/package.json'))
const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
const bundle = join(root, 'proof.cjs')
await build({
  entryPoints: [resolve('apps/desktop/smoke/plugin-node-host.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
})
if (!process.argv[2]) throw new Error('supply the freshly built Chrome archive')
const result = await createRequire(import.meta.url)(bundle).proof({
  root: join(root, 'data'),
  resources: resolve('apps/desktop/resources'),
  archive: resolve(process.argv[2]),
  bundle,
})
const out = process.argv[3] ? resolve(process.argv[3]) : root
await mkdir(out, { recursive: true })
await writeFile(join(out, 'node-host-proof.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (process.argv[3]) await rm(root, { recursive: true, force: true })
