import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'
import { notesOf, platformsOf, titleOf, versionOf } from '../beta-release.mjs'
import { problemsWith, readUpdateFile, sha512Of } from '../release-check.mjs'

/**
 * 🔴 **W4.109 · B0 — the release BroCrew's updater reads.**
 *
 *  - §1 · a version tag: `vX.Y.Z` is a release, `vX.Y.Z-beta.N` a beta, and nothing else is either.
 *  - §2 · `release-check.mjs`: an update file must name this version, and every file it names must
 *    be there with the size and sha512 it says; the app must look at this repository.
 *  - §3 · `release.yml`: the tag decides the version; one setting decides the repository, and it
 *    can only be the one the workflow runs in; both builds are checked before one job, alone with
 *    the right to write, publishes them as ONE release — a draft until every file is in.
 */

const here = dirname(fileURLToPath(import.meta.url))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('§1 · a version tag', () => {
  it('🔴 vX.Y.Z is a release and vX.Y.Z-beta.N a beta, of both platforms', () => {
    expect(versionOf('v0.1.0')).toEqual({ version: '0.1.0', beta: false })
    expect(versionOf('v0.2.0-beta.3')).toEqual({ version: '0.2.0-beta.3', beta: true })
    expect(platformsOf('v0.1.0')).toEqual(['windows', 'mac'])
    expect(titleOf('v0.1.0')).toBe('BroCrew 0.1.0')
    expect(titleOf('v0.2.0-beta.3')).toBe('BroCrew 0.2.0-beta.3 (beta)')
  })

  it('⛔ nothing else is a version — not a v without three numbers, nor another prerelease name', () => {
    for (const tag of ['v1', 'v0.1', 'v0.1.0-rc.1', 'v0.1.0-beta', '0.1.0', 'v0.1.0 x', 'beta-1']) {
      expect(versionOf(tag), tag).toBeNull()
    }
    expect(() => platformsOf('v0.1')).toThrow(/names no beta platform/)
  })

  it('⚑ its notes say which files to download, and which are the updater’s', () => {
    const notes = notesOf('v0.1.0', '1a2b3c4')
    expect(notes).toMatch(/^BroCrew 0\.1\.0 for Windows x64 and for Macs with Apple silicon/)
    expect(notes).toContain('from commit 1a2b3c4 (tag v0.1.0)')
    expect(notes).toContain('`latest*.yml` files are what BroCrew reads when it checks for updates')
    expect(notesOf('v0.2.0-beta.3', 'x')).toMatch(/^BroCrew 0\.2\.0-beta\.3, a beta, for/)
  })
})

