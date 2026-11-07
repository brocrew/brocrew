// Test-harness input verification; installed Settings still verifies every delivered package.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function readCustomPluginInputs(directory, receiptSha256, publicCatalogue, origin) {
  assert.match(receiptSha256, /^[a-f0-9]{64}$/)
  assert.match(String(origin.runId), /^[0-9]+$/)
  assert.equal(typeof origin.artifact, 'string'); assert(origin.artifact.length > 0)
  const receiptBytes = readFileSync(join(directory, 'plugin-inputs.json'))
  assert.equal(sha256(receiptBytes), receiptSha256, 'custom plugin receipt hash mismatch')
  const receipt = JSON.parse(receiptBytes)
  assert.equal(receipt.format, 1)
  assert([1, 2].includes(receipt.plugins.length))
  const ids = receipt.plugins.map(p => p.catalogueEntry.id).sort()
  assert.deepEqual(ids, ids.length === 1 ? ['chrome'] : ['chrome', 'whatsapp'])
  assert.equal(publicCatalogue.format, 2)
  const catalogue = structuredClone(publicCatalogue), expected = {}, archives = [], witnesses = []
  for (const input of receipt.plugins) {
    assert.equal(input.archiveFilename, basename(input.archiveFilename))
    assert.match(input.archiveFilename, /^[a-z][a-z0-9.-]*\.tar\.gz$/)
    const entry = input.catalogueEntry
    assert.equal(input.id, entry.id); assert.equal(input.version, entry.version); assert.equal(input.sourceCommit, entry.sourceCommit)
    assert.match(entry.sourceCommit, /^[a-f0-9]{40}$/)
    assert.match(entry.version, /^\d+\.\d+\.\d+$/)
    const targets = entry.targets.filter(t => t.os === 'win32' && t.cpu === 'x64')
    assert.equal(targets.length, 1)
    const target = targets[0]
    assert.equal(input.archiveBytes, target.bytes); assert.equal(input.archiveSha256, target.sha256); assert.equal(input.manifestSha256, target.manifestSha256)
    assert.match(target.sha256, /^[a-f0-9]{64}$/)
    assert.match(target.manifestSha256, /^[a-f0-9]{64}$/)
    assert.equal(target.compression, 'tar.gz')
    assert(Number.isSafeInteger(target.bytes) && target.bytes > 0 && target.bytes <= 128 * 1024 * 1024)
    const url = new URL(target.url)
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'github.com')
    assert.equal(url.username + url.password + url.search + url.hash + url.port, '')
    assert.equal(url.pathname, `/brocrew/brocrew-plugin-${entry.id}/releases/download/v${entry.version}/${entry.id}-win32-x64.tar.gz`)
    const path = join(directory, input.archiveFilename), stat = lstatSync(path)
    assert(stat.isFile() && !stat.isSymbolicLink())
    const bytes = readFileSync(path)
    assert.equal(bytes.length, target.bytes); assert.equal(sha256(bytes), target.sha256)
    const extracted = spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xOzf', '-', 'plugin.json'], {input: bytes, maxBuffer: 4 * 1024 * 1024, timeout: 30000})
    assert.ifError(extracted.error); assert.equal(extracted.status, 0, `manifest extraction failed: ${extracted.stderr?.subarray(0,16384).toString('utf8')}`)
    assert.equal(sha256(extracted.stdout), target.manifestSha256)
    const manifest = JSON.parse(extracted.stdout)
    assert.equal(manifest.id, entry.id); assert.equal(manifest.version, entry.version)
    assert.equal(manifest.sourceCommit, entry.sourceCommit)
    assert(manifest.platforms.some(p => p.os === 'win32' && p.cpu === 'x64'))
    const index = catalogue.entries.findIndex(e => e.id === entry.id)
    assert(index >= 0); catalogue.entries[index] = entry
    expected[entry.id] = {version: entry.version, bytes: target.bytes, sha256: target.sha256, manifest: target.manifestSha256, repo: `brocrew-plugin-${entry.id}`}
    archives.push({url: target.url, path, size: bytes.length, sha256: target.sha256})
    witnesses.push({id: entry.id, version: entry.version, sourceCommit: entry.sourceCommit, archiveSha256: target.sha256, manifestSha256: target.manifestSha256, archiveBytes: bytes.length, buildRunId: String(origin.runId), buildArtifact: origin.artifact})
  }
  for (const id of ['chrome', 'whatsapp']) {
    const entry = catalogue.entries.find(e => e.id === id)
    assert(entry)
    const target = entry.targets.find(t => t.os === 'win32' && t.cpu === 'x64')
    assert(target)
    expected[id] = {version: entry.version, bytes: target.bytes, sha256: target.sha256, manifest: target.manifestSha256, repo: `brocrew-plugin-${id}`}
  }
  return {expected, catalogueBytes: Buffer.from(JSON.stringify(catalogue)), archives, witness: {receiptSha256, transport: 'instrumented transport, not public delivery', plugins: witnesses}}
}
