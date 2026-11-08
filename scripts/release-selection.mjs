import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assetNames,
  fileSeal,
  PROOF_PUBLICATION,
  releasePlan,
  verifyAssets,
} from './release-artifacts.mjs'
import {
  checkedArtifact,
  checkedPublisherTag,
  checkedRun,
  checkedTag,
  github,
  readJson,
} from './lib/release-github.mjs'
import {
  verifyWindowsProof,
  WINDOWS_PROOF_SOURCE,
  WINDOWS_CURRENT_SOURCE,
  WINDOWS_CURRENT_TREE,
  MAC_ARTIFACT_SOURCE,
  MAC_ARTIFACT_TREE,
} from './lib/release-proofs.mjs'
import { verifyMacProof } from './lib/release-mac-proof.mjs'

export const PROOF_WORKFLOWS = {
  'mac-guided-upgrade': 'mac-signed-upgrade.yml',
  'windows-clean': 'upgrade-path.yml',
  'windows-upgrade': 'upgrade-path.yml',
}

export async function verifySelection(selection, client, dest) {
  if (![1, 2].includes(selection.format) || selection.repository !== process.env.GITHUB_REPOSITORY)
    throw new Error('Selection format/repository differs')
  const { source, tree, candidate } = selection
  const execution = client.source(source, tree)
  const external = selection.format === 2
  if (external) {
    if (
      !execution ||
      !isDeepStrictEqual(selection.execution, execution) ||
      source !== PROOF_PUBLICATION.source ||
      tree !== PROOF_PUBLICATION.tree ||
      selection.version !== PROOF_PUBLICATION.version ||
      execution.tag !== PROOF_PUBLICATION.executionTag
    )
      throw new Error('The fixed product and publication execution sources differ')
    for (const key of ['runId', 'runAttempt', 'artifactId', 'digest', 'manifestSha256'])
      if (candidate[key] !== PROOF_PUBLICATION[key])
        throw new Error('The original signed candidate selection differs')
    checkedTag(client, `v${PROOF_PUBLICATION.version}`, source, PROOF_PUBLICATION.stableTagObject)
  } else if (execution)
    throw new Error('External publication requires its explicit selection format')
  const run = checkedRun(client, candidate.runId, candidate.runAttempt, source, 'release.yml')
  const artifact = checkedArtifact(client, candidate, run.id, source)
  if (artifact.name !== `candidate-release-${candidate.runAttempt}` || run.event !== 'push')
    throw new Error('Not a candidate build artifact')
  await client.download(candidate.artifactId, dest, candidate.digest)
  const manifestPath = join(dest, 'build-manifest.json')
  if (fileSeal(manifestPath).sha256 !== candidate.manifestSha256)
    throw new Error('Candidate manifest digest differs')
  if (
    JSON.stringify(readdirSync(dest).sort()) !== JSON.stringify(['assets', 'build-manifest.json'])
  )
    throw new Error('Unexpected candidate bundle entries')
  const manifest = readJson(manifestPath)
  const plan = releasePlan(`refs/tags/${manifest.candidateTag}`, 'push')
  if (
    !plan.build ||
    manifest.repository !== selection.repository ||
    manifest.source !== source ||
    manifest.tree !== tree ||
    manifest.version !== selection.version ||
    plan.version !== selection.version ||
    manifest.runId !== candidate.runId ||
    manifest.runAttempt !== candidate.runAttempt ||
    run.head_branch !== manifest.candidateTag ||
    manifest.macSigned !== true ||
    manifest.windowsSigned !== true
  )
    throw new Error('Candidate version, source, run or signing result differs')
  if (
    external &&
    (manifest.candidateTag !== PROOF_PUBLICATION.candidateTag ||
      manifest.candidateTagObject !== PROOF_PUBLICATION.candidateTagObject)
  )
    throw new Error('The original signed candidate tag differs')
  checkedTag(client, manifest.candidateTag, source, manifest.candidateTagObject)
  if (JSON.stringify(Object.keys(manifest.origins).sort()) !== JSON.stringify(['macos', 'windows']))
    throw new Error('Both platform build origins are required')
  for (const [platform, reference] of Object.entries(manifest.origins)) {
    const origin = checkedArtifact(client, reference, run.id, source)
    if (origin.name !== `release-${platform}`) throw new Error('Unexpected platform build artifact')
  }
  const assets = join(dest, 'assets')
  verifyAssets(assets, manifest)
  for (const path of [manifestPath, ...manifest.assets.map((row) => join(assets, row.name))])
    client.attest(path, source, manifest.candidateTag, run.id, candidate.runAttempt)
  if (external) {
    const witness = selection.macInstallWitness
    if (
      typeof witness?.json !== 'string' ||
      witness.sha256 !== PROOF_PUBLICATION.macInstallWitnessSha256 ||
      createHash('sha256').update(witness.json).digest('hex') !==
        PROOF_PUBLICATION.macInstallWitnessSha256
    )
      throw new Error('The pinned Mac normal-install operator assessment is required')
    const assessment = JSON.parse(witness.json)
    const dmg = manifest.assets.find((row) => row.name === 'BroCrew-0.2.12-arm64.dmg')
    if (
      assessment.format !== 'brocrew.mac-normal-install-operator-witness.v1' ||
      assessment.repository !== manifest.repository ||
      assessment.source !== manifest.source ||
      assessment.tree !== manifest.tree ||
      assessment.version !== manifest.version ||
      assessment.candidateRunId !== manifest.runId ||
      assessment.candidateRunAttempt !== manifest.runAttempt ||
      assessment.macArtifactId !== manifest.origins.macos.artifactId ||
      !isDeepStrictEqual(assessment.dmg, { name: dmg.name, bytes: dmg.bytes, sha256: dmg.sha256 })
    )
      throw new Error('Mac normal-install assessment differs from the original candidate')
  }
  const kinds = Object.keys(PROOF_WORKFLOWS)
    .filter((kind) => !external || kind.startsWith('windows-'))
    .sort()
  if (JSON.stringify(selection.proofs.map((proof) => proof.kind).sort()) !== JSON.stringify(kinds))
    throw new Error('Each required native proof must be selected exactly once')
  for (const proof of selection.proofs) {
    const nativeSource = proof.kind.startsWith('windows-')
      ? external
        ? WINDOWS_CURRENT_SOURCE
        : WINDOWS_PROOF_SOURCE
      : external
        ? MAC_ARTIFACT_SOURCE
        : source
    const nativeRun = checkedRun(
      client,
      proof.runId,
      proof.runAttempt,
      nativeSource,
      PROOF_WORKFLOWS[proof.kind],
    )
    if (nativeRun.event !== 'workflow_dispatch') throw new Error('Native proof must be a dispatch')
    if (external) {
      const commit = client.api(`git/commits/${nativeSource}`)
      const tree = proof.kind.startsWith('windows-') ? WINDOWS_CURRENT_TREE : MAC_ARTIFACT_TREE
      if (commit.sha !== nativeSource || commit.tree?.sha !== tree)
        throw new Error('Native proof carrier tree differs')
    }
    const nativeArtifact = checkedArtifact(client, proof, proof.runId, nativeSource)
    if (
      proof.kind.startsWith('windows-') &&
      (nativeRun.workflow_id !== 387765924 ||
        nativeArtifact.name !== 'windows-installed-plugin-upgrade-evidence')
    )
      throw new Error('Unexpected Windows native proof origin')
    const mac = proof.kind === 'mac-guided-upgrade'
    if (
      mac &&
      (nativeArtifact.name !== 'actual-signed-mac-upgrade-evidence' ||
        (external && nativeRun.workflow_id !== 410964307))
    )
      throw new Error('Unexpected Mac native proof origin')
    const windowsExternal = external && proof.kind.startsWith('windows-')
    const expectedReceipt = mac
      ? 'signed-upgrade-evidence/summary.json'
      : windowsExternal
        ? 'driver/native-receipt.json'
        : 'native-receipt.json'
    if (proof.receiptFile !== expectedReceipt)
      throw new Error('The original native proof receipt is required')
    const folder = join(dest, '..', `proof-${proof.kind}`)
    await client.download(proof.artifactId, folder, proof.digest)
    const proofRoot = windowsExternal ? join(folder, 'driver') : folder
    const path = join(folder, proof.receiptFile)
    if (fileSeal(path).sha256 !== proof.receiptSha256)
      throw new Error('Native proof receipt bytes differ')
    if (proof.kind.startsWith('windows-')) {
      if (external) {
        const captured = Date.parse(
          readJson(join(proofRoot, 'public-catalogue-capture.json')).capturedAt,
        )
        if (!(
          captured >= Date.parse(nativeRun.run_started_at) &&
          captured <= Date.parse(nativeRun.updated_at)
        ))
          throw new Error('Catalogue capture is outside its original native invocation')
      }
      verifyWindowsProof(proofRoot, proof, manifest, external)
      continue
    }
    verifyMacProof(join(folder, 'signed-upgrade-evidence'), proof, manifest, external)
  }
  const clean = selection.proofs.find((proof) => proof.kind === 'windows-clean')
  const upgrade = selection.proofs.find((proof) => proof.kind === 'windows-upgrade')
  const cleanRun = checkedRun(
    client,
    clean.runId,
    clean.runAttempt,
    external ? WINDOWS_CURRENT_SOURCE : WINDOWS_PROOF_SOURCE,
    'upgrade-path.yml',
  )
  const upgradeRun = checkedRun(
    client,
    upgrade.runId,
    upgrade.runAttempt,
    external ? WINDOWS_CURRENT_SOURCE : WINDOWS_PROOF_SOURCE,
    'upgrade-path.yml',
  )
  if (!(Date.parse(upgradeRun.run_started_at) >= Date.parse(cleanRun.updated_at)))
    throw new Error('Windows upgrade must start only after the clean proof passed')
  if (
    typeof selection.notes !== 'string' ||
    !selection.notes.trim() ||
    !selection.notes.includes('Mac releases are signed and notarized') ||
    createHash('sha256').update(selection.notes).digest('hex') !== selection.notesSha256
  )
    throw new Error('Pinned release notes are required')
  if (external) {
    checkedPublisherTag(client, execution.source, execution.tagObject)
    checkedTag(client, `v${PROOF_PUBLICATION.version}`, source, PROOF_PUBLICATION.stableTagObject)
  }
  return { manifest, assets }
}

