// No signing material: build the standalone export, then use the app's repo-list verifier.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { command, repository, privateFolder } from './prepare.mjs'
import { digest } from './contract.mjs'
import { phaseStep } from './diagnostics.mjs'
export function listFor(entry) {
  return { format: 1, entries: [entry] }
}
export function releaseBundler(exported) {
  // esbuild belongs to the Chrome package's locked install, not the desktop app.
  return createRequire(path.join(exported, 'plugins/chrome/package.json'))('esbuild')
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
  const script = path.join(exported, 'scripts/release.mjs')
  const before = "execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()"
  const text = fs.readFileSync(script, 'utf8')
  if (text.split(before).length !== 2) throw new Error('Export release anchor changed')
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
  const artifact = path.join(root, 'release')
  await phaseStep(root, 'release-build', () =>
    command(node22, ['scripts/release.mjs', artifact], root, env, exported),
  )
  await phaseStep(root, 'release-tests', () =>
    command(
      node22,
      ['node_modules/vitest/vitest.mjs', 'run', '--config', 'plugins/chrome/vitest.config.ts'],
      root,
      { ...env, BROCREW_CHROME_TEST_ARTIFACT: artifact },
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
  // The exact installed-candidate parser/verifier, without signed-catalogue fixtures or a key.
  const { build } = await phaseStep(root, 'release-verifier-load', () => releaseBundler(exported))
  const proof = path.join(privateFolder(path.join(root, 'proof')), 'verify.cjs')
  await phaseStep(root, 'release-verifier-bundle', () =>
    build({
      stdin: {
        contents: `
import fs from 'node:fs';
import {parseRepoPluginList} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/catalogue/repo-list.ts'))};
import {createRepoAwarePluginVerifier} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/package-verifier.ts'))};
const parsed=parseRepoPluginList(fs.readFileSync(${JSON.stringify(path.join(artifact, 'catalogue.json'))}),{os:'darwin',cpu:'arm64'},'999.0.0');
const trusted=createRepoAwarePluginVerifier({pinnedPublicKey:null,repoCatalogueSha256:parsed.sha256,target:{os:'darwin',cpu:'arm64'}}).verifyCatalogue(parsed.bytes,Buffer.alloc(0));
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
  return commit
}
