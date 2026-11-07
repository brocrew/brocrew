import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { public019Profile } from './public-019-profile.mjs'

for (const mode of ['public-019-clean', 'public-019-upgrade']) {
  assert.throws(() => public019Profile(mode, true), /forbids custom/)
  const result = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--test-path', mode], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.execute, false)
  assert.equal(plan.expected.chrome.version, '0.1.9')
  assert.equal(plan.expected.chrome.sourceCommit, 'a3acd9f105e666f71d49d1eb967dfe0b790fa762')
  assert.equal(plan.expected.whatsapp.version, '0.1.4')
  assert(plan.plan[0].includes('no Chrome exception'))
  assert.equal(plan.plan.some(line => line.includes('without installing or launching beta')), mode === 'public-019-clean')
}
for (const mode of ['failed-beta-recovery', 'clean-install', 'app-upgrade-compat']) {
  assert.equal(public019Profile(mode, false), null)
  const result = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--test-path', mode], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).expected.chrome.version, '0.1.8')
}
console.log(JSON.stringify({ public019Plans: 2, customTransportRejections: 2, unchangedLegacyPlans: 3, scope: 'plan and profile only; no installed or public delivery proof' }))