export async function publishSelection(selection, client, dest, ref, selectionHash) {
  const plan = releasePlan(ref, 'workflow_dispatch', 'publish')
  const target = plan.targetRef ?? ref
  if (Boolean(plan.external) !== (selection.format === 2))
    throw new Error('External selection cannot change publication routes')
  if (plan.version !== selection.version)
    throw new Error('Stable tag version differs from tested version')
  if (target !== `refs/tags/${plan.tag}`) throw new Error('Stable publication target differs')
  const tagObject = checkedTag(
    client,
    plan.tag,
    selection.source,
    plan.external ? PROOF_PUBLICATION.stableTagObject : null,
  )
  const { manifest, assets } = await verifySelection(selection, client, dest)
  const repo = selection.repository
  const marker = `<!-- tested-selection-sha256:${selectionHash} -->`
  const notesPath = join(dest, '..', 'release-notes.md')
  writeFileSync(notesPath, `${selection.notes}\n\n${marker}\n`)
  let existing = client.api(`releases/tags/${plan.tag}`)
  if (
    existing !== null &&
    (existing.body !== `${selection.notes}\n\n${marker}\n` ||
      existing.tag_name !== plan.tag ||
      existing.prerelease)
  )
    throw new Error('Existing release is not bound to this tested selection')
  if (existing === null) {
    client.run([
      'release',
      'create',
      plan.tag,
      '--repo',
      repo,
      '--verify-tag',
      '--draft',
      '--title',
      `BroCrew ${selection.version}`,
      '--notes-file',
      notesPath,
    ])
    existing = client.api(`releases/tags/${plan.tag}`)
  }
  const expected = assetNames(selection.version)
  if (existing.assets.some((asset) => !expected.includes(asset.name)))
    throw new Error('Unexpected existing release assets')
  const readback = async (release, folder) => {
    mkdirSync(folder, { recursive: true })
    for (const asset of release.assets) {
      const row = manifest.assets.find((entry) => entry.name === asset.name)
      if (!row || asset.size !== row.bytes || asset.digest !== `sha256:${row.sha256}`)
        throw new Error('Remote asset metadata differs')
      client.run([
        'release',
        'download',
        plan.tag,
        '--repo',
        repo,
        '--pattern',
        asset.name,
        '--dir',
        folder,
      ])
      const seal = fileSeal(join(folder, asset.name))
      if (seal.sha256 !== row.sha256 || seal.bytes !== row.bytes)
        throw new Error('Uploaded release bytes differ')
      client.attest(
        join(folder, asset.name),
        selection.source,
        manifest.candidateTag,
        manifest.runId,
        manifest.runAttempt,
      )
    }
  }
  await readback(existing, join(dest, '..', 'existing-assets'))
  const missing = expected.filter((name) => !existing.assets.some((asset) => asset.name === name))
  if (!existing.draft && missing.length) throw new Error('Published release has missing assets')
  if (missing.length)
    client.run([
      'release',
      'upload',
      plan.tag,
      ...missing.map((name) => join(assets, name)),
      '--repo',
      repo,
    ])
  const draft = client.api(`releases/tags/${plan.tag}`)
  if (JSON.stringify(draft.assets.map((asset) => asset.name).sort()) !== JSON.stringify(expected))
    throw new Error('Remote release must contain exactly eight assets')
  await readback(draft, join(dest, '..', 'draft-readback'))
  verifyAssets(join(dest, '..', 'draft-readback'), manifest)
  checkedTag(client, plan.tag, selection.source, tagObject)
  if (selection.format === 2)
    checkedPublisherTag(client, selection.execution.source, selection.execution.tagObject)
  if (draft.draft)
    client.run(['release', 'edit', plan.tag, '--repo', repo, '--draft=false', '--latest'])
  const published = client.api(`releases/tags/${plan.tag}`)
  if (published.draft || published.prerelease)
    throw new Error('Stable publication did not complete')
  await readback(published, join(dest, '..', 'public-readback'))
  verifyAssets(join(dest, '..', 'public-readback'), manifest)
  checkedTag(client, plan.tag, selection.source, tagObject)
  if (selection.format === 2)
    checkedPublisherTag(client, selection.execution.source, selection.execution.tagObject)
  return {
    releaseId: published.id,
    tagObject,
    selectionHash,
    assets: manifest.assets,
    publicReadback: true,
  }
}

