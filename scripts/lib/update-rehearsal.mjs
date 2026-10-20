// The pieces of the update rehearsal (`.github/workflows/update-rehearsal.yml`, and the sandbox's
// own workflow) that read what a tag asks for, which feed a package was built to read, and what that
// feed serves, apart from the runs themselves, so a test can hold them on any computer. Node
// built-ins only.

/** The two releases: A is installed, and updates itself to B. Neither is ever on the real feed. */
export const VERSION_A = '0.0.98'
export const VERSION_B = '0.0.99'

/** The only repository the private rehearsal publishes to. It must be private. */
export const SANDBOX_FEED = 'brocrew/brobot-update-rehearsal'

/** The feed a local rehearsal serves on each runner, and the one its packages are built to read. */
export const LOCAL_FEED_PORT = 47122
export const LOCAL_FEED_URL = `http://127.0.0.1:${String(LOCAL_FEED_PORT)}/`

/** The lanes that must be ready, with only A on the feed, before B is published. */
export const LANES = ['windows-default', 'windows-another', 'macos']

/**
 * The files beside the database that a recovery copy carries, in `recovery/state-files.ts`' order:
 * a test holds the two lists equal.
 */
export const STATE_FILES = [
  'skills',
  'skills-off',
  'skills-conversion.json',
  'transcript-retention.json',
  'active-theme.json',
  'dock-label.json',
  'drafts.json',
  'archived.json',
  'sign-in-changes.json',
  'provider-usage.json',
  'schedule-attempts.json',
  'profile-execution.json',
  'workspace.json',
  'update-settings.json',
  'workspaces.json',
]

/** The file a lane writes once A has made its data and found nothing newer: B may be published. */
export const A_READY = 'a-ready.json'

/**
 * What a pushed tag asks for, or why it asks for nothing:
 *  - `update-rehearsal-local-N`: the feed is a server on each runner, and nothing is published;
 *  - `update-rehearsal-N`: the private sandbox, through electron-updater's private-GitHub path.
 *
 * ⛔ There is no public rehearsal: nothing here may publish to a public repository until the owner
 * says yes, present (`scripts/update-rehearsal/held/`).
 */
export function planOf(tag) {
  if (/^update-rehearsal-local-\d+$/.test(tag)) {
    return { mode: 'local', feed: { kind: 'generic', url: LOCAL_FEED_URL } }
  }
  if (/^update-rehearsal-\d+$/.test(tag)) {
    return { mode: 'private', feed: { kind: 'github', repo: SANDBOX_FEED, private: true } }
  }
  return { refused: `${tag} is not a rehearsal tag` }
}

/**
 * The feed a harness is told to read: `--feed-url <url>` for a generic one, or
 * `--feed-github <owner/repo>` with `--feed-private` when the repository is private.
 */
export function feedFromArgs(values) {
  if (values['feed-github'] !== undefined) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(values['feed-github'])) {
      throw new Error(`--feed-github names no repository: ${values['feed-github']}`)
    }
    return { kind: 'github', repo: values['feed-github'], private: values['feed-private'] === true }
  }
  if (values['feed-private'] === true) throw new Error('--feed-private needs --feed-github')
  return { kind: 'generic', url: new URL(values['feed-url'] ?? LOCAL_FEED_URL).href }
}

/** The electron-builder arguments that make a package read `feed`. */
export function feedArgs(feed) {
  if (feed.kind === 'generic') {
    return ['-c.publish.provider=generic', `-c.publish.url=${feed.url}`]
  }
  const [owner, repo] = feed.repo.split('/')
  return [
    '-c.publish.provider=github',
    `-c.publish.owner=${owner}`,
    `-c.publish.repo=${repo}`,
    ...(feed.private ? ['-c.publish.private=true'] : []),
  ]
}

