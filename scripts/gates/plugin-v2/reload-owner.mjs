// Dedicated Windows018 main-app reload package; no dispatch/publication capability.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { demand, readFile, hash } from './contract.mjs'
import { stage, observe, owned, bin, inventory } from './owner.mjs'
import { command, cleanup, cancellation } from './processes.mjs'
import { projectReload, RELOAD_MARKER, RELOAD_CHANNEL } from './reload-projection.mjs'
import { reloadJourney } from './reload-journey.mjs'
import { projectedVersionArguments } from './staging.mjs'
import { verifyRuntimeSource } from './runtime-source-binding.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'

const route = path.dirname(fileURLToPath(import.meta.url))
const readJSON = (p) => JSON.parse(readFile(p))
function printReloadFailure(error, records, phase, result) {
  console.error(`Reload failure during ${phase}:`, error?.message ?? String(error))
  console.error(error?.stack ?? String(error))
  console.error(
    'Reload witnesses:',
    JSON.stringify({
      seen: {
        bundle: result.bundle,
        packageSha256: result.packageSha256,
        normalSourceRefused: result.normalSourceRefused,
        normalOutputRefused: result.normalOutputRefused,
        journey: result.journey,
        cleanup: result.cleanup,
      },
      expected: {
        bundle: 'main/preload hashes and controlledSdkRefusal=true',
        packageSha256: 'inventory hash matching the unchanged packaged app',
        normalSourceRefused: true,
        normalOutputRefused: true,
        journey: { nativeDatabaseClosed: true, nativeAppClosed: true },
        cleanup: { directClosed: true, twoEmptySamples: true },
      },
    }),
  )
  for (const record of records.filter(
    (r, i) => i >= records.length - 3 || !r.closed || r.code !== 0 || r.signal !== null,
  )) {
    console.error(
      `Child exit code: ${record.code}; signal: ${record.signal}; closed: ${record.closed}`,
    )
    const tails = record.tails()
    console.error('Child stdout tail:')
    console.error(tails.stdout)
    console.error('Child stderr tail:')
    console.error(tails.stderr)
  }
}
export async function stageReload() {
  demand(process.platform === 'win32' && process.arch === 'x64')
  return stage('0.1.8')
}
function reloadBundle(repo) {
  const directory = path.join(repo, 'apps/desktop/out/main')
  const chunks = fs
    .readdirSync(directory)
    .filter((name) => /^[A-Za-z0-9_.-]+\.js$/.test(name))
    .sort()
    .map((name) => ({ name, bytes: readFile(path.join(directory, name)) }))
  demand(chunks.some(({ name }) => name === 'index.js'))
  const main = chunks.find(({ name }) => name === 'index.js').bytes
  const controlledSdkRefusal = chunks.some(({ bytes }) =>
    bytes.includes(Buffer.from('Reload fixture refuses the default SDK query')),
  )
  const mainChunks = chunks.map(({ name, bytes }) => ({ name, sha256: hash(bytes) }))
  const preload = readFile(path.join(repo, 'apps/desktop/out/preload/index.js'))
  console.error(
    'Reload bundle witnesses:',
    JSON.stringify({
      seen: {
        mainMarker: main.includes(Buffer.from(RELOAD_MARKER)),
        mainChannel: main.includes(Buffer.from(RELOAD_CHANNEL)),
        controlledSdkRefusal,
        mainChunks,
        preloadBridge: preload.includes(Buffer.from('__pluginReloadGate')),
        preloadChannel: preload.includes(Buffer.from(RELOAD_CHANNEL)),
      },
      expected: {
        mainMarker: true,
        mainChannel: true,
        controlledSdkRefusal: true,
        preloadBridge: true,
        preloadChannel: true,
      },
    }),
  )
  demand(main.includes(Buffer.from(RELOAD_MARKER)) && main.includes(Buffer.from(RELOAD_CHANNEL)))
  demand(controlledSdkRefusal)
  demand(
    preload.includes(Buffer.from('__pluginReloadGate')) &&
      preload.includes(Buffer.from(RELOAD_CHANNEL)),
  )
  return { mainSha256: hash(main), preloadSha256: hash(preload), controlledSdkRefusal, mainChunks }
}
async function packageBinding(repo, app, bundle) {
  const req = createRequire(path.join(repo, 'apps/desktop/package.json'))
  const asar = await import(
    pathToFileURL(req.resolve('@electron/asar', { paths: [req.resolve('electron-builder')] })).href
  )
  const extract = asar.extractFile ?? asar.default?.extractFile
  demand(typeof extract === 'function')
  const archive = path.join(app, 'resources/app.asar')
  demand(JSON.parse(extract(archive, 'package.json')).version === '0.1.8')
  demand(hash(extract(archive, path.join('out', 'main', 'index.js'))) === bundle.mainSha256)
  demand(hash(extract(archive, path.join('out', 'preload', 'index.js'))) === bundle.preloadSha256)
  for (const chunk of bundle.mainChunks)
    demand(hash(extract(archive, path.join('out', 'main', chunk.name))) === chunk.sha256)
  console.error('Reload packaged main chunks bound:', JSON.stringify(bundle.mainChunks))
  return inventory(app)
}
export async function runReload(root) {
  demand(
    process.platform === 'win32' &&
      process.arch === 'x64' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  owned(root)
  const records = [],
    cancel = cancellation(records),
    repo = path.join(root, 'repo'),
    desktop = path.join(repo, 'apps/desktop')
  const result = {
    schema: 1,
    scope: 'controlled-main-app-reload',
    passed: false,
    publicBinary: false,
    publication: false,
    observedIdentity: null,
    moduleSource: null,
    bundle: null,
    packageSha256: null,
    journey: null,
    normalSourceRefused: false,
    normalOutputRefused: false,
    cleanup: { directClosed: false, twoEmptySamples: false },
    realSdk: null,
    final018Qualification: null,
  }
  let projected,
    phase = 'observe-source'
  try {
    const held = readJSON(path.join(root, 'observed-source.json'))
    const observed = await observe('0.1.8', records, root)
    demand(
      held.appVersion === '0.1.8' &&
        held.appSource === held.routeCommit &&
        JSON.stringify(held) === JSON.stringify(observed),
    )
    demand(readFile(path.join(root, 'staged'), 64).toString() === hash(JSON.stringify(observed)))
    demand(
      readFile(path.join(root, 'dependencies-installed'), 64).toString() ===
        'held-fictional-child-closed',
    )
    result.observedIdentity = observed
    result.runtimeSourcePinsSha256 = verifyRuntimeSource(
      repo,
      readJSON(path.join(route, 'runtime-source-pins.json')),
    )
    const input = readJSON(path.join(route, 'reload-inputs.json'))
    demand(
      input.sourceCommit === 'cbdf3e75fd786b5c19cfc519c25007b37a026b34' &&
        input.manifestSha256 === '2e3df1e097b1178d3963a1ba9809a557081da363cd50701e2b8440cd693331b4',
    )
    demand(input.modulePinsSha256 === hash(JSON.stringify(input.modules)))
    const modules = input.modules.map((m) => ({
      ...m,
      source: path.join(route, 'reload-source', m.name),
    }))
    result.moduleSource = {
      commit: input.sourceCommit,
      tree: input.sourceTree,
      manifestSha256: input.manifestSha256,
      files: modules.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    }
    checkNormalPluginBuild(repo)
    const appData = path.join(root, 'a')
    fs.mkdirSync(appData, { mode: 0o700 })
    projected = projectReload(repo, {
      root,
      token: readFile(path.join(root, 'gate-token'), 64).toString(),
      appData,
      browser: path.join(root, 'no-browser.exe'),
      modules,
    })
    let refused = false
    try {
      checkNormalPluginBuild(repo)
    } catch {
      refused = true
    }
    demand(refused)
    result.normalSourceRefused = true
    phase = 'prepare-plugin-node'
    await command(process.execPath, ['scripts/prepare-plugin-node.mjs'], root, records, {
      cwd: repo,
    })
    phase = 'electron-vite-build'
    await command(process.execPath, [bin(repo, 'electron-vite'), 'build'], root, records, {
      cwd: desktop,
    })
    phase = 'electron-builder-package'
    await command(
      process.execPath,
      [
        bin(repo, 'electron-builder'),
        '--win',
        '--x64',
        '--dir',
        '--config',
        'electron-builder.yml',
        '--publish',
        'never',
        ...projectedVersionArguments('0.1.8'),
      ],
      root,
      records,
      { cwd: desktop, ms: 900000 },
    )
    phase = 'reload-bundle-witness'
    result.bundle = reloadBundle(repo)
    const app = path.join(desktop, 'dist/win-unpacked')
    phase = 'package-binding'
    result.packageSha256 = await packageBinding(repo, app, result.bundle)
    phase = 'restore-normal-source'
    projected.restore()
    projected = undefined
    refused = false
    try {
      checkNormalPluginBuild(repo)
    } catch {
      refused = true
    }
    demand(refused)
    result.normalOutputRefused = true
    phase = 'native-reload-journey'
    result.journey = await reloadJourney({ root, app, records })
    phase = 'unchanged-package-inventory'
    demand(inventory(app) === result.packageSha256)
  } catch (error) {
    result.error = { phase, message: error?.message ?? String(error), stack: error?.stack ?? null }
    printReloadFailure(error, records, phase, result)
    result.failure = 'required-reload-witness-missing'
  } finally {
    try {
      projected?.restore()
    } catch (error) {
      printReloadFailure(error, records, 'cleanup-source-restore', result)
      result.failure = 'reload-source-restore-failed'
    }
    try {
      result.cleanup = await cleanup(root, records)
    } catch (error) {
      printReloadFailure(error, records, 'cleanup-processes', result)
      result.cleanup = { directClosed: false, twoEmptySamples: false }
    }
    if (cancel.cancelled) result.failure = 'cancelled'
    cancel.close()
    result.passed =
      !result.failure &&
      result.packageSha256 !== null &&
      result.normalSourceRefused &&
      result.normalOutputRefused &&
      result.journey?.nativeDatabaseClosed === true &&
      result.journey?.nativeAppClosed === true &&
      result.cleanup.directClosed === true &&
      result.cleanup.twoEmptySamples === true
    fs.writeFileSync(path.join(root, 'reload-summary.json'), JSON.stringify(result, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
  }
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2)
  if (mode === 'stage')
    stageReload().then(
      (root) => console.log(root),
      (error) => {
        console.error('Reload stage refused')
        console.error(error?.stack ?? String(error))
        process.exitCode = 1
      },
    )
  else if (mode === 'run')
    runReload(arg).then(
      (r) => {
        process.exitCode = r.passed ? 0 : 1
      },
      (error) => {
        console.error('Reload run refused')
        console.error(error?.stack ?? String(error))
        process.exitCode = 1
      },
    )
  else
    console.log(
      JSON.stringify({
        execution: false,
        publication: false,
        required: 'exact reviewed hosted Windows018 operation',
      }),
    )
}
