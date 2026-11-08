import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { candidateProfile, assertCandidateBuild, assertProductVersion } from './windows-candidate-profile.mjs'

const sourceSha = 'a'.repeat(40)
let plans = 0, mismatches = 0
for (const version of ['0.2.11', '0.2.12']) {
  assert.equal(candidateProfile(version).installerName, `BroCrew-Setup-${version}-x64.exe`)
  for (const mode of ['public-019-clean', 'public-019-upgrade']) {
    const result = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--test-path', mode, '--candidate-version', version], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const plan = JSON.parse(result.stdout)
    assert.equal(plan.execute, false)
    assert.equal(plan.candidate.version, version)
    assert.equal(plan.candidate.installerName, `BroCrew-Setup-${version}-x64.exe`)
    assert.equal(plan.expected.chrome.version, '0.1.9')
    assert.equal(plan.expected.whatsapp.version, '0.1.4')
    assert(plan.plan[0].includes('both candidate plugins mandatory, no Chrome exception'))
    if (mode.endsWith('upgrade')) assert(plan.plan.includes(`install exact ${version} candidate NSIS over beta`))
    plans++
  }
  assertProductVersion(version, version)
  assertProductVersion(`${version}.0`, version)
  assertCandidateBuild({ version, build: { commit: sourceSha, dirty: false } }, version, sourceSha)
}
assert.equal(candidateProfile().version, '0.2.11')
const defaultPlan = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs'], { encoding: 'utf8' })
const explicit011 = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--candidate-version', '0.2.11'], { encoding: 'utf8' })
assert.equal(defaultPlan.status, 0, defaultPlan.stderr)
assert.equal(explicit011.status, 0, explicit011.stderr)
assert.deepEqual(JSON.parse(defaultPlan.stdout), JSON.parse(explicit011.stdout))
for (const [actual, wanted] of [['0.2.11', '0.2.12'], ['0.2.12', '0.2.11']]) {
  assert.throws(() => assertProductVersion(actual, wanted)); mismatches++
  assert.throws(() => assertProductVersion(`${actual}.0`, wanted)); mismatches++
  assert.throws(() => assertCandidateBuild({ version: actual, build: { commit: sourceSha, dirty: false } }, wanted, sourceSha)); mismatches++
}
assert.throws(() => assertCandidateBuild({ version: '0.2.12', build: { commit: 'b'.repeat(40), dirty: false } }, '0.2.12', sourceSha))
assert.throws(() => assertCandidateBuild({ version: '0.2.12', build: { commit: sourceSha, dirty: true } }, '0.2.12', sourceSha))
console.log(JSON.stringify({ plans, versionMismatchesRejected: mismatches, wrongCommitAndDirtyRejected: 2, scope: 'SOURCE controls only; no Windows execution' }))
