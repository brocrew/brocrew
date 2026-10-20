import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
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
import { registerChild } from './runner-processes.mjs'
import { observeApp, probeStep, waitDevtools } from './probe.mjs'
import { failureFor, printFailure, stepFailure, printAppStderr, phaseStep } from './diagnostics.mjs'
import { integrityCheckpoint } from './integrity.mjs'
import { pageStateSnapshot, printPageState } from './page-state.mjs'
import { pluginStateSnapshot, printPluginState, unknownPluginState } from './plugin-state.mjs'
import { openPlugins, enabledProfile, pluginPage, pluginButton, waitFor } from './cdp.mjs'
import { requireSelection } from './matrix.mjs'
import { serveFixture, createProviderTurn, browserEvidence, waitTabs } from './browser-journey.mjs'
import { fixtureTitle } from './fake-browser.mjs'
import { providerState, printProviderState } from './provider-state.mjs'
import { providerErrorCategory } from './browser-journey.mjs'
// Kept in sync with the scripted provider; ordinary prompts retain the normal FakeRuntime behavior.
const openPrompt = 'Use Chrome to open the fern fixture page and read its title.'
const closePrompt = 'Use Chrome to close the fern fixture tab.'
export function readOwned(file, maximum = 32 * 1024) {
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  )
  try {
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || info.size > maximum)
      throw new Error('Invalid owned gate entry')
    const bytes = fs.readFileSync(fd)
    if (bytes.length !== info.size) throw new Error('Owned gate entry changed')
    return bytes
  } finally {
    fs.closeSync(fd)
  }
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
  if (variant === 'foreign')
    catalogue.entries[0].targets[0].url = 'https://example.invalid/foreign.tar.gz'
  else if (!['valid', 'tampered'].includes(variant)) throw new Error('Invalid release fixture')
  const target = catalogue.entries[0].targets[0]
  const destination = privateFolder(path.join(appData, 'repo-fixture'))
  privateFolder(path.join(destination, 'archives'))
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
}
async function startApp(root, plan, workspace, global, processes, diagnose = false) {
  if (plan.argv?.length !== 1 || plan.argv[0] !== HIDDEN_LAUNCH_ARG)
    throw new Error('Missing hidden launch plan')
  await phaseStep(root, 'app-integrity', () =>
    integrityCheckpoint(root, plan.app, 'beforeLaunch', plan.bundleStamp),
  )
  const port = await freePort(),
    exe = path.join(plan.app, 'Contents/MacOS/BroCrew')
  requireSelection(JSON.parse(readOwned(path.join(root, 'probe-matrix.json'))))
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
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    })
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
  await registerChild(root, run.child)
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
        await registerChild(root, browser)
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
    badGlobal = privateFolder(path.join(root, 'b')),
    foreignGlobal = privateFolder(path.join(root, 'f'))
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
    for (const [variant, badRoot, key] of [
      ['foreign', foreignGlobal, 'foreignUrlRefused'],
      ['tampered', badGlobal, 'tamperedArchiveRefused'],
    ]) {
      step = variant === 'foreign' ? 'foreign-refusal' : 'tampered-refusal'
      stageRelease(root, plan.appData, variant)
      const bad = await startApp(
        root,
        plan,
        privateFolder(path.join(root, 'w-' + variant)),
        badRoot,
        processes,
      )
      // Both operations await the actual load. Neither an absent card nor a timing gap passes.
      const availability = await bad.cdp.evaluate(
        "return await window.api.plugins.request({kind:'availability'})",
      )
      const refused = await bad.cdp.evaluate(
        "return await window.api.plugins.request({kind:'install',id:'chrome'})",
      )
      const cards = await bad.cdp.evaluate("return await window.api.plugins.request({kind:'list'})")
      const expectedAvailability = true
      requireCheck(
        summary,
        key,
        availability?.ok === true &&
          availability.available === expectedAvailability &&
          refused?.ok === false &&
          (cards?.ok === false || cards.cards.every((card) => card.installed === false)) &&
          !fs.existsSync(path.join(badRoot, 'host/runs')),
      )
      await stopApp(bad)
    }
    step = 'install'
    stageRelease(root, plan.appData)
    let a = await startApp(root, plan, workspaceA, global, processes)
    await plugins(a)
    requireCheck(summary, 'drawsWindow', await draws(a))
    requireCheck(
      summary,
      'pluginsTab',
      await a.cdp.evaluate(
        'return Boolean(document.querySelector(\'[data-cy="settings-tab-plugins"]\'))',
      ),
    )
    // Exactly one install press. No bridge install call is used for the successful path.
    await press(a.cdp, '[data-plugin="chrome"] [data-cy="plugin-install"]')
    await installed(a, true)
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
    await pluginButton(view, 'Enable')
    await enabledProfile(view)
    requireCheck(summary, 'profileEnabled', true)
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
    await press(a.cdp, '[data-plugin="chrome"] [data-cy="plugin-install"]')
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
