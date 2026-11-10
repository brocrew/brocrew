import electron from 'electron'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export async function rendererLoggingProbe(launchArgs) {
  const folder = await mkdtemp(join(tmpdir(), 'brocrew-renderer-log-'))
  try {
    const main = join(folder, 'main.cjs')
    const renderer = join(folder, 'renderer.js')
    await build({
      absWorkingDir: root,
      entryPoints: [fileURLToPath(new URL('../smoke/renderer-logging.smoke.ts', import.meta.url))],
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
    const args = [main, ...launchArgs, `--probe-root=${folder}`, `--probe-renderer=${renderer}`]
    const needsDisplay = process.platform === 'linux' && !process.env.DISPLAY
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawnSync(
      needsDisplay ? 'xvfb-run' : electron,
      needsDisplay ? ['-a', electron, ...args] : args,
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        env,
      },
    )
    process.stdout.write(child.stdout || '')
    process.stderr.write(child.stderr || '')
    if (child.error) console.error(child.error)
    process.exitCode = child.status ?? 1
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
