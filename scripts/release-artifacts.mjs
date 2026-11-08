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

export function releasePlan(ref, event, mode = '') {
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
