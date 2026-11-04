import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { HIDDEN_LAUNCH_ARG } from '../../../scripts/lib/hidden-launch.mjs'
import { bundleAWorker } from './helpers/bundle-a-worker'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('the actual hidden Configure browser can fetch its backend and assets, connect WebSocket and keep tool/invalidation lifetimes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-plugin-ui-backend-'))
  roots.push(root)
  mkdirSync(join(root, 'user-data'))
  const bundle = await bundleAWorker(
    'test/fixtures/plugin-ui-backend.ts',
    join(root, 'main'),
    'backend.cjs',
    { electron: 'electron' },
  )
  await bundleAWorker('src/preload/plugin-ui.ts', join(root, 'preload'), 'plugin-ui.js', {
    electron: 'electron',
  })
  const require = createRequire(import.meta.url)
  const electronRoot = dirname(require.resolve('electron/package.json'))
  const executable = join(
    electronRoot,
    'dist',
    readFileSync(join(electronRoot, 'path.txt'), 'utf8').trim(),
  )
  const { stdout } = await promisify(execFile)(
    executable,
    [
      HIDDEN_LAUNCH_ARG,
      `--user-data-dir=${join(root, 'user-data')}`,
      bundle,
      join(root, 'user-data'),
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  )
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
  expect(result).toEqual({
    fetch: true,
    websocket: true,
    asset: true,
    tools: true,
    invalidation: true,
  })
})
