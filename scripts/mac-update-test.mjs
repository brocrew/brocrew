import {
  waitForNativeMacDownload,
  unpackDownloadedMacZip,
  quitRestartedMacApp,
  observeMacReplacement,
  macFirstStartReceipt,
} from './lib/mac-native-upgrade.mjs'
import { readUpdateFile } from './release-check.mjs'
import { parseArgs, isDeepStrictEqual } from 'node:util'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  checkedMacBundle,
  launchServicesArguments,
  exists,
  waitFor,
  macCommands,
  observeMacWindow,
  quitMacChild,
  databaseSnapshot,
  nativeFiles,
  checkpointIds,
  checkNativePrefixes,
  assertHostedMac,
  assertOwnedProcess,
  dataPreserved,
  diskImageFrom,
  FEED_URL,
  hash,
  packageOfAsar,
  packagedRegistryFile,
  nativeTranscriptsPresent,
  recoveryOrder,
  registryPreserved,
  requireEvidence,
  statePreserved,
  startLocalModelTurn,
  localModelTurnFacts,
  keepModelFailureEvidence,
  withMacKeychainRecovery,
  stateBytes,
  stateSummary,
  VERSION_A,
  VERSION_B,
} from './lib/mac-update-test.mjs'
import { verifyCheckpoint } from './lib/mac-update-test.mjs'
import { keychainEntryFor, resultLine } from './lib/upgrade-path.mjs'
import {
  appUpdateProblems,
  feedFromArgs,
  feedToken,
  servedUpdateFile,
} from './lib/update-rehearsal.mjs'
import {
  SCRIPTED_MODEL,
  aScriptedModel,
  saveRehearsalCodexKey,
  codexConfigFor,
  connectDevTools,
  press,
  screenshot as captureScreenshot,
  openUpdates,
} from './lib/update-rehearsal-app.mjs'

// 695-visible: the hosted Mac rehearsal checks the installed app's update UI and native restart.
// Installation, launches and process signals are confined to a fresh hosted runner.
assertHostedMac(process.env, process.platform, process.arch)
const { values } = parseArgs({
  options: {
    'dist-a': { type: 'string' },
    'dist-b': { type: 'string' },
    evidence: { type: 'string' },
    'feed-url': { type: 'string', default: FEED_URL },
    'serve-local': { type: 'boolean', default: false },
    'feed-github': { type: 'string' },
    'feed-private': { type: 'boolean', default: false },
    'marker-a': { type: 'string' },
    'marker-b': { type: 'string' },
    'source-sha': { type: 'string' },
  },
})
for (const name of ['dist-a', 'dist-b', 'evidence', 'marker-a', 'marker-b', 'source-sha'])
  requireEvidence(values[name], `Missing --${name}.`)
requireEvidence(values['marker-a'] !== values['marker-b'], 'Build markers must differ.')
requireEvidence(/^[a-f0-9]{40}$/.test(values['source-sha']), 'A frozen source SHA is required.')
const distA = resolve(values['dist-a']),
  distB = resolve(values['dist-b'])
const evidence = resolve(values.evidence),
  feedUrl = new URL(values['feed-url'])
// The feed the apps were built to read: the generic `--feed-url`, or `--feed-github OWNER/REPO`,
// read with this harness's GH_TOKEN when `--feed-private`.
const updateFeed = feedFromArgs(values)
const feedReadToken = feedToken(updateFeed, process.env)
if (values['serve-local'])
  requireEvidence(
    updateFeed.kind === 'generic' &&
      feedUrl.hostname === '127.0.0.1' &&
      feedUrl.pathname === '/' &&
      feedUrl.protocol === 'http:',
    'Local feed must bind to loopback.',
  )
const app = '/Applications/BroCrew.app',
  dataRoot = join(homedir(), 'Library', 'Application Support', '@brobot2')
const data = join(dataRoot, 'desktop')
const settings = join(dataRoot, 'settings.json')
const registry = packagedRegistryFile(dataRoot)
const codexHome = join(data, 'provider-homes', 'default', 'brobot', 'codex')
const nativeRoot = join(codexHome, 'sessions')
const summary = {
  runId: process.env.GITHUB_RUN_ID,
  source: values['source-sha'],
  feed: updateFeed,
  sameCode: true,
  installedBy: 'Squirrel.Mac',
  assertions: [],
  knownLimits: [],
  launches: [],
  launchAttempts: [],
  quarantine: [],
}
let active = null,
  feed = null,
  model = null,
  mountedA = null,
  squirrelApp = null
