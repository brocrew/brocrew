import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const [programInput, evidenceInput] = process.argv.slice(2)
assert.equal(process.platform, 'win32')
const program = path.resolve(programInput)
const evidence = path.resolve(evidenceInput)
fs.mkdirSync(evidence, { recursive: true })
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'native-birth-equality-'))
for (const name of ['tmp', 'AppData/Local', 'AppData/Roaming']) fs.mkdirSync(path.join(home, name), { recursive: true })
const system = process.env.SystemRoot ?? process.env.windir
assert.ok(system)
const hostEnv = {
  SystemRoot: system, windir: system, SystemDrive: system.slice(0, 2),
  PATH: [path.join(system, 'System32'), system, path.join(system, 'System32/WindowsPowerShell/v1.0')].join(';'),
  HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'),
  LOCALAPPDATA: path.join(home, 'AppData/Local'), TMP: path.join(home, 'tmp'),
  TEMP: path.join(home, 'tmp'), TMPDIR: path.join(home, 'tmp'),
}
const result = {
  helperSha256: createHash('sha256').update(fs.readFileSync(program)).digest('hex'),
  helperBytes: fs.statSync(program).size, node: process.version,
  samples: [], oracles: [], ok: false,
  scope: 'Native helper/API equality only; not installed Settings or cold Chrome acceptance',
}
const save = () => fs.writeFileSync(path.join(evidence, 'native-equality.json'), JSON.stringify(result, null, 2) + '\n')
const native = (pid, label) => {
  const began = performance.now()
  const ticks = execFileSync(program, [String(pid)], { encoding: 'utf8', env: hostEnv, windowsHide: true }).trim()
  assert.match(ticks, /^[1-9][0-9]{0,18}$/)
  result.samples.push({ label, pid, ticks, elapsedMs: performance.now() - began })
  save()
  return ticks
}
save()
let child
try {
  const selfBirth = native(process.pid, 'first measured helper launch, restricted host environment')
  for (let i = 0; i < 9; i++) assert.equal(native(process.pid, `repeat-${i + 1}`), selfBirth)
  child = spawn(process.execPath, ['-e', "process.stdout.write(String(process.pid)+'\\n');process.stdin.resume()"], {
    env: hostEnv, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
  })
  const [reported] = await once(child.stdout, 'data')
  assert.equal(Number(String(reported).trim()), child.pid)
  const foreignBirth = native(child.pid, 'distinct live child')
  assert.notEqual(foreignBirth, selfBirth)
  for (const [pid, wanted] of [[process.pid, selfBirth], [child.pid, foreignBirth]]) {
    const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
    const began = performance.now()
    // Oracle is deliberately AFTER the first native measurements; never an acceptance warm-up.
    const ticks = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    }).trim()
    result.oracles.push({ pid, ticks, elapsedMs: performance.now() - began, equalsNative: ticks === wanted })
    save()
    assert.equal(ticks, wanted, 'actual PowerShell 5.1 native tick string must equal helper exactly')
  }
  const exited = once(child, 'close')
  child.stdin.end()
  const [code, signal] = await exited
  assert.equal(code, 0)
  assert.equal(signal, null)
  child = undefined
  result.ok = true
} catch (error) {
  result.error = { message: error.message, stack: error.stack, code: error.code, status: error.status,
    signal: error.signal, stderr: error.stderr?.toString() }
  process.exitCode = 1
} finally {
  if (child) {
    const exited = once(child, 'close')
    child.kill()
    await exited
  }
  fs.rmSync(home, { recursive: true, force: true })
  save()
  console.log(JSON.stringify(result, null, 2))
}
