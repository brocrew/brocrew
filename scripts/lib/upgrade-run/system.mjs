import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  appExeIn,
  bundleIn,
  requireEvidence,
  sha256,
  verifyCandidateSkills,
} from '../upgrade-path.mjs'
import { os, candidateNames, installKey, productNames, check, must } from './settings.mjs'

// 695-visible: normal upgrade rehearsal checks person-like starts on a hosted runner.
function run(program, argv, options = {}) {
  const done = spawnSync(program, argv, { encoding: 'utf8', timeout: 300_000, ...options })
  if (done.status !== 0) {
    throw new Error(
      `${program} ${argv.join(' ')} exited ${String(done.status)}: ${`${done.stderr ?? ''}${done.stdout ?? ''}`.trim().slice(0, 800)}`,
    )
  }
  return done.stdout ?? ''
}

function powershell(script) {
  return run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}\nexit 0`,
    ],
    { timeout: 60_000, windowsHide: true },
  )
}
const rowsOf = (json) => {
  const text = json.trim()
  if (text === '') return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}
function appsEntries() {
  return rowsOf(
    powershell(
      [
        `$keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'`,
        `$rows = foreach ($key in $keys) { if (Test-Path $key) { Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } } }`,
        `$installedIn = { param($guid) foreach ($root in 'HKCU:\\Software', 'HKLM:\\Software') { $at = Join-Path $root $guid; if (Test-Path -LiteralPath $at) { (Get-ItemProperty -LiteralPath $at -ErrorAction SilentlyContinue).InstallLocation } } }`,
        `$rows | Where-Object { $_.PSChildName -eq '${installKey}' } | Select-Object PSChildName,DisplayName,DisplayVersion,UninstallString,@{n='InstallLocation';e={ & $installedIn $_.PSChildName | Select-Object -First 1 }} | ConvertTo-Json -Compress`,
      ].join('\n'),
    ),
  )
}
const windowsProcesses = () => {
  if (productNames.size === 0) return []
  const programs = [...productNames].map((name) => `'${name}.exe'`).join(',')
  return rowsOf(
    powershell(
      `Get-CimInstance Win32_Process | Where-Object { @(${programs}) -contains $_.Name } | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`,
    ),
  )
}
const macPlistValue = (bundle, key) =>
  run('/usr/bin/plutil', ['-extract', key, 'raw', join(bundle, 'Contents', 'Info.plist')]).trim()
function bundlesOfTheApp() {
  return readdirSync('/Applications')
    .filter((name) => name.endsWith('.app'))
    .filter((name) => {
      const id = spawnSync(
        '/usr/bin/plutil',
        [
          '-extract',
          'CFBundleIdentifier',
          'raw',
          join('/Applications', name, 'Contents', 'Info.plist'),
        ],
        { encoding: 'utf8' },
      )
      return id.status === 0 && id.stdout.trim() === candidateNames.appId
    })
    .sort()
}
const samePath = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  (os === 'windows'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function installedCandidateSkills(candidate) {
  const folder =
    os === 'windows'
      ? join(dirname(candidate.exe), 'resources', 'built-in-skills')
      : join(candidate.exe, 'Contents', 'Resources', 'built-in-skills')
  requireEvidence(
    lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink(),
    'The installed candidate skill folder is not a directory.',
  )
  const read = (path, limit) => {
    const stat = lstatSync(path)
    requireEvidence(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit,
      'A candidate skill file is missing, linked or too large.',
    )
    return readFileSync(path)
  }
  const manifest = JSON.parse(read(join(folder, 'manifest.json'), 1_048_576).toString('utf8'))
  requireEvidence(Array.isArray(manifest.skills), 'The candidate skill manifest has no entries.')
  const bodies = new Map()
  for (const item of manifest.skills) {
    requireEvidence(
      typeof item?.name === 'string' && /^[a-z][a-z0-9-]{0,99}$/.test(item.name),
      'A candidate skill name is invalid.',
    )
    const inside = join(folder, item.name)
    requireEvidence(
      lstatSync(inside).isDirectory() && !lstatSync(inside).isSymbolicLink(),
      'A candidate skill body folder is not a directory.',
    )
    bodies.set(item.name, read(join(inside, 'SKILL.md'), 65_536))
  }
  const directories = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort()
  requireEvidence(
    JSON.stringify(directories) === JSON.stringify([...bodies.keys()].sort()),
    'The installed candidate skill folders do not match its manifest.',
  )
  return verifyCandidateSkills(manifest, bodies)
}

function install(installer, label) {
  const bytes = readFileSync(installer)
  const facts = { installer: basename(installer), bytes: bytes.length, sha256: sha256(bytes) }
  if (os === 'windows') {
    const silent = spawnSync(installer, ['/S'], { timeout: 300_000, windowsHide: true })
    const entries = appsEntries()
    Object.assign(facts, { exit: silent.status, entries })
    const folder = entries[0]?.InstallLocation ?? null
    must(
      silent.status === 0 && entries.length === 1 && folder !== null,
      `${label}: its installer ran silently, and Windows lists the app once`,
      facts,
    )
    facts.files = readdirSync(folder).sort()
    const { exe: program, productName } = appExeIn(facts.files)
    facts.productName = productName
    productNames.add(productName)
    const exe = join(folder, program)
    must(existsSync(exe), `${label}: installed in ${folder}, as ${program}`, facts)
    const startedByItself = windowsProcesses()
    if (
      !check(startedByItself.length === 0, `${label}: its installer started nothing`, {
        startedByItself,
      })
    ) {
      for (const row of startedByItself) {
        spawnSync('taskkill', ['/PID', String(row.ProcessId), '/T', '/F'], { windowsHide: true })
      }
    }
    return { exe, program: exe, productName, facts }
  }
  const mount = mkdtempSync(join(tmpdir(), 'upgrade-path-image-'))
  run('/usr/bin/hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-noautoopen',
    '-mountpoint',
    mount,
    installer,
  ])
  let bundle
  let productName
  try {
    ;({ bundle, productName } = bundleIn(readdirSync(mount)))
    const into = join('/Applications', bundle)
    if (existsSync(into)) rmSync(into, { recursive: true, force: true })
    run('/usr/bin/ditto', ['--rsrc', '--extattr', join(mount, bundle), into])
  } finally {
    spawnSync('/usr/bin/hdiutil', ['detach', mount, '-force'], { encoding: 'utf8' })
  }
  const app = join('/Applications', bundle)
  facts.productName = productName
  productNames.add(productName)
  facts.version = macPlistValue(app, 'CFBundleShortVersionString')
  facts.codesign = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
    encoding: 'utf8',
  }).status
  const program = join(app, 'Contents', 'MacOS', macPlistValue(app, 'CFBundleExecutable'))
  facts.inApplications = bundlesOfTheApp()
  must(existsSync(program), `${label}: ${app} is in place`, facts)
  return { exe: app, program, productName, facts }
}

export {
  run,
  appsEntries,
  windowsProcesses,
  bundlesOfTheApp,
  samePath,
  alive,
  installedCandidateSkills,
  install,
}
