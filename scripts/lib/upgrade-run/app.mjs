import { spawn, spawnSync } from 'node:child_process'
import { startupLogEvidence } from '../upgrade-retention.mjs'
import { keepPluginDrainEvidence, sleep, until } from '../update-rehearsal-app.mjs'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FAIL_LINE,
  NOTHING_RAN_LIMIT,
  LAUNCH_SETUP_PROVIDERS,
  pluginOwnerQuiescence,
  launchSetupExpected,
  READY_LINE,
  requireEvidence,
  whatRunsIsSaid,
} from '../upgrade-path.mjs'
import {
  os,
  evidence,
  appRoot,
  stamp,
  say,
  summary,
  check,
  must,
  holds,
  keep,
  running,
  installedExe,
  installedProgram,
  setRunning,
} from './settings.mjs'
import { run, windowsProcesses, alive } from './system.mjs'
import { claudeRouteEnv } from './models.mjs'

async function launch(stage, port, options = {}) {
  const {
    workspace,
    hidden = false,
    recovery = false,
    windowWithin = 120_000,
    beforeConnect,
  } = options
  const log = join(evidence, `${stage}.log`)
  const debugging = [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`,
    ...(workspace ? [`--user-data-dir=${workspace}`] : []),
    ...(hidden ? ['--brobot-hidden'] : []),
    ...(recovery ? ['--brobot-test-keep-recovery-window'] : []),
  ]
  const at = Date.now()
  const launchedMono = performance.now()
  if (os === 'windows' || hidden) {
    const fd = openSync(log, 'a')
    const child = spawn(installedProgram, debugging, {
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...claudeRouteEnv() },
    })
    closeSync(fd)
    setRunning({ stage, pid: child.pid, port, log, launchedAt: at, launchedMono })
  } else {
    run('/usr/bin/open', [
      '-n',
      '--stdout',
      join(evidence, `${stage}.stdout.log`),
      '--stderr',
      log,
      ...(process.env.BROCREW_SKIP_UPDATE_CHECK === '1'
        ? ['--env', 'BROCREW_SKIP_UPDATE_CHECK=1']
        : []),
      installedExe,
      '--args',
      ...debugging,
    ])
    setRunning({ stage, pid: null, port, log, launchedAt: at, launchedMono })
  }
  const root = `http://127.0.0.1:${String(port)}`
  if (beforeConnect) {
    must(
      hidden && Number.isInteger(running.pid),
      `${stage}: the observer owns a directly spawned hidden app`,
    )
    if ((await beforeConnect(running)) === false) return null
  }
  running.root = root
  const version = await until(async () => {
    try {
      const answer = await fetch(`${root}/json/version`, { signal: AbortSignal.timeout(2_000) })
      return answer.ok ? await answer.json() : null
    } catch {
      return null
    }
  }, 180_000)
  must(version !== null, `${stage}: DevTools answered on port ${String(port)}`)
  running.browser = await connect(version.webSocketDebuggerUrl)
  const info = await running.browser.call('SystemInfo.getProcessInfo')
  const pid = info.processInfo.find((one) => one.type === 'browser')?.id ?? null
  must(Number.isInteger(pid), `${stage}: the app's own process is known`, { pid })
  if (running.pid === null) {
    const command = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    })
    must(
      command.stdout.startsWith(installedProgram),
      `${stage}: the process on that port is ${installedExe}`,
      { command: command.stdout.trim() },
    )
    running.pid = pid
  }
  must(running.pid === pid, `${stage}: the process on that port is the one this run started`, {
    started: running.pid,
    answering: pid,
  })
  const opened = await until(async () => (await pagesOf(root)).length > 0 || null, windowWithin)
  must(opened === true, `${stage}: a window opened`)
  const own = recovery
    ? null
    : await until(async () => {
        const pages = await pagesOf(root)
        for (const one of pages) await noteTheRecoveryWindow(one)
        return pages.find(theAppsOwn) ?? null
      }, 30_000)
  await attachTo(own ?? (await pagesOf(root))[0])
  return running
}

const pagesOf = async (root) =>
  (await (await fetch(`${root}/json/list`)).json()).filter(
    (one) => one.type === 'page' && one.webSocketDebuggerUrl,
  )

const theAppsOwn = (page) => page.url.endsWith('/index.html')

async function attachTo(page) {
  running.cdp?.close()
  running.page = page
  running.cdp = await connect(page.webSocketDebuggerUrl)
  await running.cdp.call('Page.enable')
}

