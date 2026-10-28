import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { theVariablesFor } from '../../lib/tests-run-in-a-fictional-home.mjs'
import { attach } from '../../lib/update-rehearsal-app.mjs'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { demand, below } from './contract.mjs'

let cancelled = false
export function cancellation(records) {
  const onSignal = () => {
    cancelled = true
    for (const r of records) if (!r.closed) r.child.kill('SIGTERM')
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  return {
    get cancelled() {
      return cancelled
    },
    close() {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
    },
  }
}

export function environment(root) {
  const home = path.join(root, 'home'),
    tmp = path.join(root, 'tmp'),
    bin = path.join(root, 'bin')
  for (const p of [home, tmp, bin]) fs.mkdirSync(p, { recursive: true, mode: 0o700 })
  if (process.platform === 'darwin' && !fs.existsSync(path.join(bin, 'security')))
    fs.writeFileSync(path.join(bin, 'security'), '#!/bin/sh\nexit 44\n', {
      flag: 'wx',
      mode: 0o700,
    })
  const system =
    process.platform === 'win32'
      ? {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.SystemRoot,
          COMSPEC: path.join(process.env.SystemRoot, 'System32/cmd.exe'),
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
        }
      : Object.fromEntries(
          ['__CF_USER_TEXT_ENCODING', 'XPC_FLAGS', 'XPC_SERVICE_NAME']
            .filter((k) => /^[a-zA-Z0-9x._:-]{1,160}$/.test(process.env[k] ?? ''))
            .map((k) => [k, process.env[k]]),
        )
  return {
    ...system,
    ...theVariablesFor(home),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    CI: 'true',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_userconfig: path.join(root, 'npm-user'),
    npm_config_globalconfig: path.join(root, 'npm-global'),
    npm_config_cache: path.join(root, 'npm-cache'),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_CACHE: path.join(root, 'electron-cache'),
    ELECTRON_BUILDER_CACHE: path.join(root, 'builder-cache'),
  }
}
export async function bounded(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Gate deadline')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
// Retain direct handles before awaiting startup; no group/PID-list signalling.
export function launch(program, args, options, records) {
  demand(!cancelled)
  const child = spawn(program, args, {
    ...options,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tails = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  const retain = (stream, chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    tails[stream] = Buffer.concat([tails[stream], bytes]).subarray(-64 * 1024)
  }
  let stdout = '',
    overflow = false
  child.stdout.on('data', (b) => {
    retain('stdout', b)
    if (stdout.length + b.length > 8 * 1024 * 1024) overflow = true
    else stdout += b
  })
  child.stderr.on('data', (b) => retain('stderr', b))
  const record = { child, closed: false, code: null, signal: null, overflow: false }
  record.close = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      record.closed = true
      record.code = code
      record.signal = signal
      resolve({ code, signal })
    }),
  )
  record.start = new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  record.tails = () => ({ stdout: tails.stdout.toString('utf8'), stderr: tails.stderr.toString('utf8') })
  record.output = () => {
    demand(!overflow)
    return stdout
  }
  records.push(record)
  return record
}
// Optional SDK-stage diagnostics only; observer faults never replace process behavior.
function processBoundary(observer, operation, awaitPhase, configuredTimeoutMs, failed = false) {
  if (typeof observer !== 'function') return
  try { observer(operation, awaitPhase, configuredTimeoutMs, failed) } catch {}
}
export async function stop(record, { observer, operation } = {}) {
  if (record.closed) return
  let stopMs = 20000
  try {
    processBoundary(observer, operation, 'STOP', stopMs)
    record.child.kill('SIGTERM')
    try {
      await bounded(record.close, 20000)
    } catch {
      // Only this held child handle, never a process group or discovered descendant.
      stopMs = 10000
      processBoundary(observer, operation, 'STOP', stopMs)
      record.child.kill('SIGKILL')
      await bounded(record.close, 10000)
    }
    demand(record.closed)
  } catch (error) {
    processBoundary(observer, operation, 'STOP', stopMs, true)
    throw error
  }
}
export async function command(program, args, root, records, { cwd = root, ms = 420000, observer, operation } = {}) {
  let awaitPhase = 'START', configuredTimeoutMs = null
  processBoundary(observer, operation, awaitPhase, configuredTimeoutMs)
  const r = launch(program, args, { cwd, env: environment(root) }, records)
  try {
    await r.start
    awaitPhase = 'CLOSE'; configuredTimeoutMs = ms
    processBoundary(observer, operation, awaitPhase, configuredTimeoutMs)
    const result = await bounded(r.close, ms)
    awaitPhase = 'EXIT'; configuredTimeoutMs = null
    processBoundary(observer, operation, awaitPhase, configuredTimeoutMs)
    demand(result.code === 0)
    return r.output()
  } catch (error) {
    processBoundary(observer, operation, awaitPhase, configuredTimeoutMs, true)
    if (observer) await stop(r, { observer, operation })
    else await stop(r)
    throw error
  }
}

export function powershell() {
  return path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
}
export const quote = (s) => `'${s.replaceAll("'", "''")}'`
export async function privateRoot(root, records, { commandMs = 420000, observer } = {}) {
  demand(fs.realpathSync.native(root) === root)
  if (process.platform === 'darwin') {
    fs.chmodSync(root, 0o700)
    const s = fs.lstatSync(root)
    demand(
      s.isDirectory() &&
        !s.isSymbolicLink() &&
        s.uid === process.getuid() &&
        (s.mode & 0o077) === 0,
    )
    return
  }
  const sid = (
    await command(
      powershell(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      ],
      root,
      records,
      { ms: commandMs, ...(observer ? { observer, operation: 'SID' } : {}) },
    )
  ).trim()
  demand(/^S-1-5-\d+(?:-\d+)+$/.test(sid))
  const icacls = path.join(process.env.SystemRoot, 'System32/icacls.exe')
  await command(
    icacls,
    [root, '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q'],
    root,
    records,
    { ms: commandMs, ...(observer ? { observer, operation: 'GRANT' } : {}) },
  )
  await command(icacls, [root, '/inheritance:r', '/Q'], root, records, {
    ms: commandMs,
    ...(observer ? { observer, operation: 'INHERITANCE' } : {}),
  })
  const sddl = (
    await command(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Acl -LiteralPath ${quote(root)}).Sddl`],
      root,
      records,
      { ms: commandMs, ...(observer ? { observer, operation: 'SDDL' } : {}) },
    )
  ).trim()
  processBoundary(observer, 'ACL_PREDICATE', 'START', null)
  const { onlyTheThree } = await import('../plugin-windows/gate.mjs')
  processBoundary(observer, 'ACL_PREDICATE', 'EXIT', null)
  demand(onlyTheThree(sddl, sid))
}
export function sampleScript(root, pid = process.pid) {
  return `@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and $_.ProcessId -ne ${pid} -and ("$($_.ExecutablePath) $($_.CommandLine)").ToLower().Contains(${quote(root.toLowerCase())})} | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`
}
export async function samples(root, records, envRoot = root, { observer, operation } = {}) {
  if (process.platform === 'win32') {
    const script = sampleScript(root)
    const s = (
      await command(
        powershell(),
        ['-NoProfile', '-NonInteractive', '-Command', script],
        envRoot,
        records,
        { ms: 60000, ...(observer ? { observer, operation } : {}) },
      )
    ).trim()
    const parsed = s ? JSON.parse(s) : []
    return (Array.isArray(parsed) ? parsed : [parsed]).map((r) => ({
      pid: r.ProcessId,
      name: r.Name,
    }))
  }
  const s = await command('/bin/ps', ['-axo', 'pid=,command='], envRoot, records, { ms: 15000, ...(observer ? { observer, operation } : {}) })
  return s.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    return m && Number(m[1]) !== process.pid && m[2].includes(root)
      ? [{ pid: Number(m[1]), name: m[2] }]
      : []
  })
}
export async function stopAll(records, stopOne = stop) {
  // Attempt every held handle even if another stop rejects. No discovered PID is signalled.
  const attempts = await Promise.allSettled(
    records
      .filter((r) => !r.closed)
      .reverse()
      .map((r) => Promise.resolve().then(() => stopOne(r))),
  )
  return attempts.every((result) => result.status === 'fulfilled') && records.every((r) => r.closed)
}
export async function cleanup(root, records) {
  const stopped = await stopAll(records)
  const directClosed = stopped && records.every((r) => r.closed)
  // Discovered descendants are observed only. Unknown/surviving children retain all scratch.
  for (let i = 0; i < 20; i++) {
    const first = await samples(root, records)
    if (first.length === 0) {
      await delay(250)
      if ((await samples(root, records)).length === 0)
        return { directClosed, twoEmptySamples: true }
    }
    await delay(500)
  }
  return { directClosed, twoEmptySamples: false }
}
async function port() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
export async function startApp({ root, app, workspace, global, records }) {
  demand([workspace, global].every((p) => below(root, p)))
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 })
  const p = await port()
  const exe =
    process.platform === 'darwin'
      ? path.join(app, 'Contents/MacOS/BroCrew')
      : path.join(app, 'BroCrew.exe')
  const r = launch(
    exe,
    [
      HIDDEN_LAUNCH_ARG,
      '--use-mock-keychain',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${p}`,
      `--user-data-dir=${workspace}`,
      `--plugin-global-root=${global}`,
    ],
    { env: environment(root) },
    records,
  )
  await r.start
  r.port = p
  r.cdp = await bounded(attach(p, { wait: 90000 }), 95000)
  const evaluate = r.cdp.evaluate
  r.cdp.evaluate = (body) => bounded(evaluate(body), 65000)
  return r
}
export async function quit(r) {
  try {
    await bounded(r.cdp.send('Browser.close'), 5000)
  } catch {
    // CDP may already be disconnected; continue closing the process.
  }
  r.cdp?.close()
  try {
    await bounded(r.close, 20000)
  } catch {
    await stop(r)
  }
}
