// The update rehearsal's data: what A makes through its own window, what its data folder holds read
// from outside with the app closed, and whether B kept it and made its checked recovery copy first.
// Node built-ins only (Node 24's `node:sqlite`), and the app's own log lines.
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  OPENED_FOR_RECOVERY_LINE,
  READY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'
import {
  SCRIPTED_MODEL,
  saveRehearsalCodexKey,
  press,
  sleep,
  until,
} from './update-rehearsal-app.mjs'
import { STATE_FILES } from './update-rehearsal.mjs'
import { rehearsalStateKept } from './update-rehearsal-state.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The words A types into the launcher and leaves unsent: B must give them back. */
export const THE_DRAFT = 'An unsent draft the update must keep: résumé, “quotes” and 漢字.'

/** A conversation's rows, through the window, as the person's own view of it. */
const historyOf = (cdp, id) =>
  cdp.evaluate(
    `return await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(id)} }).catch((e) => ({ error: String(e) }))`,
  )
const typesIn = (history) => (history?.entries ?? []).map((entry) => String(entry.event?.type))

/** Wait for a conversation to show `count` answers from the model. */
const answered = (cdp, id, count, ms) =>
  until(
    async () =>
      typesIn(await historyOf(cdp, id)).filter((type) => type === 'assistant_message').length >=
      count,
    ms,
    1_000,
  )

/** Send a message in a conversation through the window's bridge; throws if it was refused. */
async function send(cdp, id, text) {
  const sent = await cdp.evaluate(
    `return await window.api.runtime.send({ sessionId: ${JSON.stringify(id)}, text: ${JSON.stringify(text)} }).then(() => 'sent').catch((e) => 'ERROR: ' + String(e))`,
  )
  if (sent !== 'sent') throw new Error(`the message was refused: ${String(sent)}`)
}

/** A Codex conversation, started through the window's bridge. */
export async function aConversation(cdp) {
  const created = await cdp.evaluate(
    `return await window.api.runtime.createSession({ provider: 'codex', model: ${JSON.stringify(SCRIPTED_MODEL)}, approvalMode: 'auto' }).catch((e) => 'ERROR: ' + String(e))`,
  )
  if (typeof created?.sessionId !== 'string' || created.sessionId.length === 0) {
    throw new Error(`no conversation: ${typeof created === 'string' ? created : 'no session id'}`)
  }
  if (created.provider !== 'codex' || created.settings?.model !== SCRIPTED_MODEL) {
    throw new Error('the conversation did not start on the configured local model')
  }
  return created.sessionId
}

/**
 * A makes its own data, through its window: a fake Codex key, an unsent draft typed into the launcher
 * as a person types it, and two conversations, each answered once by the scripted model. ⚑ The draft
 * is typed, not saved through the bridge: the window's own book is what it writes at quit.
 */
export async function makeData(cdp, { say }) {
  await saveRehearsalCodexKey(cdp)
  say('the fictional Codex key is saved and usable')
  const input = '[data-cy="prompt-input"]'
  if (
    !(await until(
      () => cdp.evaluate(`return document.querySelector('${input}') !== null`),
      60_000,
      500,
    ))
  ) {
    throw new Error('the launcher shows no message box to type a draft into')
  }
  await press(cdp, input)
  await cdp.send('Input.insertText', { text: THE_DRAFT })
  say('a draft is typed into the launcher, and left unsent')
  const conversations = []
  for (const words of [
    'The first conversation before the update',
    'The second one, with “quotes” and ü',
  ]) {
    const id = await aConversation(cdp)
    await send(cdp, id, words)
    if (!(await answered(cdp, id, 1, 180_000)))
      throw new Error(`the scripted model never answered ${id}`)
    conversations.push(id)
    say(`conversation ${id} was answered by the scripted model`)
  }
  // ⚑ The window saves a draft shortly after it changes; the quit hands its book over once more.
  await sleep(3_000)
  return { draft: { slot: 'new', text: THE_DRAFT }, conversations }
}

/**
 * What B shows of what A made, through its window, before anything is sent: each conversation's
 * rows, the draft, and no question the person must answer first.
 */