const channels = []
const { run, plist, processInfo } = macCommands()
const click = (cdp, selector) => press(cdp, selector, { wait: 180_000 })
async function connect(url) {
  const connection = await connectDevTools(url, { answerWithin: 60_000, connectWithin: 30_000 })
  channels.push(connection)
  return connection
}
const screenshot = (cdp, name) => captureScreenshot(cdp, join(evidence, name))

function passed(name, facts = true) {
  summary.assertions.push({ name, passed: true, facts })
  console.log(`PASS ${name}`)
}
async function quarantine(path, stage) {
  const attributes = await run('/usr/bin/xattr', ['-l', path])
  summary.quarantine.push({ stage, path, attributes, observedAt: new Date().toISOString() })
}
async function bundleChecked(bundle, version, marker) {
  return checkedMacBundle(bundle, version, marker, run)
}

async function launch(
  stage,
  port,
  version,
  marker,
  { expectedConversations = stage === 'a' ? 0 : 2 } = {},
) {
  const log = join(evidence, `${stage}.log`)
  await run(
    '/usr/bin/open',
    launchServicesArguments(app, evidence, stage, port, {
      environment: feedReadToken === null ? [] : [['GH_TOKEN', feedReadToken]],
    }),
  ).catch((error) => {
    // A failed command is said with its arguments: never with the feed's token.
    const said = String(error.message)
    throw new Error(feedReadToken === null ? said : said.split(feedReadToken).join('<token>'))
  })
  const { cdp, record } = await observeMacWindow({
    app,
    port,
    stage,
    log,
    expected: {
      version,
      source: values['source-sha'],
      data,
      isDefault: true,
      conversations: expectedConversations,
    },
    run,
    processInfo,
    connect,
    attempts: summary.launchAttempts,
    verifyBundle: () => bundleChecked(app, version, marker),
    onChild: (child) => {
      active = child
    },
  })
  summary.launches.push(record)
  await screenshot(cdp, `${stage}-window.png`)
  return cdp
}
async function quit() {
  active = await quitMacChild(active, app, processInfo, passed)
}
async function quitSquirrelApp() {
  squirrelApp = await quitRestartedMacApp(squirrelApp, processInfo)
}
/** On this fresh hosted runner, forget only this packaged app's sealing entry, never its password. */
async function forgetHostedSealingEntry() {
  const name = packageOfAsar(join(app, 'Contents', 'Resources', 'app.asar')).name
  requireEvidence(
    name === '@brobot2/desktop',
    'Unexpected packaged app name for the sealing entry.',
  )
  const { service, account } = keychainEntryFor(name)
  try {
    await run('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account])
  } catch (error) {
    if (error.code !== 44)
      throw new Error('The hosted app sealing entry could not be forgotten.', { cause: error })
  }
  try {
    await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account])
  } catch (error) {
    if (error.code !== 44)
      throw new Error('The hosted sealing entry absence could not be verified.', { cause: error })
    return
  }
  throw new Error('The hosted app sealing entry still exists.')
}

