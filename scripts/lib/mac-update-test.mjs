import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { readUpdateFile } from '../release-check.mjs'
import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  READY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'
import { SANDBOX_FEED, STATE_FILES, VERSION_A, VERSION_B } from './update-rehearsal.mjs'
import { rehearsalStateKept } from './update-rehearsal-state.mjs'

export const FEED_URL = 'http://127.0.0.1:47123/'
export { STATE_FILES, VERSION_A, VERSION_B }
export { CHECKPOINT_LINE, FAIL_LINE, READY_LINE }

export function requireEvidence(condition, message) {
  if (!condition) throw new Error(message)
}

export function assertHostedMac(env, platform, arch) {
  requireEvidence(
    env.GITHUB_ACTIONS === 'true' &&
      env.RUNNER_ENVIRONMENT === 'github-hosted' &&
      ['brocrew/brocrew', SANDBOX_FEED].includes(env.GITHUB_REPOSITORY) &&
      /^\d+$/.test(env.GITHUB_RUN_ID ?? '') &&
      platform === 'darwin' &&
      arch === 'arm64',
    `The Mac update rehearsal runs only on GitHub-hosted arm64 macOS runners of brocrew/brocrew or ${SANDBOX_FEED}.`,
  )
}

export function diskImageFrom(text, version) {
  const metadata = readUpdateFile(text)
  requireEvidence(metadata.version === version, `Feed must offer ${version}.`)
  const images = metadata.files.filter((file) => file.url.endsWith('.dmg'))
  requireEvidence(images.length === 1, 'Feed must name exactly one disk image.')
  const image = images[0]
  requireEvidence(
    image.url === basename(image.url) && !/[\\?#]/.test(image.url),
    'Unsafe disk-image name.',
  )
  requireEvidence(
    Number.isSafeInteger(image.size) && image.size > 0,
    'Disk-image byte count is missing.',
  )
  requireEvidence(
    typeof image.sha512 === 'string' &&
      Buffer.from(image.sha512, 'base64').length === 64 &&
      Buffer.from(image.sha512, 'base64').toString('base64') === image.sha512,
    'Disk-image SHA-512 is missing.',
  )
  return { version, ...image }
}

/**
 * The `package.json` an `app.asar` carries, read as `@electron/asar` reads one, with Node's own
 * modules: an 8-byte size pickle, the header pickle naming each file's size and offset, then the
 * files, whose offsets count from the header's end.
 */
export function packageOfAsar(archive) {
  const fd = openSync(archive, 'r')
  try {
    const read = (length, at) => {
      const buffer = Buffer.alloc(length)
      requireEvidence(
        readSync(fd, buffer, 0, length, at) === length,
        'The app archive is cut short.',
      )
      return buffer
    }
    const headerSize = read(8, 0).readUInt32LE(4)
    const header = read(headerSize, 8)
    const json = header.subarray(8, 8 + header.readUInt32LE(4)).toString('utf8')
    const file = JSON.parse(json).files?.['package.json']
    requireEvidence(
      Number.isSafeInteger(file?.size) && typeof file?.offset === 'string' && !file.unpacked,
      'The app archive holds no package.json.',
    )
    return JSON.parse(read(file.size, 8 + headerSize + Number(file.offset)).toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

export function hash(bytes, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding)
}

export function mountedImageOf(info, image) {
  const matches = (info.images ?? []).filter(
    (one) => typeof one['image-path'] === 'string' && resolve(one['image-path']) === resolve(image),
  )
  requireEvidence(matches.length <= 1, 'More than one mounted image matches the download.')
  if (matches.length === 0) return null
  const mounts = (matches[0]['system-entities'] ?? [])
    .map((one) => one['mount-point'])
    .filter((one) => typeof one === 'string')
  requireEvidence(
    mounts.length === 1 && mounts[0].startsWith('/Volumes/'),
    'Downloaded image must have exactly one mounted volume.',
  )
  return { image: matches[0]['image-path'], mount: mounts[0] }
}

// ⚠️ 695-visible: the Mac rehearsal (`scripts/mac-update-test.mjs`) starts the installed app as a
// person does, through LaunchServices, so the disk image really opens and the window really guides;
// a hidden launch skips both. This names that app's executable to prove a process is one it started.
// Only on a hosted runner.
export function assertOwnedProcess(record, current, app, port) {
  requireEvidence(
    record &&
      current &&
      record.pid === current.pid &&
      record.started === current.started &&
      record.command === current.command &&
      current.command.startsWith(`${app}/Contents/MacOS/BroCrew `) &&
      new RegExp(`(?:^|\\s)--remote-debugging-port=${port}(?:\\s|$)`).test(current.command) &&
      /(?:^|\s)--remote-debugging-address=127\.0\.0\.1(?:\s|$)/.test(current.command) &&
      !current.command.includes('--brobot-hidden'),
    'Refusing to signal a process whose test-launch identity is not verified.',
  )
}

export function recoveryOrder(log, { checkpoint }) {
  const lines = log.split(/\r?\n/)
  requireEvidence(!lines.includes(FAIL_LINE), 'App reported a failed start.')
  const readyLines = lines.flatMap((line, index) => (line === READY_LINE ? [index] : []))
  const copies = lines.flatMap((line, index) => (line === CHECKPOINT_LINE ? [index] : []))
  requireEvidence(readyLines.length === 1, 'Exactly one READY line is required.')
  const ready = readyLines[0]
  requireEvidence(
    checkpoint ? copies.length === 1 && copies[0] < ready : copies.length === 0,
    checkpoint
      ? 'Exactly one checked-copy line must precede READY.'
      : 'Second start made another recovery copy.',
  )
  return { readyLine: ready, checkedCopyLines: copies }
}

export function statePreserved(before, after) {
  for (const name of STATE_FILES) {
    requireEvidence(
      (before[name] !== undefined) === (after[name] !== undefined),
      `State presence changed: ${name}`,
    )
    if (before[name] !== undefined)
      requireEvidence(
        rehearsalStateKept(name, before[name], after[name]),
        `State bytes changed: ${name}`,
      )
  }
}

export function registryPreserved(before, after, reopenedPath) {
  const valid = (book) => {
    requireEvidence(
      book?.version === 1 && Array.isArray(book.workspaces),
      'Invalid workspace registry.',
    )
    const paths = new Set()
    for (const row of book.workspaces) {
      requireEvidence(
        typeof row?.path === 'string' &&
          row.path !== '' &&
          Number.isFinite(row.lastOpenedAt) &&
          !paths.has(row.path),
        'Invalid or duplicate workspace registry row.',
      )
      paths.add(row.path)
    }
    requireEvidence(paths.has(reopenedPath), 'Reopened workspace is missing from the registry.')
  }
  valid(before)
  valid(after)
  const { workspaces: beforeRows, ...beforeFormat } = before
  const { workspaces: afterRows, ...afterFormat } = after
  requireEvidence(
    isDeepStrictEqual(beforeFormat, afterFormat),
    'Workspace registry format changed.',
  )
  requireEvidence(beforeRows.length === afterRows.length, 'Workspace registry lost or added a row.')
  const normalize = (rows) =>
    rows
      .map((row) => {
        if (row.path !== reopenedPath) return row
        return Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'lastOpenedAt'))
      })
      .sort((a, b) => a.path.localeCompare(b.path))
  requireEvidence(
    isDeepStrictEqual(normalize(beforeRows), normalize(afterRows)),
    'Workspace registry rows changed.',
  )
  requireEvidence(
    afterRows.find((row) => row.path === reopenedPath).lastOpenedAt >=
      beforeRows.find((row) => row.path === reopenedPath).lastOpenedAt,
    'Workspace registry opening time moved backwards.',
  )
}

function rowsKept(before, after, table, ignored = []) {
  const withoutIgnored = (row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.includes(key)))
  const indexed = new Map(after.map((row) => [row.id, withoutIgnored(row)]))
  for (const row of before) {
    requireEvidence(indexed.has(row.id), `${table} lost row ${row.id}.`)
    requireEvidence(
      isDeepStrictEqual(withoutIgnored(row), indexed.get(row.id)),
      `${table} changed row ${row.id}.`,
    )
  }
}

