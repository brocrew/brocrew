// 695-visible: observes native relaunch for the existing hosted Mac rehearsals; it opens no window.
import { readFile, lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { digest, packageOfAsar, requireEvidence, waitFor } from './mac-update-test.mjs'
import { nativeRestartRecorded } from '../mac-signed-upgrade-contract.mjs'

export async function requestNativeMacRestart(
  workspace,
  version,
  { previous, click, processInfo, evidence, settings, app, readLog = readFile },
) {
  const confirmsRestart = await workspace.cdp.evaluate(
    "return typeof window.api.updates.restartPlan === 'function'",
  )
  if (confirmsRestart) await click(workspace.cdp, '[data-cy=updates-restart]')
  try {
    await click(
      workspace.cdp,
      confirmsRestart ? '[data-cy=updates-confirm-now]' : '[data-cy=updates-restart]',
    )
  } catch (error) {
    if (error?.message !== 'Input.dispatchMouseEvent: the window’s DevTools connection closed')
      throw error
  }
  let updateReopen
  await waitFor(
    async () => {
      if (confirmsRestart)
        updateReopen = JSON.parse(await readLog(settings, 'utf8')).updateReopen ?? updateReopen
      return !(await processInfo(previous.pid))
    },
    'A quits for Squirrel.Mac',
    60_000,
  )
  const stdout = await readLog(join(evidence, `${previous.stage}.stdout.log`), 'utf8')
  nativeRestartRecorded(
    stdout,
    await readLog(previous.log, 'utf8'),
    version,
    confirmsRestart
      ? {
          recorded: updateReopen,
          executable: join(app, 'Contents', 'MacOS', 'BroCrew'),
          folder: workspace.data,
        }
      : undefined,
  )
  if (confirmsRestart) workspace.result.nativeInstallChoice = updateReopen
  return confirmsRestart
}

export async function waitForNativeMacDownload(cdp, version, label) {
  await waitFor(
    async () => {
      const state = (await cdp.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'ready' && state.how === 'restart' && state.version === version
    },
    label,
    600_000,
  )
}

export async function unpackDownloadedMacZip({ app, published, unpacked, run, home = homedir() }) {
  const appUpdate = await readFile(join(app, 'Contents', 'Resources', 'app-update.yml'), 'utf8')
  const cacheName = /^updaterCacheDirName: ['"]?([^'"\n]+)['"]?$/m.exec(appUpdate)?.[1]
  requireEvidence(cacheName, 'The packaged updater cache name is missing.')
  const pending = join(home, 'Library', 'Caches', cacheName, 'pending')
  const cached = JSON.parse(await readFile(join(pending, 'update-info.json'), 'utf8'))
  const zip = join(pending, cached.fileName)
  requireEvidence(
    (await realpath(zip)) === zip &&
      (await lstat(zip)).size === published.size &&
      (await digest(zip, 'sha512', 'base64')) === published.sha512,
    'Downloaded ZIP bytes or feed SHA-512 differ.',
  )
  await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked])
  return { zip, bundle: join(unpacked, 'BroCrew.app') }
}

export async function quitRestartedMacApp(child, processInfo) {
  if (child === null) return null
  const current = await processInfo(child.pid)
  requireEvidence(
    current && current.started === child.started && current.command === child.command,
    'Restarted test process identity changed before quit.',
  )
  process.kill(child.pid, 'SIGTERM')
  await waitFor(
    async () => !(await processInfo(child.pid)),
    'Squirrel-restarted B quits normally',
    60_000,
  )
  return null
}

export async function observeMacReplacement({ app, version, previous, run, processInfo }) {
  await waitFor(
    async () => {
      try {
        return packageOfAsar(join(app, 'Contents', 'Resources', 'app.asar')).version === version
      } catch {
        return false
      }
    },
    'Squirrel.Mac replaces A with B',
    600_000,
  )
  return await waitFor(async () => {
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
}

export async function macFirstStartReceipt(data, version) {
  return await waitFor(async () => {
    const receipt = JSON.parse(await readFile(join(data, 'backups', 'retention.json'), 'utf8'))
    return receipt.appVersion === version && receipt.successfulStarts === 1 ? receipt : null
  }, 'Squirrel first start completes recovery and opens its database')
}
