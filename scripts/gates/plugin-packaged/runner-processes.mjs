// Best-effort hosted cleanup only. No enumeration or signalling entry is allowed on a local Mac.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { ownedRoot, requireCI } from './contract.mjs'
import { fixtureEnvironment } from './prepare.mjs'
import { bounded, drainOwned } from './processes.mjs'
import { stepFailure, readFailure } from './diagnostics.mjs'
const exec = promisify(execFile)
const census = fileURLToPath(new URL('./census.py', import.meta.url))
async function readProcesses(root, signal) {
  requireCI()
  const ci = Object.fromEntries(
    ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_REF', 'RUNNER_ENVIRONMENT'].map((key) => [
      key,
      process.env[key],
    ]),
  )
  const result = await exec('/usr/bin/python3', ['-I', '-B', census], {
    env: fixtureEnvironment(root, ci),
    signal,
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const rows = JSON.parse(result.stdout)
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) => !identity(row) || !(row.executable === null || path.isAbsolute(row.executable)),
    )
  )
    throw new Error('Invalid process observation')
  return rows
}
const identity = (row) =>
  row &&
  Number.isSafeInteger(row.pid) &&
  row.pid > 1 &&
  Number.isSafeInteger(row.group) &&
  row.group > 1 &&
  typeof row.birth === 'string' &&
  row.birth.length > 0 &&
  row.birth.length < 128
function folder(root) {
  ownedRoot(root)
  const target = path.join(root, 'process-groups')
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  const info = fs.lstatSync(target)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  )
    throw new Error('Invalid process record folder')
  return target
}
function remember(root, row) {
  if (!identity(row)) throw new Error('Invalid process identity')
  const bytes = JSON.stringify({ pid: row.pid, group: row.group, birth: row.birth })
  const file = path.join(folder(root), createHash('sha256').update(bytes).digest('hex') + '.json')
  let fd
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    )
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
function remembered(root) {
  const dir = folder(root),
    names = fs.readdirSync(dir)
  if (names.length > 4096) throw new Error('Too many process records')
  return names.map((name) => {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Invalid process record name')
    const fd = fs.openSync(
      path.join(dir, name),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    )
    try {
      const info = fs.fstatSync(fd)
      if (
        !info.isFile() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077 ||
        info.nlink !== 1 ||
        info.size > 512
      )
        throw new Error('Invalid process record')
      const row = JSON.parse(fs.readFileSync(fd))
      if (!identity(row) || Object.keys(row).sort().join(',') !== 'birth,group,pid')
        throw new Error('Invalid process record')
      return row
    } finally {
      fs.closeSync(fd)
    }
  })
}
function incomplete(root, error, observed = 'admission-missing') {
  try {
    fs.writeFileSync(path.join(root, 'group-observation-incomplete'), '1\n', {
      mode: 0o600,
      flag: 'wx',
    })
  } catch {
    /* Keep the attempt non-fatal; no link is followed. */
  }
  try {
    fs.writeFileSync(
      path.join(root, 'admission-failure.json'),
      JSON.stringify(stepFailure('drain', 'admission', error, observed)),
      { mode: 0o600, flag: 'wx' },
    )
  } catch {
    // Keep only a closed diagnostic; never follow or overwrite an existing receipt.
  }
}
export async function registerChild(root, child, read) {
  if (!read) requireCI()
  read ??= () => readProcesses(root)
  ownedRoot(root)
  try {
    const rows = await read()
    const row = rows.find((one) => one.pid === child.pid)
    // An actual exit plus a successful empty-group observation needs no live birth anchor.
    // A missing observation alone, or any surviving unanchored member, still fails closed.
    if (
      !row &&
      (Number.isInteger(child.exitCode) || typeof child.signalCode === 'string') &&
      !rows.some((one) => one.group === child.pid)
    )
      return true
    if (!row || row.group !== child.pid) throw new Error('Started group not observed')
    for (const member of rows.filter((one) => one.group === row.group)) remember(root, member)
    return true
  } catch (error) {
    incomplete(root, error)
    return false
  }
}
/** Only current birth-matched members can anchor a saved group; recycled identities are ignored. */
export function runnerAdapter(root, mode = 'roots', io = {}) {
  if (!io.read || !io.send) requireCI()
  ownedRoot(root)
  if (!['groups', 'roots'].includes(mode)) throw new Error('Invalid cleanup mode')
  const read = io.read ?? (() => readProcesses(root, io.abortSignal))
  const send =
    io.send ??
    ((group, signal) => {
      requireCI()
      if (io.abortSignal?.aborted) throw new Error('Cleanup deadline')
      process.kill(-group, signal)
    })
  const list = async () => {
    if (io.abortSignal?.aborted) throw new Error('Cleanup deadline')
    const rows = await read(),
      pins = remembered(root)
    if (!Array.isArray(rows) || rows.some((row) => !identity(row)))
      throw new Error('Invalid process observation')
    const groups = new Set(
      rows
        .filter((row) =>
          pins.some(
            (pin) => pin.pid === row.pid && pin.birth === row.birth && pin.group === row.group,
          ),
        )
        .map((row) => row.group),
    )
    if (mode === 'roots')
      for (const row of rows) if (row.executable?.startsWith(root + '/')) groups.add(row.group)
    // A known numeric group with no surviving birth anchor is ambiguous after leader loss.
    // Skip unsafe signalling and report an incomplete attempt, even when other targets drain.
    const known = new Set(pins.map((pin) => pin.group))
    if (
      rows.some(
        (row) =>
          known.has(row.group) &&
          !groups.has(row.group) &&
          !rows.some((leader) => leader.pid === row.group),
      )
    )
      incomplete(root)
    const selected = rows.filter((row) => groups.has(row.group))
    for (const row of selected) remember(root, row)
    return selected
  }
  return {
    list,
    async signal(row, signal) {
      if (!['SIGTERM', 'SIGKILL'].includes(signal)) throw new Error('Invalid cleanup signal')
      const current = await list()
      if (
        current.some(
          (now) => now.pid === row.pid && now.birth === row.birth && now.group === row.group,
        )
      ) {
        try {
          await send(row.group, signal)
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
    },
  }
}
export async function bestEffortDrain(root, stopLaunchers = async () => {}, io = {}) {
  if (!io.adapter) requireCI()
  const result = { drained: false, boundary: 'hosted-vm-teardown' }
  let failed = false
  const report = (step, error) => {
    failed = true
    io.report?.(
      stepFailure(
        'drain',
        step,
        error,
        error?.name === 'AbortError' || /deadline|did not exit/.test(error?.message ?? '')
          ? 'timeout'
          : undefined,
      ),
    )
  }
  try {
    await bounded(Promise.resolve().then(stopLaunchers), 2000)
  } catch (error) {
    report('stop-launchers', error)
  }
  for (const mode of ['groups', 'roots']) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 3000)
    try {
      const adapter = (io.adapter ?? runnerAdapter)(root, mode, { abortSignal: abort.signal })
      await bounded(drainOwned(adapter, { grace: 500, deadline: 3000 }), 3500)
    } catch (error) {
      report(mode, error)
    } finally {
      clearTimeout(timer)
      abort.abort()
    }
  }
  if (fs.existsSync(path.join(root, 'group-observation-incomplete'))) {
    failed = true
    io.report?.(
      readFailure(root, 'admission-failure.json') ??
        stepFailure('drain', 'admission', {}, 'admission-missing'),
    )
  }
  result.drained = !failed
  return result
}
