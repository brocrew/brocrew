// Explicit opt-in component witness. `prepare` may download; `run` never builds/installs/downloads.
import assert from 'node:assert/strict'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile, lstat, copyFile, realpath } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPluginSupervisor } from './build-plugin-supervisor.mjs'
import { preparePluginNode, NODE_VERSION, NODE_TARGETS } from './prepare-plugin-node.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(join(root, 'apps/desktop/package.json'))
const exec = promisify(childProcess.execFile)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const save = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
async function inventory(directory, prefix = '') {
  const result = {}
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name),
      name = prefix ? `${prefix}/${entry.name}` : entry.name
    const stat = await lstat(path)
    assert.equal(stat.isSymbolicLink(), false, `Resource link forbidden: ${name}`)
    if (stat.isDirectory()) Object.assign(result, await inventory(path, name))
    else {
      assert.equal(stat.isFile(), true)
      result[name] = { sha256: sha(await readFile(path)), bytes: stat.size }
    }
  }
  return result
}
async function copyTree(from, to) {
  await mkdir(to, { mode: 0o700 })
  for (const name of Object.keys(await inventory(from))) {
    await mkdir(dirname(join(to, name)), { recursive: true, mode: 0o700 })
    await copyFile(join(from, name), join(to, name))
  }
}
async function git(...args) {
  return (await exec('git', ['-C', root, ...args])).stdout.trim()
}
function host() {
  const name = `${process.platform}-${process.arch}`
  if (!NODE_TARGETS[name])
    throw new Error(
      `Unsupported shipped target ${name}; supported runtime targets: darwin-arm64, win32-x64. Linux cannot qualify this witness.`,
    )
  if (name !== 'darwin-arm64')
    throw new Error(
      'win32-x64 runtime is shipped, but this source tip has a POSIX-only supervisor fence; Windows witness remains UNRUN.',
    )
  return name
}
async function checkRuntime(resources, target) {
  const expected = NODE_TARGETS[target],
    file = join(resources, 'plugin-node', expected.file)
  let metadata, bytes
  try {
    metadata = await json(join(resources, 'plugin-node/runtime.json'))
    bytes = await readFile(file)
  } catch (error) {
    throw new Error(
      'Missing prepared shipped Node 24.22.0. Run the explicit prepare command first; run never downloads or falls back to system Node.',
      { cause: error },
    )
  }
  assert.equal(metadata.version, NODE_VERSION, 'Wrong shipped runtime version')
  assert.equal(metadata.platform, expected.platform)
  assert.equal(metadata.arch, expected.arch)
  assert.equal(metadata.sha256, expected.binarySha256)
  assert.equal(sha(bytes), expected.binarySha256, 'Wrong shipped runtime bytes')
  assert.equal(
    (await exec(file, ['--version'], { env: { PATH: '/usr/bin:/bin' } })).stdout.trim(),
    `v${NODE_VERSION}`,
  )
  return file
}
const [mode, named, expectedSha] = process.argv.slice(2)
assert.ok(
  ['prepare', 'run'].includes(mode) && named,
  'Usage: node scripts/frozen-supervisor-witness.mjs prepare NEW_ABSOLUTE_DIR EXACT_SHA | run PREPARED_ABSOLUTE_DIR',
)
assert.equal(named, resolve(named), 'Supply an absolute output path')
const out = resolve(named),
  target = host()
