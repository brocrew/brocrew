import { spawn, execFile } from 'node:child_process'
import { promisify, parseArgs, isDeepStrictEqual } from 'node:util'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, writeFile, readdir, lstat, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  assertHostedMac,
  assertOwnedProcess,
  dataPreserved,
  diskImageFrom,
  FEED_URL,
  hash,
  mountedImageOf,
  packageOfAsar,
  nativeTranscriptsPresent,
  recoveryOrder,
  registryPreserved,
  requireEvidence,
  statePreserved,
  startLocalModelTurn,
  READY_LINE,
  FAIL_LINE,
  STATE_FILES,
  VERSION_A,
  VERSION_B,
} from './lib/mac-update-test.mjs'
import { verifyCheckpoint } from './lib/mac-update-test.mjs'
import {
  appUpdateProblems,
  feedFromArgs,
  feedToken,
  servedUpdateFile,
} from './lib/update-rehearsal.mjs'
import {
  SCRIPTED_MODEL,
  closeExpectedLaunchSetup,
  codexConfigFor,
} from './lib/update-rehearsal-app.mjs'

// Installation, launches and process signals are confined to a fresh hosted runner.
assertHostedMac(process.env, process.platform, process.arch)
const { values } = parseArgs({
  options: {
    'dist-a': { type: 'string' },
    'dist-b': { type: 'string' },
    evidence: { type: 'string' },
    'feed-url': { type: 'string', default: FEED_URL },
    'serve-local': { type: 'boolean', default: false },
    'feed-github': { type: 'string' },
    'feed-private': { type: 'boolean', default: false },
    'marker-a': { type: 'string' },
    'marker-b': { type: 'string' },
    'source-sha': { type: 'string' },
  },
})
for (const name of ['dist-a', 'dist-b', 'evidence', 'marker-a', 'marker-b', 'source-sha'])
  requireEvidence(values[name], `Missing --${name}.`)
requireEvidence(values['marker-a'] !== values['marker-b'], 'Build markers must differ.')
requireEvidence(/^[a-f0-9]{40}$/.test(values['source-sha']), 'A frozen source SHA is required.')
const distA = resolve(values['dist-a']),
  distB = resolve(values['dist-b'])
const evidence = resolve(values.evidence),
  feedUrl = new URL(values['feed-url'])
// The feed the apps were built to read: the generic `--feed-url`, or `--feed-github OWNER/REPO`,
// read with this harness's GH_TOKEN when `--feed-private`.
const updateFeed = feedFromArgs(values)
const feedReadToken = feedToken(updateFeed, process.env)
if (values['serve-local'])
  requireEvidence(
    updateFeed.kind === 'generic' &&
      feedUrl.hostname === '127.0.0.1' &&
      feedUrl.pathname === '/' &&
      feedUrl.protocol === 'http:',
    'Local feed must bind to loopback.',
  )
const app = '/Applications/BroCrew.app',
  dataRoot = join(homedir(), 'Library', 'Application Support', '@brobot2')
const data = join(dataRoot, 'desktop')
const settings = join(dataRoot, 'settings.json')
const registry = join(dataRoot, 'workspaces.json')
const codexHome = join(data, 'provider-homes', 'default', 'brobot', 'codex')
const nativeRoot = join(codexHome, 'sessions')
const downloads = join(homedir(), 'Downloads')
const exec = promisify(execFile)
const summary = {
  runId: process.env.GITHUB_RUN_ID,
  source: values['source-sha'],
  feed: updateFeed,
  sameCode: true,
  scriptedCopyIsFinderDrag: false,
  assertions: [],
  launches: [],
  launchAttempts: [],
  quarantine: [],
}
let active = null,
  feed = null,
  model = null,
  mountedA = null
