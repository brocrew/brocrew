import { execFile } from 'node:child_process'
import { promisify, parseArgs, isDeepStrictEqual } from 'node:util'
import { mkdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readUpdateFile } from './release-check.mjs'
import {
  checkedMacBundle,
  launchServicesArguments,
  exists,
  digest,
  waitFor,
  macCommands,
  observeMacWindow,
  quitMacChild,
  databaseSnapshot,
  diskImageFrom,
  nativeFiles,
  checkpointIds,
  checkNativePrefixes,
  assertHostedMac,
  assertOwnedProcess,
  dataPreserved,
  packageOfAsar,
  hash,
  packagedRegistryFile,
  nativeTranscriptsPresent,
  recoveryOrder,
  requireEvidence,
  statePreserved,
  startLocalModelTurn,
  localModelTurnFacts,
  keepModelFailureEvidence,
  stateBytes,
  stateSummary,
  VERSION_B as SAME_CODE_VERSION,
  verifyCheckpoint,
} from './lib/mac-update-test.mjs'
import { startControlledTransport } from './mac-signed-upgrade-transport.mjs'
import { CHECKPOINT_LINE, resultLine, startOrder } from './lib/upgrade-path.mjs'
import { completedProofCopy, proofManifests } from './lib/recovery-measurement.mjs'
import {
  candidateNames,
  publicFeedUnchanged,
  fixturePermissions,
  permissionsKept,
  credentialPreserved,
  registriesKept,
  assertThreeWorkspaceStates,
} from './mac-signed-upgrade-contract.mjs'
import {
  SCRIPTED_MODEL,
  aScriptedModel,
  saveRehearsalCodexKey,
  codexConfigFor,
  theAppsEnvironment,
  connectDevTools,
  press,
  screenshot as captureScreenshot,
  openUpdates,
  sleep,
} from './lib/update-rehearsal-app.mjs'

// Only disposable GitHub-hosted arm64 runners may install.
assertHostedMac(process.env, process.platform, process.arch)
const { values } = parseArgs({
  options: {
    predecessor: { type: 'string' },
    'predecessor-source': { type: 'string' },
    candidate: { type: 'string' },
    'candidate-source': { type: 'string' },
    evidence: { type: 'string' },
  },
})
requireEvidence(
  values.predecessor && values['predecessor-source'] && values.candidate && values.evidence,
  'Usage: --predecessor <dir> --predecessor-source <commit> --candidate <dir> --evidence <dir>.',
)
async function releaseFolder(folder, source) {
  const directory = resolve(folder)
  const manifest = await readFile(join(directory, 'latest-mac.yml'), 'utf8')
  const { version } = readUpdateFile(manifest)
  return { version, source, directory, manifest, names: candidateNames(version) }
}
const predecessor = await releaseFolder(values.predecessor, values['predecessor-source'])
const candidate = await releaseFolder(
  values.candidate,
  values['candidate-source'] ?? process.env.GITHUB_SHA,
)
const VERSION_A = predecessor.version,
  VERSION_B = candidate.version
requireEvidence(VERSION_A !== VERSION_B, `The candidate is already the published ${VERSION_A}.`)
const evidenceRoot = resolve(values.evidence)
let evidence = evidenceRoot
const sourceFor = (version) => (version === VERSION_A ? predecessor.source : candidate.source)
const app = '/Applications/BroCrew.app',
  dataRoot = join(homedir(), 'Library', 'Application Support', '@brobot2')
const defaultData = join(dataRoot, 'desktop')
const fixtureRoot = await realpath(process.env.RUNNER_TEMP)
const workspaces = [
  { name: 'Default', data: defaultData, isDefault: true, port: 9339 },
  { name: 'WorkspaceA', data: join(fixtureRoot, 'WorkspaceA'), isDefault: false, port: 9349 },
  { name: 'WorkspaceB', data: join(fixtureRoot, 'WorkspaceB'), isDefault: false, port: 9359 },
].map((one) => ({
  ...one,
  active: null,
  draft: `Unsent ${one.name} fictional draft: café ☕`,
  result: { name: one.name, path: one.data, isDefault: one.isDefault },
}))
let currentWorkspace = null,
  data,
  codexHome,
  nativeRoot
const settings = join(dataRoot, 'settings.json')
const registry = packagedRegistryFile(dataRoot)
const exec = promisify(execFile)
const summary = {
  format: 'brocrew-mac-upgrade-proof-v1',
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  harnessSource: process.env.GITHUB_SHA,
  from: { version: VERSION_A, source: predecessor.source },
  to: { version: VERSION_B, source: candidate.source },
  mode: 'native',
  workspaceCount: 3,
  workspaces: workspaces.map((one) => one.result),
  replacementCount: 0,
  sameCode: false,
  scriptedCopyIsFinderDrag: false,
  assertions: [],
  knownLimits: [],
  launches: [],
  launchAttempts: [],
  quarantine: [],
}
let active = null,
  model = null,
  mountedA = null,
  squirrelApp = null,
  installedByHarness = false,
  transport = null
