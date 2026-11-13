import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { SKILL_CATALOGUE_TABLES } from '../../apps/desktop/src/main/db/skill-catalogue-tables.ts'
import { SKILL_TREE_NAMES, skillTreeStateDigest, readStateEntry } from './skill-tree-state.mjs'

import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  READY_LINE,
  OPENED_FOR_RECOVERY_LINE as RECOVERY_ONLY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'

export { CHECKPOINT_LINE, FAIL_LINE, READY_LINE, RECOVERY_ONLY_LINE }

export const MAY_MOVE_AT_A_START = {
  provider_session: ['status', 'updated_at', 'closed_by_the_quit_at'],
  skill_current: ['current_version'],
  skill_catalogue_state: ['revision'],
}

export const CONNECTION_UPGRADE_DEFAULTS = Object.freeze({
  agent_identity: Object.freeze({ connection_id: null }),
  provider_session: Object.freeze({ connection_id: null }),
})

export const RETIRED_TABLES = ['raw_frame']

export function keptTables(tables) {
  return Object.fromEntries(
    Object.entries(tables).filter(([table]) => !RETIRED_TABLES.includes(table)),
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function requireEvidence(condition, message) {
  if (!condition) throw new Error(message)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isPublishedRelease(release, tag) {
  return release.tag_name === tag && release.draft === false
}

export function betaAsset(assets, os) {
  const shape =
    os === 'windows'
      ? /^[^/\\]+-Setup-[^/\\]*-x64[^/\\]*\.exe$/
      : /^[^/\\]+-[^/\\]*-arm64[^/\\]*\.dmg$/
  const matches = (assets ?? []).filter((asset) => shape.test(asset?.name ?? ''))
  requireEvidence(
    matches.length === 1,
    `The release must hold exactly one ${os} installer; it holds ${String(matches.length)}: ${matches.map((one) => one.name).join(', ')}`,
  )
  const [asset] = matches
  requireEvidence(Number.isSafeInteger(asset.size) && asset.size > 0, 'The installer has no size.')
  const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1]
  requireEvidence(
    digest !== undefined,
    `The release publishes no SHA-256 for ${asset.name}, so the download cannot be checked.`,
  )
  return { name: asset.name, size: asset.size, sha256: digest }
}

const A_PRODUCT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/

export function packagingNames(yaml) {
  const field = (key) => new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(yaml ?? '')?.[1]
  const appId = field('appId')
  const productName = field('productName')
  requireEvidence(
    typeof appId === 'string' && /^[A-Za-z0-9.-]+$/.test(appId),
    `The packaging names no app id: ${String(appId)}`,
  )
  requireEvidence(
    typeof productName === 'string' && A_PRODUCT_NAME.test(productName),
    `The packaging names no product name the lane can use: ${String(productName)}`,
  )
  return { appId, productName }
}

export function installerGuid(appId) {
  const namespace = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')
  const hash = createHash('sha1').update(namespace).update(appId, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function theCandidateInstaller(files, os, version) {
  const v = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const shape =
    os === 'windows' ? new RegExp(`^.+-Setup-${v}-x64\\.exe$`) : new RegExp(`^.+-${v}-arm64\\.dmg$`)
  const matches = (files ?? []).filter((name) => shape.test(name))
  requireEvidence(
    matches.length === 1,
    `The candidate's build must hold exactly one ${os} installer of ${version}; it holds ${String(matches.length)}: ${matches.join(', ')}`,
  )
  return matches[0]
}

export function appExeIn(files) {
  const programs = (files ?? []).filter(
    (name) => /\.exe$/i.test(name) && !/^Uninstall /i.test(name),
  )
  requireEvidence(
    programs.length === 1,
    `An install folder must hold exactly one program besides its uninstaller; it holds ${String(programs.length)}: ${programs.join(', ')}`,
  )
  const productName = programs[0].replace(/\.exe$/i, '')
  requireEvidence(A_PRODUCT_NAME.test(productName), `Not a product name: ${productName}`)
  return { exe: programs[0], productName }
}

export function bundleIn(entries) {
  const bundles = (entries ?? []).filter((name) => /\.app$/.test(name))
  requireEvidence(
    bundles.length === 1,
    `A disk image must hold exactly one app; it holds ${String(bundles.length)}: ${bundles.join(', ')}`,
  )
  const productName = bundles[0].replace(/\.app$/, '')
  requireEvidence(A_PRODUCT_NAME.test(productName), `Not a product name: ${productName}`)
  return { bundle: bundles[0], productName }
}

export function buildLineage(journal, sqlOf) {
  const entries = journal?.entries
  requireEvidence(Array.isArray(entries) && entries.length > 0, 'The migration journal is empty.')
  return entries.map((entry, index) => {
    requireEvidence(
      entry.idx === index,
      `Migration journal entry ${String(index)} is out of order.`,
    )
    const text = sqlOf(entry.tag)
    const lf = text.replace(/\r\n/g, '\n')
    return {
      createdAt: entry.when,
      hash: sha256(text),
      lf: sha256(lf),
      crlf: sha256(lf.replace(/\n/g, '\r\n')),
    }
  })
}

export function lineageFits(recorded, built) {
  return (
    recorded.length <= built.length &&
    recorded.every(
      (one, index) =>
        one.createdAt === built[index].createdAt &&
        [built[index].hash, built[index].lf, built[index].crlf].includes(one.hash),
    )
  )
}

export function recordedWith(recorded, built) {
  return recorded.map((one, index) => {
    const file = built[index]
    if (file === undefined || one.createdAt !== file.createdAt) return 'not this build’s'
    if (file.lf === file.crlf) return one.hash === file.lf ? 'either' : 'not this build’s'
    return one.hash === file.lf ? 'LF' : one.hash === file.crlf ? 'CRLF' : 'not this build’s'
  })
}

export function recordedLineage(rows) {
  return rows.map((row) => ({ createdAt: Number(row.created_at), hash: row.hash }))
}

export function stateFileNames(source) {
  const from = source.indexOf('export const APP_STATE_FILES')
  const to = source.indexOf('export const NOT_STATE', from)
  requireEvidence(from !== -1 && to > from, 'The state-file registry was not found.')
  const names = [...source.slice(from, to).matchAll(/name: '([^']+)'/g)].map((one) => one[1])
  requireEvidence(names.length > 0, 'The state-file registry names no file.')
  return names
}

export function startOrder(
  log,
  { checkpoint, completion = 'before-ready', observation = null, checkpointLine = CHECKPOINT_LINE },
) {
  const lines = log.split(/\r?\n/).map((line) => line.trimEnd())
  requireEvidence(!lines.includes(FAIL_LINE), `The start failed: ${failureOf(lines)}`)
  requireEvidence(!lines.includes(RECOVERY_ONLY_LINE), 'The start opened only its recovery window.')
  const ready = lines.flatMap((line, index) => (line === READY_LINE ? [index] : []))
  const copies = lines.flatMap((line, index) => (line === checkpointLine ? [index] : []))
  requireEvidence(
    ready.length === 1,
    `Exactly one READY line is required; found ${String(ready.length)}.`,
  )
  requireEvidence(
    ['before-ready', 'background', 'functional-background'].includes(completion),
    'The completion branch must be explicit.',
  )
  requireEvidence(
    checkpoint ? copies.length === 1 : copies.length === 0,
    checkpoint
      ? `Exactly one completed-copy line is required; found ${String(copies.length)}.`
      : 'A start of the same version made another recovery copy.',
  )
  if (checkpoint && completion === 'before-ready')
    requireEvidence(copies[0] < ready[0], 'The checked-copy line must come before READY.')
  const backgroundObservation =
    checkpoint && completion !== 'before-ready'
      ? requireResponsiveBeforeCompletion(observation, completion === 'functional-background')
      : null

  return {
    ready: ready[0],
    checkedCopy: copies[0] ?? null,
    ...(backgroundObservation ? { backgroundObservation } : {}),
  }
}

function requireResponsiveBeforeCompletion(observed, allowComplete = false) {
  const { launched, responsive, absent, completed, manifestAbsent } = observed ?? {}
  requireEvidence(
    [launched, responsive, absent, completed].every(Number.isFinite) &&
      launched <= responsive &&
      responsive <= absent &&
      absent <= completed &&
      ((manifestAbsent === true && absent < completed) ||
        (allowComplete && manifestAbsent === false)),
    'Responsive ordinary DOM needs ordered copy observations; overlap requires absence before completion.',
  )
  return manifestAbsent ? 'witnessed-overlap' : 'already-complete-no-overlap-credit'
}

export function makeEarlierMigrationFixture(db, journal, sqlOf) {
  const prefix = journal.entries.slice(0, -1)
  requireEvidence(prefix.length > 0, 'The synchronous exception needs a real earlier prefix.')
  return makeMigrationFixture(db, prefix, sqlOf)
}

export function makeMigrationFixture(db, entries, sqlOf) {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)',
  )
  db.exec('BEGIN')
  for (const entry of entries) {
    const sql = sqlOf(entry.tag)
    db.exec(sql)
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
      sha256(sql),
      entry.when,
    )
  }
  db.exec('COMMIT')
  return recordedLineage(
    db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all(),
  )
}

function failureOf(lines) {
  const at = lines.indexOf(FAIL_LINE)
  return lines[at + 1] ?? 'no reason followed'
}

function comparable(value) {
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString('base64') }
  if (typeof value === 'bigint') return { integer: value.toString() }
  return value
}