const recoveryWindowsSeen = []
summary.recoveryWindowsSeen = recoveryWindowsSeen
async function noteTheRecoveryWindow(page) {
  if (!page.url.endsWith('/recovery.html')) return
  if (recoveryWindowsSeen.some((one) => one.stage === running.stage && one.id === page.id)) {
    return
  }
  const seen = { at: stamp(), stage: running.stage, id: page.id, heading: null }
  recoveryWindowsSeen.push(seen)
  let peek = null
  try {
    peek = await connect(page.webSocketDebuggerUrl)
    seen.heading = await Promise.race([
      peek.evaluate("return document.querySelector('h1')?.innerText ?? document.title"),
      sleep(3_000).then(() => null),
    ])
  } catch {
    // A closing recovery window may no longer answer the heading request.
  } finally {
    peek?.close()
  }
  say(`${running.stage}: the recovery window was seen: ${JSON.stringify(seen)}`)
}
const pagesNow = async () =>
  (await (await fetch(`${running.root}/json/list`)).json())
    .filter((one) => one.type === 'page')
    .map((one) => one.url)

async function bridge(stage, budget = 180_000) {
  const bridged = await until(async () => {
    if (!theAppsOwn(running.page)) {
      const pages = await pagesOf(running.root).catch(() => [])
      for (const one of pages) await noteTheRecoveryWindow(one)
      const own = pages.find(theAppsOwn)
      if (own !== undefined) await attachTo(own)
    }
    try {
      return await running.cdp.evaluate(
        'return Boolean(window.api?.runtime && window.api?.getAppInfo)',
      )
    } catch {
      return false
    }
  }, budget)
  must(bridged, `${stage}: the window offers its bridge`, { url: running.page.url })
}

async function onScreen(stage, hidden = false) {
  const shown = await until(
    () =>
      running.cdp
        .evaluate(
          `return (${hidden} || document.visibilityState === "visible") && (document.querySelector("[data-cy=rail-workspace]")?.getClientRects().length ?? 0) > 0`,
        )
        .catch(() => false),
    120_000,
  )
  must(
    Boolean(shown),
    `${stage}: the ordinary window has its rail drawn${hidden ? ' while hidden' : ' on screen'}`,
  )
}

const dialogsNow = () =>
  running.cdp.evaluate(
    `return [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')]
       .filter((one) => one.getClientRects().length > 0)
       .map((one) => {
         const setup = one.querySelector('[data-provider][data-step]')
         return {
           cy: one.getAttribute('data-cy'),
           label: one.getAttribute('aria-label'),
           provider: setup === null ? null : setup.getAttribute('data-provider'),
           step: setup === null ? null : setup.getAttribute('data-step'),
           kind: setup === null ? null : setup.getAttribute('data-kind'),
           text: (one.innerText ?? '').slice(0, 4000),
         }
       })`,
  )

const closeTheSetup = () =>
  running.cdp.evaluate(
    `const close = document.querySelector('[role=dialog] button[aria-label="Close setup"]')
     if (close === null) return false
     close.click()
     return true`,
  )

async function launchSetupFacts() {
  const read = await running.cdp.evaluate(
    `const said = (work) => work.then((answer) => ({ answer }), (error) => ({ error: String(error) }))
     const [versions, setup, claudeKey, codexKey, claudeAuth, codexAuth] = await Promise.all([
       said(window.api.runtime.providerVersions()),
       said(window.api.runtime.providerSetup()),
       said(window.api.runtime.apiKeyStatus({ provider: 'claude' })),
       said(window.api.runtime.apiKeyStatus({ provider: 'codex' })),
       said(window.api.runtime.checkProviderAuth({ provider: 'claude', profileId: 'brobot' })),
       said(window.api.runtime.checkProviderAuth({ provider: 'codex', profileId: 'brobot' })),
     ])
     return {
       versions,
       setup,
       keys: { claude: claudeKey, codex: codexKey },
       auth: { claude: claudeAuth, codex: codexAuth },
     }`,
    180_000,
  )
  const key = (provider) => read.keys[provider]?.answer
  return {
    read,
    facts: LAUNCH_SETUP_PROVIDERS.map(({ provider }) => ({
      provider,
      version: read.versions.answer?.[provider] ?? null,
      setup: read.setup.answer == null ? undefined : read.setup.answer[provider],
      auth: read.auth[provider]?.answer ?? null,
      keyRefused: key(provider)?.set === true && key(provider)?.refusedForBilling !== undefined,
      keyUnreadable: key(provider)?.set === true && key(provider)?.inUse === false,
    })),
  }
}

