import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checks,
  digest,
  finish,
  loopbackSandbox,
  ownedRoot,
  projectBuild,
  report,
  requireCheck,
  requireCI,
  safeReport,
} from '../gates/plugin-packaged/contract.mjs'
import { assertNormalPluginBuild, GATE_BUILD_MARKER } from '../check-no-plugin-gate-inputs.mjs'
import { initialize, requireHosted } from '../gates/plugin-packaged/owner.mjs'
import { stageRelease } from '../gates/plugin-packaged/journey.mjs'
import { fixtureEnvironment, removeFixture } from '../gates/plugin-packaged/prepare.mjs'
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const desktopRequire = createRequire(path.join(repository, 'apps/desktop/package.json'))
const { build } = createRequire(desktopRequire.resolve('electron-vite/package.json'))('esbuild')
const folders = [],
  close = []
afterEach(async () => {
  for (const action of close.splice(0)) await action()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-plugin-gate-')))
  folders.push(root)
  fs.chmodSync(root, 0o700)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
  return root
}
const read = (name) => fs.readFileSync(path.join(repository, name), 'utf8')
// The Mac gate fixtures require POSIX ownership and descriptor paths.
describe.skipIf(process.platform === 'win32')('the packaged Chrome gate', () => {
  it('requires a hosted Mac, the BroCrew repository and a packaged-gate ref', () => {
    const env = {
      RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'brocrew/brocrew',
      GITHUB_REF: 'refs/heads/gate/plugin-packaged-fern',
    }
    expect(() => requireCI(env, 'darwin', 'arm64')).not.toThrow()
    expect(() => requireHosted(env, 'darwin', 'arm64')).not.toThrow()
    expect(() => requireHosted({}, 'darwin', 'arm64')).toThrow()
    expect(() =>
      requireHosted({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, 'darwin', 'arm64'),
    ).toThrow()
    for (const edit of [
      { RUNNER_ENVIRONMENT: 'self-hosted' },
      { RUNNER_ENVIRONMENT: undefined },
      { GITHUB_ACTIONS: '' },
      { GITHUB_REPOSITORY: 'example/fern' },
      { GITHUB_REF: 'refs/heads/main' },
    ])
      expect(() => requireCI({ ...env, ...edit }, 'darwin', 'arm64')).toThrow()
    expect(() => requireCI(env, 'linux', 'arm64')).toThrow()
    expect(() => requireCI(env, 'darwin', 'x64')).toThrow()
    const workflow = read('.github/workflows/plugin-packaged-gate.yml')
    expect(workflow).toContain("github.repository == 'brocrew/brocrew'")
    expect(workflow).toContain("startsWith(github.ref, 'refs/heads/gate/plugin-packaged-')")
    expect(workflow).not.toContain('github.event.repository.private')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).not.toContain('workflow_dispatch')
    expect(workflow).not.toMatch(/secrets\.|contents: write|gh |git push/)
    expect(workflow).toContain('/summary.json')
    expect(workflow).not.toMatch(/path:.*(?:\.log|\.png|chrome\.tar|key)/)
  })
  it('refuses actual fixture initialization on this Mac or a self-hosted runner before any mutation', async () => {
    await expect(initialize({})).rejects.toThrow()
    await expect(
      initialize({
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'brocrew/brocrew',
        GITHUB_REF: 'refs/heads/gate/plugin-packaged-fern',
        RUNNER_ENVIRONMENT: 'self-hosted',
      }),
    ).rejects.toThrow()
  })
  it('projects only explicit scratch list/archive and inert-browser inputs into the packaged Settings path', () => {
    const config = read('apps/desktop/src/main/plugins/catalogue/build-config.ts')
    const entry = read('apps/desktop/src/main/index.ts')
    const projected = projectBuild(
      config,
      entry,
      '/private/tmp/fictional/a',
      '/private/tmp/fictional/browser',
    )
    expect(projected.config).toBe(config)
    expect(projected.entry).toContain(
      "import { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'",
    )
    const homeDerivation = 'deriveProviderHome(userData, { profileId, provider })'
    expect(entry.split(homeDerivation)).toHaveLength(2)
    expect(projected.entry.split(homeDerivation)).toHaveLength(2)
    expect(projected.entry).toContain(
      'homeOf: (provider) => providerHomePaths.providerHomePath(provider, slug)',
    )
    expect(projected.entry).toContain('...providerHomePaths,')
    expect(projected.entry).toContain('new PackagedGateRuntime(provider, "/private/tmp/fictional")')
    expect(projected.entry).not.toContain('createProviderRuntime(provider, {')
    expect(projected.entry).toContain('fixtureSource: "/private/tmp/fictional/a/repo-fixture"')
    expect(projected.entry).toContain('browserExecutable: "/private/tmp/fictional/browser"')
    expect(projected.entry).toContain('app.setPath(\'appData\', "/private/tmp/fictional/a")')
    expect(projected.entry).toContain(
      'return preparePackagedGateHome("/private/tmp/fictional", userData, provider, profileId)',
    )
    expect(projected.entry).toContain('renewClaudeLogin: undefined')
    expect(() =>
      projectBuild(
        config,
        entry + '\npinTheDataFolder(app)',
        '/private/tmp/fictional/a',
        '/private/tmp/fictional/browser',
      ),
    ).toThrow()
    expect(() =>
      projectBuild(config, entry, 'relative', '/private/tmp/fictional/browser'),
    ).toThrow()
    const runtimeImport =
      "import { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'"
    for (const changed of [
      entry.replace(runtimeImport, "import { RuntimeHost } from './runtime/runtime-host'"),
      entry + '\n' + runtimeImport,
    ])
      expect(() =>
        projectBuild(config, changed, '/private/tmp/fictional/a', '/private/tmp/fictional/browser'),
      ).toThrow('Build anchor changed')
    const prepare = read('scripts/gates/plugin-packaged/prepare.mjs')
    expect(prepare).toMatch(
      /finally\s*\{\s*fs.writeFileSync\(configPath, original.config\)\s*fs.writeFileSync\(entryPath, original.entry\)/,
    )
  })
  it('refuses each gate-only pin on every normal packaging command, with no bypass option', () => {
    const config = read('apps/desktop/src/main/plugins/catalogue/build-config.ts'),
      entry = read('apps/desktop/src/main/index.ts')
    expect(() => assertNormalPluginBuild(config, entry)).not.toThrow()
    for (const pin of [
      "fixtureSource: '/private/tmp/fictional/repo-fixture'",
      "browserExecutable: '/private/tmp/fictional/browser'",
      "app.setPath('appData', '/private/tmp/fictional')",
      'return preparePackagedGateHome(root, userData, provider, profileId)',
      'renewClaudeLogin: undefined',
    ])
      expect(() =>
        assertNormalPluginBuild(config + `\n/* ${GATE_BUILD_MARKER} */ ` + pin, entry),
      ).toThrow('Refusing to package')
    const scripts = JSON.parse(read('apps/desktop/package.json')).scripts
    for (const name of ['package', 'package:win', 'package:mac-beta'])
      expect(scripts[name]).toMatch(
        /^node \.\.\/\.\.\/scripts\/check-no-plugin-gate-inputs\.mjs && /,
      )
    expect(read('scripts/check-no-plugin-gate-inputs.mjs')).not.toMatch(/process\.env|allow|bypass/)
    // Removing a comment cannot make the credential-free launch seam a normal build.
    for (const pin of [
      'preparePackagedGateHome(root, userData, provider, profileId)',
      'renewClaudeLogin: undefined',
    ])
      expect(() => assertNormalPluginBuild(config, entry + '\n' + pin)).toThrow(
        'Refusing to package',
      )
  })
  it('normal packaging refuses enabled local releases or either removed dev-source packaged guard', () => {
    const config = read('apps/desktop/src/main/plugins/catalogue/build-config.ts')
    const entry = read('apps/desktop/src/main/index.ts')
    const source = read('apps/desktop/src/main/plugins/catalogue/dev-source.ts')
    expect(() => assertNormalPluginBuild(config, entry, source)).not.toThrow()
    expect(() =>
      assertNormalPluginBuild(config.replace('boolean = false', 'boolean = true'), entry, source),
    ).toThrow('Refusing to package')
    expect(() =>
      assertNormalPluginBuild(
        config,
        entry.replace('devSource: !app.isPackaged', 'devSource: true'),
        source,
      ),
    ).toThrow('Refusing to package')
    expect(() =>
      assertNormalPluginBuild(
        config,
        entry,
        source.replace('options.isPackaged !== false', 'false'),
      ),
    ).toThrow('Refusing to package')
  })
  it('admits only an owned marked root and does not inherit a provider identity into child environments', () => {
    const root = scratch()
    expect(ownedRoot(root)).toBe(root)
    const env = fixtureEnvironment(root)
    expect(env.HOME).toBe(path.join(root, 'home'))
    expect(env.CODEX_HOME).toBe(path.join(root, 'home/.codex'))
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(root, 'home/.claude'))
    for (const name of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'SSH_AUTH_SOCK',
      'ELECTRON_RUN_AS_NODE',
      'NODE_OPTIONS',
      'ELECTRON_EXTRA_LAUNCH_ARGS',
    ])
      expect(env).not.toHaveProperty(name)
    fs.unlinkSync(path.join(root, 'fixture-owned'))
    expect(() => ownedRoot(root)).toThrow()
  })
  it('cleans only its owned scratch tree, including immutable package directories, without following links', () => {
    const root = scratch(),
      other = scratch(),
      child = path.join(root, 'immutable')
    fs.mkdirSync(child)
    fs.writeFileSync(path.join(child, 'package'), 'fictional')
    fs.symlinkSync(other, path.join(root, 'outside'))
    fs.chmodSync(child, 0o500)
    expect(() => removeFixture(root)).toThrow('Child exit witnesses missing')
    expect(fs.existsSync(root)).toBe(true)
    removeFixture(root, { exited: true, processes: 0 }, [])
    expect(fs.existsSync(root)).toBe(false)
    expect(fs.readFileSync(path.join(other, 'fixture-owned'), 'utf8')).toBe(
      'packaged-plugin-gate\n',
    )
  })
  it('keeps the loopback/Keychain profile available and requires an explicit measured launch policy', () => {
    expect(loopbackSandbox).toContain('(deny network-outbound)')
    expect(loopbackSandbox).toContain('(allow network-outbound (remote ip "localhost:*"))')
    expect(loopbackSandbox).toContain('/Library/Keychains')
    expect(loopbackSandbox).not.toMatch(/allow network-outbound\)\s*$/m)
    const journey = read('scripts/gates/plugin-packaged/journey.mjs')
    expect(journey).toContain(
      "requireSelection(JSON.parse(readOwned(path.join(root, 'probe-matrix.json'))))",
    )
    expect(journey).toContain("'--use-mock-keychain'")
    expect(journey).toContain('HIDDEN_LAUNCH_ARG')
    expect(journey).not.toMatch(/setApiKey|9444|9222|security.*execv/)
  })
  it('cannot pass with a missing journey fact or a report containing text or material', () => {
    const summary = report()
    for (const key of checks) {
      const incomplete = structuredClone(summary)
      expect(finish(incomplete).passed).toBe(false)
      requireCheck(summary, key, true)
    }
    expect(finish(summary).passed).toBe(false)
    expect(summary.coverage).toEqual({
      agentBrowserActions: false,
      liveTabs: false,
      providerCredentialAudit: false,
    })
    summary.coverage.agentBrowserActions = true
    expect(finish(summary).passed).toBe(false)
    summary.coverage.liveTabs = true
    expect(finish(summary).passed).toBe(true)
    const unprovedAudit = structuredClone(summary)
    unprovedAudit.coverage.providerCredentialAudit = true
    expect(finish(unprovedAudit).passed).toBe(false)
    const failed = structuredClone(summary)
    failed.counts.failed = 1
    expect(finish(failed).passed).toBe(false)
    expect(safeReport(summary)).toBe(true)
    expect(safeReport({ ...summary, secret: 'fictional' })).toBe(false)
    expect(() => requireCheck(summary, 'installed', false)).toThrow()
  })
  it('stages the unsigned list and exact archive pins; refusal variants alter only their intended bytes', () => {
    const root = scratch(),
      appData = path.join(root, 'a')
    fs.mkdirSync(appData)
    fs.mkdirSync(path.join(root, 'release'))
    const archive = Buffer.from('fictional archive bytes')
    const list = {
      format: 1,
      entries: [
        {
          id: 'chrome',
          targets: [
            {
              url: 'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v1/chrome.tar.gz',
              sha256: digest(archive),
              bytes: archive.length,
              compression: 'tar.gz',
            },
          ],
        },
      ],
    }
    fs.writeFileSync(path.join(root, 'release/catalogue.json'), JSON.stringify(list))
    fs.writeFileSync(path.join(root, 'release/chrome-darwin-arm64.tar.gz'), archive)
    const staged = path.join(appData, 'repo-fixture')
    const stagedArchive = path.join(staged, 'archives', digest(archive) + '.tar.gz')
    stageRelease(root, appData)
    expect(fs.readFileSync(stagedArchive).equals(archive)).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(staged, 'catalogue.json')))).toEqual(list)
    stageRelease(root, appData, 'tampered')
    expect(fs.readFileSync(stagedArchive).equals(archive)).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(staged, 'catalogue.json')))).toEqual(list)
    stageRelease(root, appData, 'foreign')
    expect(fs.readFileSync(stagedArchive).equals(archive)).toBe(true)
    expect(
      JSON.parse(fs.readFileSync(path.join(staged, 'catalogue.json'))).entries[0].targets[0].url,
    ).toBe('https://example.invalid/foreign.tar.gz')
    expect(fs.readdirSync(staged).sort()).toEqual(['archives', 'catalogue.json'])
    for (const file of ['prepare.mjs', 'release.mjs', 'journey.mjs'])
      expect(read('scripts/gates/plugin-packaged/' + file)).not.toMatch(
        /generateKeyPair|sign-plugin|fixture-sign|catalogue\.sig|createPrivateKey/,
      )
  })
  it('uses the landed adapter and host policy to refuse foreign URLs and changed archive bytes', async () => {
    const root = scratch(),
      input = path.join(root, 'input'),
      archive = Buffer.from('fictional unsigned archive')
    fs.mkdirSync(input)
    fs.mkdirSync(path.join(input, 'archives'))
    const target = {
      os: 'darwin',
      cpu: 'arm64',
      url: 'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v1/chrome.tar.gz',
      sha256: digest(archive),
      bytes: archive.length,
      compression: 'tar.gz',
      manifestSha256: 'a'.repeat(64),
    }
    const list = {
      format: 1,
      entries: [
        {
          id: 'chrome',
          name: 'Fictional browser',
          description: 'Fictional offline package.',
          version: '1.0.0',
          minAppVersion: '0.0.0',
          sourceCommit: 'b'.repeat(40),
          targets: [target],
        },
      ],
    }
    fs.writeFileSync(path.join(input, 'catalogue.json'), JSON.stringify(list))
    const archivePath = path.join(input, 'archives', digest(archive) + '.tar.gz')
    fs.writeFileSync(archivePath, archive)
    const out = path.join(root, 'adapter.cjs')
    await build({
      stdin: {
        contents: `export {loadRepoPluginList} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/catalogue/repo-list.ts'))};export {localPluginArchive} from ${JSON.stringify(path.join(repository, 'apps/desktop/src/main/plugins/catalogue/local.ts'))};`,
        resolveDir: repository,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: out,
    })
    const adapter = createRequire(import.meta.url)(out)
    fs.mkdirSync(path.join(root, 'g'), { mode: 0o700 })
    const loaded = await adapter.loadRepoPluginList({
      root: path.join(root, 'g'),
      fixtureSource: input,
      target: { os: 'darwin', cpu: 'arm64' },
      appVersion: '1.0.0',
    })
    expect(loaded.releases).toHaveLength(1)
    expect((await adapter.localPluginArchive(input, loaded.releases[0])).equals(archive)).toBe(true)
    const changed = Buffer.from(archive)
    changed[0] ^= 1
    fs.writeFileSync(archivePath, changed)
    await expect(adapter.localPluginArchive(input, loaded.releases[0])).rejects.toThrow()
    target.url = 'https://example.invalid/foreign.tar.gz'
    fs.writeFileSync(path.join(input, 'catalogue.json'), JSON.stringify(list))
    await expect(
      adapter.loadRepoPluginList({
        root: path.join(root, 'foreign'),
        fixtureSource: input,
        target: { os: 'darwin', cpu: 'arm64' },
        appVersion: '1.0.0',
      }),
    ).rejects.toThrow()
    expect(fs.existsSync(path.join(root, 'foreign/repo-catalogues'))).toBe(false)
  })
})
