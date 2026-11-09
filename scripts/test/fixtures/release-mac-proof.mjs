import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASELINE, candidateNames } from '../../mac-signed-upgrade-contract.mjs'
import { fileSeal } from '../../release-artifacts.mjs'
import { FICTIONAL_IDENTITY } from './mac-signing-identity.mjs'

// Deliberately fictional evidence for validator controls; never a native qualification.
export function macProofFixture(folder, manifest, reference) {
  const save = (name, value) => writeFileSync(join(folder, name), JSON.stringify(value))
  mkdirSync(folder, { recursive: true })
  const files = manifest.assets
    .filter(
      (row) =>
        !row.name.endsWith('.exe') &&
        !row.name.endsWith('.exe.blockmap') &&
        row.name !== 'latest.yml',
    )
    .map(({ name, bytes, sha256, sha512 }) => ({ name, size: bytes, sha256, sha512 }))
  const input = {
    runId: manifest.runId,
    artifactId: manifest.origins.macos.artifactId,
    artifactSha256: manifest.origins.macos.digest.slice(7),
    source: manifest.source,
    tree: manifest.tree,
    version: manifest.version,
    releaseId: 101,
  }
  const bundle = {
    version: manifest.version,
    signature: `Authority=${FICTIONAL_IDENTITY.authority}\nTeamIdentifier=${FICTIONAL_IDENTITY.teamId}\nflags=0x10000(runtime)\nTimestamp=fictional`,
    asarSha256: 'a'.repeat(64),
    executableSha256: 'b'.repeat(64),
  }
  const workspaces = ['Default', 'WorkspaceA', 'WorkspaceB'].map((name, i) => ({
    name,
    path: `/fictional/${name}`,
    isDefault: i === 0,
    verified: true,
    credential: { provider: 'codex', set: true, inUse: true, readState: null },
    first: {
      path: `/fictional/${name}`,
      version: manifest.version,
      recovery: { databaseSha256: 'c'.repeat(64) },
      data: {
        provider_session: { before: 2, after: 2, preserved: 2 },
        events: { before: 1, after: 1, preserved: 1 },
      },
    },
    second: {
      path: `/fictional/${name}`,
      version: manifest.version,
      resumedConversation: `fictional-${i}`,
      responseId: `response-${i}`,
    },
    shutdowns: [],
  }))
  const summary = {
    format: 'brocrew-mac-upgrade-proof-v1',
    runId: String(reference.runId),
    runAttempt: String(reference.runAttempt),
    harnessSource: manifest.source,
    source: manifest.source,
    baseline: BASELINE,
    candidate: {
      format: 'brocrew-mac-signed-candidate-v1',
      ...input,
      teamId: FICTIONAL_IDENTITY.teamId,
      files,
    },
    to: { ...input, files },
    mode: 'guided',
    transport: 'controlled-draft-github',
    publicFeedAvailability: 'not proved',
    success: true,
    sameCode: false,
    scriptedCopyIsFinderDrag: false,
    download: {
      sha256: files.find((row) => row.name.endsWith('.dmg')).sha256,
      finder: 'fictional',
      guided: 'Quit all workspaces',
      bundle,
    },
    installedCandidate: bundle,
    quarantineAppliedByFixture: { image: true, installedApp: true },
    controlledTransport: { failures: [], requests: ['fictional request'] },
    replacementCount: 1,
    workspaceCount: 3,
    workspaces,
    launches: [],
    cleanup: {
      appRemoved: true,
      fictionalWorkspaceDataRetained: workspaces.map((one) => one.path),
    },
  }
  for (const [phase, version, source] of [
    ['concurrentBaseline', BASELINE.version, BASELINE.source],
    ['concurrentBeforeNormalQuit', BASELINE.version, BASELINE.source],
    ['concurrentSignedFirst', manifest.version, manifest.source],
    ['concurrentSignedSecond', manifest.version, manifest.source],
  ])
    summary[phase] = workspaces.map((one, i) => ({
      name: one.name,
      path: one.path,
      pid: 10 + i,
      command: '/Applications/BroCrew.app/Contents/MacOS/BroCrew --fictional',
      version,
      source,
      dirty: false,
    }))
  for (const [i, workspace] of workspaces.entries()) {
    mkdirSync(join(folder, workspace.name))
    const database = {
      provider_session: [{ id: 'a' }, { id: 'b' }],
      events: [{ id: 'e' }],
      migrations: [],
      provider_api_key: [{ provider: 'codex', sealed: 'fictional-ciphertext' }],
    }
    save(`${workspace.name}/a-settled-baseline.json`, { database })
    save(`${workspace.name}/b-first-data.json`, database)
    for (const [j, stage] of [
      'baseline-before-single-replacement',
      'candidate-first-reopening',
      'candidate-second-reopening',
    ].entries()) {
      const pid = 100 + i * 10 + j,
        log = `stage-${j}.log`
      workspace.shutdowns.push({ stage, pid, signal: 'SIGTERM', normalLifetimeDrain: true })
      summary.launches.push({
        workspace: workspace.name,
        pid,
        log,
        stage: ['a-settled', 'b-first', 'b-second'][j],
      })
      writeFileSync(
        join(folder, workspace.name, log),
        'close its sessions\nkeep its unsent drafts\ndrain its archive work\nclose its database\nBroCrew shut down in 40ms\n',
      )
    }
  }
  save('summary.json', summary)
  save('input-receipt.json', {
    mode: 'guided',
    transport: summary.transport,
    baseline: summary.baseline,
    candidate: summary.candidate,
  })
  return summary
}

