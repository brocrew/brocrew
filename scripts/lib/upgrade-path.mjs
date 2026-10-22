// The pure half of the upgrade-path check (`scripts/upgrade-path.mjs`): the lines a start prints,
// which release asset is a beta's installer, the names each build goes by, the migrations and
// state files a build carries, and the comparisons of a data folder before and after the candidate
// opens it. No file is read and no process started here, so every rule can be tried on planted
// inputs.
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { SKILL_CATALOGUE_TABLES } from '../../apps/desktop/src/main/db/skill-catalogue-tables.ts'
import { SKILL_TREE_NAMES, skillTreeStateDigest } from './skill-tree-state.mjs'

// The lines a start prints, as the candidate's own source spells them: the lane reads them only in
// the candidate's logs, and runs from the candidate's commit.
import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  READY_LINE,
  OPENED_FOR_RECOVERY_LINE as RECOVERY_ONLY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'

export { CHECKPOINT_LINE, FAIL_LINE, READY_LINE, RECOVERY_ONLY_LINE }

/**
 * The columns a start may move on a conversation it finds closed: the app's own bookkeeping of
 * its state, never its history.
 */
export const MAY_MOVE_AT_A_START = {
  provider_session: ['status', 'updated_at', 'closed_by_the_quit_at'],
  // Built-in text updates move only these pointers; skillsKept checks their targets and preserves personal/plugin heads.
  skill_current: ['current_version'],
  skill_catalogue_state: ['revision'],
}

/**
 * Tables a later migration drops on purpose: the beta's rows in them are not kept, and the
 * candidate must have no such table at all. `raw_frame` was a copy of each provider's own file.
 */
export const RETIRED_TABLES = ['raw_frame']

/** The beta's tables a candidate is held to: every one but those a migration retires. */
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

/** Whether the old build is the requested published release. */
export function isPublishedRelease(release, tag) {
  return release.tag_name === tag && release.draft === false
}

/**
 * The one asset of a release that is its installer for `os`, as the beta workflows name them, with
 * the SHA-256 the release itself publishes for it. An asset with no published digest is refused:
 * its size alone would not tell a substituted file from the released one.
 */
