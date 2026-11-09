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
  downloadedImagePath,
  hash,
  mountedImageOf,
  packagedRegistryFile,
  nativeTranscriptsPresent,
  recoveryOrder,
  requireEvidence,
  statePreserved,
  startLocalModelTurn,
  localModelTurnFacts,
  stateBytes,
  stateSummary,
  VERSION_B as SAME_CODE_VERSION,
  verifyCheckpoint,
} from './lib/mac-update-test.mjs'
import { startControlledTransport } from './mac-signed-upgrade-transport.mjs'
import { resultLine } from './lib/upgrade-path.mjs'
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
} from './lib/update-rehearsal-app.mjs'

// Only disposable GitHub-hosted arm64 runners may install.
assertHostedMac(process.env, process.platform, process.arch)
const { values } = parseArgs({
  options: {
    predecessor: { type: 'string' },
    'predecessor-source': { type: 'string' },
    candidate: { type: 'string' },
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
const candidate = await releaseFolder(values.candidate, process.env.GITHUB_SHA)
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
const downloads = join(homedir(), 'Downloads')
const exec = promisify(execFile)
const summary = {
  format: 'brocrew-mac-upgrade-proof-v1',
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  harnessSource: process.env.GITHUB_SHA,
  from: { version: VERSION_A, source: predecessor.source },
  to: { version: VERSION_B, source: candidate.source },
  mode: 'guided',
  workspaceCount: 3,
  workspaces: workspaces.map((one) => one.result),
  replacementCount: 0,
  sameCode: false,
  scriptedCopyIsFinderDrag: false,
  quarantineAppliedByFixture: { image: false, installedApp: false },
  assertions: [],
  knownLimits: [],
  launches: [],
  launchAttempts: [],
  quarantine: [],
}
let active = null,
  model = null,
  mountedA = null,
  mountedCandidate = null,
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
async function requireNoInstalledProcesses() {
  const listing = await run('/bin/ps', ['-axo', 'pid=,command='])
  const processes = listing.split('\n').filter((line) => line.includes(`${app}/Contents/`))
  requireEvidence(processes.length === 0, `Installed app processes remain: ${processes.join('; ')}`)
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
  const after = databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true })
  const comparison = dataPreserved(before, after)
  credentialPreserved(before.provider_api_key, after.provider_api_key)
  statePreserved(state, stateBytes(data))
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
    let expected
    const sessionId = await startLocalModelTurn(
      cdp,
      `${workspace.name} fictional conversation ${index}: café ☕`,
      {
        answerARefusal: true,
        record: (phase, facts) => {
          turn.phase = phase
          turn.steps.push({ phase, ...facts })
          if (phase === 'conversation-created') expected = model.nextResponseId()
        },
      },
    )
    conversations.push(sessionId)
    await waitFor(async () => {
      turn.history = await localModelTurnFacts(cdp, sessionId, expected)
      return (
        turn.history.responseRecorded &&
        model.requests.some((one) => one.responseId === expected && one.completed)
      )
    }, `${workspace.name} fictional response is persisted`)
    turn.phase = 'completed'
    turn.sessionId = sessionId
    turn.responseId = expected
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
  workspace.beforeButtons = databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true })
  workspace.stateBeforeButtons = stateBytes(data)
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

async function quitAll(stage) {
  for (const workspace of workspaces) {
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
  await requireNoInstalledProcesses()
}

async function guidedDownload(workspace, published) {
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
      return state.kind === 'ready' && state.how === 'opened' && state.version === VERSION_B
    },
    'real guided download/SHA/open finishes',
    600_000,
  )
  const image = downloadedImagePath(
    (await cdp.evaluate('return await window.api.updates.read()')).state,
    downloads,
  )
  requireEvidence((await realpath(image)) === image, 'Downloaded image path differs.')
  let mounted = await waitFor(
    async () => mountedImageOf(await plist('/usr/bin/hdiutil', ['info', '-plist']), image),
    'the app actually opens and mounts its downloaded DMG',
  )
  mountedCandidate = mounted.mount
  await run('/usr/bin/xattr', [
    '-w',
    'com.apple.quarantine',
    `0083;${Math.floor(Date.now() / 1000).toString(16)};BroCrew controlled download fixture;`,
    image,
  ])
  summary.quarantineAppliedByFixture.image = true
  await quarantine(image, 'fresh-download-quarantine-fixture')
  await run('/usr/bin/hdiutil', ['detach', mounted.mount])
  mountedCandidate = null
  await click(cdp, '[data-cy=updates-open-again]')
  mounted = await waitFor(
    async () => mountedImageOf(await plist('/usr/bin/hdiutil', ['info', '-plist']), image),
    'real app reopens its quarantined image',
  )
  mountedCandidate = mounted.mount
  const finder = await run('/usr/bin/osascript', [
    '-e',
    `tell application "Finder"
set found to {}
repeat with w in Finder windows
try
set end of found to POSIX path of (target of w as alias)
end try
end repeat
return found
end tell`,
  ])
  requireEvidence(
    finder.includes(mounted.mount + '/'),
    'Finder has no window for the app-opened candidate DMG.',
  )
  await run('/usr/sbin/screencapture', ['-x', join(evidence, 'finder-opened-dmg.png')])
  const guided = await cdp.evaluate(
    'return document.querySelector("[data-cy=updates-said]")?.textContent.replace(/\\s+/g," ").trim()',
  )
  requireEvidence(
    guided ===
      `BroCrew ${VERSION_B} is downloaded and opened. Quit every open copy of BroCrew, then drag the new one into Applications.`,
    'Guided quit-every-copy text differs.',
  )
  requireEvidence(
    await cdp.evaluate('return document.querySelector("[data-cy=updates-restart]") === null'),
    'The baseline unexpectedly offers automatic replacement.',
  )
  await screenshot(cdp, 'guided-quit-every-copy.png')
  await run('/usr/bin/xcrun', ['stapler', 'validate', image])
  await run('/usr/sbin/spctl', [
    '--assess',
    '--verbose=4',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    image,
  ])
  const source = join(mounted.mount, 'BroCrew.app')
  summary.download = {
    image,
    ...published,
    finder: finder.trim(),
    guided,
    bundle: await bundleChecked(source, VERSION_B),
  }
  transport.requireHealthy()
  passed('guided-download-finder-quarantine-and-message', summary.download)
  return source
}

