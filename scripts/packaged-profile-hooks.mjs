import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fixtureAppEnvironment } from './gates/plugin-packaged/fixture-command.mjs'
import { observeApp } from './gates/plugin-packaged/probe.mjs'
import { bounded, stopApp } from './gates/plugin-packaged/processes.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { readWorkspaceForUpdate } from '../apps/desktop/src/main/one-host-gate.ts'
import { RendererCdp, waitFor } from './lib/renderer-cdp.mjs'
import { assertPortOwnedByTree } from './lib/smoke-target.mjs'
import { defaultReadProcessIdentity } from './lib/owned-process.mjs'
import { waitFor as waitForProcess } from './lib/smoke-run.mjs'
import { descendantsOf, launchedProcessLifecycle } from './lib/owned-teardown.mjs'
import {
  anthropicEvents, CLAUDE_CODE_VERSION, CLAUDE_FIXTURE_KEY, claudeKeySeen, offersTool, sseOf,
  toolResultText, userTextsIn,
} from './lib/scripted-claude.mjs'
import { THE_STAND_IN_KEYCHAIN_PROGRAM } from './lib/tests-run-in-a-fictional-home.mjs'

const reason = "BroBot doesn't read code. Give it to the area lead; read projects/brobot-selfdev/how-brobot-works.md"
const bundleId = 'com.brocrew.proof.profilehooks'
const donor = '124e7622bd417b578ddee7c30fcae989925047ac'
const donorTree = '3b46145358302e3018dd6aeb1c1e0e56016b3baa'
const wait = (label, probe, ms = 90_000) => waitFor(label, probe, ms, 250)
const json = (path, content) => writeFileSync(path, JSON.stringify(content, null, 2) + '\n', { flag: 'wx' })
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const shell = (value) => "'" + value.replaceAll("'", "'\\''") + "'"

