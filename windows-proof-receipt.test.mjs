import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { verifyIntake, nativeReceipt } from './windows-proof-receipt.mjs'

const require = createRequire(import.meta.url)
const eslintRequire = createRequire(require.resolve('eslint/package.json'))
const Ajv = eslintRequire('ajv')
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(new URL('./windows-proof-receipt.schema.json', import.meta.url))))
const example = JSON.parse(readFileSync(new URL('./windows-proof-receipt.NONRUNTIME.json', import.meta.url)))
assert(validate(example), JSON.stringify(validate.errors))
assert(!validate({ ...example, passed: true }), 'NONRUNTIME example cannot become a PASS')

// Synthetic values exercise the contract only; no fixture is emitted as native evidence.
const intake = { format: 1, carrierSha: 'a'.repeat(40), driverSha: 'b'.repeat(64), proofStage: 'final-candidate',
  candidate: { version: '0.2.12', sourceSha: 'c'.repeat(40), sourceTree: 'd'.repeat(40),
    installer: { sha256: 'e'.repeat(64), bytes: 123, buildRunId: '1', artifactName: 'release-windows', artifactId: '2' } } }
const actual = { carrierSha: intake.carrierSha, driverSha: intake.driverSha, version: '0.2.12',
  sourceSha: intake.candidate.sourceSha, sourceTree: intake.candidate.sourceTree,
  installerSha256: intake.candidate.installer.sha256, installerBytes: 123 }
assert.deepEqual(verifyIntake(intake, actual), intake)
let originRejections = 0
for (const [key, value] of Object.entries({ version: '0.2.11', sourceSha: 'f'.repeat(40), sourceTree: 'f'.repeat(40),
  carrierSha: 'f'.repeat(40), driverSha: 'f'.repeat(64), installerSha256: 'f'.repeat(64), installerBytes: 124 })) {
  assert.throws(() => verifyIntake(intake, { ...actual, [key]: value }), undefined, key)
  originRejections++
}
const phases = Array.from({ length: 5 }, (_, i) => ({ name: `synthetic-${i}`, started: 'fixture', finished: 'fixture', passed: true }))
const summary = { intake, passed: true, testPath: 'public-019-upgrade', phases, failures: [],
  observerExit: { exitCode: 0, signal: null }, observer: { passed: true }, nativeWitness: { passed: true },
  candidateQuitCode: 0, cleanup: { forced: false, owner: { phase: 'stopped' }, processes: [] },
  expected: example.pluginPins, baseline: { reply: { ok: true } }, residualPreUpgrade: [], residualAfterInstaller: [] }
const receipt = nativeReceipt(summary)
assert(validate(receipt), JSON.stringify(validate.errors))
assert.equal(receipt.candidate.installer.artifactId, '2')
assert.deepEqual(receipt.baseline, summary.baseline)
for (const change of [
  { observerExit: { exitCode: 1, signal: null } }, { observerExit: { exitCode: null, signal: 'SIGTERM' } },
  { observer: { passed: false } }, { nativeWitness: { passed: false } }, { candidateQuitCode: 1 },
  { cleanup: { ...summary.cleanup, forced: true } }, { cleanup: { ...summary.cleanup, owner: { phase: 'accepting' } } },
  { cleanup: { ...summary.cleanup, processes: [{ ProcessId: 1 }] } },
]) assert.throws(() => nativeReceipt({ ...summary, ...change }))
const failed = nativeReceipt({ ...summary, passed: false, failures: ['synthetic failure'], observerExit: { exitCode: 1, signal: null },
  observer: undefined, nativeWitness: undefined, candidateQuitCode: undefined, cleanup: { forced: true, processes: [] } })
assert(validate(failed), JSON.stringify(validate.errors))
assert.equal(failed.passed, false)
assert.equal(failed.shutdown.forced, true)
assert.equal(failed.observer.exitCode, 1)
assert.equal(failed.observer.passed, null)
console.log(JSON.stringify({ originRejections, nonruntimePassRejected: true, falsePassRejections: 8, failedOutcomePreserved: true,
  scope: 'synthetic receipt/schema controls; no native receipt or runtime proof' }))