export function canonicalRow(row, ignored = []) {
  return JSON.stringify(
    Object.keys(row)
      .filter((column) => !ignored.includes(column))
      .sort()
      .map((column) => [column, comparable(row[column])]),
  )
}

const verifiedSkillMembership = new WeakMap()

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function validSkillReminder(item, format) {
  const reminder = item.reminder
  if (
    format === 1 &&
    !(
      hasExactKeys(reminder, ['codex', 'claude']) &&
      typeof reminder.claude === 'string' &&
      reminder.claude.length <= 247 &&
      reminder.claude === `brobot:${reminder.codex}`
    )
  )
    return false
  const text = format === 1 ? reminder.codex : reminder
  return (
    typeof text === 'string' &&
    text.length >= 1 &&
    text.length <= 240 &&
    text.startsWith(`${item.name} — `) &&
    !/[\r\n]/.test(text)
  )
}

export function verifyCandidateSkills(manifest, bodies) {
  requireEvidence(
    hasExactKeys(manifest, ['formatVersion', 'version', 'skills']) &&
      [1, 2].includes(manifest.formatVersion) &&
      typeof manifest.version === 'string' &&
      /^v\d+(?:\.\d+)?$/.test(manifest.version) &&
      Array.isArray(manifest.skills) &&
      bodies instanceof Map &&
      bodies.size === manifest.skills.length,
    'The candidate skill manifest is invalid.',
  )
  const names = new Set()
  for (const item of manifest.skills) {
    requireEvidence(
      hasExactKeys(item, ['name', 'description', 'reminder', 'sha256', 'bytes']) &&
        typeof item.name === 'string' &&
        /^[a-z][a-z0-9-]{0,99}$/.test(item.name) &&
        !names.has(item.name) &&
        typeof item.description === 'string' &&
        item.description.length > 0 &&
        item.description.length <= 500 &&
        validSkillReminder(item, manifest.formatVersion) &&
        !/[\r\n]/.test(item.description) &&
        Number.isInteger(item.bytes) &&
        item.bytes > 0 &&
        item.bytes <= 65_536 &&
        typeof item.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(item.sha256),
      'A candidate skill manifest entry is invalid.',
    )
    const body = bodies.get(item.name)
    requireEvidence(
      Buffer.isBuffer(body) && body.length === item.bytes && sha256(body) === item.sha256,
      'A candidate skill body does not match its manifest.',
    )
    const text = body.toString('utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1]
    const lines = frontmatter?.split(/\r?\n/) ?? []
    requireEvidence(
      Buffer.from(text, 'utf8').equals(body) &&
        lines.filter((line) => line.startsWith('name: ')).length === 1 &&
        lines.includes(`name: ${item.name}`) &&
        lines.filter((line) => line.startsWith('description: ')).length === 1 &&
        lines.includes(`description: ${item.description}`),
      'Candidate skill frontmatter does not match its manifest.',
    )
    names.add(item.name)
  }
  const proof = Object.freeze({
    names: Object.freeze([...names]),
    digest: sha256(Buffer.from(JSON.stringify(manifest))),
  })
  verifiedSkillMembership.set(proof, names)
  return proof
}

function skillAvailabilityMatches(old, now, before, after, candidateSkills) {
  const names = verifiedSkillMembership.get(candidateSkills)
  if (
    !names ||
    !now ||
    ![0, 1].includes(old.active) ||
    now.active !== 1 - old.active ||
    canonicalRow(old, ['active']) !== canonicalRow(now, ['active'])
  )
    return false
  const name = old.id?.startsWith('built-in/') ? old.id.slice('built-in/'.length) : undefined
  if (!name || old.alias !== name || now.active !== Number(names.has(name))) return false
  return [before, after].every((tables) => {
    const version = tables.skill_version?.find((row) => row.id === old.current_version)
    try {
      const meta = JSON.parse(version?.metadata)
      return version.skill_id === old.id && meta.origin?.kind === 'built-in' && meta.name === name
    } catch {
      return false
    }
  })
}

export function rowsPreserved(
  before,
  after,
  mayMove = MAY_MOVE_AT_A_START,
  keys = {},
  candidateSkills,
  additions = {},
) {
  const lost = []
  const added = {}
  for (const [table, rows] of Object.entries(before)) {
    const now = after[table]
    if (!Array.isArray(now)) {
      lost.push({ table, gone: 'the table' })
      continue
    }
    const requiredDefaults = additions[table] ?? {}
    const requiredColumns = Object.keys(requiredDefaults)
    const ignored = (mayMove[table] ?? []).filter((column) => !requiredColumns.includes(column))
    const left = new Map()
    for (const row of now) {
      const key = canonicalRow(row, ignored)
      const complete = requiredColumns.every(
        (column) => Object.hasOwn(row, column) && row[column] !== undefined,
      )
      const comparisonKey = complete ? key : JSON.stringify(['missing migration column', key])
      left.set(comparisonKey, (left.get(comparisonKey) ?? 0) + 1)
    }
    const keyOf = (row) =>
      (keys[table] ?? []).length > 0
        ? JSON.stringify(keys[table].map((column) => comparable(row[column])))
        : null
    const migrationDefaults = {
      ...(table === 'identity_instruction'
        ? { author: null }
        : table === 'identity_memory_amendment'
          ? { source_id: null, outcome: 'done', actual: null, settled_by: null, settled_at: null }
          : {}),
      ...requiredDefaults,
    }
    const addedColumns = Object.entries(migrationDefaults).filter(
      ([column]) =>
        Object.hasOwn(requiredDefaults, column) || now.some((one) => Object.hasOwn(one, column)),
    )
    for (const original of rows) {
      const row = { ...original }
      for (const [column, value] of addedColumns)
        if (!Object.hasOwn(original, column)) row[column] = value
      const key = canonicalRow(row, ignored)
      const count = left.get(key) ?? 0
      if (count > 0) {
        left.set(key, count - 1)
        continue
      }
      const available =
        table === 'skill_current' &&
        now.find(
          (one) =>
            (left.get(canonicalRow(one, ignored)) ?? 0) > 0 &&
            skillAvailabilityMatches(row, one, before, after, candidateSkills),
        )
      if (available) {
        const changedKey = canonicalRow(available, ignored)
        left.set(changedKey, left.get(changedKey) - 1)
        continue
      }
      const named = keyOf(row)
      const counterpart = named === null ? undefined : now.find((one) => keyOf(one) === named)
      lost.push(
        counterpart === undefined
          ? { table, row: named ?? key.slice(0, 200), gone: 'the row' }
          : {
              table,
              row: named,
              changed: [...new Set([...Object.keys(row), ...Object.keys(counterpart)])].filter(
                (column) =>
                  !ignored.includes(column) &&
                  (Object.hasOwn(row, column) !== Object.hasOwn(counterpart, column) ||
                    !isDeepStrictEqual(comparable(row[column]), comparable(counterpart[column]))),
              ),
            },
      )
    }
    const extra = [...left.values()].reduce((sum, count) => sum + count, 0)
    if (extra > 0) added[table] = extra
  }
  for (const table of Object.keys(after)) {
    if (!(table in before) && after[table].length > 0) added[table] = after[table].length
  }
  return { lost, added }
}

export function historyOf(tables, conversations) {
  const rows = (table) => (Array.isArray(tables[table]) ? tables[table] : [])
  requireEvidence(conversations.length >= 2, 'The beta made fewer than two conversations.')
  return conversations.map((id) => {
    const session = rows('provider_session').find((row) => row.id === id)
    requireEvidence(session !== undefined, `The beta left no row for conversation ${id}.`)
    const events = rows('events').filter((row) => row.session_id === id).length
    requireEvidence(events > 0, `The beta recorded no events for conversation ${id}.`)
    let ref = null
    try {
      ref = JSON.parse(session.external_ref)
    } catch {
      // No readable reference: refused just below.
    }
    requireEvidence(
      ref?.provider === 'codex' && typeof ref.sessionId === 'string' && ref.sessionId !== '',
      `Conversation ${id} names no Codex session of its own.`,
    )
    return { conversation: id, events, codexSession: ref.sessionId }
  })
}

export function transcriptsOf(history, files) {
  return Object.fromEntries(
    history.map(({ conversation, codexSession }) => {
      const own = files.filter((path) => path.endsWith(`-${codexSession}.jsonl`))
      requireEvidence(
        own.length === 1,
        `Conversation ${conversation} has ${String(own.length)} Codex transcripts, not one.`,
      )
      return [conversation, own[0]]
    }),
  )
}

export function contains(after, before) {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return false
    let next = 0
    for (const item of after) {
      if (next < before.length && contains(item, before[next])) next += 1
    }
    return next === before.length
  }
  if (before !== null && typeof before === 'object') {
    return (
      after !== null &&
      typeof after === 'object' &&
      !Array.isArray(after) &&
      Object.entries(before).every(([key, value]) => key in after && contains(after[key], value))
    )
  }
  return Object.is(after, before)
}