function metadata(root) {
  try {
    lstatSync(root)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const rows = []
  function visit(path, name) {
    const stat = lstatSync(path, { bigint: true })
    rows.push([name, ...[stat.mode, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)])
    if (!stat.isDirectory()) return
    for (const child of readdirSync(path).sort()) visit(join(path, child), join(name, child))
  }
  visit(root, '.')
  return rows
}

async function listen(server) {
  await new Promise((done, fail) => server.once('error', fail).listen(0, '127.0.0.1', done))
  return server.address().port
}

async function freePort() {
  const listener = createServer()
  const port = await listen(listener)
  await new Promise((done) => listener.close(done))
  return port
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function parsedLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function nativeResult(profileHome, id) {
  const projects = join(profileHome, 'projects')
  if (!existsSync(projects)) return null
  for (const project of readdirSync(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const dir = join(projects, project.name)
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !/^[0-9a-f-]+\.jsonl$/i.test(file.name)) continue
      const path = join(dir, file.name)
      for (const row of parsedLines(path)) {
        const content = row.message?.content
        const block = Array.isArray(content) && content.find((entry) =>
          entry.type === 'tool_result' && entry.tool_use_id === id)
        if (block) return { path, sessionId: basename(path, '.jsonl'), version: row.version, block }
      }
    }
  }
  return null
}

async function main() {
  const [app, cli, evidence] = process.argv.slice(2)
  assert(process.platform === 'darwin' && process.arch === 'arm64' &&
    process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'brocrew/brocrew' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted', 'Use the approved hosted macOS runner')
  assert([app, cli, evidence].every((path) => typeof path === 'string' && isAbsolute(path)))
  assert.equal(metadata('/Library/Application Support/ClaudeCode/managed-settings.json'), null,
    'Hosted runner unexpectedly has machine-managed Claude settings')
  const bundle = realpathSync(app)
  const program = realpathSync(cli)
  const plist = join(bundle, 'Contents/Info.plist')
  const plistValue = (field) => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :' + field, plist],
    { encoding: 'utf8' }).trim()
  assert.equal(plistValue('CFBundleIdentifier'), bundleId)
  const binary = join(bundle, 'Contents/MacOS', plistValue('CFBundleExecutable'))
  const proof = git('rev-parse', 'HEAD')
  const proofTree = git('rev-parse', 'HEAD^{tree}')
  assert.equal(git('rev-parse', donor + '^{tree}'), donorTree)
  assert.equal(git('diff', '--name-status', donor, proof), 'A\tscripts/packaged-profile-hooks.mjs')
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
  assert.equal(git('diff', donor, proof, '--', 'apps', 'packages'), '')

  mkdirSync(evidence, { mode: 0o700 })
  const out = realpathSync(evidence)
  const root = realpathSync(mkdtempSync('/tmp/bcph-'))
  const data = join(root, 'data')
  const cwd = join(root, 'workspace')
  const env = fixtureAppEnvironment(root, bundle)
  const ambient = join(root, 'ambient.ndjson')
  const hookLog = join(root, 'profile.ndjson')
  const programLog = join(root, 'claude-process.tsv')
  const managedHome = (profile) => join(data, 'provider-homes/default', profile, 'claude')
  for (const folder of [data, cwd, env.CLAUDE_CONFIG_DIR, join(cwd, '.claude'),
    managedHome('fictional-hooks'), managedHome('fictional-no-hooks')]) {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
  }
  writeFileSync(join(root, 'bin/security'), THE_STAND_IN_KEYCHAIN_PROGRAM, { mode: 0o700, flag: 'wx' })
  const blocked = join(cwd, 'blocked.txt')
  const blockedAfterResume = join(cwd, 'blocked-after-resume.txt')
  const allowed = join(cwd, 'allowed.txt')
  const blockedMarker = 'fictional-blocked-content-cedar'
  const allowedMarker = 'fictional-allowed-content-maple'
  writeFileSync(blocked, blockedMarker)
  writeFileSync(blockedAfterResume, blockedMarker)
  writeFileSync(allowed, allowedMarker)
  const hook = join(root, 'hook.cjs')
  writeFileSync(hook, `
const fs = require('node:fs')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const [log, blocked, blockedAfterResume, reason] = process.argv.slice(2)
fs.appendFileSync(log, JSON.stringify({
  event: input.hook_event_name, path: input.tool_input?.file_path ?? null, source: input.source ?? null,
  session: input.session_id, home: process.env.HOME, config: process.env.CLAUDE_CONFIG_DIR,
}) + '\\n')
if ([blocked, blockedAfterResume].includes(input.tool_input?.file_path)) {
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
  } }))
}
`)
  const handler = (log) => ({ type: 'command', command:
    [process.execPath, hook, log, blocked, blockedAfterResume, reason].map(shell).join(' ') })
  const own = handler(hookLog), sentinel = handler(ambient)
  json(join(managedHome('fictional-hooks'), 'settings.json'), {
    hooks: { SessionStart: [{ hooks: [own] }], PreToolUse: [{ matcher: 'Read', hooks: [own] }] },
  })
  const ambientSettings = {
    hooks: { PreToolUse: [{ matcher: 'Read', hooks: [sentinel] }] },
    permissions: { deny: ['Read(/' + allowed + ')'] },
  }
  json(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), ambientSettings)
  json(join(cwd, '.claude/settings.json'), ambientSettings)
  json(join(cwd, '.claude/settings.local.json'), { hooks: ambientSettings.hooks })

  let active = null
  let requestNumber = 0
  const model = createServer(async (req, res) => {
    try {
      if (claudeKeySeen(req.headers) !== 'expected') {
        res.writeHead(401).end()
        return
      }
      const parts = []
      for await (const part of req) parts.push(part)
      const route = new URL(req.url, 'http://127.0.0.1').pathname
      if (route === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":11}')
        return
      }
      if (route !== '/v1/messages') {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
      let reply = { kind: 'text', text: 'Fictional model ready.' }
      if (active && userTextsIn(body).some((text) => text.includes(active.prompt))) {
        const answer = toolResultText(body, active.id)
        if (answer !== null) {
          active.model = answer
          reply = { kind: 'text', text: active.done }
        } else if (offersTool(body, 'Read')) {
          reply = { kind: 'tool_use', name: 'Read', id: active.id, input: { file_path: active.path } }
        }
      }
      const events = anthropicEvents(body.model, reply, 'msg_profile_hooks_' + ++requestNumber)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        .end(sseOf(events))
    } catch {
      res.writeHead(400).end()
    }
  })

  let run
  let lifecycle
  let lastPhase
  const phase = (name, details = {}) => {
    appendFileSync(join(out, 'startup.ndjson'), JSON.stringify({
      at: new Date().toISOString(), phase: name, ...details,
    }) + '\n')
    lastPhase = name
  }
  const protectedRoots = [homedir(), env.HOME].map((home) => join(home, 'Library/Application Support/@brobot2'))
  const before = protectedRoots.map(metadata)
  json(join(out, 'protected-before.json'), before)
  try {
    phase('launch-preparation', { donor, donorTree, proof, proofTree, bundleId, binary, data })
    const port = await listen(model)
    const wrapper = join(root, 'bin/claude')
    writeFileSync(wrapper, `#!/bin/sh
set -eu
export ANTHROPIC_BASE_URL=http://127.0.0.1:${port}
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
printf '%s\\t%s\\t%s\\n' "$$" "$HOME" "${'$'}{CLAUDE_CONFIG_DIR:-}" >> ${shell(programLog)}
exec ${shell(program)} "$@"
`, { mode: 0o700, flag: 'wx' })
    const version = execFileSync(wrapper, ['--version'], { env, encoding: 'utf8', timeout: 10_000 }).trim()
    assert(version.startsWith(CLAUDE_CODE_VERSION + ' '))
    phase('claude-pin-verified', { program, version })
    const debug = await freePort()
    assert(![9222, 9444].includes(debug))
    const stdout = join(out, 'app-stdout.log')
    const stderr = join(out, 'app-stderr.log')
    writeFileSync(stdout, '', { flag: 'wx' })
    writeFileSync(stderr, '', { flag: 'wx' })
    phase('app-spawn-requested', { debug })
    const child = spawn(binary, [
      HIDDEN_LAUNCH_ARG, '--use-mock-keychain', '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + debug, '--user-data-dir=' + data, '--brobot-claude-code=' + wrapper,
    ], { env: { ...env, BROCREW_SKIP_UPDATE_CHECK: '1' }, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => appendFileSync(stdout, chunk))
    child.stderr.on('data', (chunk) => appendFileSync(stderr, chunk))
    run = observeApp(child)
    const startError = await bounded(run.started, 10_000)
    if (startError) throw startError
    phase('app-spawned', { pid: child.pid })
    lifecycle = launchedProcessLifecycle(child.pid)
    const owner = await bounded(wait('owned debug listener', () => {
      const owner = assertPortOwnedByTree({ port: debug, repoRoot: bundle })
      assert.equal(Number(owner.pid), child.pid)
      assert.equal(realpathSync(owner.path), binary)
      return owner
    }), 95_000)
    phase('debug-owner-verified', { pid: Number(owner.pid), executable: owner.path })
    const presence = await waitForProcess('packaged workspace presence',
      () => readWorkspaceForUpdate(data), 10_000)
    assert.equal(presence.pid, child.pid)
    assert.equal(realpathSync(presence.folder), data)
    assert.equal(realpathSync(presence.executable), binary)
    phase('workspace-presence-verified', {
      pid: presence.pid, folder: presence.folder, executable: presence.executable, ready: presence.ready,
    })
    const cdp = await bounded(RendererCdp.attach(debug, { launchMs: 90_000, pollMs: 250 }), 95_000)
    run.cdp = cdp
    phase('renderer-attached')
    const evaluate = (code, ms = 30_000) => bounded(cdp.evaluate(code), ms)
    const call = (name, args) => evaluate(`return window.api.runtime.${name}(${JSON.stringify(args)})`, 120_000)
    const info = await wait('packaged preload and database', () =>
      evaluate("return location.protocol === 'file:' && window.api?.getAppInfo()"))
    assert.equal(info.build.commit, donor)
    assert.equal(info.build.dirty, false)
    assert.equal(realpathSync(info.workspace.path), data)
    assert.equal(info.workspace.isDefault, false)
    phase('runtime-identity-verified', { build: info.build, workspace: info.workspace })
    json(join(out, 'identity.json'), {
      donor, donorTree, proof, proofTree, bundle, bundleId, binary, pid: child.pid, info, program, version,
      workspace: cwd, home: env.HOME, ambient: env.CLAUDE_CONFIG_DIR,
      asarSha256: await sha256(join(bundle, 'Contents/Resources/app.asar')),
    })
    assert.equal((await call('setApiKey', { provider: 'claude', key: CLAUDE_FIXTURE_KEY })).set, true)
    for (const slug of ['fictional-hooks', 'fictional-no-hooks']) {
      await call('createAgent', { slug, displayName: null, provider: 'claude' })
    }
    async function open(profileId) {
      const created = await call('createSession', { provider: 'claude', profileId, cwd, approvalMode: 'auto' })
      assert.equal(created.profileId, profileId)
      assert.equal(realpathSync(created.cwd), cwd)
      assert.equal(realpathSync(created.providerHome), managedHome(profileId))
      assert(typeof created.sessionId === 'string')
      return created.sessionId
    }
    async function turn(sessionId, profile, label, path, expected, denied = false) {
      const id = 'toolu_profile_hooks_' + label.replaceAll('-', '_')
      active = { id, path, prompt: 'Fixture request ' + label, done: 'Fixture complete ' + label }
      await call('send', { sessionId, text: active.prompt })
      await wait(label + ' loopback result', () => active.model !== undefined)
      const raw = await wait(label + ' native transcript', () => nativeResult(managedHome(profile), id))
      const rawText = toolResultText({ messages: [{ content: [raw.block] }] }, id)
      json(join(out, label + '-native.json'), { ...raw, model: active.model })
      assert.equal(raw.block.is_error === true, denied)
      assert(rawText.includes(expected))
      assert(active.model.includes(expected))
      if (denied) {
        assert(!rawText.includes(blockedMarker))
        assert(!active.model.includes(blockedMarker))
      }
      if (raw.version !== undefined) assert.equal(raw.version, CLAUDE_CODE_VERSION)
      await wait(label + ' result in packaged app history', async () => {
        const history = await call('latestHistory', { sessionId })
        const events = history.entries.map(({ event }) => event)
        return events.some((event) => event.type === 'tool_result' && event.id === id &&
          event.ok === !denied && event.summary.includes(expected)) &&
          events.some((event) => event.type === 'assistant_message' && event.text === active.done)
      })
      const proc = await wait(label + ' owned Claude process', () => {
        const descendants = new Set(descendantsOf(child.pid).map(({ pid }) => pid))
        const processes = readFileSync(programLog, 'utf8').trimEnd().split('\n').reverse()
        for (const line of processes) {
          const [pidText, home, config] = line.split('\t')
          const pid = Number(pidText)
          if (!descendants.has(pid) || home !== env.HOME || config !== managedHome(profile)) continue
          const identity = defaultReadProcessIdentity(pid)
          if (identity?.executable === program) {
            return { pid, home, config, program, started: identity.start }
          }
        }
        return null
      })
      lifecycle.refreshDescendants()
      if (denied) {
        const row = JSON.stringify('[data-cy="open-session-' + sessionId + '"]')
        await wait(label + ' conversation rail', () => evaluate(`
          const row = document.querySelector(${row})
          if (!row) return false
          if (row.getAttribute('data-active') !== 'true') row.click()
          return true
        `))
        const detail = await wait(label + ' visible Read detail', () => evaluate(`
          const pane = document.querySelector('[data-cy="conversation-pane"][data-session-id="' +
            ${JSON.stringify(sessionId)} + '"]')
          if (!pane) return null
          const path = ${JSON.stringify(path)}
          const visible = (node) => node?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          for (const row of pane.querySelectorAll('[data-cy="tool-entry"]')) {
            if (row.querySelector('.tool-summary code')?.textContent.trim() !== path) continue
            if (row.classList.contains('folded')) row.querySelector('.tool-head').click()
            const output = row.querySelector('.tool-body.out-bad')
            if (visible(output)) {
              output.scrollIntoView({ block: 'center' })
              return output.innerText
            }
          }
          for (const row of pane.querySelectorAll('[data-cy="tool-run"]')) {
            if (row.getAttribute('data-calls') !== '1') continue
            if (row.getAttribute('data-open') !== 'true') row.querySelector('[data-cy="tool-run-toggle"]')?.click()
            const input = row.querySelector('[data-cy="tool-run-input"]')
            const output = row.querySelector('[data-cy="tool-run-output"].bad')
            if (!input?.textContent.includes(path) || !visible(output)) continue
            output.scrollIntoView({ block: 'center' })
            return output.innerText
          }
          return null
        `))
        json(join(out, label + '-detail.json'), { id, sessionId, path, text: detail, process: proc })
        assert(detail.includes(reason))
        assert(!detail.includes(blockedMarker))
        await bounded(cdp.shot(join(out, label + '-detail.png')), 15_000)
      } else {
        json(join(out, label + '-process.json'), proc)
      }
      active = null
      return { raw, proc }
    }
    const profile = 'fictional-hooks'
    const session = await open(profile)
    const start = await turn(session, profile, 'start-denied', blocked, reason, true)
    await turn(session, profile, 'start-allowed', allowed, allowedMarker)
    await call('close', { sessionId: session })
    await waitForProcess('first native Claude process exited',
      () => defaultReadProcessIdentity(start.proc.pid) === null, 90_000)
    json(join(out, 'start-claude-exit.json'), {
      pid: start.proc.pid, started: start.proc.started, program: start.proc.program,
      observedAt: new Date().toISOString(), state: 'absent',
    })
    await call('resume', { sessionId: session })
    const resumed = await turn(session, profile, 'resume-denied', blockedAfterResume, reason, true)
    assert.equal(resumed.raw.sessionId, start.raw.sessionId)
    assert.notEqual(resumed.proc.pid, start.proc.pid)
    await call('close', { sessionId: session })
    const control = await open('fictional-no-hooks')
    await turn(control, 'fictional-no-hooks', 'no-hook-allowed', blocked, blockedMarker)
    await call('close', { sessionId: control })
    const hooks = parsedLines(hookLog)
    json(join(out, 'hook-controls.json'), { hooks, ambientInvocations: parsedLines(ambient) })
    assert.deepEqual(parsedLines(ambient), [])
    assert.equal(hooks.filter((entry) => entry.event === 'SessionStart').length, 2)
    assert.deepEqual(hooks.filter((entry) => entry.event === 'PreToolUse').map((entry) => entry.path),
      [blocked, allowed, blockedAfterResume])
    assert(hooks.every((entry) => entry.home === env.HOME && entry.config === managedHome(profile)))
    assert(hooks.every((entry) => entry.session === start.raw.sessionId))
    phase('hook-controls-verified')
  } catch (error) {
    phase('proof-failed', { after: lastPhase, error: String(error) })
    throw error
  } finally {
    try {
      if (run) {
        try {
          run.cdp?.close()
          const stop = lifecycle?.stop()
          if (stop) {
            json(join(out, 'process-exit.json'), stop)
            assert(stop.complete, 'Could not verify exit of the owned app processes')
          }
        } finally {
          await stopApp(run)
          await bounded(run.closed, 10_000)
        }
      }
    } finally {
      model.closeAllConnections()
      await new Promise((done) => model.close(done))
      const after = protectedRoots.map(metadata)
      json(join(out, 'protected-after.json'), after)
      const equal = JSON.stringify(before) === JSON.stringify(after)
      json(join(out, 'non-interference.json'), { roots: protectedRoots, metadataOnly: true, equal })
      assert(equal, 'Protected @brobot2 metadata changed')
    }
  }
  console.log('PASS: packaged native refusal, renderer detail, allowed and settings-isolation controls')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
