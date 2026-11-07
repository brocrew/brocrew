// Run against built resources as shipped; never rebuild or patch the service under test.
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function checkPackagedPluginService(resources, packages) {
  resources = await realpath(resources)
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'ps-')))
  const req = createRequire(join(root, 'apps/desktop/package.json'))
  const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
  const harness = join(scratch, 'check.cjs')
  let passed = false
  try {
    await build({
      entryPoints: [join(root, 'apps/desktop/smoke/packaged-plugin-service.ts')],
      outfile: harness,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      plugins: [
        {
          name: 'standalone-node-sqlite',
          setup(builder) {
            builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
              path: join(root, 'apps/desktop/src/main/plugins/supervisor/sqlite-adapter.ts'),
            }))
          },
        },
      ],
    })
    // Keep timeout cleanup in the process that owns the real service child on Windows too.
    /** @type {{ smoke: typeof import('../apps/desktop/smoke/packaged-plugin-service').smoke }} */
    const harnessModule = req(harness)
    await harnessModule.smoke(resources, scratch, packages)
    passed = true
  } finally {
    if (passed) await rm(scratch, { recursive: true, force: true })
    else console.error(`[plugin-service-check] retained ${scratch}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the built app Resources directory')
  await checkPackagedPluginService(
    resolve(process.argv[2]),
    process.argv[3] && resolve(process.argv[3]),
  )
}