export function draftsKept(before, after) {
  const listOf = (book) => (Array.isArray(book?.drafts) ? book.drafts : null)
  const was = listOf(before)
  const is = listOf(after)
  if (was === null) return ['the beta’s file holds no list of drafts to compare']
  if (is === null) return ['it holds no list of drafts']
  const problems = []
  if (after.version !== before.version) problems.push('its format version changed')
  const slots = is.map((one) => one?.slot)
  for (const slot of new Set(slots)) {
    if (slots.filter((one) => one === slot).length > 1) {
      problems.push(`it holds two drafts for ${String(slot)}, and the app reads only the first`)
    }
  }
  for (const draft of was) {
    const now = is.find((one) => one?.slot === draft.slot)
    if (now === undefined) problems.push(`the draft for ${String(draft.slot)} is gone`)
    else if (
      now.text !== draft.text ||
      !isDeepStrictEqual(now.attached ?? [], draft.attached ?? [])
    ) {
      problems.push(`the draft for ${String(draft.slot)} changed`)
    }
  }
  return problems
}

function transcriptRetentionKept(before, after, bytes) {
  const periods = [30, 90, 365, 'forever']
  const problems = []
  if (!periods.includes(before?.period) || after?.period !== before.period)
    problems.push('its transcript retention choice changed')
  const number = (value) => Number.isSafeInteger(value) && value >= 0
  const cursor = after?.scanAfter === undefined ? '' : after.scanAfter
  if (
    bytes > 65536 ||
    !number(after?.checkedAt) ||
    typeof cursor !== 'string' ||
    cursor.length > 4096 ||
    cursor.startsWith('/') ||
    cursor.includes('\\') ||
    cursor.split('/').some((part) => part === '..' || part === '.')
  )
    problems.push('its transcript cleanup progress is invalid')
  if (
    !Array.isArray(after?.cleared) ||
    after.cleared.length > 100 ||
    after.cleared.some(
      (line) =>
        line === null ||
        typeof line !== 'object' ||
        Array.isArray(line) ||
        ![line.at, line.days, line.conversations, line.bytes].every(number) ||
        (line.stoppedEarly !== undefined && line.stoppedEarly !== true) ||
        (line.conversations === 0 && line.stoppedEarly !== true),
    )
  )
    problems.push('its transcript cleanup history is invalid')
  return problems
}