const channels = []
const { run, plist, processInfo } = macCommands((entry) => {
  summary.commands ??= []
  summary.commands.push(entry)
})
const click = (cdp, selector) => press(cdp, selector, { wait: 180_000 })
async function connect(url) {
  const connection = await connectDevTools(url, { answerWithin: 60_000, connectWithin: 30_000 })
  channels.push(connection)
  return connection
}
const screenshot = (cdp, name) => captureScreenshot(cdp, join(evidence, name))

async function quarantine(path, stage) {
  const attributes = await run('/usr/bin/xattr', ['-l', path])
  summary.quarantine.push({ stage, path, attributes, observedAt: new Date().toISOString() })
}
function passed(name, facts = true) {
  summary.assertions.push({ name, workspace: currentWorkspace?.name ?? null, passed: true, facts })
  console.log(`PASS ${name}`)
}
async function bundleChecked(bundle, version) {
  const base = await checkedMacBundle(bundle, version, undefined, run)
  publicFeedUnchanged(await readFile(`${bundle}/Contents/Resources/app-update.yml`, 'utf8'))
  const signature = await exec('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], {
    encoding: 'utf8',
    timeout: 120_000,
  })
  const identity = signature.stdout + signature.stderr
  if (version === VERSION_B) {
    await run('/usr/bin/xcrun', ['stapler', 'validate', bundle])
    await run('/usr/sbin/spctl', ['--assess', '--verbose=4', '--type', 'execute', bundle])
  }
  return { version: base.version, bundleId: base.bundleId, signature: identity }
}
async function requireNoInstalledProcesses({ now = Date.now, pause = sleep } = {}) {
  const deadline = now() + 2_000
  let last = []
  const diagnostic = () => `Installed app processes remain: ${last.join('; ') || 'none observed'}`
  for (;;) {
    const remaining = deadline - now()
    requireEvidence(remaining > 0, diagnostic())
    let listing
    try {
      listing = await run('/bin/ps', ['-axo', 'pid=,command='], { timeout: remaining })
    } catch (error) {
      throw new Error(`${diagnostic()}; process census failed: ${String(error)}`, { cause: error })
    }
    const processes = listing.split('\n').filter((line) => line.includes(`${app}/Contents/`))
    if (processes.length > 0) last = processes
    requireEvidence(deadline - now() > 0, diagnostic())
    if (processes.length === 0) return
    await pause(Math.min(100, deadline - now()))
  }
}
async function launch(
  stage,
  port,
  version,
  { expectedConversations = stage === 'a' ? 0 : 2 } = {},
) {
  const log = join(evidence, `${stage}.log`)
  await run(
    '/usr/bin/open',
    launchServicesArguments(app, evidence, stage, port, {
      appArguments: [
        `--user-data-dir=${data}`,
        `--proxy-server=${transport.address}`,
        `--ignore-certificate-errors-spki-list=${transport.spki}`,
      ],
    }),
    {
      env: theAppsEnvironment({ kind: 'generic', url: transport.address }),
    },
  )
  const { cdp, record } = await observeMacWindow({
    app,
    port,
    stage,
    log,
    expected: {
      version,
      source: sourceFor(version),
      clean: true,
      data,
      isDefault: currentWorkspace.isDefault,
      conversations: expectedConversations,
    },
    run,
    processInfo,
    connect,
    attempts: summary.launchAttempts,
    verifyBundle: () => bundleChecked(app, version),
    onChild: (child) => {
      active = child
    },
  })
  summary.launches.push({ ...record, workspace: currentWorkspace.name })
  await screenshot(cdp, `${stage}-window.png`)
  return cdp
}
async function quit() {
  active = await quitMacChild(active, app, processInfo, passed)
}
async function checkRetention(before, state, natives, settingsBefore, registryBefore) {
  const after = databaseSnapshot(join(data, 'brobot2.sqlite'), {
    credentials: true,
    movedState: true,
  })
  const comparison = dataPreserved(before, after)
  credentialPreserved(before.provider_api_key, after.provider_api_key)
  statePreserved(state, stateBytes(data, after))
  registriesKept(
    registryBefore,
    JSON.parse(await readFile(registry, 'utf8')),
    workspaces.map((one) => one.data),
  )
  requireEvidence(
    hash(await readFile(settings)) === hash(settingsBefore),
    'Computer update settings changed.',
  )
  requireEvidence(
    isDeepStrictEqual(await nativeFiles(nativeRoot, data), natives),
    'Native transcript bytes changed before any resume.',
  )
  return { comparison, after }
}

