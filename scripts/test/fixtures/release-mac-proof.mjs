import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASELINE } from '../../mac-signed-upgrade-contract.mjs'
import * as releaseProofs from '../../lib/release-proofs.mjs'
const MAC_ARTIFACT_SOURCE =
  releaseProofs.MAC_ARTIFACT_SOURCE ?? '993be94ba9b8431a07c32672fce09762e4e922d0'
import { FICTIONAL_IDENTITY } from './mac-signing-identity.mjs'

// Deliberately fictional evidence for validator controls; never a native qualification.
export function macProofFixture(folder, manifest, reference, external = false) {
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
  if (external) {
    delete input.releaseId
    input.runAttempt = manifest.runAttempt
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
    harnessSource: external ? MAC_ARTIFACT_SOURCE : manifest.source,
    source: manifest.source,
    baseline: BASELINE,
    candidate: {
      format: 'brocrew-mac-signed-candidate-v1',
      ...input,
      ...(external ? { input: { ...input } } : {}),
      teamId: FICTIONAL_IDENTITY.teamId,
      files,
    },
    to: { ...input, files },
    mode: 'guided',
    transport: external ? 'controlled-original-artifact' : 'controlled-draft-github',
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
    controlledTransport: {
      failures: [],
      requests: external
        ? files
            .filter((one) => one.name.endsWith('.dmg'))
            .map((one) => ({
              version: manifest.version,
              kind: 'asset',
              name: one.name,
              bytes: one.size,
              sha256: one.sha256,
              sha512: one.sha512,
              completed: true,
              upstream: 'sealed original Release artifact',
            }))
        : ['fictional request'],
    },
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
