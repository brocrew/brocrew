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
  const notice = installNotice(trace)
  if (safeInstallNotice(notice)) write('gate-install-notice ' + JSON.stringify(notice))
}
/** The owner's listeners: each validated frame goes to the job log as it came, never to the summary. */
export function installFrames(write = (line) => console.log(line)) {
  return [
    ['gate-install-trace ', safeInstallTrace],
    ['gate-install-notice ', safeInstallNotice],
  ].map(([prefix, safe]) =>
    closedFrames(prefix, safe, (value) => write(prefix + JSON.stringify(value))),
  )
}

// The Plugins section's notice, before the install press and after its wait, named by the app's own
// mutation-failure notices. Raw text stays in the page; only a category, an action and an
// equality fingerprint (never printed) leave it.
export const NOTICE_CAUSES = [
  'network',
  'download-stalled',
  'package-invalid',
  'policy-refused',
  'source-mismatch',
  'owner-incompatible',
  'unavailable',
]
const noticeCategories = ['none', 'other', ...NOTICE_CAUSES]
const noticeActions = ['none', 'install', 'review-install', 'other']
const origins = ['none', 'this-install', 'replaced', 'unknown']
/** The app's notice for each cause, as prepare bundled it from the shared plugin settings. */
export function readNoticeTable(bytes) {
  const table = JSON.parse(bytes)
  if (
    table === null ||
    typeof table !== 'object' ||
    Object.keys(table).sort().join(',') !== [...NOTICE_CAUSES].sort().join(',') ||
    !Object.values(table).every(
      (text) => typeof text === 'string' && text.length > 0 && text.length <= 400,
    )
  )
    throw new Error('Unexpected notice table')
  return table
}
// Serialized into the page, like chromeRowInPage. Same notice element, same precedence.
export function noticeInPage(doc, table) {
  const row = doc.querySelector('[data-plugin="chrome"][data-cy="plugin-card"]')
  const element =
    row?.querySelector('[data-cy="plugins-error"]') ??
    doc.querySelector('[data-cy="plugins-error"]')
  if (!element) return { category: 'none', action: 'none', fingerprint: '' }
  const text = (element.textContent ?? '').trim()
  const category = Object.keys(table).find((cause) => text.endsWith(table[cause])) ?? 'other'
  const action = text.startsWith("Couldn't install ")
    ? 'install'
    : text.startsWith("Couldn't review install of ")
      ? 'review-install'
      : 'other'
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0
  return { category, action, fingerprint: hash.toString(16).padStart(8, '0') }
}
export function safeNoticeObservation(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'action,category,fingerprint' &&
    noticeCategories.includes(value.category) &&
    noticeActions.includes(value.action) &&
    typeof value.fingerprint === 'string' &&
    /^(?:[0-9a-f]{8})?$/.test(value.fingerprint)
  )
}
/** The same notice before and after leaves its origin unknown. */
function installNotice(trace) {
  const before = trace.noticeBefore ?? null
  const after = trace.noticeAfter ?? null
  const origin =
    after === null
      ? 'unknown'
      : after.category === 'none'
        ? 'none'
        : before === null
          ? 'unknown'
          : before.category === 'none'
            ? 'this-install'
            : before.fingerprint === after.fingerprint
              ? 'unknown'
              : 'replaced'
  return {
    before: before?.category ?? 'unobserved',
    after: after?.category ?? 'unobserved',
    action: after?.action ?? 'unobserved',
    origin,
  }
}
function safeInstallNotice(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'action,after,before,origin' &&
    [...noticeCategories, 'unobserved'].includes(value.before) &&
    [...noticeCategories, 'unobserved'].includes(value.after) &&
    [...noticeActions, 'unobserved'].includes(value.action) &&
    origins.includes(value.origin)
  )
}