export const STATE_RULES = {
  'drafts.json': draftsKept,
  'transcript-retention.json': transcriptRetentionKept,
}

export function stateKept(before, after, names, rules = STATE_RULES) {
  const lost = []
  const rewritten = []
  const appeared = []
  for (const name of names) {
    const was = before[name]
    const is = after[name]
    if (was === undefined) {
      if (is !== undefined) appeared.push(name)
      continue
    }
    if (is === undefined) {
      lost.push(`${name}: it is gone`)
      continue
    }
    if (Buffer.from(was).equals(Buffer.from(is))) continue
    let problems = ['it no longer says what the beta wrote']
    try {
      const then = JSON.parse(Buffer.from(was).toString('utf8'))
      const now = JSON.parse(Buffer.from(is).toString('utf8'))
      const rule = rules[name]
      if (rule !== undefined) problems = rule(then, now, Buffer.from(is).length)
      else if (contains(now, then)) problems = []
    } catch {
      // Not JSON on one side: its bytes changed and nothing shows the content was kept.
    }
    if (problems.length === 0) rewritten.push(name)
    else lost.push(`${name}: ${problems.join('; ')}`)
  }
  return { lost, rewritten, appeared }
}

export function sessionsKept(history, tables) {
  const rows = Array.isArray(tables.provider_session) ? tables.provider_session : []
  return history.flatMap(({ conversation, codexSession }) => {
    const row = rows.find((one) => one.id === conversation)
    if (row === undefined) return [`${conversation}: its row is gone`]
    let ref = null
    try {
      ref = JSON.parse(row.external_ref)
    } catch {
      // No readable reference: reported just below.
    }
    return ref?.provider === 'codex' && ref.sessionId === codexSession
      ? []
      : [`${conversation}: its row no longer names the Codex session the beta recorded`]
  })
}