async function dialogsAtAStart(stage, into) {
  const { read, facts } = await launchSetupFacts()
  const due = launchSetupExpected(facts)
  into.launchSetup = { read, ready: due.ready, opensProviders: due.opensProviders }
  check(
    !due.undecided,
    `${stage}: the app answered what its setup at launch reads, for each provider`,
    { read, ready: due.ready },
  )
  const providersShown = () =>
    running.cdp.evaluate(
      `return document.querySelector('[data-cy=settings-screen]') !== null &&
         document.querySelector('[data-cy=settings-tab-providers]')?.getAttribute('aria-selected') === 'true'`,
    )
  const shown = await (due.opensProviders
    ? until(async () => ((await providersShown()) ? true : null), 60_000, 500).then(Boolean)
    : sleep(5_000).then(providersShown))
  const open = await dialogsNow()
  const pages = await pagesNow()
  const ordinary =
    pages.filter((url) => url.endsWith('/index.html')).length === 1 &&
    !pages.some((url) => url.includes('recovery'))
  into.launchSetup.opened = open
  into.launchSetup.providersShown = shown
  check(
    ordinary && open.length === 0 && shown === due.opensProviders,
    due.opensProviders
      ? `${stage}: one ordinary window on Settings → Providers, as no provider is ready, no recovery window, and no dialog of the app's own`
      : `${stage}: one ordinary window, no recovery window, no dialog of the app's own, and not sent to Settings`,
    { opensProviders: due.opensProviders, ready: due.ready, shown, open, pages },
  )
}

async function whatRunsIsRead(stage) {
  const read = await running.cdp.evaluate(
    `const said = (work) => work.then((answer) => answer, () => null)
     const [resources, memory] = await Promise.all([
       said(window.api.runtime.providerResources()),
       said(window.api.runtime.processMemory()),
     ])
     return { resources, memory }`,
    60_000,
  )
  const judged = whatRunsIsSaid(read)
  const says = {
    measured: 'the window has a memory figure for the running agent, on Providers and for its card',
    'nothing-was-running': 'no agent’s process was running when the window was asked what runs',
  }
  check(
    judged.ok,
    `${stage}: ${says[judged.outcome] ?? `what the window says of its running agent holds (${judged.outcome})`}`,
    { ...judged, ...read },
  )
  if (judged.outcome === 'nothing-was-running') summary.knownLimits.push(NOTHING_RAN_LIMIT)
  return { ...judged, ...read }
}

async function whatEachSetupSays(stage, into) {
  const notReady = (into.launchSetup?.ready ?? []).filter((one) => one.ready === false)
  into.setups = []
  for (const { provider } of notReady) {
    const name = LAUNCH_SETUP_PROVIDERS.find((one) => one.provider === provider)?.name ?? provider
    try {
      const opened = await running.cdp.evaluate(
        `document.querySelector('[data-cy=rail-settings]')?.click()
         let providersSelected = false
         for (let waited = 0; waited < 40; waited += 1) {
           const tab = document.querySelector('[data-cy=settings-tab-providers]')
           if (tab !== null && !providersSelected) {
             tab.click()
             providersSelected = true
           }
           const card = [...document.querySelectorAll('[data-cy=provider-card]')].find((one) => one.getAttribute('data-provider') === ${JSON.stringify(provider)})
           const setUp = card === undefined ? undefined : [...card.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Set up')
           if (setUp !== undefined) {
             setUp.click()
             return true
           }
           await new Promise((done) => setTimeout(done, 250))
         }
         return false`,
        30_000,
      )
      const said = opened
        ? await until(
            async () => (await dialogsNow()).find((one) => one.provider === provider) ?? null,
            15_000,
            500,
          )
        : null
      into.setups.push({ provider, said: said ?? `no setup for ${name} opened from Providers` })
      if (said !== null) {
        await screenshot(`${stage.replaceAll(' ', '-')}-setup-${provider}.png`)
        await closeTheSetup()
        await until(async () => ((await dialogsNow()).length === 0 ? true : null), 15_000, 500)
      }
    } catch (error) {
      into.setups.push({ provider, said: `could not be read: ${error.message}` })
    }
  }
  say(`${stage}: what each setup says: ${JSON.stringify(into.setups).slice(0, 1500)}`)
}

async function railLists(stage, conversations, said = 'the beta’s conversations') {
  const listed = await until(
    () =>
      running.cdp.evaluate(
        `const wanted = ${JSON.stringify(conversations)}
         const missing = wanted.filter((id) => document.querySelector('[data-cy="open-session-' + id + '"]') === null)
         if (missing.length === 0) return true
         for (const toggle of document.querySelectorAll('[data-cy^="rail-toggle-"][aria-expanded="false"]')) toggle.click()
         return false`,
      ),
    60_000,
  )
  check(Boolean(listed), `${stage}: the rail lists ${said}`, { conversations })
  return Boolean(listed)
}

