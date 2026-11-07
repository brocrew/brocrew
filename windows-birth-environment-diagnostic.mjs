import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [resources, environment, first, evidenceInput] = process.argv.slice(2)
if (process.platform !== 'win32' || !['host', 'runner'].includes(environment) || !['cmdlet', 'dotnet'].includes(first))
  throw new Error('Windows diagnostic requires host|runner and cmdlet|dotnet')
const metadata = JSON.parse(readFileSync(join(resources, 'plugin-node/runtime.json'), 'utf8'))
const nodeSha256 = createHash('sha256').update(readFileSync(process.execPath)).digest('hex')
if (nodeSha256 !== metadata.sha256) throw new Error('packaged runtime hash differs')
const home = mkdtempSync(join(tmpdir(), 'birth-environment-'))
for (const dir of ['tmp', 'AppData/Roaming', 'AppData/Local']) mkdirSync(join(home, dir), { recursive: true })
const root = process.env.SystemRoot ?? process.env.windir
const host = {
  SystemRoot: root, windir: root, SystemDrive: root.slice(0, 2),
  PATH: [join(root, 'System32'), root, join(root, 'System32/WindowsPowerShell/v1.0')].join(';'),
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
  LOCALAPPDATA: join(home, 'AppData/Local'), TMP: join(home, 'tmp'), TEMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'),
}
const runner = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|KEY|AUTH|CREDENTIAL/i.test(key)))
const env = { ...(environment === 'host' ? host : runner), LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }
const commands = {
  cmdlet: `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
  dotnet: `[System.Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().Ticks`,
}
const samples = []
for (let index = 0; index < 11; index++) {
  const query = index === 0 ? first : index % 2 === 1 ? 'cmdlet' : 'dotnet'
  const args = ['-NoProfile', '-NonInteractive', '-Command', commands[query]]
  const start = performance.now()
  const result = spawnSync('powershell', args, { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
  const sample = {
    label: index === 0 ? 'first-measured-call' : `comparison-${index}`, environment, query, args,
    elapsedMs: performance.now() - start, status: result.status, signal: result.signal,
    error: result.error && { message: result.error.message, code: result.error.code },
    stdout: result.stdout, stderr: result.stderr,
  }
  samples.push(sample)
  process.stdout.write(JSON.stringify(sample) + '\n')
}
const successful = samples.filter((sample) => sample.status === 0 && /^[0-9]+$/.test(sample.stdout.trim()))
const values = [...new Set(successful.map((sample) => sample.stdout.trim()))]
const report = {
  environment, first, runtime: metadata, nodeSha256, pid: process.pid,
  environmentKeys: Object.keys(env).sort(), samples,
  successfulValueCount: successful.length, exactBirthValues: values,
  pairedValueEquality: ['cmdlet', 'dotnet'].every((query) => successful.some((sample) => sample.query === query)) && values.length === 1,
  limits: 'First measured command on each fresh VM; installer/actions may have invoked PowerShell earlier. Comparison calls are diagnostic measurements, never acceptance pre-warm. Runner environment omits credential-named variables. Equal strings prove matching observed ticks for this process only. Capture success is not a product pass.',
}
const evidence = resolve(evidenceInput)
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, `${environment}-${first}.json`), JSON.stringify(report, null, 2))
process.stdout.write(JSON.stringify({ pairedValueEquality: report.pairedValueEquality, exactBirthValues: values }) + '\n')