export function workspaceRegistrySnapshot(root, contract, read) {
  requireEvidence(
    contract === 'packaged' || contract === 'legacy',
    'The workspace registry contract must be packaged or legacy.',
  )
  const basename = contract === 'packaged' ? 'packaged-workspaces.json' : 'workspaces.json'
  const path = join(root, basename)
  let value
  try {
    value = read(path) ?? null
  } catch {
    value = { unreadable: true }
  }
  return { contract, basename, path, value }
}

export function workspaceRegistryBaseline(snapshot, workspace) {
  const book = snapshot?.value
  if (book === null || typeof book !== 'object' || book?.unreadable) {
    return ['the selected workspace registry is missing or unreadable']
  }
  if (book.version !== 1 || !Array.isArray(book.workspaces)) {
    return ['the selected workspace registry has an unsupported format']
  }
  if (book.workspaces.length === 0) return ['the selected workspace registry lists no workspaces']
  if (
    book.workspaces.some(
      (row) =>
        row === null ||
        typeof row !== 'object' ||
        typeof row.path !== 'string' ||
        row.path === '' ||
        !Number.isFinite(row.lastOpenedAt),
    )
  ) {
    return ['the selected workspace registry has an invalid row']
  }
  if (!book.workspaces.some((row) => row.path === workspace)) {
    return ['the selected workspace registry does not list this workspace']
  }
  return registryKept(book, book)
}

export function registryKept(before, after) {
  const rowsOf = (book) => (Array.isArray(book?.workspaces) ? book.workspaces : null)
  const was = rowsOf(before)
  const is = rowsOf(after)
  if (was === null) return ['the beta left no list of workspaces']
  if (is === null) return ['the list of workspaces is gone or unreadable']
  const lost = []
  if (after.version !== before.version) lost.push('its format version changed')
  for (const row of was) {
    if (is.filter((one) => one.path === row.path).length > 1) {
      lost.push(`${String(row.path)}: listed more than once`)
    }
    const now = is.find((one) => one.path === row.path)
    if (now === undefined) {
      lost.push(`${String(row.path)}: no longer listed`)
      continue
    }
    const { lastOpenedAt: openedBefore, ...rest } = row
    const { lastOpenedAt: openedNow, ...restNow } = now
    if (!contains(restNow, rest)) lost.push(`${String(row.path)}: its row changed`)
    if (!(Number(openedNow) >= Number(openedBefore))) {
      lost.push(`${String(row.path)}: its last opening moved backwards`)
    }
  }
  return lost
}

export const APP_NAMES_BEFORE = ['@brobot2/desktop']

export function keychainEntryFor(appName) {
  return { service: `${appName} Safe Storage`, account: `${appName} Key` }
}

export function keychainAttributes(printed) {
  const blob = (name) =>
    new RegExp(`^\\s*"${name}"<blob>="(.*)"\\s*$`, 'm').exec(printed)?.[1] ?? null
  const date = (name) =>
    new RegExp(`^\\s*"${name}"<timedate>=.*"(\\d{14}Z)`, 'm').exec(printed)?.[1] ?? null
  const service = blob('svce')
  const account = blob('acct')
  if (service === null || account === null) return null
  return { service, account, created: date('cdat'), modified: date('mdat') }
}

const SAVED_KEY_UNREADABLE = 'Saved key can’t be read, save it again in Settings.'

export function turnOutcome(turn, keyStatus) {
  const posts = turn.requests.filter((one) => one.method === 'POST')
  if (posts.some((one) => one.auth !== 'expected')) {
    return { outcome: 'asked-the-model-without-the-key', ok: false }
  }
  if (turn.refused === null) {
    if (turn.answer === null) return { outcome: 'not-answered', ok: false }
    return posts.length > 0
      ? { outcome: 'answered', ok: true }
      : { outcome: 'answered-without-asking-the-model', ok: false }
  }
  const cantBeRead =
    turn.refusedAt === 'start' &&
    posts.length === 0 &&
    turn.refusedAfterMs < 60_000 &&
    turn.refused.includes(SAVED_KEY_UNREADABLE) &&
    keyStatus?.set === true &&
    keyStatus.inUse === false &&
    keyStatus.readState === 'unreadable'
  return cantBeRead
    ? { outcome: 'the-saved-key-cannot-be-read', ok: true }
    : { outcome: 'refused', ok: false }
}

