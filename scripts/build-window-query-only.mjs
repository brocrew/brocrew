import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { bundleAWorker } from '../apps/desktop/test/helpers/bundle-a-worker.ts'

const output = resolve(process.argv[2] ?? 'window-query-only')
mkdirSync(output, { recursive: true })
const worker = await bundleAWorker('src/main/window-reader.worker.ts', output, 'window-reader.cjs')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const manifest = {
  source: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  workerSha256: createHash('sha256').update(readFileSync(worker)).digest('hex'),
  driverSha256: createHash('sha256')
    .update(readFileSync(new URL('./window-query-only.mjs', import.meta.url)))
    .digest('hex'),
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest))
