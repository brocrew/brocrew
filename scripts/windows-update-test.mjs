// The Windows update, end to end, on GitHub's Windows runner — run by the update rehearsal's
// workflows once A (0.0.98) and B (0.0.99) are built from one tree:
//
//   node scripts/windows-update-test.mjs --dist-a DIR --dist-b DIR --evidence DIR
//     --workspace default|another --marker-a MARKER --marker-b MARKER --source-sha SHA
//     (--feed-url URL [--serve-local] | --feed-github OWNER/REPO [--feed-private])
//
// The markers are what each package was built with (`extraMetadata.rehearsalMarker`), and the sha
// the commit both were built from: the installed A and the installed B must each say theirs, so a
// release another build left on the feed cannot pass.
//
// `--dist-a` holds A's installer and `latest.yml`; `--dist-b` holds B's `latest.yml`, and with
// `--serve-local` its installer too. With `--serve-local` this harness is the feed: it serves A's
// update file, then B's once A is ready. Otherwise it writes `a-ready.json` to the evidence folder
// once A is ready, and waits for the feed to serve B; on a private GitHub feed its own `GH_TOKEN`
// is the token the app reads the feed with.
//
// As a person would, through A's own window:
//
//  1. A is installed silently, for this user only (`/S`), and started normally.
//  2. A makes its own data: a fake Codex key, two conversations answered by a scripted local model,
//     and a draft typed and left unsent. Its window's Check for updates finds nothing newer. On the
//     other workspace, the person also turns automatic checks off. A is closed.
//  3. B is published (on GitHub, once every lane is ready). A starts again and finds B: by its own
//     automatic check on the default workspace, by the window's Check for updates on the other. The
//     window's Download fetches the installer, which electron-updater checks against the feed.
//  4. ⛔ The refusal: a third conversation's turn is held open, and Restart to update waits and names
//     it. Then a second workspace runs: the turn ends, and the restart still waits, for it. It
//     installs only once that workspace has closed.
//  5. A shut down first, then the installer ran, then B came back by itself on the same workspace:
//     one Apps entry, at B, in the same folder.
//  6. A's last data is read between A leaving and the installer starting B. B's first start made a
//     checked recovery copy of exactly that, rows and state files, and B's first run then changed
//     none of it: no row, native transcript byte or state file. B's second start makes no new copy,
//     shows A's conversations and the draft, asks nothing, finds no update to itself, and a
//     conversation A made goes on.
//
// ⚑ B's first start is the installer's own relaunch: no test can read its log or attach to its
// window. Its copy's order is proven by the copy itself, which is A's last data exactly, and a
// picture of the screen is kept of what it showed. The Mac lane reads the lines and the window.
// ⛔ It installs software and stops BroBot processes: it runs only on a GitHub-hosted Windows runner,
// which holds nobody's data, and refuses where BroBot is already installed or has data.
// ⛔ Nothing reaches a provider: the Codex key is fake and the model is a local server.
// Exit 0: every check held. Every log, picture and `summary.json` is written to the results folder.
//
// ⚠️ 695-visible: A and B are started as a person starts them, so the window's own buttons are the
// ones pressed and the installer's relaunch is the one a person sees. The second workspace, which
// only has to be running, is hidden. Only on a hosted runner.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import {
  aLocalFeed,
  aRecord,
  aScriptedModel,
  attach,
  codexConfigFor,
  menuSays,
  openTheUpdatesMenu,
  press,
  screenshot,
  sleep,
  theAppsEnvironment,
  until,
} from './lib/update-rehearsal-app.mjs'
import {
  aConversation,
  checkpointsIn,
  compareData,
  copyHoldsTheData,
  dataOf,
  firstStartProblems,
  goesOn,
  makeData,
  rowsShown,
  sameData,
  verifyCheckpoint,
  whatBShows,
  whatTheDataLacks,
} from './lib/update-rehearsal-data.mjs'
import {
  A_READY,
  appUpdateProblems,
  feedFromArgs,
  feedToken,
  servedUpdateFile,
  VERSION_A,
  VERSION_B,
} from './lib/update-rehearsal.mjs'
import {
  broBotEntries,
  cameBack,
  HOLD_MARKER,
  installFolderOf,
  mainProcesses,
  rowsOf,
  theRestartsOrder,
  waitingOn,
} from './lib/windows-update-test.mjs'
import { packageOfAsar } from './lib/mac-update-test.mjs'
import { readUpdateFile } from './release-check.mjs'

const { values } = parseArgs({
  options: {
    'dist-a': { type: 'string' },
    'dist-b': { type: 'string' },
    evidence: { type: 'string' },
    workspace: { type: 'string', default: 'default' },
    'feed-url': { type: 'string' },
    'serve-local': { type: 'boolean', default: false },
    'feed-github': { type: 'string' },
    'feed-private': { type: 'boolean', default: false },
    'marker-a': { type: 'string' },
    'marker-b': { type: 'string' },
    'source-sha': { type: 'string' },
  },
})
/**
 * ⚑ **Which workspace A runs**: `default` — the app's own folder, as a person who never names one
 * runs it; `another` — a folder named with `--user-data-dir`, with a space, a curly apostrophe and a
 * letter outside ASCII in its path.
 */