export function whatRunsIsSaid(read, provider = 'codex') {
  const said = read?.resources?.[provider] ?? null
  if (said === null || !Number.isInteger(said.running)) return { outcome: 'not-read', ok: false }
  if (said.running === 0) return { outcome: 'nothing-was-running', ok: true }
  if (typeof said.rssBytes !== 'number') return { outcome: 'no-figure', ok: false }
  const cards = read.memory ?? null
  const figures = Array.isArray(cards?.conversations) ? cards.conversations : []
  const drawn =
    said.rssBytes > 0 &&
    cards?.unmeasured === undefined &&
    figures.length > 0 &&
    figures.every((one) => one.bytes > 0)
  return { outcome: drawn ? 'measured' : 'measured-on-one-and-not-the-other', ok: drawn }
}

export const LAUNCH_SETUP_PROVIDERS = [
  { provider: 'claude', name: 'Claude' },
  { provider: 'codex', name: 'Codex' },
]

export const A_STANDING_STOPS_SETUP = {
  tested: false,
  'newer-than-tested': false,
  'older-than-tested': true,
  missing: true,
  unreadable: true,
}

export function providerReady({ version, setup, auth, keyRefused, keyUnreadable }) {
  const program = version?.program
  if (setup !== null && program?.from !== 'carried') {
    if (version === null || version === undefined) return null
    if (program === undefined) return false
    if (A_STANDING_STOPS_SETUP[program.standing] === true) return false
  }
  if (auth === null || auth === undefined) return null
  if (keyUnreadable === true) return false
  if (auth.state !== 'usable') return false
  return !(auth.login === 'api-key' && keyRefused === true)
}

export function launchSetupExpected(facts) {
  const ready = facts.map((one) => ({ provider: one.provider, ready: providerReady(one) }))
  if (facts.some((one) => one.auth?.state === 'unknown')) {
    return { opensProviders: false, ready, undecided: false }
  }
  if (ready.some((one) => one.ready === null)) {
    return { opensProviders: false, ready, undecided: true }
  }
  return { opensProviders: ready.every((one) => one.ready === false), ready, undecided: false }
}

export function lastResortStop(log) {
  const said = /asked Electron to exit (\d+)ms ago and is still running/.exec(log)
  return said === null ? null : Number(said[1])
}

export const NOTHING_RAN_LIMIT =
  'no agent’s process was running when the window was asked what runs, so this run does not show what the app says of a running agent’s memory'

export function resultLine({ failures, knownLimits }) {
  if (failures.length > 0) return `failed: ${String(failures.length)} check(s) did not hold`
  return knownLimits.length === 0
    ? 'passed'
    : `passed with a known limit: ${knownLimits.join('; ')}`
}

function launchSetupSaid({ opensProviders }) {
  return opensProviders ? 'Settings → Providers, as no provider is ready' : 'nothing opened'
}

export function jobSummary(summary) {
  const held = summary.checks.filter((one) => one.ok).length
  const lines = [
    `### Upgrade path · ${summary.os} · ${summary.betaTag} → ${summary.candidateVersion} (${String(summary.sourceSha).slice(0, 9)})`,
    '',
    `**${summary.result[0].toUpperCase()}${summary.result.slice(1)}.**`,
    '',
    `- Checks: ${String(held)} held, ${String(summary.checks.length - held)} did not.`,
  ]
  if (summary.candidateSkills !== undefined) {
    lines.push(
      `- Verified candidate built-in skills: ${summary.candidateSkills.names.join(', ') || 'none'}.`,
    )
  }
  if (summary.savedKeyAfterTheUpgrade !== undefined) {
    lines.push(`- The saved key after the upgrade: ${summary.savedKeyAfterTheUpgrade}`)
  }
  const leftByTheBeta = summary.baseline?.copies
  if (leftByTheBeta !== undefined) {
    const versions = [
      ...new Set(leftByTheBeta.map((one) => one.madeBy?.appVersion ?? 'no version named')),
    ]
    lines.push(
      `- Recovery copies the beta left: ${leftByTheBeta.length === 0 ? 'none' : `${String(leftByTheBeta.length)}, made by ${versions.join(', ')}`}.`,
    )
  }
  if (summary.checkpoint !== undefined) {
    lines.push(
      `- Recovery copy: ${summary.checkpoint.id} (${summary.checkpoint.reason}), made by ${summary.checkpoint.madeBy.appVersion}.`,
    )
  }
  const setup = [
    ['first start', summary.firstStart?.launchSetup],
    ['second start', summary.secondStart?.launchSetup],
  ].flatMap(([start, one]) => (one === undefined ? [] : [`${start}, ${launchSetupSaid(one)}`]))
  if (setup.length > 0) lines.push(`- The app's setup at launch: ${setup.join('; ')}.`)
  for (const failure of summary.failures) lines.push(`- Did not hold: ${failure}`)
  lines.push('', 'Not shown by this check:', ...summary.outsideThisCheck.map((one) => `- ${one}`))
  return `${lines.join('\n')}\n`
}

export function credentialSeen(header, key) {
  if (typeof header !== 'string' || header.trim() === '') return 'missing'
  return header === `Bearer ${key}` ? 'expected' : 'other'
}

export async function recoveryCopies(workspace, { digestFiles = true, digestFile } = {}) {
  const backups = join(workspace, 'backups')
  if (!existsSync(backups)) return []
  const records = []
  const folders = readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const folder of folders) {
    const inside = join(backups, folder)
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(join(inside, 'manifest.json'), 'utf8'))
    } catch {
      /* An unfinished copy has no readable manifest. */
    }
    let digest = null
    if (digestFiles) {
      try {
        const hashes = []
        const names = readdirSync(inside, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() || (entry.isDirectory() && SKILL_TREE_NAMES.includes(entry.name)),
          )
          .map((entry) => entry.name)
          .sort()
        for (const name of names) {
          const path = join(inside, name)
          const hash = SKILL_TREE_NAMES.includes(name)
            ? sha256(readStateEntry(path))
            : await digestFile(path)
          hashes.push(`${name} ${hash}`)
        }
        digest = sha256(hashes.join('\n'))
      } catch {
        /* An unreadable copy remains changed in the comparison. */
      }
    }
    records.push({ folder, manifest, digest })
  }
  return records
}

