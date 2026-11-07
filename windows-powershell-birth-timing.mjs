import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [resources, mode, evidenceInput] = process.argv.slice(2)
if (process.platform !== 'win32' || !['no-profile', 'default-profile'].includes(mode))
  throw new Error('Windows timing diagnostic requires no-profile or default-profile')
const home = mkdtempSync(join(tmpdir(), 'powershell-birth-timing-'))
for (const dir of ['tmp', 'AppData/Roaming', 'AppData/Local']) mkdirSync(join(home, dir), { recursive: true })
const root = process.env.SystemRoot ?? process.env.windir
const env = {
  SystemRoot: root, windir: root, SystemDrive: root.slice(0, 2),
  PATH: [join(root, 'System32'), root, join(root, 'System32/WindowsPowerShell/v1.0')].join(';'),
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
  LOCALAPPDATA: join(home, 'AppData/Local'), TMP: join(home, 'tmp'), TEMP: join(home, 'tmp'),
  TMPDIR: join(home, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'UTC',
}
const flags = mode === 'no-profile' ? ['-NoProfile', '-NonInteractive'] : []
const command = `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
const samples = []
for (let index = 0; index < 4; index++) {
  const args = [...flags, '-Command', command]
  const start = performance.now()
  const result = spawnSync('powershell', args, { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
  const sample = {
    label: index === 0 ? 'first-call' : `warm-${index}`, mode, args,
    elapsedMs: performance.now() - start, status: result.status, signal: result.signal,
    error: result.error && { message: result.error.message, code: result.error.code },
    stdout: result.stdout, stderr: result.stderr,
  }
  samples.push(sample)
  process.stdout.write(JSON.stringify(sample) + '\n')
}
const inspect = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
$profiles = @($PROFILE.AllUsersAllHosts, $PROFILE.AllUsersCurrentHost, $PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost) | ForEach-Object { @{path=$_; exists=(Test-Path -LiteralPath $_)} };
$defender = try { Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled } catch { @{error=$_.Exception.Message} };
@{PSVersionTable=$PSVersionTable; profiles=$profiles; defender=$defender} | ConvertTo-Json -Depth 6
`], { env, encoding: 'utf8', timeout: 30000, windowsHide: true })
const evidence = resolve(evidenceInput)
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, mode + '.json'), JSON.stringify({
  mode, resources, node: process.version, samples,
  inspection: { status: inspect.status, signal: inspect.signal, stdout: inspect.stdout, stderr: inspect.stderr, error: inspect.error?.message },
  limits: 'First-call means first powershell.exe invocation by this job. Separate fresh runner per mode. No installer proof or pre-warm recommendation. Defender/profile causality is not established by status alone.',
}, null, 2))
