// Read Windows and app update results separately from the live run so direct checks can
// exercise them on any platform. Node built-ins only.
import { win32 } from 'node:path'

/** The words the scripted model holds a turn open on. */
export const HOLD_MARKER = 'update-test-hold'

/**
 * PowerShell's `ConvertTo-Json` answers one object for one row and an array for several, and
 * nothing for none: always a list.
 */
export function rowsOf(json) {
  const text = String(json ?? '').trim()
  if (text === '') return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** The Apps entries (uninstall keys) that are BroCrew's. */
export function broBotEntries(rows) {
  return rows.filter(
    (row) => typeof row?.DisplayName === 'string' && /^BroCrew\b/.test(row.DisplayName),
  )
}

/**
 * Where an Apps entry is installed: its `InstallLocation`, else the folder of the uninstaller its
 * `UninstallString` runs (`"C:\…\BroBot\Uninstall BroBot.exe" /currentuser`), else null.
 */
export function installFolderOf(entry) {
  if (typeof entry?.InstallLocation === 'string' && entry.InstallLocation !== '') {
    return entry.InstallLocation.replace(/[\\/]+$/, '')
  }
  const uninstaller = /^"([^"]+)"/.exec(String(entry?.UninstallString ?? ''))?.[1]
  return uninstaller === undefined ? null : win32.dirname(uninstaller)
}

/** A BroCrew main process: not one of Electron's helpers, which carry `--type=`. */
export function mainProcesses(rows) {
  return rows.filter((row) => !String(row?.CommandLine ?? '').includes('--type='))
}

/**
 * 🔴 **The order the app wrote its last lines in** — the proof that the installer started only
 * after the app had shut down (W4.109's fix): BroBot chose to restart, its teardown reported, and
 * only then was the installer started, from the app's `quit`. ⚑ Read from one file the app wrote
 * both its outputs into, so the order is the order of the writes.
 *
 * ⚑ **Two ways back** (W4.128): the default workspace's is the installer's own (electron-updater
 * runs it with `--force-run`); another folder's is BroBot's (a waiting PowerShell runs the
 * installer, then BroBot on `folder`), and then electron-updater starts nothing.
 */
export function theRestartsOrder(log, version, folder = null) {
  const lines = String(log).split(/\r?\n/)
  const at = (test) => lines.findIndex((line) => test.test(line))
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const order =
    folder === null
      ? {
          chose: at(new RegExp(`updates: restarting to install ${escaped(version)}`)),
          shutDown: at(/BroCrew shut down in \d+ms/),
          installing: at(/updater: Install: isSilent: true, isForceRunAfter: true/),
          executing: at(
            /updater: Executing: .*BroCrew-Setup-.* with args: --updated,\/S,--force-run/,
          ),
        }
      : {
          chose: at(new RegExp(`updates: restarting to install ${escaped(version)}`)),
          shutDown: at(/BroCrew shut down in \d+ms/),
          installing: at(
            new RegExp(
              `updates: installing .*BroCrew-Setup-.*, then reopening BroCrew with --user-data-dir=${escaped(folder)}$`,
            ),
          ),
        }
  const problems = []
  for (const [step, index] of Object.entries(order)) {
    if (index < 0) problems.push(`no "${step}" line in the app's log`)
  }
  if (folder !== null && at(/updater: Install:/) >= 0) {
    problems.push('electron-updater started the installer too, with its own way back')
  }
  if (problems.length === 0) {
    if (!(order.chose < order.shutDown))
      problems.push('the teardown reported before BroCrew chose to restart')
    const after = Object.values(order).slice(2)
    if (!after.every((index, i) => index > (i === 0 ? order.shutDown : after[i - 1]))) {
      problems.push('the installer started before the teardown had reported')
    }
  }
  return {
    order,
    problems,
    lines: Object.values(order)
      .filter((i) => i >= 0)
      .map((i) => lines[i]),
  }
}

/** A Windows command line read back as its arguments, the way Windows does (`CommandLineToArgvW`). */
export function argvOf(line) {
  const args = []
  let current = ''
  let inQuotes = false
  let any = false
  let at = 0
  while (at < line.length) {
    const char = line[at]
    if (char === '\\') {
      let backslashes = 0
      while (line[at] === '\\') {
        backslashes += 1
        at += 1
      }
      if (line[at] === '"') {
        current += '\\'.repeat(Math.floor(backslashes / 2))
        if (backslashes % 2 === 1) {
          current += '"'
          at += 1
        }
      } else current += '\\'.repeat(backslashes)
      any = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      any = true
    } else if (/\s/.test(char) && !inQuotes) {
      if (any) args.push(current)
      current = ''
      any = false
    } else {
      current += char
      any = true
    }
    at += 1
  }
  if (any) args.push(current)
  return args
}

/**
 * The BroBot the update started again (null: none yet), and whether it was started with exactly
 * the arguments its way back gives: `--updated` from the installer's shortcut for the default
 * workspace, `--user-data-dir=<folder>` for any other — and nothing more (`exact`).
 */
export function cameBack(rows, folder) {
  const expected = folder === null ? ['--updated'] : [`--user-data-dir=${folder}`]
  const found = mainProcesses(rows).find((row) => {
    const line = String(row.CommandLine ?? '')
    return folder === null ? line.includes('--updated') : line.includes(`--user-data-dir=${folder}`)
  })
  if (found === undefined) return null
  const line = String(found.CommandLine)
  const args = argvOf(line).slice(1)
  return {
    ...found,
    args,
    exact: JSON.stringify(args) === JSON.stringify(expected),
    testSwitches: /--brobot-hidden|--remote-debugging-port/.test(line),
  }
}

/** The conversation `id` in a restart's waiting list, or null. */
export function waitingOn(state, id) {
  if (state?.kind !== 'waiting-to-restart') return null
  return state.stops.conversations.find((one) => one.conversation === id) ?? null
}