describe('§2 · release-check.mjs', () => {
  /** A dist folder as electron-builder leaves it: one file, its update file, the app's config. */
  const aRelease = ({ version = '0.1.0', sum = null, repo = 'brocrew' } = {}) => {
    const dist = mkdtempSync(join(tmpdir(), 'brobot-release-check-'))
    roots.push(dist)
    const file = join(dist, 'BroCrew-Setup-0.1.0-x64.exe')
    writeFileSync(file, 'an installer')
    const real = sha512Of(file)
    writeFileSync(
      join(dist, 'latest.yml'),
      [
        `version: ${version}`,
        'files:',
        '  - url: BroCrew-Setup-0.1.0-x64.exe',
        `    sha512: ${sum ?? real}`,
        '    size: 12',
        'path: BroCrew-Setup-0.1.0-x64.exe',
        `sha512: ${sum ?? real}`,
        "releaseDate: '2026-10-03T00:00:00.000Z'",
        '',
      ].join('\n'),
    )
    mkdirSync(join(dist, 'resources'))
    const appUpdate = join(dist, 'resources', 'app-update.yml')
    writeFileSync(appUpdate, `owner: brocrew\nrepo: ${repo}\nprovider: github\n`)
    return { dist, appUpdate }
  }

  it('🔴 a release whose update file names its files truly, for the right repository, holds', () => {
    const { dist, appUpdate } = aRelease()
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([])
  })

  it('⛔ a sha512 that is not the file’s is an update nobody could install', () => {
    const wrong = createHash('sha512').update('something else').digest('base64')
    const { dist, appUpdate } = aRelease({ sum: wrong })
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([
      "latest.yml: BroCrew-Setup-0.1.0-x64.exe's sha512 is not the file's",
      "latest.yml's top-level sha512 is not BroCrew-Setup-0.1.0-x64.exe's",
    ])
  })

  it('⛔ another version, a missing file, or an app that looks elsewhere', () => {
    const { dist, appUpdate } = aRelease({ version: '0.0.9', repo: 'brobot2' })
    rmSync(join(dist, 'BroCrew-Setup-0.1.0-x64.exe'))
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([
      'latest.yml names version 0.0.9, not 0.1.0',
      `latest.yml names BroCrew-Setup-0.1.0-x64.exe, which is not in ${dist}`,
      "latest.yml's path (BroCrew-Setup-0.1.0-x64.exe) is not one of the files it names",
      "the app's app-update.yml does not say repo: brocrew",
    ])
  })

  it('⛔ an app built to read a private feed, or carrying a token, is not a release', () => {
    const { dist, appUpdate } = aRelease()
    writeFileSync(
      appUpdate,
      'owner: brocrew\nrepo: brocrew\nprovider: github\nprivate: true\ntoken: x\n',
    )
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([
      "the app's app-update.yml says private:, which a release never carries",
      "the app's app-update.yml says token:, which a release never carries",
    ])
  })

  it('⚑ it reads the Mac’s update file, which names the zip and the dmg', () => {
    const said = readUpdateFile(
      [
        'version: 0.1.0',
        'files:',
        '  - url: BroCrew-0.1.0-arm64-mac.zip',
        '    sha512: aaa',
        '    size: 3',
        '  - url: BroCrew-0.1.0-arm64.dmg',
        '    sha512: bbb',
        '    size: 4',
        'path: BroCrew-0.1.0-arm64-mac.zip',
        'sha512: aaa',
      ].join('\n'),
    )
    expect(said).toEqual({
      version: '0.1.0',
      files: [
        { url: 'BroCrew-0.1.0-arm64-mac.zip', sha512: 'aaa', size: 3 },
        { url: 'BroCrew-0.1.0-arm64.dmg', sha512: 'bbb', size: 4 },
      ],
      path: 'BroCrew-0.1.0-arm64-mac.zip',
      sha512: 'aaa',
    })
  })
})

