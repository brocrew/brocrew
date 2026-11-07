import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fork, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Scratch runner only. It never reads an existing BroCrew root or credential.
const [resourcesInput, archiveInput, evidenceInput] = process.argv.slice(2)
if (process.platform !== 'win32' || !resourcesInput || !archiveInput || !evidenceInput)
  throw new Error('usage on Windows: node diagnostic.mjs resources archive evidence')
const resources = resolve(resourcesInput)
const archive = resolve(archiveInput)
const evidence = resolve(evidenceInput)
mkdirSync(evidence, { recursive: true })
const expected = 'd05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0'
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
if (sha(archive) !== expected) throw new Error('published archive digest differs')
const scratch = mkdtempSync(join(tmpdir(), 'chrome-start-diagnostic-'))
const pkg = join(scratch, 'package')
const home = join(scratch, 'host', 'data', 'chrome')
const shared = join(scratch, 'shared', 'chrome')
const run = join(scratch, 'host', 'runs', randomUUID())
for (const dir of [pkg, home, shared, run, ...['files', 'downloads', 'tmp', 'AppData/Roaming', 'AppData/Local'].map((d) => join(home, d))])
  mkdirSync(dir, { recursive: true, mode: 0o700 })
execFileSync('tar.exe', ['-xzf', archive, '-C', pkg])
const metadata = JSON.parse(readFileSync(join(resources, 'plugin-node', 'runtime.json'), 'utf8'))
const node = join(resources, 'plugin-node', 'node.exe')
if (sha(node) !== metadata.sha256) throw new Error('packaged runtime digest differs')
const preload = join(resources, 'plugin-host', 'server.mjs')
const entry = join(pkg, 'server.mjs')
const manifest = JSON.parse(readFileSync(join(pkg, 'plugin.json'), 'utf8'))
if (sha(entry) !== manifest.files.find((f) => f.path === 'server.mjs')?.sha256)
  throw new Error('published server digest differs')
const mcpToken = randomBytes(32).toString('hex')
const adminToken = randomBytes(32).toString('hex')
const auth = join(run, 'auth.json')
writeFileSync(auth, JSON.stringify({ mcpToken, adminToken }), { flag: 'wx', mode: 0o600 })
const root = process.env.SystemRoot ?? process.env.windir
if (!root) throw new Error('missing SystemRoot')
const runId = randomUUID()
const env = {
  SystemRoot: root, windir: root, SystemDrive: root.slice(0, 2),
  PATH: [join(root, 'System32'), root, join(root, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
  USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: join(home, 'AppData', 'Local'), TMP: join(home, 'tmp'),
  TEMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'),
  BROCREW_PLUGIN_RUN_ID: runId, BROCREW_CHROME_DATA: home,
  BROCREW_CHROME_AUTH: auth, BROCREW_CHROME_PORT: '0',
  BROCREW_CHROME_SHARED: shared,
  BROCREW_PLUGIN_OWNER_ID: randomUUID(), BROCREW_PLUGIN_OWNER_LABEL: 'the default workspaces',
}
const redact = (s) => s.replaceAll(mcpToken, '[mcp-token]').replaceAll(adminToken, '[admin-token]')
const result = {
  archiveSha256: sha(archive), serverSha256: sha(entry), runtime: metadata,
  runtimeSha256: sha(node), preloadSha256: sha(preload), scratch,
  paths: { node, preload, entry, home, auth, shared }, authMode: statSync(auth).mode,
  chromeCandidates: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].map((path) => {
    try { return { path, exists: statSync(path).isFile() } } catch { return { path, exists: false } }
  }),
  events: [],
}
const started = Date.now()
const child = fork(entry, [], {
  execPath: node, execArgv: ['--import', pathToFileURL(preload).href],
  cwd: home, env, detached: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
let stdout = '', stderr = '', forced = false
child.stdout.on('data', (b) => { stdout += b })
child.stderr.on('data', (b) => { stderr += b })
child.on('message', (message) => {
  result.events.push({ elapsedMs: Date.now() - started, message })
  if (message?.type === 'awaiting-admission')
    child.send({ channel: 'brocrew-plugin-node:v1', runId, type: 'admitted' })
  if (message?.type === 'listening')
    child.send({ channel: 'brocrew-plugin-node:v1', runId, type: 'stop' })
})
const timer = setTimeout(() => { forced = true; child.kill() }, 30_000)
result.exit = await new Promise((yes) => {
  child.once('error', (e) => { result.spawnError = { message: e.message, code: e.code } })
  child.once('close', (code, signal) => yes({ code, signal, forced, elapsedMs: Date.now() - started }))
})
clearTimeout(timer)
result.stdout = redact(stdout)
result.stderr = redact(stderr)
writeFileSync(join(evidence, 'server-start.json'), JSON.stringify(result, null, 2))
process.stdout.write(JSON.stringify(result, null, 2) + '\n')

// The published main() hides most exception detail; exported startup functions expose the stack.
// This separate process uses the same synthetic scratch environment and unchanged package bytes.
const probe = spawn(node, ['--input-type=module', '-e', `
try {
  const m = await import(${JSON.stringify(pathToFileURL(entry).href)});
  const config = m.loadConfig(process.env);
  console.log('loadConfig passed');
  m.createConfiguredProfileStore(config);
  console.log('createConfiguredProfileStore passed');
} catch (e) { console.error(e?.stack ?? String(e)); process.exitCode = 1; }
`], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
let probeOut = '', probeErr = ''
probe.stdout.on('data', (b) => { probeOut += b })
probe.stderr.on('data', (b) => { probeErr += b })
const probeTimer = setTimeout(() => probe.kill(), 30_000)
const probeExit = await new Promise((yes) => probe.once('close', (code, signal) => yes({ code, signal })))
clearTimeout(probeTimer)
const detail = { ...probeExit, stdout: redact(probeOut), stderr: redact(probeErr) }
writeFileSync(join(evidence, 'exported-startup-stack.json'), JSON.stringify(detail, null, 2))
process.stdout.write(JSON.stringify(detail, null, 2) + '\n')