function selectWorkspace(workspace) {
  if (currentWorkspace) currentWorkspace.active = active
  currentWorkspace = workspace
  data = workspace.data
  codexHome = join(data, 'provider-homes', 'default', 'brobot', 'codex')
  nativeRoot = join(codexHome, 'sessions')
  evidence = join(evidenceRoot, workspace.name)
  active = workspace.active
  summary.fixture = workspace.fixture
}

async function seedWorkspace(workspace) {
  selectWorkspace(workspace)
  await mkdir(evidence, { recursive: true })
  workspace.fixture = { provider: 'codex', model: SCRIPTED_MODEL, turns: [] }
  workspace.result.fixture = workspace.fixture
  summary.fixture = workspace.fixture
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'config.toml'), codexConfigFor(model.port))
  let cdp = await launch('a', workspace.port, VERSION_A)
  await cdp.evaluate(
    'return await window.api.updates.set({checkAutomatically:true,channel:"stable"})',
  )
  workspace.result.initialCredential = await saveRehearsalCodexKey(cdp)
  const conversations = []
  for (let index = 0; index < 2; index++) {
    const turn = { index, phase: 'creating', steps: [] }
    workspace.fixture.turns.push(turn)
    const prompt = `${workspace.name} fictional conversation ${index}: café ☕`
    const sessionId = await startLocalModelTurn(cdp, prompt, {
      answerARefusal: true,
      record: (phase, facts) => {
        turn.phase = phase
        turn.steps.push({ phase, ...facts })
      },
    })
    conversations.push(sessionId)
    await waitFor(async () => {
      turn.history = await localModelTurnFacts(cdp, sessionId, prompt)
      return (
        turn.history.responseRecorded &&
        model.requests.some((one) => one.responseId === turn.history.responseId && one.completed)
      )
    }, `${workspace.name} fictional response is persisted`)
    turn.phase = 'completed'
    turn.sessionId = sessionId
    turn.responseId = turn.history.responseId
  }
  for (const sessionId of conversations)
    await cdp.evaluate(
      `return await window.api.runtime.close({sessionId:${JSON.stringify(sessionId)}})`,
    )
  await quit()
  cdp.close()
  const settled = databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true })
  cdp = await launch('a-settled', workspace.port, VERSION_A)
  dataPreserved(settled, databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true }))
  await cdp.evaluate(
    `return await window.api.workspaces.rename({path:${JSON.stringify(data)},name:${JSON.stringify(workspace.name)}})`,
  )
  await click(cdp, '[data-cy=prompt-input]')
  await cdp.send('Input.insertText', { text: workspace.draft })
  await waitFor(
    () =>
      cdp.evaluate(
        `return (await window.api.savedDrafts())?.drafts.some(one=>one.text===${JSON.stringify(workspace.draft)})`,
      ),
    `${workspace.name} distinct unsent draft is saved`,
  )
  workspace.cdp = cdp
  workspace.conversations = conversations
  workspace.beforeButtons = databaseSnapshot(join(data, 'brobot2.sqlite'), {
    credentials: true,
    movedState: true,
  })
  workspace.stateBeforeButtons = stateBytes(data, workspace.beforeButtons)
  workspace.nativeBeforeButtons = await nativeFiles(nativeRoot, data)
  nativeTranscriptsPresent(workspace.beforeButtons, workspace.nativeBeforeButtons)
  requireEvidence(
    workspace.stateBeforeButtons['provider-usage.json'] !== undefined,
    'Provider usage fixture is missing.',
  )
  workspace.result.baselineVersion = VERSION_A
  workspace.result.baselinePid = active.pid
  await writeFile(
    join(evidence, 'a-before-update.json'),
    JSON.stringify(
      {
        database: workspace.beforeButtons,
        state: stateSummary(workspace.stateBeforeButtons),
        native: workspace.nativeBeforeButtons,
      },
      null,
      2,
    ),
  )
  passed('distinct-fictional-workspace-seeded-and-left-running', {
    data,
    conversations,
    pid: active.pid,
  })
}

async function allRunning(version, phase) {
  if (currentWorkspace) currentWorkspace.active = active
  const records = []
  for (const workspace of workspaces) {
    const child = workspace.active
    requireEvidence(child, 'One of the three workspace processes is missing.')
    assertOwnedProcess(child, await processInfo(child.pid), app, workspace.port)
    const info = await workspace.cdp.evaluate('return await window.api.getAppInfo()')
    requireEvidence(
      info.version === version &&
        info.workspace.path === workspace.data &&
        info.workspace.isDefault === workspace.isDefault &&
        info.build.commit === sourceFor(version) &&
        info.build.dirty === false,
      'Concurrent workspace identity differs.',
    )
    records.push({
      name: workspace.name,
      pid: child.pid,
      started: child.started,
      command: child.command,
      version: info.version,
      source: info.build.commit,
      dirty: info.build.dirty,
      path: info.workspace.path,
    })
  }
  assertThreeWorkspaceStates(records, workspaces, app, version, sourceFor(version))
  summary[phase] = records
  passed('all-three-workspaces-concurrently-use-the-same-installed-app', records)
}

