import { lineageFits } from './upgrade-path.mjs'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, readdir, lstat, readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { readUpdateFile } from '../release-check.mjs'
import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  READY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'
import { SANDBOX_FEED, STATE_FILES, VERSION_A, VERSION_B } from './update-rehearsal.mjs'
import { rehearsalStateKept } from './update-rehearsal-state.mjs'
import { aConversation } from './update-rehearsal-data.mjs'
import { SCRIPTED_MODEL, until } from './update-rehearsal-app.mjs'
import { readStateEntry, SKILL_TREE_NAMES, skillTreeStateDigest } from './skill-tree-state.mjs'
import { MOVED_STATE_TABLES, withMovedFiles } from './moved-state-files.mjs'

export const FEED_URL = 'http://127.0.0.1:47123/'
export { STATE_FILES, VERSION_A, VERSION_B }
export { CHECKPOINT_LINE, FAIL_LINE, READY_LINE }

export async function joinMeasurementChild(
  child,
  {
    deadlineMs = 900_000,
    graceMs = 5000,
    parent = process,
    groupKill = (pid, signal) => process.kill(-pid, signal),
  } = {},
) {
  const facts = {
    pgid: child.pid ?? null,
    closed: false,
    groupStopped: false,
    timedOut: false,
    cancelled: null,
    stops: [],
    errors: [],
  }
  let escalation
  const groupAlive = () => {
    if (facts.groupStopped || !child.pid) return false
    try {
      groupKill(child.pid, 0)
      return true
    } catch (error) {
      if (error.code === 'ESRCH') {
        facts.groupStopped = true
        return false
      }
      facts.groupError = { code: error.code, message: error.message }
      return null
    }
  }
  const kill = (signal) => {
    if (groupAlive() === false) return
    try {
      groupKill(child.pid, signal)
      facts.stops.push({ signal, sent: true })
    } catch (error) {
      facts.errors.push({ signal, code: error.code, message: error.message })
    }
  }
  const stop = (reason) => {
    if (facts.timedOut || facts.cancelled) return
    if (reason === 'deadline') facts.timedOut = true
    else facts.cancelled = reason
    kill('SIGTERM')
    escalation = setTimeout(() => kill('SIGKILL'), graceMs)
  }
  const terminate = () => stop('SIGTERM'),
    interrupt = () => stop('SIGINT')
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      Object.assign(facts, { code, signal, closed: true })
      resolve(facts)
    })
  })
  const deadline = setTimeout(() => stop('deadline'), deadlineMs)
  parent.on('SIGTERM', terminate)
  parent.on('SIGINT', interrupt)
  try {
    await closed
    if (groupAlive() !== false) {
      stop('descendants-after-close')
      await until(() => groupAlive() === false, graceMs * 2, 25)
    }
    facts.groupStopped = groupAlive() === false
    return facts
  } finally {
    clearTimeout(deadline)
    clearTimeout(escalation)
    parent.removeListener('SIGTERM', terminate)
    parent.removeListener('SIGINT', interrupt)
  }
}

