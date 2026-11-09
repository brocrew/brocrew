import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HEADER, rowsFrom, summaryOf, withTheDay } from '../download-counts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

// The public repository's own checks (docs/public-repo-checks.md). Every name here is made up, and
// every run reads a scratch home and an environment this test builds.

describe('the private-name check, run as CI runs it', () => {
  let scratch
  let repo
  let gitEnv
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env: gitEnv })
  const commit = (file, text, message) => {
    writeFileSync(join(repo, file), text)
    git('add', file)
    git('-c', 'user.name=BroCrew', '-c', 'user.email=brocrew@example.org', 'commit', '-qm', message)
  }
  const check = (patterns, ...args) => {
    try {
      const out = execFileSync(process.execPath, [join(ROOT, 'scripts/leak-check.mjs'), ...args], {
        cwd: repo,
        env: { ...gitEnv, ...patterns },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      })
      return { status: 0, out }
    } catch (error) {
      return { status: error.status, out: error.stderr }
    }
  }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'public-repo-checks-'))
    repo = join(scratch, 'repo')
    mkdirSync(repo)
    gitEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: scratch,
      GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    }
    git('init', '-q', '-b', 'main')
    commit('readme', 'Plain words\n', 'The fresh export')
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))

  it('fails with no names configured', () => {
    expect(check({}).status).toBe(1)
    expect(check({ BROBOT_LEAK_PATTERNS: ' \n# a comment\n' }).status).toBe(1)
  })

  it('passes a tree and commits that carry no name', () => {
    expect(check({ BROBOT_LEAK_PATTERNS: 'Acme Widgets\n' }, 'HEAD').status).toBe(0)
  })

  it('names a file whose text or name carries a name, in any case, without the line', () => {
    commit('notes', 'made for acme widgets\n', 'Notes')
    commit('ACME-WIDGETS-plan', 'x\n', 'Plan')
    const { status, out } = check({ BROBOT_LEAK_PATTERNS: 'Acme Widgets\nacme-widgets\n' })
    expect(status).toBe(1)
    expect(out).toContain('notes:1')
    expect(out).toContain('ACME-WIDGETS-plan (its name)')
    expect(out).not.toContain('made for')
  })

  it('names a commit whose message carries a leak or commit name', () => {
    const before = git('rev-parse', 'HEAD').toString().trim()
    commit('readme', 'More plain words\n', 'Asked by Zoe Quill')
    const sha = git('rev-parse', '--short', 'HEAD').toString().trim()
    const names = { BROBOT_LEAK_PATTERNS: 'Acme Widgets\n', BROBOT_COMMIT_PATTERNS: 'zoe quill\n' }
    const { status, out } = check(names, `${before}..HEAD`)
    expect(status).toBe(1)
    expect(out).toContain(`commit ${sha}`)
    expect(check(names).status).toBe(0)
  })
})

