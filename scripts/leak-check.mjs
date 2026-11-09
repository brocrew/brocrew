// Fails when a tracked file, a tracked file's name, or a commit in the range given as the only
// argument carries a private name. The names come from BROBOT_LEAK_PATTERNS, one fixed string per
// line, matched in any case; commits are also checked against BROBOT_COMMIT_PATTERNS. Only paths
// and commit ids are printed, and GitHub masks the secrets themselves in the log.
import { execFileSync } from 'node:child_process'

const listed = (variable) =>
  (process.env[variable] ?? '')
    .split('\n')
    .map((line) => line.trim().normalize('NFC').toLowerCase())
    .filter((line) => line !== '' && !line.startsWith('#'))

const names = listed('BROBOT_LEAK_PATTERNS')
if (names.length === 0) {
  console.error('leak check: BROBOT_LEAK_PATTERNS is empty; set it (in CI, the repository secret).')
  process.exit(1)
}
const commitNames = [...names, ...listed('BROBOT_COMMIT_PATTERNS')]
const carries = (text, list) => list.some((name) => text.normalize('NFC').toLowerCase().includes(name))
const git = (args, input) =>
  execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 })

const found = []
try {
  // -c prints each matching file with its count of matching lines, never the lines themselves.
  const counts = git(['grep', '-I', '-i', '-F', '-c', '-f', '-'], `${names.join('\n')}\n`)
  found.push(...counts.split('\n').filter((line) => line !== ''))
} catch (error) {
  if (error.status !== 1) throw error
}
for (const path of git(['ls-files', '-z']).split('\0')) {
  if (path !== '' && carries(path, names)) found.push(`${path} (its name)`)
}
const range = process.argv[2]
if (range !== undefined) {
  const log = git(['log', '-z', '--format=%h %an <%ae> %cn <%ce>%n%B', range, '--'])
  for (const record of log.split('\0')) {
    if (carries(record, commitNames)) found.push(`commit ${record.slice(0, record.indexOf(' '))}`)
  }
}

if (found.length > 0) {
  console.error('leak check: these carry a private name; remove it, or reword the commit:')
  for (const line of found) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`leak check: no private name found (${names.length} checked)`)