async function quitAll(stage, except = null) {
  for (const workspace of workspaces) {
    if (workspace === except) continue
    selectWorkspace(workspace)
    const child = active
    await quit()
    workspace.active = null
    workspace.cdp?.close()
    if (child) {
      const log = await readFile(child.log, 'utf8')
      requireEvidence(
        /BroCrew shut down in \d+ms/.test(log),
        'A workspace lacks its normal shutdown receipt.',
      )
      for (const step of [
        'close its sessions',
        'keep its unsent drafts',
        'drain its archive work',
        'close its database',
      ])
        requireEvidence(
          log.includes(step) && !log.includes(`BroCrew failed to ${step}:`),
          `Workspace shutdown did not complete ${step}.`,
        )
      workspace.result.shutdowns ??= []
      workspace.result.shutdowns.push({
        stage,
        pid: child.pid,
        signal: 'SIGTERM',
        normalLifetimeDrain: true,
      })
    }
  }
  if (except === null) await requireNoInstalledProcesses()
}

async function nativeDownload(workspace, published) {
  selectWorkspace(workspace)
  const cdp = workspace.cdp
  await openUpdates(cdp)
  await cdp.evaluate('return await window.api.updates.checkNow()')
  await waitFor(async () => {
    const state = (await cdp.evaluate('return await window.api.updates.read()')).state
    if (state.kind === 'error') throw new Error(state.message)
    return state.kind === 'available' && state.version === VERSION_B
  }, 'the published version offers the candidate')
  await screenshot(cdp, 'a-offers-candidate.png')
  await click(cdp, '[data-cy=updates-download]')
  await waitFor(
    async () => {
      const state = (await cdp.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'ready' && state.how === 'restart' && state.version === VERSION_B
    },
    'native ZIP download and preparation finish',
    600_000,
  )
  const appUpdate = await readFile(join(app, 'Contents', 'Resources', 'app-update.yml'), 'utf8')
  const cacheName = /^updaterCacheDirName: ['"]?([^'"\n]+)['"]?$/m.exec(appUpdate)?.[1]
  requireEvidence(cacheName, 'The packaged updater cache name is missing.')
  const pending = join(homedir(), 'Library', 'Caches', cacheName, 'pending')
  const cached = JSON.parse(await readFile(join(pending, 'update-info.json'), 'utf8'))
  const zip = join(pending, cached.fileName)
  requireEvidence(
    (await realpath(zip)) === zip &&
      (await lstat(zip)).size === published.size &&
      (await digest(zip, 'sha512', 'base64')) === published.sha512,
    'Downloaded ZIP bytes or feed SHA-512 differ.',
  )
  const unpacked = join(fixtureRoot, 'signed-upgrade-downloaded-b')
  await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked])
  await quarantine(zip, 'downloaded-zip')
  summary.download = {
    zip,
    ...published,
    bundle: await bundleChecked(join(unpacked, 'BroCrew.app'), VERSION_B),
  }
  transport.requireHealthy()
  await screenshot(cdp, 'a-ready-to-restart.png')
  passed('native-download-zip-sha512-and-signed-bundle', summary.download)
}

async function quitSquirrelApp() {
  if (squirrelApp === null) return
  const current = await processInfo(squirrelApp.pid)
  requireEvidence(
    current && current.started === squirrelApp.started && current.command === squirrelApp.command,
    'Restarted test process identity changed before quit.',
  )
  process.kill(squirrelApp.pid, 'SIGTERM')
  await waitFor(
    async () => !(await processInfo(squirrelApp.pid)),
    'Squirrel-restarted B quits normally',
    60_000,
  )
  squirrelApp = null
}