export async function whatBShows(cdp, made, rowsBefore) {
  const problems = []
  // ⚑ A question is a window or a dialog the person must answer before going on: the recovery
  // window, or a modal in the ordinary one. A menu or a picker that waits to be opened is neither.
  const windows = (await cdp.targets()).map((one) => String(one.url))
  if (windows.some((url) => url.endsWith('/recovery.html'))) {
    problems.push('the recovery window is open')
  }
  const asking = await cdp.evaluate(`
    return [...document.querySelectorAll('[aria-modal="true"], [role="alertdialog"], dialog[open]')]
      .filter((one) => one.getClientRects().length > 0)
      .map((one) => one.getAttribute('aria-label') ?? one.getAttribute('data-cy') ?? one.textContent.slice(0, 80))`)
  if (asking.length > 0)
    problems.push(`the window asks the person something: ${JSON.stringify(asking)}`)
  for (const id of made.conversations) {
    const history = await historyOf(cdp, id)
    if (history?.error) problems.push(`B cannot read ${id}: ${history.error}`)
    const rows = (history?.entries ?? []).map(
      (entry) => `${String(entry.ordinal)}:${String(entry.event?.type)}`,
    )
    const lost = (rowsBefore[id] ?? []).filter((row) => !rows.includes(row))
    if (lost.length > 0) problems.push(`${id} lost rows ${lost.join(', ')}`)
  }
  const drafts = await cdp.evaluate('return await window.api.savedDrafts()')
  const kept = (drafts?.drafts ?? []).some(
    (one) => one.slot === made.draft.slot && one.text === made.draft.text,
  )
  if (!kept) problems.push(`the draft is not kept: ${JSON.stringify(drafts)}`)
  return problems
}

/** Each conversation's rows as the window shows them: ordinal and type. */
export async function rowsShown(cdp, ids) {
  const rows = {}
  for (const id of ids) {
    rows[id] = ((await historyOf(cdp, id))?.entries ?? []).map(
      (entry) => `${String(entry.ordinal)}:${String(entry.event?.type)}`,
    )
  }
  return rows
}

/**
 * A conversation A made goes on in B: a message sent, and the scripted model's answer shown.
 * ⚑ The last step of a lane: on the Mac, B opens a key that A sealed, which the system may hold.
 */
export async function goesOn(cdp, id, ms = 180_000) {
  const before = typesIn(await historyOf(cdp, id)).filter(
    (type) => type === 'assistant_message',
  ).length
  const started = Date.now()
  await send(cdp, id, 'Still here after the update?')
  const done = await answered(cdp, id, before + 1, ms)
  return { answered: Boolean(done), seconds: Math.round((Date.now() - started) / 1000) }
}

/** Every file under `dir` whose name `test` accepts, by path. */
function filesUnder(dir, test) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path, test)
    return entry.isFile() && test(entry.name) ? [path] : []
  })
}

/** Every row of every table, as one string each (BLOBs in base64), by table. */
function rowsOf(database) {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
  const byTable = {}
  for (const table of tables) {
    byTable[table] = database
      .prepare(`SELECT * FROM "${table}"`)
      .all()
      .map((row) => {
        const plain = {}
        for (const [key, value] of Object.entries(row)) {
          plain[key] =
            value instanceof Uint8Array ? { base64: Buffer.from(value).toString('base64') } : value
        }
        return plain
      })
  }
  return byTable
}

/**
 * A database's rows, read from a copy so the live file and its sidecars are never opened in place: a
 * WAL database's read-only open still makes `-shm`, and a crash leaves rows in `-wal`.
 */
export function databaseRows(file) {
  const scratch = mkdtempSync(join(tmpdir(), 'brobot-rehearsal-db-'))
  try {
    const copy = join(scratch, 'copy.sqlite')
    copyFileSync(file, copy)
    for (const side of ['-wal', '-shm']) {
      if (existsSync(`${file}${side}`)) copyFileSync(`${file}${side}`, `${copy}${side}`)
    }
    const database = new DatabaseSync(copy)
    try {
      return rowsOf(database)
    } finally {
      database.close()
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * What a data folder holds, read with the app closed: every table's rows, every Codex transcript's
 * bytes, and the state files the recovery copy carries.
 */
export function dataOf(folder) {
  const tables = databaseRows(join(folder, 'brobot2.sqlite'))
  const transcripts = {}
  for (const file of filesUnder(join(folder, 'provider-homes'), (name) =>
    /^rollout-.*\.jsonl$/.test(name),
  )) {
    transcripts[relative(folder, file)] = readFileSync(file)
  }
  const state = {}
  for (const name of STATE_FILES) {
    const path = join(folder, name)
    state[name] = existsSync(path) ? readFileSync(path) : null
  }
  return {
    tables,
    transcripts,
    state,
    summary: {
      counts: Object.fromEntries(
        Object.entries(tables).map(([table, rows]) => [table, rows.length]),
      ),
      transcripts: Object.fromEntries(
        Object.entries(transcripts).map(([path, bytes]) => [
          path,
          { bytes: bytes.length, sha256: sha256(bytes) },
        ]),
      ),
      state: Object.fromEntries(
        Object.entries(state).map(([name, bytes]) => [
          name,
          bytes === null ? null : { bytes: bytes.length, sha256: sha256(bytes) },
        ]),
      ),
    },
  }
}

/** The columns a conversation's own row may change when it goes on: when, and how it stands. */
const A_CONVERSATION_MOVES = [
  'updated_at',
  'status',
  'closed_by_the_quit_at',
  'reported_model',
  'reported_effort',
]

/** The columns a row names a conversation by. */
const CONVERSATION_COLUMNS = [
  'session_id',
  'owner_session_id',
  'given_by_session_id',
  'added_by_session_id',
  'parent_session_id',
]
/** The conversations a row belongs to: those it names, and a conversation's own row. */
const conversationsOf = (table, row) => [
  ...(table === 'provider_session' ? [row.id] : []),
  ...CONVERSATION_COLUMNS.map((column) => row[column]).filter((id) => typeof id === 'string'),
]

const keyOf = (row) => JSON.stringify(row)
const without = (row, columns) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)))

