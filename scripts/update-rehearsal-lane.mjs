// One lane of the update rehearsal on a GitHub feed: it runs the lane's harness, and says on the
// rehearsed commit, with the run's own token, when that harness has written `a-ready.json` (A made
// its data and found nothing newer: B may be published), or that it ended before it was ready, so
// the job that publishes B never waits for a lane that has stopped. A lane that is ready stops if
// B will never be published. Before the evidence is kept, it is searched for either token.
//
//   node scripts/update-rehearsal-lane.mjs <lane> <evidence folder> -- <harness command…>
//
// Exit: the harness's own; 1 when a token was found in the evidence. Node built-ins only.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { A_READY, LANES, statusContext } from './lib/update-rehearsal.mjs'

const [lane, evidence, separator, command, ...args] = process.argv.slice(2)
if (
  !LANES.includes(lane) ||
  evidence === undefined ||
  separator !== '--' ||
  command === undefined
) {
  console.error('usage: update-rehearsal-lane.mjs <lane> <evidence folder> -- <harness command…>')
  process.exit(2)
}
const {
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: repo,
  GITHUB_SHA: sha,
  GITHUB_RUN_ID: runId,
  GITHUB_RUN_ATTEMPT: attempt,
} = process.env
if (!token || !repo || !sha || !runId || !attempt) {
  console.error('update-rehearsal-lane runs in a GitHub job, with its token')
  process.exit(2)
}
const say = (line) => console.log(`[update-rehearsal-lane] ${lane}: ${line}`)
const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'brobot-update-rehearsal',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })

async function post(state, description) {
  const response = await api(`/statuses/${sha}`, {
    method: 'POST',
    body: JSON.stringify({ state, context: statusContext(runId, attempt, lane), description }),
  })
  if (!response.ok) throw new Error(`its status was refused: ${String(response.status)}`)
  say(`${state} — ${description}`)
}

/** What this run has said of B: `out`, `never`, or null for nothing yet. */
async function whatBecameOfB() {
  const response = await api(`/commits/${sha}/statuses?per_page=100`)
  if (!response.ok) return null
  const newest = (await response.json()).find(
    (one) => one.context === statusContext(runId, attempt, 'b-published'),
  )
  if (newest === undefined || newest.state === 'pending') return null
  return newest.state === 'success' ? 'out' : 'never'
}

// ⚑ The harness is not given the run's own token under that name. A private feed's token is its
// GH_TOKEN, which it hands to the app under test; in the sandbox that is the same short-lived token.
const env = { ...process.env }
delete env.GITHUB_TOKEN
const harness = spawn(command, args, { stdio: 'inherit', env })
/** `waiting` for a-ready.json; `ready` once said; `settled` once B is out or never will be. */
let stage = 'waiting'
let busy = false
let looks = 0
const watch = setInterval(() => {
  if (busy || stage === 'settled' || !existsSync(join(evidence, A_READY))) return
  // ⚑ B is asked after every 30 s, and no more once it is out: the run's token answers a limited
  // number of times an hour, and the app's own checks spend from the same count.
  if (stage === 'ready' && (looks += 1) % 6 !== 0) return
  busy = true
  const step =
    stage === 'waiting'
      ? post('success', 'ready: A installed, its data made, no B yet').then(() => {
          stage = 'ready'
        })
      : whatBecameOfB().then((became) => {
          if (became === null) return
          stage = 'settled'
          if (became === 'never' && harness.exitCode === null) {
            say('B will not be published; stopping the harness')
            harness.kill()
          }
        })
  step
    // ⚑ A status that was refused is tried again at the next look.
    .catch((error) => console.error(`[update-rehearsal-lane] ${lane}: ${error.message}`))
    .finally(() => {
      busy = false
    })
}, 5_000)
const code = await new Promise((done) => {
  harness.once('exit', (exit, signal) => done(exit ?? (signal ? 1 : 0)))
  harness.once('error', (error) => {
    console.error(`[update-rehearsal-lane] the harness did not start: ${error.message}`)
    done(1)
  })
})
clearInterval(watch)
if (stage === 'waiting') {
  await post('failure', `ended before it was ready (exit ${String(code)})`).catch(() => {})
}

/** Every file under `dir`, by path. */
function filesUnder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return entry.isFile() ? [path] : []
  })
}
// ⛔ No token leaves with the evidence: a file that holds one is removed, named, and fails the lane.
const secrets = [...new Set([token, process.env.GH_TOKEN].filter((one) => one && one.length >= 8))]
const holding = filesUnder(evidence).filter((file) => {
  const bytes = readFileSync(file)
  return secrets.some((secret) => bytes.includes(secret))
})
for (const file of holding) {
  rmSync(file, { force: true })
  console.error(`[update-rehearsal-lane] ${lane}: ✗ ${file} held a token, and was removed`)
}
if (holding.length === 0) say('no token in the evidence')
process.exit(holding.length > 0 ? 1 : code)