const workspace = values.workspace
const feed = feedFromArgs(values)
const servesItself = values['serve-local']
if (
  !values['dist-a'] ||
  !values['dist-b'] ||
  !values.evidence ||
  !values['marker-a'] ||
  !values['marker-b'] ||
  values['marker-a'] === values['marker-b'] ||
  !/^[a-f0-9]{40}$/.test(values['source-sha'] ?? '') ||
  (workspace !== 'default' && workspace !== 'another') ||
  (servesItself && feed.kind !== 'generic')
) {
  console.error(
    'usage: windows-update-test.mjs --dist-a DIR --dist-b DIR --evidence DIR --workspace default|another --marker-a MARKER --marker-b MARKER --source-sha SHA (--feed-url URL [--serve-local] | --feed-github OWNER/REPO [--feed-private])',
  )
  process.exit(2)
}
const distA = resolve(values['dist-a'])
const distB = resolve(values['dist-b'])
const results = resolve(values.evidence)
mkdirSync(results, { recursive: true })
const record = aRecord(results, `windows-update ${workspace}`)
const { say, check, must, fail, failures, keep } = record
const summary = {
  versions: { a: VERSION_A, b: VERSION_B },
  source: values['source-sha'],
  workspace,
  feed,
  steps: {},
}

/**
 * Run `script` in Windows PowerShell and answer what it printed. ⛔ A failure is an exit code: every
 * error stops the script (`Stop`) and leaves 3, unless the script silenced that one command itself;
 * only a script that ran to its end leaves 0.
 */
function powershell(script) {
  const run = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // ⚑ UTF-8 out: Windows PowerShell writes in the console's code page otherwise, and a folder
      // named with a letter outside it would not read back as itself.
      [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        "$ErrorActionPreference = 'Stop'",
        `try { & { ${script} }; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`,
      ].join('\n'),
    ],
    { encoding: 'utf8', timeout: 60_000, windowsHide: true },
  )
  if (run.status !== 0) {
    throw new Error(
      `PowerShell exited ${String(run.status)}${run.error ? ` (${run.error.message})` : ''}: ${`${run.stderr}${run.stdout}`.trim().slice(0, 600) || 'it said nothing'}`,
    )
  }
  return run.stdout
}
/**
 * BroBot's Apps entries (the Uninstall keys), which hive each is in — `HKCU` is an install for this
 * user only — and where each is installed. ⚠️ NSIS keeps the folder as `InstallLocation` under
 * `Software\<app guid>`, and the guid is the Uninstall key's own name.
 */
const appsEntries = () =>
  broBotEntries(
    rowsOf(
      powershell(
        [
          `$keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'`,
          `$rows = foreach ($key in $keys) { if (Test-Path $key) { Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } } }`,
          `$installedIn = { param($guid) foreach ($root in 'HKCU:\\Software', 'HKLM:\\Software') { $at = Join-Path $root $guid; if (Test-Path -LiteralPath $at) { (Get-ItemProperty -LiteralPath $at -ErrorAction SilentlyContinue).InstallLocation } } }`,
          `$rows | Where-Object { $_.DisplayName -like 'BroCrew*' } | Select-Object PSChildName,DisplayName,DisplayVersion,UninstallString,@{n='Hive';e={ ($_.PSPath -split '::')[1].Split('\\')[0] }},@{n='InstallLocation';e={ & $installedIn $_.PSChildName | Select-Object -First 1 }} | ConvertTo-Json -Compress`,
        ].join('\n'),
      ),
    ),
  )
const broBotProcesses = () =>
  rowsOf(
    powershell(
      `Get-CimInstance Win32_Process -Filter "Name='BroCrew.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ),
  )
const sha512Of = (file) => createHash('sha512').update(readFileSync(file)).digest('base64')
/**
 * What runs from the installed folder now: the app, its helpers and the providers it starts. ⚑ Not
 * the installer's uninstaller, which runs from there while an update replaces the files.
 */
const runningFrom = (folder) =>
  rowsOf(
    powershell(
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${folder.replace(/'/g, "''")}\\*' -and $_.Name -notlike 'Uninstall*' } | Select-Object ProcessId,Name | ConvertTo-Json -Compress`,
    ),
  )
