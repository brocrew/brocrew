import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exec = promisify(execFile)
export const chromeDescription =
  'Lets agents use Google Chrome with its own separate profiles: read pages, use sites and save downloads.'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function releaseCatalogue(fixture, archive, manifest, commit, archiveUrl) {
  const url = new URL(archiveUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Use an HTTPS archive URL with no credentials or fragment')
  if (
    fixture.id !== 'chrome' ||
    fixture.sourceCommit !== commit ||
    JSON.stringify(fixture.platforms) !== JSON.stringify([{ os: 'darwin', cpu: 'arm64' }]) ||
    fixture.archive.compression !== 'tar' ||
    fixture.archive.size !== archive.length ||
    fixture.archive.sha256 !== sha256(archive) ||
    fixture.manifestSha256 !== sha256(manifest)
  )
    throw new Error('The build metadata does not match the reviewed Chrome package')
  return {
    format: 1,
    entries: [
      {
        ...fixture,
        archive: { ...fixture.archive, url: archiveUrl },
        description: chromeDescription,
      },
    ],
  }
}

async function run(file, args, options) {
  const { testDiagnostics, ...childOptions } = options
  try {
    return (
      await exec(file, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024, ...childOptions })
    ).stdout.trim()
  } catch (error) {
    // Child diagnostics can contain registry configuration. Keep the failure local and bounded.
    const details = testDiagnostics
      ? `\n${error.stdout ?? ''}\n${error.stderr ?? ''}`.slice(-12_000)
      : ''
    throw new Error(`Release step failed: ${path.basename(file)} ${args[0] ?? ''}${details}`, {
      cause: error,
    })
  }
}

