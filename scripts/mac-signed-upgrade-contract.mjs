// 695-visible: these checks read the visible journey's results; this module never launches it.
import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { requireEvidence, STATE_FILES } from './lib/mac-update-test.mjs'

export function candidateNames(version) {
  return [
    `BroCrew-${version}-arm64.dmg`,
    `BroCrew-${version}-arm64.dmg.blockmap`,
    `BroCrew-${version}-arm64-mac.zip`,
    `BroCrew-${version}-arm64-mac.zip.blockmap`,
    'latest-mac.yml',
  ]
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
  for (const name of [...STATE_FILES, 'brobot2.sqlite', 'api-keys.json']) {
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

export function credentialPreserved(before, after, status) {
  requireEvidence(typeof before === 'string', 'Fictional plain-file credential baseline is missing.')
  const file = JSON.parse(before)
  const setAt = file?.keys?.codex?.setAt
  requireEvidence(
    file.version === 1 &&
      Number.isSafeInteger(setAt) &&
      setAt > 0 &&
      isDeepStrictEqual(file.keys, {
        codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt },
      }) &&
      file.cantRead === undefined,
    'Fictional plain-file credential baseline is invalid.',
  )
  requireEvidence(before === after, 'Fictional plain-file credential bytes changed during update.')
  if (arguments.length === 3)
    requireEvidence(
      status?.provider === 'codex' &&
        status.set === true &&
        status.inUse === true &&
        status.setAt === setAt &&
        status.readState !== 'unreadable' &&
        status.refusedForBilling === undefined,
      'The preserved fictional credential is not usable through the app API.',
    )
  return { store: 'api-keys.json', setAt, unchanged: true }
}

export function legacyCredentialsPreserved(before, after) {
  requireEvidence(
    Array.isArray(before) && Array.isArray(after) && isDeepStrictEqual(before, after),
    'Legacy credential rows changed during update.',
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