/** One top-level `key: value` of an `app-update.yml`, unquoted, or null. */
function field(text, key) {
  const value = new RegExp(`^${key}: ?(.*)$`, 'm').exec(text)?.[1]?.trim()
  return value === undefined || value === '' ? null : value.replace(/^['"]|['"]$/g, '')
}

/**
 * Every way a package's `app-update.yml` differs from `feed`. ⛔ It never carries a token: on a
 * private feed the app reads one from its environment, which only the test gives it.
 */
export function appUpdateProblems(text, feed) {
  const problems = []
  const expect = (key, value) => {
    const found = field(text, key)
    if (found !== value) problems.push(`${key} is ${String(found)}, not ${String(value)}`)
  }
  if (/^token:/m.test(text)) problems.push('it carries a token')
  if (feed.kind === 'generic') {
    expect('provider', 'generic')
    expect('url', feed.url)
    return problems
  }
  const [owner, repo] = feed.repo.split('/')
  expect('provider', 'github')
  expect('owner', owner)
  expect('repo', repo)
  expect('private', feed.private ? 'true' : null)
  return problems
}

/**
 * The token the app under test reads a private feed with, from the harness's own `GH_TOKEN`; none
 * for any other feed. The app is given it in its environment and nowhere else.
 */
export function feedToken(feed, env) {
  if (feed.kind !== 'github' || !feed.private) return null
  const token = env.GH_TOKEN ?? ''
  if (token === '') throw new Error('a private feed is read with GH_TOKEN, and none is set')
  return token
}

/**
 * The text of the update file (`latest.yml`, `latest-mac.yml`) the feed serves now, as an app
 * reads it — a generic feed's own file; a GitHub feed's latest release's file, through the API with
 * the token on a private feed, anonymously on a public one — or null when it serves none.
 */
export async function servedUpdateFile(
  feed,
  name,
  { token = null, fetch = globalThis.fetch } = {},
) {
  const headers = { 'user-agent': 'brobot-update-rehearsal' }
  if (feed.kind === 'generic') {
    const response = await fetch(new URL(name, feed.url), { headers })
    return response.ok ? response.text() : null
  }
  if (!feed.private) {
    const response = await fetch(
      `https://github.com/${feed.repo}/releases/latest/download/${encodeURIComponent(name)}`,
      { headers, redirect: 'follow' },
    )
    return response.ok ? response.text() : null
  }
  const api = {
    ...headers,
    authorization: `Bearer ${String(token)}`,
    'x-github-api-version': '2022-11-28',
  }
  const latest = await fetch(`https://api.github.com/repos/${feed.repo}/releases/latest`, {
    headers: { ...api, accept: 'application/vnd.github+json' },
  })
  if (!latest.ok) return null
  const asset = ((await latest.json()).assets ?? []).find((one) => one.name === name)
  if (asset === undefined) return null
  const file = await fetch(asset.url, {
    headers: { ...api, accept: 'application/octet-stream' },
    redirect: 'follow',
  })
  return file.ok ? file.text() : null
}

/** How long B waits for a lane that is neither ready nor ended. */
export const LANES_SETTLE_WITHIN_MS = 30 * 60_000

/**
 * Whether B may be published yet: once every lane is ready or has ended, or the wait for the rest is
 * over, and only if at least one lane is ready. ⚑ A lane that ended before it was ready is red
 * already, and holds no other lane back.
 */
export function bMayGoOut(barrier, waitedMs) {
  const settled = barrier.ready.length + barrier.failed.length === LANES.length
  if (!settled && waitedMs < LANES_SETTLE_WITHIN_MS) return 'wait'
  return barrier.ready.length > 0 ? 'publish' : 'never'
}

/** The commit status a lane posts, scoped to one attempt of one run. `what` is a lane, or `b-published`. */
export function statusContext(runId, attempt, what) {
  return `update-rehearsal/${String(runId)}.${String(attempt)}/${what}`
}

/**
 * Where a rehearsal's lanes stand, read from the commit's statuses (GitHub lists the newest first):
 * the lanes ready, and the lanes that ended before they were.
 */
export function barrierOf(statuses, runId, attempt) {
  const newest = new Map()
  for (const status of statuses) {
    if (!newest.has(status.context)) newest.set(status.context, status)
  }
  const at = (what) => newest.get(statusContext(runId, attempt, what))
  return {
    ready: LANES.filter((lane) => at(lane)?.state === 'success'),
    failed: LANES.filter((lane) => ['failure', 'error'].includes(at(lane)?.state)),
  }
}
