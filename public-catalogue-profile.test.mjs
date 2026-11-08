import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { public019Profile } from './public-019-profile.mjs'
import { publicCatalogueProfile, verifyCatalogueCapture } from './public-catalogue-profile.mjs'

// Captured by failed native42503740821; this is input/provenance evidence, never runtime proof.
const fixture = new URL('./public-catalogue-profile.fixture.json', import.meta.url)
const bytes = readFileSync(fixture)
const profile = publicCatalogueProfile(bytes)
if (process.argv.includes('--red-fixed019')) {
  assert.equal(public019Profile('public-019-clean', false).chrome.version, profile.expected.chrome.version)
  throw Error('the original fixed019 mismatch unexpectedly passed')
}
assert.equal(profile.expected.chrome.version, '0.1.11')
assert.equal(profile.expected.chrome.sha256, '7d3536f4dde623b852edb56a76a86e79f008c29894b86f5cf05dcd1250efb7c9')
assert.equal(profile.expected.chrome.manifest, '4a85d0aa37e9b90f21a03270755eb291fce53d6f1edf700f23398840a819dc81')
assert.equal(profile.expected.chrome.sourceCommit, 'f0a3561d11880d4961652b2d0364dc5a6a84c401')
assert.equal(profile.expected.whatsapp.version, '0.1.4')
assert.throws(() => publicCatalogueProfile(bytes, true), /forbids custom/)

let rejected = 0
const mutate = fn => { const catalogue = JSON.parse(bytes); fn(catalogue); return Buffer.from(JSON.stringify(catalogue)) }
for (const change of [
  c => { c.format = 1 },
  c => { c.entries = c.entries.filter(e => e.id !== 'whatsapp') },
  c => { c.entries.push(structuredClone(c.entries[0])) },
  c => { c.entries[0].version = 'latest' },
  c => { c.entries[0].sourceCommit = 'main' },
  c => { c.entries[0].targets.push(structuredClone(c.entries[0].targets.find(t => t.os === 'win32'))) },
  c => { c.entries[0].targets.find(t => t.os === 'win32').url = 'https://example.test/archive.tar.gz' },
  c => { c.entries[0].targets.find(t => t.os === 'win32').sha256 = 'not-a-digest' },
  c => { c.entries[0].targets.find(t => t.os === 'win32').manifestSha256 = 'not-a-digest' },
  c => { c.entries[0].targets.find(t => t.os === 'win32').bytes = 0 },
]) { assert.throws(() => publicCatalogueProfile(mutate(change))); rejected++ }

// A later valid catalogue changes the selected input, rather than being silently pinned to014.
const later = mutate(c => {
  const entry = c.entries.find(e => e.id === 'whatsapp')
  entry.version = '0.1.5'; entry.sourceCommit = 'a'.repeat(40)
  const target = entry.targets.find(t => t.os === 'win32')
  Object.assign(target, { url: 'https://github.com/brocrew/brocrew-plugin-whatsapp/releases/download/v0.1.5/whatsapp-win32-x64.tar.gz',
    bytes: 123, sha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) })
})
assert.equal(publicCatalogueProfile(later).expected.whatsapp.version, '0.1.5')
assert.equal(publicCatalogueProfile(later).expected.whatsapp.bytes, 123)
const capture = { format: 'brocrew.public-plugin-catalogue.v1', ...profile.seal, capturedAt: '2026-11-08T17:13:15.000Z',
  origin: { runId: '123', runAttempt: '1', carrierSha: 'a'.repeat(40) }, selected: profile.selected }
assert.deepEqual(verifyCatalogueCapture(bytes, capture, capture.origin).expected, profile.expected)
for (const change of [{ sha256: 'f'.repeat(64) }, { bytes: bytes.length + 1 }, { url: 'https://example.test' }, { capturedAt: 'invalid' }]) {
  assert.throws(() => verifyCatalogueCapture(bytes, { ...capture, ...change }, capture.origin)); rejected++
}
assert.throws(() => verifyCatalogueCapture(Buffer.concat([bytes, Buffer.from('\n')]), capture, capture.origin))

for (const change of [{ runId: '999' }, { runAttempt: '2' }, { carrierSha: 'f'.repeat(40) }]) {
  assert.throws(() => verifyCatalogueCapture(bytes, capture, { ...capture.origin, ...change })); rejected++
}
assert.throws(() => verifyCatalogueCapture(bytes, { ...capture, selected: { ...capture.selected, chrome: capture.selected.whatsapp } }, capture.origin))

let plans = 0
for (const version of ['0.2.11', '0.2.12']) for (const mode of ['public-live-clean', 'public-live-upgrade']) {
  const result = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--test-path', mode,
    '--candidate-version', version, '--catalogue', fileURLToPath(fixture)], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.execute, false)
  assert.equal(plan.candidate.version, version)
  assert.deepEqual(plan.expected, profile.expected)
  assert.equal(plan.plan.some(line => line.includes('without installing or launching beta')), mode.endsWith('clean'))
  assert(plan.plan[0].includes('both candidate plugins mandatory, no Chrome exception'))
  plans++
}
for (const flag of ['--plugin-inputs', '--plugin-run-id', '--plugin-artifact', '--plugin-receipt-sha256']) {
  const result = spawnSync(process.execPath, ['windows-plugin-upgrade.mjs', '--test-path', 'public-live-clean',
    '--catalogue', fileURLToPath(fixture), flag, 'unwanted'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /forbids custom/)
}
console.log(JSON.stringify({ plans, rejected, customInputRejections: 4,
  scope: 'headless captured-input and plan controls only; no catalogue fetch or native execution' }))