async function fixtureWithKeyRecovery(attempt, { getPage, setPage, stage, version, marker }) {
  let copiesBeforeFresh
  return withMacKeychainRecovery({
    platform: process.platform,
    attempt,
    posts: () => model.requests.filter((one) => one.post).length,
    keyStatus: () =>
      getPage().evaluate(`const status = await window.api.runtime.apiKeyStatus({provider:'codex'})
      return {providerMatches:status?.provider === 'codex',set:status?.set === true,inUse:status?.inUse === true,unreadable:status?.readState === 'unreadable'}`),
    recordLimit: (sentence, status) => {
      if (!summary.knownLimits.includes(sentence)) summary.knownLimits.push(sentence)
      summary.fixture.recoveries ??= []
      summary.fixture.recoveries.push({ stage, key: status })
    },
    stop: async () => {
      copiesBeforeFresh = await checkpointIds(data)
      const page = getPage()
      await quit()
      page.close()
    },
    forgetEntry: forgetHostedSealingEntry,
    start: async () => {
      const freshStage = `${stage}-fresh-key-${summary.fixture.recoveries.length}`
      const expectedConversations =
        stage === 'a'
          ? new Set(summary.fixture.turns.map((one) => one.sessionId).filter(Boolean)).size
          : 2
      setPage(
        await launch(freshStage, stage === 'a' ? 9339 : 9341, version, marker, {
          expectedConversations,
        }),
      )
      requireEvidence(
        JSON.stringify(await checkpointIds(data)) === JSON.stringify(copiesBeforeFresh),
        'A fresh-key restart made an extra recovery copy.',
      )
      recoveryOrder(await readFile(join(evidence, `${freshStage}.log`), 'utf8'), {
        checkpoint: false,
      })
    },
    save: async () => {
      const facts = await saveRehearsalCodexKey(getPage(), {
        record: (one) => {
          summary.fixture.key = one
        },
      })
      passed('fresh-build-fixture-key-saved-and-usable', facts)
    },
  })
}

async function checkRetention(before, state, natives, settingsBefore, registryBefore) {
  const after = databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true })
  const comparison = dataPreserved(before, after, { usage: true })
  statePreserved(state, stateBytes(data))
  registryPreserved(registryBefore, JSON.parse(await readFile(registry, 'utf8')), data)
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