describe('the download record', () => {
  const releases = [
    [
      {
        tag_name: 'v1.0.0',
        draft: false,
        assets: [
          { name: 'b.zip', download_count: 3 },
          { name: 'a "1".exe', download_count: 5 },
        ],
      },
      { tag_name: 'v1.1.0-beta.1', draft: true, assets: [{ name: 'x.zip', download_count: 9 }] },
    ],
    [{ tag_name: 'v0.9.0', draft: false, assets: [{ name: 'c.zip', download_count: 1 }] }],
  ]

  it('one row per file of every published release, sorted, drafts left out', () => {
    expect(rowsFrom(releases, '2026-10-06')).toEqual([
      { day: '2026-10-06', release: 'v0.9.0', file: 'c.zip', downloads: 1 },
      { day: '2026-10-06', release: 'v1.0.0', file: 'a "1".exe', downloads: 5 },
      { day: '2026-10-06', release: 'v1.0.0', file: 'b.zip', downloads: 3 },
    ])
    expect(() => rowsFrom(releases, 'today')).toThrow(/not a day/)
  })

  it('a day’s rows replace that day’s, and the other days stay', () => {
    const first = withTheDay('', rowsFrom(releases, '2026-10-05'), '2026-10-05')
    const second = withTheDay(first, rowsFrom(releases, '2026-10-06'), '2026-10-06')
    const again = withTheDay(second, rowsFrom(releases, '2026-10-06'), '2026-10-06')
    expect(again).toBe(second)
    const lines = second.trim().split('\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines).toHaveLength(7)
    expect(lines).toContain('2026-10-06,v1.0.0,"a ""1"".exe",5')
  })

  it('a summary per release', () => {
    expect(summaryOf(rowsFrom(releases, '2026-10-06'), '2026-10-06')).toContain('| v1.0.0 | 8 |')
    expect(summaryOf([], '2026-10-06')).toContain('No release has any file yet.')
  })
})

describe('the workflows · run on a public repository, whatever it is named, and on no private one', () => {
  const GUARD = 'if: ${{ !github.event.repository.private }}'
  const checks = read('.github/workflows/public-checks.yml')
  const counts = read('.github/workflows/download-counts.yml')
  /** The jobs a workflow declares: the keys two spaces in, below `jobs:`. */
  const jobsOf = (yaml) =>
    [...yaml.slice(yaml.indexOf('\njobs:\n')).matchAll(/^ {2}(\w[\w-]*):\n/gm)].map((one) => one[1])

  const pluginGuardOf = (platform) =>
    `    if: github.repository == 'brocrew/brocrew' && github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/gate/plugin-v2-${platform}-')`
  const checkWorkflowGuards = (yaml, platform = null) => {
    let ordinary = yaml
    if (platform !== null) {
      const jobsAt = yaml.indexOf('\njobs:\n')
      if (jobsAt < 0 || !['mac', 'windows'].includes(platform))
        throw new Error('Workflow repository guard differs')
      const jobs = [...yaml.slice(jobsAt).matchAll(/^ {2}(\w[\w-]*):\n/gm)]
      const reviews = jobs.filter((job) => job[1] === 'plugin-v2-review')
      if (reviews.length !== 1) throw new Error('Workflow repository guard differs')
      const index = jobs.indexOf(reviews[0])
      const start = jobsAt + reviews[0].index
      const end = index + 1 < jobs.length ? jobsAt + jobs[index + 1].index : yaml.length
      const block = yaml.slice(start, end)
      const conditions = block.match(/^ {4}if:.*$/gm) ?? []
      if (conditions.length !== 1 || conditions[0] !== pluginGuardOf(platform))
        throw new Error('Workflow repository guard differs')
      ordinary = yaml.slice(0, start) + yaml.slice(end)
    }
    expect(ordinary).not.toMatch(/github\.repository\s*==/)
    expect(yaml).not.toContain('BROBOT_PUBLIC_CHECKS')
  }

  it.each([
    ['schedule', '', 'main', 'develop', 'develop'],
    ['schedule', '', 'main', '', 'main'],
    ['schedule', '', 'develop', '', 'develop'],
    ['workflow_dispatch', 'release-candidate', 'main', 'develop', 'release-candidate'],
    ['workflow_dispatch', '', 'main', 'develop', 'triggering-commit'],
    ['push', '', 'main', 'develop', 'triggering-commit'],
  ])(
    'coverage selects the ref for %s (%s, default %s, override %s)',
    (event, commit, branch, override, expected) => {
      const coverage = read('.github/workflows/coverage.yml')
      const expression = coverage.match(/^ {2}MEASURE: \$\{\{ (.+) \}\}$/m)?.[1]
      expect(expression).toBeDefined()
      const measure = new Function('inputs', 'github', 'vars', `return (${expression})`)(
        { commit },
        {
          event_name: event,
          event: { repository: { default_branch: branch } },
          sha: 'triggering-commit',
        },
        { COVERAGE_BRANCH: override },
      )
      expect(measure).toBe(expected)
      const checkouts = coverage.split(/- uses: actions\/checkout@[^\n]+/).slice(1)
      expect(checkouts).toHaveLength(2)
      for (const checkout of checkouts) {
        expect(checkout.split(/\n\s*- /)[0]).toContain('ref: ${{ env.MEASURE }}')
      }
    },
  )

  it.each(['claude-code.yml', 'download-counts.yml'])(
    '%s keeps scheduled checkouts on the triggering default branch',
    (name) => {
      const workflow = read(`.github/workflows/${name}`)
      expect(workflow).toMatch(/^ {2}schedule:/m)
      const checkouts = workflow.split(/- uses: actions\/checkout@[^\n]+/).slice(1)
      expect(checkouts.length).toBeGreaterThan(0)
      for (const checkout of checkouts) {
        expect(checkout.split(/\n\s*- /)[0]).not.toMatch(/^\s+ref:/m)
      }
    },
  )

  it('the private-name check runs in the public checks, and publication waits for it', () => {
    expect(checks).toContain('run: node scripts/leak-check.mjs "$REVISIONS"\n')
    expect(checks).not.toMatch(/gitleaks git [^\n]*--verbose/)
    const release = read('.github/workflows/release.yml')
    expect(release).toContain('run: node scripts/leak-check.mjs\n')
    const jobs = release.slice(release.indexOf('\njobs:\n')).split(/^ {2}([\w-]+):\n/m)
    expect(jobs[jobs.indexOf('draft') + 1]).toMatch(/^ {4}needs: \[plan, leak, /m)
  })

  it('ordinary jobs keep public guards and plugin reviews stay restricted', () => {
    expect(jobsOf(checks)).toEqual(['commits', 'secrets'])
    expect(checks.split(GUARD).length - 1, 'one guard per job').toBe(2)
    // A scheduled run's event names no repository, so the record waits on GitHub's own answer.
    expect(jobsOf(counts)).toEqual(['visibility', 'record'])
    expect(counts).toContain('gh api "repos/$GITHUB_REPOSITORY" --jq \'.private | not\'')
    expect(counts).toContain(
      "    needs: visibility\n    if: needs.visibility.outputs.public == 'true'\n",
    )
    for (const workflow of ['public-checks', 'download-counts', 'release', 'windows', 'macos']) {
      const yaml = read(`.github/workflows/${workflow}.yml`)
      const platform = { windows: 'windows', macos: 'mac' }[workflow] ?? null
      checkWorkflowGuards(yaml, platform)
    }
  })

  it.each([
    ['windows', 'windows'],
    ['macos', 'mac'],
  ])(
    '%s rejects malformed plugin guards and ordinary-job repository restrictions',
    (workflow, platform) => {
      const yaml = read(`.github/workflows/${workflow}.yml`)
      const guard = pluginGuardOf(platform)
      const repository = "github.repository == 'brocrew/brocrew'"
      const event = "github.event_name == 'workflow_dispatch'"
      const prefix = `startsWith(github.ref, 'refs/heads/gate/plugin-v2-${platform}-')`
      expect(yaml.split(guard)).toHaveLength(2)
      for (const [label, changedGuard] of [
        ['missing guard', '    if: true'],
        ['missing repository', guard.replace(`${repository} && `, '')],
        ['wrong repository', guard.replace(repository, "github.repository == 'example/other'")],
        ['missing event', guard.replace(`${event} && `, '')],
        ['wrong event', guard.replace(event, "github.event_name == 'push'")],
        ['missing prefix', guard.replace(` && ${prefix}`, '')],
        [
          'wrong prefix',
          guard.replace(prefix, "startsWith(github.ref, 'refs/heads/gate/plugin-v2-other-')"),
        ],
      ]) {
        const changed = yaml.replace(guard, changedGuard)
        expect(changed, label).not.toBe(yaml)
        expect(() => checkWorkflowGuards(changed, platform), label).toThrow()
      }
      const ordinaryLeak = yaml.replace(
        '\njobs:\n',
        `\njobs:\n  ordinary-repository-leak:\n    if: ${repository}\n    runs-on: ubuntu-latest\n    steps: []\n`,
      )
      expect(ordinaryLeak).not.toBe(yaml)
      expect(() => checkWorkflowGuards(ordinaryLeak, platform)).toThrow()
      const missingReview = yaml.replace('  plugin-v2-review:\n', '  another-review:\n')
      expect(missingReview).not.toBe(yaml)
      expect(() => checkWorkflowGuards(missingReview, platform)).toThrow()
      const duplicateReview = `${yaml}\n  plugin-v2-review:\n${guard}\n    steps: []\n`
      expect(() => checkWorkflowGuards(duplicateReview, platform)).toThrow()
    },
  )

  it('reads only its own secrets, and only the download job may write', () => {
    const secrets = [
      ...new Set([...checks.matchAll(/\bsecrets\.(\w+)/g)].map((one) => one[1])),
    ].sort()
    expect(secrets).toEqual(['BROBOT_COMMIT_PATTERNS', 'BROBOT_LEAK_PATTERNS'])
    expect(checks).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(checks).not.toContain('contents: write')
    expect(checks.match(/persist-credentials: false/g)).toHaveLength(2)
    expect(counts.match(/contents: write/g)).toHaveLength(1)
    expect(counts).toContain('git push origin download-counts')
  })

  it('gitleaks is pinned to a version and its sha256, and the scan is redacted', () => {
    expect(checks).toMatch(/GITLEAKS_VERSION: \d+\.\d+\.\d+\n/)
    expect(checks).toMatch(/GITLEAKS_SHA256: [0-9a-f]{64}\n/)
    expect(checks).toContain('sha256sum -c -')
    const scan = checks.indexOf('gitleaks git .')
    expect(scan).toBeGreaterThan(0)
    expect(checks.slice(scan)).toContain('--redact')
  })

  it('one document says all of it', () => {
    const doc = read('docs/public-repo-checks.md')
    for (const name of [
      'whenever the repository is public',
      'BROBOT_LEAK_PATTERNS',
      'BROBOT_COMMIT_PATTERNS',
      'public-checks.yml',
      'download-counts.yml',
      '.gitleaks.toml',
    ]) {
      expect(doc, name).toContain(name)
    }
  })
})