async function captureBaseline(workspace, registryBefore, settingsBefore) {
  selectWorkspace(workspace)
  const before = databaseSnapshot(join(data, 'brobot2.sqlite'), { credentials: true })
  const state = stateBytes(data),
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
  const cdp = await launch('b-first', workspace.port, VERSION_B)
  workspace.cdp = cdp
  const order = recoveryOrder(await readFile(join(evidence, 'b-first.log'), 'utf8'), {
    checkpoint: true,
  })
  const added = (await checkpointIds(data)).filter((id) => !baseline.copiesBefore.includes(id))
  requireEvidence(
    added.length === 1,
    'The candidate must make exactly one checked recovery copy per workspace.',
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
      state: baseline.state,
      migrations: baseline.before.migrations.map((one) => ({
        createdAt: one.created_at,
        hash: one.hash,
      })),
    },
  )
  const copy = databaseSnapshot(join(checkpoint, 'database.sqlite'), { credentials: true })
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
  let expected
  await startLocalModelTurn(
    cdp,
    `${workspace.name} fictional resumed turn after the guided replacement`,
    {
      sessionId: workspace.conversations[0],
      record: (phase) => {
        if (phase === 'conversation-resumed') expected = model.nextResponseId()
      },
    },
  )
  await waitFor(
    async () =>
      (await localModelTurnFacts(cdp, workspace.conversations[0], expected)).responseRecorded &&
      model.requests.some((one) => one.responseId === expected && one.completed),
    'same conversation resumes through the local scripted model',
  )
  const credential = await cdp.evaluate(
    "return await window.api.runtime.apiKeyStatus({provider:'codex'})",
  )
  workspace.result.credential = {
    provider: credential.provider,
    set: credential.set,
    inUse: credential.inUse,
    readState: credential.readState ?? null,
  }
  requireEvidence(
    credential.provider === 'codex' &&
      credential.set &&
      credential.inUse &&
      credential.readState !== 'unreadable',
    'The fictional saved credential is inaccessible after the signing transition.',
  )
  await cdp.evaluate(
    `return await window.api.runtime.close({sessionId:${JSON.stringify(workspace.conversations[0])}})`,
  )
  workspace.result.second = {
    path: data,
    version: VERSION_B,
    resumedConversation: workspace.conversations[0],
    responseId: expected,
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
  const published = diskImageFrom(candidate.manifest, VERSION_B)
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
  const source = await guidedDownload(workspaces[0], published)
  await allRunning(VERSION_A, 'concurrentBeforeNormalQuit')
  await quitAll('baseline-before-single-replacement')
  const registryBefore = JSON.parse(await readFile(registry, 'utf8')),
    settingsBefore = await readFile(settings)
  for (const workspace of workspaces)
    await captureBaseline(workspace, registryBefore, settingsBefore)
  await bundleChecked(app, VERSION_A)
  await requireNoInstalledProcesses()
  await rm(app, { recursive: true })
  await run('/usr/bin/ditto', ['--rsrc', '--extattr', source, app])
  summary.replacementCount++
  await run('/usr/bin/xattr', [
    '-w',
    'com.apple.quarantine',
    `0083;${Math.floor(Date.now() / 1000).toString(16)};BroCrew controlled download fixture;`,
    app,
  ])
  summary.quarantineAppliedByFixture.installedApp = true
  await quarantine(app, 'installed-signed-candidate')
  summary.installedCandidate = await bundleChecked(app, VERSION_B)
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
    credentialPreserved(baseline.before.provider_api_key, after.provider_api_key)
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
    'Three-workspace guided proof is incomplete.',
  )
  summary.success = true
} catch (error) {
  summary.success = false
  summary.failure = error.stack ?? String(error)
  console.error(summary.failure)
  process.exitCode = 1
  if (model) {
    try {
      await writeFile(
        join(evidenceRoot, 'model-failure.json'),
        JSON.stringify({ log: model.log, requests: model.requests }, null, 2),
      )
    } catch (diagnosticError) {
      summary.modelDiagnosticFailure = String(diagnosticError)
    }
  }
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
  for (const channel of channels) channel.close()
  for (const mount of [mountedA, mountedCandidate])
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