async function connect(url) {
  requireEvidence(new URL(url).hostname === '127.0.0.1', 'DevTools must stay on loopback.')
  const socket = new WebSocket(url)
  const pending = new Map()
  await new Promise((done, failed) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener(
      'error',
      () => failed(new Error(`DevTools would not connect: ${url}`)),
      { once: true },
    )
  })
  let next = 0
  socket.addEventListener('message', ({ data: raw }) => {
    const message = JSON.parse(raw)
    const waiting = pending.get(message.id)
    if (waiting === undefined) return
    pending.delete(message.id)
    clearTimeout(waiting.timer)
    if (message.error) waiting.failed(new Error(message.error.message))
    else waiting.done(message.result)
  })
  const call = (method, params = {}, ms = 60_000) =>
    new Promise((done, failed) => {
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        failed(new Error(`DevTools did not answer ${method} in ${String(ms)} ms`))
      }, ms)
      pending.set(id, { done, failed, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (body, ms = 60_000) => {
    const result = await call(
      'Runtime.evaluate',
      { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true },
      ms,
    )
    requireEvidence(
      !result.exceptionDetails,
      result.exceptionDetails?.exception?.description ?? 'the window threw',
    )
    return result.result?.value
  }
  return { call, evaluate, close: () => socket.close() }
}

async function screenshot(name) {
  try {
    const shot = await running.cdp.call('Page.captureScreenshot', { format: 'png' }, 30_000)
    keep(name, Buffer.from(shot.data, 'base64'))
    return true
  } catch (error) {
    say(`(no screenshot ${name}: ${error.message})`)
    return false
  }
}

function wholeScreen(name) {
  if (os !== 'mac') return
  const shot = spawnSync('/usr/sbin/screencapture', ['-x', join(evidence, name)], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (shot.status !== 0) say(`(no picture of the screen ${name}: ${(shot.stderr ?? '').trim()})`)
}

async function verdict(stage) {
  const said = await until(() => {
    const log = existsSync(running.log) ? readFileSync(running.log, 'utf8') : ''
    return log.includes(READY_LINE) || log.includes(FAIL_LINE) ? log : null
  }, 240_000)
  must(said !== null, `${stage}: the start said READY or that it did not start`)
  must(!said.includes(FAIL_LINE), `${stage}: the start did not fail`, {
    log: said.slice(-1_500),
  })
  return Date.now() - running.launchedAt
}

const wholeLog = (stage, options) => startupLogEvidence(evidence, check, holds, stage, options)

async function quit(stage) {
  const { pid } = running
  if (os === 'windows') spawnSync('taskkill', ['/PID', String(pid)], { windowsHide: true })
  else process.kill(pid, 'SIGTERM')
  const ended = await until(
    () => (!alive(pid) && (os !== 'windows' || windowsProcesses().length === 0) ? true : null),
    90_000,
  )
  check(Boolean(ended), `${stage}: the app closed when asked`, { pid })
  const pluginOwner = join(appRoot, 'plugins', 'supervisor', 'owner.json')
  const pluginState = () => {
    try {
      return pluginOwnerQuiescence(JSON.parse(readFileSync(pluginOwner, 'utf8')))
    } catch (error) {
      return error.code === 'ENOENT' ? 'not-exercised' : 'not-stopped'
    }
  }
  await until(() => pluginState() !== 'not-stopped' || null, 60_000)
  const plugins = pluginState()
  check(
    plugins !== 'not-stopped',
    `${stage}: no plugin service is left stopping after the app quit`,
    {
      pluginOwner: plugins,
      installedPluginDrainExercised: plugins !== 'not-exercised',
    },
  )
  if (os === 'windows' && plugins === 'not-stopped') {
    keepPluginDrainEvidence(join(appRoot, 'plugins'), running.stage, { evidence, keep, say })
  }
  await stop()
  return Boolean(ended) && plugins !== 'not-stopped'
}

async function stop() {
  if (running === null) return
  const { pid, stage } = running
  try {
    running.browser?.close()
    running.cdp?.close()
  } catch {
    // Already closed.
  }
  if (pid !== null && alive(pid)) {
    if (os === 'mac') {
      spawnSync(
        '/usr/bin/sample',
        [String(pid), '3', '-file', join(evidence, `${stage}-sample.txt`)],
        {
          encoding: 'utf8',
          timeout: 60_000,
        },
      )
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Gone meanwhile.
      }
    } else {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    }
    await sleep(3_000)
  }
  setRunning(null)
}

async function phase(stage, body) {
  try {
    await body()
  } catch (error) {
    check(false, `${stage}: every step could be made`, { error: error.message })
    wholeScreen(`screen-where-the-${stage.replace(/ /g, '-')}-stopped.png`)
    if (running !== null) await screenshot(`${stage.replace(/ /g, '-')}-where-it-stopped.png`)
  } finally {
    await stop()
  }
}

export {
  launch,
  pagesNow,
  bridge,
  onScreen,
  dialogsAtAStart,
  whatRunsIsRead,
  whatEachSetupSays,
  railLists,
  screenshot,
  wholeScreen,
  verdict,
  wholeLog,
  quit,
  stop,
  phase,
}