const channels = []
const exists = async (path) =>
  access(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
async function run(program, args, options = {}) {
  const result = await exec(program, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  return result.stdout
}
async function waitFor(check, description, budget = 180_000) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`Timed out: ${description}`)
}
function passed(name, facts = true) {
  summary.assertions.push({ name, passed: true, facts })
  console.log(`PASS ${name}`)
}
async function digest(path, algorithm = 'sha256', encoding = 'hex') {
  const sum = createHash(algorithm)
  for await (const chunk of createReadStream(path)) sum.update(chunk)
  return sum.digest(encoding)
}
async function plist(program, args) {
  const xml = await run(program, args)
  return await new Promise((done, failed) => {
    const child = spawn('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = '',
      error = ''
    child.stdout.on('data', (part) => {
      out += part
    })
    child.stderr.on('data', (part) => {
      error += part
    })
    child.once('error', failed)
    child.once('exit', (code) => {
      if (code !== 0) return failed(new Error(`plutil failed (${code}): ${error}`))
      try {
        done(JSON.parse(out))
      } catch (problem) {
        failed(problem)
      }
    })
    child.stdin.end(xml)
  })
}
async function quarantine(path, stage) {
  const attributes = await run('/usr/bin/xattr', ['-l', path])
  summary.quarantine.push({ stage, path, attributes, observedAt: new Date().toISOString() })
}
async function packageInfo(bundle) {
  return packageOfAsar(`${bundle}/Contents/Resources/app.asar`)
}
async function bundleChecked(bundle, version, marker) {
  requireEvidence(!(await lstat(bundle)).isSymbolicLink(), 'App bundle must not be a symlink.')
  const info = await packageInfo(bundle)
  requireEvidence(
    info.version === version && info.rehearsalMarker === marker,
    'Installed package version/marker differs.',
  )
  const id = (
    await run('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      `${bundle}/Contents/Info.plist`,
    ])
  ).trim()
  requireEvidence(id === 'com.brobot2.desktop', 'Wrong installed bundle identity.')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  return {
    version: info.version,
    marker: info.rehearsalMarker,
    bundleId: id,
    asarSha256: await digest(`${bundle}/Contents/Resources/app.asar`),
  }
}
async function processInfo(pid) {
  try {
    const command = (await run('/bin/ps', ['-p', String(pid), '-o', 'command='])).trim()
    const started = (await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='])).trim()
    return command && started ? { pid, command, started } : null
  } catch (error) {
    if (error.code === 1) return null
    throw error
  }
}
async function connect(url) {
  requireEvidence(new URL(url).hostname === '127.0.0.1', 'DevTools must remain on loopback.')
  const socket = new WebSocket(url),
    pending = new Map()
  await new Promise((done, failed) => {
    const timer = setTimeout(() => failed(new Error('DevTools connection timed out')), 30_000)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        done()
      },
      { once: true },
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        failed(new Error('DevTools connection failed'))
      },
      { once: true },
    )
  })
  let id = 0
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data),
      receipt = pending.get(message.id)
    if (receipt) {
      clearTimeout(receipt.timer)
      pending.delete(message.id)
      if (message.error) receipt.reject(new Error(message.error.message))
      else receipt.resolve(message.result)
    }
  })
  socket.addEventListener('close', () => {
    for (const receipt of pending.values()) {
      clearTimeout(receipt.timer)
      receipt.reject(new Error('DevTools closed'))
    }
    pending.clear()
  })
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = ++id
      const timer = setTimeout(() => {
        pending.delete(current)
        reject(new Error(`DevTools timed out: ${method}`))
      }, 60_000)
      pending.set(current, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: current, method, params }))
    })
  const evaluate = async (body) => {
    const result = await call('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    }).catch((error) => {
      throw new Error(`Renderer evaluation failed (${body.slice(0, 160)}): ${error.message}`, {
        cause: error,
      })
    })
    requireEvidence(
      !result.exceptionDetails,
      result.exceptionDetails?.exception?.description ?? 'Renderer evaluation failed.',
    )
    return result.result?.value
  }
  const result = { call, evaluate, close: () => socket.close() }
  channels.push(result)
  return result
}
async function launch(stage, port, version, marker) {
  const log = join(evidence, `${stage}.log`)
  await run('/usr/bin/open', [
    '-n',
    '--stdout',
    join(evidence, `${stage}.stdout.log`),
    '--stderr',
    log,
    // ⚑ LaunchServices gives the app none of this process's environment: a private feed's token
    // reaches the app here, and nowhere else.
    ...(feedReadToken === null ? [] : ['--env', `GH_TOKEN=${feedReadToken}`]),
    app,
    '--args',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
  ]).catch((error) => {
    // ⛔ A failed command is said with its arguments: never with the feed's token.
    const said = String(error.message)
    throw new Error(feedReadToken === null ? said : said.split(feedReadToken).join('<token>'))
  })
  const root = `http://127.0.0.1:${port}`
  const discovery = await waitFor(async () => {
    try {
      const response = await fetch(`${root}/json/version`, { signal: AbortSignal.timeout(1000) })
      return response.ok ? await response.json() : null
    } catch (error) {
      if (error instanceof TypeError || error.name === 'TimeoutError') return null
      throw error
    }
  }, `${stage} DevTools endpoint`)
  const browser = await connect(discovery.webSocketDebuggerUrl)
  const processes = await browser.call('SystemInfo.getProcessInfo')
  const pid = processes.processInfo.find((one) => one.type === 'browser')?.id
  requireEvidence(Number.isInteger(pid) && pid > 0, 'Browser PID evidence is missing.')
  const identity = await processInfo(pid)
  assertOwnedProcess(identity, identity, app, port)
  active = { ...identity, port, browser, log }
  const attempt = { stage, ...identity, port, log: basename(log), phase: 'cdp-binding' }
  summary.launchAttempts.push(attempt)
  const bound = await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  requireEvidence(
    bound.includes(`127.0.0.1:${port}`) && !bound.includes(`*:${port}`),
    'CDP is not bound exclusively to loopback.',
  )
  const page = await waitFor(async () => {
    const targets = await (await fetch(`${root}/json/list`)).json()
    return targets.find(
      (one) => one.type === 'page' && one.url.endsWith('/index.html') && one.webSocketDebuggerUrl,
    )
  }, `${stage} ordinary window`)
  const cdp = await connect(page.webSocketDebuggerUrl)
  attempt.page = { id: page.id, url: page.url }
  active.cdp = cdp
  active.stage = stage
  await cdp.call('Page.enable')
  await cdp.call('Runtime.enable')
  attempt.phase = 'ordinary-bridge'
  await waitFor(
    () => cdp.evaluate('return Boolean(window.api?.updates && window.api?.runtime)'),
    `${stage} ordinary bridge`,
  )
  attempt.phase = 'ready-line'
  await waitFor(async () => {
    const lines = (await readFile(log, 'utf8')).split(/\r?\n/)
    requireEvidence(!lines.includes(FAIL_LINE), 'App reported a failed start.')
    return lines.includes(READY_LINE)
  }, `${stage} READY line`)
  attempt.phase = 'app-info'
  const info = await cdp.evaluate('return await window.api.getAppInfo()')
  requireEvidence(
    info.version === version && info.build.commit === values['source-sha'],
    'Running version/source does not match the frozen build.',
  )
  requireEvidence(
    info.workspace.path === data && info.workspace.isDefault === true,
    'Running app uses a different data folder.',
  )
  attempt.phase = 'visible-window'
  await waitFor(
    () =>
      cdp.evaluate(
        'return document.visibilityState === "visible" && document.querySelector("[data-cy=rail-workspace]") !== null',
      ),
    `${stage} ordinary visible window after rendering`,
  )
  const targets = await (await fetch(`${root}/json/list`)).json()
  requireEvidence(
    !targets.some((one) => one.url.endsWith('/recovery.html')),
    'A recovery choice window remains open.',
  )
  requireEvidence(
    info.db.providerSessionCount === (stage === 'a' ? 0 : 2),
    'Unexpected data folder or conversation count.',
  )
  const packaged = await bundleChecked(app, version, marker)
  attempt.phase = 'verified'
  summary.launches.push({
    stage,
    ...identity,
    cdpBinding: bound.trim(),
    log: basename(log),
    appInfo: info,
    package: packaged,
  })
  await cdp.call('Page.enable')
  await screenshot(cdp, `${stage}-window.png`)
  return cdp
}
async function screenshot(cdp, name) {
  const result = await cdp.call('Page.captureScreenshot', { format: 'png' })
  requireEvidence(result.data, 'Screenshot evidence is missing.')
  await writeFile(join(evidence, name), Buffer.from(result.data, 'base64'))
}
// Press what `selector` names as a person does: the pointer goes to its middle, and the left button
// down and up there, so a button that is covered or disabled is not pressed.
async function click(cdp, selector) {
  const at = await waitFor(
    () =>
      cdp.evaluate(
        `const button = document.querySelector(${JSON.stringify(selector)}); if (!button || button.disabled) return null; button.scrollIntoView({ block: 'center' }); const box = button.getBoundingClientRect(); return box.width > 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null`,
      ),
    `visible enabled ${selector}`,
  )
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  for (const type of ['mousePressed', 'mouseReleased'])
    await cdp.call('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 })
}
async function openUpdates(cdp) {
  const opened = await cdp.evaluate(
    'return document.querySelector("[data-cy=rail-workspace]")?.getAttribute("aria-expanded") === "true"',
  )
  if (!opened) await click(cdp, '[data-cy=rail-workspace]')
  await waitFor(
    () =>
      cdp.evaluate(
        'return Boolean(document.querySelector("[data-cy=updates-menu]")?.getBoundingClientRect().width)',
      ),
    'ordinary updates menu is visible',
  )
}
async function quit() {
  if (active === null) return
  const child = active
  const current = await processInfo(child.pid)
  assertOwnedProcess(child, current, app, child.port)
  process.kill(child.pid, 'SIGTERM')
  await waitFor(
    async () => !(await processInfo(child.pid)),
    'verified test child graceful quit',
    60_000,
  )
  child.browser.close()
  active = null
  passed('verified-child-quit', { pid: child.pid, signal: 'SIGTERM' })
}
function databaseSnapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    requireEvidence(
      db.prepare('PRAGMA quick_check').get().quick_check === 'ok',
      'SQLite quick_check failed.',
    )
    requireEvidence(
      db.prepare('PRAGMA foreign_key_check').all().length === 0,
      'SQLite foreign-key check failed.',
    )
    db.exec('BEGIN')
    const snapshot = Object.fromEntries(
      ['provider_session', 'events'].map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ]),
    )
    snapshot.migrations = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
    db.exec('COMMIT')
    return snapshot
  } finally {
    db.close()
  }
}
async function stateBytes() {
  const result = {}
  for (const name of STATE_FILES)
    if (await exists(join(data, name))) result[name] = await readFile(join(data, name))
  return result
}
async function nativeFiles(folder) {
  const files = {}
  if (!(await exists(folder))) return files
  requireEvidence(!(await lstat(folder)).isSymbolicLink(), 'Native transcript folder is a symlink.')
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    requireEvidence(!entry.isSymbolicLink(), `Native transcript tree contains a symlink: ${path}`)
    if (entry.isDirectory()) Object.assign(files, await nativeFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const bytes = await readFile(path)
      files[path.slice(data.length + 1)] = {
        bytes: bytes.length,
        sha256: hash(bytes),
      }
    }
  }
  return files
}
async function checkpointIds() {
  const folder = join(data, 'backups')
  if (!(await exists(folder))) return []
  const found = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const path = join(folder, entry.name, 'manifest.json')
      requireEvidence(await exists(path), 'Unfinished or unmanifested recovery copy.')
      found.push(entry.name)
    }
  }
  return found.sort()
}
async function checkNativePrefixes(natives) {
  for (const [name, original] of Object.entries(natives)) {
    requireEvidence(original.bytes > 0, 'Native transcript baseline is empty.')
    const sum = createHash('sha256')
    for await (const chunk of createReadStream(join(data, name), {
      start: 0,
      end: original.bytes - 1,
    }))
      sum.update(chunk)
    requireEvidence(
      sum.digest('hex') === original.sha256,
      `Native transcript lost original bytes: ${name}`,
    )
  }
}
async function checkRetention(before, state, natives, settingsBefore, registryBefore) {
  const after = databaseSnapshot(join(data, 'brobot2.sqlite'))
  const comparison = dataPreserved(before, after)
  statePreserved(state, await stateBytes())
  registryPreserved(registryBefore, JSON.parse(await readFile(registry, 'utf8')), data)
  requireEvidence(
    hash(await readFile(settings)) === hash(settingsBefore),
    'Computer update settings changed.',
  )
  requireEvidence(
    isDeepStrictEqual(await nativeFiles(nativeRoot), natives),
    'Native transcript bytes changed before any resume.',
  )
  return { comparison, after }
}

