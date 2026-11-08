import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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
