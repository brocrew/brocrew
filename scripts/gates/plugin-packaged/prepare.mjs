import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'
import { theVariablesFor } from '../../lib/tests-run-in-a-fictional-home.mjs'
import {
  failureError,
  failureFor,
  printFailure,
  outputClass,
  builderOutputClass,
  phaseStep,
} from './diagnostics.mjs'
import { directoryPackageArguments, hostedBuilder } from './packaging.mjs'
import { integrityCheckpoint } from './integrity.mjs'
import { requireDrained } from './processes.mjs'
import { requireCI, ownedRoot, projectBuild, loopbackSandbox, report } from './contract.mjs'
import { hostedSystemEnvironment } from './environment.mjs'
const exec = promisify(execFile)
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export function privateFolder(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  fs.chmodSync(folder, 0o700)
  return folder
}
export function fixtureEnvironment(root, extra = {}, runtime = process.execPath) {
  const home = privateFolder(path.join(root, 'home'))
  return {
    ...hostedSystemEnvironment(),
    ...theVariablesFor(home),
    PATH: `${privateFolder(path.join(root, 'bin'))}:${path.dirname(runtime)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: privateFolder(path.join(root, 'tmp')),
    TMP: path.join(root, 'tmp'),
    TEMP: path.join(root, 'tmp'),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    npm_config_userconfig: path.join(root, 'npm-user'),
    npm_config_globalconfig: path.join(root, 'npm-global'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'pnpm-store'),
    CI: 'true',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    ELECTRON_CACHE: path.join(root, 'electron-cache'),
    ELECTRON_BUILDER_CACHE: path.join(root, 'builder-cache'),
    ...extra,
  }
}
export function fixtureAppEnvironment(root, app) {
  // Matrix and journey run on different Node binaries; their app PATH must still be identical.
  return fixtureEnvironment(root, {}, path.join(app, 'Contents/Resources/plugin-node/node'))
}
export function buildEnvironment(root, pnpm) {
  if (!path.isAbsolute(pnpm)) throw new Error('Declared package manager required')
  return {
    PATH: `${fixtureEnvironment(root).PATH}:${path.dirname(pnpm)}`,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
}
export async function command(
  program,
  args,
  root,
  extra = {},
  cwd = repository,
  phase = 'prepare',
) {
  // Diagnostics can include provider input: callers only receive a fixed error, never stdout/stderr.
  try {
    return (
      await exec(program, args, {
        cwd,
        env: fixtureEnvironment(root, extra),
        timeout: 420_000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout
  } catch (error) {
    const text = String(error.stdout ?? '') + String(error.stderr ?? '')
    const packaging = phase === 'app-package' ? builderOutputClass(text) : 'unknown'
    throw failureError(phase, error, packaging === 'unknown' ? outputClass(text) : packaging)
  }
}
export async function prepare(root, { node22, pnpm }) {
  requireCI()
  return prepareBuild(root, { node22, pnpm })
}
// Reuse the release's exact locked install. The workspace intentionally does not install Chrome.
export function stageProtocolDependencies(root) {
  ownedRoot(root)
  const source = path.join(root, 'chrome-source/plugins/chrome/node_modules')
  const target = path.join(root, 'repo/plugins/chrome/node_modules')
  if (
    fs.existsSync(target) ||
    !fs.lstatSync(source).isDirectory() ||
    fs.lstatSync(source).isSymbolicLink()
  )
    throw new Error('Invalid protocol dependency staging')
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  })
  const declared = JSON.parse(fs.readFileSync(path.join(root, 'repo/plugins/chrome/package.json')))
    .dependencies['playwright-core']
  const installed = JSON.parse(
    fs.readFileSync(path.join(target, 'playwright-core/package.json')),
  ).version
  if (installed !== declared) throw new Error('Protocol dependency pin differs')
  return target
}
// Build-only rehearsal seam: no account, GUI, journey or provider entry is reachable here.
export async function prepareBuild(root, { node22, pnpm }) {
  ownedRoot(root)
  if (repository !== path.join(root, 'repo')) throw new Error('Isolated scratch checkout required')
  checkNormalPluginBuild(repository)
  const configPath = path.join(
    repository,
    'apps/desktop/src/main/plugins/catalogue/build-config.ts',
  )
  const entryPath = path.join(repository, 'apps/desktop/src/main/index.ts')
  const original = {
    config: fs.readFileSync(configPath, 'utf8'),
    entry: fs.readFileSync(entryPath, 'utf8'),
  }
  const appData = privateFolder(path.join(root, 'a'))
  const buildEnv = buildEnvironment(root, pnpm)
  const { buildFixtureRelease } = await import('./release.mjs')
  const commit = await phaseStep(root, 'release-export', () => buildFixtureRelease(root, node22))
  await phaseStep(root, 'cdp-fixture-dependencies', () => stageProtocolDependencies(root))
  const browser = path.join(root, 'fake-browser')
  const bin = privateFolder(path.join(root, 'bin'))
  fs.writeFileSync(path.join(bin, 'security'), '#!/usr/bin/false\n', { mode: 0o700 })
  const app = path.join(repository, 'apps/desktop/dist/mac-arm64/BroCrew.app')
  let bundleStamp
  const projection = projectBuild(original.config, original.entry, appData, browser)
  try {
    fs.writeFileSync(configPath, projection.config)
    fs.writeFileSync(entryPath, projection.entry)
    // This is the sole private projection build. Normal package commands have no bypass flag.
    await phaseStep(root, 'node-prepare', () =>
      command(process.execPath, ['scripts/prepare-plugin-node.mjs'], root),
    )
    await phaseStep(root, 'app-build', () =>
      command(
        pnpm,
        ['--filter', '@brobot2/desktop', 'exec', 'electron-vite', 'build'],
        root,
        buildEnv,
      ),
    )
    await phaseStep(root, 'app-package', () =>
      hostedBuilder(() =>
        command(pnpm, directoryPackageArguments(), root, buildEnv, repository, 'app-package'),
      ),
    )
    bundleStamp = await phaseStep(root, 'app-integrity', () =>
      integrityCheckpoint(root, app, 'afterPackage'),
    )
  } finally {
    fs.writeFileSync(configPath, original.config)
    fs.writeFileSync(entryPath, original.entry)
    checkNormalPluginBuild(repository)
  }
  await phaseStep(root, 'app-integrity', () =>
    integrityCheckpoint(root, app, 'afterSourceRestore', bundleStamp),
  )
  await phaseStep(root, 'app-signature', async () => {
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], root)
  })
  await phaseStep(root, 'app-integrity', () =>
    integrityCheckpoint(root, app, 'afterVerification', bundleStamp),
  )
  // Only a Node protocol fixture is executable; it has no Chrome or external page fallback.
  const runtime = path.join(app, 'Contents/Resources/plugin-node/node')
  fs.writeFileSync(
    browser,
    `#!${runtime}\nimport {runBrowser} from ${JSON.stringify(pathToFileURL(path.join(repository, 'scripts/gates/plugin-packaged/fake-browser.mjs')).href)};runBrowser(${JSON.stringify(root)});\n`,
    { mode: 0o700 },
  )
  fs.writeFileSync(path.join(root, 'sandbox.sb'), loopbackSandbox, { mode: 0o600 })
  fs.writeFileSync(
    path.join(root, 'plan.json'),
    JSON.stringify({ app, appData, browser, commit, bundleStamp, argv: [HIDDEN_LAUNCH_ARG] }),
    {
      mode: 0o600,
    },
  )
  await phaseStep(root, 'app-integrity', () =>
    integrityCheckpoint(root, app, 'afterFixtureWrite', bundleStamp),
  )
}
export function removeFixture(root, receipt, current) {
  ownedRoot(root)
  requireDrained(receipt, current)
  const visit = (folder) => {
    const info = fs.lstatSync(folder)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid())
      throw new Error('Invalid scratch cleanup directory')
    fs.chmodSync(folder, 0o700)
    for (const name of fs.readdirSync(folder)) {
      const child = path.join(folder, name),
        stat = fs.lstatSync(child)
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(child)
    }
  }
  visit(root)
  fs.rmSync(root, { recursive: true, force: false })
}
async function main() {
  requireCI()
  const [action, root, node22, pnpm] = process.argv.slice(2)
  if (action === 'init') {
    const scratch = fs.realpathSync(fs.mkdtempSync('/private/tmp/fpg-'))
    fs.chmodSync(scratch, 0o700)
    fs.writeFileSync(path.join(scratch, 'fixture-owned'), 'packaged-plugin-gate\n', { mode: 0o600 })
    fs.writeFileSync(path.join(scratch, 'summary.json'), JSON.stringify(report()), { mode: 0o600 })
    for (const name of ['npm-user', 'npm-global', 'gitconfig'])
      fs.writeFileSync(path.join(scratch, name), '', { mode: 0o600 })
    fs.appendFileSync(process.env.GITHUB_ENV, `PLUGIN_GATE_ROOT=${scratch}\n`)
  } else if (action === 'build') await prepare(ownedRoot(root), { node22, pnpm })
  else if (action === 'clean')
    throw new Error('Use the independent owner to drain before removing roots')
  else throw new Error('Unknown gate preparation')
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    printFailure(failureFor('prepare', error))
    process.exitCode = 1
  })