/**
 * Every way `after` lost or changed what `before` held. ⛔ Strict: every row and every transcript
 * byte stays exactly as it was. Only the conversations in `goneOn` may grow — new rows of theirs,
 * transcript bytes after theirs, and their own row's time and standing — and new conversations may
 * add rows of their own: a new row is explained only when every conversation it names is one of
 * those. The work counter may move forward only as far as new work was made. Anything else is named.
 */
export function compareData(before, after, { goneOn = [] } = {}) {
  const problems = []
  const growing = new Set(goneOn)
  const known = new Set((before.tables.provider_session ?? []).map((row) => row.id))
  const mayGrow = (id) => growing.has(id) || !known.has(id)
  const added = {}
  const newWork = (after.tables.work ?? []).filter((row) => !known.has(row.owner_session_id)).length
  for (const [table, rows] of Object.entries(before.tables)) {
    const now = after.tables[table]
    if (now === undefined) {
      problems.push(`the table ${table} is gone`)
      continue
    }
    const remaining = new Map()
    for (const row of now) remaining.set(keyOf(row), (remaining.get(keyOf(row)) ?? 0) + 1)
    const take = (row) => {
      const count = remaining.get(keyOf(row)) ?? 0
      if (count === 0) return false
      remaining.set(keyOf(row), count - 1)
      return true
    }
    for (const row of rows) {
      if (take(row)) continue
      if (table === 'work_sequence') {
        const moved = now.find((one) => one.scope === row.scope)
        if (moved && moved.last > row.last && moved.last - row.last <= newWork) {
          take(moved)
          continue
        }
      }
      if (table === 'provider_session' && growing.has(row.id)) {
        const moved = now.find((one) => one.id === row.id)
        if (
          moved &&
          keyOf(without(moved, A_CONVERSATION_MOVES)) === keyOf(without(row, A_CONVERSATION_MOVES))
        ) {
          take(moved)
          continue
        }
      }
      problems.push(`${table}: a row A made is changed or gone (${keyOf(row).slice(0, 200)})`)
    }
    for (const [key, count] of remaining) {
      if (count === 0) continue
      const named = conversationsOf(table, JSON.parse(key))
      if (named.length > 0 && named.every(mayGrow)) {
        added[table] = (added[table] ?? 0) + count
        continue
      }
      problems.push(`${table}: ${String(count)} new row(s) nothing explains (${key.slice(0, 200)})`)
    }
  }
  for (const table of Object.keys(after.tables)) {
    if (!(table in before.tables)) problems.push(`a new table ${table}`)
  }
  const threadsGrowing = new Set(
    (after.tables.provider_session ?? [])
      .filter((row) => growing.has(row.id))
      .map((row) => {
        try {
          return JSON.parse(row.external_ref ?? 'null')?.sessionId
        } catch {
          return undefined
        }
      })
      .filter(Boolean),
  )
  for (const [path, bytes] of Object.entries(before.transcripts)) {
    const now = after.transcripts[path]
    if (now === undefined) {
      problems.push(`the transcript ${path} is gone`)
      continue
    }
    const grows = [...threadsGrowing].some((thread) => path.includes(thread))
    const same = grows ? now.subarray(0, bytes.length).equals(bytes) : now.equals(bytes)
    if (!same)
      problems.push(`the transcript ${path} ${grows ? 'changed before its end' : 'changed'}`)
  }
  for (const [name, bytes] of Object.entries(before.state)) {
    const now = after.state[name]
    if (name === 'drafts.json') {
      const drafts = (file) =>
        file === null ? [] : (JSON.parse(file.toString('utf8')).drafts ?? [])
      const kept = drafts(now).map((one) => `${one.slot}\n${one.text}`)
      for (const one of drafts(bytes)) {
        if (!kept.includes(`${one.slot}\n${one.text}`))
          problems.push(`the draft in ${one.slot} is gone`)
      }
      continue
    }
    if (!rehearsalStateKept(name, bytes, now)) {
      problems.push(`${name} ${bytes === null ? 'appeared' : now === null ? 'is gone' : 'changed'}`)
    }
  }
  return {
    problems,
    summary: {
      before: before.summary.counts,
      after: after.summary.counts,
      added,
      transcripts: Object.keys(before.transcripts).length,
    },
  }
}

