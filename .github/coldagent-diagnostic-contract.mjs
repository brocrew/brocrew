import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [phase, folder] = process.argv.slice(2)
const read = (name) => readFileSync(join(folder, name), 'utf8')
const report = JSON.parse(read('report.json'))
const results = report.testResults.flatMap((one) => one.assertionResults)
const name = 'a cold agent gets each plugin that is ready pending warmups reserve the existing route capacity until their cleanup completes'
const pins = {
  red: ['2aad4833cc2b2254ed2254eb4b9360b41753ab91', '21fa5ee26522be396e687ae722605e6a5806ab2b'],
  green: ['065e2e3dcb9b07e9e85cad0d065b169a8d392158', '044652a3e4990ae38a4dba26af02726788c93590'],
}
assert.ok(phase === 'red' || phase === 'green', 'unknown phase')
assert.equal(read('source-sha.txt').trim(), pins[phase][0])
assert.equal(read('source-tree.txt').trim(), pins[phase][1])
assert.equal(report.numTotalTests, 22)
assert.equal(results.length, 22)

if (phase === 'red') {
  assert.equal(read('exit-code.txt').trim(), '1', 'RED native exit must be 1')
  assert.equal(report.numFailedTests, 1)
  assert.equal(report.numPassedTests, 0)
  assert.equal(report.numPendingTests, 21)
  const failed = results.filter((one) => one.status === 'failed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0].fullName, name)
  assert.match(failed[0].failureMessages.join('\n'), /expected \[\] to deeply equal \[ 'aster' \]/)
  const output = read('stdout.log') + '\n' + read('stderr.log')
  const events = (label) => output.split(/\r?\n/).filter((line) => line.includes(label + ' '))
    .map((line) => JSON.parse(line.slice(line.indexOf(label + ' ') + label.length + 1)))
  const reads = events('COLD_AGENT_READ')
  assert.equal(reads.length, 2)
  assert.equal(reads[0].index, 0)
  assert.deepEqual(reads[0].answer, { servers: [], pending: ['aster'], none: [], unknown: false })
  assert.equal(reads[0].scopeCalls, 2)
  assert.equal(reads[1].index, 1)
  assert.deepEqual(reads[1].answer, { servers: [], pending: [], none: [], unknown: true })
  assert.equal(reads[1].asked, 0)
  assert.equal(reads[1].returned, 6)
  assert.equal(reads[1].scopeCalls, 0)
  assert.deepEqual(reads[1].scope, [])
  assert.equal(reads[1].capacityReports, 0)
  assert.equal(reads[1].opened, 0)
  assert.equal(reads[1].closed, 0)
  const expired = events('COLD_AGENT_EXPIRED')
  assert.equal(expired.length, 1)
  assert.equal(expired[0].phase, 'before-plan')
  assert.equal(expired[0].scope, null)
  assert.equal(expired[0].asked, 0)
  assert.equal(expired[0].elapsedMs, 6)
  assert.equal(expired[0].answerWithinMs, 5)
  assert.deepEqual(expired[0].capacity, { reserved: 1, limit: 1024 })
  assert.equal(expired[0].warmups, 1)
  assert.equal(expired[0].routes, 0)
  assert.deepEqual(expired[0].answer, reads[1].answer)
  console.log('RED contract PASS: native exit=1; loop index=1, elapsed=6ms/5ms, scope calls=0, unknown=true, pending=[], reserved=1/1024, opened=closed=0; original capacity assertion failed')
} else {
  assert.equal(read('exit-code.txt').trim(), '0', 'GREEN native exit must be 0')
  assert.equal(report.numPassedTests, 22)
  assert.equal(report.numFailedTests, 0)
  assert.equal(report.numPendingTests, 0)
  assert.equal(report.success, true)
  assert.ok(results.every((one) => one.status === 'passed'))
  assert.equal(results.filter((one) => one.fullName === name).length, 1)
  console.log('GREEN contract PASS: exact product candidate, native exit=0, all 22 tests pass')
}
