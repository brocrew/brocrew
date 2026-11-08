import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASELINE,
  assertThreeWorkspaceStates,
  candidateReceipt,
  credentialPreserved,
  signedIdentity,
} from '../mac-signed-upgrade-contract.mjs'
import { dataPreserved } from './mac-update-test.mjs'

// The successful workflow origin is checked separately; retain and inspect its actual receipts.
export function verifyMacProof(folder, reference, manifest) {
  const summary = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'))
  assert.equal(summary.format, 'brocrew-mac-upgrade-proof-v1')
  assert.equal(summary.runId, String(reference.runId))
  assert.equal(summary.runAttempt, String(reference.runAttempt))
  assert.equal(summary.harnessSource, manifest.source)
  assert.equal(summary.source, manifest.source)
  assert.equal(summary.mode, 'guided')
  assert.equal(summary.transport, 'controlled-draft-github')
  assert.equal(summary.publicFeedAvailability, 'not proved')
  assert.equal(summary.success, true)
  assert.equal(summary.failure, undefined)
  assert.equal(summary.cleanupFailure, undefined)
  assert.equal(summary.sameCode, false)
  assert.equal(summary.scriptedCopyIsFinderDrag, false)
  const acquisition = JSON.parse(readFileSync(join(folder, 'input-receipt.json'), 'utf8'))
  assert.equal(acquisition.mode, 'guided')
  assert.equal(acquisition.transport, summary.transport)
  assert.deepEqual(acquisition.baseline, summary.baseline)
  assert.deepEqual(acquisition.candidate, summary.candidate)
  for (const [key, value] of Object.entries(BASELINE)) assert.equal(summary.baseline[key], value)
  const files = manifest.assets
    .filter(
      (row) =>
        !row.name.endsWith('.exe') &&
        !row.name.endsWith('.exe.blockmap') &&
        row.name !== 'latest.yml',
    )
    .map(({ name, bytes, sha256, sha512 }) => ({ name, size: bytes, sha256, sha512 }))
  const input = summary.to
  assert.equal(input.runId, manifest.runId)
  assert.equal(input.artifactId, manifest.origins.macos.artifactId)
  assert.equal(`sha256:${input.artifactSha256}`, manifest.origins.macos.digest)
  assert.equal(input.source, manifest.source)
  assert.equal(input.tree, manifest.tree)
  assert.equal(input.version, manifest.version)
  assert(Number.isSafeInteger(input.releaseId) && input.releaseId > 0)
  assert.equal(summary.from, undefined)
  const seals = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(seals(input.files), seals(files))
  candidateReceipt(summary.candidate, input)
  assert.deepEqual(
    seals(
      summary.candidate.files.map(({ name, size, sha256, sha512 }) => ({
        name,
        size,
        sha256,
        sha512,
      })),
    ),
    seals(files),
  )
  assert.equal(summary.download.sha256, files.find((row) => row.name.endsWith('.dmg')).sha256)
  assert(summary.download.finder && summary.download.guided)
  signedIdentity(summary.download.bundle.signature)
  signedIdentity(summary.installedCandidate.signature)
  assert.equal(summary.installedCandidate.version, manifest.version)
  for (const key of ['asarSha256', 'executableSha256']) {
    assert.match(summary.installedCandidate[key], /^[0-9a-f]{64}$/)
    assert.equal(summary.download.bundle[key], summary.installedCandidate[key])
  }
  assert.deepEqual(summary.quarantineAppliedByFixture, { image: true, installedApp: true })
  assert.deepEqual(summary.controlledTransport.failures, [])
  assert(summary.controlledTransport.requests.length > 0)
  assert.equal(summary.replacementCount, 1)
  assert.equal(summary.workspaceCount, 3)
  assert.equal(summary.workspaces.length, 3)
  assert.deepEqual(summary.workspaces.map((one) => one.name).sort(), [
    'Default',
    'WorkspaceA',
    'WorkspaceB',
  ])
  const expected = summary.workspaces.map((one) => ({ name: one.name, data: one.path }))
  const app = '/Applications/BroCrew.app'
  for (const phase of ['concurrentBaseline', 'concurrentBeforeNormalQuit'])
    assertThreeWorkspaceStates(summary[phase], expected, app, BASELINE.version, BASELINE.source)
  for (const phase of ['concurrentSignedFirst', 'concurrentSignedSecond'])
    assertThreeWorkspaceStates(summary[phase], expected, app, manifest.version, manifest.source)
  for (const workspace of summary.workspaces) {
    assert.equal(workspace.isDefault, workspace.name === 'Default')
    assert.equal(workspace.verified, true)
    assert.equal(workspace.credential.provider, 'codex')
    assert.equal(workspace.credential.set, true)
    assert.equal(workspace.credential.inUse, true)
    assert.notEqual(workspace.credential.readState, 'unreadable')
    for (const part of [workspace.first, workspace.second]) {
      assert.equal(part.path, workspace.path)
      assert.equal(part.version, manifest.version)
    }
    assert.match(workspace.first.recovery.databaseSha256, /^[0-9a-f]{64}$/)
    const before = JSON.parse(
      readFileSync(join(folder, workspace.name, 'a-settled-baseline.json'), 'utf8'),
    ).database
    const after = JSON.parse(
      readFileSync(join(folder, workspace.name, 'b-first-data.json'), 'utf8'),
    )
    assert.deepEqual(workspace.first.data, dataPreserved(before, after))
    credentialPreserved(before.provider_api_key, after.provider_api_key)
    assert(workspace.second.resumedConversation && workspace.second.responseId)
    assert.equal(workspace.shutdowns.length, 3)
    for (const [i, stage] of [
      'baseline-before-single-replacement',
      'candidate-first-reopening',
      'candidate-second-reopening',
    ].entries()) {
      const shutdown = workspace.shutdowns[i]
      assert.equal(shutdown.stage, stage)
      assert.equal(shutdown.signal, 'SIGTERM')
      assert.equal(shutdown.normalLifetimeDrain, true)
      const launchStage = ['a-settled', 'b-first', 'b-second'][i]
      const launch = summary.launches.find(
        (one) =>
          one.workspace === workspace.name && one.pid === shutdown.pid && one.stage === launchStage,
      )
      assert(launch && /^[A-Za-z0-9-]+\.log$/.test(launch.log))
      const log = readFileSync(join(folder, workspace.name, launch.log), 'utf8')
      assert.match(log, /BroCrew shut down in \d+ms/)
      for (const step of [
        'close its sessions',
        'keep its unsent drafts',
        'drain its archive work',
        'close its database',
      ]) {
        assert(log.includes(step))
        assert(!log.includes(`BroCrew failed to ${step}:`))
      }
    }
  }
  assert.equal(summary.cleanup.appRemoved, true)
  assert.deepEqual(
    summary.cleanup.fictionalWorkspaceDataRetained,
    summary.workspaces.map((one) => one.path),
  )
  return summary
}
