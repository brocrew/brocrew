// No signing material: build the standalone export, then use the app's repo-list verifier.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { command, repository, privateFolder } from './fixture-command.mjs'
import { digest } from './contract.mjs'
import { phaseStep } from './diagnostics.mjs'
export function listFor(entry) {
  return { format: entry.authors === undefined ? 1 : 2, entries: [entry] }
}
export function projectFixtureManifest(source) {
  const manifest = JSON.parse(source)
  manifest.format = 1
  for (const field of ['authors', 'executor', 'hooks', 'sharedData']) delete manifest[field]
  manifest.hostApi.requiredFeatures = manifest.hostApi.requiredFeatures.filter(
    (feature) => feature !== 'shared-data-v1',
  )
  return JSON.stringify(manifest) + '\n'
}
export function releaseBundler(exported) {
  // esbuild belongs to the Chrome package's locked install, not the desktop app.
  return createRequire(path.join(exported, 'plugins/chrome/package.json'))('esbuild')
}
export function projectChromeFixture(source, browser) {
  return `process.env.BROCREW_CHROME_EXECUTABLE = ${JSON.stringify(browser)};\n${source}`
}
export async function buildFixtureRelease(root, node22) {
  const commit = (await command('/usr/bin/git', ['rev-parse', 'HEAD'], root)).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid reviewed commit')
  if (!(await command(node22, ['--version'], root)).trim().startsWith('v22.'))
    throw new Error('Node 22 required')
  const checkout = path.join(root, 'release-checkout')
  await command(
    '/usr/bin/git',
    ['clone', '--shared', '--no-checkout', '--template=', repository, checkout],
    root,
  )
  await command(
    '/usr/bin/git',
    ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commit],
    root,
    {},
    checkout,
  )
  const exported = path.join(root, 'chrome-source')
  await command(node22, ['scripts/export-chrome-plugin.mjs', exported], root, {}, checkout)
  // A history-free export has no .git. Bind the generated release script to the reviewed app SHA.
  const script = path.join(exported, 'scripts/build-plugin-release.mjs')
  const before =
    /execFileSync\('git', \['-C', root, 'rev-parse', 'HEAD'\], \{\s*encoding: 'utf8',?\s*\}\)\.trim\(\)/g
  const text = fs.readFileSync(script, 'utf8')
  if (text.match(before)?.length !== 1) throw new Error('Export release anchor changed')
  fs.writeFileSync(script, text.replace(before, JSON.stringify(commit)))
  const npm = path.resolve(path.dirname(node22), '../lib/node_modules/npm/bin/npm-cli.js')
  const env = { PATH: `${path.dirname(node22)}:/usr/bin:/bin` }
  await phaseStep(root, 'release-root-install', () =>
    command(
      node22,
      [npm, 'ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'],
      root,
      env,
      exported,
    ),
  )
  await phaseStep(root, 'release-plugin-install', () =>
    command(
      node22,
      [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      root,
      env,
      path.join(exported, 'plugins/chrome'),
    ),
  )
  // Verify the unmodified export first; only the separate scratch release uses the v1 fixture.
  for (const fixture of [false, true]) {
    if (fixture) {
      const server = path.join(exported, 'plugins/chrome/src/index.ts')
      fs.writeFileSync(
        server,
        projectChromeFixture(fs.readFileSync(server, 'utf8'), path.join(root, 'fake-browser')),
      )
      const manifest = path.join(exported, 'plugins/chrome/manifest-template.json')
      fs.writeFileSync(manifest, projectFixtureManifest(fs.readFileSync(manifest, 'utf8')))
    }
    const artifact = path.join(root, fixture ? 'release' : 'release-original')
    await phaseStep(root, 'release-build', () =>
      command(
        node22,
        ['scripts/build-plugin-release.mjs', 'chrome', artifact],
        root,
        env,
        exported,
      ),
    )
    await phaseStep(root, 'release-tests', () =>
      command(
        node22,
        ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.release.config.mts'],
        root,
        { ...env, BROCREW_CHROME_TEST_ARTIFACT: artifact, BROCREW_PLUGIN_SOURCE_COMMIT: commit },
        exported,
      ),
    )
    const entry = JSON.parse(fs.readFileSync(path.join(artifact, 'plugin-list-entry.json')))
    const archive = fs.readFileSync(path.join(artifact, 'chrome-darwin-arm64.tar.gz'))
    if (
      entry.sourceCommit !== commit ||
      entry.targets[0].sha256 !== digest(archive) ||
      entry.targets[0].bytes !== archive.length
    )
      throw new Error('Archive pins differ')
    fs.writeFileSync(path.join(artifact, 'catalogue.json'), JSON.stringify(listFor(entry)), {
      mode: 0o600,
      flag: 'wx',
    })
    // The exact installed-candidate catalogue parser and package verifier.
    const { build } = await phaseStep(root, 'release-verifier-load', () => releaseBundler(exported))
    const proof = path.join(
      privateFolder(path.join(root, 'proof')),
      fixture ? 'verify-fixture.cjs' : 'verify-original.cjs',
    )
    await phaseStep(root, 'release-verifier-bundle', () =>
      build({
        stdin: {
          contents: `
  import fs from 'node:fs';
  import {parseRepoPluginList} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/catalogue/repo-list.ts'))};
  import {createRepoAwarePluginVerifier} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/package-verifier.ts'))};
  const parsed=parseRepoPluginList(fs.readFileSync(${JSON.stringify(path.join(artifact, 'catalogue.json'))}),{os:'darwin',cpu:'arm64'},'999.0.0');
  const trusted=createRepoAwarePluginVerifier({target:{os:'darwin',cpu:'arm64'}}).verifyCatalogue(parsed.bytes);
  trusted.verifyPackage('chrome',${JSON.stringify(entry.version)},fs.readFileSync(${JSON.stringify(path.join(artifact, 'chrome-darwin-arm64.tar.gz'))}));
  `,
          resolveDir: repository,
          loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: proof,
        logLevel: 'silent',
      }),
    )
    await phaseStep(root, 'release-verify', () => command(node22, [proof], root, env))
  }
  return commit
}