export function copiesSince(before, after, version) {
  const versionOn = ({ manifest }) => {
    const version = manifest?.madeBy?.appVersion
    return typeof version === 'string' && version !== '' ? version : null
  }
  const folder = (copy) => copy.folder
  const was = new Map(before.map((copy) => [copy.folder, copy]))
  const is = new Map(after.map((copy) => [copy.folder, copy]))
  const added = after.filter((copy) => !was.has(copy.folder))
  const since = {
    made: added.filter((copy) => versionOn(copy) === version).map(folder),
    others: added
      .filter((copy) => versionOn(copy) !== null && versionOn(copy) !== version)
      .map(folder),
    unread: added.filter((copy) => versionOn(copy) === null).map(folder),
    gone: before.filter((copy) => !is.has(copy.folder)).map(folder),
    changed: before
      .filter((copy) => is.has(copy.folder))
      .filter((copy) => {
        const now = is.get(copy.folder).digest
        return typeof now !== 'string' || now !== copy.digest
      })
      .map(folder),
  }
  return { ...since, same: Object.values(since).every((folders) => folders.length === 0) }
}

export function verifyCheckpoint(manifest, files, expected) {
  requireEvidence(
    manifest?.format === 'brobot-checkpoint' && manifest.version === 1 && UUID.test(manifest.id),
    'The copy has no valid identity or format.',
  )
  requireEvidence(
    manifest.id === expected.folder,
    `The copy in folder ${String(expected.folder)} says it is ${manifest.id}.`,
  )
  requireEvidence(
    UUID.test(manifest.workspaceId ?? '') && manifest.workspaceId === expected.workspaceId,
    `The copy is for workspace ${String(manifest.workspaceId)}, not this one (${String(expected.workspaceId)}).`,
  )
  requireEvidence(
    manifest.reason === expected.reason && !Number.isNaN(Date.parse(manifest.createdAt)),
    `The copy's reason is ${String(manifest.reason)}, not ${expected.reason}.`,
  )
  requireEvidence(
    manifest.madeBy?.appVersion === expected.version && manifest.madeBy?.build === expected.build,
    `The copy was made by ${JSON.stringify(manifest.madeBy)}, not the candidate.`,
  )
  requireEvidence(manifest.database?.file === 'database.sqlite', 'The copy names another database.')
  const bytesMatch = (name, entry) => {
    const bytes = files[name]
    if (SKILL_TREE_NAMES.includes(name)) {
      requireEvidence(bytes !== undefined, `The copy does not hold ${name}.`)
      const tree = skillTreeStateDigest(bytes)
      requireEvidence(
        tree.bytes === entry.bytes && tree.sha256 === entry.sha256,
        `The copy changed ${name}.`,
      )
      return
    }
    requireEvidence(
      bytes !== undefined && bytes.length === entry.bytes && sha256(bytes) === entry.sha256,
      `The copy's ${name} is not the one its manifest describes.`,
    )
  }
  if (expected.databaseDigest) {
    requireEvidence(
      /^[0-9a-f]{64}$/.test(expected.databaseDigest.sha256) &&
        expected.databaseDigest.bytes === manifest.database.bytes &&
        expected.databaseDigest.sha256 === manifest.database.sha256,
      'The streamed database identity does not match the completed manifest.',
    )
  } else bytesMatch('database.sqlite', manifest.database)
  requireEvidence(
    isDeepStrictEqual(manifest.database.migrations, expected.lineage),
    "The copy's migration lineage is not the beta's.",
  )
  const listed = (manifest.files ?? []).map((one) => one.name)
  requireEvidence(
    isDeepStrictEqual([...listed].sort(), [...expected.stateFiles].sort()),
    `The copy lists ${listed.join(', ')}; the candidate's registry is ${expected.stateFiles.join(', ')}.`,
  )
  for (const file of manifest.files) {
    const baseline = expected.state[file.name]
    requireEvidence(
      (baseline !== undefined) === file.present,
      `The copy says ${file.name} was ${file.present ? 'present' : 'absent'}; the beta left it ${baseline === undefined ? 'absent' : 'present'}.`,
    )
    if (file.present) {
      bytesMatch(file.name, file)
      requireEvidence(
        Buffer.from(baseline).equals(Buffer.from(files[file.name])),
        `The copy changed ${file.name}.`,
      )
    } else {
      requireEvidence(files[file.name] === undefined, `The copy holds ${file.name}, listed absent.`)
    }
  }
  return {
    id: manifest.id,
    workspaceId: manifest.workspaceId,
    reason: manifest.reason,
    madeBy: manifest.madeBy,
  }
}

