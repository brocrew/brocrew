import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  expectedSigningIdentity,
  requireDistributionSignature,
} from './lib/mac-signing-identity.mjs'
import {
  diskImageFrom,
  requireEvidence,
  verifyCheckpoint,
  STATE_FILES,
} from './lib/mac-update-test.mjs'

export const BASELINE = Object.freeze({
  version: '0.2.11',
  source: 'cfe64af3add0e9104cd5f4f940c23c9a758ca4b0',
  tree: '898d38281013a5a33f205b47cea753fb147c7a87',
  name: 'BroCrew-0.2.11-arm64.dmg',
  size: 354070741,
  sha256: '200220906296555bb8b09e3ce199600081a401295db2f102c9b21b69471ee7b1',
})
const oid = /^[a-f0-9]{40}$/
const sha256 = /^[a-f0-9]{64}$/

export function candidateNames(version) {
  return [
    `BroCrew-${version}-arm64.dmg`,
    `BroCrew-${version}-arm64.dmg.blockmap`,
    `BroCrew-${version}-arm64-mac.zip`,
    `BroCrew-${version}-arm64-mac.zip.blockmap`,
    'latest-mac.yml',
  ]
}

export function artifactMembers(text, version) {
  const members = text.trim().split('\n')
  const expected = [...candidateNames(version), 'mac-signed-candidate.json'].sort()
  requireEvidence(
    isDeepStrictEqual(members.sort(), expected),
    'Candidate artifact inventory differs from the five final assets and receipt.',
  )
}

export function candidateReceipt(receipt, expected, identity = expectedSigningIdentity()) {
  requireEvidence(
    receipt?.format === 'brocrew-mac-signed-candidate-v1',
    'Wrong candidate receipt format.',
  )
  for (const key of ['source', 'tree'])
    requireEvidence(
      oid.test(receipt[key]) && receipt[key] === expected[key],
      `Candidate ${key} differs.`,
    )
  requireEvidence(
    /^\d+\.\d+\.\d+$/.test(receipt.version) &&
      receipt.version === expected.version &&
      receipt.version !== BASELINE.version,
    'Candidate version differs.',
  )
  requireEvidence(receipt.teamId === identity.teamId, 'Candidate signing team differs.')
  const names = candidateNames(receipt.version)
  requireEvidence(Array.isArray(receipt.files), 'Candidate file seals are missing.')
  requireEvidence(
    receipt.files.length === names.length,
    'Candidate must seal exactly five Mac assets.',
  )
  requireEvidence(
    new Set(receipt.files.map((file) => file.name)).size === receipt.files.length,
    'Duplicate candidate file seal.',
  )
  for (const name of names) {
    const file = receipt.files.find((one) => one.name === name)
    requireEvidence(
      file && Number.isSafeInteger(file.size) && file.size > 0 && sha256.test(file.sha256),
      `Candidate seal missing: ${name}.`,
    )
    requireEvidence(
      typeof file.sha512 === 'string' &&
        Buffer.from(file.sha512, 'base64').length === 64 &&
        Buffer.from(file.sha512, 'base64').toString('base64') === file.sha512,
      `Candidate SHA-512 missing: ${name}.`,
    )
  }
  for (const file of receipt.files)
    requireEvidence(
      file.name === basename(file.name) && !/[\\?#]/.test(file.name),
      'Unsafe candidate filename.',
    )
  return receipt
}

export function artifactBinding(run, artifact, expected) {
  requireEvidence(
    run.id === expected.runId &&
      run.head_sha === expected.source &&
      run.status === 'completed' &&
      run.conclusion === 'success',
    'Candidate build run is not successful at the pinned source.',
  )
  requireEvidence(
    run.repository?.full_name === 'brocrew/brocrew',
    'Candidate build repository differs.',
  )
  requireEvidence(
    artifact.id === expected.artifactId &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === expected.source &&
      !artifact.expired,
    'Candidate artifact provenance differs.',
  )
  requireEvidence(
    artifact.digest === `sha256:${expected.artifactSha256}` && sha256.test(expected.artifactSha256),
    'Candidate artifact digest differs.',
  )
}

export async function digestFile(path, algorithm = 'sha256', encoding = 'hex') {
  const sum = createHash(algorithm)
  for await (const chunk of createReadStream(path)) sum.update(chunk)
  return sum.digest(encoding)
}

export async function sealedFile(path, seal) {
  const stat = lstatSync(path)
  requireEvidence(
    stat.isFile() && !stat.isSymbolicLink() && stat.size === seal.size,
    `File size/type differs: ${basename(path)}.`,
  )
  requireEvidence(
    (await digestFile(path)) === seal.sha256,
    `File SHA-256 differs: ${basename(path)}.`,
  )
  if (seal.sha512)
    requireEvidence(
      (await digestFile(path, 'sha512', 'base64')) === seal.sha512,
      `File SHA-512 differs: ${basename(path)}.`,
    )
}

export function candidateImage(text, receipt) {
  const image = diskImageFrom(text, receipt.version)
  const seal = receipt.files.find((file) => file.name === image.url)
  requireEvidence(
    seal && image.sha512 === seal.sha512 && image.size === seal.size,
    'Candidate manifest differs from sealed DMG.',
  )
  return image
}

export function publicFeedUnchanged(text) {
  const fields = Object.fromEntries(
    text
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const at = line.indexOf(':')
        return [line.slice(0, at), line.slice(at + 1).trim()]
      }),
  )
  requireEvidence(
    fields.owner === 'brocrew' &&
      fields.repo === 'brocrew' &&
      fields.provider === 'github' &&
      fields.private === undefined &&
      fields.url === undefined,
    'The app does not retain its public GitHub feed.',
  )
}

