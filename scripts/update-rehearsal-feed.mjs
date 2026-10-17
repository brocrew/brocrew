// The update rehearsal's feed: what a tag rehearses, how each package is built to read the feed,
// and, on GitHub, A published and B held as a draft until every lane is ready. Run by the rehearsal's
// workflows, and by hand, with a token that may write there, to stage the private sandbox. Node
// built-ins only.
//
//   plan <tag>                                       → GITHUB_OUTPUT lines
//   version a|b
//   builder-args <mode> <repo>                       → one argument a line
//   check-package <mode> <repo> <version> <dist> <app-update.yml>
//   publish-a <mode> <repo> <folder with a/ and b/>  A published, B a draft      (FEED_TOKEN or GH_TOKEN)
//                                                    STAGE_MINUTES=N ends it after N minutes with
//                                                    exit 75; run again, it goes on where it stopped
//   b-metadata <repo> <folder>                       B's update files, from its draft   (GH_TOKEN)
//   release-b <mode> <repo>                          B published once every lane is ready
//   sandbox-push <repo> <source sha>                 the harness and its workflow as that commit has
//                                                    them, to the sandbox                  (GH_TOKEN)
//
// ⛔ Publishing refuses any repository but the plan's, whose only GitHub feed is the private sandbox,
// and refuses that one too if it is not private. Nothing here changes a repository's visibility,
// and no token is ever printed.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  appUpdateProblems,
  barrierOf,
  bMayGoOut,
  feedArgs,
  LANES,
  planOf,
  SANDBOX_FEED,
  statusContext,
  VERSION_A,
  VERSION_B,
} from './lib/update-rehearsal.mjs'
import { problemsWith, readUpdateFile } from './release-check.mjs'

const say = (line) => console.log(`[update-rehearsal] ${line}`)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * What the private sandbox runs the lanes with: the harnesses, everything they import, and the
 * sandbox's own workflow. ⛔ No other BroCrew source goes there.
 */
export const SANDBOX_FILES = [
  '.nvmrc',
  'apps/desktop/src/main/last-resort-exit.ts',
  'apps/desktop/src/main/recovery/log-lines.ts',
  'scripts/lib/hidden-launch.mjs',
  'scripts/lib/mac-update-test.mjs',
  'scripts/lib/update-rehearsal-app.mjs',
  'scripts/lib/update-rehearsal-data.mjs',
  'scripts/lib/update-rehearsal-state.mjs',
  'scripts/lib/update-rehearsal.mjs',
  'scripts/lib/upgrade-path.mjs',
  'scripts/lib/windows-update-test.mjs',
  'scripts/mac-update-test.mjs',
  'scripts/release-check.mjs',
  'scripts/update-rehearsal-feed.mjs',
  'scripts/update-rehearsal-lane.mjs',
  'scripts/windows-update-test.mjs',
]
/** The sandbox's workflow, kept here and placed there; it never runs in this repository. */
export const SANDBOX_WORKFLOW = [
  'scripts/update-rehearsal-sandbox.yml',
  '.github/workflows/rehearsal.yml',
]

/** The plan a mode and repository name give, as the jobs after `plan` pass them. */
function planFrom(mode, repo) {
  if (mode === 'local') return planOf('update-rehearsal-local-0')
  if (mode !== 'private') return { refused: `no mode ${String(mode)}` }
  const plan = planOf('update-rehearsal-0')
  return repo === undefined || repo === plan.feed.repo
    ? plan
    : { refused: `${repo} is not the rehearsal's feed, ${plan.feed.repo}` }
}

/** The token a command publishes or reads the feed with. */
function feedTokenOf(env) {
  const token = env.FEED_TOKEN || env.GH_TOKEN || ''
  if (token === '') throw new Error('no FEED_TOKEN or GH_TOKEN to reach the feed with')
  return token
}

