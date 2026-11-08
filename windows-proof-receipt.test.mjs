import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  candidateExit: { code: 0, signal: null, observed: true }, cleanup: { forced: false, owner: { phase: 'stopped' }, processes: [] },
  expected: example.pluginPins, baseline: { reply: { ok: true } }, residualPreUpgrade: [], residualAfterInstaller: [] }
const receipt = nativeReceipt(summary)
assert(validate(receipt), JSON.stringify(validate.errors))
assert.equal(receipt.candidate.installer.artifactId, '2')
assert.deepEqual(receipt.baseline, summary.baseline)
for (const change of [
  { observerExit: { exitCode: 1, signal: null } }, { observerExit: { exitCode: null, signal: 'SIGTERM' } },
  { observer: { passed: false } }, { nativeWitness: { passed: false } }, { candidateExit: { code: 7, signal: null, observed: true } },
  { cleanup: { ...summary.cleanup, forced: true } }, { cleanup: { ...summary.cleanup, owner: { phase: 'accepting' } } },
  { cleanup: { ...summary.cleanup, processes: [{ ProcessId: 1 }] } },
]) assert.throws(() => nativeReceipt({ ...summary, ...change }))
const failed = nativeReceipt({ ...summary, passed: false, failures: ['synthetic failure'], observerExit: { exitCode: 1, signal: null },
  observer: undefined, nativeWitness: undefined, candidateExit: undefined, cleanup: { forced: true, processes: [] } })
assert(validate(failed), JSON.stringify(validate.errors))
assert.equal(failed.passed, false)
assert.equal(failed.shutdown.forced, true)
assert.equal(failed.observer.exitCode, 1)
assert.equal(failed.observer.passed, null)

const fixture = mkdtempSync(join(tmpdir(), 'windows-proof-intake-'))
let artifactOriginRejections = 0
try {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const sourceSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  mkdirSync(join(fixture, 'evidence')); mkdirSync(join(fixture, 'candidate-normalized'))
  const bytes = Buffer.from('synthetic installer bytes; never executable')
  writeFileSync(join(fixture, 'candidate-normalized', 'BroCrew-Setup-0.2.12-x64.exe'), bytes)
  const build = { id: 123, repository: { full_name: 'brocrew/brocrew' }, head_sha: sourceSha }
  const artifact = { id: 456, name: 'release-windows', expired: false, workflow_run: { id: 123, head_sha: sourceSha } }
  const execute = (runRecord, artifactRecord) => {
    writeFileSync(join(fixture, 'evidence', 'candidate-build-run.json'), JSON.stringify(runRecord))
    writeFileSync(join(fixture, 'evidence', 'candidate-build-artifacts.json'), JSON.stringify([{ artifacts: Array.isArray(artifactRecord)?artifactRecord:[artifactRecord] }]))
    return spawnSync(process.execPath, [join(root, 'windows-proof-receipt.mjs'), 'evidence', root, root], {
      cwd: fixture, encoding: 'utf8', env: { ...process.env, CANDIDATE_VERSION: '0.2.12', CANDIDATE_SHA: sourceSha,
        INSTALLER_RUN_ID: '123', INSTALLER_ARTIFACT: 'release-windows', PROOF_STAGE: 'final-candidate',
        EXPECTED_INSTALLER_SHA256: createHash('sha256').update(bytes).digest('hex') },
    })
  }
  const valid = execute(build, artifact)
  assert.equal(valid.status, 0, valid.stderr)
  const sealed = JSON.parse(readFileSync(join(fixture, 'evidence', 'intake.json')))
  assert.equal(sealed.candidate.installer.artifactId, '456')
  assert.equal(sealed.candidate.sourceSha, sourceSha)
  for (const [label, runRecord, artifactRecord] of [
    ['wrong run ID', { ...build, id: 999 }, artifact],
    ['wrong artifact run', build, { ...artifact, workflow_run: { id: 999, head_sha: sourceSha } }],
    ['wrong artifact name', build, { ...artifact, name: 'other-artifact' }],
    ['duplicate artifact', build, [artifact, { ...artifact, id: 789 }]],
    ['wrong run source', { ...build, head_sha: 'f'.repeat(40) }, artifact],
    ['wrong repository', { ...build, repository: { full_name: 'other/repo' } }, artifact],
    ['wrong artifact source', build, { ...artifact, workflow_run: { id: 123, head_sha: 'f'.repeat(40) } }],
    ['expired artifact', build, { ...artifact, expired: true }],
  ]) {
    const result = execute(runRecord, artifactRecord)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /AssertionError/)
    console.log(JSON.stringify({ control: label, exitCode: result.status, stderr: result.stderr }))
    artifactOriginRejections++
  }
} finally { rmSync(fixture, { recursive: true, force: true }) }
console.log(JSON.stringify({ originRejections, nonruntimePassRejected: true, falsePassRejections: 8, failedOutcomePreserved: true,
  artifactOriginRejections, scope: 'synthetic receipt/schema controls; no native receipt or runtime proof' }))