export function signedIdentity(output, identity = expectedSigningIdentity()) {
  requireDistributionSignature(output, { identity })
}

// The old same-code verifier fixes the B version at 0.0.99. Validate the real identity first,
// then reuse its complete manifest/byte inventory check with only that fixed field adapted.
export function signedCheckpoint(manifest, files, expected) {
  requireEvidence(
    manifest.madeBy?.appVersion === expected.version && manifest.madeBy?.build === expected.source,
    'Recovery copy candidate identity differs.',
  )
  return verifyCheckpoint(
    { ...manifest, madeBy: { ...manifest.madeBy, appVersion: '0.0.99' } },
    files,
    expected,
  )
}

function permissionInventory(folder) {
  const entries = []
  function walk(path, relative) {
    const stat = lstatSync(path)
    requireEvidence(
      !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()),
      'Fixture permission inventory contains a link or special file.',
    )
    entries.push({ path: relative, directory: stat.isDirectory(), mode: stat.mode & 0o777 })
    if (stat.isDirectory())
      for (const name of readdirSync(path).sort())
        walk(join(path, name), relative ? `${relative}/${name}` : name)
  }
  walk(folder, '')
  return entries
}

export function permissionsKept(before, after) {
  const current = new Map(after.map((entry) => [entry.path, entry]))
  for (const entry of before)
    requireEvidence(
      isDeepStrictEqual(current.get(entry.path), entry),
      `Fixture permissions changed: ${entry.path}.`,
    )
}

export function fixturePermissions(folder, nativeNames = []) {
  const result = [{ path: '', directory: true, mode: lstatSync(folder).mode & 0o777 }]
  const existing = new Set(readdirSync(folder))
  for (const name of [...STATE_FILES, 'brobot2.sqlite']) {
    if (!existing.has(name)) continue
    for (const entry of permissionInventory(join(folder, name)))
      result.push({ ...entry, path: entry.path ? `${name}/${entry.path}` : name })
  }
  for (const name of nativeNames) {
    const stat = lstatSync(join(folder, name))
    requireEvidence(stat.isFile() && !stat.isSymbolicLink(), 'A native transcript is not a file.')
    result.push({ path: name, directory: false, mode: stat.mode & 0o777 })
  }
  return result
}

export function upgradeRequest(request) {
  requireEvidence(
    request?.mode === 'guided' && request.from === undefined,
    'Only the three-workspace guided upgrade is supported.',
  )
  const builds = [request.to]
  for (const build of builds) {
    requireEvidence(
      build &&
        oid.test(build.source) &&
        oid.test(build.tree) &&
        /^\d+\.\d+\.\d+$/.test(build.version),
      'Upgrade build identity is incomplete.',
    )
    requireEvidence(sha256.test(build.artifactSha256), 'Upgrade artifact SHA-256 is missing.')
    for (const key of ['runId', 'artifactId', 'releaseId'])
      requireEvidence(
        Number.isSafeInteger(build[key]) && build[key] > 0,
        `Upgrade ${key} is missing.`,
      )
  }
  const from = BASELINE.version
  requireEvidence(newerVersion(request.to.version, from), 'Upgrade target must be strictly newer.')
  return request
}
function newerVersion(target, current) {
  const next = target.split('.').map(Number),
    before = current.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (next[index] !== before[index]) return next[index] > before[index]
  }
  return false
}

export function credentialPreserved(before, after) {
  requireEvidence(
    Array.isArray(before) &&
      before.some(
        (row) =>
          row.provider === 'codex' && typeof row.sealed === 'string' && row.sealed.length > 0,
      ),
    'Fictional encrypted credential baseline is missing.',
  )
  requireEvidence(
    isDeepStrictEqual(before, after),
    'Fictional encrypted credential bytes changed during update.',
  )
}

export function registriesKept(before, after, workspacePaths) {
  const normalize = (book) => {
    requireEvidence(
      book?.version === 1 && Array.isArray(book.workspaces),
      'Invalid packaged workspace registry.',
    )
    requireEvidence(
      new Set(book.workspaces.map((row) => row.path)).size === book.workspaces.length,
      'Duplicate packaged workspace registry row.',
    )
    for (const path of workspacePaths)
      requireEvidence(
        book.workspaces.some((row) => row.path === path),
        'A required workspace is missing from the registry.',
      )
    return {
      ...book,
      workspaces: book.workspaces
        .map((row) => {
          if (!workspacePaths.includes(row.path)) return row
          requireEvidence(
            Number.isFinite(row.lastOpenedAt),
            'Workspace last-opened timestamp is invalid.',
          )
          return { ...row, lastOpenedAt: 0 }
        })
        .sort((left, right) => left.path.localeCompare(right.path)),
    }
  }
  requireEvidence(
    isDeepStrictEqual(normalize(before), normalize(after)),
    'Packaged workspace registry changed beyond the three reopened timestamps.',
  )
}

export function assertThreeWorkspaceStates(records, expected, app, version, source) {
  requireEvidence(
    records.length === 3 &&
      new Set(records.map((one) => one.pid)).size === 3 &&
      new Set(records.map((one) => one.path)).size === 3,
    'Three distinct concurrent workspace processes and paths are required.',
  )
  for (const workspace of expected) {
    const record = records.find((one) => one.name === workspace.name)
    requireEvidence(
      record &&
        record.path === workspace.data &&
        record.version === version &&
        record.source === source &&
        record.dirty === false &&
        record.command.startsWith(`${app}/Contents/MacOS/BroCrew `),
      'A concurrent workspace has a different app, version, source, clean build stamp or path.',
    )
  }
}
