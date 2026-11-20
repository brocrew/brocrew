import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'

// release.yml's publish job, run against a `gh` that answers with supplied GitHub responses.
// The job runs on Linux, and the fake `gh` is a POSIX script, so those cases skip on Windows.

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jobs = builderTools.loadYaml(
  readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'),
).jobs
const SHA = '271d62dd8a24c87301f25800995db02264d94e26'
const ID = '445780131'
const RELEASE = `repos/brocrew/brocrew/releases/${ID}`
const ASSETS = [
  'BroCrew-Setup-0.2.27-x64.exe',
  'BroCrew-Setup-0.2.27-x64.exe.blockmap',
  'latest.yml',
  'BroCrew-0.2.27-arm64.dmg',
  'BroCrew-0.2.27-arm64.dmg.blockmap',
  'BroCrew-0.2.27-arm64-mac.zip',
  'BroCrew-0.2.27-arm64-mac.zip.blockmap',
  'latest-mac.yml',
].map((name, index) => ({ id: 300 + index, name, size: 1000 + index }))

// It logs each call and answers from GH_ANSWERS, as `gh api` does: the body on stdout, and on an
// HTTP error a line on stderr and exit status 1. A list answers the same call in turn.
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs')
const args = process.argv.slice(2)
const method = args.includes('PATCH') ? 'PATCH' : 'GET'
const input = method === 'PATCH' ? JSON.parse(readFileSync(0, 'utf8')) : null
const call = JSON.stringify({ args, input })
const before = existsSync(process.env.GH_CALLS) ? readFileSync(process.env.GH_CALLS, 'utf8') : ''
const turn = before.split('\\n').filter((line) => line === call).length
appendFileSync(process.env.GH_CALLS, call + '\\n')
const path = args.find((arg) => arg.startsWith('repos/'))
const answers = [].concat(JSON.parse(readFileSync(process.env.GH_ANSWERS, 'utf8'))[method + ' ' + path])
const answer = answers[Math.min(turn, answers.length - 1)]
process.stdout.write(JSON.stringify(answer.body))
if (answer.status >= 400) {
  process.stderr.write('gh: ' + answer.body.message + ' (HTTP ' + answer.status + ')\\n')
  process.exit(1)
}
`

const itOnPosix = it.skipIf(process.platform === 'win32')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const draft = (changes = {}) => ({
  id: Number(ID),
  draft: true,
  tag_name: 'v0.2.27',
  assets: ASSETS.map((asset) => ({ ...asset, state: 'uploaded', download_count: 0 })),
  ...changes,
})
const published = (changes = {}) => ({
  status: 200,
  body: draft({
    draft: false,
    html_url: 'https://github.com/brocrew/brocrew/releases/tag/v0.2.27',
    ...changes,
  }),
})

/** Runs the publish step with these answers; its exit status, output and the calls it made. */
function publish({
  tagged = SHA,
  release = { status: 200, body: draft() },
  patch = published(),
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'publish-release-'))
  roots.push(root)
  writeFileSync(join(root, 'gh'), FAKE_GH, { mode: 0o755 })
  writeFileSync(
    join(root, 'answers.json'),
    JSON.stringify({
      'GET repos/brocrew/brocrew/commits/v0.2.27': { status: 200, body: { sha: tagged } },
      [`GET ${RELEASE}`]: release,
      [`PATCH ${RELEASE}`]: patch,
    }),
  )
  const step = jobs.publish.steps.at(-1)
  const supplied = {
    'github.token': 'a-token',
    'needs.plan.outputs.repo': 'brocrew/brocrew',
    'needs.plan.outputs.version': '0.2.27',
    'needs.draft.outputs.id': ID,
    'needs.draft.outputs.assets': JSON.stringify(ASSETS),
  }
  const env = { ...process.env, GITHUB_SHA: SHA, PATH: `${root}:${process.env.PATH}` }
  for (const [name, value] of Object.entries(step.env)) {
    env[name] = value.replace(/\$\{\{ (.+?) \}\}/g, (_, expression) => supplied[expression])
  }
  Object.assign(env, { GH_CALLS: join(root, 'calls'), GH_ANSWERS: join(root, 'answers.json') })
  const result = spawnSync('bash', ['-c', step.run], { cwd: repo, env, encoding: 'utf8' })
  const calls = readFileSync(env.GH_CALLS, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls }
}

const READS = [
  { args: ['api', 'repos/brocrew/brocrew/commits/v0.2.27'], input: null },
  { args: ['api', RELEASE], input: null },
]
const PUBLISH = {
  args: ['api', '--method', 'PATCH', RELEASE, '--input', '-'],
  input: { tag_name: 'v0.2.27', target_commitish: SHA, draft: false, make_latest: 'true' },
}

describe('release.yml publishes the approved draft by its id', () => {
  it('waits for the release environment, and takes the id and files the draft job recorded', () => {
    expect(jobs.publish.environment).toBe('release')
    expect(jobs.publish['runs-on']).toBe('ubuntu-latest')
    expect(jobs.publish.needs).toEqual(['plan', 'draft'])
    expect(jobs.draft.outputs).toEqual({
      id: '${{ steps.draft.outputs.id }}',
      assets: '${{ steps.draft.outputs.assets }}',
    })
    const record = jobs.draft.steps.find((step) => step.id === 'draft').run
    expect(record).toContain('select(.draft and .tag_name == \\"$tag\\") | .id')
    expect(record).toContain('[.assets[] | {id, name, size}] | tojson')
  })

  itOnPosix(
    'publishes the draft with its tag, commit and latest, after checking the tag and its files',
    () => {
      const run = publish()
      expect(run.stderr).toBe('')
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('Published https://github.com/brocrew/brocrew/releases/tag/v0.2.27\n')
      expect(run.calls).toEqual([...READS, PUBLISH])
    },
  )

  itOnPosix('a draft whose tag an edit dropped is published by id, with its tag sent again', () => {
    const untagged = draft({ tag_name: 'untagged-246ca2b9623cbca9391b' })
    const run = publish({ release: { status: 200, body: untagged } })
    expect(run.status).toBe(0)
    expect(run.calls).toEqual([...READS, PUBLISH])
  })

  itOnPosix(
    'a tag that moved, files that changed, or a draft it cannot read stop it before publishing',
    () => {
      const moved = publish({ tagged: 'f'.repeat(40) })
      expect(moved.status).toBe(1)
      expect(moved.stderr).toBe(
        `Release ${ID} was not published: v0.2.27 points at ${'f'.repeat(40)}, not ${SHA}\n`,
      )
      expect(moved.calls).toEqual(READS.slice(0, 1))

      const replaced = ASSETS.map((asset) =>
        asset.name === 'latest.yml' ? { ...asset, id: 9 } : asset,
      )
      const changed = publish({ release: { status: 200, body: draft({ assets: replaced }) } })
      expect(changed.status).toBe(1)
      expect(changed.stderr).toMatch(
        new RegExp(`^Release ${ID} was not published: its files changed since the draft job: \\[`),
      )
      expect(changed.stderr).toContain('{"id":9,"name":"latest.yml","size":1002}')
      expect(changed.calls).toEqual(READS)

      const missing = publish({ release: { status: 404, body: { message: 'Not Found' } } })
      expect(missing.stderr).toBe(
        `Release ${ID} was not published: gh api ${RELEASE} failed: gh: Not Found (HTTP 404)\n`,
      )
      expect(missing.calls).toEqual(READS)
    },
  )

  itOnPosix(
    'after a failed or unexpected publish answer, it reads the release once and says what it saw',
    () => {
      const lost = { status: 502, body: { message: 'Bad Gateway' } }
      const nowPublic = { status: 200, body: draft({ draft: false }) }
      const uncertain = publish({
        release: [{ status: 200, body: draft() }, nowPublic],
        patch: lost,
      })
      expect(uncertain.status).toBe(1)
      expect(uncertain.stderr).toBe(
        `Release ${ID} may be published: gh api ${RELEASE} failed: gh: Bad Gateway (HTTP 502); ` +
          'GitHub now reads draft: false, tag: v0.2.27\n',
      )
      expect(uncertain.calls).toEqual([...READS, PUBLISH, READS[1]])

      const unread = publish({ release: [{ status: 200, body: draft() }, lost], patch: lost })
      expect(unread.stderr).toBe(
        `Release ${ID} may be published: gh api ${RELEASE} failed: gh: Bad Gateway (HTTP 502); ` +
          `its state could not be read: gh api ${RELEASE} failed: gh: Bad Gateway (HTTP 502)\n`,
      )
      expect(unread.calls).toEqual([...READS, PUBLISH, READS[1]])

      const odd = publish({ patch: published({ draft: true, tag_name: 'untagged-1' }) })
      expect(odd.status).toBe(1)
      expect(odd.stderr).toBe(
        `Release ${ID} may be published: GitHub answered draft: true, tag: untagged-1; ` +
          'GitHub now reads draft: true, tag: v0.2.27\n',
      )
      expect(odd.calls).toEqual([...READS, PUBLISH, READS[1]])
    },
  )
})