try {
  requireEvidence(
    !(await exists(app)) &&
      !(await exists(data)) &&
      !(await exists(settings)) &&
      !(await exists(registry)) &&
      !(await exists(join(dataRoot, 'workspaces.json'))),
    'Runner already has BroCrew or its data; refusing installation.',
  )
  await mkdir(evidence, { recursive: true })
  const metaA = diskImageFrom(await readFile(join(distA, 'latest-mac.yml'), 'utf8'), VERSION_A)
  const metaB = readUpdateFile(await readFile(join(distB, 'latest-mac.yml'), 'utf8')).files.find(
    (file) => file.url.endsWith('-arm64-mac.zip'),
  )
  requireEvidence(metaB, 'B has no updater ZIP.')
  let serving = distA
  if (values['serve-local']) {
    feed = createServer(async (request, response) => {
      try {
        const name = decodeURIComponent(new URL(request.url, feedUrl).pathname.slice(1))
        const permitted = new Set([
          'latest-mac.yml',
          ...(await readdir(serving)).filter((one) => /\.(dmg|zip|blockmap)$/.test(one)),
        ])
        summary.feedRequests ??= []
        summary.feedRequests.push({
          at: new Date().toISOString(),
          method: request.method,
          path: request.url,
          version: serving === distA ? VERSION_A : VERSION_B,
        })
        if (!permitted.has(name)) return response.writeHead(404).end()
        response.writeHead(200, {
          'content-type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        })
        createReadStream(join(serving, name))
          .on('error', (error) => response.destroy(error))
          .pipe(response)
      } catch {
        response.writeHead(500).end()
      }
    })
    await new Promise((done, failed) => {
      feed.once('error', failed)
      feed.listen(Number(feedUrl.port), '127.0.0.1', done)
    })
  }
  model = await aScriptedModel(null, () => new Date().toISOString())
  summary.fixture = {
    provider: 'codex',
    model: SCRIPTED_MODEL,
    phase: 'model-configured',
    modelRequests: model.requests,
    turns: [],
  }
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'config.toml'), codexConfigFor(model.port))
  const attached = await plist('/usr/bin/hdiutil', [
    'attach',
    join(distA, metaA.url),
    '-readonly',
    '-nobrowse',
    '-plist',
  ])
  mountedA = attached['system-entities'].find((one) => one['mount-point'])?.['mount-point']
  requireEvidence(mountedA, 'A disk image did not mount.')
  await quarantine(join(distA, metaA.url), 'packaged-a-image')
  await run('/usr/bin/ditto', ['--rsrc', '--extattr', join(mountedA, 'BroCrew.app'), app])
  await run('/usr/bin/hdiutil', ['detach', mountedA])
  mountedA = null
  const embeddedFeed = await readFile(`${app}/Contents/Resources/app-update.yml`, 'utf8')
  requireEvidence(
    appUpdateProblems(embeddedFeed, updateFeed).length === 0,
    `Installed A does not carry the declared feed: ${appUpdateProblems(embeddedFeed, updateFeed).join('; ')}`,
  )
  summary.embeddedFeed = embeddedFeed
  let cdpA = await launch('a', 9339, VERSION_A, values['marker-a'])
  await cdpA.evaluate(
    'return await window.api.updates.set({checkAutomatically:true,channel:"stable"})',
  )
  await openUpdates(cdpA)
  await waitFor(
    async () => {
      const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'idle' && state.upToDate && state.checkedAt !== null
    },
    'visible automatic check against A-only feed',
    60_000,
  )
  await screenshot(cdpA, 'a-automatic-check.png')
  passed('visible-automatic-check', await cdpA.evaluate('return await window.api.updates.read()'))
  await click(cdpA, '[data-cy=updates-check]')
  await waitFor(async () => {
    const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
    if (state.kind === 'error') throw new Error(state.message)
    return state.kind === 'idle' && state.upToDate
  }, 'A-only feed up to date')
  passed('installed-a-normal-launch-and-feed', { data, version: VERSION_A })
  summary.fixture.phase = 'saving-key'
  const keyStatus = await saveRehearsalCodexKey(cdpA, {
    record: (facts) => {
      summary.fixture.key = facts
    },
  })
  summary.fixture.phase = 'key-saved'
  passed('fixture-key-saved-and-usable', keyStatus)
  const conversations = []
  for (let index = 0; index < 2; index++) {
    const turn = { index, phase: 'creating-conversation', steps: [] }
    summary.fixture.turns.push(turn)
    const prompt = `Fictional rehearsal ${index}: café ☕`
    const sessionId = await fixtureWithKeyRecovery(
      () =>
        startLocalModelTurn(cdpA, prompt, {
          sessionId: turn.sessionId,
          answerARefusal: true,
          record: (phase, facts) => {
            summary.fixture.sessionId = facts.sessionId ?? null
            turn.phase = phase
            turn.steps.push({ phase, ...facts })
            if (phase === 'conversation-created' || phase === 'conversation-resumed') {
              turn.sessionId = facts.sessionId
              passed('fixture-conversation-created', facts)
            }
            if (phase === 'turn-sent') passed('fixture-turn-sent', facts)
          },
        }),
      {
        getPage: () => cdpA,
        setPage: (page) => {
          cdpA = page
        },
        stage: 'a',
        version: VERSION_A,
        marker: values['marker-a'],
      },
    )
    conversations.push(sessionId)
    turn.phase = 'awaiting-response'
    await waitFor(async () => {
      turn.history = await localModelTurnFacts(cdpA, sessionId, prompt)
      turn.modelResponseCompleted = model.requests.some(
        (one) => one.responseId === turn.history.responseId && one.completed,
      )
      return turn.history.responseRecorded && turn.modelResponseCompleted
    }, `A local-model turn recorded (turn ${index}; see fixture progress)`)
    turn.phase = 'response-recorded'
    turn.responseId = turn.history.responseId
    passed('fixture-response-recorded', { sessionId, responseId: turn.responseId })
  }
  for (const sessionId of conversations)
    await cdpA.evaluate(
      `return await window.api.runtime.close({sessionId:${JSON.stringify(sessionId)}})`,
    )
  await quit()
  cdpA.close()
  const settledFixture = databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true })
  await writeFile(
    join(evidence, 'a-fixture-before-relaunch.json'),
    JSON.stringify(settledFixture, null, 2),
  )
  cdpA = await launch('a-settled', 9339, VERSION_A, values['marker-a'])
  passed(
    'fictional-data-survives-a-settling-relaunch',
    dataPreserved(settledFixture, databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true }), {
      usage: true,
    }),
  )
  await waitFor(
    async () => {
      const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'idle' && state.upToDate && state.checkedAt !== null
    },
    'settled A automatic check completes against the A-only feed',
    60_000,
  )
  await cdpA.evaluate(
    `return await window.api.workspaces.rename({path:${JSON.stringify(data)},name:"Fictional café lab"})`,
  )
  await openUpdates(cdpA)
  // The draft is typed as a person types it: a press on the message box, then the words.
  await click(cdpA, '[data-cy=prompt-input]')
  await cdpA.send('Input.insertText', { text: 'Unsent fictional draft: café ☕' })
  await waitFor(
    () =>
      cdpA.evaluate(
        'return (await window.api.savedDrafts())?.drafts.some(one=>one.text==="Unsent fictional draft: café ☕")',
      ),
    'A saves real renderer draft',
  )
  Object.assign(summary.fixture, {
    conversations,
    phase: 'data-recorded',
    localModelRequests: model.requests.filter((one) => one.responseId !== null).length,
  })
  const registryFixture = JSON.parse(await readFile(registry, 'utf8'))
  const otherWorkspace = join(process.env.RUNNER_TEMP, 'fictional-other-workspace')
  await mkdir(otherWorkspace)
  registryFixture.workspaces.push({
    path: otherWorkspace,
    lastOpenedAt: 42,
    fictionalNote: 'Unopened café lab ☕',
  })
  await writeFile(registry, JSON.stringify(registryFixture, null, 2))
  const beforeButtons = databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true })
  const stateBeforeButtons = stateBytes(data)
  const nativeBeforeButtons = await nativeFiles(nativeRoot, data)
  const settingsBeforeButtons = await readFile(settings)
  requireEvidence(
    Object.keys(nativeBeforeButtons).length >= 2,
    'Pre-update native evidence is missing.',
  )
  nativeTranscriptsPresent(beforeButtons, nativeBeforeButtons)
  await writeFile(
    join(evidence, 'a-before-update-buttons.json'),
    JSON.stringify(
      {
        database: beforeButtons,
        state: stateSummary(stateBeforeButtons),
        native: nativeBeforeButtons,
        registry: registryFixture,
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(evidence, 'a-ready.json'),
    JSON.stringify({ source: summary.source, conversations, data }, null, 2),
  )
  serving = distB
  // A feed this harness does not serve publishes B once every lane is ready.
  const publishedText = await waitFor(
    async () => {
      const text = await servedUpdateFile(updateFeed, 'latest-mac.yml', {
        token: feedReadToken,
      }).catch(() => null)
      try {
        if (text !== null && readUpdateFile(text).version === VERSION_B) return text
      } catch {
        // still A's, or not yet whole
      }
      // Asked every 30 s: a GitHub feed answers a limited number of times an hour.
      await new Promise((done) => setTimeout(done, values['serve-local'] ? 250 : 30_000))
      return null
    },
    'the feed serves B',
    70 * 60_000,
  )
  const published = readUpdateFile(publishedText).files.find((file) =>
    file.url.endsWith('-arm64-mac.zip'),
  )
  requireEvidence(
    JSON.stringify(published) === JSON.stringify(metaB),
    'Served B feed differs from packaged metadata.',
  )
  await writeFile(join(evidence, 'latest-mac.yml'), publishedText)
  await openUpdates(cdpA)
  await click(cdpA, '[data-cy=updates-check]')
  await waitFor(async () => {
    const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
    if (state.kind === 'error') throw new Error(state.message)
    return state.kind === 'available' && state.version === VERSION_B
  }, 'window offers B')
  await screenshot(cdpA, 'a-offers-b.png')
  await click(cdpA, '[data-cy=updates-download]')
  await waitForNativeMacDownload(cdpA, VERSION_B, 'electron-updater ZIP download completes')
  const { zip, bundle: downloadedBundle } = await unpackDownloadedMacZip({
    app,
    published,
    unpacked: join(process.env.RUNNER_TEMP, 'mac-update-downloaded-b'),
    run,
  })
  await run('/usr/bin/xcrun', ['stapler', 'validate', downloadedBundle])
  await run('/usr/sbin/spctl', ['-a', '-vv', downloadedBundle])
  await quarantine(zip, 'downloaded-b-zip')
  summary.download = {
    ...published,
    zip,
    package: await bundleChecked(downloadedBundle, VERSION_B, values['marker-b']),
  }
  passed('window-download-zip-sha512-and-signed-bundle', summary.download)
  await screenshot(cdpA, 'a-ready-to-restart.png')
  const before = databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true }),
    state = stateBytes(data)
  const natives = await nativeFiles(nativeRoot, data),
    settingsBefore = await readFile(settings)
  const registryBefore = JSON.parse(await readFile(registry, 'utf8'))
  const beforeReplacement = dataPreserved(beforeButtons, before, {
    allowAppended: true,
    usage: true,
  })
  statePreserved(stateBeforeButtons, state)
  await checkNativePrefixes(nativeBeforeButtons, data)
  requireEvidence(
    settingsBefore.equals(settingsBeforeButtons),
    'Download changed computer settings.',
  )
  registryPreserved(registryFixture, registryBefore, data)
  passed('check-and-download-preserve-original-data-and-state', beforeReplacement)
  requireEvidence(Object.keys(natives).length >= 2, 'Native transcript evidence is missing.')
  nativeTranscriptsPresent(before, natives)
  const copiesBefore = await checkpointIds(data)
  await writeFile(
    join(evidence, 'a-data-baseline.json'),
    JSON.stringify(
      {
        database: before,
        state: stateSummary(state),
        natives,
        registry: registryBefore,
      },
      null,
      2,
    ),
  )
  await bundleChecked(app, VERSION_A, values['marker-a'])
  const previous = active
  await click(cdpA, '[data-cy=updates-restart]')
  await waitFor(async () => !(await processInfo(previous.pid)), 'A quits for Squirrel.Mac', 60_000)
  active = null
  previous.browser.close()
  cdpA.close()
  squirrelApp = await observeMacReplacement({ app, version: VERSION_B, previous, run, processInfo })
  const restarted = squirrelApp
  const startup = await macFirstStartReceipt(data, VERSION_B)
  summary.restart = {
    previous: { pid: previous.pid, command: previous.command, started: previous.started },
    restarted,
    startup,
    package: await bundleChecked(app, VERSION_B, values['marker-b']),
  }
  passed('squirrel-replacement-restart-and-first-start-recovery', summary.restart)
  const copies = await checkpointIds(data),
    added = copies.filter((one) => !copiesBefore.includes(one))
  requireEvidence(added.length === 1, 'B must make exactly one new checked recovery copy.')
  const checkpoint = join(data, 'backups', added[0]),
    manifest = JSON.parse(await readFile(join(checkpoint, 'manifest.json'), 'utf8'))
  const files = {
    ...stateBytes(checkpoint),
    'database.sqlite': await readFile(join(checkpoint, 'database.sqlite')),
  }
  const checked = verifyCheckpoint(manifest, files, {
    id: added[0],
    workspaceId: (await readFile(join(data, 'backups', 'workspace-id'), 'utf8')).trim(),
    source: summary.source,
    state,
    migrations: before.migrations.map((one) => ({ createdAt: one.created_at, hash: one.hash })),
  })
  const copyComparison = dataPreserved(
    before,
    databaseSnapshot(join(checkpoint, 'database.sqlite'), { usage: true }),
    { usage: true },
  )
  await writeFile(join(evidence, 'b-checkpoint-manifest.json'), JSON.stringify(manifest, null, 2))
  requireEvidence(
    startup.checkpointId === added[0],
    'First Squirrel start did not record its recovery copy.',
  )
  passed('b-checked-recovery-copy-before-database-open', {
    ...checked,
    startup,
    data: copyComparison,
  })
  await quitSquirrelApp()
  const cdpB = await launch('b-first', 9340, VERSION_B, values['marker-b'])
  recoveryOrder(await readFile(join(evidence, 'b-first.log'), 'utf8'), { checkpoint: false })
  const kept = await checkRetention(before, state, natives, settingsBefore, registryBefore)
  await writeFile(join(evidence, 'b-first-retained-data.json'), JSON.stringify(kept.after, null, 2))
  const restoredDrafts = await cdpB.evaluate('return await window.api.savedDrafts()')
  requireEvidence(
    restoredDrafts?.drafts.some((one) => one.text === 'Unsent fictional draft: café ☕'),
    'B did not read A drafts.',
  )
  passed('b-preserves-every-conversation-event-raw-byte-draft-and-state', kept.comparison)
  await quit()
  cdpB.close()
  const copiesAfterFirst = await checkpointIds(data)
  let cdpSecond = await launch('b-second', 9341, VERSION_B, values['marker-b'])
  recoveryOrder(await readFile(join(evidence, 'b-second.log'), 'utf8'), { checkpoint: false })
  requireEvidence(
    JSON.stringify(await checkpointIds(data)) === JSON.stringify(copiesAfterFirst),
    'Second B start made a new recovery copy.',
  )
  const secondKept = await checkRetention(before, state, natives, settingsBefore, registryBefore)
  await writeFile(
    join(evidence, 'b-second-retained-data.json'),
    JSON.stringify(secondKept.after, null, 2),
  )
  await openUpdates(cdpSecond)
  await click(cdpSecond, '[data-cy=updates-check]')
  await waitFor(async () => {
    const read = await cdpSecond.evaluate('return await window.api.updates.read()')
    if (read.state.kind === 'error') throw new Error(read.state.message)
    return (
      read.state.kind === 'idle' &&
      read.state.upToDate &&
      read.version === VERSION_B &&
      read.channel === 'stable' &&
      read.checkAutomatically
    )
  }, 'B does not offer itself or change update settings')
  const resumedPrompt = 'Fictional turn after the automatic update'
  await fixtureWithKeyRecovery(
    () =>
      startLocalModelTurn(cdpSecond, resumedPrompt, {
        sessionId: conversations[0],
        record: (_phase, facts) => {
          summary.fixture.sessionId = facts.sessionId ?? null
        },
      }),
    {
      getPage: () => cdpSecond,
      setPage: (page) => {
        cdpSecond = page
      },
      stage: 'b',
      version: VERSION_B,
      marker: values['marker-b'],
    },
  )
  await waitFor(async () => {
    const history = await localModelTurnFacts(cdpSecond, conversations[0], resumedPrompt)
    return (
      history.responseRecorded &&
      model.requests.some((one) => one.responseId === history.responseId && one.completed)
    )
  }, 'B resumes A through local model')
  passed('second-b-start-no-copy-no-self-offer-and-local-resume', {
    copies: copiesAfterFirst,
    replies: model.requests.filter((one) => one.responseId !== null).length,
    data: secondKept.comparison,
  })
  await screenshot(cdpSecond, 'b-second-ready.png')
  await quit()
  cdpSecond.close()
  summary.finalData = dataPreserved(
    before,
    databaseSnapshot(join(data, 'brobot2.sqlite'), { usage: true }),
    { allowAppended: true, usage: true },
  )
  await checkNativePrefixes(natives, data)
  summary.success = true
} catch (error) {
  summary.success = false
  summary.failure = error.stack ?? String(error)
  console.error(summary.failure)
  process.exitCode = 1
  await keepModelFailureEvidence(model, evidence, summary, writeFile)
  if (active?.cdp && summary.fixture?.sessionId) {
    try {
      const sessionId = summary.fixture.sessionId
      const history = await active.cdp.evaluate(
        `return await window.api.runtime.latestHistory({sessionId:${JSON.stringify(sessionId)}})`,
      )
      await writeFile(
        join(evidence, `${active.stage}-history-failure.json`),
        JSON.stringify({ stage: active.stage, sessionId, history }, null, 2),
      )
    } catch (diagnosticError) {
      summary.historyDiagnosticFailure = String(diagnosticError)
    }
  }
  if (active) {
    try {
      assertOwnedProcess(active, await processInfo(active.pid), app, active.port)
      await run(
        '/usr/bin/sample',
        [
          String(active.pid),
          '1',
          '1',
          '-file',
          join(evidence, `${active.stage ?? 'failed-launch'}-main.sample.txt`),
        ],
        { timeout: 15_000 },
      )
      summary.failedProcess = await processInfo(active.pid)
      if (active.cdp) await screenshot(active.cdp, `${active.stage}-failure.png`)
    } catch (diagnosticError) {
      summary.diagnosticFailure = String(diagnosticError)
    }
  }
} finally {
  if (squirrelApp) {
    try {
      await quitSquirrelApp()
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  }
  if (active)
    try {
      await quit()
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  for (const channel of channels) channel.close()
  if (mountedA)
    try {
      await run('/usr/bin/hdiutil', ['detach', mountedA])
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  for (const server of [feed, model])
    if (server) {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  await mkdir(evidence, { recursive: true })
  summary.result = resultLine({
    failures: summary.success ? [] : ['rehearsal failed'],
    knownLimits: summary.knownLimits,
  })
  console.log(summary.result)
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2))
  if (summary.success !== true) process.exitCode = 1
}
