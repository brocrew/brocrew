// Standalone plugin packages are outside the root Vitest projects and pnpm workspace.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = path.join(repository, 'plugins')
let failed = false

// Only these fields enter a failure receipt; never copy an exception, path or child output.
function failure(plugin, stage, exitCode, reason) {
  failed = true
  console.error('plugin-failure ' + JSON.stringify({ plugin, stage, exitCode, reason }))
}
function command(plugin, stage, program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, { cwd, env, stdio: 'inherit', timeout: 480_000 })
  if (result.status === 0) return true
  failure(
    plugin,
    stage,
    result.status,
    result.error
      ? result.error.code === 'ETIMEDOUT'
        ? 'timeout'
        : 'spawn'
      : result.signal
        ? 'signal'
        : 'exit',
  )
  return false
}
function goModules(folder) {
  const modules = []
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    if (['node_modules', 'vendor', '.git'].includes(item.name)) continue
    if (item.isSymbolicLink()) throw new Error('Invalid plugin input')
    const full = path.join(folder, item.name)
    if (item.isDirectory()) modules.push(...goModules(full))
    else if (item.name === 'go.mod') modules.push(full)
  }
  return modules.sort()
}
function discover() {
  const plugins = []
  for (const item of fs.readdirSync(pluginRoot, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Invalid plugin input')
    if (!item.isDirectory()) continue
    const folder = path.join(pluginRoot, item.name)
    const config = path.join(folder, 'vitest.config.ts')
    if (!fs.existsSync(config)) continue
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.name) || !fs.lstatSync(config).isFile())
      throw new Error('Invalid plugin input')
    plugins.push({ id: item.name, folder, config, modules: goModules(folder) })
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id))
}
async function check(plugin, scratch, commit) {
  const { id, folder, config, modules } = plugin
  console.log('plugin-start ' + JSON.stringify({ plugin: id }))
  const installed = command(
    id,
    'install',
    'npm',
    ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    folder,
  )
  if (installed) {
    command(
      id,
      'typecheck',
      'pnpm',
      ['exec', 'tsc', '--noEmit', '-p', path.join(folder, 'tsconfig.json')],
      repository,
    )
    let artifactReady = true
    const testEnv = { ...process.env }
    // Chrome's archive and version-agreement tests require a fresh built package.
    if (id === 'chrome') {
      try {
        const { buildChromePackage } = await import(
          pathToFileURL(path.join(folder, 'build.mjs')).href
        )
        const artifact = path.join(scratch, id)
        await buildChromePackage(artifact, commit)
        testEnv.BROCREW_CHROME_TEST_ARTIFACT = artifact
      } catch {
        artifactReady = false
        failure(id, 'archive', null, 'exception')
      }
    }
    if (artifactReady)
      command(
        id,
        'vitest',
        'pnpm',
        ['exec', 'vitest', 'run', '--config', config],
        repository,
        testEnv,
      )
  }
  // Go checks are independent: a JS failure must not hide a broken bridge.
  for (const module of modules) {
    const cwd = path.dirname(module)
    const declared = /^toolchain go(\d+\.\d+\.\d+)\s*$/m.exec(fs.readFileSync(module, 'utf8'))
    if (declared && declared[1] !== process.env.PLUGIN_CI_GO_VERSION) {
      failure(id, 'go-toolchain', null, 'pin')
      continue
    }
    const version = spawnSync('go', ['env', 'GOVERSION'], {
      cwd,
      env: process.env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (version.status !== 0 || version.stdout.trim() !== `go${process.env.PLUGIN_CI_GO_VERSION}`) {
      failure(id, 'go-toolchain', version.status, 'pin')
      continue
    }
    command(id, 'go-vet', 'go', ['vet', './...'], cwd)
    command(id, 'go-test', 'go', ['test', './...'], cwd)
  }
}
async function main() {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.versions.node !== process.env.PLUGIN_CI_NODE_VERSION
  ) {
    failure('all', 'environment', null, 'pin')
    return
  }
  const plugins = discover()
  if (!plugins.length) {
    console.log('plugin-summary ' + JSON.stringify({ plugins: 0, failed: false }))
    return
  }
  const installed = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: repository,
    stdio: 'inherit',
    timeout: 480_000,
  })
  if (installed.status !== 0) {
    for (const { id } of plugins) failure(id, 'workspace-install', installed.status, 'exit')
    return
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim()
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-plugin-ci-'))
  try {
    for (const plugin of plugins) {
      try {
        await check(plugin, scratch, commit)
      } catch {
        failure(plugin.id, 'plugin', null, 'exception')
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  console.log('plugin-summary ' + JSON.stringify({ plugins: plugins.length, failed }))
}
try {
  await main()
} catch {
  failure('all', 'discovery', null, 'exception')
}
process.exitCode = failed ? 1 : 0
