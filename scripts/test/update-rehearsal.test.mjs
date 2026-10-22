import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appUpdateProblems,
  barrierOf,
  bMayGoOut,
  feedArgs,
  feedFromArgs,
  feedToken,
  LANES,
  LANES_SETTLE_WITHIN_MS,
  LOCAL_FEED_URL,
  planOf,
  SANDBOX_FEED,
  servedUpdateFile,
  statusContext,
  VERSION_A,
  VERSION_B,
} from '../lib/update-rehearsal.mjs'
import { SANDBOX_FILES, SANDBOX_WORKFLOW, stagedAs } from '../update-rehearsal-feed.mjs'

/**
 * The update rehearsal (run on GitHub's runners only). What can be held here, on any computer: what
 * a tag rehearses, what each package is built to read, how a harness reads the feed, the barrier
 * that holds B back until every lane is ready, and what goes to the private sandbox.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const workflow = read('.github/workflows/update-rehearsal.yml')
const sandbox = read(SANDBOX_WORKFLOW[0])
const PRIVATE = { kind: 'github', repo: SANDBOX_FEED, private: true }
const servers = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('what a tag rehearses', () => {
  it('a local tag serves the feed on the runner, and a plain one reads the private sandbox', () => {
    expect(planOf('update-rehearsal-local-3')).toEqual({
      mode: 'local',
      feed: { kind: 'generic', url: LOCAL_FEED_URL },
    })
    expect(planOf('update-rehearsal-12')).toEqual({ mode: 'private', feed: PRIVATE })
  })

  it('⛔ anything else rehearses nothing', () => {
    // ⛔ A public tag among them: there is no public rehearsal until the owner says yes, present.
    for (const tag of [
      'update-rehearsal',
      'update-rehearsal-x',
      'update-rehearsal-public-1',
      'v0.0.98',
      'update-test-1',
    ]) {
      expect(planOf(tag).refused).toBeDefined()
    }
  })

  it('A and B are stable versions, B the newer, so the default channel finds B', () => {
    expect(VERSION_A).toMatch(/^\d+\.\d+\.\d+$/)
    expect(VERSION_B.localeCompare(VERSION_A, undefined, { numeric: true })).toBe(1)
  })
})

describe('what each package is built to read, and how a harness is told', () => {
  it('a private feed says `private: true`, so the app reads its token from its environment', () => {
    expect(feedArgs(PRIVATE)).toEqual([
      '-c.publish.provider=github',
      '-c.publish.owner=brocrew',
      '-c.publish.repo=brobot-update-rehearsal',
      '-c.publish.private=true',
    ])
    expect(feedArgs({ kind: 'github', repo: 'o/r', private: false })).not.toContain(
      '-c.publish.private=true',
    )
    expect(feedArgs({ kind: 'generic', url: LOCAL_FEED_URL })).toEqual([
      '-c.publish.provider=generic',
      `-c.publish.url=${LOCAL_FEED_URL}`,
    ])
  })

  it('a package that reads its feed passes; one with a token, or another feed, does not', () => {
    const built = 'owner: brocrew\nrepo: brobot-update-rehearsal\nprovider: github\nprivate: true\n'
    expect(appUpdateProblems(built, PRIVATE)).toEqual([])
    expect(appUpdateProblems(`${built}token: ghp_x\n`, PRIVATE)).toContain('it carries a token')
    expect(appUpdateProblems(built.replace('private: true\n', ''), PRIVATE)).toEqual([
      'private is null, not true',
    ])
    expect(appUpdateProblems(built, { ...PRIVATE, private: false })).toEqual([
      'private is true, not null',
    ])
    expect(
      appUpdateProblems(`provider: generic\nurl: ${LOCAL_FEED_URL}\n`, {
        kind: 'generic',
        url: LOCAL_FEED_URL,
      }),
    ).toEqual([])
  })

  it('a harness is told a generic URL, or a GitHub repository and whether it is private', () => {
    expect(feedFromArgs({ 'feed-url': 'http://127.0.0.1:47122' })).toEqual({
      kind: 'generic',
      url: 'http://127.0.0.1:47122/',
    })
    expect(feedFromArgs({ 'feed-github': SANDBOX_FEED, 'feed-private': true })).toEqual(PRIVATE)
    expect(() => feedFromArgs({ 'feed-private': true })).toThrow(
      '--feed-private needs --feed-github',
    )
    expect(() => feedFromArgs({ 'feed-github': 'nope' })).toThrow(
      '--feed-github names no repository',
    )
  })

  it('⛔ only a private feed is read with a token, and a private feed without one stops the run', () => {
    expect(feedToken(PRIVATE, { GH_TOKEN: 't' })).toBe('t')
    expect(() => feedToken(PRIVATE, {})).toThrow('a private feed is read with GH_TOKEN')
    expect(feedToken({ ...PRIVATE, private: false }, { GH_TOKEN: 't' })).toBeNull()
    expect(feedToken({ kind: 'generic', url: LOCAL_FEED_URL }, { GH_TOKEN: 't' })).toBeNull()
  })
})

describe('what a feed serves now, read as the app reads it', () => {
  it('a generic feed: its own file, or nothing', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/latest.yml') response.writeHead(200).end(`version: ${VERSION_B}\n`)
      else response.writeHead(404).end()
    })
    servers.push(server)
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const feed = { kind: 'generic', url: `http://127.0.0.1:${String(server.address().port)}/` }
    expect(await servedUpdateFile(feed, 'latest.yml')).toBe(`version: ${VERSION_B}\n`)
    expect(await servedUpdateFile(feed, 'latest-mac.yml')).toBeNull()
  })

  it('a private GitHub feed: the latest release’s file, through the API, with the token', async () => {
    const asked = []
    const fetch = async (url, init) => {
      asked.push({
        url: String(url),
        auth: init.headers.authorization,
        accept: init.headers.accept,
      })
      if (String(url).endsWith('/releases/latest')) {
        return new Response(
          JSON.stringify({
            assets: [{ name: 'latest.yml', url: 'https://api.github.com/assets/1' }],
          }),
        )
      }
      return new Response(`version: ${VERSION_A}\n`)
    }
    expect(await servedUpdateFile(PRIVATE, 'latest.yml', { token: 't', fetch })).toBe(
      `version: ${VERSION_A}\n`,
    )
    expect(asked).toEqual([
      {
        url: `https://api.github.com/repos/${SANDBOX_FEED}/releases/latest`,
        auth: 'Bearer t',
        accept: 'application/vnd.github+json',
      },
      {
        url: 'https://api.github.com/assets/1',
        auth: 'Bearer t',
        accept: 'application/octet-stream',
      },
    ])
    expect(await servedUpdateFile(PRIVATE, 'latest-mac.yml', { token: 't', fetch })).toBeNull()
  })

  it('a public GitHub feed: the latest release’s file, anonymously, as a tester’s BroBot reads it', async () => {
    const asked = []
    const fetch = async (url, init) => {
      asked.push({ url: String(url), auth: init.headers.authorization })
      return new Response('version: 1\n')
    }
    await servedUpdateFile({ kind: 'github', repo: 'o/r', private: false }, 'latest.yml', { fetch })
    expect(asked).toEqual([
      { url: 'https://github.com/o/r/releases/latest/download/latest.yml', auth: undefined },
    ])
  })
})

describe('where the lanes stand, read from the commit', () => {
  const status = (what, state, runId = 7, attempt = 1) => ({
    context: statusContext(runId, attempt, what),
    state,
  })

  it('counts this run’s lanes only, by their newest status', () => {
    const statuses = [
      status('windows-default', 'success'),
      status('macos', 'success', 6),
      status('windows-another', 'success', 7, 2),
      status('macos', 'pending'),
      status('macos', 'success'),
    ]
    expect(barrierOf(statuses, 7, 1)).toEqual({ ready: ['windows-default'], failed: [] })
  })

  it('a lane that ended before it was ready is named, whatever it said earlier', () => {
    const statuses = [
      status('windows-another', 'failure'),
      ...LANES.map((lane) => status(lane, 'success')),
    ]
    expect(barrierOf(statuses, 7, 1)).toEqual({
      ready: ['windows-default', 'macos'],
      failed: ['windows-another'],
    })
  })
})

describe('when B goes out', () => {
  const barrier = (ready, failed) => ({ ready, failed })

  it('once every lane is ready or has ended: a lane that ended early holds no other back', () => {
    expect(bMayGoOut(barrier(LANES, []), 0)).toBe('publish')
    expect(bMayGoOut(barrier(['windows-default', 'windows-another'], ['macos']), 0)).toBe('publish')
    expect(bMayGoOut(barrier(['windows-default'], ['macos']), 0)).toBe('wait')
  })

  it('⛔ never for nobody: with no lane ready, B stays a draft', () => {
    expect(bMayGoOut(barrier([], LANES), 0)).toBe('never')
    expect(bMayGoOut(barrier([], []), LANES_SETTLE_WITHIN_MS)).toBe('never')
  })

  it('a lane that says nothing is waited for half an hour, and no longer', () => {
    expect(bMayGoOut(barrier(['macos'], []), LANES_SETTLE_WITHIN_MS - 1)).toBe('wait')
    expect(bMayGoOut(barrier(['macos'], []), LANES_SETTLE_WITHIN_MS)).toBe('publish')
  })
})

describe('the workflows', () => {
  const jobsOf = (text) =>
    Object.fromEntries(
      text
        .split('\njobs:\n')[1]
        .split(/\n(?= {2}[\w-]+:\n)/)
        .map((job) => [job.trim().split(':')[0], job]),
    )

  it('BroBot’s runs from a pushed rehearsal tag only, and the sandbox’s only by hand', () => {
    expect(workflow).toMatch(
      /on:\n {2}push:\n {4}tags: \['update-rehearsal-local-\*', 'update-rehearsal-\[0-9\]\*'\]\n\npermissions:\n {2}contents: read/,
    )
    expect(workflow).not.toMatch(/workflow_dispatch|pull_request/)
    expect(sandbox).toMatch(/on:\n {2}workflow_dispatch:\n/)
    expect(sandbox).not.toMatch(/\n {2}push:|pull_request/)
  })

  it('⛔ the token that publishes never reaches a lane or a build; a lane’s is read-only, and only for a private feed', () => {
    const jobs = jobsOf(workflow)
    const holding = (secret) =>
      Object.keys(jobs)
        .filter((name) => new RegExp(`secrets\\.${secret}\\b`).test(jobs[name]))
        .sort()
    expect(holding('UPDATE_REHEARSAL_TOKEN')).toEqual(['publish-a', 'release-b'])
    expect(holding('UPDATE_REHEARSAL_READ_TOKEN')).toEqual(['macos-update', 'windows-update'])
    for (const name of ['macos-update', 'windows-update']) {
      expect(jobs[name]).toContain(
        "GH_TOKEN: ${{ needs.plan.outputs.mode == 'private' && secrets.UPDATE_REHEARSAL_READ_TOKEN || '' }}",
      )
      // ⚑ …and it runs on a staged feed or its own, never on one whose staging was skipped.
      expect(jobs[name]).toContain(
        "(needs.plan.outputs.mode == 'local' || needs.publish-a.result == 'success')",
      )
    }
    for (const name of ['windows', 'macos']) expect(jobs[name]).not.toMatch(/TOKEN/)
  })

  it('every lane the barrier waits for posts through the lane runner, in both workflows', () => {
    for (const text of [workflow, sandbox]) {
      expect(text).toContain('workspace: [default, another]')
      expect(text).toMatch(
        /update-rehearsal-lane\.mjs "?windows-\$\{?\{? ?(matrix\.workspace|WORKSPACE)/,
      )
      expect(text).toContain('update-rehearsal-lane.mjs macos evidence --')
    }
    expect(LANES).toEqual(['windows-default', 'windows-another', 'macos'])
  })

  it('A and B carry the markers and the commit every lane checks', () => {
    expect(workflow.match(/-c\.extraMetadata\.rehearsalMarker="\$one-\$GITHUB_SHA"/g)).toHaveLength(
      2,
    )
    expect(
      workflow.match(
        /--marker-a "a-\$GITHUB_SHA" --marker-b "b-\$GITHUB_SHA" --source-sha "\$GITHUB_SHA"/g,
      ),
    ).toHaveLength(2)
    expect(sandbox).toContain(
      '--marker-a "a-$SOURCE_SHA" --marker-b "b-$SOURCE_SHA" --source-sha "$SOURCE_SHA"',
    )
    expect(sandbox).toContain(
      '--marker-a "a-$env:SOURCE_SHA" --marker-b "b-$env:SOURCE_SHA" --source-sha "$env:SOURCE_SHA"',
    )
  })
})

describe('staging a build on the feed again', () => {
  it('a release is this build’s by the key in its notes: gone on from, never taken from another build', () => {
    const key = 'build 0123'
    expect(stagedAs(undefined, key)).toBe('absent')
    expect(stagedAs({ draft: true, body: `Not for anyone to install. (${key})` }, key)).toBe(
      'a-draft',
    )
    expect(stagedAs({ draft: false, body: `(${key})` }, key)).toBe('published')
    expect(stagedAs({ draft: true, body: '(build 9999)' }, key)).toBe('another-build')
    expect(stagedAs({ draft: false, body: null }, key)).toBe('another-build')
  })
})

describe('⛔ what goes to the private sandbox', () => {
  /** Every file a script imports by a relative path, followed through what those import. */
  function importsOf(entries) {
    const seen = new Set()
    const walk = (path) => {
      if (seen.has(path)) return
      seen.add(path)
      for (const [, spec] of read(path).matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
        walk(normalize(join(dirname(path), spec)).replaceAll('\\', '/'))
      }
    }
    for (const entry of entries) walk(entry)
    return seen
  }

  it('the harnesses, all they import, and the sandbox’s workflow — nothing more', () => {
    const entries = [
      'scripts/windows-update-test.mjs',
      'scripts/mac-update-test.mjs',
      'scripts/update-rehearsal-lane.mjs',
      'scripts/update-rehearsal-feed.mjs',
    ]
    const needed = importsOf(entries)
    // ⚑ The Windows lane's closer check imports the shipped closer at run time.
    needed.add('apps/desktop/src/main/last-resort-exit.ts')
    needed.add('.nvmrc')
    expect([...needed].sort()).toEqual([...SANDBOX_FILES].sort())
    for (const path of SANDBOX_FILES) expect(existsSync(join(ROOT, path)), path).toBe(true)
    expect(SANDBOX_WORKFLOW[1]).toBe('.github/workflows/rehearsal.yml')
  })
})