async function nativeRestart(workspace) {
  selectWorkspace(workspace)
  const previous = active
  await click(workspace.cdp, '[data-cy=updates-restart]')
  await waitFor(async () => !(await processInfo(previous.pid)), 'A quits for Squirrel.Mac', 60_000)
  const shutdown = await readFile(previous.log, 'utf8')
  requireEvidence(
    shutdown.includes(`updates: restarting to install ${VERSION_B}`) &&
      /BroCrew shut down in \d+ms/.test(shutdown) &&
      ['close its sessions', 'keep its unsent drafts', 'drain its archive work', 'close its database']
        .every((step) => shutdown.includes(step) && !shutdown.includes(`BroCrew failed to ${step}:`)),
    'The native restart did not record the install choice and normal A shutdown.',
  )
  workspace.result.shutdowns ??= []
  workspace.result.shutdowns.push({
    stage: 'native-restart',
    pid: previous.pid,
    normalLifetimeDrain: true,
  })
  active = null
  workspace.active = null
  previous.browser.close()
  workspace.cdp.close()
  await waitFor(
    async () => {
      try {
        return packageOfAsar(join(app, 'Contents', 'Resources', 'app.asar')).version === VERSION_B
      } catch {
        return false
      }
    },
    'Squirrel.Mac replaces A with B',
    600_000,
  )
  squirrelApp = await waitFor(async () => {
    const listing = await run('/bin/ps', ['-axo', 'pid=,command='])
    const line = listing.split('\n').find((one) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(one)
      return (
        match &&
        Number(match[1]) !== previous.pid &&
        (match[2] === `${app}/Contents/MacOS/BroCrew` ||
          match[2].startsWith(`${app}/Contents/MacOS/BroCrew `))
      )
    })
    return line ? processInfo(Number(/^\s*(\d+)/.exec(line)[1])) : null
  }, 'Squirrel.Mac automatically starts B')
  const startup = await waitFor(async () => {
    const receipt = JSON.parse(await readFile(join(data, 'backups', 'retention.json'), 'utf8'))
    return receipt.appVersion === VERSION_B && receipt.successfulStarts === 1 ? receipt : null
  }, 'Squirrel first start completes recovery and opens its database')
  const completed = await completedProofCopy(data, new Set(workspace.baseline.copiesBefore))
  requireEvidence(
    completed.manifest.madeBy?.appVersion === VERSION_B &&
      completed.manifest.madeBy?.build === candidate.source,
    'The native first start did not finish its candidate recovery copy.',
  )
  summary.installedCandidate = await bundleChecked(app, VERSION_B)
  summary.replacementCount++
  workspace.result.nativeStartup = { ...startup, completedCheckpointId: completed.manifest.id }
  summary.restart = {
    previous: { pid: previous.pid, command: previous.command, started: previous.started },
    restarted: squirrelApp,
    startup,
    completedCheckpointId: completed.manifest.id,
    package: summary.installedCandidate,
  }
  passed('squirrel-replacement-restart-and-first-start', summary.restart)
  await quitSquirrelApp()
  await requireNoInstalledProcesses()
}

async function captureBaseline(workspace, registryBefore, settingsBefore) {
  selectWorkspace(workspace)
  const before = databaseSnapshot(join(data, 'brobot2.sqlite'), {
    credentials: true,
    movedState: true,
  })
  const files = stateBytes(data)
  const state = stateBytes(data, before),
    natives = await nativeFiles(nativeRoot, data)
  dataPreserved(workspace.beforeButtons, before, { allowAppended: true })
  statePreserved(workspace.stateBeforeButtons, state)
  credentialPreserved(workspace.beforeButtons.provider_api_key, before.provider_api_key)
  await checkNativePrefixes(workspace.nativeBeforeButtons, data)
  workspace.result.baselineDatabase = {
    bytes: (await lstat(join(data, 'brobot2.sqlite'))).size,
    sha256: await digest(join(data, 'brobot2.sqlite')),
  }
  workspace.baseline = {
    before,
    state,
    files,
    natives,
    settingsBefore,
    registryBefore,
    permissions: fixturePermissions(data, Object.keys(natives)),
    copiesBefore: await checkpointIds(data),
  }
  await writeFile(
    join(evidence, 'a-settled-baseline.json'),
    JSON.stringify(
      {
        database: before,
        state: stateSummary(state),
        native: natives,
        permissions: workspace.baseline.permissions,
        registry: registryBefore,
      },
      null,
      2,
    ),
  )
}

