// Publishes the draft `release.yml`'s draft job made, by its numeric id, once the `release`
// environment approves it. A draft looked up by tag is lost when an edit drops its tag (0.2.26's
// draft became `untagged-…` after a notes edit, and `gh release edit v0.2.26` found nothing), so
// the draft job records the draft's id and files, and the publish sends the tag again.
//
//   node scripts/publish-release.mjs   (env: REPO, TAG, GITHUB_SHA, DRAFT_ID, DRAFT_ASSETS)
//
// Node built-ins only; it calls the `gh` on PATH.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** GETs `path`, or PATCHes it with `body`; GitHub's answer as JSON. */
function api(path, body) {
  const args = body === undefined ? [path] : ['--method', 'PATCH', path, '--input', '-']
  const result = spawnSync('gh', ['api', ...args], {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`gh api ${path} failed: ${(result.error?.message ?? result.stderr).trim()}`)
  }
  return JSON.parse(result.stdout)
}

/** A release's files, comparable: id, name and size, by name. */
function filesOf(assets) {
  const files = assets.map(({ id, name, size }) => ({ id, name, size }))
  return JSON.stringify(files.sort((a, b) => a.name.localeCompare(b.name)))
}

/** Stops before publishing unless `tag` is at `sha` and the draft's files are the recorded ones. */
function check({ repo, tag, sha, id, assets, predecessor }) {
  const tagged = api(`repos/${repo}/commits/${tag}`).sha
  if (tagged !== sha) throw new Error(`${tag} points at ${tagged}, not ${sha}`)
  const draft = api(`repos/${repo}/releases/${id}`)
  if (filesOf(draft.assets) !== filesOf(assets)) {
    throw new Error(`its files changed since the draft job: ${filesOf(draft.assets)}`)
  }
  if (predecessor) {
    const latest = api(`repos/${repo}/releases/latest`).tag_name
    if (latest !== predecessor) throw new Error(`latest is ${latest}, expected ${predecessor}`)
  }
}

/** What GitHub says release `id` is now, read once and never retried. */
function stateOf(repo, id) {
  try {
    const release = api(`repos/${repo}/releases/${id}`)
    return `GitHub now reads draft: ${release.draft}, tag: ${release.tag_name}`
  } catch (error) {
    return `its state could not be read: ${error.message}`
  }
}

/** Publishes draft `id` as `tag` at `sha` if the tag and the draft's files are as it was made. */
export function publishDraft({ repo, tag, sha, id, assets, predecessor }) {
  try {
    check({ repo, tag, sha, id, assets, predecessor })
  } catch (error) {
    throw new Error(`Release ${id} was not published: ${error.message}`, { cause: error })
  }
  try {
    const published = api(`repos/${repo}/releases/${id}`, {
      tag_name: tag,
      target_commitish: sha,
      draft: false,
      make_latest: 'true',
    })
    if (published.draft !== false || published.tag_name !== tag) {
      throw new Error(`GitHub answered draft: ${published.draft}, tag: ${published.tag_name}`)
    }
    return published.html_url
  } catch (error) {
    throw new Error(`Release ${id} may be published: ${error.message}; ${stateOf(repo, id)}`, {
      cause: error,
    })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {
    REPO,
    TAG,
    RELEASE_SOURCE = process.env.GITHUB_SHA,
    DRAFT_ID,
    DRAFT_ASSETS,
    RECOVERY_PREDECESSOR,
  } = process.env
  try {
    const url = publishDraft({
      repo: REPO,
      tag: TAG,
      sha: RELEASE_SOURCE,
      id: DRAFT_ID,
      assets: JSON.parse(DRAFT_ASSETS),
      predecessor: RECOVERY_PREDECESSOR,
    })
    console.log(`Published ${url}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