export function betaAsset(assets, os) {
  // Under whatever name the beta was built: its installer is the one of that shape.
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

/** A product name the lane can put in a path, a PowerShell string and a pattern as it is. */
const A_PRODUCT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/

/**
 * The app id and the product name a build is packaged under, from its `electron-builder.yml`:
 * the id finds its install, and the name is what its program and bundle are called.
 */
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

/**
 * The key a Windows install of `appId` is kept under in the registry, as electron-builder makes it:
 * a version-5 UUID of the app id in electron-builder's own namespace. The product name plays no
 * part, so a build under a new name finds and replaces one under the old.
 */
export function installerGuid(appId) {
  const namespace = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')
  const hash = createHash('sha1').update(namespace).update(appId, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The installer a candidate build made for `version`, among the files of its output folder, under
 * whatever name it was built: exactly one, or the build is not what the lane expects.
 */
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

/**
 * The app's own program in a Windows install folder, by the files at its top: the one `.exe` that
 * is not the uninstaller. Its name is the product name the build was made under.
 */
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

/** The app in a Mac disk image, by what its window holds: the one `.app`. */
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

/**
 * The migrations a build carries, as a database records them once applied: when each was written
 * (its journal's `when`) and the SHA-256 of its whole SQL text. A build made from a checkout with
 * the other line endings recorded the hash of that text, so each entry carries both.
 */
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

/**
 * Whether the migrations a database records are a build's first ones, by the rule the app's own
 * start uses: the same time, and the hash of the build's file with either line ending.
 */
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

/** With which line endings each recorded migration's file was hashed, for a reader of the run. */
export function recordedWith(recorded, built) {
  return recorded.map((one, index) => {
    const file = built[index]
    if (file === undefined || one.createdAt !== file.createdAt) return 'not this build’s'
    if (file.lf === file.crlf) return one.hash === file.lf ? 'either' : 'not this build’s'
    return one.hash === file.lf ? 'LF' : one.hash === file.crlf ? 'CRLF' : 'not this build’s'
  })
}

/** A database's own record of its migrations, in the same shape. */
export function recordedLineage(rows) {
  return rows.map((row) => ({ createdAt: Number(row.created_at), hash: row.hash }))
}

/** The state files a build's recovery copies carry, read from its `recovery/state-files.ts`. */
export function stateFileNames(source) {
  const from = source.indexOf('export const APP_STATE_FILES')
  const to = source.indexOf('export const NOT_STATE', from)
  requireEvidence(from !== -1 && to > from, 'The state-file registry was not found.')
  const names = [...source.slice(from, to).matchAll(/name: '([^']+)'/g)].map((one) => one[1])
  requireEvidence(names.length > 0, 'The state-file registry names no file.')
  return names
}

/**
 * What a start's whole log says, in order: exactly one READY, no failure, no recovery-only start,
 * and a checked copy before READY when one is expected and none otherwise.
 */
export function startOrder(log, { checkpoint }) {
  const lines = log.split(/\r?\n/).map((line) => line.trimEnd())
  requireEvidence(!lines.includes(FAIL_LINE), `The start failed: ${failureOf(lines)}`)
  requireEvidence(!lines.includes(RECOVERY_ONLY_LINE), 'The start opened only its recovery window.')
  const ready = lines.flatMap((line, index) => (line === READY_LINE ? [index] : []))
  const copies = lines.flatMap((line, index) => (line === CHECKPOINT_LINE ? [index] : []))
  requireEvidence(
    ready.length === 1,
    `Exactly one READY line is required; found ${String(ready.length)}.`,
  )
  requireEvidence(
    checkpoint ? copies.length === 1 && copies[0] < ready[0] : copies.length === 0,
    checkpoint
      ? `Exactly one checked-copy line must come before READY; found ${String(copies.length)}.`
      : 'A start of the same version made another recovery copy.',
  )
  return { ready: ready[0], checkedCopy: copies[0] ?? null }
}

function failureOf(lines) {
  const at = lines.indexOf(FAIL_LINE)
  return lines[at + 1] ?? 'no reason followed'
}

/** One value as it compares: a BLOB by its bytes, a number however SQLite handed it. */
function comparable(value) {
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString('base64') }
  if (typeof value === 'bigint') return { integer: value.toString() }
  return value
}

/** A row as it compares, without the columns `ignored` names. */
export function canonicalRow(row, ignored = []) {
  return JSON.stringify(
    Object.keys(row)
      .filter((column) => !ignored.includes(column))
      .sort()
      .map((column) => [column, comparable(row[column])]),
  )
}

// Only a verified installed bundle can authorize an availability change.
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

/** Verify the candidate's manifest and body bytes before using its shipped membership. */
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
  // Names and count come from the candidate, while each entry keeps the app's strict format.
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
  // A built-in-looking id alone is not evidence of a built-in origin.
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

/**
 * Whether every row the beta left is still in the candidate's database, whole: each table's rows
 * as a multiset, every column but the few a start may move. Rows the candidate added are counted,
 * not refused: they are evidence for a reader. A table that went is a loss. Each lost row says
 * whether its key is gone or which of its columns changed, where `keys` names the table's key.
 */
export function rowsPreserved(
  before,
  after,
  mayMove = MAY_MOVE_AT_A_START,
  keys = {},
  candidateSkills,
) {
  const lost = []
  const added = {}
  for (const [table, rows] of Object.entries(before)) {
    const now = after[table]
    if (!Array.isArray(now)) {
      lost.push({ table, gone: 'the table' })
      continue
    }
    const ignored = mayMove[table] ?? []
    const left = new Map()
    for (const row of now) {
      const key = canonicalRow(row, ignored)
      left.set(key, (left.get(key) ?? 0) + 1)
    }
    const keyOf = (row) =>
      (keys[table] ?? []).length > 0
        ? JSON.stringify(keys[table].map((column) => comparable(row[column])))
        : null
    for (const row of rows) {
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
              changed: Object.keys(row).filter(
                (column) =>
                  !ignored.includes(column) &&
                  !isDeepStrictEqual(comparable(row[column]), comparable(counterpart[column])),
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

/**
 * The fictional history the beta must have made for the check to mean anything: each conversation
 * it created has its row and its own events, and names the Codex session its transcript is kept
 * under; and one Codex API key is saved, beside any other provider's.
 */
export function historyOf(tables, conversations) {
  const rows = (table) => (Array.isArray(tables[table]) ? tables[table] : [])
  requireEvidence(conversations.length >= 2, 'The beta made fewer than two conversations.')
  requireEvidence(
    rows('provider_api_key').filter((row) => row.provider === 'codex').length === 1,
    'The beta saved no Codex API key row.',
  )
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

/**
 * Each conversation's own Codex transcript among `files` (paths under the Codex home's sessions
 * folder): exactly one per Codex session, by the id its name ends with. Any other file is ignored.
 */
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

/**
 * Whether `after` holds everything `before` said: every key of an object with a value that holds
 * the old one, and every item of a list held by an item of the new list, in the same order and as
 * many times. A build may add to what an older one wrote; it may not drop, change or reorder it.
 */
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

/**
 * What is wrong with a drafts file against the one the beta left, as the app reads it: the first
 * draft of each slot is the one it restores. So each slot is there once, and each slot the beta
 * left still holds its words and its attached paths. A draft for a new slot is not a loss.
 */
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

/** Keep the person's choice while allowing valid cleanup progress and bounded recent history. */
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

/** The files compared by their own contract rather than by what they still contain. */
export const STATE_RULES = {
  'drafts.json': draftsKept,
  'transcript-retention.json': transcriptRetentionKept,
}

/**
 * What became of the state files the beta left. One that went, or that no longer says what the beta
 * wrote, is lost. One the candidate wrote again, still saying all of it, is listed as rewritten;
 * one that is new is listed as appeared. Neither of those is a loss.
 */
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

/**
 * Whether each conversation's row still names the Codex session the beta recorded for it: the
 * reference its next start resumes by. Its transcript being there is not enough if the row points
 * elsewhere.
 */
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

/**
 * Whether the computer's list of workspaces still holds every workspace the beta listed, each as
 * it was. Opening one moves its `lastOpenedAt` forward, and only that.
 */
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

/** The names the app has had before the one it has now: each named the Keychain entry of its day. */
export const APP_NAMES_BEFORE = ['@brobot2/desktop']

/**
 * The macOS Keychain entry Electron seals saved keys with, for an app of that name: its service,
 * and its account, which is the name with " Key" after it. Electron hands Chromium the bare name,
 * and its own patch to Chromium's Keychain code adds " Key" (" App Store Key" in a Mac App Store
 * build) when it looks the entry up or makes it.
 */
export function keychainEntryFor(appName) {
  return { service: `${appName} Safe Storage`, account: `${appName} Key` }
}

/**
 * One Keychain entry's attributes, from what `security find-generic-password -s <service>` prints
 * when it is asked for no password: its service, its account, and when it was made and last
 * changed. null when what it printed is not one entry's attributes.
 */
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

/**
 * What became of a turn on the saved key after the upgrade, and whether that passes on `os`.
 *
 * Answered by the model, every request on the fixture key, passes anywhere. A request that reached
 * the model with another key, or none, fails whatever else happened.
 *
 * On a Mac one more outcome passes: macOS did not hand the saved key over, with nobody to ask. It
 * is told from any other failure by all of these together: the START was refused (not the
 * message), the model was never asked, the app's words are its own for a saved key it cannot read,
 * said within a minute, and afterwards the app's status of the key (`keyStatus`) is saved, not in
 * use and unreadable. A wrong key, a failed send or a provider's error is none of that.
 */
export function turnOutcome(turn, os, keyStatus) {
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
  const notHandedOver =
    turn.refusedAt === 'start' &&
    posts.length === 0 &&
    turn.refusedAfterMs < 60_000 &&
    /can[’']t read the API key saved for/i.test(turn.refused) &&
    keyStatus?.set === true &&
    keyStatus.inUse === false &&
    keyStatus.readState === 'unreadable'
  return {
    outcome: notHandedOver ? 'the-saved-key-was-not-handed-over' : 'refused',
    ok: os === 'mac' && notHandedOver,
  }
}

/**
 * What the candidate says of the agent processes it runs, as its window reads it, and whether that
 * passes. `read` is the two answers of its bridge at one moment: `resources` (`providerResources`,
 * what Providers draws under "Running now") and `memory` (`processMemory`, what the agents' cards
 * draw).
 *
 * With no agent of `provider` running there is nothing to measure, which is said and passes. A
 * running one has a figure in both answers, on either system: both list their processes. No figure
 * fails, whatever reason is given for it.
 */
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

/**
 * The providers the app's setup at launch asks about, in the order it opens for them, each with the
 * name its window says. The app's own list is `PROVIDER_NAME` (`shared/runtime-ipc.ts`).
 */
export const LAUNCH_SETUP_PROVIDERS = [
  { provider: 'claude', name: 'Claude' },
  { provider: 'codex', name: 'Codex' },
]

/** Where the window remembers that a person closed the setup at launch: `'true'` once they did. */
export const LAUNCH_SETUP_DISMISSED_KEY = 'brobot2.providerSetupDismissed'

/** The standings of a provider's program that stop its setup: the app's `A_STANDING_WARNS`. */
export const A_STANDING_STOPS_SETUP = {
  tested: false,
  'newer-than-tested': false,
  'older-than-tested': true,
  missing: true,
  unreadable: true,
}

/**
 * Whether a provider is ready, by the app's own rule for its setup (`isReady`,
 * `renderer/src/lib/provider-setup-steps.ts`), from what the window reads: the program's version
 * and standing, what there is to install, the sign-in, and whether a saved key was refused. `null`
 * while a fact the rule needs has not been read.
 *
 * A program the app carries, or a provider with nothing to set up outside the app (`setup` null),
 * has no install to pass: only its sign-in counts.
 */
export function providerReady({ version, setup, auth, keyRefused }) {
  const program = version?.program
  if (setup !== null && program?.from !== 'carried') {
    if (version === null || version === undefined) return null
    if (program === undefined) return false
    if (A_STANDING_STOPS_SETUP[program.standing] === true) return false
  }
  if (auth === null || auth === undefined) return null
  if (auth.state !== 'usable') return false
  return !(auth.login === 'api-key' && keyRefused === true)
}

/**
 * Which provider's setup the app opens by itself at a start, from `facts` (one per provider, in
 * {@link LAUNCH_SETUP_PROVIDERS}' order): none once a person closed it (`dismissed`), else the first
 * provider that is not ready. `undecided` when a fact is missing: the app opens nothing until every
 * provider's readiness is known.
 */
export function launchSetupExpected(dismissed, facts) {
  const ready = facts.map((one) => ({ provider: one.provider, ready: providerReady(one) }))
  if (dismissed) return { opens: null, ready, undecided: false }
  if (ready.some((one) => one.ready === null)) return { opens: null, ready, undecided: true }
  const first = ready.find((one) => one.ready === false)
  return {
    opens:
      first === undefined
        ? null
        : (LAUNCH_SETUP_PROVIDERS.find((one) => one.provider === first.provider) ?? null),
    ready,
    undecided: false,
  }
}

/**
 * Whether the app's own dialogs at a start are exactly what is due: the setup for `opens` and
 * nothing else, or none at all. A dialog is the setup for a provider when it is named for it and
 * holds that provider's setup.
 */
export function dialogsAreAsDue(open, opens) {
  if (opens === null) return open.length === 0
  return (
    open.length === 1 &&
    open[0].label === `Set up ${opens.name}` &&
    open[0].provider === opens.provider
  )
}

/**
 * How long after it asked Electron to exit the app stopped the process itself, from its own log;
 * null when the process left by itself. Its data is closed before it asks.
 */
export function lastResortStop(log) {
  const said = /asked Electron to exit (\d+)ms ago and is still running/.exec(log)
  return said === null ? null : Number(said[1])
}

/**
 * The limit a Mac run passes with when macOS handed the saved key to nobody: said wherever the
 * result is, so a green run is never read as the key working.
 */
export const SAVED_KEY_LIMIT =
  'after the upgrade macOS did not hand over the saved key (it asks a person first), and this run does not show the key working once they answer or enter it again'

/**
 * The limit a run passes with when no agent's process was alive at the moment its window was asked
 * what runs (`whatRunsIsSaid`): nothing was measured, and a green run does not say otherwise.
 */
export const NOTHING_RAN_LIMIT =
  'no agent’s process was running when the window was asked what runs, so this run does not show what the app says of a running agent’s memory'

/** The second limit such a Mac run passes with: how the app closed while macOS was asking. */
export const CLOSE_LIMIT =
  'with macOS still asking, each close ended by the app’s own last-resort stop of the process, after its data was closed'

/** A run's result in one line: failed, passed, or passed with each limit it passed with. */
export function resultLine({ failures, knownLimits }) {
  if (failures.length > 0) return `failed: ${String(failures.length)} check(s) did not hold`
  return knownLimits.length === 0
    ? 'passed'
    : `passed with a known limit: ${knownLimits.join('; ')}`
}

/** What was due of the app's setup at one start, in a few words. */
function launchSetupSaid({ due, dismissed }) {
  if (due !== null) return `due for ${due}, which is not ready on this computer`
  return dismissed ? 'none due: a person closed it before' : 'none due: every provider is ready'
}

/** A run as its job's summary shows it: the result first, then what it stands on. */
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

/** Whether a request to the model carried the fixture's key: `expected`, `missing` or `other`. */
export function credentialSeen(header, key) {
  if (typeof header !== 'string' || header.trim() === '') return 'missing'
  return header === `Bearer ${key}` ? 'expected' : 'other'
}

/**
 * What changed among the recovery copies between two readings of `backups/`. A copy is told from
 * another by the version its manifest says made it: a beta that makes recovery copies leaves its
 * own. Each reading lists every folder there: its name, its manifest (null when it has none to
 * read) and a digest of its files (null when they could not all be read).
 *
 * Of the folders new since `before`: `made` are the ones `version` made, `others` the ones another
 * version made, `unread` the ones that name no version. Of the folders that were there: `gone` are
 * no longer there, and `changed` no longer hold the same bytes or can no longer be read. `same`
 * says none of the five has anything in it.
 */
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

/**
 * The candidate's first recovery copy, checked against what the beta left: published in the
 * folder its manifest names, for this workspace, made by the candidate for the reason this start
 * has, with the beta's own migration lineage, and holding exactly the beta's database and state
 * files.
 */
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
  bytesMatch('database.sqlite', manifest.database)
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

/** Skill versions and choices survive an upgrade; only verified built-in pointers may advance. */
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