/** GitHub's REST API with a token; answers the parsed body, or throws with what GitHub said. */
async function github(
  token,
  method,
  path,
  body,
  { accept = 'application/vnd.github+json', timeoutMs = undefined } = {},
) {
  const binary = body instanceof Uint8Array
  const response = await fetch(
    path.startsWith('https://') ? path : `https://api.github.com${path}`,
    {
      method,
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'brobot-update-rehearsal',
        ...(body === undefined
          ? {}
          : { 'content-type': binary ? 'application/octet-stream' : 'application/json' }),
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
    },
  )
  if (response.status === 404 && method === 'GET') return null
  if (!response.ok) {
    throw new Error(
      `${method} ${path} answered ${String(response.status)}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  if (response.status === 204) return null
  return accept === 'application/octet-stream'
    ? new Uint8Array(await response.arrayBuffer())
    : response.json()
}

/** The feed repository, refused unless its visibility is the one the mode needs. */
async function theFeed(token, plan) {
  const repo = await github(token, 'GET', `/repos/${plan.feed.repo}`)
  if (repo === null) throw new Error(`${plan.feed.repo} is not there, or the token cannot read it`)
  if (repo.private !== plan.feed.private) {
    throw new Error(
      `${plan.feed.repo} is ${repo.private ? 'private' : 'public'}, and the ${plan.mode} rehearsal needs it ${plan.feed.private ? 'private' : 'public'}`,
    )
  }
  return repo
}

/** The files of one release, as the builds left them in `<folder>/<a|b>/`. */
function releaseFiles(folder, which, version) {
  const dir = join(folder, which)
  const names = [
    `BroCrew-Setup-${version}-x64.exe`,
    `BroCrew-Setup-${version}-x64.exe.blockmap`,
    'latest.yml',
    `BroCrew-${version}-arm64.dmg`,
    `BroCrew-${version}-arm64.dmg.blockmap`,
    `BroCrew-${version}-arm64-mac.zip`,
    `BroCrew-${version}-arm64-mac.zip.blockmap`,
    'latest-mac.yml',
  ]
  const missing = names.filter((name) => !existsSync(join(dir, name)))
  if (missing.length > 0)
    throw new Error(`release ${version} lacks ${missing.join(', ')} in ${dir}`)
  return names.map((name) => join(dir, name))
}

/** Thrown when a command's time is spent before the feed is whole: run it again to go on. */
class RunAgain extends Error {}

/**
 * When a staging command must end, from `STAGE_MINUTES`: never, when it is not set. Staging by hand
 * uploads through one computer, in commands short enough to be watched, and each goes on where the
 * last one stopped.
 */
function stagingEndsAt(env) {
  const minutes = Number(env.STAGE_MINUTES ?? '')
  return Number.isFinite(minutes) && minutes > 0 ? Date.now() + minutes * 60_000 : Infinity
}

/** What names a build on the feed: a hash of the two update files it was packaged with. */
function buildKeyOf(files) {
  const hash = createHash('sha256')
  for (const name of ['latest.yml', 'latest-mac.yml']) {
    hash.update(readFileSync(files.find((file) => basename(file) === name)))
  }
  return `build ${hash.digest('hex').slice(0, 32)}`
}

/** How the release already on the feed for a tag stands, for the build whose key is `key`. */
export function stagedAs(release, key) {
  if (release === undefined) return 'absent'
  if (!String(release.body ?? '').includes(key)) return 'another-build'
  return release.draft ? 'a-draft' : 'published'
}

const releasesOn = async (token, repo) =>
  (await github(token, 'GET', `/repos/${repo}/releases?per_page=100`)) ?? []
const assetsOf = (token, repo, release) =>
  github(token, 'GET', `/repos/${repo}/releases/${String(release.id)}/assets?per_page=100`)

/** Remove a release another build left, and its tag. */
async function removeRelease(token, repo, release) {
  await github(token, 'DELETE', `/repos/${repo}/releases/${String(release.id)}`)
  if ((await github(token, 'GET', `/repos/${repo}/git/ref/tags/${release.tag_name}`)) !== null) {
    await github(token, 'DELETE', `/repos/${repo}/git/refs/tags/${release.tag_name}`)
  }
  say(`removed ${release.tag_name}, which another build left`)
}

/** A release's update files, read back from the feed. */
async function updateFilesOn(token, repo, release) {
  const assets = await assetsOf(token, repo, release)
  const read = {}
  for (const name of ['latest.yml', 'latest-mac.yml']) {
    const asset = assets.find((one) => one.name === name)
    if (asset === undefined) throw new Error(`${release.tag_name} has no ${name} on the feed`)
    read[name] = new TextDecoder().decode(
      await github(token, 'GET', `/repos/${repo}/releases/assets/${String(asset.id)}`, undefined, {
        accept: 'application/octet-stream',
      }),
    )
  }
  return { assets, read }
}

/**
 * This build's release for `version`, with every file, held to the update files it carries: every
 * file they name is on the feed at the size they say, and they read back exactly as built. ⚑ It goes
 * on from a release this build already has there — a file already whole is not sent again — and
 * starts over from one another build left. ⚑ The bytes themselves are held to their sha512 by the
 * lanes, which download them as a tester's BroCrew does.
 */
async function withEveryFile(token, feed, version, files, endsAt) {
  const tag = `v${version}`
  const repo = feed.full_name
  const key = buildKeyOf(files)
  let release = (await releasesOn(token, repo)).find((one) => one.tag_name === tag)
  if (stagedAs(release, key) === 'another-build') {
    await removeRelease(token, repo, release)
    release = undefined
  }
  release ??= await github(token, 'POST', `/repos/${repo}/releases`, {
    tag_name: tag,
    target_commitish: feed.default_branch,
    name: `BroCrew ${version} (update rehearsal)`,
    body: `A rehearsal release on a test feed. Not for anyone to install. (${key})`,
    draft: true,
    prerelease: false,
  })
  const upload = release.upload_url.replace(/\{.*\}$/, '')
  const there = new Map((await assetsOf(token, repo, release)).map((one) => [one.name, one]))
  /** Bytes a millisecond, measured on this command's last large upload. */
  let speed = null
  for (const file of files) {
    const name = basename(file)
    const size = statSync(file).size
    const asset = there.get(name)
    if (asset?.state === 'uploaded' && asset.size === size) continue
    // ⚑ One cut short, or another size: removed, and sent whole.
    if (asset !== undefined) {
      await github(token, 'DELETE', `/repos/${repo}/releases/assets/${String(asset.id)}`)
    }
    const left = endsAt - Date.now()
    if (left <= 0 || (speed !== null && (size / speed) * 1.3 > left)) {
      throw new RunAgain(`${tag}: ${name} is still to upload`)
    }
    const started = Date.now()
    try {
      await github(
        token,
        'POST',
        `${upload}?name=${encodeURIComponent(name)}`,
        readFileSync(file),
        {
          timeoutMs: Number.isFinite(left) ? left : undefined,
        },
      )
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new RunAgain(`${tag}: ${name} did not finish in the time this command had`)
      }
      throw error
    }
    const took = Date.now() - started
    if (size > 5_000_000) speed = size / took
    say(
      `  ${tag}: uploaded ${name} (${(size / 1e6).toFixed(1)} MB in ${(took / 1000).toFixed(0)} s)`,
    )
  }
  const { assets, read } = await updateFilesOn(token, repo, release)
  const sizes = new Map(assets.map((asset) => [asset.name, asset.size]))
  for (const name of ['latest.yml', 'latest-mac.yml']) {
    const built = readFileSync(
      files.find((file) => basename(file) === name),
      'utf8',
    )
    if (read[name] !== built) throw new Error(`${tag}'s ${name} on the feed is not the one built`)
    const said = readUpdateFile(read[name])
    if (said.version !== version) throw new Error(`${tag}'s ${name} names ${String(said.version)}`)
    for (const named of said.files) {
      if (sizes.get(named.url) !== named.size) {
        throw new Error(`${tag}: ${named.url} on the feed is not the size ${name} says`)
      }
    }
  }
  say(
    `✓ ${tag}: every file on the feed, each the size its update file says, both update files as built`,
  )
  return release
}

/**
 * The feed as a rehearsal starts on it: A published as its latest release, B a draft, both this
 * build's and whole. ⚑ Run again, it goes on from where it stopped; run after a rehearsal of the
 * same build, it makes B a draft again and sends nothing twice.
 */
async function publishA(plan, folder, token, endsAt) {
  const feed = await theFeed(token, plan)
  const repo = plan.feed.repo
  const filesA = releaseFiles(folder, 'a', VERSION_A)
  const filesB = releaseFiles(folder, 'b', VERSION_B)
  // ⛔ First, no B may be published: it is what A would find.
  const b = (await releasesOn(token, repo)).find((one) => one.tag_name === `v${VERSION_B}`)
  const standing = stagedAs(b, buildKeyOf(filesB))
  if (standing === 'another-build') await removeRelease(token, repo, b)
  if (standing === 'published') {
    await github(token, 'PATCH', `/repos/${repo}/releases/${String(b.id)}`, { draft: true })
    say(`B (${VERSION_B}), which an earlier rehearsal of this build published, is a draft again`)
  }
  const a = await withEveryFile(token, feed, VERSION_A, filesA, endsAt)
  await github(token, 'PATCH', `/repos/${repo}/releases/${String(a.id)}`, {
    draft: false,
    prerelease: false,
    make_latest: 'true',
  })
  say(`✓ A (${VERSION_A}) is published as ${repo}'s latest release`)
  await withEveryFile(token, feed, VERSION_B, filesB, endsAt)
  const latest = await github(token, 'GET', `/repos/${repo}/releases/latest`)
  if (latest?.tag_name !== `v${VERSION_A}`) {
    throw new Error(`the feed's latest release is ${String(latest?.tag_name)}, not v${VERSION_A}`)
  }
  say(`✓ B (${VERSION_B}) is a draft with every file; it is published once every lane is ready`)
}

/** B's draft, which only a token that may push can see. */
async function draftOfB(token, repo) {
  const releases = await github(token, 'GET', `/repos/${repo}/releases?per_page=100`)
  const b = (releases ?? []).find(
    (release) => release.tag_name === `v${VERSION_B}` && release.draft,
  )
  if (b === undefined) throw new Error(`there is no draft of ${VERSION_B} on ${repo}`)
  return b
}

async function bMetadata(repo, folder, token) {
  const { read } = await updateFilesOn(token, repo, await draftOfB(token, repo))
  mkdirSync(folder, { recursive: true })
  for (const [name, text] of Object.entries(read)) writeFileSync(join(folder, name), text)
  say(`✓ B's update files, from its draft, in ${folder}`)
}

async function releaseB(plan, token) {
  const own = process.env.GITHUB_TOKEN ?? ''
  const {
    GITHUB_REPOSITORY: source,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: attempt,
  } = process.env
  if (own === '' || !source || !sha)
    throw new Error('release-b runs in a GitHub job, with its token')
  const post = (state, description) =>
    github(own, 'POST', `/repos/${source}/statuses/${sha}`, {
      state,
      context: statusContext(runId, attempt, 'b-published'),
      description,
    })
  const started = Date.now()
  let barrier
  for (;;) {
    barrier = barrierOf(
      (await github(own, 'GET', `/repos/${source}/commits/${sha}/statuses?per_page=100`)) ?? [],
      runId,
      attempt,
    )
    const verdict = bMayGoOut(barrier, Date.now() - started)
    if (verdict === 'publish') break
    if (verdict === 'never') {
      await post('failure', 'not published: no lane was ready')
      throw new Error(
        `B is not published: no lane was ready (ended before: ${barrier.failed.join(', ') || 'none'})`,
      )
    }
    await sleep(20_000)
  }
  const unready = LANES.filter((lane) => !barrier.ready.includes(lane))
  if (unready.length > 0) {
    say(`not waited for, each red or silent already: ${unready.join(', ')}`)
  }
  try {
    await theFeed(token, plan)
    const b = await draftOfB(token, plan.feed.repo)
    await github(token, 'PATCH', `/repos/${plan.feed.repo}/releases/${String(b.id)}`, {
      draft: false,
      prerelease: false,
      make_latest: 'true',
    })
    say(
      `✓ B (${VERSION_B}) is published as ${plan.feed.repo}'s latest release, for ${barrier.ready.join(', ')}`,
    )
  } catch (error) {
    // ⚑ Said to the lanes, which would otherwise wait for a B that is not coming.
    await post('failure', 'not published: publishing it failed').catch(() => {})
    throw error
  }
  await post('success', `${VERSION_B} published`)
}

/**
 * The harness and its workflow as committed at `sourceSha`, as one commit on the sandbox's default
 * branch that holds nothing else. ⛔ Only to the sandbox, and only while it is private. ⚑ Read from
 * that commit, never from the working files, so what runs there is what the commit says.
 */
async function sandboxPush(repo, sourceSha, token) {
  if (repo !== SANDBOX_FEED) throw new Error(`only ${SANDBOX_FEED} takes the harness, not ${repo}`)
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('a full source commit is needed')
  const committed = (path) =>
    execFileSync('git', ['-C', ROOT, 'show', `${sourceSha}:${path}`], {
      maxBuffer: 64 * 1024 * 1024,
    })
  const feed = await theFeed(token, planOf('update-rehearsal-0'))
  const branch = feed.default_branch
  const head = await github(token, 'GET', `/repos/${repo}/git/ref/heads/${branch}`)
  const files = [
    ...SANDBOX_FILES.map((path) => [path, committed(path)]),
    [SANDBOX_WORKFLOW[1], committed(SANDBOX_WORKFLOW[0])],
    [
      'README.md',
      Buffer.from(
        `A private test feed for BroCrew's update rehearsal, and the lanes that read it.\nIts files are BroCrew's at ${sourceSha}.\n`,
      ),
    ],
  ]
  const entries = []
  for (const [path, bytes] of files) {
    const blob = await github(token, 'POST', `/repos/${repo}/git/blobs`, {
      content: bytes.toString('base64'),
      encoding: 'base64',
    })
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  // ⚑ A whole tree, on no base: a file an earlier push left is gone.
  const tree = await github(token, 'POST', `/repos/${repo}/git/trees`, { tree: entries })
  const commit = await github(token, 'POST', `/repos/${repo}/git/commits`, {
    message: `The update rehearsal's harness, from BroCrew ${sourceSha.slice(0, 12)}`,
    tree: tree.sha,
    parents: [head.object.sha],
  })
  await github(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha })
  say(
    `✓ the harness from ${sourceSha.slice(0, 12)} is ${repo}@${commit.sha.slice(0, 12)} (${String(entries.length)} files)`,
  )
}

function checkPackage(plan, version, dist, appUpdateFile) {
  const problems = []
  if (!existsSync(appUpdateFile)) problems.push(`the package carries no ${appUpdateFile}`)
  else {
    problems.push(
      ...appUpdateProblems(readFileSync(appUpdateFile, 'utf8'), plan.feed).map(
        (one) => `app-update.yml: ${one}`,
      ),
    )
  }
  // ⚑ The update files' versions, sizes and sha512s, as a real release's are checked; the feed
  // itself is held above, so release-check's rules for a release's own feed are not asked here.
  problems.push(
    ...problemsWith(dist, version, plan.feed.repo ?? 'local/feed', appUpdateFile).filter(
      (one) => !one.startsWith("the app's app-update.yml"),
    ),
  )
  if (!readdirSync(dist).some((name) => /^latest(-mac)?\.yml$/.test(name)))
    problems.push(`no update file in ${dist}`)
  for (const problem of problems) say(`✗ ${problem}`)
  if (problems.length === 0) say(`✓ ${version} in ${dist}: its update file and its feed`)
  return problems.length === 0
}

async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'plan') {
    const plan = planOf(rest[0] ?? '')
    if (plan.refused) {
      console.error(`[update-rehearsal] ${plan.refused}: nothing is rehearsed`)
      return 1
    }
    // ⚑ The private rehearsal's lanes run here only once this repository holds the feed's token;
    // until then they run in the sandbox itself (`sandbox-push`).
    const runsHere = plan.mode !== 'private' || process.env.RUNS_HERE === 'true'
    console.log(`mode=${plan.mode}`)
    console.log(`repo=${plan.feed.repo ?? ''}`)
    console.log(`runs_here=${String(runsHere)}`)
    console.log(`environment=${runsHere && plan.mode === 'private' ? 'update-rehearsal' : ''}`)
    console.error(
      `[update-rehearsal] ${plan.mode}${plan.feed.repo ? ` on ${plan.feed.repo}` : ''}; lanes ${runsHere ? 'here' : 'in the sandbox'}`,
    )
    return 0
  }
  if (command === 'version') {
    console.log(rest[0] === 'a' ? VERSION_A : VERSION_B)
    return 0
  }
  if (command === 'b-metadata') {
    await bMetadata(rest[0], rest[1], feedTokenOf(process.env))
    return 0
  }
  if (command === 'sandbox-push') {
    await sandboxPush(rest[0], rest[1] ?? '', feedTokenOf(process.env))
    return 0
  }
  const plan = planFrom(rest[0], rest[1])
  if (plan.refused) {
    console.error(`[update-rehearsal] ${plan.refused}`)
    return 2
  }
  if (command === 'builder-args') {
    for (const arg of feedArgs(plan.feed)) console.log(arg)
    return 0
  }
  if (command === 'check-package') return checkPackage(plan, rest[2], rest[3], rest[4]) ? 0 : 1
  if (command === 'publish-a') {
    try {
      await publishA(plan, rest[2], feedTokenOf(process.env), stagingEndsAt(process.env))
    } catch (error) {
      if (!(error instanceof RunAgain)) throw error
      say(`… ${error.message}: run this again to go on`)
      return 75
    }
    return 0
  }
  if (command === 'release-b') {
    await releaseB(plan, feedTokenOf(process.env))
    return 0
  }
  console.error(`[update-rehearsal] no command ${String(command)}`)
  return 2
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[update-rehearsal] ✗ ${error.message}`)
      process.exit(1)
    },
  )
}
