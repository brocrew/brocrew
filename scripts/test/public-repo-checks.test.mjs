import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cardIdsIn,
  commitCheck,
  commitProblems,
  commitsIn,
  GITHUB_IDENTITIES,
  identitiesFrom,
  pullRequestCheck,
} from '../leak-check.mjs'
import { aFakeSecret, redactionVerdict } from '../secret-scan-redaction-check.mjs'
import { HEADER, rowsFrom, summaryOf, withTheDay } from '../download-counts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * ⚑ **The public repository's own checks** (`docs/public-repo-checks.md`): the commit check, the
 * secret scan's redaction proof, the download record, and that each workflow does nothing outside
 * the public repository. ⛔ Every name here is made up, and every run reads a scratch home and an
 * environment this test builds, never the machine's own.
 */

const PUBLIC = 'BroCrew <343827643+brocrew@users.noreply.github.com>'

describe('the commit check · card ids', () => {
  it('finds each kind the team writes, as whole words, each once and in order', () => {
    expect(
      cardIdsIn(
        'Fixes W4.197 and D-016b, after F093; see HO-088, UI-012, EXT-010, T-001, R92 and W4.',
      ),
    ).toEqual(['W4.197', 'D-016b', 'F093', 'HO-088', 'UI-012', 'EXT-010', 'T-001', 'R92', 'W4'])
    expect(cardIdsIn('W1.2.3 then W1.2.3 again')).toEqual(['W1.2.3'])
  })

  it('leaves plain words alone', () => {
    for (const plain of [
      'Windows 10 and the W3C spec',
      'press F12, or F1 for help',
      'a T-shirt, the D-day plan, R&D and the UI kit',
      'version v1.2.3 and node 24',
      'Work folders: a give names its folder',
    ]) {
      expect(cardIdsIn(plain), plain).toEqual([])
    }
  })
})

describe('the commit check · what a commit may carry', () => {
  const aCommit = (over) => ({
    sha: 'a'.repeat(40),
    author: PUBLIC,
    committer: PUBLIC,
    message: 'Plain words about a change\n',
    ...over,
  })

  it('passes plain words under the public identity', () => {
    expect(commitProblems([aCommit({})], { patterns: ['Zoe'], identities: [PUBLIC] })).toEqual([])
  })

  it('names the part and the kind of problem, and never the pattern', () => {
    const problems = commitProblems(
      [
        aCommit({ message: 'Asked by zoe quill\n' }),
        aCommit({ author: 'Zoe Quill <zoe@example.org>' }),
      ],
      { patterns: ['Zoe Quill', 'Zoe'], identities: null },
    )
    expect(problems.map(({ part }) => part)).toEqual(['message', 'author'])
    expect(JSON.stringify(problems).toLowerCase()).not.toContain('zoe')
  })

  it('on a push, an identity not listed fails; GitHub’s own are always allowed', () => {
    const identities = identitiesFrom({ env: { BROBOT_COMMIT_IDENTITIES: `${PUBLIC}\n` } })
    expect(identities).toEqual([PUBLIC, ...GITHUB_IDENTITIES])
    const problems = commitProblems(
      [
        aCommit({ committer: GITHUB_IDENTITIES[0] }),
        aCommit({ author: 'Somebody <somebody@example.org>' }),
      ],
      { patterns: [], identities },
    )
    expect(problems).toEqual([
      {
        sha: 'aaaaaaaaa',
        part: 'author',
        says: 'is not an identity this repository commits under',
      },
    ])
    // ⚑ With none listed, identities are not checked at all.
    expect(identitiesFrom({ env: {} })).toBeNull()
  })

  it('a card id fails a message, named', () => {
    const problems = commitProblems([aCommit({ message: 'Close W4.219\n' })], {
      patterns: [],
      identities: null,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].says).toContain('W4.219')
  })
})