export function dataPreserved(before, after, { allowAppended = false } = {}) {
  for (const table of ['provider_session', 'events']) {
    requireEvidence(
      Array.isArray(before[table]) && Array.isArray(after[table]) && before[table].length > 0,
      `No baseline evidence for ${table}.`,
    )
  }
  requireEvidence(
    before.provider_session.length >= 2,
    'Fixture must create at least two conversations.',
  )
  requireEvidence(
    before.provider_session.length === after.provider_session.length,
    'Conversation count changed.',
  )
  rowsKept(before.provider_session, after.provider_session, 'provider_session', [
    'status',
    'updated_at',
    'closed_by_the_quit_at',
  ])
  rowsKept(before.events, after.events, 'events')
  if (!allowAppended) {
    requireEvidence(
      before.events.length === after.events.length,
      'Unexpected new events rows before any resume.',
    )
  }
  requireEvidence(
    isDeepStrictEqual(before.migrations, after.migrations),
    'Migration records changed in the same-code rehearsal.',
  )
  return Object.fromEntries(
    ['provider_session', 'events'].map((name) => [
      name,
      { before: before[name].length, after: after[name].length, preserved: before[name].length },
    ]),
  )
}

export function nativeTranscriptsPresent(snapshot, files) {
  for (const row of snapshot.provider_session) {
    const ref = JSON.parse(row.external_ref)
    requireEvidence(
      ref.provider === 'codex' && typeof ref.sessionId === 'string',
      'Missing fixture native reference.',
    )
    requireEvidence(
      Object.keys(files).filter((name) => name.endsWith(`-${ref.sessionId}.jsonl`)).length === 1,
      `Native transcript is missing or duplicated for ${row.id}.`,
    )
  }
}

