// Run against built resources as shipped; never rebuild or patch the service under test.
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function checkPackagedPluginService(resources) {
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
      plugins: [{
        name: 'standalone-node-sqlite',
        setup(builder) {
          builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            path: join(root, 'apps/desktop/src/main/plugins/supervisor/sqlite-adapter.ts'),
          }))
        },
      }],
    })
    const node = join(resources, 'plugin-node', process.platform === 'win32' ? 'node.exe' : 'node')
    const program = 'require(process.argv[1]).smoke(process.argv[2], process.argv[3]).catch(e => { console.error(e); process.exitCode = 1 })'
    const result = spawnSync(node, ['-e', program, harness, resources, scratch], {
      cwd: scratch,
      env: {
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, windir: process.env.windir } : {}),
        HOME: scratch, USERPROFILE: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
        PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin',
      },
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error || result.status !== 0)
      throw new Error(`Packaged plugin service failed: exit=${result.status} signal=${result.signal}; ${result.error?.message ?? ''}; evidence=${scratch}`)
    passed = true
  } finally {
    if (passed) await rm(scratch, { recursive: true, force: true })
    else console.error(`[plugin-service-check] retained ${scratch}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the built app Resources directory')
  await checkPackagedPluginService(resolve(process.argv[2]))
}
