import { readStateEntry } from '../skill-tree-state.mjs'
import { sleep } from '../update-rehearsal-app.mjs'
import { digest, observeKeychainEntries } from '../mac-update-test.mjs'
import { withMovedFiles } from '../moved-state-files.mjs'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  contains,
  recoveryCopies,
  registryKept,
  workspaceRegistrySnapshot,
  requireEvidence,
  APP_NAMES_BEFORE,
  keychainAttributes,
  keychainEntryFor,
  sessionsKept,
  sha256,
  stateFileNames,
  transcriptsOf,
} from '../upgrade-path.mjs'
import {
  REPO,
  os,
  appRoot,
  data,
  codexSessions,
  candidateAppName,
  summary,
  check,
  holds,
  keep,
  running,
} from './settings.mjs'

const stateFiles = stateFileNames(
  readFileSync(join(REPO, 'apps', 'desktop', 'src', 'main', 'recovery', 'state-files.ts'), 'utf8'),
)
function readState(folder = data, tables = {}) {
  const found = {}
  for (const name of stateFiles) {
    if (existsSync(join(folder, name))) found[name] = readStateEntry(join(folder, name))
  }
  return withMovedFiles(found, tables)
}
function codexTranscripts() {
  const found = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      requireEvidence(
        !lstatSync(path).isSymbolicLink(),
        `A link stands among the transcripts: ${path}`,
      )
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(relative(data, path))
    }
  }
  requireEvidence(existsSync(codexSessions), 'The beta left no Codex sessions folder.')
  walk(codexSessions)
  return found
}
const fileFacts = (path) => {
  const bytes = readFileSync(path)
  return { bytes: bytes.length, sha256: sha256(bytes) }
}
function transcriptsKept(baseline, { exact }) {
  return Object.entries(baseline).flatMap(([conversation, was]) => {
    const path = join(data, was.path)
    if (!existsSync(path)) return [`${conversation}: ${was.path} is gone`]
    const bytes = readFileSync(path)
    if (exact) {
      return bytes.length === was.bytes && sha256(bytes) === was.sha256
        ? []
        : [
            `${conversation}: ${was.path} changed (${String(was.bytes)} → ${String(bytes.length)} bytes)`,
          ]
    }
    return bytes.length >= was.bytes && sha256(bytes.subarray(0, was.bytes)) === was.sha256
      ? []
      : [`${conversation}: the first ${String(was.bytes)} bytes of ${was.path} changed`]
  })
}
function ownTranscriptsKept(stage, history, baseline, tables) {
  const references = sessionsKept(history, tables)
  check(
    references.length === 0,
    `${stage}: each conversation still names the Codex session the beta recorded`,
    references,
  )
  holds(`${stage}: each conversation still has its one transcript, where the beta left it`, () => {
    const now = transcriptsOf(history, codexTranscripts())
    for (const [conversation, was] of Object.entries(baseline)) {
      requireEvidence(
        now[conversation] === was.path,
        `Conversation ${conversation}'s transcript is now ${String(now[conversation])}, not ${was.path}.`,
      )
    }
  })
}
const copies = () => recoveryCopies(data, { digestFile: digest })

const copySaid = ({ folder, manifest }) => ({
  folder,
  reason: manifest?.reason ?? null,
  createdAt: manifest?.createdAt ?? null,
  madeBy: manifest?.madeBy ?? null,
})
const readBeside = (path) => {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { unreadable: true }
  }
}
const besideTheFolder = (contract) => ({
  'settings.json': readBeside(join(appRoot, 'settings.json')),
  registry: workspaceRegistrySnapshot(appRoot, contract, readBeside),
})
function besideKept(stage, before) {
  const now = besideTheFolder('packaged')
  ;(summary.registryReadings ??= []).push({ stage, ...now.registry })
  keep(`${stage.replaceAll(' ', '-')}-registry.json`, now.registry)
  check(
    before['settings.json'] !== null && contains(now['settings.json'], before['settings.json']),
    `${stage}: the computer's settings still say what the beta set`,
    { before: before['settings.json'], now: now['settings.json'] },
  )
  const registry = registryKept(before.registry.value, now.registry.value)
  check(registry.length === 0, `${stage}: the list of workspaces still holds the beta's`, registry)
}

function keychainEntries(stage) {
  if (os !== 'mac') return []
  const observed = observeKeychainEntries([candidateAppName, ...APP_NAMES_BEFORE], {
    entryFor: keychainEntryFor,
    attributes: keychainAttributes,
  })
  summary.keychainAttempts ??= []
  summary.keychainAttempts.push({ stage, attempts: observed.attempts })
  return observed.entries
}

async function answersWhile(pending) {
  const probes = []
  let settled = false
  void pending.then(
    () => (settled = true),
    () => (settled = true),
  )
  while (probes.length < 5 || (!settled && probes.length < 60)) {
    const at = Date.now()
    const answered = await running.cdp
      .evaluate('await window.api.getAppInfo(); return true', 10_000)
      .then(
        () => true,
        () => false,
      )
    probes.push({ answered, ms: Date.now() - at })
    await sleep(500)
  }
  return probes
}
const kept = (probes) => probes.every((one) => one.answered && one.ms < 5_000)

async function observeTheSavedKey(stage) {
  const asked = Date.now()
  const status = running.cdp
    .evaluate(
      "return await window.api.runtime.apiKeyStatus({ provider: 'codex' }).then((one) => ({ answer: one })).catch((e) => ({ error: String(e) }))",
      120_000,
    )
    .catch((error) => ({ error: error.message }))
  const probes = await answersWhile(status)
  const result = await status
  const seen = {
    stage,
    status: result.answer ?? null,
    error: result.error ?? null,
    statusMs: Date.now() - asked,
    appAnswered: probes,
  }
  summary.savedKey = [...(summary.savedKey ?? []), seen]
  check(
    kept(probes),
    `${stage}: the app answered each time it was asked, while it was asked about the saved key`,
    seen,
  )
  check(
    seen.statusMs < 60_000,
    `${stage}: the app answered about the saved key in under a minute`,
    seen,
  )
  check(
    seen.error === null && seen.status?.set === true,
    `${stage}: the app says a Codex key is saved`,
    seen,
  )
  requireEvidence(kept(probes), 'the app stopped answering while it was asked about the saved key')
  return seen.status
}

export {
  stateFiles,
  readState,
  codexTranscripts,
  fileFacts,
  transcriptsKept,
  ownTranscriptsKept,
  copies,
  copySaid,
  besideTheFolder,
  besideKept,
  keychainEntries,
  answersWhile,
  kept,
  observeTheSavedKey,
}
