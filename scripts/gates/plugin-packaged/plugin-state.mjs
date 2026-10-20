import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ownedRoot, requireCI } from './contract.mjs'
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
  receiptExists: false,
})
export function safePluginState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') ===
      'buttonCategory,diskObserved,errorCategory,installedRecordExists,receiptExists,rowPresent,stateCategory' &&
    ['rowPresent', 'diskObserved', 'installedRecordExists', 'receiptExists'].every(
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
export function chromeDiskState(root, global, workspace) {
  const absent = { diskObserved: false, installedRecordExists: false, receiptExists: false }
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
    directory(workspace)
    const state = path.join(global, 'state')
    try {
      fs.lstatSync(state)
    } catch (error) {
      if (error.code === 'ENOENT') return { ...absent, diskObserved: true }
      throw error
    }
    directory(state)
    const guard = directory(path.join(state, 'lifecycle-guard'))
    const activations = directory(path.join(state, 'activations'))
    let total = 0
    const json = (folder, name) => {
      directory(folder)
      const fd = fs.openSync(
        path.join(folder, name),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      )
      try {
        const info = fs.fstatSync(fd)
        if (
          !info.isFile() ||
          info.uid !== process.getuid() ||
          info.mode & 0o077 ||
          info.size > 128 * 1024
        )
          throw new Error('Unsafe diagnostic record')
        total += info.size
        if (total > 32 * 1024 * 1024) throw new Error('Diagnostic limit')
        const bytes = fs.readFileSync(fd)
        if (bytes.length !== info.size) throw new Error('Changed diagnostic record')
        return JSON.parse(bytes.toString('utf8'))
      } finally {
        fs.closeSync(fd)
      }
    }
    const names = () =>
      fs
        .readdirSync(guard)
        .filter((name) => /^\d{8}\.json$/.test(name))
        .sort()
    const records = names()
    if (records.length > 4096) throw new Error('Diagnostic limit')
    const hash = createHash('sha256').update(workspace).digest('hex')
    const workspaceId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    let activation, receipt
    const operations = new Map()
    for (const name of records) {
      const event = json(guard, name).event
      if (!event || typeof event !== 'object') throw new Error('Invalid diagnostic record')
      if (event.kind === 'prepared')
        operations.set(event.operation.request.operationId, event.operation)
      else if (event.kind === 'completed' || event.kind === 'aborted') {
        activation = event.activation?.name
        const operation = operations.get(event.operationId)
        if (
          operation?.request.consent.pluginId === 'chrome' &&
          operation.request.workspaces?.includes(workspaceId)
        )
          receipt =
            event.kind === 'completed' && operation.request.consent.action === 'install'
              ? operation.next
              : undefined
      } else if (
        event.kind === 'projected' &&
        event.pluginId === 'chrome' &&
        event.workspaceId === workspaceId
      )
        receipt = event.receipt ?? undefined
    }
    let installed
    if (activation !== undefined) {
      if (!/^\d{8}-[a-f0-9]{64}\.json$/.test(activation)) throw new Error('Invalid diagnostic name')
      installed = json(activations, activation).entries?.find(
        (entry) => entry.pluginId === 'chrome' && entry.phase === 'active',
      )
    }
    if (records.join(',') !== names().join(',')) throw new Error('Diagnostic journal changed')
    return {
      diskObserved: true,
      installedRecordExists: !!installed,
      receiptExists:
        !!installed && receipt?.pluginId === 'chrome' && receipt.installId === installed.installId,
    }
  } catch {
    return absent
  }
}

export async function pluginStateSnapshot(root, global, workspace, port, io = {}) {
  if (!io.connect) requireCI()
  const disk = (io.disk ?? chromeDiskState)(root, global, workspace)
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