describe('§3 · release workflow route', () => {
  const workflow = readFileSync(join(here, '../../.github/workflows/release.yml'), 'utf8')
  const mac = readFileSync(join(here, '../../.github/actions/signed-mac/action.yml'), 'utf8')
  it('uses valid YAML and passes version/repository inputs to every composite shell step', () => {
    const load = builderTools.loadYaml
    const action = load(mac)
    const parsed = load(workflow)
    expect(parsed.jobs.macos.environment).toBe('mac-signing')
    expect(parsed.jobs.qualify.environment).toBe('mac-signing')
    expect(parsed.jobs.publish.environment).toBe('release')
    expect(parsed.jobs.publish.needs).not.toContain('macos')
    for (const job of ['qualify', 'publish']) {
      expect(parsed.jobs[job].steps[0]).toEqual({
        uses: 'actions/checkout@v7',
        with: { 'fetch-depth': 0, 'persist-credentials': false },
      })
      expect(parsed.jobs[job].steps[1]).toEqual({
        uses: './.github/actions/setup-desktop',
        with: { install: 'false' },
      })
    }
    const setup = load(
      readFileSync(join(here, '../../.github/actions/setup-desktop/action.yml'), 'utf8'),
    )
    expect(setup.inputs.install.default).toBe('true')
    const installation = setup.runs.steps.find((step) => step.run)
    expect(installation.if).toBe("inputs.install == 'true'")
    expect(installation.run).toContain('pnpm install --frozen-lockfile')

    for (const step of action.runs.steps) if (step.run) expect(step.shell).toBe('bash')
    expect(mac).not.toMatch(/\$\{\{\s*(needs|secrets)\./)
  })
  it('supplies runtime expected metadata without exposing signing secrets to the proof', () => {
    const proof = readFileSync(join(here, '../../.github/workflows/mac-signed-upgrade.yml'), 'utf8')
    expect(proof).toContain('environment: mac-signing')
    for (const name of ['MAC_EXPECTED_TEAM_ID', 'MAC_EXPECTED_SIGNING_AUTHORITY']) {
      expect(proof).toContain(`vars.${name}`)
      expect(workflow).toContain(`vars.${name}`)
    }
    expect(proof).not.toMatch(/secrets\.(MAC_CERT|APPLE_API)/)
    expect(mac).toContain('node scripts/lib/mac-signing-identity.mjs mask')
  })
  it('restricts builds to candidates and publication to an explicit stable-tag dispatch', () => {
    expect(workflow).toContain("if: needs.plan.outputs.build == 'true'")
    expect(workflow).toContain("if: needs.plan.outputs.publish == 'true'")
    const publish = workflow.slice(workflow.indexOf('\n  publish:'))
    expect(publish).not.toMatch(/electron-builder|pnpm install|--clobber/)
    expect(publish).toContain('environment: release')
    expect(publish).toContain('selection_artifact_id')
    expect(publish).toContain('selection_sha256')
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
  })
  it('keeps the proof publication carrier out of all automatic build routes', () => {
    const parsed = builderTools.loadYaml(workflow)
    expect(parsed.on.push.tags).toContain('!v0.2.12-proof-carrier.1')
    expect(parsed.on.push.tags).toContain('!v0.2.12-proof-carrier.2')
    expect(parsed.on.push.tags).toContain('!v0.2.12-proof-carrier.3')
    expect(parsed.on.push.tags).toContain('!v0.2.12-proof-carrier.4')
    expect(parsed.on.push.tags).toContain('!v0.2.13-proof-carrier.1')
    for (const job of ['windows', 'macos', 'candidate'])
      expect(parsed.jobs[job].if).toBe("needs.plan.outputs.build == 'true'")
    for (const job of ['qualify', 'publish'])
      expect(parsed.jobs[job].needs).toEqual(['plan', 'leak'])
    expect(parsed.jobs.publish.environment).toBe('release')
    expect(parsed.jobs.publish.permissions).toEqual({
      contents: 'write',
      actions: 'read',
      attestations: 'read',
    })
    expect(parsed.jobs.qualify.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      attestations: 'read',
    })
    const proof = builderTools.loadYaml(
      readFileSync(join(here, '../../.github/workflows/mac-signed-upgrade.yml'), 'utf8'),
    )
    expect(proof.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(proof.jobs.upgrade.permissions).toBeUndefined()
    expect(workflow).not.toContain('accepted_source_sha')
    expect(workflow).not.toContain('target_ref:')
  })

  it('retains packaged/recovery/update checks and signs the Mac distribution', () => {
    expect(mac).toContain('--mac dmg zip dir --arm64')
    expect(mac).toContain('-c.mac.hardenedRuntime=true')
    expect(mac).toContain('-c.mac.timestamp=')
    expect(mac).not.toContain('-c.mac.identity=-')
    expect(mac).toContain('mac-after-sign.cjs')
    expect(mac).toContain('scripts/mac-release-signing.mjs')
    expect(mac).toContain('scripts/macos-packaged-check.mjs')
    expect(mac).toContain('scripts/release-check.mjs')
    expect(mac).toContain('scripts/recovery-real-entry-check.mjs')
    expect(workflow).toContain('artifact_name: release-macos')
    expect(workflow).not.toContain('macos-update-test')
    expect(mac).not.toContain('macUpdateInstall')
    expect(workflow).toContain('environment: mac-signing')
    expect(workflow).toContain('actions/attest-build-provenance@v2')
  })
})

describe('signed validation without a paid Windows build', () => {
  const repo = join(here, '../..')
  const load = builderTools.loadYaml
  const workflow = () => load(readFileSync(join(repo, '.github/workflows/macos.yml'), 'utf8'))
  const action = () =>
    load(readFileSync(join(repo, '.github/actions/signed-mac/action.yml'), 'utf8'))
  const require = createRequire(import.meta.url)
  const step = (name) => action().runs.steps.find((entry) => entry.name === name)
  const blocks = (run) =>
    [...run.matchAll(/node <<'NODE'[^\n]*\n([\s\S]*?)\nNODE/g)].map((m) => m[1])
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'signing-route-'))
    roots.push(root)
    return root
  }

  it('reserves validation tags without changing automatic candidate or stable release routes', () => {
    const release = load(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
    expect(release.on.push.tags).toEqual([
      'v*',
      '!v*-mac-signing-check.*',
      '!v0.2.12-proof-carrier.1',
      '!v0.2.12-proof-carrier.2',
      '!v0.2.12-proof-carrier.3',
      '!v0.2.12-proof-carrier.4',
      '!v0.2.13-proof-carrier.1',
    ])
    const mac = workflow()
    expect(mac.on.workflow_dispatch.inputs.signed_release_validation.default).toBe(false)
    expect(mac.on.workflow_dispatch.inputs.package_version.default).toBe('0.1.8')
    for (const name of ['macos', 'guided-update-rehearsal', 'recovery-real-entry'])
      expect(mac.jobs[name].if).toContain('inputs.signed_release_validation != true')
    const validation = mac.jobs['signed-release-validation']
    expect(validation.needs).toBe('flags')
    expect(validation.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(validation.if).toContain("github.ref_type == 'tag'")
    expect(validation.environment).toBe('mac-signing')
    expect(validation.permissions).toEqual({ contents: 'read' })
    expect(validation.concurrency['cancel-in-progress']).toBe(false)
    const build = validation.steps.find((entry) => entry.uses === './.github/actions/signed-mac')
    expect(build.with.version).toBe('${{ needs.flags.outputs.signing_version }}')
    expect(build.with.owner).toBe('brocrew')
    expect(build.with.repo).toBe('brocrew')
    for (const name of ['MAC_EXPECTED_TEAM_ID', 'MAC_EXPECTED_SIGNING_AUTHORITY'])
      expect(build.env[name]).toBe('${{ vars.' + name + ' }}')
    for (const name of [
      'MAC_CERT_P12_BASE64',
      'MAC_CERT_P12_PASSWORD',
      'APPLE_API_KEY_P8',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ])
      expect(build.env[name]).toBe('${{ secrets.' + name + ' }}')
    expect(JSON.stringify(validation)).not.toMatch(
      /windows-signing|ES_USERNAME|ES_PASSWORD|ES_TOTP_SECRET|gh release/,
    )
    const preflight = mac.jobs.flags.steps.findIndex((entry) => entry.id === 'signing')
    const leak = mac.jobs.flags.steps.findIndex(
      (entry) => entry.run === 'node scripts/leak-check.mjs --require-patterns',
    )
    expect(preflight).toBeGreaterThan(-1)
    expect(leak).toBeGreaterThan(preflight)
    expect(mac.jobs.flags.environment).toBeUndefined()
    expect(mac.jobs.flags.steps[leak].env.BROBOT_LEAK_PATTERNS).toBe(
      '${{ secrets.BROBOT_LEAK_PATTERNS }}',
    )
  })

  it('checks the actual tag, version and checked-out source before signed mode can run', () => {
    const mac = workflow()
    const preflight = mac.jobs.flags.steps.find((entry) => entry.id === 'signing')
    expect(preflight).toBeDefined()
    expect(preflight.run).toContain("env.GITHUB_REPOSITORY !== 'brocrew/brocrew'")
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim()
    expect(sha).toMatch(/^[a-f0-9]{40}$/)
    const dir = fixture()
    const valid = {
      GITHUB_REPOSITORY: 'brocrew/brocrew',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF: 'refs/tags/v0.2.12-mac-signing-check.1',
      GITHUB_SHA: sha,
      ACCEPTED_SOURCE_SHA: sha,
      PACKAGE_VERSION: '0.2.12',
      GUIDED_UPDATE_REHEARSAL: 'false',
    }
    const cases = [
      {},
      { GITHUB_REPOSITORY: 'other/repo' },
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_REF_TYPE: 'branch' },
      { GITHUB_REF: 'refs/heads/main' },
      { GITHUB_REF: 'refs/tags/v0.2.12-candidate.2' },
      { GITHUB_REF: 'refs/tags/v0.2.12' },
      { GITHUB_REF: 'refs/tags/v0.2.12-mac-signing-check.0' },
      { GITHUB_REF: 'refs/tags/v0.2.12-mac-signing-check.01' },
      { PACKAGE_VERSION: '0.1.8' },
      { PACKAGE_VERSION: '0.2.12; echo unsafe' },
      { ACCEPTED_SOURCE_SHA: '' },
      { ACCEPTED_SOURCE_SHA: 'f'.repeat(40) },
      { GITHUB_SHA: 'f'.repeat(40) },
      { GUIDED_UPDATE_REHEARSAL: 'true' },
    ]
    for (const [index, changes] of cases.entries()) {
      const output = join(dir, `output-${index}`)
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', preflight.run], {
        cwd: repo,
        env: { ...process.env, ...valid, ...changes, GITHUB_OUTPUT: output },
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(result.status, JSON.stringify(changes) + result.stderr).toBe(index === 0 ? 0 : 1)
      if (index === 0) expect(readFileSync(output, 'utf8')).toBe(`version=0.2.12\nsource=${sha}\n`)
    }
  })

  it.each([
    { original: [] },
    {
      original: [
        '/Users/fixture/keychain with spaces.keychain-db',
        '/Users/fixture/a"quote.keychain-db',
        '/Users/fixture/back\\slash.keychain-db',
      ],
    },
  ])(
    'preserves original keychain paths and restores them, including an empty list: %j',
    ({ original }) => {
      const dir = fixture()
      const prepare = blocks(step('Prepare temporary signing credentials').run)
      const cleanup = blocks(step('Remove temporary signing credentials').run)
      expect(prepare).toHaveLength(2)
      expect(cleanup).toHaveLength(1)
      const security = vi.fn(() => original.map((name) => `    "${name}"\n`).join(''))
      const context = {
        process: { env: { SIGNING_DIR: dir } },
        require: (name) =>
          name === 'node:child_process' ? { execFileSync: security } : require(name),
      }
      runInNewContext(prepare[0], { ...context })
      expect(JSON.parse(readFileSync(join(dir, 'keychain-search-list.json'), 'utf8'))).toEqual(
        original,
      )
      runInNewContext(prepare[1], { ...context })
      expect(security.mock.calls[1].slice(0, 2)).toEqual([
        'security',
        ['list-keychains', '-d', 'user', '-s', join(dir, 'release.keychain-db'), ...original],
      ])
      runInNewContext(cleanup[0], { ...context })
      expect(security.mock.calls[2].slice(0, 2)).toEqual([
        'security',
        ['list-keychains', '-d', 'user', '-s', ...original],
      ])
      const run = step('Prepare temporary signing credentials').run
      expect(run.indexOf("node <<'NODE'")).toBeLessThan(run.indexOf('security create-keychain'))
      expect(step('Remove temporary signing credentials').if).toBe('always()')
    },
  )

  it.each([
    [true, 0],
    [true, 7],
    [false, 0],
  ])(
    'always deletes owned credentials after partial setup/restore failure: snapshot=%s restore=%s',
    (snapshot, restoreExit) => {
      const root = fixture()
      const dir = join(root, 'mac-signing-12-1')
      mkdirSync(dir)
      if (snapshot) writeFileSync(join(dir, 'keychain-search-list.json'), '[]')
      writeFileSync(join(dir, 'release.keychain-db'), 'fictional owned keychain')
      const trace = join(root, 'trace')
      const cleanup = step('Remove temporary signing credentials').run
      const functions = `node() { printf 'restore\\n' >> "$TRACE"; return "$RESTORE_EXIT"; }\nsecurity() { printf 'delete\\n' >> "$TRACE"; }\n`
      const result = spawnSync('bash', ['-c', functions + cleanup], {
        env: {
          ...process.env,
          RUNNER_TEMP: root,
          GITHUB_RUN_ID: '12',
          GITHUB_RUN_ATTEMPT: '1',
          TRACE: trace,
          RESTORE_EXIT: String(restoreExit),
        },
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(result.status, result.stderr).toBe(restoreExit)
      expect(readFileSync(trace, 'utf8')).toBe(snapshot ? 'restore\ndelete\n' : 'delete\n')
      expect(() => readFileSync(join(dir, 'release.keychain-db'))).toThrow()
    },
  )
})