/** The recovery copies in a data folder, each with its manifest, oldest first. */
export function checkpointsIn(folder) {
  const backups = join(folder, 'backups')
  if (!existsSync(backups)) return []
  return readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name))
    .map((entry) => {
      const dir = join(backups, entry.name)
      let manifest
      try {
        manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
      } catch {
        manifest = null
      }
      return {
        dir,
        id: entry.name,
        madeBy: manifest?.madeBy?.appVersion ?? null,
        reason: manifest?.reason ?? null,
        createdAt: manifest?.createdAt ?? null,
      }
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/**
 * Every way a recovery copy differs from what its manifest says: the folder is its id, the
 * workspace's, whole (no marker or sidecar left), the database the size and hash it names, in
 * rollback mode, intact, with the migrations it names, and each state file present as it says.
 */
export function verifyCheckpoint(copy) {
  const problems = []
  const backups = join(copy.dir, '..')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(copy.dir, 'manifest.json'), 'utf8'))
  } catch (error) {
    return { problems: [`its manifest cannot be read: ${error.message}`] }
  }
  if (manifest.format !== 'brobot-checkpoint' || manifest.version !== 1)
    problems.push('not a version 1 manifest')
  if (manifest.id !== copy.id)
    problems.push(`its manifest names ${String(manifest.id)}, not its folder`)
  const workspace = existsSync(join(backups, 'workspace-id'))
    ? readFileSync(join(backups, 'workspace-id'), 'utf8').trim()
    : null
  if (manifest.workspaceId !== workspace) problems.push('its workspace is not this folder’s')
  for (const left of [
    'unfinished',
    'database.sqlite-wal',
    'database.sqlite-shm',
    'database.sqlite-journal',
  ]) {
    if (existsSync(join(copy.dir, left))) problems.push(`${left} is left in it`)
  }
  const database = join(copy.dir, manifest.database?.file ?? 'database.sqlite')
  if (!existsSync(database)) {
    problems.push('it holds no database')
  } else {
    const bytes = readFileSync(database)
    if (lstatSync(database).size !== manifest.database.bytes)
      problems.push('the database is not the size its manifest says')
    if (sha256(bytes) !== manifest.database.sha256)
      problems.push('the database is not the one its manifest hashed')
    if (bytes[18] !== 1 || bytes[19] !== 1) problems.push('the database is not in rollback mode')
    const scratch = mkdtempSync(join(tmpdir(), 'brobot-rehearsal-copy-'))
    try {
      copyFileSync(database, join(scratch, 'copy.sqlite'))
      const opened = new DatabaseSync(join(scratch, 'copy.sqlite'), { readOnly: true })
      try {
        const integrity = opened
          .prepare('PRAGMA integrity_check')
          .all()
          .map((row) => Object.values(row)[0])
        if (integrity.join() !== 'ok')
          problems.push(`its integrity check says ${integrity.join('; ')}`)
        const migrations = opened
          .prepare(
            'SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at',
          )
          .all()
          .map((row) => `${String(row.createdAt)}:${String(row.hash)}`)
        const named = (manifest.database.migrations ?? []).map(
          (one) => `${String(one.createdAt)}:${String(one.hash)}`,
        )
        if (migrations.join() !== named.join())
          problems.push('its migrations are not the ones its manifest names')
      } finally {
        opened.close()
      }
    } catch (error) {
      problems.push(`its database cannot be read: ${error.message}`)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  const names = (manifest.files ?? []).map((one) => one.name)
  if ([...names].sort().join() !== [...STATE_FILES].sort().join())
    problems.push(`its manifest lists ${names.join(', ')}`)
  for (const file of manifest.files ?? []) {
    const path = join(copy.dir, file.name)
    if (!file.present) {
      if (existsSync(path))
        problems.push(`${file.name} is in it, and its manifest says it was not there`)
      continue
    }
    if (!existsSync(path)) {
      problems.push(`${file.name} is missing`)
      continue
    }
    const bytes = readFileSync(path)
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      problems.push(`${file.name} is not as its manifest says`)
  }
  return {
    problems,
    manifest: { reason: manifest.reason, madeBy: manifest.madeBy, createdAt: manifest.createdAt },
  }
}

/** Every difference between two readings of a data folder, either way: rows, transcripts, state. */
export function sameData(one, other) {
  return [
    ...compareData(one, other).problems,
    ...compareData(other, one).problems.map((problem) => `the other way round: ${problem}`),
  ]
}

/**
 * What a reading of the data lacks of what A made through its window: for each conversation, its
 * question and its answer among the events, and a native transcript named for its thread; and the
 * draft. ⛔ A comparison is only worth what it compares.
 */
export function whatTheDataLacks(data, made) {
  const lacking = []
  for (const id of made.conversations) {
    const events = (data.tables.events ?? []).filter((row) => row.session_id === id)
    for (const type of ['user_turn', 'assistant_message']) {
      if (!events.some((row) => row.type === type)) lacking.push(`${id} has no ${type} event`)
    }
    const conversation = (data.tables.provider_session ?? []).find((row) => row.id === id)
    let thread
    try {
      thread = JSON.parse(conversation?.external_ref ?? 'null')?.sessionId
    } catch {
      thread = undefined
    }
    const transcript = Object.entries(data.transcripts).find(
      ([path, bytes]) => typeof thread === 'string' && path.includes(thread) && bytes.length > 0,
    )
    if (transcript === undefined) lacking.push(`${id} has no native transcript`)
  }
  let drafts
  try {
    drafts = JSON.parse(data.state['drafts.json']?.toString('utf8') ?? '{}').drafts ?? []
  } catch {
    drafts = []
  }
  if (!drafts.some((one) => one.slot === made.draft.slot && one.text === made.draft.text)) {
    lacking.push('the draft is not saved')
  }
  return lacking
}

/**
 * Whether a recovery copy holds exactly what a reading of the data folder held: every row either
 * way, and each state file byte for byte, present or absent alike. Answers the differences.
 */
export function copyHoldsTheData(copy, data) {
  const bare = { ...data, transcripts: {}, state: {} }
  const held = { ...bare, tables: databaseRows(join(copy.dir, 'database.sqlite')) }
  const problems = [
    ...compareData(held, bare).problems,
    ...compareData(bare, held).problems.map((one) => `the copy lacks: ${one}`),
  ]
  for (const name of STATE_FILES) {
    const path = join(copy.dir, name)
    const copied = existsSync(path) ? readFileSync(path) : null
    const left = data.state[name] ?? null
    if (copied === null ? left !== null : left === null || !copied.equals(left)) {
      problems.push(`${name} in the copy is not the one that was left`)
    }
  }
  return problems
}

/**
 * What one start's log says about its recovery copy: on a release's first start, the copy's line
 * once, before the ready line; on a later start, no copy; on either, no failure and no recovery
 * window.
 */
export function firstStartProblems(log, { expectCopy = true } = {}) {
  const lines = String(log).split(/\r?\n/)
  const at = (text) => lines.findIndex((line) => line.includes(text))
  const count = (text) => lines.filter((line) => line.includes(text)).length
  const problems = []
  const copy = at(CHECKPOINT_LINE)
  const ready = at(READY_LINE)
  if (ready < 0) problems.push('it never said it was ready')
  if (count(FAIL_LINE) > 0) problems.push('it said it did not start')
  if (count(OPENED_FOR_RECOVERY_LINE) > 0) problems.push('it opened only its recovery window')
  if (expectCopy) {
    if (copy < 0) problems.push('it made no recovery copy')
    else if (count(CHECKPOINT_LINE) > 1) problems.push('it made more than one recovery copy')
    else if (ready >= 0 && copy > ready)
      problems.push('it made its recovery copy after it was ready')
  } else if (copy >= 0) {
    problems.push('it made a recovery copy again')
  }
  return { problems, lines: [copy, ready].filter((i) => i >= 0).map((i) => lines[i]) }
}
