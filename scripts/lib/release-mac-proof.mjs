import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASELINE,
  assertThreeWorkspaceStates,
  candidateNames,
  candidateReceipt,
  credentialPreserved,
  signedIdentity,
} from '../mac-signed-upgrade-contract.mjs'
import { fileSeal } from '../release-artifacts.mjs'
import { expectedSigningIdentity } from './mac-signing-identity.mjs'
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

const HEX64 = /^[0-9a-f]{64}$/
const OID = /^[0-9a-f]{40}$/
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const EVIDENCE_ROLES = [
  'exit-lease-process-cleanup',
  'service-plugins-tools',
  'signing-build-identity',
  'unchanged-bytes-detach',
]
const fields = (value, names, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is required`)
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), `${label} fields differ`)
}
const positive = (value) => Number.isSafeInteger(value) && value > 0
const text = (value) => typeof value === 'string' && value.trim().length > 0
const seal = (value, label) => {
  fields(value, ['bytes', 'sha256'], label)
  assert(positive(value.bytes) && HEX64.test(value.sha256), `${label} seal differs`)
}

// The operator's reviewed assessment of one new headless normal-DMG observation. Hosted code checks
// it against the original signed Mac artifact; reviewers rehash the local receipts it references.
export function verifyMacNormalInstall(
  folder,
  witness,
  manifest,
  identity = expectedSigningIdentity(),
) {
  fields(witness, ['json', 'sha256'], 'Mac normal-install witness')
  assert.equal(typeof witness.json, 'string')
  assert.match(witness.sha256, HEX64)
  assert.equal(
    createHash('sha256').update(witness.json, 'utf8').digest('hex'),
    witness.sha256,
    'Mac normal-install assessment bytes differ',
  )
  const assessment = JSON.parse(witness.json)
  fields(
    assessment,
    [
      'format',
      'repository',
      'source',
      'tree',
      'version',
      'candidate',
      'dmg',
      'signingReceipt',
      'recordKind',
      'scope',
      'normalInstall',
      'automaticUpdates',
      'keychain',
      'signing',
      'oldMac',
      'lifecycle',
      'evidence',
    ],
    'Mac normal-install assessment',
  )
  assert.equal(assessment.format, 'brocrew.mac-normal-install-operator-witness.v1')
  for (const key of ['repository', 'source', 'tree', 'version'])
    assert.equal(assessment[key], manifest[key], `Mac assessment ${key} differs`)
  assert.deepEqual(assessment.candidate, {
    runId: manifest.runId,
    runAttempt: manifest.runAttempt,
    macArtifactId: manifest.origins.macos.artifactId,
    macArtifactDigest: manifest.origins.macos.digest,
  })
  const dmg = manifest.assets.find((row) => row.name === `BroCrew-${manifest.version}-arm64.dmg`)
  assert.deepEqual(assessment.dmg, { name: dmg.name, bytes: dmg.bytes, sha256: dmg.sha256 })

  // Exactly the five original Mac payload files and their signed receipt, sealed by the manifest.
  const names = candidateNames(manifest.version)
  assert.deepEqual(readdirSync(folder).sort(), [...names, 'mac-signed-candidate.json'].sort())
  const rows = names.map((name) => {
    const row = manifest.assets.find((one) => one.name === name)
    assert(row, `Mac payload ${name} is not in the manifest`)
    assert.deepEqual(fileSeal(join(folder, name)), {
      bytes: row.bytes,
      sha256: row.sha256,
      sha512: row.sha512,
    })
    return { name, size: row.bytes, sha256: row.sha256, sha512: row.sha512 }
  })
  const receiptPath = join(folder, 'mac-signed-candidate.json')
  const receiptSeal = fileSeal(receiptPath)
  assert.deepEqual(assessment.signingReceipt, {
    bytes: receiptSeal.bytes,
    sha256: receiptSeal.sha256,
  })
  const receipt = candidateReceipt(
    JSON.parse(readFileSync(receiptPath, 'utf8')),
    manifest,
    identity,
  )
  const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(
    byName(receipt.files.map(({ name, size, sha256, sha512 }) => ({ name, size, sha256, sha512 }))),
    byName(rows),
  )

  // Honest limits: a new consolidation of a headless service observation, nothing more.
  assert.equal(assessment.recordKind, 'new-consolidation-of-original-receipts')
  assert.deepEqual(assessment.scope, {
    observation: 'headless-bundled-service',
    notClaimed: ['browser-interaction', 'finder', 'gui', 'linked-accounts', 'soak'],
  })
  assert.deepEqual(assessment.normalInstall, {
    procedure: 'download-and-drag',
    scriptedCopyIsFinderDrag: false,
  })
  assert.equal(assessment.automaticUpdates, 'parked-unscheduled-outside-0.2.13')
  const keychain = assessment.keychain
  if (keychain?.observed === false) {
    fields(keychain, ['observed', 'disposition', 'detail'], 'Keychain limitation')
    assert.equal(keychain.disposition, 'cannot-show')
  } else {
    fields(keychain, ['observed', 'disposition', 'detail'], 'Keychain observation')
    assert.equal(keychain.observed, true)
    assert(text(keychain.disposition) && keychain.disposition !== 'cannot-show')
  }
  assert(text(keychain.detail), 'Keychain detail is required')

  const signing = assessment.signing
  fields(
    signing,
    [
      'runId',
      'runAttempt',
      'jobId',
      'rawOutputs',
      'consolidatedStatus',
      'teamId',
      'authority',
      'results',
    ],
    'Mac signing',
  )
  assert.equal(signing.runId, manifest.runId)
  assert.equal(signing.runAttempt, manifest.runAttempt)
  assert(positive(signing.jobId))
  assert.equal(signing.rawOutputs, 'original-hosted-signing-job')
  assert.equal(signing.consolidatedStatus, 'source-backed-operator-summary')
  assert.equal(signing.teamId, identity.teamId)
  assert.equal(signing.authority, identity.authority)
  assert.deepEqual(signing.results, {
    codesign: 'PASS',
    hardenedRuntime: 'PASS',
    secureTimestamp: 'PASS',
    appNotary: 'Accepted',
    dmgNotary: 'Accepted',
    stapler: 'PASS',
    gatekeeper: 'PASS',
  })

  const oldMac = assessment.oldMac
  fields(oldMac, ['attempt', 'harness', 'service', 'started', 'finished', 'plugins'], 'Old Mac')
  assert.match(oldMac.attempt, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  fields(oldMac.harness, ['source', 'sha256'], 'Old Mac harness')
  assert(OID.test(oldMac.harness.source) && HEX64.test(oldMac.harness.sha256))
  fields(oldMac.service, ['resource', 'sha256'], 'Old Mac service')
  assert.equal(oldMac.service.resource, 'Contents/Resources/plugin-supervisor/entry.cjs')
  assert.match(oldMac.service.sha256, HEX64)
  const started = Date.parse(oldMac.started),
    finished = Date.parse(oldMac.finished)
  assert(Number.isFinite(started) && Number.isFinite(finished) && finished >= started)
  assert.deepEqual(oldMac.plugins.map((one) => one.id).sort(), ['chrome', 'whatsapp'])
  for (const plugin of oldMac.plugins) {
    fields(
      plugin,
      ['id', 'version', 'archiveSha256', 'manifestSha256', 'state', 'tools', 'toolCount'],
      `${plugin.id} plugin`,
    )
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/)
    assert(HEX64.test(plugin.archiveSha256) && HEX64.test(plugin.manifestSha256))
    assert.equal(plugin.state, 'Running')
    assert(Array.isArray(plugin.tools) && plugin.tools.length > 0 && plugin.tools.every(text))
    assert.equal(new Set(plugin.tools).size, plugin.tools.length, `${plugin.id} tools repeat`)
    assert.equal(plugin.toolCount, plugin.tools.length)
  }
  assert.deepEqual(assessment.lifecycle, {
    sameOwner: true,
    exit: { code: 0, signal: null },
    leaseClosed: true,
    timedOut: false,
    signalFallback: false,
    cleanupFailures: [],
    appUnchanged: true,
    dmgUnchanged: true,
    fixtureUnchanged: true,
    imageDetached: true,
  })

  // Each original receipt is retained locally under a distinct role and rehashed by reviewers.
  const roles = [...EVIDENCE_ROLES, ...(keychain.observed ? ['keychain-observation'] : [])]
  assert(Array.isArray(assessment.evidence))
  for (const row of assessment.evidence) {
    fields(row, ['role', 'reference', 'bytes', 'sha256'], 'Evidence')
    assert.match(row.reference, REFERENCE)
    seal({ bytes: row.bytes, sha256: row.sha256 }, `${row.role} evidence`)
  }
  assert.deepEqual(assessment.evidence.map((one) => one.role).sort(), roles.sort())
  return assessment
}
