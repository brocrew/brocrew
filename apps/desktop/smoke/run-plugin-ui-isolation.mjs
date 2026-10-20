// Standalone inert Electron probe. Emits counts/booleans only and starts no provider/app entry.
import { build } from 'vite'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(appRoot, 'package.json'))
const root = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-ui-probe-'))
const main = join(root, 'main'),
  preload = join(root, 'preload')
mkdirSync(main, { mode: 0o700 })
mkdirSync(preload, { mode: 0o700 })
async function bundle(entry, outDir, fileName) {
  await build({
    configFile: false,
    root: appRoot,
    logLevel: 'silent',
    plugins: [
      {
        name: 'workspace-source',
        enforce: 'pre',
        resolveId(id) {
          return id.startsWith('@brobot2/') ? require.resolve(id) : null
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      lib: { entry: join(appRoot, entry), formats: ['cjs'], fileName: () => fileName },
      rollupOptions: {
        external: (id) =>
          !id.startsWith('.') &&
          !id.startsWith('/') &&
          !/^[A-Za-z]:[/\\]/.test(id) &&
          !id.startsWith('@brobot2/'),
        output: { paths: (id) => (id === 'electron' ? id : require.resolve(id)) },
      },
    },
  })
}
let stage = 0
let result = { passed: false, assertions: 0 }
try {
  await bundle('src/preload/plugin-ui.ts', preload, 'plugin-ui.js')
  stage = 1
  await bundle('smoke/plugin-ui-isolation.ts', main, 'probe.cjs')
  stage = 2
  const binary = process.env.BROBOT_TEST_ELECTRON_BINARY || require('electron')
  const env = {
    ...process.env,
    BROBOT_PLUGIN_UI_PROBE_ROOT: root,
    BROBOT_TESTS_START_NO_PROGRAM: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const args = [join(main, 'probe.cjs'), '--disable-gpu']
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
  const child = spawn(binary, args, {
    env,
    stdio: 'ignore',
  })
  stage = 3
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      // Exit handles the killed probe and still reads its numeric checkpoint.
    }, 30_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
  stage = 4
  result = JSON.parse(readFileSync(join(root, 'counts.json'), 'utf8'))
  stage = 5
  if (code !== 0) result.passed = false
} catch {
  /* no raw Electron logs, package text or exception bodies are emitted */
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(JSON.stringify({ ...result, runnerStage: stage }) + '\n')
process.exitCode = result.passed ? 0 : 1