async function reopenFirst(workspace) {
  selectWorkspace(workspace)
  const baseline = workspace.baseline
  const launched = performance.now()
  const cdp = await launch('b-first', workspace.port, VERSION_B)
  workspace.cdp = cdp
  const responsive = performance.now()
  const manifestAbsent = !(await proofManifests(data)).some(
    (one) => !baseline.copiesBefore.includes(one.manifest.id),
  )
  const observation = { launched, responsive, absent: performance.now(), manifestAbsent }
  await completedProofCopy(data, new Set(baseline.copiesBefore))
  if (!workspace.result.nativeStartup)
    await waitFor(
      async () => (await readFile(join(evidence, 'b-first.log'), 'utf8')).split(/\r?\n/).includes(CHECKPOINT_LINE),
      'the candidate records its finished background copy',
      600_000,
    )
  observation.completed = performance.now()
  const log = await readFile(join(evidence, 'b-first.log'), 'utf8')
  const order = workspace.result.nativeStartup
    ? recoveryOrder(log, { checkpoint: false })
    : startOrder(log, { checkpoint: true, completion: 'functional-background', observation })
  const added = (await checkpointIds(data)).filter((id) => !baseline.copiesBefore.includes(id))
  requireEvidence(
    added.length === 1,
    'The candidate must make exactly one checked recovery copy per workspace.',
  )
  if (workspace.result.nativeStartup)
    requireEvidence(
      workspace.result.nativeStartup.completedCheckpointId === added[0],
      'The native first start did not record its recovery copy.',
    )
  const checkpoint = join(data, 'backups', added[0])
  const manifest = JSON.parse(await readFile(join(checkpoint, 'manifest.json'), 'utf8'))
  requireEvidence(
    manifest.madeBy?.appVersion === VERSION_B && manifest.madeBy?.build === candidate.source,
    'The recovery copy was not made by the candidate.',
  )
  const checked = verifyCheckpoint(
    { ...manifest, madeBy: { ...manifest.madeBy, appVersion: SAME_CODE_VERSION } },
    {
      ...stateBytes(checkpoint),
      'database.sqlite': await readFile(join(checkpoint, 'database.sqlite')),
    },
    {
      version: VERSION_B,
      source: candidate.source,
      id: added[0],
      workspaceId: (await readFile(join(data, 'backups', 'workspace-id'), 'utf8')).trim(),
      state: baseline.files,
      migrations: baseline.before.migrations.map((one) => ({
        createdAt: one.created_at,
        hash: one.hash,
      })),
    },
  )
  const copy = databaseSnapshot(join(checkpoint, 'database.sqlite'), {
    credentials: true,
    movedState: true,
  })
  statePreserved(baseline.state, stateBytes(checkpoint, copy))
  dataPreserved(baseline.before, copy)
  credentialPreserved(baseline.before.provider_api_key, copy.provider_api_key)
  const kept = await checkRetention(
    baseline.before,
    baseline.state,
    baseline.natives,
    baseline.settingsBefore,
    baseline.registryBefore,
  )
  permissionsKept(baseline.permissions, fixturePermissions(data, Object.keys(baseline.natives)))
  const drafts = await cdp.evaluate('return await window.api.savedDrafts()')
  requireEvidence(
    drafts?.drafts.some((one) => one.text === workspace.draft),
    'The candidate did not restore this workspace distinct draft.',
  )
  workspace.result.first = {
    path: data,
    version: VERSION_B,
    recovery: checked,
    order,
    data: kept.comparison,
  }
  await writeFile(join(evidence, 'b-first-data.json'), JSON.stringify(kept.after, null, 2))
  await writeFile(join(evidence, 'b-checkpoint-manifest.json'), JSON.stringify(manifest, null, 2))
  workspace.copiesAfterFirst = await checkpointIds(data)
  passed(
    'manually-reopened-workspace-keeps-data-draft-credential-ciphertext-and-modes',
    workspace.result.first,
  )
}

