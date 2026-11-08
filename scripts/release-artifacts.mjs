import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readUpdateFile } from './release-check.mjs'
import { expectedSigningIdentity } from './lib/mac-signing-identity.mjs'

export const PROOF_PUBLICATION = Object.freeze({
  repository: 'brocrew/brocrew',
  version: '0.2.12',
  source: '90c4db564be21eb4fa22b7fba95c5d861ac95b29',
  tree: 'cf373e75a8fb2336fd92799fb003270257bb6c38',
  executionTag: 'v0.2.12-proof-carrier.1',
  candidateTag: 'v0.2.12-candidate.2',
  candidateTagObject: 'a23e5c10edb681806fc8e5cd550231ba2e17c699',
  stableTagObject: 'fd7c19c6c1a2f1eb06948c788d4291c76c71dead',
  runId: 42502289113,
  runAttempt: 1,
  artifactId: 13626690549,
  digest: 'sha256:5a1d37a902ad0ff3f3656288f7cfa1b70b621cd0c4e51590c184c7730be73680',
  manifestSha256: '7340e91f2bcf66e25a03533763d5fedbf7dce8bbf5693e03d589109311489e5b',
  macInstallWitnessSha256: '39ddf8f6048de189438487a9441bd955297cb7d505e9fbda1ea31af8fd8ad8e7',
})

export function releasePlan(ref, event, mode = '') {
  if (ref === `refs/tags/${PROOF_PUBLICATION.executionTag}`) {
    if (event !== 'workflow_dispatch' || !['qualify', 'publish'].includes(mode))
      throw new Error('The reviewed proof carrier only qualifies or publishes existing bytes')
    return {
      version: PROOF_PUBLICATION.version,
      tag: `v${PROOF_PUBLICATION.version}`,
      build: false,
      qualify: mode === 'qualify',
      publish: mode === 'publish',
      targetRef: `refs/tags/${mode === 'qualify' ? PROOF_PUBLICATION.candidateTag : `v${PROOF_PUBLICATION.version}`}`,
      external: true,
    }
  }
  const match = /^refs\/tags\/v(\d+\.\d+\.\d+)(-candidate\.([1-9]\d*))?$/.exec(ref)
  if (!match) throw new Error('A stable version tag or vX.Y.Z-candidate.N tag is required')
  const candidate = Boolean(match[2])
  if (event === 'workflow_dispatch' && !['qualify', 'publish'].includes(mode))
    throw new Error('Choose qualify or publish')
  if (mode === 'qualify' && !candidate) throw new Error('Qualify on the candidate tag')
  if (mode === 'publish' && candidate) throw new Error('Publish only on the stable tag')
  return {
    version: match[1],
    tag: `v${match[1]}`,
    build: event === 'push' && candidate,
    qualify: event === 'workflow_dispatch' && mode === 'qualify',
    publish: event === 'workflow_dispatch' && mode === 'publish',
  }
}

export function assetNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Stable version required')
  return [
    `BroCrew-${version}-arm64.dmg`,
    `BroCrew-${version}-arm64.dmg.blockmap`,
    `BroCrew-${version}-arm64-mac.zip`,
    `BroCrew-${version}-arm64-mac.zip.blockmap`,
    'latest-mac.yml',
    `BroCrew-Setup-${version}-x64.exe`,
    `BroCrew-Setup-${version}-x64.exe.blockmap`,
    'latest.yml',
  ].sort()
}

