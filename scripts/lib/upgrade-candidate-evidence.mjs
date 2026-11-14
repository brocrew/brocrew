import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { readUpdateFile } from '../release-check.mjs'
import { lineageFits, requireEvidence, sha256, verifyCheckpoint } from './upgrade-path.mjs'

export function firstCopyPolicy(applied, built, copies, { workspaceId, stateFiles }) {
  const legacy = built.filter(({ createdAt }) => createdAt <= 1794254514029)
  const rollbackLineage = lineageFits(applied, legacy) ? legacy : built.slice(0, applied.length)
  const fallbacks = []
  for (const { folder, manifest, files, unfinished } of copies) {
    if (
      !manifest ||
      unfinished ||
      manifest.workspaceId !== workspaceId ||
      !Array.isArray(manifest.database?.migrations) ||
      !lineageFits(manifest.database.migrations, rollbackLineage) ||
      !manifest.files?.every(({ name }) => stateFiles.includes(name))
    )
      continue
    verifyCheckpoint(manifest, files, {
      folder,
      workspaceId,
      reason: manifest.reason,
      version: manifest.madeBy?.appVersion,
      build: manifest.madeBy?.build,
      lineage: manifest.database.migrations,
      stateFiles: manifest.files.map(({ name }) => name),
      state: files,
    })
    fallbacks.push(manifest.id)
  }
  return {
    rollbackLineage,
    fallbacks,
    completion: built.length > applied.length ? 'before-ready' : 'not-needed',
  }
}

export function releaseAssetInventory(directory, version, os, record = () => {}) {
  const files = readdirSync(directory)
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(directory, name))
      return {
        name,
        bytes: bytes.length,
        sha256: sha256(bytes),
        sha512: createHash('sha512').update(bytes).digest('base64'),
      }
    })
  record(files)
  const feedName = os === 'windows' ? 'latest.yml' : 'latest-mac.yml'
  const feed = readUpdateFile(readFileSync(join(directory, feedName), 'utf8'))
  requireEvidence(feed.version === version, 'The reused feed must name the candidate version.')
  requireEvidence(
    feed.files.length === (os === 'windows' ? 1 : 2),
    'The reused feed must name every installer.',
  )
  const expected = [feedName]
  for (const entry of feed.files) {
    const file = files.find(({ name }) => name === entry.url)
    requireEvidence(
      file?.bytes === entry.size && file?.sha512 === entry.sha512,
      `The reused ${entry.url} must match its feed size and SHA512.`,
    )
    expected.push(entry.url, `${entry.url}.blockmap`)
  }
  requireEvidence(
    isDeepStrictEqual(
      files.map(({ name }) => name),
      expected.sort(),
    ),
    'The reused artifact must contain exactly its feed, installers and blockmaps.',
  )
  requireEvidence(
    files.find(({ name }) => name === feed.path)?.sha512 === feed.sha512,
    'The reused feed path and SHA512 must match its installer.',
  )
  return files
}