async function reopenSecond(workspace) {
  selectWorkspace(workspace)
  const baseline = workspace.baseline
  const cdp = await launch('b-second', workspace.port, VERSION_B)
  workspace.cdp = cdp
  recoveryOrder(await readFile(join(evidence, 'b-second.log'), 'utf8'), { checkpoint: false })
  requireEvidence(
    isDeepStrictEqual(await checkpointIds(data), workspace.copiesAfterFirst),
    'Second start made another recovery copy.',
  )
  await checkRetention(
    baseline.before,
    baseline.state,
    baseline.natives,
    baseline.settingsBefore,
    baseline.registryBefore,
  )
  await openUpdates(cdp)
  await click(cdp, '[data-cy=updates-check]')
  await waitFor(async () => {
    const read = await cdp.evaluate('return await window.api.updates.read()')
    if (read.state.kind === 'error') throw new Error(read.state.message)
    return (
      read.state.kind === 'idle' &&
      read.state.upToDate &&
      read.version === VERSION_B &&
      read.channel === 'stable' &&
      read.checkAutomatically
    )
  }, 'the signed candidate does not offer itself or change settings')
  const requestsBefore = model.requests.length
  const unreadable = await cdp.evaluate(
    "return await window.api.runtime.apiKeyStatus({provider:'codex'})",
  )
  const reason = 'Saved key can’t be read, save it again in Settings.'
  requireEvidence(
    unreadable.provider === 'codex' &&
      unreadable.set &&
      !unreadable.inUse &&
      unreadable.readState === 'unreadable' &&
      unreadable.unreadableReason === reason,
    'The predecessor sealed key did not report its plain unreadable state.',
  )
  const refusal = await cdp.evaluate(`try {
    await window.api.runtime.resume({sessionId:${JSON.stringify(workspace.conversations[0])}})
    return null
  } catch(error) { return error.message }`)
  requireEvidence(
    refusal === `Error invoking remote method 'runtime:command': Error: ${reason}`,
    'Resuming with the predecessor sealed key did not give its exact refusal.',
  )
  requireEvidence(
    model.requests.length === requestsBefore,
    'The unreadable key reached the scripted model before being saved again.',
  )
  credentialPreserved(
    baseline.before.provider_api_key,
    databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true }).provider_api_key,
  )
  workspace.result.unreadableCredential = {
    reason,
    refusal,
    modelRequests: model.requests.length - requestsBefore,
  }
  workspace.result.resavedCredential = await saveRehearsalCodexKey(cdp)
  const prompt = `${workspace.name} fictional resumed turn after the guided replacement`
  await startLocalModelTurn(cdp, prompt, { sessionId: workspace.conversations[0] })
  let history
  await waitFor(async () => {
    history = await localModelTurnFacts(cdp, workspace.conversations[0], prompt)
    return (
      history.responseRecorded &&
      model.requests.some((one) => one.responseId === history.responseId && one.completed)
    )
  }, 'same conversation resumes through the local scripted model')
  const credential = await cdp.evaluate(
    "return await window.api.runtime.apiKeyStatus({provider:'codex'})",
  )
  workspace.result.credential = {
    provider: credential.provider,
    set: credential.set,
    inUse: credential.inUse,
    readState: credential.readState ?? null,
    setAt: credential.setAt,
  }
  requireEvidence(
    credential.provider === 'codex' &&
      credential.set &&
      credential.inUse &&
      credential.readState !== 'unreadable',
    'The fictional credential saved again is inaccessible.',
  )
  await cdp.evaluate(
    `return await window.api.runtime.close({sessionId:${JSON.stringify(workspace.conversations[0])}})`,
  )
  workspace.result.second = {
    path: data,
    version: VERSION_B,
    resumedConversation: workspace.conversations[0],
    responseId: history.responseId,
  }
  await screenshot(cdp, 'b-second-restored.png')
  passed('second-start-resume-and-fictional-credential-access', workspace.result.second)
}

