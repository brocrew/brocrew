import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'
import { notesOf, platformsOf, titleOf, versionOf } from '../beta-release.mjs'
import { problemsWith, readUpdateFile, sha512Of } from '../release-check.mjs'

// The release BroCrew's updater reads: the version tags, release-check.mjs and release.yml.

const here = dirname(fileURLToPath(import.meta.url))
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('§1 · a version tag', () => {
  it('vX.Y.Z is a release and vX.Y.Z-beta.N a beta, of both platforms', () => {
    expect(versionOf('v0.1.0')).toEqual({ version: '0.1.0', beta: false })
    expect(versionOf('v0.2.0-beta.3')).toEqual({ version: '0.2.0-beta.3', beta: true })
    expect(platformsOf('v0.1.0')).toEqual(['windows', 'mac'])
    expect(titleOf('v0.1.0')).toBe('BroCrew 0.1.0')
    expect(titleOf('v0.2.0-beta.3')).toBe('BroCrew 0.2.0-beta.3 (beta)')
  })

  it('nothing else is a version — not a v without three numbers, nor another prerelease name', () => {
    for (const tag of ['v1', 'v0.1', 'v0.1.0-rc.1', 'v0.1.0-beta', '0.1.0', 'v0.1.0 x', 'beta-1']) {
      expect(versionOf(tag), tag).toBeNull()
    }
    expect(() => platformsOf('v0.1')).toThrow(/names no beta platform/)
  })

  it('its notes say which files to download, and which are the updater’s', () => {
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

  it('a release whose update file names its files truly, for the right repository, holds', () => {
    const { dist, appUpdate } = aRelease()
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([])
  })

  it('a sha512 that is not the file’s is an update nobody could install', () => {
    const wrong = createHash('sha512').update('something else').digest('base64')
    const { dist, appUpdate } = aRelease({ sum: wrong })
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([
      "latest.yml: BroCrew-Setup-0.1.0-x64.exe's sha512 is not the file's",
      "latest.yml's top-level sha512 is not BroCrew-Setup-0.1.0-x64.exe's",
    ])
  })

  it('another version, a missing file, or an app that looks elsewhere', () => {
    const { dist, appUpdate } = aRelease({ version: '0.0.9', repo: 'brobot2' })
    rmSync(join(dist, 'BroCrew-Setup-0.1.0-x64.exe'))
    expect(problemsWith(dist, '0.1.0', 'brocrew/brocrew', appUpdate)).toEqual([
      'latest.yml names version 0.0.9, not 0.1.0',
      `latest.yml names BroCrew-Setup-0.1.0-x64.exe, which is not in ${dist}`,
      "latest.yml's path (BroCrew-Setup-0.1.0-x64.exe) is not one of the files it names",
      "the app's app-update.yml does not say repo: brocrew",
    ])
  })

  it('an app built to read a private feed, or carrying a token, is not a release', () => {
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

  it('it reads the Mac’s update file, which names the zip and the dmg', () => {
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
  const jobs = builderTools.loadYaml(workflow).jobs
  it('a tag other than vX.Y.Z stops in plan', () => {
    const run = jobs.plan.steps[0].run
    for (const [tag, status] of [
      ['v0.2.14', 0],
      ['v0.2.14-rc1', 1],
      ['v0.2.14-candidate.1', 1],
    ]) {
      const check = run.slice(0, run.indexOf('if [ "$RELEASE_REPO"'))
      const result = spawnSync('bash', ['-c', check], {
        env: { ...process.env, GITHUB_REF_NAME: tag },
        encoding: 'utf8',
      })
      expect(result.status, tag).toBe(status)
    }
  })
})

describe('signed validation without a paid Windows build', () => {
  const repo = join(here, '../..')
  const load = builderTools.loadYaml
  const workflow = () => load(readFileSync(join(repo, '.github/workflows/macos.yml'), 'utf8'))
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'signing-route-'))
    roots.push(root)
    return root
  }

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
})