if (mode === 'prepare') {
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/)
  assert.equal(await git('rev-parse', 'HEAD'), expectedSha, 'Wrong source SHA')
  assert.equal(
    await git('status', '--porcelain'),
    '',
    'Prepare requires a clean exact source checkout',
  )
  // No replacement: a second prepare cannot silently rebuild an existing witness.
  await mkdir(out, { mode: 0o700 })
  const resources = join(out, 'resources')
  await mkdir(resources, { mode: 0o700 })
  await copyTree(join(root, 'apps/desktop/resources/plugin-host'), join(resources, 'plugin-host'))
  // Explicit network-capable setup only. Production pinned archive and binary validation.
  await preparePluginNode(join(resources, 'plugin-node'), fetch, target)
  await checkRuntime(resources, target)
  await mkdir(join(resources, 'plugin-supervisor'))
  // The ACTUAL packaging build, called exactly once for this fresh directory.
  await buildPluginSupervisor(join(resources, 'plugin-supervisor/entry.cjs'))
  const { build, version: esbuildVersion } = req(
    req.resolve('esbuild', { paths: [req.resolve('vite')] }),
  )
  const driver = join(out, 'app-source-driver.cjs')
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: [join(root, 'apps/desktop/smoke/frozen-supervisor-witness.ts')],
    outfile: driver,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    metafile: true,
    plugins: [
      {
        name: 'source-driver-boundary',
        setup(builder) {
          builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            path: join(root, 'apps/desktop/src/main/plugins/supervisor/sqlite-adapter.ts'),
          }))
          // The source Settings card validator is exercised; mounting Electron is forbidden here.
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron-forbidden',
            namespace: 'witness',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'witness' }, () => ({
            contents: `export class WebContentsView { constructor(){ throw new Error('Electron mounting is outside this witness'); } } export const session = new Proxy({}, {get(){throw new Error('Electron session is outside this witness')}});`,
          }))
        },
      },
    ],
  })
  // Guard against accidentally replacing the frozen owner with a source owner in the driver.
  assert.equal(
    Object.keys(bundled.metafile.inputs).some((path) =>
      /plugins\/supervisor\/(owner|entry)\.ts$/.test(path),
    ),
    false,
  )
  await save(join(out, 'app-source-inputs.json'), bundled.metafile)
  const refs = await req(driver).packages(join(out, 'packages'), expectedSha)
  // A preload inherited by the owner and managed runtimes makes unexpected network calls fail.
  await writeFile(
    join(out, 'network-forbidden.mjs'),
    `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; import {syncBuiltinESMExports} from 'node:module';
const refuse=()=>{throw new Error('frozen-witness-network-forbidden')};globalThis.fetch=refuse;
http.request=http.get=https.request=https.get=tls.connect=refuse;
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0][0]:args[0];const ok=typeof a==='string'?a.startsWith('/'):(a&&typeof a==='object'&&typeof a.path==='string');if(!ok)return refuse();return connect.apply(this,args)};syncBuiltinESMExports();
`,
    { flag: 'wx', mode: 0o600 },
  )
  const frozen = await inventory(out)
  await save(join(out, 'prepared.json'), {
    format: 1,
    sourceSha: expectedSha,
    sourceTree: await git('rev-parse', 'HEAD^{tree}'),
    lockfileSha256: sha(await readFile(join(root, 'pnpm-lock.yaml'))),
    esbuildVersion,
    target,
    nodeVersion: NODE_VERSION,
    supervisorBuildCalls: 1,
    refs,
    frozen,
  })
  console.log(`Prepared once: ${out}. Runtime witness remains UNRUN.`)
} else {
  // Every run is independently retained and uses the exact once-prepared bytes.
  const plan = await json(join(out, 'prepared.json'))
  assert.equal(plan.target, target)
  assert.equal(
    await git('rev-parse', 'HEAD'),
    plan.sourceSha,
    'Run from the prepared exact source SHA',
  )
  const resources = join(out, 'resources')
  await checkRuntime(resources, target)
  const before = await inventory(out)
  for (const [name, value] of Object.entries(plan.frozen))
    assert.deepEqual(before[name], value, `Frozen input changed: ${name}`)
  const runRoot = await realpath(await (await import('node:fs/promises')).mkdtemp('/tmp/fl-'))
  const evidence = join(out, `run-${runRoot.split('/').at(-1)}`)
  await mkdir(evidence, { mode: 0o700 })
  const spawns = [],
    originalSpawn = childProcess.spawn,
    priorNodeOptions = process.env.NODE_OPTIONS
  // Never inject unreviewed ambient preload or inspector flags into the witness.
  assert.ok(!priorNodeOptions, 'Unset NODE_OPTIONS before running this witness')
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(join(out, 'network-forbidden.mjs')).href}`
  childProcess.spawn = function (command, argv, opts) {
    const child = originalSpawn(command, argv, opts)
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    )
    spawns.push({ command, argv: [...argv], child, exited })
    return child
  }
  syncBuiltinESMExports()
  let answer
  try {
    // Apply the same no-network policy to the app-side driver, not just its child.
    await import(pathToFileURL(join(out, 'network-forbidden.mjs')).href)
    answer = await req(join(out, 'app-source-driver.cjs')).witness({
      root: runRoot,
      resources,
      refs: plan.refs,
      spawns,
      entryHash: plan.frozen['resources/plugin-supervisor/entry.cjs'].sha256,
    })
    // Durable runtime and entry copies must match every shipped resource byte.
    const runtime = await readdir(join(runRoot, 'p/runtimes'))
    assert.equal(runtime.length, 1)
    const runtimeFiles = await inventory(join(runRoot, 'p/runtimes', runtime[0]))
    for (const [name, value] of Object.entries(plan.frozen)) {
      if (name.startsWith('resources/plugin-node/') || name.startsWith('resources/plugin-host/')) {
        assert.deepEqual(
          runtimeFiles[name.replace(/^resources\/plugin-(node|host)\//, '')],
          value,
          `Durable runtime resource changed: ${name}`,
        )
      }
    }
    for (const record of spawns) {
      assert.equal(
        record.command,
        join(runRoot, 'p/runtimes', runtime[0], NODE_TARGETS[target].file),
      )
      assert.equal(
        sha(await readFile(record.argv[0])),
        plan.frozen['resources/plugin-supervisor/entry.cjs'].sha256,
      )
    }
    const after = await inventory(out)
    for (const [name, value] of Object.entries(plan.frozen))
      assert.deepEqual(after[name], value, `Prepared artifact changed after operations: ${name}`)
    answer = {
      ...answer,
      sourceSha: plan.sourceSha,
      sourceTree: plan.sourceTree,
      runtimeId: runtime[0],
      runtimeVersion: NODE_VERSION,
      frozen: plan.frozen,
      spawnArgv: spawns.map(({ command, argv, child }) => ({ command, argv, pid: child.pid })),
      fictionalRoot: runRoot,
    }
    await save(join(evidence, 'result.json'), answer)
    console.log(JSON.stringify({ passed: true, evidence, fictionalRoot: runRoot }))
  } catch (error) {
    await save(join(evidence, 'failure.json'), {
      passed: false,
      sourceSha: plan.sourceSha,
      fictionalRoot: runRoot,
      error: String(error?.stack ?? error),
      causes: String(error?.cause?.stack ?? error?.cause ?? ''),
      capturedOwners: spawns.map(({ child }) => ({
        pid: child.pid,
        exitCode: child.exitCode,
        signal: child.signalCode,
      })),
    })
    throw error
  } finally {
    childProcess.spawn = originalSpawn
    if (priorNodeOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = priorNodeOptions
    syncBuiltinESMExports()
  }
}