try {
  requireEvidence(
    !(await exists(app)) &&
      !(await exists(settings)) &&
      !(await exists(registry)) &&
      !(await exists(join(dataRoot, 'workspaces.json'))),
    'Runner already has BroCrew or its computer state.',
  )
  for (const workspace of workspaces)
    requireEvidence(!(await exists(workspace.data)), 'A fixture workspace already exists.')
  await mkdir(evidenceRoot, { recursive: true })
  const published = readUpdateFile(candidate.manifest).files.find((one) =>
    one.url.endsWith('-mac.zip'),
  )
  requireEvidence(published?.sha512 && published.size > 0, 'Candidate ZIP metadata is missing.')
  const baselineImage = join(
    predecessor.directory,
    diskImageFrom(predecessor.manifest, VERSION_A).url,
  )
  transport = await startControlledTransport({ folder: fixtureRoot, initial: predecessor })
  summary.controlledTransport = {
    address: transport.address,
    spki: transport.spki,
    requests: transport.requests,
    failures: transport.failures,
  }
  model = await aScriptedModel(null, () => new Date().toISOString())
  const attached = await plist('/usr/bin/hdiutil', [
    'attach',
    baselineImage,
    '-readonly',
    '-nobrowse',
    '-plist',
  ])
  mountedA = attached['system-entities'].find((one) => one['mount-point'])?.['mount-point']
  requireEvidence(mountedA, 'Public baseline disk image did not mount.')
  installedByHarness = true
  await run('/usr/bin/ditto', ['--rsrc', '--extattr', join(mountedA, 'BroCrew.app'), app])
  await run('/usr/bin/hdiutil', ['detach', mountedA])
  mountedA = null
  summary.baselineBundle = await bundleChecked(app, VERSION_A)
  for (const workspace of workspaces) await seedWorkspace(workspace)
  await allRunning(VERSION_A, 'concurrentBaseline')
  transport.switchTo(candidate)
  await nativeDownload(workspaces[0], published)
  await allRunning(VERSION_A, 'concurrentBeforeNormalQuit')
  await quitAll('baseline-peers-before-native-restart', workspaces[0])
  const registryBefore = JSON.parse(await readFile(registry, 'utf8')),
    settingsBefore = await readFile(settings)
  for (const workspace of workspaces)
    await captureBaseline(workspace, registryBefore, settingsBefore)
  await bundleChecked(app, VERSION_A)
  await nativeRestart(workspaces[0])
  for (const workspace of workspaces) await reopenFirst(workspace)
  await allRunning(VERSION_B, 'concurrentSignedFirst')
  await quitAll('candidate-first-reopening')
  for (const workspace of workspaces) await reopenSecond(workspace)
  await allRunning(VERSION_B, 'concurrentSignedSecond')
  await quitAll('candidate-second-reopening')
  for (const workspace of workspaces) {
    selectWorkspace(workspace)
    const baseline = workspace.baseline,
      after = databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true })
    dataPreserved(baseline.before, after, { allowAppended: true })
    credentialPreserved(baseline.before.provider_api_key, after.provider_api_key, { resaved: true })
    const keys = JSON.parse(await readFile(join(data, 'api-keys.json'), 'utf8'))
    requireEvidence(
      keys.version === 1 &&
        isDeepStrictEqual(keys.keys, {
          codex: {
            key: 'sk-update-rehearsal-not-a-real-key',
            setAt: workspace.result.credential.setAt,
          },
        }) &&
        keys.cantRead === undefined,
      'Saving the fictional key again did not keep its current plain-file state.',
    )
    await checkNativePrefixes(baseline.natives, data)
    permissionsKept(baseline.permissions, fixturePermissions(data, Object.keys(baseline.natives)))
    workspace.result.finalDatabase = {
      bytes: (await lstat(join(data, 'brobot2.sqlite'))).size,
      sha256: await digest(join(data, 'brobot2.sqlite')),
    }
    workspace.result.verified = true
  }
  transport.requireHealthy()
  requireEvidence(
    summary.replacementCount === 1 && summary.workspaces.every((one) => one.verified),
    'Three-workspace native proof is incomplete.',
  )
  summary.success = true
} catch (error) {
  summary.success = false
  summary.failure = error.stack ?? String(error)
  console.error(summary.failure)
  process.exitCode = 1
  await keepModelFailureEvidence(model, evidenceRoot, summary, writeFile)
  if (active?.cdp) {
    try {
      const turn = currentWorkspace?.fixture?.turns.at(-1)
      const sessionId = turn?.steps.findLast((step) => step.sessionId)?.sessionId
      if (sessionId) {
        const history = await active.cdp.evaluate(
          `return await window.api.runtime.latestHistory({sessionId:${JSON.stringify(sessionId)}})`,
        )
        await writeFile(
          join(evidence, `${active.stage}-history-failure.json`),
          JSON.stringify({ stage: active.stage, sessionId, turn, history }, null, 2),
        )
      }
    } catch (diagnosticError) {
      summary.historyDiagnosticFailure = String(diagnosticError)
    }
  }
  try {
    await run('/usr/sbin/screencapture', ['-x', join(evidence, 'failure-desktop.png')])
  } catch (diagnosticError) {
    summary.desktopCaptureFailure = String(diagnosticError)
  }
  if (active?.cdp) {
    try {
      summary.credentialAtFailure = await active.cdp.evaluate(
        "return await window.api.runtime.apiKeyStatus({provider:'codex'})",
      )
      await screenshot(active.cdp, `${active.stage}-failure.png`)
    } catch (diagnosticError) {
      summary.diagnosticFailure = String(diagnosticError)
    }
  }
} finally {
  if (currentWorkspace) currentWorkspace.active = active
  for (const workspace of workspaces) {
    selectWorkspace(workspace)
    if (active) {
      try {
        await quit()
        workspace.active = null
      } catch (error) {
        summary.cleanupFailure = String(error)
        summary.success = false
        process.exitCode = 1
      }
    }
  }
  try {
    await quitSquirrelApp()
  } catch (error) {
    summary.cleanupFailure = String(error)
    summary.success = false
    process.exitCode = 1
  }
  for (const channel of channels) channel.close()
  for (const mount of [mountedA])
    if (mount) {
      try {
        await run('/usr/bin/hdiutil', ['detach', mount])
      } catch (error) {
        summary.cleanupFailure = String(error)
        summary.success = false
        process.exitCode = 1
      }
    }
  if (installedByHarness) {
    try {
      await requireNoInstalledProcesses()
      await rm(app, { recursive: true })
      summary.cleanup = {
        appRemoved: !(await exists(app)),
        fictionalWorkspaceDataRetained: workspaces.map((one) => one.data),
      }
      requireEvidence(summary.cleanup.appRemoved, 'Installed test app remains after cleanup.')
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  }
  if (transport) {
    try {
      await transport.close()
      transport.requireHealthy()
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  }
  if (model) {
    model.closeAllConnections()
    await new Promise((done) => model.close(done))
  }
  delete summary.fixture
  await mkdir(evidenceRoot, { recursive: true })
  summary.result = resultLine({
    failures: summary.success ? [] : ['guided proof failed'],
    knownLimits: summary.knownLimits,
  })
  console.log(summary.result)
  await writeFile(join(evidenceRoot, 'summary.json'), JSON.stringify(summary, null, 2))
  if (summary.success !== true) process.exitCode = 1
}
