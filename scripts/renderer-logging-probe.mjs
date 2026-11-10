import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'apps/desktop/package.json'))
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const folder = await mkdtemp(join(tmpdir(), 'brocrew-renderer-log-'))
try {
  const main = join(folder, 'main.cjs')
  const renderer = join(folder, 'renderer.js')
  await build({
    absWorkingDir: root,
    entryPoints: ['apps/desktop/test/fixtures/renderer-logging-probe.ts'],
    outfile: main,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    bundle: true,
    external: ['electron'],
  })
  await build({
    absWorkingDir: root,
    entryPoints: ['apps/desktop/src/renderer/src/lib/logging.ts'],
    outfile: renderer,
    platform: 'browser',
    format: 'iife',
    bundle: true,
  })
  const executable = require('electron')
  const args = [main, `--probe-root=${folder}`, `--probe-renderer=${renderer}`]
  const needsDisplay = process.platform === 'linux' && !process.env.DISPLAY
  const child = spawnSync(
    needsDisplay ? 'xvfb-run' : executable,
    needsDisplay ? ['-a', executable, ...args] : args,
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    },
  )
  process.stdout.write(child.stdout || '')
  process.stderr.write(child.stderr || '')
  if (child.error) console.error(child.error)
  process.exitCode = child.status ?? 1
} finally {
  await rm(folder, { recursive: true, force: true })
}