export function observeKeychainEntries(appNames, { entryFor, attributes, run = spawnSync }) {
  const entries = [],
    attempts = []
  for (const appName of new Set(appNames)) {
    const { service } = entryFor(appName)
    const found = run('/usr/bin/security', ['find-generic-password', '-s', service], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    const read =
      found.status === 0 ? attributes(`${found.stdout ?? ''}\n${found.stderr ?? ''}`) : null
    attempts.push({
      appName,
      service,
      status: found.status ?? null,
      signal: found.signal ?? null,
      errorCode: found.error?.code ?? null,
      parseSucceeded: read !== null,
    })
    if (read !== null) entries.push({ appName, ...read })
  }
  return { entries, attempts }
}

export function measurementFilesystem(root, commands, invoke = spawnSync) {
  const run = (program, args, input) => {
    const value = invoke(program, args, { encoding: 'utf8', timeout: 30_000, input })
    commands.push({
      program,
      args,
      status: value.status,
      signal: value.signal,
      error: value.error
        ? { code: value.error.code, errno: value.error.errno, message: value.error.message }
        : null,
      stdout: value.stdout ?? '',
      stderr: value.stderr ?? '',
    })
    requireEvidence(value.status === 0 && !value.error, `Filesystem command failed: ${program}`)
    return value.stdout
  }
  const df = run('/bin/df', ['-P', root]).trim().split(/\r?\n/)
  const device = df.at(-1)?.trim().split(/\s+/)[0]
  requireEvidence(
    df.length >= 2 && device?.startsWith('/dev/'),
    'No actual filesystem device was observed.',
  )
  return JSON.parse(
    run(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', '-'],
      run('/usr/sbin/diskutil', ['info', '-plist', device]),
    ),
  )
}

const USAGE_TABLES = [
  'provider_usage_reading',
  'provider_usage_window_seen',
  'provider_usage_read_on',
]

/** Packaged launches keep their list apart from development launches' workspaces.json. */
export function packagedRegistryFile(dataRoot) {
  return join(dataRoot, 'packaged-workspaces.json')
}

/** Guided downloads can choose a numbered name when Downloads already holds the feed's name. */
export function downloadedImagePath(state, downloads) {
  requireEvidence(
    state?.kind === 'ready' &&
      state.how === 'opened' &&
      typeof state.path === 'string' &&
      state.path === resolve(state.path) &&
      dirname(state.path) === resolve(downloads) &&
      state.path.endsWith('.dmg'),
    'The app did not report a downloaded disk image in Downloads.',
  )
  return state.path
}

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
export function fileOfAsar(archive, path) {
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
    const file = path.split('/').reduce((node, part) => node?.files?.[part], JSON.parse(json))
    requireEvidence(
      Number.isSafeInteger(file?.size) && typeof file?.offset === 'string' && !file.unpacked,
      `The app archive holds no ${path}.`,
    )
    return read(file.size, 8 + headerSize + Number(file.offset)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

export function packageOfAsar(archive) {
  return JSON.parse(fileOfAsar(archive, 'package.json'))
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
  if (mounts.length === 0) return null
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

/** Plain files stay byte-for-byte; trees carry sorted paths, file hashes and executable bits. */
export function stateBytes(folder, tables = {}) {
  const state = {}
  for (const name of STATE_FILES) {
    const path = join(folder, name)
    try {
      lstatSync(path)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    // Do not turn broken links or a disappearing nested file into an absent state entry.
    state[name] = readStateEntry(path)
  }
  return withMovedFiles(state, tables)
}

export function stateDigest(name, bytes) {
  return SKILL_TREE_NAMES.includes(name)
    ? skillTreeStateDigest(bytes)
    : { bytes: bytes.length, sha256: hash(bytes) }
}

export function stateSummary(state) {
  return Object.fromEntries(
    Object.entries(state).map(([name, bytes]) => [name, stateDigest(name, bytes)]),
  )
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

export function dataPreserved(
  before,
  after,
  { allowAppended = false, usage = false, candidateLineage } = {},
) {
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
    candidateLineage
      ? isDeepStrictEqual(before.migrations, after.migrations.slice(0, before.migrations.length)) &&
          after.migrations.length === candidateLineage.length &&
          lineageFits(
            after.migrations.map((m) => ({ createdAt: m.created_at, hash: m.hash })),
            candidateLineage,
          )
      : isDeepStrictEqual(before.migrations, after.migrations),
    'Migration records differ from the expected lineage.',
  )
  if (usage)
    for (const table of USAGE_TABLES)
      requireEvidence(
        Array.isArray(before[table]) &&
          Array.isArray(after[table]) &&
          isDeepStrictEqual(before[table], after[table]),
        `${table} rows changed or are missing.`,
      )
  return Object.fromEntries(
    ['provider_session', 'events', ...(usage ? USAGE_TABLES : [])].map((name) => [
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
    !Number.isNaN(Date.parse(manifest.createdAt)) &&
      manifest.reason === (expected.reason ?? 'first-start-of-release'),
    'Checkpoint date or reason is missing.',
  )
  requireEvidence(
    manifest.madeBy?.appVersion === VERSION_B && manifest.madeBy?.build === expected.source,
    'Checkpoint was not made by build B.',
  )
  requireEvidence(manifest.database?.file === 'database.sqlite', 'Wrong checkpoint database path.')
  const checked = (name, entry) => {
    const bytes = files[name]
    requireEvidence(Buffer.isBuffer(bytes), `Checkpoint state is missing: ${name}.`)
    const digest = stateDigest(name, bytes)
    requireEvidence(
      digest.bytes === entry.bytes && digest.sha256 === entry.sha256,
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
      requireEvidence(
        Buffer.isBuffer(baseline) && baseline.equals(files[file.name]),
        `Checkpoint did not preserve ${file.name}.`,
      )
  }
  requireEvidence(files['workspace.json'], 'Required fixture state is missing from the checkpoint.')
  return { id: manifest.id, databaseSha256: manifest.database.sha256, files: manifest.files }
}

export const MAC_KEYCHAIN_REFUSAL =
  'BroCrew can’t read the API key saved for Codex on this computer. macOS may be waiting for permission to read its saved key. Save it again under “API key” on the Codex card in Providers, or remove it there to use your sign-in instead.'

/** Only the exact app refusal, optionally in Electron's fixed transport envelope, is this limit. */
export function isMacKeychainRefusal(error) {
  const refused = error?.refusal
  return [
    MAC_KEYCHAIN_REFUSAL,
    `Error invoking remote method 'runtime:command': Error: ${MAC_KEYCHAIN_REFUSAL}`,
  ].includes(refused?.said)
}

/** Forget only the hosted app's sealing entry, then let that build save its own fictional key. */
export async function withMacKeychainRecovery({
  platform,
  attempt,
  keyStatus,
  posts,
  stop,
  forgetEntry,
  start,
  save,
  recordLimit,
}) {
  const before = posts()
  try {
    return await attempt()
  } catch (error) {
    if (platform !== 'darwin' || !isMacKeychainRefusal(error) || posts() !== before) throw error
    const status = await keyStatus()
    if (!status?.providerMatches || !status.set || status.inUse || !status.unreadable) throw error
    recordLimit(MAC_KEYCHAIN_REFUSAL, status)
    await stop()
    await forgetEntry()
    await start()
    await save()
    // One recovery only: an unsuccessful retry remains a failed rehearsal.
    return await attempt()
  }
}

/** Start or resume the fixture turn on the configured local model, preserving plain refusals. */
export async function startLocalModelTurn(
  cdp,
  text,
  { record = () => {}, sessionId: existing, answerARefusal = false } = {},
) {
  let sessionId = existing
  if (sessionId === undefined) {
    record('conversation-create-requested', { provider: 'codex', model: SCRIPTED_MODEL })
    sessionId = await aConversation(cdp, { answerARefusal })
    record('conversation-created', { sessionId, provider: 'codex', model: SCRIPTED_MODEL })
  } else {
    record('conversation-resume-requested', { sessionId })
    await fixtureCommand(
      cdp,
      `return await window.api.runtime.resume({sessionId:${JSON.stringify(sessionId)}})`,
    )
    record('conversation-resumed', { sessionId })
  }
  record('turn-send-requested', { sessionId })
  await fixtureCommand(
    cdp,
    `return await window.api.runtime.send({sessionId:${JSON.stringify(sessionId)},text:${JSON.stringify(text)}})`,
  )
  record('turn-sent', { sessionId })
  return sessionId
}

async function fixtureCommand(cdp, body) {
  const result = await cdp.evaluate(`try { ${body}; } catch(error) {
    return {fixtureRefused:true,said:typeof error?.message === 'string' ? error.message : String(error)}
  }`)
  if (result?.fixtureRefused) {
    const error = new Error('The fixture resume or message was refused.')
    error.refusal = { said: result.said }
    throw error
  }
}

/** Keep the fixture model's existing receipts independently of other failure diagnostics. */
export async function keepModelFailureEvidence(model, folder, summary, write) {
  if (!model) return
  try {
    await write(
      join(folder, 'model-failure.json'),
      JSON.stringify({ log: model.log, requests: model.requests }, null, 2),
    )
  } catch (error) {
    summary.modelDiagnosticFailure = String(error)
  }
}

/** A timeout receipt keeps event kinds and states, never message bodies or credentials. */
export async function localModelTurnFacts(cdp, sessionId, prompt) {
  return cdp.evaluate(`
    const history = await window.api.runtime.latestHistory({sessionId:${JSON.stringify(sessionId)}})
    const events = (history?.entries ?? []).map(one => one.event)
    const kinds = new Set(['session','provider_turn','assistant_delta','assistant_message','turn','status','error'])
    const start = events.findIndex(one => one.type === 'user_turn' && one.text === ${JSON.stringify(prompt)})
    const next = events.findIndex((one, index) => index > start && one.type === 'user_turn')
    const turn = start < 0 ? [] : events.slice(start + 1, next < 0 ? events.length : next)
    const reply = turn.findIndex(one => one.type === 'assistant_message' && /^update rehearsal (resp_update_rehearsal_[0-9]+)$/.test(one.text))
    const responseId = reply < 0 ? null : turn[reply].text.match(/^update rehearsal (resp_update_rehearsal_[0-9]+)$/)[1]
    return {
      responseId,
      responseRecorded: responseId !== null && turn.slice(reply + 1).some(one => one.type === 'turn' && one.state === 'completed'),
      providerSessionStarted: events.some(one=>one.type === 'session' && ['started','resumed'].includes(one.state)),
      eventCounts:Object.fromEntries([...kinds,'other'].map(kind=>[kind,events.filter(one=>(kinds.has(one.type) ? one.type : 'other') === kind).length])),
      turnCounts:Object.fromEntries(['completed','failed','interrupted'].map(state=>[state,events.filter(one=>one.type === 'turn' && one.state === state).length])),
      statusCounts:Object.fromEntries(['idle','working','waiting_permission','ended','errored'].map(state=>[state,events.filter(one=>one.type === 'status' && one.state === state).length])),
      hasError:events.some(one=>one.type === 'error'),
    }
  `)
}

export const exists = async (path) =>
  access(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
export async function digest(path, algorithm = 'sha256', encoding = 'hex') {
  const sum = createHash(algorithm)
  for await (const chunk of createReadStream(path)) sum.update(chunk)
  return sum.digest(encoding)
}
export async function waitFor(check, description, budget = 180_000) {
  const value = await until(check, budget, 250)
  if (!value) throw new Error(`Timed out: ${description}`)
  return value
}

export function macCommands(record) {
  const exec = promisify(execFile)
  async function run(program, args, options = {}) {
    const result = await exec(program, args, {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    })
    record?.({ program, args, stdout: result.stdout, stderr: result.stderr })
    return result.stdout
  }
  async function plist(program, args) {
    const xml = await run(program, args)
    return await new Promise((done, failed) => {
      const child = spawn('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = '',
        error = ''
      child.stdout.on('data', (part) => {
        out += part
      })
      child.stderr.on('data', (part) => {
        error += part
      })
      child.once('error', failed)
      child.once('exit', (code) => {
        if (code !== 0) return failed(new Error(`plutil failed (${code}): ${error}`))
        try {
          done(JSON.parse(out))
        } catch (problem) {
          failed(problem)
        }
      })
      child.stdin.end(xml)
    })
  }
  async function processInfo(pid) {
    try {
      const command = (await run('/bin/ps', ['-p', String(pid), '-o', 'command='])).trim()
      const started = (await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='])).trim()
      return command && started ? { pid, command, started } : null
    } catch (error) {
      if (error.code === 1) return null
      throw error
    }
  }
  return { run, plist, processInfo }
}
export function databaseSnapshot(
  file,
  { credentials = false, usage = false, movedState = false } = {},
) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    requireEvidence(
      db.prepare('PRAGMA quick_check').get().quick_check === 'ok',
      'SQLite quick_check failed.',
    )
    requireEvidence(
      db.prepare('PRAGMA foreign_key_check').all().length === 0,
      'SQLite foreign-key check failed.',
    )
    db.exec('BEGIN')
    const snapshot = Object.fromEntries(
      ['provider_session', 'events'].map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ]),
    )
    if (credentials)
      snapshot.provider_api_key = db
        .prepare('SELECT * FROM provider_api_key ORDER BY provider')
        .all()
    if (usage)
      for (const table of USAGE_TABLES)
        snapshot[table] = db
          .prepare(
            `SELECT * FROM ${table} ORDER BY provider${table === 'provider_usage_read_on' ? '' : ', "window"'}`,
          )
          .all()
    if (movedState) {
      const tables = new Set(['imported_side_file', ...Object.values(MOVED_STATE_TABLES).flat()])
      for (const table of tables)
        snapshot[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    }
    snapshot.migrations = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
    db.exec('COMMIT')
    return snapshot
  } finally {
    db.close()
  }
}
export async function nativeFiles(folder, data) {
  const files = {}
  if (!(await exists(folder))) return files
  requireEvidence(!(await lstat(folder)).isSymbolicLink(), 'Native transcript folder is a symlink.')
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    requireEvidence(!entry.isSymbolicLink(), `Native transcript tree contains a symlink: ${path}`)
    if (entry.isDirectory()) Object.assign(files, await nativeFiles(path, data))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const bytes = await readFile(path)
      files[path.slice(data.length + 1)] = {
        bytes: bytes.length,
        sha256: hash(bytes),
      }
    }
  }
  return files
}
export async function checkpointIds(data) {
  const folder = join(data, 'backups')
  if (!(await exists(folder))) return []
  const found = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const path = join(folder, entry.name, 'manifest.json')
      requireEvidence(await exists(path), 'Unfinished or unmanifested recovery copy.')
      found.push(entry.name)
    }
  }
  return found.sort()
}
export async function checkNativePrefixes(natives, data) {
  for (const [name, original] of Object.entries(natives)) {
    requireEvidence(original.bytes > 0, 'Native transcript baseline is empty.')
    const sum = createHash('sha256')
    for await (const chunk of createReadStream(join(data, name), {
      start: 0,
      end: original.bytes - 1,
    }))
      sum.update(chunk)
    requireEvidence(
      sum.digest('hex') === original.sha256,
      `Native transcript lost original bytes: ${name}`,
    )
  }
}

export async function observeMacWindow({
  app,
  port,
  stage,
  log,
  expected,
  run,
  processInfo,
  connect,
  attempts,
  onChild,
  verifyBundle,
}) {
  const root = `http://127.0.0.1:${port}`
  const discovery = await waitFor(async () => {
    try {
      const response = await fetch(`${root}/json/version`, { signal: AbortSignal.timeout(1000) })
      return response.ok ? await response.json() : null
    } catch (error) {
      if (error instanceof TypeError || error.name === 'TimeoutError') return null
      throw error
    }
  }, `${stage} DevTools endpoint`)
  const browser = await connect(discovery.webSocketDebuggerUrl)
  const processes = await browser.send('SystemInfo.getProcessInfo')
  const pid = processes.processInfo.find((one) => one.type === 'browser')?.id
  requireEvidence(Number.isInteger(pid) && pid > 0, 'Browser PID evidence is missing.')
  const identity = await processInfo(pid)
  assertOwnedProcess(identity, identity, app, port)
  const child = { ...identity, port, browser, log }
  await onChild(child)
  const attempt = { stage, ...identity, port, log: basename(log), phase: 'cdp-binding' }
  attempts.push(attempt)
  const bound = await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  requireEvidence(
    bound.includes(`127.0.0.1:${port}`) && !bound.includes(`*:${port}`),
    'CDP is not bound exclusively to loopback.',
  )
  const page = await waitFor(async () => {
    const targets = await (await fetch(`${root}/json/list`)).json()
    return targets.find(
      (one) => one.type === 'page' && one.url.endsWith('/index.html') && one.webSocketDebuggerUrl,
    )
  }, `${stage} ordinary window`)
  const cdp = await connect(page.webSocketDebuggerUrl)
  attempt.page = { id: page.id, url: page.url }
  child.cdp = cdp
  child.stage = stage
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  attempt.phase = 'ordinary-bridge'
  await waitFor(
    () => cdp.evaluate('return Boolean(window.api?.updates && window.api?.runtime)'),
    `${stage} ordinary bridge`,
  )
  attempt.phase = 'ready-line'
  await waitFor(async () => {
    const lines = (await readFile(log, 'utf8')).split(/\r?\n/)
    requireEvidence(!lines.includes(FAIL_LINE), 'App reported a failed start.')
    return lines.includes(READY_LINE)
  }, `${stage} READY line`)
  attempt.phase = 'app-info'
  const info = await cdp.evaluate('return await window.api.getAppInfo()')
  requireEvidence(
    info.version === expected.version &&
      info.build.commit === expected.source &&
      (!expected.clean || info.build.dirty === false),
    'Running version/source/clean build stamp does not match the frozen build.',
  )
  requireEvidence(
    info.workspace.path === expected.data && info.workspace.isDefault === expected.isDefault,
    'Running app uses a different data folder.',
  )
  attempt.phase = 'visible-window'
  await waitFor(
    () =>
      cdp.evaluate(
        'return document.visibilityState === "visible" && document.querySelector("[data-cy=rail-workspace]") !== null',
      ),
    `${stage} ordinary visible window after rendering`,
  )
  const targets = await (await fetch(`${root}/json/list`)).json()
  requireEvidence(
    !targets.some((one) => one.url.endsWith('/recovery.html')),
    'A recovery choice window remains open.',
  )
  requireEvidence(
    info.db.providerSessionCount === expected.conversations,
    'Unexpected data folder or conversation count.',
  )
  const packaged = await verifyBundle()
  attempt.phase = 'verified'
  const record = {
    stage,
    pid: child.pid,
    command: child.command,
    started: child.started,
    cdpBinding: bound.trim(),
    log: basename(log),
    appInfo: info,
    package: packaged,
  }
  return { child, attempt, cdp, record }
}
export async function quitMacChild(child, app, processInfo, report) {
  if (child === null) return null
  const current = await processInfo(child.pid)
  assertOwnedProcess(child, current, app, child.port)
  process.kill(child.pid, 'SIGTERM')
  await waitFor(
    async () => !(await processInfo(child.pid)),
    'verified test child graceful quit',
    60_000,
  )
  child.browser.close()
  report('verified-child-quit', { pid: child.pid, signal: 'SIGTERM' })
  return null
}

export async function checkedMacBundle(bundle, version, marker, run) {
  requireEvidence(!(await lstat(bundle)).isSymbolicLink(), 'App bundle must not be a symlink.')
  const info = packageOfAsar(`${bundle}/Contents/Resources/app.asar`)
  requireEvidence(
    info.version === version && info.rehearsalMarker === marker,
    'Installed package version/marker differs.',
  )
  const id = (
    await run('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      `${bundle}/Contents/Info.plist`,
    ])
  ).trim()
  requireEvidence(id === 'com.brobot2.desktop', 'Wrong installed bundle identity.')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  return {
    version: info.version,
    marker: info.rehearsalMarker,
    bundleId: id,
    asarSha256: await digest(`${bundle}/Contents/Resources/app.asar`),
  }
}

export function launchServicesArguments(
  app,
  evidence,
  stage,
  port,
  { appArguments = [], environment = [] } = {},
) {
  return [
    '-n',
    '--stdout',
    join(evidence, `${stage}.stdout.log`),
    '--stderr',
    join(evidence, `${stage}.log`),
    ...environment.flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    app,
    '--args',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    ...appArguments,
  ]
}