describe('the commit check · on a repository', () => {
  let scratch
  let repo
  let home
  /** ⛔ git's own environment: a scratch home, and no global or system config read. */
  let gitEnv
  const git = (args, encoding) =>
    execFileSync('git', args, { env: gitEnv, ...(encoding ? { encoding } : {}) })
  const commit = (message, who) => {
    writeFileSync(join(repo, 'file'), `${message}\n`)
    git(['-C', repo, 'add', 'file'])
    git([
      '-C',
      repo,
      '-c',
      `user.name=${who.name}`,
      '-c',
      `user.email=${who.email}`,
      'commit',
      '-q',
      '-m',
      message,
    ])
    return git(['-C', repo, 'rev-parse', 'HEAD'], 'utf8').trim()
  }
  const publicOne = { name: 'BroCrew', email: '343827643+brocrew@users.noreply.github.com' }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'public-repo-checks-'))
    repo = join(scratch, 'repo')
    home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    gitEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    }
    git(['-C', repo, 'init', '-q', '-b', 'main'])
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))

  it('fails the commits that break a rule, says which, and prints no pattern', () => {
    const first = commit('The fresh export', publicOne)
    const named = commit('Asked by Zoe, done', publicOne)
    const carded = commit('Finish W4.219', publicOne)
    const other = commit('Plain words', { name: 'Zoe Quill', email: 'zoe@example.org' })
    const env = {
      BROBOT_COMMIT_PATTERNS: 'Zoe Quill\nZoe\n',
      BROBOT_COMMIT_IDENTITIES: `${PUBLIC}\n`,
    }
    const { passed, text } = commitCheck([`${first}..HEAD`], { root: repo, env, home, gitEnv })
    expect(passed).toBe(false)
    expect(text).toContain('3 commits')
    expect(text).toContain(`${named.slice(0, 9)}: its message carries a name`)
    expect(text).toContain(`${carded.slice(0, 9)}: its message names a card id (W4.219)`)
    expect(text).toContain(`${other.slice(0, 9)}: its author carries a name`)
    expect(text).toContain('not configured, so not checked: leak patterns')
    expect(text.toLowerCase()).not.toContain('zoe')
    expect(text).not.toContain(first.slice(0, 9))
  })

  it('passes plain words under the public identity, and still checks card ids with nothing configured', () => {
    commit('The fresh export', publicOne)
    commit('Plain words', publicOne)
    expect(commitCheck(['HEAD'], { root: repo, env: {}, home, gitEnv })).toEqual({
      passed: true,
      text: 'commit check: 2 commits, nothing found (not configured, so not checked: leak patterns, commit patterns, identities)',
    })
    commit('Fix D-042', publicOne)
    expect(commitCheck(['HEAD~1..HEAD'], { root: repo, env: {}, home, gitEnv }).passed).toBe(false)
  })

  it('⛔ an annotated tag’s tagger and message are read as a commit’s are', () => {
    commit('The fresh export', publicOne)
    git([
      '-C',
      repo,
      '-c',
      'user.name=Zoe Quill',
      '-c',
      'user.email=zoe@example.org',
      'tag',
      '-a',
      'v1.0.0',
      '-m',
      'Release for W4.219',
    ])
    const env = {
      BROBOT_COMMIT_PATTERNS: 'Zoe Quill\n',
      BROBOT_COMMIT_IDENTITIES: `${PUBLIC}\n`,
    }
    const { passed, text } = commitCheck([], { root: repo, env, home, gitEnv, tags: ['v1.0.0'] })
    expect(passed).toBe(false)
    expect(text).toContain('0 commits, 1 annotated tag')
    expect(text).toContain('tag v1.0.0: its message names a card id (W4.219)')
    expect(text).toContain('tag v1.0.0: its author carries a name')
    expect(text.toLowerCase()).not.toContain('zoe')
    // ⚑ A lightweight tag carries no tagger and no message.
    git(['-C', repo, 'tag', 'v1.0.1'])
    expect(commitCheck([], { root: repo, env, home, gitEnv, tags: ['v1.0.1'] }).text).toContain(
      '0 commits, 0 annotated tags',
    )
  })

  it('a message that carries the field separator is read whole', () => {
    commit('Plain words \x1f then W4.219', publicOne)
    const [read] = commitsIn(repo, ['HEAD'], gitEnv)
    expect(read?.message).toContain('then W4.219')
  })

  it('⛔ --require-patterns needs the commit patterns too, and --require-identities the identities', () => {
    commit('Plain words', publicOne)
    const leakOnly = { BROBOT_LEAK_PATTERNS: 'acme-widgets\n' }
    expect(
      commitCheck(['HEAD'], { root: repo, env: leakOnly, home, gitEnv, required: true }).text,
    ).toBe(
      'commit check: this run requires the commit patterns (BROBOT_COMMIT_PATTERNS), and they are not configured',
    )
    const both = { ...leakOnly, BROBOT_COMMIT_PATTERNS: 'Zoe\n' }
    expect(
      commitCheck(['HEAD'], { root: repo, env: both, home, gitEnv, required: true }).passed,
    ).toBe(true)
    expect(
      commitCheck(['HEAD'], {
        root: repo,
        env: both,
        home,
        gitEnv,
        required: true,
        identitiesRequired: true,
      }).text,
    ).toContain('requires the identities (BROBOT_COMMIT_IDENTITIES)')
  })
})

