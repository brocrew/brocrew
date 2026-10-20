// The hosted Windows gate's WhatsApp leg: the packaged Windows app installs WhatsApp from a local
// fake list holding the pinned Windows archive, starts it, shows its Configure page in the
// not-linked state, uninstalls it and quits with nothing of it left running. No phone is linked, so
// the bridge never connects to WhatsApp. Only a closed summary of booleans and counts leaves the
// runner.
import fs from 'node:fs'
import path from 'node:path'
import { setPriority } from 'node:os'
import { pathToFileURL } from 'node:url'
import { press } from '../../lib/update-rehearsal-app.mjs'
import { openPlugins, pluginPage, waitFor } from '../plugin-packaged/cdp.mjs'
import {
  buildApp,
  digest,
  installed,
  keepDiagnostics,
  makePrivate,
  onlyTheThree,
  privateFolder,
  processesUnder,
  ps,
  quote,
  readList,
  readOwned,
  repository,
  requireHosted,
  stageRelease,
  startApp,
  stopApp,
  userSid,
} from './gate.mjs'

export const checks = [
  'hostedWindowsX64',
  'archiveMatchesPin',
  'pluginsTab',
  'installed',
  'rootPrivate',
  'bridgeStarted',
  'configureNotLinked',
  'uninstalled',
  'bridgeStopped',
  'noPluginProcessLeft',
]
export const steps = [
  'bootstrap',
  'scratch',
  'archive',
  'app',
  'install',
  'root-private',
  'bridge',
  'configure',
  'uninstall',
  'leftovers',
]
export const report = () => ({
  passed: false,
  checks: Object.fromEntries(checks.map((key) => [key, false])),
  counts: {},
})
/** Only booleans, safe whole numbers and a closed failure record may be written out. */
export function safeSummary(value, depth = 0) {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    depth < 2 &&
    Object.entries(value).every(([key, one]) =>
      key === 'failure' && depth === 0
        ? safeFailure(one)
        : /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) && safeSummary(one, depth + 1),
    )
  )
}
export function safeFailure(value) {
  const keys = value && typeof value === 'object' ? Object.keys(value).sort().join(',') : ''
  return (
    keys === 'category,step' &&
    steps.includes(value.step) &&
    ['assertion', 'timeout', 'process'].includes(value.category)
  )
}
export function finish(summary) {
  summary.passed =
    checks.every((key) => summary.checks[key] === true) && summary.failure === undefined
  return summary
}
function check(summary, key, value) {
  if (!checks.includes(key) || value !== true) throw new Error('Gate assertion failed')
  summary.checks[key] = true
}

/**
 * The WhatsApp bridge programs running from under `folder`, by CIM; null when unreadable. The
 * plugin runs its own copy, named with the program's digest: `whatsapp-bridge-<digest>.exe`.
 */
