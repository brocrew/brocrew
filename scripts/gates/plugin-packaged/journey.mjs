import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { attach, press } from '../../lib/update-rehearsal-app.mjs'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { privateFolder, fixtureEnvironment, fixtureAppEnvironment, command } from './prepare.mjs'
import {
  ownedRoot,
  requireCI,
  digest,
  report,
  safeReport,
  finish,
  requireCheck,
} from './contract.mjs'
import { bounded, stopApp } from './processes.mjs'
import { observeApp, probeStep, waitDevtools } from './probe.mjs'
import { failureFor, printFailure, stepFailure, printAppStderr } from './diagnostics.mjs'
import { pageStateSnapshot, printPageState } from './page-state.mjs'
import { pluginStateSnapshot, printPluginState, unknownPluginState } from './plugin-state.mjs'
import { openPlugins, enabledProfile, pluginPage, switchOnProfile, waitFor } from './cdp.mjs'
import { serveFixture, createProviderTurn, browserEvidence, waitTabs } from './browser-journey.mjs'
import { fixtureTitle } from './fake-browser.mjs'
import { providerState, printProviderState } from './provider-state.mjs'
import { providerErrorCategory } from './browser-journey.mjs'
import { prepareCandidateCache } from './release.mjs'
// Kept in sync with the scripted provider; ordinary prompts retain the normal FakeRuntime behavior.
const openPrompt = 'Use Chrome to open the fern fixture page and read its title.'
const closePrompt = 'Use Chrome to close the fern fixture tab.'
/** Read one of the gate's own files, bounded in size so a runaway write fails plainly. */
export function readOwned(file, maximum = 32 * 1024) {
  const bytes = fs.readFileSync(file)
  if (bytes.length > maximum) throw new Error(`${file} is larger than ${maximum} bytes`)
  return bytes
}
const observationFailure = (why) => {
  throw new Error(`Incomplete install observation${why ? `: ${why}` : ''}`)
}
const exactKeys = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name))
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
// JSON.parse alone loses duplicate keys. Validate the bounded JSON grammar before decoding it.
export function observationJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let at = 0
  const space = () => {
    while (/[\t\n\r ]/.test(text[at] ?? 'x')) at++
  }
  const string = () => {
    const start = at++
    while (at < text.length) {
      const char = text[at++]
      if (char === '"') return JSON.parse(text.slice(start, at))
      if (char === '\\') at++
    }
    return observationFailure()
  }
  const value = (depth = 0) => {
    if (depth > 64) return observationFailure()
    space()
    if (text[at] === '{') {
      at++
      space()
      const keys = new Set()
      if (text[at] === '}') {
        at++
        return
      }
      while (at < text.length) {
        space()
        if (text[at] !== '"') return observationFailure()
        const key = string()
        if (keys.has(key)) return observationFailure()
        keys.add(key)
        space()
        if (text[at++] !== ':') return observationFailure()
        value(depth + 1)
        space()
        const end = text[at++]
        if (end === '}') return
        if (end !== ',') return observationFailure()
      }
    } else if (text[at] === '[') {
      at++
      space()
      if (text[at] === ']') {
        at++
        return
      }
      while (at < text.length) {
        value(depth + 1)
        space()
        const end = text[at++]
        if (end === ']') return
        if (end !== ',') return observationFailure()
      }
    } else if (text[at] === '"') {
      string()
      return
    } else {
      const token = text
        .slice(at)
        .match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0]
      if (!token) return observationFailure()
      at += token.length
      return
    }
    return observationFailure()
  }
  value()
  space()
  if (at !== text.length) return observationFailure()
  return JSON.parse(text)
}
/** A folder of the gate's own scratch tree that the observation reads from. */
function observedDirectory(root, folder) {
  const relative = path.relative(root, folder)
  if (relative.startsWith('..') || path.isAbsolute(relative))
    return observationFailure(`${folder} is outside ${root}`)
  if (!fs.statSync(folder).isDirectory()) return observationFailure(`${folder} is not a folder`)
  return folder
}
function releaseState(value) {
  return (
    exactKeys(value, ['version', 'archiveSha256', 'manifestSha256', 'dataSchema']) &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    hash(value.archiveSha256) &&
    hash(value.manifestSha256) &&
    integer(value.dataSchema)
  )
}
function installationState(value) {
  return (
    exactKeys(value, [
      'pluginId',
      'installId',
      'incarnation',
      'lifecycleSequence',
      'releaseRevision',
      'configRevision',
      'release',
      'phase',
    ]) &&
    value.pluginId === 'chrome' &&
    uuid(value.installId) &&
    uuid(value.incarnation) &&
    integer(value.lifecycleSequence) &&
    value.lifecycleSequence >= 1 &&
    integer(value.releaseRevision) &&
    value.releaseRevision >= 1 &&
    integer(value.configRevision) &&
    releaseState(value.release) &&
    ['prepared', 'active', 'removed'].includes(value.phase)
  )
}
/** Current format2 writer schema, restricted to this fresh single-plugin/single-workspace interval. */
export function validateInstallSnapshot(value) {
  if (
    !exactKeys(value, [
      'format',
      'rootId',
      'epoch',
      'sequence',
      'installations',
      'active',
      'recentOperations',
      'pending',
      'projections',
      'workspaceEnabled',
      'workspaceTitlesEnabled',
    ]) ||
    value.format !== 2 ||
    !uuid(value.rootId) ||
    !uuid(value.epoch) ||
    !integer(value.sequence) ||
    value.pending !== null
  )
    return observationFailure()
  for (const key of [
    'installations',
    'active',
    'recentOperations',
    'projections',
    'workspaceEnabled',
    'workspaceTitlesEnabled',
  ])
    if (!Array.isArray(value[key]) || value[key].length > 1) return observationFailure()
  if (value.workspaceEnabled.length || value.workspaceTitlesEnabled.length)
    return observationFailure()
  if (!value.installations.every(installationState) || !value.active.every(installationState))
    return observationFailure()
  for (const row of value.recentOperations) {
    if (!exactKeys(row, ['operation', 'status']) || row.status !== 'completed')
      return observationFailure()
    const op = row.operation,
      req = op?.request,
      consent = req?.consent
    if (
      !exactKeys(op, ['request', 'allocated', 'next']) ||
      !exactKeys(req, ['operationId', 'consent', 'snapshot', 'workspaces']) ||
      !uuid(req.operationId) ||
      req.snapshot !== null ||
      !Array.isArray(req.workspaces) ||
      req.workspaces.length !== 1 ||
      !uuid(req.workspaces[0]) ||
      !exactKeys(consent, [
        'action',
        'pluginId',
        'at',
        'expectedSequence',
        'expectedInstallId',
        'release',
      ]) ||
      consent.action !== 'install' ||
      consent.pluginId !== 'chrome' ||
      !integer(consent.at) ||
      !integer(consent.expectedSequence) ||
      consent.expectedInstallId !== null ||
      !releaseState(consent.release) ||
      !exactKeys(op.allocated, ['installId', 'incarnation', 'epoch']) ||
      !Object.values(op.allocated).every(uuid) ||
      !installationState(op.next)
    )
      return observationFailure()
  }
  for (const receipt of value.projections)
    if (
      !exactKeys(receipt, [
        'format',
        'rootId',
        'workspaceId',
        'epoch',
        'pluginId',
        'installId',
        'incarnation',
        'lifecycleSequence',
        'releaseRevision',
        'configRevision',
        'skills',
        'bindings',
      ]) ||
      receipt.format !== 1 ||
      !['rootId', 'workspaceId', 'epoch', 'installId', 'incarnation'].every((key) =>
        uuid(receipt[key]),
      ) ||
      receipt.pluginId !== 'chrome' ||
      !['lifecycleSequence', 'releaseRevision', 'configRevision'].every((key) =>
        integer(receipt[key]),
      ) ||
      !Array.isArray(receipt.skills) ||
      receipt.skills.length ||
      !Array.isArray(receipt.bindings) ||
      receipt.bindings.length
    )
      return observationFailure()
  return value
}
// Selection is independent of the application's selector and payload decoder.
function observedSnapshotFile(root, global) {
  const state = path.join(global, 'state'),
    folder = path.join(state, 'snapshots')
  observedDirectory(root, global)
  observedDirectory(root, state)
  try {
    observedDirectory(root, folder)
  } catch (error) {
    if (error.code === 'ENOENT') return path.join(state, 'installed-state.json')
    throw error
  }
  const seen = new Set(),
    names = []
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const match = /^(\d{16})-c(r|\d{16})\.json$/.exec(entry.name)
    if (!match || match[0] !== entry.name || !entry.isFile() || seen.has(match[1]))
      return observationFailure()
    seen.add(match[1])
    names.push(entry.name)
  }
  names.sort()
  return names.length ? path.join(folder, names.at(-1)) : path.join(state, 'installed-state.json')
}
export function observeInstallState(root, global) {
  ownedRoot(root)
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = observedSnapshotFile(root, global)
    let bytes
    try {
      bytes = readOwned(file, 1024 * 1024)
    } catch (error) {
      if (error.code === 'ENOENT' && error.syscall === 'open' && attempt === 0) continue
      throw error
    }
    const snapshot = validateInstallSnapshot(observationJson(bytes))
    if (observedSnapshotFile(root, global) !== file) return observationFailure()
    if (!readOwned(file, 1024 * 1024).equals(bytes)) return observationFailure()
    if (observedSnapshotFile(root, global) !== file) return observationFailure()
    return snapshot
  }
  return observationFailure()
}
export function emptyInstallBaseline(snapshot) {
  validateInstallSnapshot(snapshot)
  if (
    snapshot.sequence !== 0 ||
    [
      'installations',
      'active',
      'recentOperations',
      'projections',
      'workspaceEnabled',
      'workspaceTitlesEnabled',
    ].some((key) => snapshot[key].length)
  )
    return observationFailure()
  return snapshot
}
export function sameInstallState(before, after) {
  validateInstallSnapshot(before)
  validateInstallSnapshot(after)
  if (!isDeepStrictEqual(before, after)) return observationFailure()
  return true
}
// Tamper inspection may precede writable lifecycle bootstrap. Never invent persisted state.
export function observeTamperInstallState(root, global) {
  ownedRoot(root)
  observedDirectory(root, global)
  const before = fs.lstatSync(global),
    state = path.join(global, 'state')
  let absent = false
  try {
    fs.lstatSync(state)
  } catch (error) {
    if (error.code !== 'ENOENT' || error.syscall !== 'lstat' || error.path !== state) throw error
    absent = true
  }
  const snapshot = absent ? undefined : emptyInstallBaseline(observeInstallState(root, global))
  if (absent) {
    // These are two checked endpoints, not proof of continuous absence between reads.
    try {
      fs.lstatSync(state)
      return observationFailure()
    } catch (error) {
      if (error.code !== 'ENOENT' || error.syscall !== 'lstat' || error.path !== state) throw error
    }
  }
  ownedRoot(root)
  observedDirectory(root, global)
  const after = fs.lstatSync(global)
  if (before.dev !== after.dev || before.ino !== after.ino) return observationFailure()
  const binding = { root, global, identity: { dev: before.dev, ino: before.ino } }
  return absent ? { kind: 'absent', ...binding } : { kind: 'published', ...binding, snapshot }
}
export function sameTamperInstallState(before, after) {
  for (const value of [before, after]) {
    if (
      !['absent', 'published'].includes(value?.kind) ||
      !exactKeys(value, [
        'kind',
        'root',
        'global',
        'identity',
        ...(value.kind === 'published' ? ['snapshot'] : []),
      ]) ||
      typeof value.root !== 'string' ||
      !path.isAbsolute(value.root) ||
      typeof value.global !== 'string' ||
      !path.isAbsolute(value.global) ||
      path.relative(value.root, value.global).startsWith('..') ||
      path.isAbsolute(path.relative(value.root, value.global)) ||
      !exactKeys(value.identity, ['dev', 'ino']) ||
      !integer(value.identity.dev) ||
      !integer(value.identity.ino)
    )
      return observationFailure()
    if (value.kind === 'published') emptyInstallBaseline(value.snapshot)
  }
  if (
    before.kind !== after.kind ||
    before.root !== after.root ||
    before.global !== after.global ||
    !isDeepStrictEqual(before.identity, after.identity)
  )
    return observationFailure()
  return before.kind === 'published' ? sameInstallState(before.snapshot, after.snapshot) : true
}
export function firstInstallState(baseline, completed, workspace, proof) {
  emptyInstallBaseline(baseline)
  validateInstallSnapshot(completed)
  if (
    proof?.cacheVerified !== true ||
    proof.pristine !== true ||
    !hash(proof.ref?.sha256) ||
    !hash(proof.manifestSha256) ||
    !integer(proof.manifest?.data?.schema)
  )
    return observationFailure()
  if (
    completed.rootId !== baseline.rootId ||
    completed.epoch !== baseline.epoch ||
    completed.sequence !== baseline.sequence + 2 ||
    completed.recentOperations.length !== 1 ||
    completed.active.length !== 1 ||
    completed.installations.length !== 1 ||
    completed.projections.length !== 1
  )
    return observationFailure()
  const op = completed.recentOperations[0].operation,
    next = op.next,
    req = op.request
  const expectedRelease = {
    version: proof.manifest.version,
    archiveSha256: proof.ref.sha256,
    manifestSha256: proof.manifestSha256,
    dataSchema: proof.manifest.data.schema,
  }
  const workspaceHash = digest(Buffer.from(workspace))
  const workspaceId = `${workspaceHash.slice(0, 8)}-${workspaceHash.slice(8, 12)}-5${workspaceHash.slice(13, 16)}-a${workspaceHash.slice(17, 20)}-${workspaceHash.slice(20, 32)}`
  if (
    req.consent.expectedSequence !== baseline.sequence ||
    !isDeepStrictEqual(req.workspaces, [workspaceId]) ||
    !isDeepStrictEqual(req.consent.release, expectedRelease) ||
    !isDeepStrictEqual(next.release, expectedRelease) ||
    next.phase !== 'prepared' ||
    next.installId !== op.allocated.installId ||
    next.incarnation !== op.allocated.incarnation ||
    next.lifecycleSequence !== 1 ||
    next.releaseRevision !== 1 ||
    next.configRevision !== 0
  )
    return observationFailure()
  const active = { ...next, phase: 'active' }
  const receipt = {
    format: 1,
    rootId: baseline.rootId,
    workspaceId,
    epoch: baseline.epoch,
    pluginId: 'chrome',
    installId: next.installId,
    incarnation: next.incarnation,
    lifecycleSequence: 1,
    releaseRevision: 1,
    configRevision: 0,
    skills: [],
    bindings: [],
  }
  if (
    !isDeepStrictEqual(completed.active, [active]) ||
    !isDeepStrictEqual(completed.installations, [active]) ||
    !isDeepStrictEqual(completed.projections, [receipt])
  )
    return observationFailure()
  return completed
}
export function observeRunNames(root, global) {
  ownedRoot(root)
  observedDirectory(root, global)
  const host = path.join(global, 'host')
  try {
    fs.lstatSync(host)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  observedDirectory(root, host)
  const folder = path.join(host, 'runs')
  try {
    fs.lstatSync(folder)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  observedDirectory(root, folder)
  const names = fs.readdirSync(folder).sort()
  if (names.length > 128 || names.some((name) => !uuid(name))) return observationFailure()
  for (const name of names) observedDirectory(root, path.join(folder, name))
  if (!isDeepStrictEqual(names, fs.readdirSync(folder).sort())) return observationFailure()
  return names
}
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
export function stageRelease(root, appData, variant = 'valid') {
  ownedRoot(root)
  const release = path.join(root, 'release')
  const catalogue = JSON.parse(readOwned(path.join(release, 'catalogue.json')))
  if (
    catalogue.format !== 3 ||
    catalogue.entries.length !== 1 ||
    catalogue.entries[0].id !== 'chrome'
  )
    throw new Error('Invalid release catalogue')
  const target = catalogue.entries[0].targets.find(
    (one) => one.os === 'darwin' && one.cpu === 'arm64',
  )
  if (!target) throw new Error('Missing release target')
  if (!['valid', 'local', 'tampered'].includes(variant)) throw new Error('Invalid release fixture')
  const destination = privateFolder(path.join(appData, 'repo-fixture'))
  privateFolder(path.join(destination, 'archives'))
  // An unpublished build has no reachable release URL. The local variant points the catalogue at
  // the staged archive itself, so every install and reinstall reads it the ordinary way.
  if (variant === 'local')
    target.url = path.join(destination, 'archives', target.sha256 + '.tar.gz')
  const archive = Buffer.from(
    readOwned(path.join(release, 'chrome-darwin-arm64.tar.gz'), 128 * 1024 * 1024),
  )
  if (variant === 'tampered') archive[archive.length - 1] ^= 1
  fs.writeFileSync(path.join(destination, 'catalogue.json'), JSON.stringify(catalogue), {
    mode: 0o600,
  })
  fs.writeFileSync(path.join(destination, 'archives', target.sha256 + '.tar.gz'), archive, {
    mode: 0o600,
  })
  return {
    ref: { source: target.url, sha256: target.sha256, bytes: target.bytes },
    archivePath: path.join(destination, 'archives', target.sha256 + '.tar.gz'),
  }
}
async function startApp(root, plan, workspace, global, processes, diagnose = false) {
  if (plan.argv?.length !== 1 || plan.argv[0] !== HIDDEN_LAUNCH_ARG)
    throw new Error('Missing hidden launch plan')
  const port = await freePort(),
    exe = path.join(plan.app, 'Contents/MacOS/BroCrew')
  // The measured fixture recipe runs directly; the outer sandbox is diagnostic-only.
  const step = diagnose ? probeStep : async (_name, work) => work()
  let run
  await step('app-spawn', async () => {
    const launchedAt = Date.now()
    const args = [
      HIDDEN_LAUNCH_ARG,
      '--use-mock-keychain',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${workspace}`,
      `--plugin-global-root=${global}`,
    ]
    const child = spawn(exe, args, {
      env: fixtureAppEnvironment(root, plan.app),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    // The nested app's own stdout and stderr, byte for byte and unclassified, go into this
    // journey's stderr, which the owner echoes into the uploaded fixture-output.log.
    child.stdout?.on('data', (bytes) => process.stderr.write(bytes))
    child.stderr?.on('data', (bytes) => process.stderr.write(bytes))
    const observed = observeApp(child)
    run = {
      ...observed,
      executable: exe,
      launchedAt,
      cdp: undefined,
      workspace,
      global,
      port,
      stopped: false,
    }
    processes.push(run)
    const error = await observed.started
    if (error) throw error
  })
  if (diagnose) {
    await step('devtools-port', (signal) => waitDevtools(port, false, signal), run, 20_000)
    await step('first-window', (signal) => waitDevtools(port, true, signal), run, 20_000)
  }
  await step(
    'window-drawn',
    async () => {
      run.cdp = await bounded(
        attach(port, { wait: diagnose ? 15_000 : 90_000 }),
        diagnose ? 20_000 : 95_000,
      )
      const evaluate = run.cdp.evaluate
      run.cdp.evaluate = (body) => bounded(evaluate(body), diagnose ? 10_000 : 60_000)
    },
    run,
    25_000,
  )
  return run
}
async function plugins(run, signal) {
  await openPlugins(run.cdp, { signal })
}
async function installed(run, wanted) {
  await waitFor(async () => {
    const answer = await run.cdp.evaluate(`return await window.api.plugins.request({kind:'list'})`)
    const card = answer?.ok && answer.cards?.find((card) => card.id === 'chrome')
    return (
      card &&
      card.installed === wanted &&
      (wanted ? card.state === 'Running' : card.state !== 'Unavailable')
    )
  }, 90_000)
}
export function matchesInspection(inspection, proof) {
  return (
    proof?.cacheVerified === true &&
    proof.pristine === true &&
    isDeepStrictEqual(inspection?.ref, proof.ref) &&
    isDeepStrictEqual(inspection?.manifest, proof.manifest) &&
    inspection?.id === proof.manifest.id &&
    inspection?.details?.version === proof.manifest.version &&
    inspection?.details?.digest === proof.ref.sha256 &&
    inspection?.details?.manifestSha256 === proof.manifestSha256 &&
    isDeepStrictEqual(inspection?.details?.authors, proof.manifest.authors)
  )
}
export async function inspectCandidate(run, proof) {
  const answer = await run.cdp.evaluate(
    "return await window.api.plugins.request({kind:'inspect',id:'chrome'})",
  )
  if (answer?.ok !== true || !matchesInspection(answer.inspection, proof))
    throw new Error('Inspected candidate differs')
  return answer.inspection
}
export async function reviewInstall(run, proof, beforeConfirm = async () => {}) {
  await inspectCandidate(run, proof)
  await press(run.cdp, '[data-plugin="chrome"] [data-cy="plugin-review-install"]')
  await waitFor(async () => {
    const shown = await run.cdp.evaluate(`
      const row=document.querySelector('[data-plugin="chrome"]');
      const detail=row?.querySelector('[data-cy="plugin-review-details"]');
      const values=[...(detail?.querySelectorAll('p > bdi')??[])].map(one=>one.textContent);
      const confirm=detail?.querySelector('[data-cy="plugin-review-confirm"]');
      return {version:values[0],authors:values[1],source:values[2],confirm:Boolean(confirm&&!confirm.disabled)};
    `)
    return (
      shown?.confirm === true &&
      shown.version === proof.manifest.version &&
      shown.authors === proof.manifest.authors.join(', ') &&
      shown.source === proof.ref.source
    )
  })
  await beforeConfirm()
  await press(run.cdp, '[data-plugin="chrome"] [data-cy="plugin-review-confirm"]')
  return true
}
async function configure(run) {
  await press(run.cdp, '[data-plugin="chrome"] [data-cy="plugin-configure"]')
  const page = await pluginPage(run.port)
  await waitFor(() =>
    page.evaluate('return document.querySelector(\'#status\')?.textContent === "Running"'),
  )
  return page
}
async function closeView(run, page) {
  page.close()
  await press(run.cdp, '[data-cy="plugin-close"]')
}

export async function draws(run) {
  const pixels = await bounded(run.cdp.send('Page.captureScreenshot', { format: 'png' }), 10_000)
  return (
    typeof pixels?.data === 'string' &&
    Buffer.from(pixels.data, 'base64').length > 1000 &&
    (await run.cdp.evaluate(
      'return document.body.getBoundingClientRect().width > 100 && document.body.getBoundingClientRect().height > 100',
    ))
  )
}
/** Only the hosted owner calls this. A headless/inaccessible WindowServer does not count. */
export async function guiProbe(root) {
  requireCI()
  ownedRoot(root)
  const plan = JSON.parse(readOwned(path.join(root, 'plan.json'))),
    processes = []
  stageRelease(root, plan.appData)
  let browser
  try {
    const run = await startApp(
      root,
      plan,
      privateFolder(path.join(root, 'probe-workspace')),
      privateFolder(path.join(root, 'probe-global')),
      processes,
      true,
    )
    await probeStep(
      'window-drawn',
      async (signal) => {
        await plugins(run, signal)
        if (!(await draws(run))) throw new Error('Window did not draw')
      },
      run,
      25_000,
    )
    const data = privateFolder(path.join(root, 'probe-browser'))
    fs.rmSync(path.join(data, 'fake-browser.json'), { force: true })
    await probeStep(
      'fake-browser-start',
      async () => {
        browser = spawn(
          path.join(plan.app, 'Contents/Resources/plugin-node/node'),
          [plan.browser, '--fixture-probe'],
          {
            env: fixtureEnvironment(root, { BROCREW_CHROME_DATA: data }),
            stdio: 'ignore',
            detached: true,
          },
        )
        const observed = observeApp(browser)
        processes.push({ ...observed, stopped: false })
        const error = await observed.started
        if (error) throw error
        await probeStep(
          'fake-browser-start',
          () => waitFor(() => fs.existsSync(path.join(data, 'fake-browser.json')), 5000),
          observed,
          5500,
        )
        if (
          JSON.parse(readOwned(path.join(data, 'fake-browser.json'))).pid !== browser.pid ||
          browser.exitCode !== null ||
          browser.signalCode !== null
        )
          throw new Error('Fake browser did not start')
      },
      run,
      7_000,
    )
    return { windowDrawn: true, fakeBrowserStarted: true }
  } catch (error) {
    if (error.failure?.step === 'window-drawn') {
      try {
        printPageState(await pageStateSnapshot(processes[0]?.port))
      } catch {
        /* Diagnostic failure never replaces the original timeout. */
      }
    }
    if (error.failure?.step === 'app-exit-early') {
      const run = processes[0]
      if (run?.closed) await bounded(run.closed, 1000).catch(() => {})
      printAppStderr(run?.stderrClass?.() ?? { category: 'other' })
    }
    throw error
  } finally {
    for (const run of processes.reverse()) {
      try {
        await stopApp(run, 2000)
      } catch {
        /* Best effort; the hosted owner drains next. */
      }
    }
  }
}
export async function journey(root) {
  requireCI()
  ownedRoot(root)
  const summary = report(),
    processes = [],
    views = []
  const plan = JSON.parse(readOwned(path.join(root, 'plan.json')))
  const global = privateFolder(path.join(root, 'g')),
    badGlobal = privateFolder(path.join(root, 'b'))
  const workspaceA = privateFolder(path.join(root, 'wa')),
    workspaceB = privateFolder(path.join(root, 'wb'))
  let step = 'packaged'
  let fixtureServer, providerTurn
  try {
    const resources = path.join(plan.app, 'Contents/Resources')
    requireCheck(
      summary,
      'packagedArm64',
      (
        await command(
          '/usr/bin/lipo',
          ['-archs', path.join(plan.app, 'Contents/MacOS/BroCrew')],
          root,
        )
      ).trim() === 'arm64',
    )
    requireCheck(
      summary,
      'bundledNode',
      /^v24\./.test(
        (await command(path.join(resources, 'plugin-node/node'), ['--version'], root)).trim(),
      ),
    )
    requireCheck(
      summary,
      'bundledSupervisor',
      fs.lstatSync(path.join(resources, 'plugin-supervisor/entry.cjs')).isFile(),
    )
    step = 'tampered-refusal'
    const tampered = stageRelease(root, plan.appData, 'tampered')
    if (fs.existsSync(path.join(badGlobal, 'package-vault')))
      throw new Error('Tamper cache was not fresh')
    const opaqueProfile = privateFolder(path.join(badGlobal, 'host/data/chrome/profiles/fern'))
    const opaqueDownloads = privateFolder(path.join(badGlobal, 'host/data/chrome/downloads'))
    const badMarker = path.join(opaqueProfile, 'fern-gate-retained'),
      badDownload = path.join(opaqueDownloads, 'fern-kept.txt')
    fs.writeFileSync(badMarker, 'fictional-owned-profile-data\n', { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(badDownload, 'fictional-kept-download\n', { flag: 'wx', mode: 0o600 })
    const noBrowser = () =>
      !fs
        .readdirSync(root)
        .some(
          (name) =>
            /^cdp-\d+\.json$/.test(name) ||
            name === 'provider-proof.json' ||
            name === 'fake-browser.json',
        )
    if (!noBrowser() || fs.existsSync(path.join(badGlobal, 'state')))
      throw new Error('Tamper baseline not empty')
    const bad = await startApp(
      root,
      plan,
      privateFolder(path.join(root, 'w-tampered')),
      badGlobal,
      processes,
    )
    const availability = await bad.cdp.evaluate(
      "return await window.api.plugins.request({kind:'availability'})",
    )
    const badBaseline = observeTamperInstallState(root, badGlobal)
    const badRuns = observeRunNames(root, badGlobal)
    const refused = await bad.cdp.evaluate(
      `return await window.api.plugins.request({kind:'inspect',package:${JSON.stringify({ ...tampered.ref, source: tampered.archivePath })}})`,
    )
    const cards = await bad.cdp.evaluate("return await window.api.plugins.request({kind:'list'})")
    sameTamperInstallState(badBaseline, observeTamperInstallState(root, badGlobal))
    console.error('tamper replies', { availability, refused, cards })
    const tamperCondition = (name, value) => {
      console.error('tamper condition', name, value)
      return value
    }
    requireCheck(
      summary,
      'tamperedArchiveRefused',
      tamperCondition('availability-ok', availability?.ok === true) &&
        tamperCondition('availability-available', availability.available === true) &&
        tamperCondition('inspection-refused', refused?.ok === false) &&
        tamperCondition(
          'inspection-byte-mismatch',
          refused.detail === 'The package files do not match the selected bytes.',
        ) &&
        tamperCondition('list-ok', cards?.ok === true) &&
        tamperCondition('cards-array', Array.isArray(cards.cards)) &&
        tamperCondition(
          'cards-uninstalled',
          cards.cards.every((card) => card.installed === false),
        ) &&
        tamperCondition('baseline-runs-empty', badRuns.length === 0) &&
        tamperCondition('current-runs-empty', observeRunNames(root, badGlobal).length === 0) &&
        tamperCondition(
          'archive-not-cached',
          !fs.existsSync(path.join(badGlobal, 'package-vault', tampered.ref.sha256)),
        ) &&
        tamperCondition(
          'profile-config-absent',
          !fs.existsSync(path.join(badGlobal, 'host/data/chrome/profiles.json')),
        ) &&
        tamperCondition('browser-absent', noBrowser()) &&
        tamperCondition(
          'profile-marker-unchanged',
          readOwned(badMarker).equals(Buffer.from('fictional-owned-profile-data\n')),
        ) &&
        tamperCondition(
          'download-unchanged',
          readOwned(badDownload).equals(Buffer.from('fictional-kept-download\n')),
        ),
    )
    await stopApp(bad)
    step = 'install-source'
    const staged = stageRelease(root, plan.appData, 'local')
    await prepareCandidateCache(root, path.join(resources, 'plugin-node/node'))
    const proof = observationJson(
      readOwned(path.join(root, 'proof/candidate-cache.json'), 4 * 1024 * 1024),
    )
    if (
      proof.cacheVerified !== true ||
      proof.pristine !== true ||
      !isDeepStrictEqual(staged.ref, proof.ref) ||
      fs.readdirSync(global).length !== 0
    )
      throw new Error('Incomplete verified-candidate proof')
    let a = await startApp(root, plan, workspaceA, global, processes)
    await plugins(a)
    const baseline = emptyInstallBaseline(observeInstallState(root, global))
    requireCheck(summary, 'drawsWindow', await draws(a))
    requireCheck(
      summary,
      'pluginsTab',
      await a.cdp.evaluate(
        'return Boolean(document.querySelector(\'[data-cy="settings-tab-plugins"]\'))',
      ),
    )
    step = 'install'
    await reviewInstall(a, proof, async () =>
      sameInstallState(baseline, observeInstallState(root, global)),
    )
    await installed(a, true)
    const completed = firstInstallState(
      baseline,
      observeInstallState(root, global),
      workspaceA,
      proof,
    )
    const unchanged = () => sameInstallState(completed, observeInstallState(root, global))
    requireCheck(summary, 'installed', true)
    step = 'profile-create'
    let view = await configure(a)
    views.push(view)
    await press(view, '#name')
    await view.send('Input.insertText', { text: 'fern' })
    await press(view, '#create button')
    await waitFor(() =>
      view.evaluate('return Boolean(document.querySelector(\'[data-profile="fern"]\'))'),
    )
    requireCheck(summary, 'profileCreated', true)
    step = 'profile-enable'
    await switchOnProfile(view)
    await enabledProfile(view)
    requireCheck(summary, 'profileEnabled', true)
    unchanged()
    step = 'provider-start'
    await closeView(a, view)
    fixtureServer = await serveFixture(root)
    providerTurn = await createProviderTurn(a, workspaceA)
    step = 'provider-action'
    await providerTurn.turn(openPrompt, `Chrome title: ${fixtureTitle}`)
    const opened = browserEvidence(root, readOwned)
    requireCheck(
      summary,
      'agentBrowserAction',
      opened.toolOpened &&
        opened.toolRead &&
        opened.titleReturned &&
        opened.calls === 2 &&
        opened.navigations === 1 &&
        opened.evaluations > 0,
    )
    summary.coverage.agentBrowserActions = true
    summary.counts.browserNavigations = opened.navigations
    summary.counts.pluginToolCalls = opened.calls
    step = 'live-tabs-open'
    await plugins(a)
    view = await configure(a)
    views.push(view)
    const tabs = await waitTabs(view, 1)
    summary.counts.liveTabsOpen = tabs.count
    summary.tabProof = {
      rowPresent: tabs.rowPresent,
      titleIsFixture: tabs.titleCategory === 'fixture',
      open: tabs.count,
      closed: 0,
    }
    step = 'provider-close'
    await closeView(a, view)
    await providerTurn.turn(closePrompt, 'Chrome fixture tab closed.')
    const closed = browserEvidence(root, readOwned)
    if (!closed.toolClosed || closed.calls !== 3 || closed.closedTabs < 1)
      throw new Error('Fixture close not witnessed')
    summary.counts.pluginToolCalls = closed.calls
    step = 'live-tabs-closed'
    await plugins(a)
    view = await configure(a)
    views.push(view)
    const empty = await waitTabs(view, 0)
    summary.counts.liveTabsClosed = empty.count
    summary.tabProof.closed = empty.count
    summary.tabProof.emptyAfterClose = empty.rowPresent && empty.titleCategory === 'none'
    requireCheck(summary, 'liveTabs', true)
    summary.coverage.liveTabs = true
    await providerTurn.close()
    providerTurn = undefined
    await fixtureServer.close()
    fixtureServer = undefined
    step = 'profile-pin'
    const profileFile = path.join(global, 'host/data/chrome/profiles.json'),
      pin = digest(readOwned(profileFile))
    const profile = privateFolder(path.join(global, 'host/data/chrome/profiles/fern'))
    const marker = path.join(profile, 'fern-gate-retained')
    fs.writeFileSync(marker, 'fictional-owned-profile-data\n', { flag: 'wx', mode: 0o600 })
    const downloadRoot = privateFolder(path.join(global, 'host/data/chrome/downloads'))
    const download = path.join(downloadRoot, 'fern-kept.txt')
    fs.writeFileSync(download, 'fictional-kept-download\n', { flag: 'wx', mode: 0o600 })
    const retained = () =>
      readOwned(marker).equals(Buffer.from('fictional-owned-profile-data\n')) &&
      readOwned(download).equals(Buffer.from('fictional-kept-download\n')) &&
      digest(readOwned(profileFile)) === pin
    step = 'restart-stop'
    await closeView(a, view)
    await stopApp(a)
    step = 'restart-start'
    a = await startApp(root, plan, workspaceA, global, processes)
    step = 'restart-draw'
    await plugins(a)
    if (!(await draws(a))) throw new Error('Window did not draw')
    step = 'restart-installed'
    await installed(a, true)
    step = 'restart-profile'
    view = await configure(a)
    views.push(view)
    await enabledProfile(view)
    requireCheck(
      summary,
      'restartRetained',
      retained() &&
        (await view.evaluate('return Boolean(document.querySelector(\'[data-profile="fern"]\'))')),
    )
    step = 'concurrent'
    await closeView(a, view)
    const b = await startApp(root, plan, workspaceB, global, processes)
    await plugins(b)
    await installed(b, true)
    requireCheck(
      summary,
      'concurrentWorkspaces',
      !a.stopped &&
        !b.stopped &&
        a.child.exitCode === null &&
        b.child.exitCode === null &&
        (await draws(b)),
    )
    await stopApp(b)
    step = 'uninstall'
    await press(a.cdp, '[data-plugin="chrome"] [data-cy="plugin-uninstall"]')
    await press(a.cdp, '[data-cy="plugin-uninstall-confirm"]')
    await installed(a, false)
    const keptWhileAbsent = retained()
    step = 'reinstall'
    await reviewInstall(a, proof)
    await installed(a, true)
    view = await configure(a)
    views.push(view)
    await enabledProfile(view)
    requireCheck(
      summary,
      'reinstallRetained',
      keptWhileAbsent &&
        retained() &&
        (await view.evaluate('return Boolean(document.querySelector(\'[data-profile="fern"]\'))')),
    )
    await closeView(a, view)
    step = 'fake-browser'
    const probe = JSON.parse(readOwned(path.join(root, 'gui-probe.json')))
    requireCheck(
      summary,
      'fakeBrowserOnly',
      probe.windowDrawn === true && probe.fakeBrowserStarted === true,
    )
    summary.counts.workspaces = 2
  } catch (error) {
    console.error(error)
    summary.counts.failed = 1
    summary.failure = stepFailure(
      'journey',
      step,
      error,
      ['Packaged gate timed out', 'Owned process deadline'].includes(error?.message)
        ? 'timeout'
        : 'assertion',
    )
    printFailure(summary.failure)
    if (
      [
        'provider-start',
        'provider-action',
        'live-tabs-open',
        'provider-close',
        'live-tabs-closed',
      ].includes(step)
    ) {
      try {
        summary.browserProof = browserEvidence(root, readOwned)
        if (['provider-start', 'provider-action'].includes(step)) {
          summary.providerState = providerState(
            summary.browserProof,
            providerTurn?.progress,
            providerErrorCategory(root, readOwned) !== 'other'
              ? providerErrorCategory(root, readOwned)
              : (providerTurn?.progress?.errorCategory ?? 'session'),
          )
          printProviderState(summary.providerState)
        }
      } catch {
        summary.browserProof = { observed: false }
        if (['provider-start', 'provider-action'].includes(step)) {
          summary.providerState = providerState({}, providerTurn?.progress)
          printProviderState(summary.providerState)
        }
      }
    }
    const active = processes.findLast((run) => !run.stopped && run.port)
    try {
      summary.pageState = await pageStateSnapshot(active?.port)
    } catch {
      // An unavailable diagnostic never replaces the original journey failure.
      summary.pageState = { readyState: 'unknown', routeCategory: 'other', markers: [] }
    }
    printPageState(summary.pageState)
    if (['restart-installed', 'reinstall'].includes(step)) {
      summary.pluginState = unknownPluginState()
      try {
        summary.pluginState = await pluginStateSnapshot(root, global, workspaceA, active?.port)
      } catch {
        // Preserve the journey failure if its independent diagnostic cannot be observed.
      }
      printPluginState(summary.pluginState)
    }
  } finally {
    let clean = true
    try {
      await providerTurn?.close()
      await fixtureServer?.close()
    } catch {
      clean = false
    }
    for (const view of views) {
      try {
        view.close()
      } catch {
        clean = false
      }
    }
    for (const run of processes.reverse()) {
      try {
        await stopApp(run)
      } catch {
        clean = false
      }
    }
    if (!clean) summary.counts.cleanupFailures = (summary.counts.cleanupFailures ?? 0) + 1
  }
  // Cleanup is reported separately; only hosted VM teardown is the final boundary.
  finish(summary)
  if (!safeReport(summary)) throw new Error('Unsafe gate summary')
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
    mode: 0o600,
  })
  return summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireCI()
    if (process.argv[2] === 'probe') {
      const result = await guiProbe(process.argv[3])
      fs.writeFileSync(path.join(process.argv[3], 'gui-probe.json'), JSON.stringify(result), {
        mode: 0o600,
      })
    } else await journey(process.argv[2])
  } catch (error) {
    console.error(error)
    const failure = failureFor(process.argv[2] === 'probe' ? 'gui-probe' : 'journey', error)
    // Setup can fail before a child exists; even that refusal has a closed probe sub-step.
    printFailure(
      failure.phase === 'gui-probe' && !failure.step
        ? stepFailure('gui-probe', 'app-spawn', error)
        : failure.phase === 'journey' && !failure.step
          ? stepFailure('journey', 'bootstrap', error)
          : failure,
    )
    process.exitCode = 1
  }
}
