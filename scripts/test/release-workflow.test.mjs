import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('§3 · release.yml', () => {
  const workflow = readFileSync(join(here, '../../.github/workflows/release.yml'), 'utf8')
  /** One job's block: its line, to the next job's. */
  const job = (name) => {
    const lines = workflow.split('\n')
    const at = lines.indexOf(`  ${name}:`)
    expect(at, `no job ${name}`).toBeGreaterThan(-1)
    const end = lines.findIndex((line, index) => index > at && /^ {2}[a-z][a-z-]*:$/.test(line))
    return lines.slice(at, end === -1 ? undefined : end).join('\n')
  }

  it('🔴 only a version tag starts it, and the tag decides the version', () => {
    expect(workflow).toMatch(
      /^on:\n {2}push:\n {4}tags: \['v\*'\]\n\npermissions:\n {2}contents: read$/m,
    )
    expect(job('plan')).toContain('=~ ^v([0-9]+\\.[0-9]+\\.[0-9]+)(-beta\\.[0-9]+)?$ ]]')
    for (const build of ['windows', 'macos']) {
      expect(job(build)).toContain('-c.extraMetadata.version=${{ needs.plan.outputs.version }}')
      expect(job(build)).toContain('--publish never')
      expect(job(build)).toContain('-c.publish.provider=github')
    }
  })

  it('🔴 one setting names the repository, and it can only be the one this runs in', () => {
    expect(job('plan')).toContain('RELEASE_REPO: ${{ vars.RELEASE_REPO || github.repository }}')
    expect(job('plan')).toContain('if [ "$RELEASE_REPO" != "$GITHUB_REPOSITORY" ]; then')
  })

  it('🔴 each build is checked — the platform, then its update files — before anything is published', () => {
    expect(job('windows')).toContain(
      'run: node scripts/windows-packaged-check.mjs apps/desktop/dist/win-unpacked',
    )
    expect(job('windows')).toContain('run: node scripts/release-check.mjs apps/desktop/dist')
    expect(job('macos')).toContain('--mac dmg zip dir --arm64')
    expect(job('macos')).toContain('-c.mac.identity=-')
    expect(job('macos')).toContain(
      'run: node scripts/macos-packaged-check.mjs apps/desktop/dist/mac-arm64/BroCrew.app',
    )
    expect(job('macos')).toContain('run: node scripts/release-check.mjs apps/desktop/dist')
    expect(job('publish')).toContain(
      'needs: [plan, windows, macos, recovery-windows, recovery-macos]',
    )
  })

  it('🔴 nothing is published unless the recovery window passed its real-entry check on both systems, in this run', () => {
    // Their evidence is an artifact of this run, and only the builds' files reach the release.
    expect(job('publish')).toMatch(/pattern: release-\*\n {10}path: release\n/)
    for (const [name, runner] of [
      ['recovery-windows', 'windows-2022'],
      ['recovery-macos', 'macos-15'],
    ]) {
      const block = job(name)
      expect(block).toContain('    uses: ./.github/workflows/recovery-real-entry.yml')
      expect(block).toContain(`      runner: ${runner}`)
      // Jobs of this run, never skipped by a condition, so `publish` cannot pass without them.
      expect(block).not.toMatch(/^ {4}if:/m)
    }
    const called = readFileSync(
      join(here, '../../.github/workflows/recovery-real-entry.yml'),
      'utf8',
    )
    expect(called).toMatch(/^on:\n {2}workflow_call:\n/m)
    expect(called).toContain('run: node scripts/recovery-real-entry-check.mjs --no-build')
    // The check's own step fails the job: no `continue-on-error`, no condition.
    const step = called.slice(called.indexOf('      - name: Recovery real-entry check\n'))
    const own = step.slice(0, step.indexOf('\n      - ', 1))
    expect(own).toContain('run: node scripts/recovery-real-entry-check.mjs --no-build')
    expect(own).not.toMatch(/continue-on-error|\n {8}if:/)
  })

  it('⛔ a release reads its feed anonymously: no build names a private feed or a token', () => {
    for (const name of ['windows', 'macos']) {
      expect(job(name)).toContain('-c.publish.provider=github')
      expect(job(name)).not.toMatch(/publish\.(private|token)/)
    }
  })

  it('🔴 only the publish job may write, in the release environment, and it publishes one release whole', () => {
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    const publish = job('publish')
    expect(publish).toContain('    environment: release')
    expect(publish).toMatch(
      /permissions:\n {6}contents: write\n {6}id-token: write\n {6}attestations: write/,
    )
    expect(publish).toContain('--verify-tag --draft')
    expect(publish).toContain('--draft=false --prerelease --latest=false')
    expect(publish).toContain('--draft=false --latest')
    expect(publish).toContain('if: ${{ !github.event.repository.private }}')
    expect(publish).toContain('uses: actions/attest-build-provenance@v2')
  })
})
