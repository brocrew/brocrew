import { closedFrames } from './diagnostics.mjs'

// Diagnostic only: the first install's card transitions as closed categories, and the staged
// archive's digest. Nothing here decides a check.
const cardStates = [
  ['Available', 'available'],
  ['Installed', 'installed-stopped'],
  ['Running', 'running'],
  ['Needs setup', 'unhealthy'],
  ['Unavailable', 'unhealthy'],
]
const categories = ['list-failed', 'absent'].concat(
  ...['installed', 'not-installed'].map((side) =>
    ['available', 'installed-stopped', 'running', 'unhealthy', 'other'].map(
      (state) => side + '/' + state,
    ),
  ),
)
const MOST = 8
function cardCategory(answer) {
  if (!answer?.ok || !Array.isArray(answer.cards)) return 'list-failed'
  const card = answer.cards.find((one) => one?.id === 'chrome')
  if (!card) return 'absent'
  const state = cardStates.find(([text]) => text === card.state)?.[1] ?? 'other'
  return (card.installed === true ? 'installed' : 'not-installed') + '/' + state
}
export function startInstallTrace(archive, matchesCatalogue) {
  const trace = { archive, matchesCatalogue, seen: [], truncated: false, from: Date.now() }
  trace.note = (answer) => noteInstall(trace, answer)
  return trace
}
function noteInstall(trace, answer) {
  const category = cardCategory(answer)
  if (trace.seen.at(-1)?.[0] === category) return
  // Past the bound, the last slot always holds the latest state: the one that matters at a timeout.
  if (trace.seen.length >= MOST) {
    trace.truncated = true
    trace.seen.pop()
  }
  trace.seen.push([category, Math.round((Date.now() - trace.from) / 1000)])
}
function safeInstallTrace(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'archive,matchesCatalogue,seen,truncated' &&
    typeof value.archive === 'string' &&
    /^[0-9a-f]{64}$/.test(value.archive) &&
    typeof value.matchesCatalogue === 'boolean' &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.seen) &&
    value.seen.length <= MOST &&
    value.seen.every(
      (one) =>
        Array.isArray(one) &&
        one.length === 2 &&
        categories.includes(one[0]) &&
        Number.isInteger(one[1]) &&
        one[1] >= 0 &&
        one[1] <= 600,
    )
  )
}
export function printInstallTrace(trace, write = (line) => console.log(line)) {
  if (!trace) return
  const { archive, matchesCatalogue, seen, truncated } = trace
  const value = { archive, matchesCatalogue, seen, truncated }
  if (safeInstallTrace(value)) write('gate-install-trace ' + JSON.stringify(value))
}
export const installTraceFrames = (receive) =>
  closedFrames('gate-install-trace ', safeInstallTrace, receive)