describe('a pull request’s title and branch name', () => {
  it('are plain words, or the check says which of them is not, and never a pattern', () => {
    const home = mkdtempSync(join(tmpdir(), 'public-repo-checks-pr-'))
    try {
      const env = { BROBOT_COMMIT_PATTERNS: 'Zoe\n' }
      expect(pullRequestCheck({ title: 'Plain words', branch: 'plain-words', env, home })).toEqual({
        passed: true,
        text: 'pull request check: its title and branch name are plain words',
      })
      const { passed, text } = pullRequestCheck({
        title: 'Asked by Zoe',
        branch: 'fix-W4.219',
        env,
        home,
      })
      expect(passed).toBe(false)
      expect(text).toContain('its title carries a name')
      expect(text).toContain('its branch name names W4.219')
      expect(text.toLowerCase()).not.toContain('zoe')
      expect(
        pullRequestCheck({ title: 'x', branch: 'y', env: {}, home, required: true }).passed,
      ).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('the command, run as CI runs it', () => {
  const homes = []
  afterEach(() => {
    for (const one of homes.splice(0)) rmSync(one, { recursive: true, force: true })
  })
  const node = (args, env) => {
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts/leak-check.mjs'), ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      })
      return 0
    } catch (error) {
      return error.status
    }
  }
  /** ⛔ No pattern anywhere: an environment built here and a home with no config file. */
  const bare = () => {
    const home = mkdtempSync(join(tmpdir(), 'public-repo-checks-cli-'))
    homes.push(home)
    return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }
  }

  it('⛔ fails with --require-patterns and nothing configured, for the tree and for the commits', () => {
    expect(node(['--require-patterns'], bare())).toBe(1)
    expect(node(['--require-patterns', '--commits', 'HEAD'], bare())).toBe(1)
    expect(node(['--commits', 'HEAD', '--require-patterns'], bare())).toBe(1)
  })

  it('a pull request’s words come from the environment', () => {
    expect(
      node(['--pull-request'], { ...bare(), PR_TITLE: 'Plain words', PR_BRANCH: 'plain' }),
    ).toBe(0)
    expect(node(['--pull-request'], { ...bare(), PR_TITLE: 'Finish W4.219', PR_BRANCH: 'x' })).toBe(
      1,
    )
  })
})

describe('the secret scan · redaction, judged on made-up answers', () => {
  const secret = aFakeSecret()
  const body = secret.slice(4)
  const redacted = '[{"RuleID":"github-pat","Secret":"REDACTED","Match":"GITHUB_TOKEN=REDACTED"}]'

  it('a fresh fake secret has the shape gitleaks’ github-pat rule finds', () => {
    expect(secret).toMatch(/^ghp_[0-9A-Za-z]{36}$/)
    expect(aFakeSecret()).not.toBe(secret)
  })

  it('holds when it was found and hidden everywhere', () => {
    expect(
      redactionVerdict({ secret, status: 1, output: 'Secret: REDACTED', report: redacted }),
    ).toBeNull()
  })

  it('refuses a scan that found nothing, or showed any of it, or did not say REDACTED', () => {
    expect(redactionVerdict({ secret, status: 0, output: '', report: '[]' })).toContain('unproven')
    expect(
      redactionVerdict({
        secret,
        status: 1,
        output: `Secret: ${body.slice(5, 20)}`,
        report: redacted,
      }),
    ).toContain('printed')
    expect(
      redactionVerdict({
        secret,
        status: 1,
        output: '',
        report: redacted.replace('REDACTED', secret),
      }),
    ).toContain('report')
    expect(
      redactionVerdict({ secret, status: 1, output: '', report: '[{"RuleID":"github-pat"}]' }),
    ).toContain('REDACTED')
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

  it('⛔ the public checks and every release require the leak patterns, and check the tree’s file names', () => {
    expect(checks).toContain(
      'node scripts/leak-check.mjs $REQUIRE $IDENTITIES --commits "$REVISIONS"',
    )
    expect(checks).toContain('run: node scripts/leak-check.mjs $REQUIRE\n')
    expect(checks).toContain('--require-patterns --require-identities --tag "$GITHUB_REF_NAME"')
    expect(checks).toContain('run: node scripts/leak-check.mjs $REQUIRE --pull-request')
    // ⚑ Required wherever the secrets reach: not a fork's pull request, which gets none.
    expect(checks).toContain(
      "REQUIRE: ${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && '--require-patterns' || '' }}",
    )
    // ⛔ gitleaks prints no text around a finding.
    expect(checks).not.toMatch(/gitleaks git [^\n]*--verbose/)
    const release = read('.github/workflows/release.yml')
    expect(release).toContain('run: node scripts/leak-check.mjs --require-patterns\n')
    // ⚑ No build starts until the guard has passed.
    expect(release.match(/^ {4}needs: \[plan, leak\]$/gm)).toHaveLength(2)
    for (const beta of ['windows', 'macos']) {
      expect(read(`.github/workflows/${beta}.yml`)).toContain(
        'run: node scripts/leak-check.mjs --require-patterns\n',
      )
    }
  })

  it('every job carries the guard, and no workflow names the repository', () => {
    expect(jobsOf(checks)).toEqual(['commits', 'secrets'])
    expect(checks.split(GUARD).length - 1, 'one guard per job').toBe(2)
    // ⚑ A scheduled run's event names no repository, so the record waits on GitHub's own answer.
    expect(jobsOf(counts)).toEqual(['visibility', 'record'])
    expect(counts).toContain('gh api "repos/$GITHUB_REPOSITORY" --jq \'.private | not\'')
    expect(counts).toContain(
      "    needs: visibility\n    if: needs.visibility.outputs.public == 'true'\n",
    )
    for (const workflow of ['public-checks', 'download-counts', 'release', 'windows', 'macos']) {
      const yaml = read(`.github/workflows/${workflow}.yml`)
      expect(yaml, workflow).not.toMatch(/github\.repository ==/)
      expect(yaml, workflow).not.toContain('BROBOT_PUBLIC_CHECKS')
    }
  })

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

  it('gitleaks is pinned to a version and its sha256, and redaction is proven before the scan', () => {
    expect(checks).toMatch(/GITLEAKS_VERSION: \d+\.\d+\.\d+\n/)
    expect(checks).toMatch(/GITLEAKS_SHA256: [0-9a-f]{64}\n/)
    expect(checks).toContain('sha256sum -c -')
    const proof = checks.indexOf('node scripts/secret-scan-redaction-check.mjs')
    const scan = checks.indexOf('gitleaks git .')
    expect(proof).toBeGreaterThan(0)
    expect(scan).toBeGreaterThan(proof)
    expect(checks.slice(scan)).toContain('--redact')
  })

  it('one document says all of it', () => {
    const doc = read('docs/public-repo-checks.md')
    for (const name of [
      'whenever the repository is public',
      'BROBOT_LEAK_PATTERNS',
      'BROBOT_COMMIT_PATTERNS',
      'BROBOT_COMMIT_IDENTITIES',
      'public-checks.yml',
      'download-counts.yml',
      '.gitleaks.toml',
    ]) {
      expect(doc, name).toContain(name)
    }
  })
})
