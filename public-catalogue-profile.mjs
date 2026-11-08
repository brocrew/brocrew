import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const publicCatalogueUrl = 'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json'
export const livePublicPaths = ['public-live-clean', 'public-live-upgrade']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Select exact published inputs from one retained response, never from a version fallback.
export function publicCatalogueProfile(bytes, customInputs = false) {
  assert.equal(customInputs, false, 'live public proof forbids custom archive transport')
  const catalogue = JSON.parse(bytes.toString('utf8'))
  assert.equal(catalogue.format, 2)
  assert(Array.isArray(catalogue.entries))
  const expected = {}, selected = {}
  for (const id of ['chrome', 'whatsapp']) {
    const entries = catalogue.entries.filter(entry => entry.id === id)
    assert.equal(entries.length, 1, `${id}: exactly one catalogue entry required`)
    const entry = entries[0]
    assert.match(entry.version, /^\d+\.\d+\.\d+$/)
    assert.match(entry.sourceCommit, /^[a-f0-9]{40}$/)
    const targets = entry.targets.filter(target => target.os === 'win32' && target.cpu === 'x64')
    assert.equal(targets.length, 1, `${id}: exactly one Windows target required`)
    const target = targets[0]
    assert.equal(target.compression, 'tar.gz')
    assert(Number.isSafeInteger(target.bytes) && target.bytes > 0 && target.bytes <= 128 * 1024 * 1024)
    assert.match(target.sha256, /^[a-f0-9]{64}$/)
    assert.match(target.manifestSha256, /^[a-f0-9]{64}$/)
    const repo = `brocrew-plugin-${id}`
    assert.equal(target.url, `https://github.com/brocrew/${repo}/releases/download/v${entry.version}/${id}-win32-x64.tar.gz`)
    expected[id] = { version: entry.version, bytes: target.bytes, sha256: target.sha256,
      manifest: target.manifestSha256, sourceCommit: entry.sourceCommit, repo, url: target.url }
    selected[id] = { entrySha256: digest(Buffer.from(JSON.stringify(entry))), targetSha256: digest(Buffer.from(JSON.stringify(target))) }
  }
  return { catalogue, expected, seal: { url: publicCatalogueUrl, bytes: bytes.length, sha256: digest(bytes) }, selected }
}

export function verifyCatalogueCapture(bytes, capture, origin) {
  const profile = publicCatalogueProfile(bytes)
  assert.equal(capture.format, 'brocrew.public-plugin-catalogue.v1')
  for (const key of ['url', 'bytes', 'sha256']) assert.equal(capture[key], profile.seal[key], `catalogue ${key} mismatch`)
  assert.deepEqual(capture.selected, profile.selected)
  assert(Number.isFinite(Date.parse(capture.capturedAt)))
  assert.match(capture.origin.runId, /^[1-9][0-9]*$/)
  assert.match(capture.origin.runAttempt, /^[1-9][0-9]*$/)
  assert.match(capture.origin.carrierSha, /^[a-f0-9]{40}$/)
  assert.deepEqual(capture.origin, origin, 'catalogue capture origin mismatch')
  return profile
}
