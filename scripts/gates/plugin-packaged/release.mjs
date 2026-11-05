// No signing material: use the current producer and the app's ordinary repo-list verifier.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { command, repository, privateFolder } from './prepare.mjs'
import { digest } from './contract.mjs'
import { phaseStep } from './diagnostics.mjs'
import { verifyPluginSource } from '../../plugin-source.mjs'
export function listFor(entry) {
  return { format: 3, entries: [entry] }
}
export function releaseBundler(exported) {
  // esbuild belongs to the Chrome package's locked install, not the desktop app.
  return createRequire(path.join(exported, 'plugins/chrome/package.json'))('esbuild')
}
export function releaseSourcePlan(root, node22, commit, origin) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid reviewed commit')
  if (!path.isAbsolute(root) || !path.isAbsolute(node22))
    throw new Error('Absolute release inputs required')
  if (
    !['https://github.com/brocrew/brocrew.git', 'https://github.com/brocrew/brocrew'].includes(
      origin,
    )
  )
    throw new Error('Actual canonical HTTPS origin required')
  const checkout = path.join(root, 'release-checkout'),
    exported = path.join(root, 'chrome-source'),
    artifact = path.join(root, 'release')
  const env = {
    PATH: `${path.dirname(node22)}:/usr/bin:/bin`,
    BROCREW_PLUGIN_SOURCE_COMMIT: commit,
  }
  return {
    origin,
    checkout,
    exported,
    artifact,
    build: {
      program: node22,
      args: ['scripts/build-plugin-release.mjs', 'chrome', artifact],
      cwd: checkout,
      env: { ...env, BROCREW_MONOREPO_ROOT: checkout },
    },
    tests: {
      program: node22,
      args: ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.release.config.mts'],
      cwd: exported,
      env: { ...env, BROCREW_CHROME_TEST_ARTIFACT: artifact },
    },
  }
}

// The history-free export owns the locked install. Copy it into the unchanged producer checkout.
export function stageReleaseDependencies(exported, checkout) {
  const source = path.join(exported, 'plugins/chrome/node_modules')
  const target = path.join(checkout, 'plugins/chrome/node_modules')
  if (
    fs.existsSync(target) ||
    !fs.lstatSync(source).isDirectory() ||
    fs.lstatSync(source).isSymbolicLink()
  )
    throw new Error('Invalid release dependency staging')
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  })
  const packagePath = path.join(checkout, 'plugins/chrome/package.json')
  const declared = JSON.parse(fs.readFileSync(packagePath))
  const resolve = createRequire(packagePath)
  const installedRoot = fs.realpathSync(target) + path.sep
  for (const [name, version] of Object.entries({
    ...declared.dependencies,
    ...declared.devDependencies,
  })) {
    const metadata = JSON.parse(fs.readFileSync(path.join(target, name, 'package.json')))
    if (metadata.version !== version) throw new Error('Release dependency pin differs')
  }
  // Both build-time bundling and the external browser protocol must resolve from this copied install.
  for (const name of ['esbuild', 'playwright-core'])
    if (!fs.realpathSync(resolve.resolve(name)).startsWith(installedRoot))
      throw new Error('Release dependency resolved outside the locked install')
}
export async function buildFixtureRelease(root, node22) {
  const commit = (await command('/usr/bin/git', ['rev-parse', 'HEAD'], root)).trim()
  const origin = (await command('/usr/bin/git', ['remote', 'get-url', 'origin'], root)).trim()
  const plan = releaseSourcePlan(root, node22, commit, origin)
  // Do not turn a local clone or SSH alias into canonical-source evidence.
  verifyPluginSource({
    root: repository,
    canonicalRoot: repository,
    id: 'chrome',
    sourceCommit: commit,
  })
  if (!(await command(node22, ['--version'], root)).trim().startsWith('v22.'))
    throw new Error('Node 22 required')
  const { checkout, exported, artifact } = plan
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
  await command('/usr/bin/git', ['remote', 'set-url', 'origin', plan.origin], root, {}, checkout)
  verifyPluginSource({
    root: checkout,
    canonicalRoot: checkout,
    id: 'chrome',
    sourceCommit: commit,
  })
  await command(node22, ['scripts/export-chrome-plugin.mjs', exported], root, {}, checkout)
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
  stageReleaseDependencies(exported, checkout)
  verifyPluginSource({
    root: checkout,
    canonicalRoot: checkout,
    id: 'chrome',
    sourceCommit: commit,
  })
  await phaseStep(root, 'release-build', () =>
    command(plan.build.program, plan.build.args, root, plan.build.env, plan.build.cwd),
  )
  await phaseStep(root, 'release-tests', () =>
    command(plan.tests.program, plan.tests.args, root, plan.tests.env, plan.tests.cwd),
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