export function skillsKept(before, after, candidateSkills) {
  const failures = []
  for (const table of SKILL_CATALOGUE_TABLES)
    if (!Array.isArray(after[table])) failures.push(`${table} is missing`)
  if (failures.length) return failures
  const kept = rowsPreserved(
    Object.fromEntries(SKILL_CATALOGUE_TABLES.map((name) => [name, before[name] ?? []])),
    after,
    {},
    { skill_current: ['id'], skill_version: ['id'] },
  )
  for (const lost of kept.lost) {
    if (lost.table !== 'skill_current' && lost.table !== 'skill_catalogue_state')
      failures.push(`${lost.table} lost or changed a row`)
  }
  const versions = new Map(after.skill_version.map((row) => [row.id, row]))
  const aliases = new Set()
  for (const head of after.skill_current) {
    const version = versions.get(head.current_version)
    if (!version || version.skill_id !== head.id) {
      failures.push('a skill head has no matching version')
      continue
    }
    if (aliases.has(head.alias)) failures.push('a skill alias is duplicated')
    aliases.add(head.alias)
    let meta
    try {
      meta = JSON.parse(version.metadata)
    } catch {
      failures.push('skill metadata is unreadable')
      continue
    }
    if (
      typeof version.body !== 'string' ||
      meta.alias !== head.alias ||
      sha256(Buffer.from(version.body, 'utf8')) !== version.sha256 ||
      Buffer.byteLength(version.body, 'utf8') !== version.bytes ||
      meta.sha256 !== version.sha256 ||
      meta.bytes !== version.bytes
    )
      failures.push('a skill version does not match its bytes')
    if (
      head.id.startsWith('built-in/') &&
      (meta.origin?.kind !== 'built-in' ||
        head.id !== `built-in/${meta.name}` ||
        head.alias !== meta.name)
    )
      failures.push('a built-in head changed origin')
  }
  for (const old of before.skill_current ?? []) {
    const now = after.skill_current.find((row) => row.id === old.id)
    if (
      !now ||
      (now.active !== old.active
        ? !skillAvailabilityMatches(old, now, before, after, candidateSkills)
        : canonicalRow(now, ['current_version']) !== canonicalRow(old, ['current_version']))
    ) {
      failures.push('an existing skill head changed')
      continue
    }
    if (now.current_version !== old.current_version && !old.id.startsWith('built-in/'))
      failures.push('an upgrade changed a personal or plugin version')
  }
  const was = before.skill_catalogue_state ?? []
  const now = after.skill_catalogue_state
  const moved = after.skill_current.some((head) => {
    const old = (before.skill_current ?? []).find((row) => row.id === head.id)
    return old?.current_version !== head.current_version || old?.active !== head.active
  })
  if (moved && (!now[0] || now[0].revision <= (was[0]?.revision ?? 0)))
    failures.push('a changed catalogue did not advance its revision')
  if (now.length > 1 || (was.length && now.length !== 1))
    failures.push('the catalogue revision row disappeared')
  if (
    now.some(
      (row) =>
        row.id !== 1 ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 0 ||
        (was[0] && row.revision < was[0].revision),
    )
  )
    failures.push('the catalogue revision went backwards')
  return failures
}

export function pluginOwnerQuiescence(value) {
  if (value === null) return 'not-exercised'
  return value?.version === 1 &&
    typeof value.epoch === 'string' &&
    UUID.test(value.epoch) &&
    value.phase === 'stopped'
    ? 'stopped'
    : 'not-stopped'
}

async function collectRecoveryProofCases({ result, cases, phase, closed, check, state }) {
  const steps = [
    ['compatible', 'proof compatible candidate', () => true],
    ['compatible019', 'proof actual019 compatible', () => Boolean(result.compatible.copy)],
    [
      'syntheticFuture',
      'proof synthetic future actual019 Restore Return',
      () => result.compatible.actual019ThenCandidate === true,
    ],
    ['synchronous', 'proof synchronous real earlier prefix', () => true],
  ]
  result.cases = []
  for (const [name, stage, ready] of steps) {
    let skip = null
    try {
      if (!closed()) skip = 'An owned proof process has not been verified stopped.'
      else if (!ready())
        skip = 'The preceding compatible data/copy prerequisites were not verified.'
      else if (
        ['compatible019', 'syntheticFuture'].includes(name) &&
        stateKept(state.state, state.readState(), state.stateFiles).lost.length
      )
        skip = 'Coupled state no longer satisfies the compatible fixture prerequisites.'
    } catch (error) {
      skip = `Prerequisites could not be verified: ${error.message}`
    }
    const outcome = { name }
    result.cases.push(outcome)
    if (skip) {
      outcome.skipped = skip
      check(false, `${stage}: skipped`, { reason: skip })
      continue
    }
    await phase(stage, async () => {
      await cases[name]()
      outcome.completed = true
    })
    if (name === 'compatible')
      check(
        Boolean(result.compatible.order),
        'Ordinary DOM and valid copy completion were not verified.',
      )
    if (name === 'compatible019')
      check(result.compatible.actual019ThenCandidate === true, 'Compatible binary reads failed.')
    if (name === 'syntheticFuture')
      check(
        result.syntheticFuture.actual019RestoreReturn === true,
        'Actual019 Restore/Return failed.',
      )
    outcome.closed = closed()
    check(outcome.closed, `${stage}: owned proof processes are stopped`)
  }
}

export function recoveryProofSequence({ launch, currentPid, alive, phase, check }) {
  const pids = new Set()
  const closed = () => [...pids].every((pid) => !alive(pid))
  return {
    closed,
    launch: async (...args) => {
      requireEvidence(closed(), 'A preceding owned proof process is still running.')
      try {
        return await launch(...args)
      } finally {
        if (currentPid()) pids.add(currentPid())
      }
    },
    collect: (result, cases, state) =>
      collectRecoveryProofCases({
        result,
        cases,
        phase,
        check,
        closed,
        state,
      }),
  }
}