async function bridgesUnder(folder) {
  const out = await ps(
    `$f = ${quote(folder.toLowerCase())}; @(Get-CimInstance Win32_Process | Where-Object { ` +
      `$_.Name -like 'whatsapp-bridge*.exe' -and "$($_.ExecutablePath)".ToLower().Contains($f) }).Count`,
  )
  return /^\d+$/.test(out) ? Number(out) : null
}
async function until(test, wait) {
  for (const end = Date.now() + wait; Date.now() < end;) {
    if (await test()) return true
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return false
}

let currentStep = 'bootstrap'
async function step(name, work) {
  currentStep = name
  return work()
}

export async function gate(release) {
  requireHosted()
  // A below-normal runner process would pass its class to every child; the app starts from normal.
  setPriority(0)
  const summary = report()
  const processes = []
  let root, view
  try {
    check(summary, 'hostedWindowsX64', true)
    const sid = await step('scratch', userSid)
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.TEMP, 'fpw-')))
    await makePrivate(root, sid)
    const appData = privateFolder(path.join(root, 'a'))
    const global = path.join(root, 'g')
    await step('archive', () => {
      // The Linux job built it as the pinned commit; here it must still be the pinned bytes.
      const pinned = JSON.parse(
        fs.readFileSync(path.join(repository, 'plugins/catalogue.json'), 'utf8'),
      ).entries.find((entry) => entry.id === 'whatsapp')
      const listed = JSON.parse(readOwned(path.join(release, 'catalogue.json'))).entries
      const bytes = readOwned(path.join(release, 'whatsapp-win32-x64.tar.gz'))
      const pin = pinned?.targets.find((one) => one.os === 'win32' && one.cpu === 'x64')
      check(
        summary,
        'archiveMatchesPin',
        Boolean(pin) &&
          listed.length === 1 &&
          listed[0].id === 'whatsapp' &&
          listed[0].sourceCommit === pinned.sourceCommit &&
          listed[0].targets.length === 1 &&
          listed[0].targets[0].sha256 === pin.sha256 &&
          digest(bytes) === pin.sha256 &&
          bytes.length === pin.bytes,
      )
      stageRelease(release, appData, 'valid', 'whatsapp')
    })
    // No browser is started on this leg; the build only needs a path for Chrome's.
    const app = await step('app', () =>
      buildApp(root, appData, path.join(root, 'no-browser', 'chrome.exe')),
    )
    const a = await step('install', async () => {
      const started = await startApp(app, privateFolder(path.join(root, 'wa')), global, processes)
      await openPlugins(started.cdp)
      check(
        summary,
        'pluginsTab',
        await started.cdp.evaluate(
          'return Boolean(document.querySelector(\'[data-plugin="whatsapp"] [data-cy="plugin-install"]\'))',
        ),
      )
      const pressed = performance.now()
      await press(started.cdp, '[data-plugin="whatsapp"] [data-cy="plugin-install"]')
      await installed(started, true, 'whatsapp')
      summary.counts.installToRunningMs = Math.round(performance.now() - pressed)
      check(summary, 'installed', true)
      return started
    })
    await step('root-private', async () => {
      check(summary, 'rootPrivate', onlyTheThree(await readList(global), sid))
    })
    await step('bridge', async () => {
      let count = null
      await until(async () => ((count = await bridgesUnder(global)), count === 1), 60_000)
      if (count !== null) summary.counts.bridgesRunning = count
      if (count !== 1) {
        // Whether a bridge runs from anywhere else says if the program or this count is wrong.
        const anywhere = await bridgesUnder('')
        if (anywhere !== null) summary.counts.bridgesAnywhere = anywhere
      }
      check(summary, 'bridgeStarted', count === 1)
    })
    await step('configure', async () => {
      await press(a.cdp, '[data-plugin="whatsapp"] [data-cy="plugin-configure"]')
      view = await pluginPage(a.port)
      // The bridge itself answers "unlinked"; the page draws it with the link offer and its settings.
      await waitFor(() =>
        view.evaluate(`
          const shown = (id) => { const one = document.querySelector('#' + id); return Boolean(one && !one.hidden) }
          return document.querySelector('#status')?.textContent === 'Not linked.' &&
            shown('link-phone') && !shown('pairing') && !shown('account') &&
            document.querySelector('#read')?.disabled === false`),
      )
      check(summary, 'configureNotLinked', true)
      view.close()
      view = undefined
      await press(a.cdp, '[data-cy="plugin-close"]')
    })
    await step('uninstall', async () => {
      await press(a.cdp, '[data-plugin="whatsapp"] [data-cy="plugin-uninstall"]')
      await press(a.cdp, '[data-cy="plugin-uninstall-confirm"]')
      await installed(a, false, 'whatsapp')
      check(summary, 'uninstalled', true)
      let count = null
      await until(async () => ((count = await bridgesUnder(global)), count === 0), 30_000)
      check(summary, 'bridgeStopped', count === 0)
    })
    await step('leftovers', async () => {
      await stopApp(a)
      // With no app attached the supervisor drains its leases and exits within the lease expiry.
      let left = null
      await until(async () => ((left = await processesUnder(global)), left === 0), 120_000)
      if (left !== null) summary.counts.pluginProcessesLeft = left
      check(summary, 'noPluginProcessLeft', left === 0)
    })
  } catch (error) {
    summary.failure = {
      step: currentStep,
      category:
        error?.gateCategory === 'process'
          ? 'process'
          : ['Packaged gate timed out', 'Owned process deadline'].includes(error?.message)
            ? 'timeout'
            : 'assertion',
    }
    // The gate's own message names a control or a step, never data; it goes to the job log.
    console.log(`----- failure: ${String(error?.message ?? 'unknown').slice(0, 300)} -----`)
  } finally {
    try {
      view?.close()
    } catch {
      /* Already closed. */
    }
    for (const record of processes.reverse()) await stopApp(record).catch(() => undefined)
  }
  if (root) {
    const runs = path.join(root, 'g', 'host', 'runs')
    if (fs.existsSync(runs)) summary.counts.pluginRuns = fs.readdirSync(runs).length
  }
  finish(summary)
  if (!safeSummary(summary)) throw new Error('Unsafe gate summary')
  const out = process.env.PLUGIN_GATE_OUT
  fs.mkdirSync(out, { recursive: true })
  if (summary.failure && root) keepDiagnostics(root, path.join(out, 'diagnostics'))
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary))
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  gate(path.resolve(process.argv[2] ?? '')).then(
    (summary) => {
      process.exitCode = summary.passed ? 0 : 1
    },
    () => {
      console.log(
        JSON.stringify({ passed: false, failure: { step: currentStep, category: 'assertion' } }),
      )
      process.exitCode = 1
    },
  )
}