export function verifyCheckpoint(manifest, files, expected) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  requireEvidence(
    manifest.format === 'brobot-checkpoint' && manifest.version === 1 && uuid.test(manifest.id),
    'Invalid checkpoint identity or format.',
  )
  requireEvidence(
    manifest.id === expected.id &&
      manifest.workspaceId === expected.workspaceId &&
      uuid.test(manifest.workspaceId),
    'Checkpoint names a different folder or workspace.',
  )
  requireEvidence(
    !Number.isNaN(Date.parse(manifest.createdAt)) && manifest.reason === 'first-start-of-release',
    'Checkpoint date or reason is missing.',
  )
  requireEvidence(
    manifest.madeBy?.appVersion === VERSION_B && manifest.madeBy?.build === expected.source,
    'Checkpoint was not made by build B.',
  )
  requireEvidence(manifest.database?.file === 'database.sqlite', 'Wrong checkpoint database path.')
  const checked = (name, entry) => {
    const bytes = files[name]
    requireEvidence(
      Buffer.isBuffer(bytes) && bytes.length === entry.bytes && hash(bytes) === entry.sha256,
      `Checkpoint bytes or SHA-256 differ for ${name}.`,
    )
  }
  checked('database.sqlite', manifest.database)
  requireEvidence(
    isDeepStrictEqual(manifest.database.migrations, expected.migrations),
    'Checkpoint migration lineage differs.',
  )
  requireEvidence(
    Array.isArray(manifest.files) &&
      manifest.files.length === STATE_FILES.length &&
      new Set(manifest.files.map((one) => one.name)).size === STATE_FILES.length,
    'Checkpoint state-file inventory is incomplete or duplicated.',
  )
  for (const file of manifest.files) {
    requireEvidence(
      STATE_FILES.includes(file.name) && typeof file.present === 'boolean',
      'Unknown checkpoint state-file entry.',
    )
    if (file.present) checked(file.name, file)
    else
      requireEvidence(
        files[file.name] === undefined,
        `An absent checkpoint file exists: ${file.name}.`,
      )
    const baseline = expected.state[file.name]
    requireEvidence(
      (baseline !== undefined) === file.present,
      `Checkpoint presence differs for ${file.name}.`,
    )
    if (file.present)
      requireEvidence(hash(baseline) === file.sha256, `Checkpoint did not preserve ${file.name}.`)
  }
  requireEvidence(
    files['drafts.json'] && files['workspace.json'],
    'Required fixture state is missing from the checkpoint.',
  )
  return { id: manifest.id, databaseSha256: manifest.database.sha256, files: manifest.files }
}
