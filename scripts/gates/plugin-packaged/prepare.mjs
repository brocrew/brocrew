import { repository, privateFolder, buildEnvironment, command } from './fixture-command.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { failureFor, printFailure, phaseStep } from './diagnostics.mjs'
import { directoryPackageArguments, hostedBuilder } from './packaging.mjs'
import { requireDrained } from './processes.mjs'
import { projectBuild, loopbackSandbox, report } from './contract.mjs'
import { requireCI, ownedRoot } from './fixture-guards.mjs'
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
  } finally {
    fs.writeFileSync(configPath, original.config)
    fs.writeFileSync(entryPath, original.entry)
  }
  await phaseStep(root, 'app-signature', async () => {
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], root)
  })
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
    JSON.stringify({ app, appData, browser, commit, argv: [HIDDEN_LAUNCH_ARG] }),
    {
      mode: 0o600,
    },
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
