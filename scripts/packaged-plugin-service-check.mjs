// Run against built resources as shipped; never rebuild or patch the service under test.
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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
    else {
      console.error(`[plugin-service-check] retained ${scratch}`)
      if (process.platform === 'win32' && process.env.RUNNER_TEMP) {
        const evidence = join(process.env.RUNNER_TEMP, 'recovery-evidence', basename(scratch))
        for (const file of ['service.log', 'supervisor/owner.json']) {
          try {
            await mkdir(join(evidence, dirname(file)), { recursive: true })
            const source = join(scratch, 'p', file)
            const target = join(evidence, file)
            if (file === 'supervisor/owner.json') {
              const { version, epoch, phase, wire } = JSON.parse(await readFile(source, 'utf8'))
              await writeFile(target, JSON.stringify({ version, epoch, phase, wire }) + '\n')
            } else await copyFile(source, target)
          } catch {
            console.error(`[plugin-service-check] could not retain ${file}`)
          }
        }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the built app Resources directory')
  await checkPackagedPluginService(
    resolve(process.argv[2]),
    process.argv[3] && resolve(process.argv[3]),
  )
}