async function main() {
  const [, , mode, dir] = process.argv
  const dest = resolve(dir)
  const client = github(
    process.env.GITHUB_REPOSITORY,
    resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  )
  mkdirSync(dest, { recursive: true })
  if (mode === 'qualify') {
    const plan = releasePlan(process.env.GITHUB_REF, 'workflow_dispatch', 'qualify')
    const selection = JSON.parse(process.env.TESTED_SELECTION_JSON)
    const { manifest } = await verifySelection(selection, client, join(dest, 'candidate'))
    if (`refs/tags/${manifest.candidateTag}` !== (plan.targetRef ?? process.env.GITHUB_REF))
      throw new Error('Selection ref differs from candidate ref')
    writeFileSync(join(dest, 'tested-selection.json'), JSON.stringify(selection, null, 2) + '\n')
    console.log(`Tested selection SHA256: ${fileSeal(join(dest, 'tested-selection.json')).sha256}`)
  } else if (mode === 'publish') {
    const id = Number(process.env.TESTED_SELECTION_ARTIFACT_ID)
    const meta = client.api(`actions/artifacts/${id}`)
    const run = checkedRun(
      client,
      meta.workflow_run.id,
      Number(meta.name?.match(/^tested-selection-(\d+)$/)?.[1]),
      process.env.GITHUB_SHA,
      'release.yml',
    )
    checkedArtifact(client, { artifactId: id, digest: meta.digest }, run.id, process.env.GITHUB_SHA)
    if (
      meta.expired ||
      run.event !== 'workflow_dispatch' ||
      (process.env.GITHUB_REF === `refs/tags/${PROOF_PUBLICATION.executionTag}` &&
        run.workflow_id !== 387765921) ||
      !(process.env.GITHUB_REF === `refs/tags/${PROOF_PUBLICATION.executionTag}`
        ? run.head_branch === PROOF_PUBLICATION.executionTag
        : /^v\d+\.\d+\.\d+-candidate\.[1-9]\d*$/.test(run.head_branch))
    )
      throw new Error('Tested selection must come from a successful candidate qualification')
    await client.download(id, join(dest, 'selection'), meta.digest)
    if (
      JSON.stringify(readdirSync(join(dest, 'selection'))) !==
      JSON.stringify(['tested-selection.json'])
    )
      throw new Error('Unexpected selection artifact files')
    const path = join(dest, 'selection/tested-selection.json')
    const digest = fileSeal(path).sha256
    if (
      !/^[0-9a-f]{64}$/.test(process.env.TESTED_SELECTION_SHA256) ||
      digest !== process.env.TESTED_SELECTION_SHA256
    )
      throw new Error('Tested selection digest differs')
    const selection = readJson(path)
    if (process.env.GITHUB_REF === `refs/tags/${PROOF_PUBLICATION.executionTag}`) {
      if (selection.format !== 2 || selection.execution?.source !== process.env.GITHUB_SHA)
        throw new Error('Qualification and publisher execution sources differ')
    }
    const result = await publishSelection(
      selection,
      client,
      join(dest, 'candidate'),
      process.env.GITHUB_REF,
      digest,
    )
    writeFileSync(join(dest, 'publication-readback.json'), JSON.stringify(result, null, 2) + '\n')
  } else throw new Error('Use qualify or publish')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
