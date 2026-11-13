import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { theVariablesFor } from '../lib/tests-run-in-a-fictional-home.mjs'

assert.equal(process.platform, 'win32', 'This proof must execute on native Windows')
const build = path.resolve(process.argv[2])
const evidence = path.resolve(process.argv[3])
const payload = path.join(build, 'package')
const helper = path.join(payload, 'bin', 'chrome-process-birth.exe')
const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'plugin.json'), 'utf8'))
assert.deepEqual(manifest.platforms, [{ os: 'win32', cpu: 'x64' }])
assert.equal(manifest.sourceCommit, process.env.GITHUB_SHA)
assert(manifest.files.some((file) => file.path === 'bin/chrome-process-birth.exe'))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-native-birth-'))
const record = {
  sourceCommit: manifest.sourceCommit,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  helper,
  observations: [],
}
function execute(label, program, args) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    env: { ...process.env, ...theVariablesFor(home) },
  })
  record.observations.push({
    label,
    program,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout,
    stderr: result.stderr,
  })
  assert.equal(result.error, undefined, label)
  assert.equal(result.signal, null, label)
  return result
}
function compareBirth(label, pid) {
  const facts = execute(`${label}:Windows-facts`, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid}; [Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture))`,
  ])
  assert.equal(facts.status, 0, label)
  assert.equal(facts.stderr, '', label)
  assert.match(facts.stdout, /^[1-9][0-9]{0,18}$/)
  const native = execute(`${label}:packaged-helper`, helper, [String(pid)])
  assert.equal(native.status, 0, label)
  assert.equal(native.stderr, '', label)
  assert.equal(native.stdout, facts.stdout + '\n', label)
}
async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded 5000ms`)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
let child
let closed
let failure
try {
  compareBirth('self', process.pid)
  child = spawn(
    process.execPath,
    ['-e', "process.stdout.write('ready\\n'); process.stdin.resume()"],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...theVariablesFor(home) },
    },
  )
  let childStderr = ''
  child.stderr.on('data', (bytes) => {
    childStderr += bytes.toString()
  })
  closed = new Promise((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal, stderr: childStderr })),
  )
  await bounded(
    new Promise((resolve, reject) => {
      child.once('error', reject)
      child.stdout.once('data', (bytes) => {
        if (bytes.toString() === 'ready\n') resolve()
        else reject(new Error(`Unexpected fixture readiness: ${bytes}`))
      })
    }),
    'child readiness',
  )
  compareBirth('live-child', child.pid)
  for (const pid of ['0', '4294967295']) {
    const invalid = execute(`invalid-${pid}`, helper, [pid])
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout, '')
    assert.notEqual(invalid.stderr.trim(), '')
  }
} catch (error) {
  failure = error
} finally {
  if (child) {
    child.stdin.end()
    try {
      record.childExit = await bounded(closed, 'child cleanup')
      assert.deepEqual(record.childExit, { code: 0, signal: null, stderr: '' })
    } catch (error) {
      failure ??= error
      child.kill()
      try {
        record.forcedChildExit = await bounded(closed, 'forced child cleanup')
      } catch (cleanupError) {
        record.cleanupError = cleanupError.stack
      }
    }
  }
  fs.rmSync(home, { recursive: true, force: true })
  record.failure = failure?.stack
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(
    path.join(evidence, 'packaged-birth.json'),
    JSON.stringify(record, null, 2) + '\n',
  )
  console.log(JSON.stringify(record, null, 2))
}
if (failure) throw failure