export async function buildRelease({ commit, output, archiveUrl, node, repository = root }) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? ''))
    throw new Error('Supply the full reviewed commit SHA')
  if (!path.isAbsolute(output) || !path.isAbsolute(node))
    throw new Error('Use absolute output and Node 22 paths')
  const destination = fs.lstatSync(output)
  if (!destination.isDirectory() || destination.isSymbolicLink() || fs.readdirSync(output).length)
    throw new Error('Use an empty output folder, not a link')
  // Validate the URL before creating a checkout or downloading dependencies.
  const url = new URL(archiveUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Use an HTTPS archive URL with no credentials or fragment')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-release-'))
  try {
    const home = path.join(scratch, 'home')
    fs.mkdirSync(home, { mode: 0o700 })
    const emptyConfig = path.join(scratch, 'gitconfig')
    const userConfig = path.join(scratch, 'npm-user')
    const globalConfig = path.join(scratch, 'npm-global')
    for (const file of [emptyConfig, userConfig, globalConfig]) fs.writeFileSync(file, '')
    const env = {
      HOME: home,
      USERPROFILE: home,
      PATH: `${path.dirname(node)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      TMPDIR: scratch,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_cache: path.join(scratch, 'npm-cache'),
      VITEST_MAX_WORKERS: String(
        Math.max(1, Math.min(3, Number(process.env.VITEST_MAX_WORKERS) || 3)),
      ),
    }
    const options = { env, cwd: scratch }
    const version = await run(node, ['-p', 'process.versions.node'], options)
    if (!version.startsWith('22.')) throw new Error('The build requires Node 22')
    const checkout = path.join(scratch, 'checkout')
    await run(
      'git',
      ['clone', '--shared', '--no-checkout', '--template=', repository, checkout],
      options,
    )
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', commit], {
      ...options,
      cwd: checkout,
    })
    const actual = await run('git', ['rev-parse', 'HEAD'], { ...options, cwd: checkout })
    if (actual !== commit) throw new Error('The checkout is not the reviewed commit')
    // Test dependencies come from the tooling checkout; source and plugin dependencies are isolated.
    if (
      !fs
        .readFileSync(path.join(repository, 'pnpm-lock.yaml'))
        .equals(fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml')))
    )
      throw new Error('Install the tooling dependencies for the reviewed lockfile first')
    fs.symlinkSync(
      path.join(repository, 'node_modules'),
      path.join(checkout, 'node_modules'),
      'dir',
    )
    fs.symlinkSync(
      path.join(repository, 'apps/desktop/node_modules'),
      path.join(checkout, 'apps/desktop/node_modules'),
      'dir',
    )
    const plugin = path.join(checkout, 'plugins/chrome')
    if (fs.existsSync(path.join(plugin, '.npmrc')))
      throw new Error('The isolated plugin must not supply registry configuration')
    const npm = path.resolve(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js')
    await run(node, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      ...options,
      cwd: plugin,
    })
    const artifact = path.join(scratch, 'artifact')
    await run(node, ['plugins/chrome/build.mjs', artifact], {
      ...options,
      cwd: checkout,
      env: { ...env, BROCREW_PLUGIN_SOURCE_COMMIT: commit },
    })
    const archive = fs.readFileSync(path.join(artifact, 'chrome.tar'))
    const manifest = fs.readFileSync(path.join(artifact, 'package/plugin.json'))
    const catalogue = Buffer.from(
      JSON.stringify(
        releaseCatalogue(
          JSON.parse(fs.readFileSync(path.join(artifact, 'fixture-release.json'), 'utf8')),
          archive,
          manifest,
          commit,
          archiveUrl,
        ),
        null,
        2,
      ) + '\n',
    )
    fs.writeFileSync(path.join(artifact, 'catalogue.json'), catalogue)
    const require = createRequire(path.join(repository, 'package.json'))
    const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
    const testReport = path.join(scratch, 'fake-browser-checks.json')
    await run(
      node,
      [
        vitest,
        'run',
        '--config',
        'plugins/chrome/vitest.config.ts',
        '--reporter=json',
        `--outputFile=${testReport}`,
      ],
      {
        ...options,
        testDiagnostics: true,
        cwd: checkout,
        env: { ...env, BROCREW_CHROME_TEST_ARTIFACT: artifact },
      },
    )
    const tests = JSON.parse(fs.readFileSync(testReport, 'utf8'))
    if (!tests.success || tests.numFailedTests !== 0 || tests.numPassedTests === 0)
      throw new Error('The fake-browser checks did not pass')
    // Exercise the candidate's pure verifier against the final catalogue bytes, with an ephemeral key.
    const { build } = createRequire(path.join(plugin, 'package.json'))('esbuild')
    const proof = path.join(scratch, 'verify.cjs')
    await build({
      stdin: {
        contents: `
import {createPluginVerifier} from ${JSON.stringify(path.join(checkout, 'apps/desktop/src/main/plugins/package-verifier.ts'))};
import {generateKeyPairSync, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const bytes = readFileSync(${JSON.stringify(path.join(artifact, 'catalogue.json'))});
const archive = readFileSync(${JSON.stringify(path.join(artifact, 'chrome.tar'))});
const verifier = createPluginVerifier({pinnedPublicKey: publicKey, target:{os:'darwin',cpu:'arm64'}});
const trusted = verifier.verifyCatalogue(bytes, sign(null, bytes, privateKey));
const entry = trusted.entries[0];
trusted.verifyPackage(entry.id, entry.version, archive);
`,
        resolveDir: checkout,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      outfile: proof,
      logLevel: 'silent',
    })
    await run(node, [proof], options)
    const receipt = {
      sourceCommit: commit,
      node: version,
      catalogueSha256: sha256(catalogue),
      archiveSha256: sha256(archive),
      archiveBytes: archive.length,
      fakeBrowserChecks: true,
      fakeBrowserTests: { passed: tests.numPassedTests, skipped: tests.numPendingTests },
      pureVerifier: true,
      installScripts: false,
    }
    // Nothing is published until both checks pass. Never overwrite an output added during the build.
    for (const [name, bytes] of [
      ['chrome.tar', archive],
      ['plugin.json', manifest],
      ['catalogue.json', catalogue],
      ['release-receipt.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n')],
    ])
      fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 })
    return receipt
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        commit: { type: 'string' },
        output: { type: 'string' },
        'archive-url': { type: 'string' },
        node: { type: 'string' },
      },
    })
    const receipt = await buildRelease({
      commit: values.commit,
      output: values.output,
      archiveUrl: values['archive-url'],
      node: values.node,
    })
    console.log(`built and checked; catalogue SHA-256: ${receipt.catalogueSha256}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
