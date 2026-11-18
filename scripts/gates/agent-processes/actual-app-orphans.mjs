#!/usr/bin/env node
// Default is a file-free preview; actual app checks run only in the hosted Mac lane.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[2] !== '--execute' || !process.argv[3]) {
  console.log(
    JSON.stringify(
      {
        status: 'UNRUN',
        usage: 'node actual-app-orphans.mjs --execute /absolute/reviewed-manifest.json',
        cases: ['worker-end', 'normal-native-quit'],
        launches: 2,
        maximumWorkMs: 420000,
        cleanupBudgetMs: 45000,
        requires: 'reviewed source and admission through the existing hosted Mac lane',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}
const m = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'))
function must(value, why) {
  if (!value) throw new Error(why)
}
must(
  process.platform === 'darwin' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_OS === 'macOS',
  'Only the admitted disposable hosted Mac lane may execute',
)
must(
  m.reviewedBy && m.admission && m.source && m.app && m.claude && m.evidence,
  'Manifest is incomplete',
)
must(
  Number.isSafeInteger(m.modelPort) &&
    m.modelPort > 1024 &&
    m.modelPort < 65536 &&
    m.modelPort !== 9444,
  'Reviewed fixture loopback port required',
)
for (const name of ['sourceSha', 'sourceTree'])
  must(/^[a-f0-9]{40}$/.test(m[name]), `Exact ${name} required`)
for (const name of ['claudeSha256', 'asarSha256', 'executableSha256', 'plistSha256'])
  must(/^[a-f0-9]{64}$/.test(m[name]), `Exact ${name} required`)
must(
  process.version === m.nodeVersion && /^v24\./.test(process.version),
  'Use the reviewed exact Node 24 version',
)
const source = realpathSync(m.source),
  app = realpathSync(m.app),
  cli = realpathSync(m.claude)
const evidence = resolve(m.evidence)
must(!existsSync(evidence), 'Evidence must be a new folder')
mkdirSync(evidence, { recursive: true })
const work = realpathSync(mkdtempSync(join(tmpdir(), 'orph-')))
const receipt = {
  status: 'RUNNING',
  manifest: m,
  work,
  startedAt: new Date().toISOString(),
  hosted: {
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    job: process.env.GITHUB_JOB,
    jobId: m.hostedJobId ?? null,
    jobUrl: m.hostedJobUrl ?? null,
    workflow: process.env.GITHUB_WORKFLOW,
    runner: process.env.RUNNER_NAME,
    arch: process.arch,
  },
  cases: [],
  cleanup: [],
  failures: [],
}
const save = () =>
  writeFileSync(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
const event = (kind, data) =>
  appendFileSync(
    join(evidence, 'events.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n',
  )
const resources = [],
  tails = new Map(),
  liveChildren = [],
  sockets = new Set()
let model, cleaning, deadline, finishing
let ending = false
function runOpen() {
  must(!ending, 'Work stopped; cleanup has begun')
}
function command(program, args, { allowMissing = false, timeout = 5000, env } = {}) {
  const r = spawnSync(program, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env })
  event('command', {
    program,
    args,
    status: r.status,
    signal: r.signal,
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.error?.message,
  })
  if (
    allowMissing &&
    r.status === 1 &&
    !r.error &&
    r.stdout.trim() === '' &&
    r.stderr.trim() === ''
  )
    return null
  must(r.status === 0 && !r.error, `${program} failed: ${r.error?.message ?? r.stderr}`)
  return r.stdout.trim()
}
const git = (...args) => command('/usr/bin/git', ['-C', source, ...args])
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(read, ms, why, duringCleanup = false) {
  const end = performance.now() + ms
  do {
    if (!duringCleanup) runOpen()
    const value = await read()
    if (value) return value
    await sleep(100)
  } while (performance.now() < end)
  throw new Error(`Deadline ${ms}ms: ${why}`)
}
function identity(pid) {
  const row = command(
    '/bin/ps',
    [
      '-ww',
      '-p',
      String(pid),
      '-o',
      'pid=',
      '-o',
      'ppid=',
      '-o',
      'pgid=',
      '-o',
      'state=',
      '-o',
      'lstart=',
    ],
    { allowMissing: true },
  )
  if (row === null) return null
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(row)
  must(match, `Cannot parse pid ${pid}`)
  const executable = command('/bin/ps', ['-ww', '-p', String(pid), '-o', 'comm='], {
    allowMissing: true,
  })
  const cmd = command('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], {
    allowMissing: true,
  })
  if (executable === null || cmd === null) return null
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    pgid: Number(match[3]),
    state: match[4],
    start: match[5],
    executable,
    command: cmd,
  }
}
function cwd(pid) {
  const out = command('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  const paths = out
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1))
  must(paths.length === 1, `No unique cwd for ${pid}`)
  return realpathSync(paths[0])
}
function current(saved) {
  const now = identity(saved.pid)
  if (!now || now.start !== saved.start) return null
  return now
}
function signalSaved(saved, signal) {
  const now = current(saved)
  if (!now) return
  must(
    now.command === saved.command && now.executable === saved.executable,
    `Changed command ${saved.pid}; cleanup refused`,
  )
  process.kill(saved.pid, signal)
  event('harness-cleanup-signal', { pid: saved.pid, signal, current: now })
}
function listener(port) {
  const out = command('/usr/sbin/lsof', ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-FpPn'], {
    allowMissing: true,
  })
  if (out === null) return []
  const addresses = out.split('\n').filter((line) => line.startsWith('n'))
  must(
    addresses.length > 0 && addresses.every((line) => line === `n127.0.0.1:${port}`),
    'Debug listener is not exclusively IPv4 loopback',
  )
  return [
    ...new Set(
      out
        .split('\n')
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1))),
    ),
  ]
}
async function freePort() {
  const s = createNetServer()
  await new Promise((done, fail) => {
    s.once('error', fail)
    s.listen(0, '127.0.0.1', done)
  })
  const port = s.address().port
  await new Promise((done, fail) => s.close((e) => (e ? fail(e) : done())))
  return port
}
async function json(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })
  must(r.ok, `CDP HTTP ${r.status}`)
  return r.json()
}
function appInfo(...args) {
  const out = command('/usr/bin/lsappinfo', args)
  must(
    !/(?:Un-?recognized (?:option|command)|\busage:)/i.test(out),
    'Native query rejected its arguments',
  )
  return out
}
function nativeRecord(r, previous) {
  const raw = appInfo('find', `pid=${r.launchPid}`)
  const asns = (text) =>
    (text.match(/ASN:0x[0-9a-f]+[-:]0x[0-9a-f]+:?/gi) ?? []).map((asn) =>
      asn
        .toLowerCase()
        .replace(/:$/, '')
        .replace(/(0x[0-9a-f]+):(?=0x)/, '$1-'),
    )
  if (previous) {
    const active = raw
    const list = appInfo('list')
    must(raw === '' || asns(raw).length > 0, 'Unknown native PID lookup result')
    must(active === '' || asns(active).length > 0, 'Unknown active native PID lookup result')
    const sameRecord = previous.asn && [...asns(active), ...asns(list)].includes(previous.asn)
    let exitedInfo
    if (!sameRecord && previous.asn) {
      exitedInfo = appInfo('info', previous.specifier)
      const nullRecord =
        exitedInfo.replace(/\s+/g, ' ').trim() ===
        '[ NULL ] [ NULL ] bundleID=[ NULL ] bundle path=[ NULL ] executable path=[ NULL ] pid = !cgsConnection !signalled type=[ NULL ] flavor=[ NULL ] Version=[ NULL ] Arch=!!none'
      if (nullRecord) {
        const pids = new Set(
          [
            r.main,
            ...r.appIdentities,
            ...r.cliIdentities,
            ...r.commandAncestors,
            ...[r.target, r.peerTurn, r.sharedTarget, r.sharedPeer].flatMap((t) =>
              t ? [t.cli, t.tail] : [],
            ),
          ].map((p) => p.pid),
        )
        const processes = command('/bin/ps', ['-axo', 'pid=,ppid='])
        for (const row of processes.split('\n')) {
          const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(row)
          must(match, 'Cannot parse native tombstone child-process snapshot')
          must(!pids.has(Number(match[2])), 'Native tombstone still has a child process')
        }
        r.tombstoneProcesses = []
        for (const pid of pids) {
          must(identity(pid) === null, `Native tombstone pid ${pid} still exists`)
          let absent = false
          try {
            process.kill(pid, 0)
          } catch (error) {
            must(error.code === 'ESRCH', `Native tombstone pid ${pid} absence is unknown`)
            absent = true
          }
          must(absent, `Native tombstone pid ${pid} is still reachable`)
          r.tombstoneProcesses.push({ pid, ps: null, kill0: 'ESRCH' })
        }
      }
      must(
        exitedInfo === '' ||
          exitedInfo === 'NULL' ||
          nullRecord ||
          (/\bexited\b/i.test(exitedInfo) && !/exited-with-subordinates/i.test(exitedInfo)),
        'Retained native record is not conclusively exited',
      )
    }
    return { raw, active, list, exitedInfo, asn: previous.asn, present: Boolean(sameRecord) }
  }
  if (raw === '') return { raw, present: false }
  const found = asns(raw)
  must(found.length === 1, 'No unique native app record for the owned PID')
  const specifier = raw.match(/ASN:0x[0-9a-f]+[-:]0x[0-9a-f]+:?/i)[0]
  const details = appInfo('info', specifier)
  must(
    new RegExp(`\\b${r.launchPid}\\b`).test(details) &&
      details.includes(r.bundleId) &&
      details.includes(app) &&
      details.includes(r.executable),
    'Native record does not bind the owned PID, bundle and executable',
  )
  return { raw, details, asn: found[0], specifier, present: true }
}
async function requestQuit(r) {
  must(current(r.main), 'Owned app is gone before Quit')
  const answer = command(
    '/usr/bin/swift',
    [join(here, 'native-quit.swift'), String(r.main.pid), r.executable],
    { timeout: 30000 },
  )
  r.nativeQuit = JSON.parse(answer)
  must(r.nativeQuit.quitRequestAccepted === true, 'Native Quit was not accepted')
}
function dbReceipt(r, final) {
  const file = join(r.userData, 'brobot2.sqlite')
  const wal = statSync(file + '-wal', { throwIfNoEntry: false })?.size ?? 0
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const quick = db.prepare('PRAGMA quick_check').all()
    const foreign = db.prepare('PRAGMA foreign_key_check').all()
    const sessions = db
      .prepare(
        'SELECT id, provider, cwd, status, closed_by_the_quit_at FROM provider_session ORDER BY id',
      )
      .all()
    const turns = db
      .prepare('SELECT id, session_id, closed_at, end_reason FROM turn ORDER BY rowid')
      .all()
    const result = { final, walBytesBeforeRead: wal, quick, foreign, sessions, turns }
    event('database', { case: r.name, ...result })
    must(
      quick.length === 1 && Object.values(quick[0])[0] === 'ok' && foreign.length === 0,
      'Database consistency failed',
    )
    if (final) {
      must(wal === 0, 'Nonempty WAL after shutdown')
      must(
        sessions.length > 0 && sessions.every((one) => one.status === 'ended'),
        'Sessions did not settle ended',
      )
      must(
        turns.length > 0 &&
          turns.every(
            (one) => one.closed_at != null && ['completed', 'ended'].includes(one.end_reason),
          ),
        'A turn remained open or ended unknown/failed',
      )
      must(
        sessions.find((one) => one.id === r.target.sessionId)?.cwd ===
          (r.name === 'worker-end' ? r.worker : r.shared),
        'Target session cwd was not durably preserved',
      )
      if (r.name === 'normal-native-quit')
        must(
          sessions.find((one) => one.id === r.target.sessionId)?.closed_by_the_quit_at != null,
          'App Quit did not record its open session',
        )
    } else
      must(
        sessions.find((one) => one.id === r.target.sessionId)?.status === 'ended',
        'Closed worker is not durably ended',
      )
    return result
  } finally {
    db.close()
  }
}
function peerSurvives(p, why) {
  const now = current(p)
  event('negative-control', { why, saved: p, current: now, cwd: now ? cwd(now.pid) : null })
  must(
    now && now.command === p.command && now.executable === p.executable,
    `Negative control died: ${why}`,
  )
}
async function cleanup() {
  if (cleaning) return cleaning
  cleaning = (async () => {
    for (const r of resources) {
      try {
        if (!r.main) {
          receipt.cleanup.push({
            case: r.name,
            launchPid: r.launchPid,
            identity: 'UNKNOWN; operator accounting required',
          })
          continue
        }
        if (r.main && current(r.main)) {
          await requestQuit(r)
          await until(() => !current(r.main), 5000, 'cleanup normal Quit', true)
        }
      } catch (e) {
        receipt.cleanup.push({ case: r.name, normalQuitError: String(e) })
      }
    }
    // Emergency cleanup is not an acceptance oracle. Only identities retained for this run.
    const owned = [
      ...tails.values(),
      ...liveChildren,
      ...resources.flatMap((r) => [
        r.main,
        ...(r.cliIdentities ?? []),
        ...(r.commandAncestors ?? []),
        ...(r.appIdentities ?? []),
      ]),
    ].filter(Boolean)
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      for (const p of owned) {
        try {
          signalSaved(p, sig)
        } catch (e) {
          receipt.cleanup.push({ pid: p.pid, error: String(e) })
        }
      }
      await sleep(2000)
    }
    for (const p of owned) {
      try {
        const remaining = current(p)
        receipt.cleanup.push({ pid: p.pid, remaining })
        if (remaining) receipt.failures.push(`Cleanup incomplete pid ${p.pid}`)
      } catch (e) {
        receipt.failures.push(`Cleanup unknown pid ${p.pid}: ${String(e)}`)
      }
    }
    for (const r of resources) {
      r.cdp?.close()
      r.browser?.close()
    }
    for (const s of sockets) s.destroy()
    if (model) await new Promise((done) => model.close(done))
    receipt.finishedAt = new Date().toISOString()
    receipt.status = receipt.failures.length
      ? 'FAIL'
      : receipt.cases.every((one) => one.nativeBefore?.present)
        ? 'PASS_PROCESS_DB_NATIVE'
        : 'PASS_PROCESS_DB_NATIVE_UNEXERCISED'
    save()
  })()
  return cleaning
}
async function finish(error) {
  if (finishing) return finishing
  ending = true
  if (error) receipt.failures.push(String(error.stack ?? error))
  finishing = (async () => {
    clearTimeout(deadline)
    save()
    const forced = setTimeout(() => {
      receipt.failures.push('Cleanup exceeded 45000ms; retained work requires operator inspection')
      receipt.status = 'CLEANUP_INCOMPLETE'
      save()
      process.exit(1)
    }, 45000)
    try {
      await cleanup()
    } finally {
      clearTimeout(forced)
    }
    process.exit(receipt.failures.length ? 1 : 0)
  })()
  return finishing
}
process.once('SIGTERM', () => {
  void finish(new Error('Harness received SIGTERM'))
})
process.once('SIGINT', () => {
  void finish(new Error('Harness received SIGINT'))
})
deadline = setTimeout(() => {
  void finish(new Error('420000ms total work deadline'))
}, 420000)
try {
  receipt.preparedFiles = Object.fromEntries(
    ['actual-app-orphans.mjs', 'native-quit.swift'].map((file) => [file, sha(join(here, file))]),
  )
  must(
    git('rev-parse', 'HEAD') === m.sourceSha && git('rev-parse', 'HEAD^{tree}') === m.sourceTree,
    'Source pin mismatch',
  )
  must(git('status', '--porcelain=v1') === '', 'Source must be clean, including untracked files')
  const plist = join(app, 'Contents/Info.plist'),
    asar = join(app, 'Contents/Resources/app.asar')
  const executableName = command('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    plist,
  ])
  const executable = realpathSync(join(app, 'Contents/MacOS', executableName))
  const bundleId = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  for (const [file, expected] of [
    [cli, m.claudeSha256],
    [asar, m.asarSha256],
    [executable, m.executableSha256],
    [plist, m.plistSha256],
  ])
    must(sha(file) === expected, `Artifact bytes differ: ${file}`)
  must(
    command(cli, ['--version'], { env: { PATH: '/usr/bin:/bin', HOME: work } }).startsWith(
      '2.1.287 ',
    ),
    'The real Claude CLI must be 2.1.287',
  )
  const helper = (file) => import(pathToFileURL(join(source, 'scripts/lib', file)).href)
  const { connectDevTools } = await helper('update-rehearsal-app.mjs')
  const {
    CLAUDE_FIXTURE_KEY,
    CLAUDE_CODE_VERSION,
    MANAGED_SETTINGS_PATH,
    managedSettingsFor,
    anthropicEvents,
    sseOf,
    toolResultsIn,
    userTextsIn,
    offersTool,
    claudeKeySeen,
  } = await helper('scripted-claude.mjs')
  must(CLAUDE_CODE_VERSION === '2.1.287', 'Fixture version changed; review before changing pin')
  const turns = new Map()
  const managed = JSON.parse(readFileSync(MANAGED_SETTINGS_PATH.mac, 'utf8'))
  must(
    JSON.stringify(managed) === JSON.stringify(managedSettingsFor(m.modelPort)),
    'Managed settings must contain ONLY this run fixture route',
  )
  model = createServer((request, response) => {
    const chunks = []
    request.on('data', (part) => chunks.push(part))
    request.on('end', () => {
      const path = request.url?.split('?')[0]
      if (path !== '/v1/messages' && path !== '/v1/messages/count_tokens') {
        event('model-ancillary', { method: request.method, url: request.url, status: 404 })
        response.writeHead(404).end()
        return
      }
      try {
        runOpen()
        must(
          claudeKeySeen(request.headers) === 'expected',
          'Model received a non-fixture credential',
        )
        if (path === '/v1/messages/count_tokens') {
          response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":11}')
          return
        }
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const found = [...turns.values()].filter((t) =>
          userTextsIn(body).some((text) => text.includes(t.marker)),
        )
        const t = found.length === 1 ? found[0] : null
        let reply = { kind: 'text', text: 'Fictional ancillary answer.' }
        if (t) {
          must(offersTool(body, 'Bash'), 'The real app did not offer Bash')
          reply = toolResultsIn(body).has(t.id)
            ? { kind: 'text', text: t.answer }
            : {
                kind: 'tool_use',
                id: t.id,
                name: 'Bash',
                input: {
                  command: t.command,
                  timeout: 20000,
                  description: 'Fictional orphan cleanup fixture',
                },
              }
          if (reply.kind === 'text') t.resultSeen = true
        }
        event('model', {
          method: request.method,
          url: request.url,
          auth: 'expected',
          marker: t?.marker,
          model: body.model,
          offered: (body.tools ?? []).map((one) => one.name),
          answered: [...toolResultsIn(body)],
          reply,
        })
        response
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(
            sseOf(
              anthropicEvents(body.model, reply, `msg_orphan_${randomUUID().replaceAll('-', '')}`),
            ),
          )
      } catch (e) {
        event('model-error', { error: String(e) })
        receipt.failures.push(String(e))
        response.writeHead(500).end()
      }
    })
  })
  model.on('connection', (s) => {
    sockets.add(s)
    s.once('close', () => sockets.delete(s))
  })
  model.requestTimeout = 10000
  await new Promise((done, fail) => {
    model.once('error', fail)
    model.listen(m.modelPort, '127.0.0.1', done)
  })
  for (const name of ['worker-end', 'normal-native-quit']) {
    runOpen()
    const root = join(work, name),
      home = join(root, 'home'),
      userData = join(root, 'data')
    const worker = join(userData, 'worker-output', `work_${randomUUID()}`)
    const peer = join(userData, 'worker-output', `work_${randomUUID()}`)
    const shared = join(userData, 'brobot-workspace'),
      other = join(root, 'other-workspace')
    for (const p of [home, userData, worker, peer, shared, other, join(root, 'tmp')])
      mkdirSync(p, { recursive: true })
    const env = {
      HOME: home,
      TMPDIR: join(root, 'tmp'),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      BROCREW_SKIP_UPDATE_CHECK: '1',
    }
    const port = await freePort()
    must(port !== 9444 && listener(port).length === 0, 'Debug port must be free and never 9444')
    const fd = openSync(join(evidence, `${name}.stdio.log`), 'wx')
    runOpen()
    const child = spawn(
      executable,
      [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userData}`,
        '--brobot-hidden',
        `--brobot-claude-code=${cli}`,
      ],
      { cwd: root, env, stdio: ['ignore', fd, fd] },
    )
    closeSync(fd)
    const r = {
      name,
      home,
      userData,
      worker,
      peer,
      shared,
      other,
      port,
      executable,
      bundleId,
      launchPid: child.pid,
      cliIdentities: [],
      commandAncestors: [],
      appIdentities: [],
      main: null,
    }
    resources.push(r)
    receipt.cases.push(r)
    save()
    child.on('error', (e) => {
      receipt.failures.push(String(e))
      save()
    })
    child.on('exit', (code, signal) => {
      r.exit = { code, signal, at: new Date().toISOString() }
      save()
    })
    must(Number.isSafeInteger(child.pid), 'App spawn did not provide a pid')
    r.main = identity(child.pid)
    must(r.main, 'No owned main process identity')
    must(
      realpathIfExists(r.main.executable) === executable && r.main.command.startsWith(executable),
      'Main process is not the selected packaged executable',
    )
    await until(
      () => {
        const p = listener(port)
        return p.length === 1 && p[0] === child.pid
      },
      60000,
      'owned CDP listener',
    )
    const version = await json(port, '/json/version')
    const browser = await connectDevTools(version.webSocketDebuggerUrl, { answerWithin: 10000 })
    r.browser = browser
    const processInfo = await browser.send('SystemInfo.getProcessInfo')
    must(
      processInfo.processInfo.find((p) => p.type === 'browser')?.id === child.pid,
      'CDP browser PID differs',
    )
    r.appIdentities = processInfo.processInfo.map((p) => identity(p.id)).filter(Boolean)
    const page = await until(
      async () => {
        try {
          return (await json(port, '/json/list')).find(
            (p) => p.type === 'page' && p.url.endsWith('/index.html'),
          )
        } catch {
          return null
        }
      },
      30000,
      'app renderer',
    )
    const cdp = await connectDevTools(page.webSocketDebuggerUrl, { answerWithin: 10000 })
    r.cdp = cdp
    await until(
      () => cdp.evaluate('return Boolean(window.api?.runtime && window.api?.getAppInfo)'),
      30000,
      'runtime bridge',
    )
    r.appInfo = await cdp.evaluate('return await window.api.getAppInfo()')
    must(realpathSync(r.appInfo.workspace.path) === userData, 'Actual app opened another workspace')
    must(
      r.appInfo.build.commit === m.sourceSha && r.appInfo.build.dirty === false,
      'App build does not bind the clean source pin',
    )
    r.nativeBefore = nativeRecord(r)
    const key = await cdp.evaluate(
      `return await window.api.runtime.setApiKey({provider:'claude',key:${JSON.stringify(CLAUDE_FIXTURE_KEY)}})`,
    )
    must(
      key?.set === true && !key?.refused,
      'Fictional API key was not saved; no keychain recovery fallback',
    )
    async function turn(label, sessionCwd, tailCwd) {
      const t = {
        marker: `fixture_${randomUUID()}`,
        id: `toolu_${randomUUID().replaceAll('-', '')}`,
        answer: `done_${randomUUID()}`,
        folder: tailCwd,
        pidFile: join(tailCwd, `${label}.pid`),
        release: join(tailCwd, `${label}.release`),
      }
      t.command = `cd '${tailCwd}' || exit 1; /usr/bin/tail -f /dev/null >/dev/null 2>&1 & echo $! > '${t.pidFile}'; while [ ! -f '${t.release}' ]; do /bin/sleep 0.1; done`
      runOpen()
      turns.set(t.marker, t)
      const created = await cdp.evaluate(
        `return await window.api.runtime.createSession(${JSON.stringify({ provider: 'claude', approvalMode: 'auto', cwd: sessionCwd, ...(m.model ? { model: m.model } : {}) })})`,
      )
      must(typeof created?.sessionId === 'string', 'No real Claude session created')
      t.sessionId = created.sessionId
      await cdp.evaluate(
        `await window.api.runtime.send(${JSON.stringify({ sessionId: t.sessionId, text: t.marker })}); return true`,
      )
      await until(() => existsSync(t.pidFile), 45000, 'real Claude Bash tail pid')
      const pid = Number(readFileSync(t.pidFile, 'utf8').trim())
      must(Number.isSafeInteger(pid) && pid > 1, 'Invalid fixture pid')
      t.tail = identity(pid)
      must(t.tail, 'Tail ended before identity capture')
      tails.set(pid, t.tail)
      t.cwd = cwd(pid)
      must(t.cwd === tailCwd, 'Tail cwd differs')
      t.ancestors = []
      let parent = identity(t.tail.ppid)
      for (let depth = 0; parent && depth < 12 && parent.pid !== child.pid; depth++) {
        t.ancestors.push(parent)
        r.commandAncestors.push(parent)
        // Text mappings identify the native binary even when Claude changes its process title.
        const mappings = command(
          '/usr/sbin/lsof',
          ['-a', '-p', String(parent.pid), '-d', 'txt', '-Fn'],
          { allowMissing: true },
        )
        const images = (mappings ?? '')
          .split('\n')
          .filter((line) => line.startsWith('n'))
          .map((line) => realpathIfExists(line.slice(1)))
        if (images.includes(cli)) {
          t.cli = parent
          t.cliTextMappings = images
          break
        }
        parent = identity(parent.ppid)
      }
      must(t.cli, 'Cannot prove the tail descended from the pinned real Claude CLI')
      r.cliIdentities.push(t.cli)
      event('tail-before-release', { case: name, label, ...t })
      writeFileSync(t.release, 'release\n', { flag: 'wx' })
      await until(() => t.resultSeen, 30000, 'Bash tool result reached loopback model')
      await until(
        () =>
          cdp.evaluate(
            `return JSON.stringify(await window.api.runtime.latestHistory({sessionId:${JSON.stringify(t.sessionId)}})).includes(${JSON.stringify(t.answer)})`,
          ),
        30000,
        'fictional turn completion in app ledger',
      )
      t.orphan = await until(
        () => {
          const p = current(t.tail)
          return p?.ppid === 1 ? p : null
        },
        5000,
        'tail reparented to pid 1',
      )
      must(t.orphan.pgid !== t.cli.pgid, 'Premise failed: tail did not escape Claude process group')
      event('orphan-premise', {
        case: name,
        label,
        tail: t.orphan,
        cli: current(t.cli),
        cwd: cwd(pid),
      })
      return t
    }
    r.target = await turn('target', name === 'worker-end' ? worker : shared, worker)
    if (name === 'worker-end') r.peerTurn = await turn('peer', peer, peer)
    runOpen()
    const live = spawn('/usr/bin/tail', ['-f', '/dev/null'], { cwd: worker, env, stdio: 'ignore' })
    live.on('error', (e) => {
      receipt.failures.push(String(e))
      save()
    })
    r.livePeer = identity(live.pid)
    must(r.livePeer?.ppid === process.pid, 'Live-parent negative control not established')
    liveChildren.push(r.livePeer)
    r.unrelated = []
    for (const [label, folder] of [
      ['shared', shared],
      ['other', other],
    ]) {
      runOpen()
      const pidFile = join(folder, `control-${label}.pid`)
      command(
        '/bin/sh',
        [
          '-c',
          `cd '${folder}' || exit 1; /usr/bin/tail -f /dev/null >/dev/null 2>&1 & echo $! > '${pidFile}'`,
        ],
        { env },
      )
      const p = identity(Number(readFileSync(pidFile, 'utf8').trim()))
      must(p, 'Unrelated control missing')
      tails.set(p.pid, p)
      await until(() => current(p)?.ppid === 1, 5000, 'unrelated control orphaned')
      must(cwd(p.pid) === folder, 'Unrelated control cwd differs')
      r.unrelated.push(p)
    }
    save()
    if (name === 'worker-end') {
      r.closeReply = await cdp.evaluate(
        `return await window.api.runtime.close({sessionId:${JSON.stringify(r.target.sessionId)}})`,
      )
      await until(
        () => !current(r.target.tail) && !current(r.target.cli),
        8000,
        'worker CLI and escaped tail gone',
      )
      r.afterWorker = { targetTail: current(r.target.tail), targetCli: current(r.target.cli) }
      peerSurvives(r.peerTurn.tail, 'different live worker tail')
      peerSurvives(r.peerTurn.cli, 'different live worker Claude')
      peerSurvives(r.livePeer, 'live-parent process in target cwd')
      for (const p of r.unrelated) peerSurvives(p, 'orphan outside worker-output')
      r.workerDatabase = dbReceipt(r, false)
      r.sharedTarget = await turn('shared-target', worker, worker)
      r.sharedPeer = await turn('shared-peer', worker, worker)
      await cdp.evaluate(
        `return await window.api.runtime.close({sessionId:${JSON.stringify(r.sharedTarget.sessionId)}})`,
      )
      await until(() => !current(r.sharedTarget.cli), 8000, 'shared-folder target CLI gone')
      peerSurvives(r.sharedTarget.tail, 'shared-folder target orphan deferred until Quit')
      peerSurvives(r.sharedPeer.tail, 'same-folder live session orphan survives target close')
      peerSurvives(r.sharedPeer.cli, 'same-folder live Claude survives target close')
    }
    r.quitAskedAt = new Date().toISOString()
    await requestQuit(r)
    await until(() => !current(r.main), 15000, 'ordinary native Quit main process exit')
    await until(
      () => !current(r.target.tail) && !current(r.target.cli),
      8000,
      'app Quit CLI and escaped tail gone',
    )
    if (r.peerTurn)
      await until(
        () => !current(r.peerTurn.tail) && !current(r.peerTurn.cli),
        8000,
        'app Quit peer worker also ended',
      )
    for (const shared of [r.sharedTarget, r.sharedPeer].filter(Boolean)) {
      await until(
        () => !current(shared.tail) && !current(shared.cli),
        8000,
        'deferred shared-folder commands gone after Quit',
      )
    }
    must(listener(port).length === 0, 'App listener survived Quit')
    const rebound = createNetServer()
    await new Promise((done, fail) => {
      rebound.once('error', fail)
      rebound.listen(port, '127.0.0.1', done)
    })
    await new Promise((done) => rebound.close(done))
    r.portRebound = true
    for (const p of r.appIdentities) must(!current(p), `App process ${p.pid} survived Quit`)
    peerSurvives(r.livePeer, 'live-parent process survives app orphan sweep')
    for (const p of r.unrelated)
      peerSurvives(p, 'orphan outside this workspace worker-output survives Quit')
    r.nativeAfter = await until(
      () => {
        const n = nativeRecord(r, r.nativeBefore)
        return n.present ? null : n
      },
      5000,
      'native application record absent',
    )
    await until(() => r.exit, 2000, 'owned child exit receipt')
    const logs = [join(evidence, `${name}.stdio.log`), join(userData, 'logs/brocrew.log')]
      .filter(existsSync)
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n')
    r.lastResortExit = logs.includes('everything of ours is closed, so it is being stopped now')
      ? 'APP_BOUND_STOPPED'
      : 'NOT_OBSERVED'
    must(r.exit.code === 0 && r.exit.signal === null, 'App exit was not clean')
    must(
      /BroCrew shut down in .*close its database .*end its commands /s.test(logs),
      'No ordered database/commands shutdown report',
    )
    must(
      logs.includes("Electron's will-quit") && logs.includes("Electron's quit"),
      'No normal Electron quit phases',
    )
    must(
      !/BroCrew failed to |database.*(?:closed|not open)|command cleanup failed|did not finish shutting down/i.test(
        logs,
      ),
      'Shutdown failure marker in retained logs',
    )
    r.orphanSweepRows = [...logs.matchAll(/Ending orphaned agent command:\s*(\{[\s\S]*?\})/g)].map(
      (one) => one[1],
    )
    must(
      r.orphanSweepRows.some(
        (row) =>
          new RegExp(`\\bpid['"]?\\s*:\\s*${r.target.tail.pid}\\b`).test(row) &&
          row.includes('SIGTERM'),
      ),
      'No app orphan-sweep TERM receipt for the actual-Claude tail',
    )
    r.finalDatabase = dbReceipt(r, true)
    r.oracle = 'PASS_PROCESS_DB'
    r.cdp = undefined
    r.browser = undefined
    cdp.close()
    browser.close()
    save()
  }
  must(
    receipt.cases.length === 2 && receipt.cases.every((one) => one.oracle === 'PASS_PROCESS_DB'),
    'Both case oracles must complete',
  )
  must(
    git('rev-parse', 'HEAD') === m.sourceSha && git('status', '--porcelain=v1') === '',
    'Source changed during run',
  )
  await finish()
} catch (error) {
  await finish(error)
}

function realpathIfExists(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