/** A picture of the whole screen, as evidence of what a window nobody can attach to showed. */
function pictureOfTheScreen(file) {
  powershell(
    [
      'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
      '$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen',
      '$picture = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height',
      '$drawing = [System.Drawing.Graphics]::FromImage($picture)',
      '$drawing.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $picture.Size)',
      `$picture.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    ].join('\n'),
  )
}

/**
 * Stop a process: asked to close first (its windows get WM_CLOSE), then ended with its children.
 * ⚑ `taskkill` refuses to ask a process with no visible window ("can only be terminated
 * forcefully"): a hidden launch is ended at once. Answers whether it closed when asked.
 */
async function stopProcess(pid, label) {
  const alive = () => broBotProcesses().some((row) => row.ProcessId === pid)
  const asked = spawnSync('taskkill', ['/PID', String(pid)], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (asked.status === 0 && (await until(() => !alive(), 45_000))) {
    say(`${label} (pid ${String(pid)}) closed when asked`)
    return true
  }
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  say(
    `${label} (pid ${String(pid)}) was ended (${asked.status === 0 ? 'it did not close in 45 s' : `taskkill would not ask it: ${`${asked.stdout}${asked.stderr}`.trim()}`})`,
  )
  return false
}

// ── 0 · where this may run ─────────────────────────────────────────────────────────────────────
const aHostedRunner =
  process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
if (!aHostedRunner || process.platform !== 'win32') {
  console.error(
    'windows-update-test installs BroCrew and stops BroCrew processes: it runs only on a GitHub-hosted Windows runner.',
  )
  process.exit(2)
}
const appData = process.env.APPDATA
const defaultFolder = join(appData, '@brobot2', 'desktop')
/** `null` for the default workspace; else the folder A is started on. */
const namedFolder =
  workspace === 'another'
    ? join(process.env.USERPROFILE, 'BroBot workspaces', 'Team’s research ü')
    : null
const dataFolder = namedFolder ?? defaultFolder
/** The arguments that put a launch on A's workspace. */
const onTheWorkspace = namedFolder === null ? [] : [`--user-data-dir=${namedFolder}`]
summary.dataFolder = dataFolder
if (existsSync(defaultFolder) || existsSync(dataFolder) || appsEntries().length > 0) {
  console.error(`BroCrew is already installed here, or has data (${dataFolder}): refusing.`)
  process.exit(2)
}

// ── the app, started on a log file it writes both its outputs to, in order ─────────────────────
const launched = []
/**
 * ⚠️ A window a person must see is started without `windowsHide`: Node passes it as the process's
 * first show command, which the app's first window would take.
 */
function launch(exe, args, logName) {
  const logFile = join(results, logName)
  const fd = openSync(logFile, 'a')
  const child = spawn(exe, args, {
    stdio: ['ignore', fd, fd],
    windowsHide: args.includes(HIDDEN_LAUNCH_ARG) || exe === process.execPath,
    env: theAppsEnvironment(feed),
  })
  closeSync(fd)
  launched.push(child)
  say(`started ${basename(exe)} ${args.join(' ')} → pid ${String(child.pid)} (log ${logName})`)
  return { child, log: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '') }
}
const exited = (app) => app.child.exitCode !== null || app.child.signalCode !== null

let model = null
let localFeed = null
let exitCode = 1
try {
  // ── 0 · the last-resort closer still stops an app that will not leave ────────────────────────
  // ⚑ The update below sees A leave on its own, which is the closer's silent branch. This is the
  // other one, on Windows itself: a process that arms the shipped `closerProgram` against itself and
  // never leaves must be stopped at the deadline, with the closer's sentence.
  {
    const closerModule = pathToFileURL(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'apps',
        'desktop',
        'src',
        'main',
        'last-resort-exit.ts',
      ),
    ).href
    const stubFile = join(results, 'closer-stub.mjs')
    writeFileSync(
      stubFile,
      [
        `import { spawn } from 'node:child_process'`,
        `import { win32 } from 'node:path'`,
        `import { closerProgram } from ${JSON.stringify(closerModule)}`,
        `const program = closerProgram(process.pid, Date.now() + 1500, 1500, { image: win32.basename(process.execPath), tasklist: win32.join(process.env.SystemRoot, 'System32', 'tasklist.exe') })`,
        `spawn(process.execPath, ['-e', program], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref()`,
        `setInterval(() => {}, 1_000)`,
      ].join('\n'),
    )
    const stub = launch(process.execPath, [stubFile], 'closer-stub.log')
    const stopped = await until(() => exited(stub), 20_000, 250)
    summary.steps.closer = { stopped: Boolean(stopped), said: stub.log().trim() }
    check(
      Boolean(stopped) && /is being stopped now/.test(stub.log()),
      `the closer stopped a process that would not leave, and said so: ${JSON.stringify(summary.steps.closer)}`,
    )
  }

  // ── 1 · A, installed silently for this user ───────────────────────────────────────────────────
  const installerA = join(distA, `BroCrew-Setup-${VERSION_A}-x64.exe`)
  // ⚑ A's installer may come from the feed: it is the one A's update file names.
  must(
    sha512Of(installerA) === readUpdateFile(readFileSync(join(distA, 'latest.yml'), 'utf8')).sha512,
    `A's installer is the one its update file names (${basename(installerA)})`,
  )
  const install = spawnSync(installerA, ['/S'], { timeout: 300_000, windowsHide: true })
  const before = appsEntries()
  summary.steps.install = { exit: install.status, entries: before }
  check(install.status === 0, `A's installer ran silently and exited 0 (${String(install.status)})`)
  must(
    before.length === 1 && before[0].DisplayVersion === VERSION_A,
    `one Apps entry, at ${VERSION_A}: ${JSON.stringify(before)}`,
  )
  check(
    before[0].Hive === 'HKEY_CURRENT_USER',
    `installed for this user only (${String(before[0].Hive)})`,
  )
  const installDir = installFolderOf(before[0])
  const installedExe = join(installDir ?? '', 'BroCrew.exe')
  must(installDir !== null && existsSync(installedExe), `installed in ${String(installDir)}`)
  const appUpdate = readFileSync(join(installDir, 'resources', 'app-update.yml'), 'utf8')
  // ⚑ Held to the feed, and to carrying no token, before a word of it is kept as evidence.
  const feedProblems = appUpdateProblems(appUpdate, feed)
  must(
    feedProblems.length === 0,
    `A reads the feed it was given${feedProblems.length ? `: ${feedProblems.join('; ')}` : ''}`,
  )
  summary.steps.install.appUpdateYml = appUpdate
  const packagedA = packageOfAsar(join(installDir, 'resources', 'app.asar'))
  must(
    packagedA.version === VERSION_A && packagedA.rehearsalMarker === values['marker-a'],
    `the installed app is A as this commit built it (${String(packagedA.version)}, ${String(packagedA.rehearsalMarker)})`,
  )
  const updaterCacheDir =
    /^updaterCacheDirName: ?(\S+)$/m.exec(appUpdate)?.[1]?.replace(/^['"]|['"]$/g, '') ?? null
  await sleep(5_000)
  const afterTheFirstInstall = mainProcesses(broBotProcesses())
  check(
    afterTheFirstInstall.length === 0,
    `a first install starts no BroCrew: ${JSON.stringify(afterTheFirstInstall)}`,
  )

  // ── 2 · the world around it: a scripted model, and on a local rehearsal the feed ───────────────
  model = await aScriptedModel(HOLD_MARKER, record.stamp)
  const codexHome = join(dataFolder, 'provider-homes', 'default', 'brobot', 'codex')
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(join(codexHome, 'config.toml'), codexConfigFor(model.port))
  const releaseOf = (dist) => {
    const said = readUpdateFile(readFileSync(join(dist, 'latest.yml'), 'utf8'))
    return {
      said,
      files: [
        join(dist, 'latest.yml'),
        ...said.files.map((one) => join(dist, one.url)),
        ...said.files.map((one) => join(dist, `${one.url}.blockmap`)),
      ],
    }
  }
  const releaseA = releaseOf(distA)
  const releaseB = releaseOf(distB)
  if (servesItself) {
    localFeed = await aLocalFeed(record.stamp)
    // ⚑ Only A's update file: A's own blockmap is never served, so B downloads whole.
    localFeed.offer([releaseA.files[0]])
  }

  // ── 3 · A makes its data, and finds nothing newer ──────────────────────────────────────────────
  const a1 = launch(
    installedExe,
    ['--remote-debugging-port=9339', ...onTheWorkspace],
    'a-first.log',
  )
  const cdpA1 = await attach(9339)
  const first = await cdpA1.evaluate('return await window.api.updates.read()')
  check(first.version === VERSION_A, `A says it is ${String(first.version)}`)
  const builtA = await cdpA1.evaluate('return await window.api.getAppInfo()')
  must(
    builtA?.build?.commit === values['source-sha'],
    `A says it was built from this commit (${String(builtA?.build?.commit)})`,
  )
  const made = await makeData(cdpA1, { say })
  const rowsBefore = await rowsShown(cdpA1, made.conversations)
  summary.steps.made = { ...made, rowsBefore }
  await openTheUpdatesMenu(cdpA1)
  await press(cdpA1, '[data-cy="updates-check"]')
  const upToDate = await until(async () => {
    const said = await menuSays(cdpA1)
    return said.kind === 'idle' || said.kind === 'error' || said.kind === 'available' ? said : null
  }, 120_000)
  summary.steps.firstCheck = upToDate
  must(
    upToDate?.kind === 'idle' && /^Up to date/.test(upToDate.said ?? ''),
    `with only A on the feed, A's Check for updates finds nothing newer: ${JSON.stringify(upToDate)}`,
  )
  if (namedFolder !== null) {
    // ⚑ The person turns automatic checks off: B must find the choice kept, and this lane's A finds
    // B by the window's own Check for updates instead.
    await press(cdpA1, '[data-cy="updates-automatically"]')
    const off = await until(
      async () =>
        (await cdpA1.evaluate('return await window.api.updates.read()')).checkAutomatically ===
        false,
      10_000,
      250,
    )
    must(Boolean(off), 'automatic checks are off, as the person chose')
  }
  await screenshot(cdpA1, join(results, '1-a-up-to-date.png'))
  cdpA1.close()
  must(await stopProcess(a1.child.pid, 'A'), 'A closed as a person closes it')
  const baseline = dataOf(dataFolder)
  keep('data-before.json', `${JSON.stringify(baseline.summary, null, 2)}\n`)
  say(`the data A made, read with A closed: ${JSON.stringify(baseline.summary.counts)}`)
  // ⛔ A comparison of nothing with nothing would pass: what A made is all there to be compared.
  const lacking = whatTheDataLacks(baseline, made)
  must(
    lacking.length === 0,
    `the data holds each conversation's events, raw frames and native transcript, and the draft${lacking.length ? `: ${lacking.join('; ')}` : ''}`,
  )

  // ── 4 · B is published: this lane is ready, and the feed serves B ─────────────────────────────
  writeFileSync(
    join(results, A_READY),
    `${JSON.stringify({ lane: `windows-${workspace}`, conversations: made.conversations, dataFolder }, null, 2)}\n`,
  )
  if (localFeed !== null) {
    localFeed.offer(releaseB.files.filter((file) => existsSync(file)))
    say('the local feed now offers B')
  } else {
    say('ready, with only A on the feed: waiting for the feed to serve B')
  }
  const token = feedToken(feed, process.env)
  const served = await until(
    async () => {
      const text = await servedUpdateFile(feed, 'latest.yml', { token }).catch(() => null)
      return text !== null && readUpdateFile(text).version === VERSION_B ? text : null
    },
    70 * 60_000,
    // ⚑ A GitHub feed answers a limited number of times an hour.
    localFeed === null ? 30_000 : 1_000,
  )
  must(served !== null, 'the feed serves B')
  keep('latest.yml', served)
  const servedB = readUpdateFile(served)
  must(
    JSON.stringify(servedB) === JSON.stringify(releaseB.said),
    `the feed serves B as it was built: ${JSON.stringify(servedB)}`,
  )

  // ── 5 · A again finds B, and its window downloads it ──────────────────────────────────────────
  const appA = launch(
    installedExe,
    ['--remote-debugging-port=9340', ...onTheWorkspace],
    'a-second.log',
  )
  const cdpA = await attach(9340)
  let offered
  if (namedFolder === null) {
    // ⚑ The automatic check runs 30 s after a start; the window shows its dot on the rail.
    offered = await until(
      async () => {
        const dot = await cdpA.evaluate(
          `return document.querySelector('[data-cy="rail-update-dot"]') !== null`,
        )
        return dot ? await menuSays(cdpA) : null
      },
      180_000,
      2_000,
    )
    summary.steps.found = { how: 'the automatic check', ...offered }
  } else {
    await openTheUpdatesMenu(cdpA)
    await press(cdpA, '[data-cy="updates-check"]')
    offered = await until(async () => {
      const said = await menuSays(cdpA)
      return said.kind === 'available' ||
        said.kind === 'error' ||
        (said.kind === 'idle' && said.said !== 'Not checked yet.')
        ? said
        : null
    }, 120_000)
    summary.steps.found = { how: 'Check for updates', ...offered }
  }
  await screenshot(cdpA, join(results, '2-a-finds-b.png'))
  must(
    offered?.kind === 'available' && offered.said === `BroCrew ${VERSION_B} is available.`,
    `A found B through ${summary.steps.found.how}, and its window says so: ${JSON.stringify(offered)}`,
  )
  await press(cdpA, '[data-cy="updates-download"]')
  const ready = await until(
    async () => {
      const said = await menuSays(cdpA)
      return said.kind === 'ready' || said.kind === 'error' ? said : null
    },
    600_000,
    2_000,
  )
  summary.steps.download = ready
  await screenshot(cdpA, join(results, '3-a-ready.png'))
  must(
    ready?.kind === 'ready' && ready.said === `BroCrew ${VERSION_B} is ready.`,
    `downloaded, ready to restart: ${JSON.stringify(ready)}`,
  )
  if (updaterCacheDir !== null) {
    const pending = join(process.env.LOCALAPPDATA, updaterCacheDir, 'pending')
    const file = existsSync(pending)
      ? readdirSync(pending).find((one) => one.endsWith('.exe'))
      : undefined
    const sum = file === undefined ? null : sha512Of(join(pending, file))
    summary.steps.pending = { file, sha512: sum }
    check(
      sum === releaseB.said.sha512,
      `the downloaded installer's sha512 is the one the feed published (${String(file)})`,
    )
  }
  summary.steps.transfer = (
    appA.log().match(/updater: .*(blockmap|differential|Full download).*$/gim) ?? []
  ).slice(0, 10)

  // ── 6 · ⛔ the refusal: a turn running, then another workspace ──────────────────────────────────
  let held = null
  try {
    held = await aConversation(cdpA)
    const sent = await cdpA.evaluate(
      `return await window.api.runtime.send({ sessionId: ${JSON.stringify(held)}, text: ${JSON.stringify(`${HOLD_MARKER}: keep this turn open`)} }).then(() => 'sent').catch((e) => 'ERROR: ' + String(e))`,
    )
    if (sent !== 'sent') throw new Error(`the message was refused: ${String(sent)}`)
    if (!(await until(() => model.isHolding(), 180_000)))
      throw new Error('the scripted model was never asked')
    say(`a third conversation (${held}) is mid-turn: the scripted model holds its answer`)
  } catch (error) {
    fail(`the turn the refusal needs did not start: ${error.message}`)
  }
  // ⚑ The second workspace starts BEFORE the restart is pressed, so a turn that did not start cannot
  // let the restart through untested.
  const otherFolder = mkdtempSync(join(tmpdir(), 'brobot-update-test-other-'))
  const other = launch(
    installedExe,
    [HIDDEN_LAUNCH_ARG, `--user-data-dir=${otherFolder}`],
    'other-workspace.log',
  )
  check(
    Boolean(await until(() => existsSync(join(otherFolder, 'brobot2.sqlite')), 180_000)),
    'a second workspace is running, on its own data folder',
  )
  await openTheUpdatesMenu(cdpA)
  await press(cdpA, '[data-cy="updates-restart"]')
  if (held !== null) {
    const waiting = await until(
      async () =>
        waitingOn((await cdpA.evaluate('return await window.api.updates.read()')).state, held),
      60_000,
    )
    summary.steps.refusalTurn = waiting
    await screenshot(cdpA, join(results, '4-a-waits-for-the-turn.png'))
    check(
      waiting?.turnRunning === true,
      `the restart waits, and names the conversation mid-turn: ${JSON.stringify(waiting)}`,
    )
    await sleep(25_000)
    const still = await menuSays(cdpA)
    check(
      still.kind === 'waiting-to-restart' &&
        !exited(appA) &&
        !/restarting to install/.test(appA.log()),
      `25 s later it still waits, and nothing was installed (${String(still.kind)})`,
    )
  }
  model.release()
  const forTheOther = await until(async () => {
    const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
    return state.kind === 'waiting-to-restart' &&
      state.stops.conversations.length === 0 &&
      state.stops.otherWorkspaces === 1
      ? state
      : null
  }, 120_000)
  summary.steps.refusalOtherWorkspace = forTheOther
  await screenshot(cdpA, join(results, '5-a-waits-for-the-other-workspace.png'))
  check(
    forTheOther !== null,
    `the turn ended, and the restart waits for the other workspace: ${JSON.stringify(forTheOther)}`,
  )
  await sleep(15_000)
  check(
    !exited(appA) && !/restarting to install/.test(appA.log()),
    'while the other workspace runs, nothing is installed',
  )
  cdpA.close()

  // ── 7 · the other workspace closes: the restart, the installer, and BroBot back by itself ─────
  await stopProcess(other.child.pid, 'the second workspace')
  const exitedA = await until(() => exited(appA), 120_000)
  summary.steps.restart = { exitCode: appA.child.exitCode, at: record.stamp() }
  check(
    Boolean(exitedA) && appA.child.exitCode === 0,
    `A shut down by itself, exit ${String(appA.child.exitCode)}`,
  )
  const order = theRestartsOrder(appA.log(), VERSION_B, namedFolder)
  summary.steps.restart.order = order
  for (const line of order.lines) say(`  A: ${line.trim()}`)
  check(
    order.problems.length === 0,
    `A chose to restart, shut down, and only then started the installer${order.problems.length ? `: ${order.problems.join('; ')}` : ''}`,
  )
  // ⛔ A's last data, read in the one moment it can be: A has left, and the installer has not yet
  // started B. Nothing of BroBot's runs from the installed folder before the read, or after it.
  const quiet = await until(() => runningFrom(installDir).length === 0, 20_000, 500)
  const lastOfA = quiet ? dataOf(dataFolder) : null
  const startedMeanwhile = runningFrom(installDir)
  must(
    lastOfA !== null && startedMeanwhile.length === 0,
    `A's last data was read after A left and before B started${startedMeanwhile.length ? `: ${JSON.stringify(startedMeanwhile)}` : ''}`,
  )
  keep('data-as-a-left-it.json', `${JSON.stringify(lastOfA.summary, null, 2)}\n`)
  const keptByA = compareData(baseline, lastOfA)
  check(
    keptByA.problems.length === 0,
    `A's second run changed nothing it had made before${keptByA.problems.length ? `: ${keptByA.problems.join('; ')}` : ''}`,
  )
  // ⚑ Counted only once the installer has written the new version: a BroBot found before that
  // would not be the one the update started.
  const relaunched = await until(
    () =>
      appsEntries()[0]?.DisplayVersion === VERSION_B
        ? cameBack(broBotProcesses(), namedFolder)
        : null,
    300_000,
    2_000,
  )
  summary.steps.relaunch = relaunched
  must(
    relaunched !== null,
    `BroCrew started again by itself, after the install, on ${namedFolder ?? 'the default workspace'}: ${JSON.stringify(relaunched)}`,
  )
  check(
    relaunched.testSwitches === false,
    'the relaunch carries no hidden-launch switch and no debugging port',
  )
  check(
    relaunched.exact === true,
    `the relaunch was given exactly its way back's arguments: ${JSON.stringify(relaunched.args)}`,
  )
  const shownAt = await until(
    () =>
      Number(
        powershell(
          `(Get-Process -Id ${String(relaunched.ProcessId)} -ErrorAction SilentlyContinue).MainWindowHandle`,
        ).trim() || 0,
      ) !== 0
        ? new Date().toISOString()
        : null,
    90_000,
    2_000,
  )
  check(Boolean(shownAt), 'its window is there for the person')
  // ⚑ B's first start is the installer's own: no test can attach to its window. A picture of the
  // screen is kept as evidence of what it showed; it is looked at, and asserts nothing.
  await sleep(3_000)
  try {
    pictureOfTheScreen(join(results, '5b-b-first-start-screen.png'))
    summary.steps.relaunch.screen = '5b-b-first-start-screen.png'
  } catch (error) {
    summary.steps.relaunch.screen = `no picture: ${error.message}`
    say(`(no picture of the screen at B's first start: ${error.message})`)
  }
  check(
    !/asked Electron to exit \d+ms ago and is still running/.test(appA.log()),
    'the last-resort closer stood down when A left',
  )
  const after = appsEntries()
  summary.steps.after = { entries: after }
  check(
    after.length === 1 && after[0]?.DisplayVersion === VERSION_B,
    `one Apps entry, at ${String(after[0]?.DisplayVersion)}`,
  )
  check(
    installFolderOf(after[0]) === installDir && after[0]?.Hive === before[0].Hive,
    'in the same folder, for the same user',
  )
  check(
    String(relaunched.ExecutablePath).toLowerCase() === installedExe.toLowerCase(),
    'it runs from the installed folder',
  )
  await sleep(10_000)
  must(
    await stopProcess(relaunched.ProcessId, 'B, as the installer started it'),
    'B closed as a person closes it',
  )

  // ── 8 · the data, read with B closed: everything A made, and B's copy made before it changed any
  const afterData = dataOf(dataFolder)
  keep('data-after.json', `${JSON.stringify(afterData.summary, null, 2)}\n`)
  const compared = compareData(baseline, afterData)
  summary.steps.data = compared.summary
  check(
    compared.problems.length === 0,
    `every row, native transcript byte and state file A made is unchanged${compared.problems.length ? `: ${compared.problems.join('; ')}` : ''}`,
  )
  const copies = checkpointsIn(dataFolder)
  summary.steps.checkpoints = copies.map((one) => ({ ...one, dir: undefined }))
  const ofB = copies.filter((one) => one.madeBy === VERSION_B)
  must(
    ofB.length === 1 && ofB[0].reason === 'first-start-of-release',
    `B made one recovery copy, on its first start: ${JSON.stringify(summary.steps.checkpoints)}`,
  )
  const verified = verifyCheckpoint(ofB[0])
  summary.steps.checkpointVerified = verified
  check(
    verified.problems.length === 0,
    `B's copy holds every file its manifest names, each as it says${verified.problems.length ? `: ${verified.problems.join('; ')}` : ''}`,
  )
  const copyDiffers = copyHoldsTheData(ofB[0], lastOfA)
  check(
    copyDiffers.length === 0,
    `B's copy holds exactly the rows and state files A left${copyDiffers.length ? `: ${copyDiffers.join('; ')}` : ''}`,
  )
  const changedByB = sameData(lastOfA, afterData)
  check(
    changedByB.length === 0,
    `B's first run changed nothing A left: no row, transcript byte or state file${changedByB.length ? `: ${changedByB.join('; ')}` : ''}`,
  )
  const packagedB = packageOfAsar(join(installDir, 'resources', 'app.asar'))
  check(
    packagedB.version === VERSION_B && packagedB.rehearsalMarker === values['marker-b'],
    `the installed app is B as this commit built it (${String(packagedB.version)}, ${String(packagedB.rehearsalMarker)})`,
  )
  summary.steps.copyTimes = {
    madeAt: ofB[0].createdAt,
    bStartedAt: relaunched.Created,
    windowSeenBy: shownAt,
  }
  check(
    Date.parse(relaunched.Created) <= Date.parse(ofB[0].createdAt) &&
      Date.parse(ofB[0].createdAt) <= Date.parse(shownAt),
    `B's copy was made after B started and before its window was seen: ${JSON.stringify(summary.steps.copyTimes)}`,
  )

  // ── 9 · B again: no new copy; A's conversations, the draft, nothing asked; a conversation goes on
  const appB = launch(
    installedExe,
    ['--remote-debugging-port=9341', ...onTheWorkspace],
    'b-second.log',
  )
  const cdpB = await attach(9341)
  const snapshotB = await cdpB.evaluate('return await window.api.updates.read()')
  summary.steps.b = {
    version: snapshotB.version,
    checkAutomatically: snapshotB.checkAutomatically,
    channel: snapshotB.channel,
  }
  check(snapshotB.version === VERSION_B, `the running app says it is ${String(snapshotB.version)}`)
  const builtB = await cdpB.evaluate('return await window.api.getAppInfo()')
  check(
    builtB?.build?.commit === values['source-sha'],
    `B says it was built from this commit (${String(builtB?.build?.commit)})`,
  )
  check(
    snapshotB.channel === 'stable' && snapshotB.checkAutomatically === (namedFolder === null),
    `the person's update settings are kept: ${JSON.stringify(summary.steps.b)}`,
  )
  const shows = await whatBShows(cdpB, made, rowsBefore)
  check(
    shows.length === 0,
    `B shows A's conversations and the draft, and asks nothing${shows.length ? `: ${shows.join('; ')}` : ''}`,
  )
  await openTheUpdatesMenu(cdpB)
  await press(cdpB, '[data-cy="updates-check"]')
  const ownCheck = await until(async () => {
    const said = await menuSays(cdpB)
    return said.kind === 'idle' || said.kind === 'error' || said.kind === 'available' ? said : null
  }, 120_000)
  summary.steps.bOffersNothing = ownCheck
  await screenshot(cdpB, join(results, '6-b.png'))
  check(
    ownCheck?.kind === 'idle' && /^Up to date/.test(ownCheck.said ?? ''),
    `B's Check for updates finds nothing newer: ${JSON.stringify(ownCheck)}`,
  )
  const goneOn = await goesOn(cdpB, made.conversations[0])
  summary.steps.goesOn = goneOn
  check(
    goneOn.answered,
    `a conversation A made goes on in B, answered in ${String(goneOn.seconds)} s`,
  )
  cdpB.close()
  must(await stopProcess(appB.child.pid, 'B'), 'B closed as a person closes it')
  const secondStart = firstStartProblems(appB.log(), { expectCopy: false })
  summary.steps.secondStart = secondStart
  check(
    secondStart.problems.length === 0,
    `B's second start made no new copy, and nothing failed${secondStart.problems.length ? `: ${secondStart.problems.join('; ')}` : ''}`,
  )
  check(
    checkpointsIn(dataFolder).filter((one) => one.madeBy === VERSION_B).length === 1,
    'still one recovery copy of B',
  )
  const onwards = compareData(afterData, dataOf(dataFolder), { goneOn: [made.conversations[0]] })
  check(
    onwards.problems.length === 0,
    `going on only added to that conversation${onwards.problems.length ? `: ${onwards.problems.join('; ')}` : ''}`,
  )
  // ⛔ Another workspace's update leaves the default one alone: no launch of this run made it.
  if (namedFolder !== null)
    check(!existsSync(defaultFolder), `the default workspace was never touched (${defaultFolder})`)
  exitCode = failures.length === 0 ? 0 : 1
} catch (error) {
  fail(`the run stopped: ${error.stack ?? error.message}`)
} finally {
  // ⛔ Everything this run started, or that the update started, ends with it.
  for (const child of launched) {
    if (child.exitCode === null)
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  try {
    for (const row of mainProcesses(broBotProcesses())) {
      spawnSync('taskkill', ['/PID', String(row.ProcessId), '/T', '/F'], { windowsHide: true })
    }
  } catch (error) {
    say(`(could not list BroCrew's processes to end them: ${error.message})`)
  }
  model?.close()
  localFeed?.close()
  summary.failures = failures
  summary.minutes = record.minutes()
  keep('summary.json', `${JSON.stringify(summary, null, 2)}\n`)
  if (localFeed !== null) keep('feed.log', `${localFeed.log.join('\n')}\n`)
  if (model !== null) keep('model.log', `${model.log.join('\n')}\n`)
  say(failures.length === 0 ? 'every check held' : `${String(failures.length)} check(s) failed`)
  keep('harness.log', `${record.lines.join('\n')}\n`)
}
process.exit(exitCode)