// The original release-macos artifact: five signed Mac files and their candidate receipt.
export function macOriginalArtifactFixture(folder, manifest, assets) {
  mkdirSync(folder, { recursive: true })
  const files = candidateNames(manifest.version).map((name) => {
    copyFileSync(join(assets, name), join(folder, name))
    const row = manifest.assets.find((one) => one.name === name)
    return { name, size: row.bytes, sha256: row.sha256, sha512: row.sha512 }
  })
  const receipt = {
    format: 'brocrew-mac-signed-candidate-v1',
    source: manifest.source,
    tree: manifest.tree,
    version: manifest.version,
    teamId: FICTIONAL_IDENTITY.teamId,
    files,
  }
  writeFileSync(join(folder, 'mac-signed-candidate.json'), JSON.stringify(receipt))
  const { bytes, sha256 } = fileSeal(join(folder, 'mac-signed-candidate.json'))
  return { bytes, sha256 }
}

// A deliberately fictional reviewed normal-install assessment; never a native observation.
export function macNormalAssessment(manifest, signingReceipt) {
  const dmg = manifest.assets.find((row) => row.name === `BroCrew-${manifest.version}-arm64.dmg`)
  const evidence = (role, i) => ({
    role,
    reference: `fictional/${role}.json`,
    bytes: 100 + i,
    sha256: String(i + 1).repeat(64),
  })
  return {
    format: 'brocrew.mac-normal-install-operator-witness.v1',
    repository: manifest.repository,
    source: manifest.source,
    tree: manifest.tree,
    version: manifest.version,
    candidate: {
      runId: manifest.runId,
      runAttempt: manifest.runAttempt,
      macArtifactId: manifest.origins.macos.artifactId,
      macArtifactDigest: manifest.origins.macos.digest,
    },
    dmg: { name: dmg.name, bytes: dmg.bytes, sha256: dmg.sha256 },
    signingReceipt,
    recordKind: 'new-consolidation-of-original-receipts',
    scope: {
      observation: 'headless-bundled-service',
      notClaimed: ['browser-interaction', 'finder', 'gui', 'linked-accounts', 'soak'],
    },
    normalInstall: { procedure: 'download-and-drag', scriptedCopyIsFinderDrag: false },
    automaticUpdates: 'parked-unscheduled-outside-0.2.13',
    keychain: {
      observed: false,
      disposition: 'cannot-show',
      detail: 'A headless service observation cannot show a Keychain prompt or saved-key reuse.',
    },
    signing: {
      runId: manifest.runId,
      runAttempt: manifest.runAttempt,
      jobId: 700,
      rawOutputs: 'original-hosted-signing-job',
      consolidatedStatus: 'source-backed-operator-summary',
      teamId: FICTIONAL_IDENTITY.teamId,
      authority: FICTIONAL_IDENTITY.authority,
      results: {
        codesign: 'PASS',
        hardenedRuntime: 'PASS',
        secureTimestamp: 'PASS',
        appNotary: 'Accepted',
        dmgNotary: 'Accepted',
        stapler: 'PASS',
        gatekeeper: 'PASS',
      },
    },
    oldMac: {
      attempt: 'fictional-normal-dmg-1',
      harness: { source: '9'.repeat(40), sha256: '8'.repeat(64) },
      service: {
        resource: 'Contents/Resources/plugin-supervisor/entry.cjs',
        sha256: '7'.repeat(64),
      },
      started: '2026-11-08T02:00:00Z',
      finished: '2026-11-08T02:05:00Z',
      plugins: [
        {
          id: 'chrome',
          version: '0.1.11',
          archiveSha256: '3'.repeat(64),
          manifestSha256: '5'.repeat(64),
          state: 'Running',
          tools: ['list_browser_profiles', 'open_tab'],
          toolCount: 2,
        },
        {
          id: 'whatsapp',
          version: '0.1.5',
          archiveSha256: '4'.repeat(64),
          manifestSha256: '6'.repeat(64),
          state: 'Running',
          tools: ['list_chats'],
          toolCount: 1,
        },
      ],
    },
    lifecycle: {
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
    },
    evidence: [
      'signing-build-identity',
      'service-plugins-tools',
      'exit-lease-process-cleanup',
      'unchanged-bytes-detach',
    ].map(evidence),
  }
}

// The exact UTF-8 text carried in the selection, with its self-hash.
export function macWitness(assessment) {
  const json = JSON.stringify(assessment, null, 2) + '\n'
  return { json, sha256: createHash('sha256').update(json, 'utf8').digest('hex') }
}