try {
  requireEvidence(
    !(await exists(app)) &&
      !(await exists(data)) &&
      !(await exists(settings)) &&
      !(await exists(registry)),
    'Runner already has BroCrew or its data; refusing installation.',
  )
  await mkdir(evidence, { recursive: true })
  const metaA = diskImageFrom(await readFile(join(distA, 'latest-mac.yml'), 'utf8'), VERSION_A)
  const metaB = diskImageFrom(await readFile(join(distB, 'latest-mac.yml'), 'utf8'), VERSION_B)
  let serving = distA
  if (values['serve-local']) {
    feed = createServer(async (request, response) => {
      try {
        const name = decodeURIComponent(new URL(request.url, feedUrl).pathname.slice(1))
        const permitted = new Set([
          'latest-mac.yml',
          ...(await readdir(serving)).filter((one) => /\.(dmg|zip|blockmap)$/.test(one)),
        ])
        summary.feedRequests ??= []
        summary.feedRequests.push({
          at: new Date().toISOString(),
          method: request.method,
          path: request.url,
          version: serving === distA ? VERSION_A : VERSION_B,
        })
        if (!permitted.has(name)) return response.writeHead(404).end()
        response.writeHead(200, {
          'content-type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        })
        createReadStream(join(serving, name))
          .on('error', (error) => response.destroy(error))
          .pipe(response)
      } catch {
        response.writeHead(500).end()
      }
    })
    await new Promise((done, failed) => {
      feed.once('error', failed)
      feed.listen(Number(feedUrl.port), '127.0.0.1', done)
    })
  }
  let replies = 0
  model = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url.startsWith('/v1/'))
        return response.writeHead(404).end()
      JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const id = `resp_mac_fixture_${++replies}`
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (type, payload) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`)
      send('response.created', { response: { id } })
      send('response.output_item.done', {
        output_index: 0,
        item: {
          type: 'message',
          id: `msg_${id}`,
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: `Fictional Mac rehearsal ${id}: café ☕`,
              annotations: [],
            },
          ],
        },
      })
      send('response.completed', {
        response: {
          id,
          usage: {
            input_tokens: 1,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 2,
          },
        },
      })
      response.end()
    })
  })
  await new Promise((done, failed) => {
    model.once('error', failed)
    model.listen(0, '127.0.0.1', done)
  })
  await mkdir(codexHome, { recursive: true })
  await writeFile(join(codexHome, 'config.toml'), codexConfigFor(model.address().port))
  const attached = await plist('/usr/bin/hdiutil', [
    'attach',
    join(distA, metaA.url),
    '-readonly',
    '-nobrowse',
    '-plist',
  ])
  mountedA = attached['system-entities'].find((one) => one['mount-point'])?.['mount-point']
  requireEvidence(mountedA, 'A disk image did not mount.')
  await quarantine(join(distA, metaA.url), 'packaged-a-image')
  await run('/usr/bin/ditto', ['--rsrc', '--extattr', join(mountedA, 'BroCrew.app'), app])
  await run('/usr/bin/hdiutil', ['detach', mountedA])
  mountedA = null
  const embeddedFeed = await readFile(`${app}/Contents/Resources/app-update.yml`, 'utf8')
  requireEvidence(
    appUpdateProblems(embeddedFeed, updateFeed).length === 0,
    `Installed A does not carry the declared feed: ${appUpdateProblems(embeddedFeed, updateFeed).join('; ')}`,
  )
  summary.embeddedFeed = embeddedFeed
  let cdpA = await launch('a', 9339, VERSION_A, values['marker-a'])
  summary.expectedSetupDialog = await closeExpectedLaunchSetup(cdpA)
  passed('expected-setup-dialog-closed', summary.expectedSetupDialog)
  await cdpA.evaluate(
    'return await window.api.updates.set({checkAutomatically:true,channel:"stable"})',
  )
  await openUpdates(cdpA)
  await waitFor(
    async () => {
      const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'idle' && state.upToDate && state.checkedAt !== null
    },
    'visible automatic check against A-only feed',
    60_000,
  )
  await screenshot(cdpA, 'a-automatic-check.png')
  passed('visible-automatic-check', await cdpA.evaluate('return await window.api.updates.read()'))
  await click(cdpA, '[data-cy=updates-check]')
  await waitFor(async () => {
    const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
    if (state.kind === 'error') throw new Error(state.message)
    return state.kind === 'idle' && state.upToDate
  }, 'A-only feed up to date')
  passed('installed-a-normal-launch-and-feed', { data, version: VERSION_A })
  await cdpA.evaluate(
    'return await window.api.runtime.setApiKey({provider:"codex",key:"sk-mac-fictional-not-a-real-key"})',
  )
  const conversations = []
  for (let index = 0; index < 2; index++) {
    const expected = `resp_mac_fixture_${replies + 1}`
    const sessionId = await startLocalModelTurn(cdpA, `Fictional rehearsal ${index}: café ☕`)
    conversations.push(sessionId)
    await waitFor(
      () =>
        cdpA.evaluate(
          `return JSON.stringify(await window.api.runtime.latestHistory({sessionId:${JSON.stringify(sessionId)}})).includes(${JSON.stringify(expected)})`,
        ),
      'A local-model turn recorded',
    )
  }
  for (const sessionId of conversations)
    await cdpA.evaluate(
      `return await window.api.runtime.close({sessionId:${JSON.stringify(sessionId)}})`,
    )
  await quit()
  cdpA.close()
  const settledFixture = databaseSnapshot(join(data, 'brobot2.sqlite'))
  await writeFile(
    join(evidence, 'a-fixture-before-relaunch.json'),
    JSON.stringify(settledFixture, null, 2),
  )
  cdpA = await launch('a-settled', 9339, VERSION_A, values['marker-a'])
  passed(
    'fictional-data-survives-a-settling-relaunch',
    dataPreserved(settledFixture, databaseSnapshot(join(data, 'brobot2.sqlite'))),
  )
  await waitFor(
    async () => {
      const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'idle' && state.upToDate && state.checkedAt !== null
    },
    'settled A automatic check completes against the A-only feed',
    60_000,
  )
  await cdpA.evaluate(
    `return await window.api.workspaces.rename({path:${JSON.stringify(data)},name:"Fictional café lab"})`,
  )
  await openUpdates(cdpA)
  // The draft is typed as a person types it: a press on the message box, then the words.
  await click(cdpA, '[data-cy=prompt-input]')
  await cdpA.call('Input.insertText', { text: 'Unsent fictional draft: café ☕' })
  await waitFor(
    () =>
      cdpA.evaluate(
        'return (await window.api.savedDrafts())?.drafts.some(one=>one.text==="Unsent fictional draft: café ☕")',
      ),
    'A saves real renderer draft',
  )
  summary.fixture = {
    conversations,
    provider: 'codex',
    model: SCRIPTED_MODEL,
    localModelRequests: replies,
  }
  const registryFixture = JSON.parse(await readFile(registry, 'utf8'))
  const otherWorkspace = join(process.env.RUNNER_TEMP, 'fictional-other-workspace')
  await mkdir(otherWorkspace)
  registryFixture.workspaces.push({
    path: otherWorkspace,
    lastOpenedAt: 42,
    fictionalNote: 'Unopened café lab ☕',
  })
  await writeFile(registry, JSON.stringify(registryFixture, null, 2))
  const beforeButtons = databaseSnapshot(join(data, 'brobot2.sqlite'))
  const stateBeforeButtons = await stateBytes()
  requireEvidence(
    stateBeforeButtons['provider-usage.json'] !== undefined,
    'A settling quit did not preserve provider usage state.',
  )
  const nativeBeforeButtons = await nativeFiles(nativeRoot)
  const settingsBeforeButtons = await readFile(settings)
  requireEvidence(
    Object.keys(nativeBeforeButtons).length >= 2,
    'Pre-update native evidence is missing.',
  )
  nativeTranscriptsPresent(beforeButtons, nativeBeforeButtons)
  await writeFile(
    join(evidence, 'a-before-update-buttons.json'),
    JSON.stringify(
      {
        database: beforeButtons,
        state: Object.fromEntries(
          Object.entries(stateBeforeButtons).map(([name, bytes]) => [
            name,
            { bytes: bytes.length, sha256: hash(bytes) },
          ]),
        ),
        native: nativeBeforeButtons,
        registry: registryFixture,
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(evidence, 'a-ready.json'),
    JSON.stringify({ source: summary.source, conversations, data }, null, 2),
  )
  serving = distB
  // ⚑ A feed this harness does not serve publishes B once every lane is ready.
  const publishedText = await waitFor(
    async () => {
      const text = await servedUpdateFile(updateFeed, 'latest-mac.yml', {
        token: feedReadToken,
      }).catch(() => null)
      try {
        if (text !== null && diskImageFrom(text, VERSION_B)) return text
      } catch {
        // still A's, or not yet whole
      }
      // ⚑ Asked every 30 s: a GitHub feed answers a limited number of times an hour.
      await new Promise((done) => setTimeout(done, values['serve-local'] ? 250 : 30_000))
      return null
    },
    'the feed serves B',
    70 * 60_000,
  )
  const published = diskImageFrom(publishedText, VERSION_B)
  requireEvidence(
    JSON.stringify(published) === JSON.stringify(metaB),
    'Served B feed differs from packaged metadata.',
  )
  await writeFile(join(evidence, 'latest-mac.yml'), publishedText)
  await openUpdates(cdpA)
  await click(cdpA, '[data-cy=updates-check]')
  await waitFor(async () => {
    const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
    if (state.kind === 'error') throw new Error(state.message)
    return state.kind === 'available' && state.version === VERSION_B
  }, 'window offers B')
  await screenshot(cdpA, 'a-offers-b.png')
  await click(cdpA, '[data-cy=updates-download]')
  await waitFor(
    async () => {
      const state = (await cdpA.evaluate('return await window.api.updates.read()')).state
      if (state.kind === 'error') throw new Error(state.message)
      return state.kind === 'ready' && state.how === 'opened' && state.version === VERSION_B
    },
    'guided Download completes',
    600_000,
  )
  const image = join(downloads, published.url)
  requireEvidence(
    (await realpath(image)) === image &&
      (await lstat(image)).size === published.size &&
      (await digest(image, 'sha512', 'base64')) === published.sha512,
    'Downloads image bytes or feed SHA-512 differ.',
  )
  const mountedB = await waitFor(
    async () => mountedImageOf(await plist('/usr/bin/hdiutil', ['info', '-plist']), image),
    'OS opens and mounts the downloaded DMG',
  )
  const guided = await cdpA.evaluate(
    'return document.querySelector("[data-cy=updates-said]")?.textContent.replace(/\\s+/g," ").trim()',
  )
  requireEvidence(
    guided ===
      `BroCrew ${VERSION_B} is downloaded and opened. Quit every open copy of BroCrew, then drag the new one into Applications.`,
    'Guided text is missing or claims installation.',
  )
  requireEvidence(
    await cdpA.evaluate('return document.querySelector("[data-cy=updates-restart]") === null'),
    'Mac unexpectedly offers automatic replacement.',
  )
  await screenshot(cdpA, 'a-guided-dmg-opened.png')
  const sourceB = join(mountedB.mount, 'BroCrew.app')
  await quarantine(image, 'downloaded-b-image')
  await quarantine(sourceB, 'mounted-b-app')
  summary.download = {
    ...published,
    image,
    mountedB,
    guided,
    package: await bundleChecked(sourceB, VERSION_B, values['marker-b']),
  }
  passed('window-download-sha512-guided-text-and-os-mount', summary.download)
  await quit()
  cdpA.close()
  const before = databaseSnapshot(join(data, 'brobot2.sqlite')),
    state = await stateBytes()
  const natives = await nativeFiles(nativeRoot),
    settingsBefore = await readFile(settings)
  const registryBefore = JSON.parse(await readFile(registry, 'utf8'))
  const beforeReplacement = dataPreserved(beforeButtons, before, { allowAppended: true })
  statePreserved(stateBeforeButtons, state)
  await checkNativePrefixes(nativeBeforeButtons)
  requireEvidence(
    settingsBefore.equals(settingsBeforeButtons),
    'Download/quit changed computer settings.',
  )
  registryPreserved(registryFixture, registryBefore, data)
  passed('check-download-and-quit-preserve-original-data-and-state', beforeReplacement)
  requireEvidence(Object.keys(natives).length >= 2, 'Native transcript evidence is missing.')
  nativeTranscriptsPresent(before, natives)
  const copiesBefore = await checkpointIds()
  await writeFile(
    join(evidence, 'a-data-baseline.json'),
    JSON.stringify(
      {
        database: before,
        state: Object.fromEntries(
          Object.entries(state).map(([name, bytes]) => [
            name,
            { bytes: bytes.length, sha256: hash(bytes) },
          ]),
        ),
        natives,
        registry: registryBefore,
      },
      null,
      2,
    ),
  )
  await bundleChecked(app, VERSION_A, values['marker-a'])
  await rm(app, { recursive: true })
  await run('/usr/bin/ditto', ['--rsrc', '--extattr', sourceB, app])
  await quarantine(app, 'installed-b-app')
  const cdpB = await launch('b-first', 9340, VERSION_B, values['marker-b'])
  const order = recoveryOrder(await readFile(join(evidence, 'b-first.log'), 'utf8'), {
    checkpoint: true,
  })
  const copies = await checkpointIds(),
    added = copies.filter((one) => !copiesBefore.includes(one))
  requireEvidence(added.length === 1, 'B must make exactly one new checked recovery copy.')
  const checkpoint = join(data, 'backups', added[0]),
    manifest = JSON.parse(await readFile(join(checkpoint, 'manifest.json'), 'utf8'))
  const files = { 'database.sqlite': await readFile(join(checkpoint, 'database.sqlite')) }
  for (const name of STATE_FILES)
    if (await exists(join(checkpoint, name))) files[name] = await readFile(join(checkpoint, name))
  const checked = verifyCheckpoint(manifest, files, {
    id: added[0],
    workspaceId: (await readFile(join(data, 'backups', 'workspace-id'), 'utf8')).trim(),
    source: summary.source,
    state,
    migrations: before.migrations.map((one) => ({ createdAt: one.created_at, hash: one.hash })),
  })
  dataPreserved(before, databaseSnapshot(join(checkpoint, 'database.sqlite')))
  await writeFile(join(evidence, 'b-checkpoint-manifest.json'), JSON.stringify(manifest, null, 2))
  passed('b-checked-recovery-copy-before-ready', { ...checked, order })
  const kept = await checkRetention(before, state, natives, settingsBefore, registryBefore)
  await writeFile(join(evidence, 'b-first-retained-data.json'), JSON.stringify(kept.after, null, 2))
  const restoredDrafts = await cdpB.evaluate('return await window.api.savedDrafts()')
  requireEvidence(
    restoredDrafts?.drafts.some((one) => one.text === 'Unsent fictional draft: café ☕'),
    'B did not read A drafts.',
  )
  passed('b-preserves-every-conversation-event-raw-byte-draft-and-state', kept.comparison)
  await quit()
  cdpB.close()
  const copiesAfterFirst = await checkpointIds()
  const cdpSecond = await launch('b-second', 9341, VERSION_B, values['marker-b'])
  recoveryOrder(await readFile(join(evidence, 'b-second.log'), 'utf8'), { checkpoint: false })
  requireEvidence(
    JSON.stringify(await checkpointIds()) === JSON.stringify(copiesAfterFirst),
    'Second B start made a new recovery copy.',
  )
  const secondKept = await checkRetention(before, state, natives, settingsBefore, registryBefore)
  await writeFile(
    join(evidence, 'b-second-retained-data.json'),
    JSON.stringify(secondKept.after, null, 2),
  )
  await openUpdates(cdpSecond)
  await click(cdpSecond, '[data-cy=updates-check]')
  await waitFor(async () => {
    const read = await cdpSecond.evaluate('return await window.api.updates.read()')
    if (read.state.kind === 'error') throw new Error(read.state.message)
    return (
      read.state.kind === 'idle' &&
      read.state.upToDate &&
      read.version === VERSION_B &&
      read.channel === 'stable' &&
      read.checkAutomatically
    )
  }, 'B does not offer itself or change update settings')
  await cdpSecond.evaluate(
    `return await window.api.runtime.resume({sessionId:${JSON.stringify(conversations[0])}})`,
  )
  const resumedResponse = `resp_mac_fixture_${replies + 1}`
  await cdpSecond.evaluate(
    `return await window.api.runtime.send({sessionId:${JSON.stringify(conversations[0])},text:"Fictional turn after the guided update"})`,
  )
  await waitFor(
    () =>
      cdpSecond.evaluate(
        `return JSON.stringify(await window.api.runtime.latestHistory({sessionId:${JSON.stringify(conversations[0])}})).includes(${JSON.stringify(resumedResponse)})`,
      ),
    'B resumes A through local model',
  )
  passed('second-b-start-no-copy-no-self-offer-and-local-resume', {
    copies: copiesAfterFirst,
    replies,
  })
  await screenshot(cdpSecond, 'b-second-ready.png')
  await quit()
  cdpSecond.close()
  dataPreserved(before, databaseSnapshot(join(data, 'brobot2.sqlite')), { allowAppended: true })
  await checkNativePrefixes(natives)
  summary.success = true
} catch (error) {
  summary.success = false
  summary.failure = error.stack ?? String(error)
  console.error(summary.failure)
  process.exitCode = 1
  if (active) {
    try {
      assertOwnedProcess(active, await processInfo(active.pid), app, active.port)
      await run(
        '/usr/bin/sample',
        [
          String(active.pid),
          '1',
          '1',
          '-file',
          join(evidence, `${active.stage ?? 'failed-launch'}-main.sample.txt`),
        ],
        { timeout: 15_000 },
      )
      summary.failedProcess = await processInfo(active.pid)
      if (active.cdp) await screenshot(active.cdp, `${active.stage}-failure.png`)
    } catch (diagnosticError) {
      summary.diagnosticFailure = String(diagnosticError)
    }
  }
} finally {
  if (active)
    try {
      await quit()
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  for (const channel of channels) channel.close()
  if (mountedA)
    try {
      await run('/usr/bin/hdiutil', ['detach', mountedA])
    } catch (error) {
      summary.cleanupFailure = String(error)
      summary.success = false
      process.exitCode = 1
    }
  for (const server of [feed, model])
    if (server) {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  await mkdir(evidence, { recursive: true })
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2))
  if (summary.success !== true) process.exitCode = 1
}
