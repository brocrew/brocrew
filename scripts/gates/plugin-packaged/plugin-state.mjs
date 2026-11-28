import fs from 'node:fs'
import path from 'node:path'
import { ownedRoot, requireCI } from './fixture-guards.mjs'
import { connectDiagnosticPage } from './page-state.mjs'
import { bounded } from './processes.mjs'
import { closedFrames } from './diagnostics.mjs'

const states = [
  'available',
  'installing',
  'installed-stopped',
  'starting',
  'running',
  'unhealthy',
  'update-available',
  'absent',
  'other',
]
const buttons = ['install', 'open', 'retry', 'none', 'other']
const errors = ['none', 'supervisor', 'host', 'verify', 'receipt', 'other']
export const unknownPluginState = () => ({
  rowPresent: false,
  stateCategory: 'other',
  buttonCategory: 'none',
  errorCategory: 'other',
  diskObserved: false,
  installedRecordExists: false,
})
export function safePluginState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') ===
      'buttonCategory,diskObserved,errorCategory,installedRecordExists,rowPresent,stateCategory' &&
    ['rowPresent', 'diskObserved', 'installedRecordExists'].every(
      (key) => typeof value[key] === 'boolean',
    ) &&
    states.includes(value.stateCategory) &&
    buttons.includes(value.buttonCategory) &&
    errors.includes(value.errorCategory)
  )
}
// Serialized into the page. DOM text is reduced to these categories inside the renderer.
export function chromeRowInPage(doc) {
  const row = doc.querySelector('[data-plugin="chrome"][data-cy="plugin-card"]')
  const error =
    row?.querySelector('[data-cy="plugins-error"]') ??
    doc.querySelector('[data-cy="plugins-error"]')
  const message = error?.textContent ?? ''
  const errorCategory = !error
    ? 'none'
    : /\bsupervisor\b/i.test(message)
      ? 'supervisor'
      : /\bhost\b/i.test(message)
        ? 'host'
        : /\bverif(?:y|ication)\b|\bdigest\b|\bsignature\b/i.test(message)
          ? 'verify'
          : /\breceipt\b/i.test(message)
            ? 'receipt'
            : 'other'
  if (!row)
    return { rowPresent: false, stateCategory: 'absent', buttonCategory: 'none', errorCategory }
  const label = row.querySelector('[data-cy="plugin-state"]')?.textContent?.trim()
  const stateCategory =
    [
      ['Available', 'available'],
      ['Installing', 'installing'],
      ['Installed', 'installed-stopped'],
      ['Starting', 'starting'],
      ['Running', 'running'],
      ['Needs setup', 'unhealthy'],
      ['Unavailable', 'unhealthy'],
      ['Update available', 'update-available'],
    ].find(([text]) => text === label)?.[1] ?? 'other'
  const buttonCategory = row.querySelector('[data-cy="plugin-configure"]')
    ? 'open'
    : row.querySelector('[data-cy="plugin-install"]')
      ? 'install'
      : row.querySelector('[data-cy="plugin-retry"]')
        ? 'retry'
        : row.querySelector('button')
          ? 'other'
          : 'none'
  return { rowPresent: true, stateCategory, buttonCategory, errorCategory }
}

/** Presence only, never state admission: do not open the product store or acquire its writer lock. */
export function chromeDiskState(root, global) {
  const absent = { diskObserved: false, installedRecordExists: false }
  try {
    ownedRoot(root)
    const directory = (folder) => {
      const relative = path.relative(root, folder)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('Outside fixture')
      const info = fs.lstatSync(folder)
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077 ||
        fs.realpathSync(folder) !== folder
      )
        throw new Error('Unsafe diagnostic folder')
      return folder
    }
    directory(global)
    const state = path.join(global, 'state')
    // One file per sequence; the highest is the current state.
    const highest = () =>
      fs
        .readdirSync(state)
        .filter((name) => /^plugin-state\.\d{12}\.json$/.test(name))
        .sort()
        .at(-1)
    let fd
    try {
      directory(state)
      for (let tried; ; ) {
        const current = highest()
        if (current === undefined) return { ...absent, diskObserved: true }
        try {
          fd = fs.openSync(
            path.join(state, current),
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
          )
          break
        } catch (error) {
          // A newer write removed it after the listing: read the newer one, once.
          if (error.code !== 'ENOENT' || tried === current) throw error
          tried = current
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') return { ...absent, diskObserved: true }
      throw error
    }
    let file
    try {
      const info = fs.fstatSync(fd)
      if (
        !info.isFile() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077 ||
        info.size > 4 * 1024 * 1024
      )
        throw new Error('Unsafe diagnostic record')
      const bytes = fs.readFileSync(fd)
      if (bytes.length !== info.size) throw new Error('Changed diagnostic record')
      file = JSON.parse(bytes.toString('utf8'))
    } finally {
      fs.closeSync(fd)
    }
    if (!file || typeof file !== 'object' || !Array.isArray(file.active))
      throw new Error('Invalid diagnostic record')
    return {
      diskObserved: true,
      installedRecordExists: file.active.some(
        (entry) => entry?.pluginId === 'chrome' && entry.phase === 'active',
      ),
    }
  } catch {
    return absent
  }
}

export async function pluginStateSnapshot(root, global, port, io = {}) {
  if (!io.connect) requireCI()
  const disk = (io.disk ?? chromeDiskState)(root, global)
  const unknown = { ...unknownPluginState(), ...disk }
  const abort = new AbortController()
  let client
  try {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return unknown
    const row = await bounded(
      (async () => {
        client = await (io.connect ?? connectDiagnosticPage)(port, abort.signal)
        if (abort.signal.aborted) {
          client.close()
          throw new Error('Diagnostic ended')
        }
        return client.evaluate(`(${chromeRowInPage.toString()})(document)`)
      })(),
      5000,
    )
    const result = { ...row, ...disk }
    return safePluginState(result) ? result : unknown
  } catch {
    return unknown
  } finally {
    abort.abort()
    client?.close()
  }
}
export function printPluginState(value, write = (line) => console.log(line)) {
  if (safePluginState(value)) write('gate-plugin-state ' + JSON.stringify(value))
}
export const pluginStateFrames = (receive) =>
  closedFrames('gate-plugin-state ', safePluginState, receive)
