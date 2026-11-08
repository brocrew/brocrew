import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha = /^[a-f0-9]{40}$/
const hash = /^[a-f0-9]{64}$/
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const git = (root, revision) => execFileSync('git', ['-C', root, 'rev-parse', revision], { encoding: 'utf8' }).trim()

export function verifyIntake(intake, actual) {
  assert.equal(intake.format, 1)
  for (const key of ['carrierSha', 'driverSha']) assert.equal(intake[key], actual[key], `intake ${key} mismatch`)
  assert.match(intake.carrierSha, sha); assert.match(intake.driverSha, hash)
  for (const key of ['version', 'sourceSha', 'sourceTree']) assert.equal(intake.candidate[key], actual[key], `candidate ${key} mismatch`)
  assert.match(intake.candidate.sourceSha, sha); assert.match(intake.candidate.sourceTree, sha)
  const installer = intake.candidate.installer
  assert.match(installer.sha256, hash)
  assert.equal(installer.sha256, actual.installerSha256)
  assert.equal(installer.bytes, actual.installerBytes)
  assert(Number.isSafeInteger(installer.bytes) && installer.bytes > 0)
  assert.match(installer.buildRunId, /^\d+$/); assert.match(installer.artifactId, /^\d+$/)
  assert.equal(typeof installer.artifactName, 'string'); assert(installer.artifactName.length > 0)
  assert(['early-recipe', 'final-candidate'].includes(intake.proofStage))
  return intake
}

export function nativeReceipt(summary) {
  const intake = summary.intake
  assert(intake, 'verified workflow intake required')
  if (summary.passed) {
    assert.equal(summary.observerExit?.exitCode, 0)
    assert.equal(summary.observerExit?.signal, null)
    assert.equal((summary.observerResult ?? summary.observer)?.passed, true)
    assert.equal(summary.nativeWitness?.passed, true)
    assert.equal(summary.candidateExit?.observed, true)
    assert.equal(summary.candidateExit?.code, 0)
    assert.equal(summary.cleanup?.forced, false)
    assert.equal(summary.cleanup?.owner?.phase, 'stopped')
    assert.deepEqual(summary.cleanup?.processes, [])
  }
  return {
    format: 'brocrew.windows-installed-plugin-proof.v1',
    carrierSha: intake.carrierSha, driverSha: intake.driverSha, candidate: intake.candidate,
    testPath: summary.testPath, proofStage: intake.proofStage, passed: summary.passed,
    phases: summary.phases, failures: summary.failures,
    observer: { exitCode: summary.observerExit?.exitCode ?? null, signal: summary.observerExit?.signal ?? null,
      passed: (summary.observerResult ?? summary.observer)?.passed ?? null, nativeWitness: summary.nativeWitness ?? null },
    shutdown: { quitCode: summary.candidateExit?.code ?? null, forced: summary.cleanup?.forced ?? null,
      ownerPhase: summary.cleanup?.owner?.phase ?? null, remainingProcesses: summary.cleanup?.processes ?? null },
    pluginPins: summary.expected, baseline: summary.baseline ?? null,
    residualState: { beforeUpgrade: summary.residualPreUpgrade ?? null, afterInstaller: summary.residualAfterInstaller ?? null },
  }
}

// Workflow intake uses the fetched run/artifact records and the exact downloaded bytes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [evidence, source, carrier] = process.argv.slice(2)
  const env = process.env, build = read(join(evidence, 'candidate-build-run.json'))
  assert.equal(String(build.id), env.INSTALLER_RUN_ID)
  assert.equal(build.repository.full_name, 'brocrew/brocrew')
  assert.equal(build.head_sha, env.CANDIDATE_SHA)
  const artifacts = read(join(evidence, 'candidate-build-artifacts.json')).flatMap(page => page.artifacts)
    .filter(artifact => artifact.name === env.INSTALLER_ARTIFACT)
  assert.equal(artifacts.length, 1)
  const artifact = artifacts[0]
  assert.equal(artifact.expired, false)
  assert.equal(String(artifact.workflow_run.id), env.INSTALLER_RUN_ID)
  assert.equal(artifact.workflow_run.head_sha, env.CANDIDATE_SHA)
  const bytes = readFileSync(join('candidate-normalized', `BroCrew-Setup-${env.CANDIDATE_VERSION}-x64.exe`))
  const intake = { format: 1, carrierSha: git(carrier, 'HEAD'),
    driverSha: digest(readFileSync(join(carrier, 'windows-plugin-upgrade.mjs'))),
    candidate: { version: env.CANDIDATE_VERSION, sourceSha: env.CANDIDATE_SHA, sourceTree: git(source, 'HEAD^{tree}'),
      installer: { sha256: digest(bytes), bytes: bytes.length, buildRunId: String(build.id), artifactName: artifact.name, artifactId: String(artifact.id) } },
    proofStage: env.PROOF_STAGE }
  assert.equal(intake.candidate.installer.sha256, env.EXPECTED_INSTALLER_SHA256)
  assert.equal(git(source, 'HEAD'), env.CANDIDATE_SHA)
  writeFileSync(join(evidence, 'intake.json'), JSON.stringify(intake, null, 2) + '\n')
}