export function fileSeal(path) {
  if (!lstatSync(path).isFile()) throw new Error('A regular artifact file is required')
  const hashes = [createHash('sha256'), createHash('sha512')]
  const buffer = Buffer.alloc(1024 * 1024)
  const fd = openSync(path, 'r')
  let bytes = 0
  try {
    let count
    while ((count = readSync(fd, buffer)) > 0) {
      bytes += count
      for (const hash of hashes) hash.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(fd)
  }
  return { bytes, sha256: hashes[0].digest('hex'), sha512: hashes[1].digest('base64') }
}

export function verifyAssets(folder, manifest) {
  const expected = assetNames(manifest.version)
  const actual = readdirSync(folder).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('The release must contain exactly eight expected assets')
  if (JSON.stringify(manifest.assets.map((row) => row.name).sort()) !== JSON.stringify(expected))
    throw new Error('The manifest must name each expected asset exactly once')
  for (const row of manifest.assets) {
    const seal = fileSeal(join(folder, row.name))
    if (['bytes', 'sha256', 'sha512'].some((key) => row[key] !== seal[key]))
      throw new Error(`Artifact bytes differ: ${row.name}`)
  }
  for (const [metadata, payloads, top] of [
    [
      'latest-mac.yml',
      [`BroCrew-${manifest.version}-arm64-mac.zip`, `BroCrew-${manifest.version}-arm64.dmg`],
      `BroCrew-${manifest.version}-arm64-mac.zip`,
    ],
    [
      'latest.yml',
      [`BroCrew-Setup-${manifest.version}-x64.exe`],
      `BroCrew-Setup-${manifest.version}-x64.exe`,
    ],
  ]) {
    const said = readUpdateFile(readFileSync(join(folder, metadata), 'utf8'))
    if (
      said.version !== manifest.version ||
      said.path !== top ||
      JSON.stringify(said.files.map((file) => file.url).sort()) !== JSON.stringify(payloads.sort())
    )
      throw new Error(`Unexpected updater references: ${metadata}`)
    for (const file of said.files) {
      const seal = fileSeal(join(folder, file.url))
      if (file.size !== seal.bytes || file.sha512 !== seal.sha512)
        throw new Error(`Updater metadata differs: ${file.url}`)
    }
    if (said.sha512 !== fileSeal(join(folder, top)).sha512)
      throw new Error(`Updater top-level hash differs: ${metadata}`)
  }
  return manifest
}

export function collectCandidate(staging, output, env = process.env) {
  const plan = releasePlan(env.GITHUB_REF, 'push')
  if (!plan.build || env.RELEASE_REPO !== env.GITHUB_REPOSITORY)
    throw new Error('Candidate build in its own repository required')
  const names = assetNames(plan.version)
  for (const platform of ['macos', 'windows']) {
    const folder = join(staging, platform)
    const expected = names.filter((name) =>
      platform === 'windows' ? /Setup-|^latest.yml$/.test(name) : !/Setup-|^latest.yml$/.test(name),
    )
    const retained =
      platform === 'macos' ? [...expected, 'mac-signed-candidate.json'].sort() : expected
    if (JSON.stringify(readdirSync(folder).sort()) !== JSON.stringify(retained))
      throw new Error(`Unexpected ${platform} build files`)
    for (const name of expected) copyFileSync(join(folder, name), join(output, name))
  }
  const manifest = {
    format: 1,
    repository: env.GITHUB_REPOSITORY,
    version: plan.version,
    source: env.GITHUB_SHA,
    tree: env.SOURCE_TREE,
    candidateTag: env.GITHUB_REF.slice('refs/tags/'.length),
    candidateTagObject: env.CANDIDATE_TAG_OBJECT,
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    origins: {
      macos: { artifactId: Number(env.MAC_ARTIFACT_ID), digest: env.MAC_ARTIFACT_DIGEST },
      windows: { artifactId: Number(env.WINDOWS_ARTIFACT_ID), digest: env.WINDOWS_ARTIFACT_DIGEST },
    },
    windowsSigned: env.WINDOWS_SIGNED === 'true',
    macSigned: true,
    assets: names.map((name) => ({ name, ...fileSeal(join(output, name)) })),
  }
  verifyAssets(output, manifest)
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode, input, output] = process.argv
  if (mode === 'plan') {
    const plan = releasePlan(
      process.env.GITHUB_REF,
      process.env.GITHUB_EVENT_NAME,
      process.env.RELEASE_MODE,
    )
    for (const [key, value] of Object.entries(plan)) console.log(`${key}=${value}`)
  } else if (mode === 'collect') {
    const manifest = collectCandidate(input, output)
    const path = join(output, '..', 'build-manifest.json')
    writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
    copyFileSync(join(input, 'macos/mac-signed-candidate.json'), 'mac-signed-candidate.json')
  } else if (mode === 'mac-receipt') {
    const names = assetNames(output).filter((name) => !/Setup-|^latest.yml$/.test(name))
    writeFileSync(
      join(input, 'mac-signed-candidate.json'),
      JSON.stringify(
        {
          format: 'brocrew-mac-signed-candidate-v1',
          source: process.env.GITHUB_SHA,
          tree: process.env.SOURCE_TREE,
          version: output,
          teamId: expectedSigningIdentity().teamId,
          files: names.map((name) => {
            const { bytes, ...seal } = fileSeal(join(input, name))
            return { name, size: bytes, ...seal }
          }),
        },
        null,
        2,
      ) + '\n',
    )
  } else throw new Error('Use plan or collect')
}
