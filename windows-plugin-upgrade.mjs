// Test carrier only. Installs actual NSIS releases on a fresh GitHub Windows runner.
// Default is a plan; --execute is required. See windows-plugin-upgrade-README.md.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync, copyFileSync, renameSync } from 'node:fs'
import { basename, dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { chromeCompatibilityResult } from './chrome-compatibility-result.mjs'
import { readCustomPluginInputs } from './custom-plugin-inputs.mjs'
import { transportLabel, readTransportFixture, assertUnusedInspectorPort, coldMainArgument, attachColdMain, attachSupervisor } from './instrumented-plugin-transport.mjs'

const { values: args } = parseArgs({ options: {
  execute: { type: 'boolean', default: false }, 'test-path': { type: 'string', default: 'failed-beta-recovery' }, 'source-root': { type: 'string' },
  'candidate-dir': { type: 'string' }, 'candidate-sha': { type: 'string' },
  'candidate-version': { type: 'string' }, 'plugin-inputs': {type:'string'}, 'plugin-receipt-sha256': {type:'string'}, 'plugin-run-id': {type:'string'}, 'plugin-artifact': {type:'string'}, inputs: { type: 'string' }, evidence: { type: 'string' },
} })
const publishedExpected = {
  chrome: { version: '0.1.8', bytes: 3608965, sha256: 'd05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0', manifest: 'b8432edfc43657715a695dcca57164c7ba0e9229fd98570d4159afeb9be8f7d3', repo: 'brocrew-plugin-chrome' },
  whatsapp: { version: '0.1.4', bytes: 8228798, sha256: '49497b4c15adffefdbc63f8490da542ebae78016975a72c6b55e4476aa3dc769', manifest: 'fe6f04050ac0ec9cc0b577de9d57dc249987d7d3a43cc7e16a9350e68ca83c8d', repo: 'brocrew-plugin-whatsapp' },
}
let expected=structuredClone(publishedExpected)
assert.equal(Boolean(args['plugin-inputs']),Boolean(args['plugin-receipt-sha256']),'custom plugin directory and receipt hash required together')
assert(['failed-beta-recovery','clean-install','app-upgrade-compat'].includes(args['test-path']))
const cleanInstall=args['test-path']==='clean-install'
const appCompat=args['test-path']==='app-upgrade-compat'
assert(!appCompat||!args['plugin-inputs'],'app compatibility mode uses exact published018/014, not custom archive instrumentation')
const plan = cleanInstall ? ['verify exact candidate installer and published win32/x64 plugin pins', 'install candidate NSIS on a clean runner without installing or launching beta', 'install both published plugins through candidate Settings', 'call Chrome list_browser_profiles and WhatsApp tools/list through installed service', 'verify normal candidate shutdown and cleanup'] : ['verify public beta installer, exact candidate bytes and published win32/x64 plugin pins', 'install actual 0.1.36 NSIS', 'record beta Settings Chrome installation failure as the expected baseline', 'stop beta and retain its real residual plugin state without seeding or repair', 'install exact 0.2.11 candidate NSIS over beta', 'install or retry the two published plugins through candidate Settings', 'attach observer to candidate-owned service; Chrome list_browser_profiles and WhatsApp tools/list over HTTP', 'detach observer, quit app, verify owner/host exits and process cleanup']
if(appCompat)plan.unshift('APP COMPATIBILITY ONLY: known Chrome018 identity failure may be non-blocking; WhatsApp/service/upgrade/normal cleanup remain mandatory')
if(args['plugin-inputs'])plan.unshift(transportLabel)
if (!args.execute) { console.log(JSON.stringify({ execute: false, plan, expected }, null, 2)); process.exit(0) }
assert.equal(process.platform, 'win32', 'execution is Windows only')
assert.equal(process.arch, 'x64')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.env.GITHUB_REPOSITORY, 'brocrew/brocrew')
for (const name of ['source-root', 'candidate-dir', 'candidate-sha', 'candidate-version', 'inputs', 'evidence']) assert(args[name], `--${name} is required`)
assert.match(args['candidate-sha'], /^[a-f0-9]{40}$/)
assert.equal(args['candidate-version'],'0.2.11')
const source = resolve(args['source-root']), inputs = resolve(args.inputs), evidence = join(resolve(args.evidence),'driver')
assert(!existsSync(evidence), 'evidence directory must be new')
mkdirSync(evidence, { recursive: true })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const keep = (name, value) => writeFileSync(join(evidence, name), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const summary = { format: 1, started: new Date().toISOString(), passed: false, testPath: args['test-path'], plan, expected, phases: [], failures: [], outsideThisCheck: ['No account sign-in, real browser profiles, WhatsApp session, or provider calls', 'No in-app updater or SmartScreen UI proof', 'Observer uses source control clients, but never launches source runtime/service/plugin code', 'No full application or release qualification'] }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, ms, label) { const end = performance.now() + ms; do { const value = await fn(); if (value) return value; await pause(250) } while (performance.now() < end); throw Error(`deadline: ${label}`) }
function run(exe, argv, extra = {}) { const result = spawnSync(exe, argv, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...extra }); assert.ifError(result.error); assert.equal(result.status, 0, `${exe} exit ${result.status}: ${result.stderr}`); return result.stdout ?? '' }
function powershell(body) { return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n${body}`]) }
const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
const rows = text => { if (!text.trim()) return []; const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : [parsed] }
// Same electron-builder app-id UUID and native registration lookup as scripts/upgrade-path.mjs.
const guidHash = createHash('sha1').update(Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')).update('com.brobot2.desktop').digest()
guidHash[6] = (guidHash[6] & 15) | 80; guidHash[8] = (guidHash[8] & 63) | 128
const gh = guidHash.subarray(0, 16).toString('hex'), installKey = `${gh.slice(0,8)}-${gh.slice(8,12)}-${gh.slice(12,16)}-${gh.slice(16,20)}-${gh.slice(20)}`
function appsEntries() {
  return rows(powershell(`$keys='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
$rows=foreach($key in $keys){if(Test-Path $key){Get-ChildItem -LiteralPath $key | ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath}}}
$rows | Where-Object {$_.PSChildName -eq '${installKey}'} | Select-Object PSChildName,DisplayName,DisplayVersion,UninstallString,@{n='InstallLocation';e={foreach($root in 'HKCU:\\Software','HKLM:\\Software'){ $p=Join-Path $root '${installKey}';if(Test-Path $p){(Get-ItemProperty -LiteralPath $p).InstallLocation;break}}}} | ConvertTo-Json -Compress`))
}
const appRoot = join(process.env.APPDATA, '@brobot2'), pluginRoot = join(appRoot, 'plugins')
const products = new Set(['BroCrew.exe', 'BroBot.exe', 'BroBot2.exe']), installDirs = new Set(), owned = new Map()
let ownsFixture = false
let transportManifest, transportFixture
const transportHandles=new Map()
const allProcesses = () => rows(powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'))
const samePath = (a,b) => typeof a === 'string' && typeof b === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase()
const birthMs = row => {const match=/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(row.CreationDate??'');return match?Number(match[1]):Date.parse(row.CreationDate)}
function ownProcesses() {
  const all = allProcesses(), current = new Set()
  for (const row of all) if ((owned.has(row.ProcessId) && owned.get(row.ProcessId).CreationDate === row.CreationDate) || [...installDirs].some(dir => row.ExecutablePath && samePath(dirname(row.ExecutablePath), dir)) || (row.CommandLine ?? '').toLowerCase().includes(pluginRoot.toLowerCase())) current.add(row.ProcessId)
  let changed = true
  while (changed) { changed = false; for (const row of all) if (!current.has(row.ProcessId) && current.has(row.ParentProcessId)) { current.add(row.ProcessId); changed = true } }
  for (const row of all) if (current.has(row.ProcessId)) {assert(Number.isFinite(birthMs(row)),'owned process has no native creation identity');owned.set(row.ProcessId, row)}
  return all.filter(row => current.has(row.ProcessId))
}
const phase = async (name, fn) => { const row = { name, started: new Date().toISOString() }; summary.phases.push(row); keep('summary.json', summary); try { const value = await fn(); row.passed = true; return value } catch(error) { row.passed = false; row.failure = error.stack ?? String(error); throw error } finally { row.finished = new Date().toISOString(); keep('summary.json', summary) } }
function installer(path, metadataPath, version, wanted) {
  const release = readJson(metadataPath), bytes = readFileSync(path), name = `BroCrew-Setup-${version}-x64.exe`
  assert.equal(release.tag_name, `v${version}`); assert.equal(release.draft, false)
  const matches = release.assets.filter(asset => asset.name === name); assert.equal(matches.length, 1)
  const asset = matches[0], hash = digest(bytes)
  assert.equal(basename(path), name); assert.equal(asset.size, bytes.length); assert.equal(asset.digest, `sha256:${hash}`); assert.equal(hash, wanted)
  assert.equal(asset.browser_download_url, `https://github.com/brocrew/brocrew/releases/download/v${version}/${name}`)
  keep(`release-${version}.json`, readFileSync(metadataPath))
  return { path: resolve(path), sha256: hash, bytes: bytes.length, releaseId: release.id, assetId: asset.id, url: asset.browser_download_url }
}
async function publicJson(url, name) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200, url)
  const bytes = Buffer.from(await response.arrayBuffer()); keep(name, bytes); return JSON.parse(bytes.toString('utf8'))
}
function install(input, version) {
  assert.equal(digest(readFileSync(input.path)),input.sha256,'installer bytes changed after intake')
  const native = spawnSync(input.path, ['/S'], { timeout: 300000, windowsHide: true, encoding: 'utf8' })
  const entries = appsEntries(); keep(`install-${version}.json`, { input, status: native.status, signal: native.signal, error: native.error?.message, stdout: native.stdout, stderr: native.stderr, entries })
  if(entries.length===1&&typeof entries[0].InstallLocation==='string')installDirs.add(entries[0].InstallLocation)
  assert.ifError(native.error); assert.equal(native.status, 0); assert.equal(entries.length, 1); assert.equal(entries[0].DisplayVersion, version)
  const folder = entries[0].InstallLocation; assert.equal(typeof folder, 'string')
  const programs = readdirSync(folder).filter(name => /\.exe$/i.test(name) && !/^Uninstall /i.test(name)); assert.equal(programs.length, 1)
  products.add(programs[0]); installDirs.add(folder)
  const exe = join(folder, programs[0]); assert(lstatSync(exe).isFile())
  const identity = JSON.parse(powershell(`(Get-Item -LiteralPath ${psQuote(exe)}).VersionInfo | Select-Object ProductVersion,FileVersion,OriginalFilename | ConvertTo-Json -Compress`))
  keep(`version-resource-${version}.json`, identity)
  assert(identity.ProductVersion === version || identity.ProductVersion === `${version}.0`, 'unexpected installed Windows ProductVersion')
  const result = { exe, folder, identity, executableSha256: digest(readFileSync(exe)), asarSha256: digest(readFileSync(join(folder, 'resources', 'app.asar'))), entries }
  keep(`installed-${version}.json`, result)
  const unexpected = ownProcesses(); assert.equal(unexpected.length, 0, 'installer unexpectedly launched app; preserved as failure')
  return result
}
let running
// No CI token, provider credential, Node injection hook, or account environment enters the app.
const appEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name])=>['systemroot','windir','comspec','systemdrive','path','pathext','temp','tmp','appdata','localappdata','userprofile','homedrive','homepath','programfiles','programfiles(x86)','programw6432','number_of_processors','processor_architecture','os'].includes(name.toLowerCase())))
async function connect(url) {
  assert.equal(new URL(url).hostname, '127.0.0.1')
  const socket = new WebSocket(url), pending = new Map(); let next = 0
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once:true }); socket.addEventListener('error', () => fail(Error('CDP connect failed')), { once:true }); setTimeout(() => { if(socket.readyState !== WebSocket.OPEN) {socket.close(); fail(Error('CDP connect deadline'))} }, 10000).unref() })
  function failed(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.fail(error) } pending.clear() }
  socket.addEventListener('close', () => failed(Error('CDP closed')))
  socket.addEventListener('error', () => failed(Error('CDP error')))
  socket.addEventListener('message', ({data}) => { const reply = JSON.parse(data), p = pending.get(reply.id); if (!p) return; pending.delete(reply.id); clearTimeout(p.timer); if(reply.error) p.fail(Error(JSON.stringify(reply.error))); else p.done(reply.result) })
  const call = (method, params = {}, ms = 60000) => new Promise((done, fail) => { const id = ++next, timer = setTimeout(() => {pending.delete(id);fail(Error(`CDP deadline ${method}`))}, ms); pending.set(id,{done,fail,timer}); socket.send(JSON.stringify({id,method,params})) })
  const evaluate = async (body, ms = 60000) => { const reply = await call('Runtime.evaluate',{expression:`(async()=>{${body}})()`,awaitPromise:true,returnByValue:true}, ms); assert(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails)); return reply.result?.value }
  return {call,evaluate,close:()=>socket.close()}
}
function observeTransportProcess(pid) {
  assert(Number.isSafeInteger(pid)&&pid>0)
  const result=JSON.parse(powershell(`Get-Process -Id ${pid} | ForEach-Object { @{pid=$_.Id;birth=$_.StartTime.ToFileTimeUtc().ToString();executablePath=$_.Path} } | ConvertTo-Json -Compress`))
  assert.equal(result.pid,pid);return result
}
function transportExpected(row) {
  const identity=observeTransportProcess(row.ProcessId)
  assert(samePath(identity.executablePath,row.ExecutablePath))
  return {...identity,executableSha256:digest(readFileSync(identity.executablePath))}
}
async function finishTransport(requireHits=false) {
  const receipts={label:transportLabel,targets:{}}
  let failure
  for(const [label,hook]of transportHandles) {
    try {receipts.targets[label]=await hook.snapshot();keep(`transport-${label}-calls.json`,receipts.targets[label])}
    catch(error){failure??=error}
  }
  for(const [label,hook]of [...transportHandles].reverse()) {
    try{keep(`transport-${label}-restore.json`,await hook.detach())}
    catch(error){hook.close();failure??=error}
  }
  transportHandles.clear()
  keep('instrumented-transport-result.json',receipts)
  if(failure)throw failure
  if(requireHits) {
    const main=receipts.targets.main,service=receipts.targets.supervisor
    assert(main&&service,'both installed transport hooks required')
    for(const value of Object.values(receipts.targets)){assert.equal(value.label,transportLabel);assert.equal(value.active,true);assert.equal(value.denied.length,0)}
    assert(main.calls.some(c=>c.url.endsWith('/catalogue-v2.json')),'main did not read the custom catalogue')
    for(const wanted of Object.values(expected))assert(service.calls.some(c=>c.sha256===wanted.sha256&&c.size===wanted.bytes),'supervisor did not read each pinned archive through instrumented transport')
  }
  return receipts
}
async function launch(installed, version, port) {
  const started=Date.now()
  const fd = openSync(join(evidence, `app-${version}.log`), 'wx')
  const instrumented=version==='0.2.11'&&Boolean(transportFixture)
  if(instrumented){await assertUnusedInspectorPort(9356);keep('transport-main-port-preflight.json',{port:9356,unused:true})}
  const inspectorArgs=instrumented?[coldMainArgument(9356)]:[]
  const child = spawn(installed.exe, [...inspectorArgs,'--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { stdio:['ignore',fd,fd], env:appEnvironment }); closeSync(fd)
  let spawnFailure; child.on('error', error => {spawnFailure = error})
  running = {child, version, port, started}
  if(instrumented) {
    const row=await until(()=>ownProcesses().find(p=>p.ProcessId===child.pid),30000,'cold main native process')
    assert(samePath(row.ExecutablePath,installed.exe))
    const hook=await attachColdMain({execute:true,fixture:transportFixture,expected:transportExpected(row),observeProcess:observeTransportProcess,port:9356})
    transportHandles.set('main',hook);keep('transport-main-attach.json',hook.receipt)
  }
  const root = `http://127.0.0.1:${port}`
  const info = await until(async () => { if(spawnFailure) throw spawnFailure; try { const r = await fetch(`${root}/json/version`,{signal:AbortSignal.timeout(2000)});return r.ok ? r.json() : null } catch{return null} }, 180000, `${version} CDP`)
  running.browser = await connect(info.webSocketDebuggerUrl)
  const processInfo = await running.browser.call('SystemInfo.getProcessInfo'), pid = processInfo.processInfo.find(p=>p.type==='browser')?.id
  assert.equal(pid, child.pid, 'CDP belongs to installed process this driver spawned')
  const processRow = ownProcesses().find(p=>p.ProcessId===pid); assert(processRow); assert(samePath(processRow.ExecutablePath,installed.exe))
  const page = await until(async()=>{const response=await fetch(`${root}/json/list`,{signal:AbortSignal.timeout(2000)});return (await response.json()).find(p=>p.type==='page'&&p.url.endsWith('/index.html')&&p.webSocketDebuggerUrl)},120000,`${version} own window`)
  running.cdp = await connect(page.webSocketDebuggerUrl)
  const app = await until(async()=> {try{return await running.cdp.evaluate('return await window.api.getAppInfo()',10000)}catch{return null}},60000,`${version} app API`)
  assert.equal(app.version, version)
  if(version==='0.2.11') {assert.equal(app.build.commit, args['candidate-sha'], 'installed candidate must carry exact approved source commit');assert.equal(app.build.dirty,false)}
  keep(`running-${version}.json`,{app,process:processRow,devtools:info})
  return app
}
async function request(input, label) {
  const reply = await running.cdp.evaluate(`return await window.api.plugins.request(${JSON.stringify(input)})`,240000)
  keep(`${label}.json`,reply); return reply
}
async function screenshot(name) { if(running?.cdp) { try {const r=await running.cdp.call('Page.captureScreenshot',{format:'png'},10000);keep(name,Buffer.from(r.data,'base64'))}catch(error){summary.failures.push(`screenshot: ${error.message}`)} } }
function ownerRecord() { const path=join(pluginRoot,'supervisor','owner.json'); return existsSync(path)?readJson(path):null }
function publicOwner(owner) { if(!owner)return null; const {key,...safe}=owner; return safe }
function requiredPluginIds() {
  return appCompat&&['KNOWN-ISSUE','PARTIAL'].includes(summary.chromeCompatibility?.status)?['whatsapp']:['chrome','whatsapp']
}
function chromeAttemptEvidence(reply, card, attemptPaths) {
  const previous=new Set(readJson(join(evidence,'pre-upgrade-host-receipts.json')).map(r=>r.path))
  const receipts=hostReceipts().filter(r=>!previous.has(r.path)&&!attemptPaths.has(r.path)&&r.value.pluginId==='chrome'&&r.value.releaseDigest===publishedExpected.chrome.sha256)
  const stderr=[],logs=[]
  for(const diagnostic of [reply?.startupDiagnostic,reply?.diagnostic,card?.startupDiagnostic])if(typeof diagnostic?.stderr==='string')stderr.push(diagnostic.stderr)
  for(const receipt of receipts.filter(r=>r.path.endsWith('exit.json'))) {
    const path=join(dirname(receipt.path),'plugin-startup.log')
    if(!existsSync(path))continue
    const bytes=readFileSync(path);assert(bytes.length<=131072,'Chrome startup evidence exceeds bounded capture')
    const text=bytes.toString('utf8'),marker=`plugin=chrome run=${receipt.value.runId}\n`,at=text.indexOf(marker)
    logs.push({path,sha256:digest(bytes),bytes:bytes.length,text})
    if(at>=0){const output=text.slice(at+marker.length).trim();if(output)stderr.push(output)}
  }
  const result={reply,card,receipts,stderr,logs,serverClosed:receipts.some(r=>r.path.endsWith('exit.json')&&r.value.cause==='server-closed')}
  keep('candidate-chrome-compatibility-evidence.json',result);return result
}
function installedService(installed,label) {
  const resources=join(installed.folder,'resources'),owner=ownerRecord();assert.equal(owner?.phase,'accepting')
  const processes=ownProcesses(),launches=join(pluginRoot,'supervisor-launches'),matches=[]
  for(const directory of readdirSync(launches)) {
    const folder=join(launches,directory),readyPath=join(folder,'service.json'),configPath=join(folder,'launch.json')
    if(!existsSync(readyPath)||!existsSync(configPath))continue
    const ready=readJson(readyPath),configBytes=readFileSync(configPath),config=JSON.parse(configBytes),processRow=processes.find(p=>p.ProcessId===ready.pid)
    if(!processRow||!(processRow.CommandLine??'').toLowerCase().includes(configPath.toLowerCase()))continue
    assert.equal(processRow.ParentProcessId,running.child.pid,'installed app spawned this service')
    assert(birthMs(processRow)>=running.started-1000,'service birth predates installed app launch')
    assert.equal(ready.ready,true);assert(samePath(config.root,pluginRoot))
    const node=join(config.runtime.directory,'node.exe');assert(samePath(processRow.ExecutablePath,node))
    const runtime=readJson(join(resources,'plugin-node','runtime.json'));assert.equal(runtime.platform,'win32');assert.equal(runtime.arch,'x64')
    assert.equal(digest(readFileSync(node)),runtime.sha256);assert.equal(digest(readFileSync(join(resources,'plugin-node','node.exe'))),runtime.sha256)
    const scripts=[]
    for(const name of ['guardian.mjs','server.mjs','process-groups.mjs','receipts.mjs','boot-witness.mjs','windows-job.mjs','windows-job.ps1']) {
      const bytes=readFileSync(join(resources,'plugin-host',name));assert.deepEqual(readFileSync(join(config.runtime.directory,name)),bytes);scripts.push([name,digest(bytes)])
    }
    const license=readFileSync(join(resources,'plugin-node','LICENSE'));assert.deepEqual(readFileSync(join(config.runtime.directory,'LICENSE')),license);scripts.push(['LICENSE',digest(license)])
    assert.equal(digest(Buffer.from(JSON.stringify({profile:2,metadata:runtime,scripts}))),config.runtime.id)
    const entryHash=digest(readFileSync(join(resources,'plugin-supervisor','entry.cjs'))),entryPath=join(pluginRoot,'supervisor-entries',entryHash,'entry.cjs')
    assert.equal(digest(readFileSync(entryPath)),entryHash);assert((processRow.CommandLine??'').toLowerCase().includes(entryPath.toLowerCase()));assert((processRow.CommandLine??'').includes(digest(configBytes)))
    matches.push({service:ready,process:processRow,owner:publicOwner(owner),runtime,entrySha256:entryHash,runtimeId:config.runtime.id,hostScriptDigests:scripts,launchConfigSha256:digest(configBytes)})
  }
  assert.equal(matches.length,1,'exactly one living service must match installed resources and native launch arguments')
  keep(`${label}-installed-service.json`,matches[0]);return matches[0]
}
function liveHosts(service) {
  const processes=ownProcesses(),receipts=hostReceipts(),bound=[]
  const nativeBirth=pid=>{assert(Number.isSafeInteger(pid)&&pid>0);const value=powershell(`(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc().ToString()`).trim();assert.match(value,/^\d{1,20}$/);return value}
  const beforePaths=new Set(readJson(join(evidence,'pre-upgrade-host-receipts.json')).map(r=>r.path))
  for(const id of requiredPluginIds()) {
    const wanted=expected[id]
    const starts=receipts.filter(r=>r.path.endsWith('process.json')&&!beforePaths.has(r.path)&&r.value.pluginId===id)
    assert(starts.length>0,`${id} candidate host start receipt missing`)
    for(const receipt of starts) {
      assert.equal(receipt.value.releaseDigest,wanted.sha256)
      const guardian=processes.find(p=>p.ProcessId===receipt.value.guardianPid);assert(guardian,`${id} guardian absent during tool observation`)
      assert.equal(guardian.ParentProcessId,service.service.pid);assert(birthMs(guardian)>=birthMs(service.process))
      assert(samePath(guardian.ExecutablePath,service.process.ExecutablePath),'host guardian runs installed candidate Node')
      const guardianPath=join(dirname(service.process.ExecutablePath),'guardian.mjs');assert((guardian.CommandLine??'').toLowerCase().includes(guardianPath.toLowerCase()))
      assert((guardian.CommandLine??'').toLowerCase().includes(dirname(receipt.path).toLowerCase()))
      const config=readJson(join(dirname(receipt.path),'launch.json'));assert.equal(config.runId,receipt.value.runId);assert.equal(config.pluginId,id);assert.equal(config.releaseDigest,wanted.sha256)
      const manifest=readJson(join(evidence,`candidate-installed-${id}-plugin.json`)),entry=manifest.executor?.kind==='node'?manifest.executor.entry:manifest.server.entry
      assert(samePath(config.entry,join(pluginRoot,'host','packages',wanted.sha256,entry)))
      const packageFiles=manifest.files.map(file=>{const path=join(pluginRoot,'host','packages',wanted.sha256,file.path),stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink());const bytes=readFileSync(path);assert.equal(bytes.length,file.size);assert.equal(digest(bytes),file.sha256);return{path:file.path,sha256:file.sha256,bytes:file.size}})
      const job=readJson(join(dirname(receipt.path),'job-ready.json'));assert.equal(job.state,'assigned-ready');assert.equal(job.job.guardian.pid,guardian.ProcessId);assert.equal(job.job.guardian.birth,nativeBirth(guardian.ProcessId))
      assert(Array.isArray(receipt.value.groups)&&receipt.value.groups.length>0)
      const groups=receipt.value.groups.map(([pid,birth])=>{const row=processes.find(p=>p.ProcessId===pid);assert(row,`${id} server process ${pid} absent`);assert.equal(row.ParentProcessId,guardian.ProcessId);assert(birthMs(row)>=birthMs(guardian));assert(samePath(row.ExecutablePath,guardian.ExecutablePath));assert.equal(birth,nativeBirth(pid));assert((row.CommandLine??'').toLowerCase().includes(config.entry.toLowerCase()));assert((row.CommandLine??'').toLowerCase().includes('server.mjs'));return{pid,birth,process:row}})
      bound.push({id,path:receipt.path,receipt:receipt.value,guardian,groups,job,packageFiles,ownerEpoch:service.owner.epoch})
    }
  }
  keep('candidate-live-hosts.json',bound);return bound
}
async function quit(label) {
  assert(running)
  ownProcesses()
  const pid=running.child.pid
  const close = spawnSync('taskkill',['/PID',String(pid)],{windowsHide:true,encoding:'utf8',timeout:10000})
  keep(`${label}-quit-request.json`,{pid,status:close.status,stdout:close.stdout,stderr:close.stderr})
  await until(()=>ownProcesses().length===0,90000,`${label} app/service/host process exit`)
  const owner=ownerRecord(); assert.equal(owner?.phase,'stopped','installed service must certify stopped')
  keep(`${label}-owner-stopped.json`,publicOwner(owner))
  running.browser?.close();running.cdp?.close();running=null
}
function decode(path) { const bytes=readFileSync(path), envelope=JSON.parse(bytes); assert.equal(digest(Buffer.from(envelope.payload)),envelope.sha256);return {bytes, value:JSON.parse(envelope.payload)} }
function snapshot(label) {
  // Bind the activation referenced by the last resolved, sealed journal record, never filename "latest".
  const guard=join(pluginRoot,'state','lifecycle-guard'), names=readdirSync(guard).filter(n=>/^\d{8}\.json$/.test(n)).sort()
  let previous=null, activationRef=null, pending=false; const journal=[]
  names.forEach((name,index)=>{assert.equal(name,`${String(index).padStart(8,'0')}.json`);const {bytes,value}=decode(join(guard,name));const hash=digest(bytes);assert.equal(value.previous,previous);assert.equal(value.sequence,index);assert.equal(readFileSync(join(guard,`${name.slice(0,8)}-${hash}.seal`)).length,0);previous=hash;journal.push({name,sha256:hash,event:value.event});if(value.event.kind==='prepared')pending=true;if(['completed','aborted'].includes(value.event.kind)){activationRef=value.event.activation;pending=false}})
  assert.equal(pending,false);assert(activationRef)
  const {bytes,value:activation}=decode(join(pluginRoot,'state','activations',activationRef.name));assert.equal(digest(bytes),activationRef.sha256)
  const required=requiredPluginIds()
  assert(activation.entries.length>=required.length&&activation.entries.length<=2)
  assert(activation.entries.every(entry=>Object.hasOwn(expected,entry.pluginId)))
  const vault=[]
  for(const [id,wanted] of Object.entries(expected)) {
    const entry=activation.entries.find(e=>e.pluginId===id);if(!entry){assert(!required.includes(id));continue};assert.equal(entry.phase,'active');assert.equal(entry.release.version,wanted.version);assert.equal(entry.release.archiveSha256,wanted.sha256);assert.equal(entry.release.manifestSha256,wanted.manifest)
    const folder=join(pluginRoot,'package-vault',wanted.sha256),archive=readFileSync(join(folder,'archive')),catalogue=readFileSync(join(folder,'catalogue.json'))
    assert.equal(archive.length,wanted.bytes);assert.equal(digest(archive),wanted.sha256);assert.equal(readFileSync(join(folder,'catalogue.sha256'),'utf8'),digest(catalogue))
    const entries=JSON.parse(catalogue).entries,release=entries.find(e=>e.id===id);assert(release);assert.equal(release.manifestSha256,wanted.manifest);assert.equal(release.archive.sha256,wanted.sha256)
    const manifest=spawnSync('tar.exe',['-xOzf',join(folder,'archive'),'plugin.json'],{encoding:null,timeout:30000,maxBuffer:1048576});assert.ifError(manifest.error);assert.equal(manifest.status,0);assert.equal(digest(manifest.stdout),wanted.manifest)
    keep(`${label}-${id}-plugin.json`,manifest.stdout);keep(`${label}-${id}-catalogue.json`,catalogue)
    vault.push({id,archiveSha256:wanted.sha256,manifestSha256:wanted.manifest,bytes:archive.length})
  }
  const result={activationRef,activation,journal,vault};keep(`${label}-state.json`,result);return result
}
function hostReceipts() {
  const rows=[]
  function walk(path) {if(!existsSync(path))return;for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);assert(!entry.isSymbolicLink());if(entry.isDirectory())walk(file);else if(['process.json','exit.json'].includes(entry.name))rows.push({path:file,value:readJson(file)})}}
  walk(join(pluginRoot,'host'));return rows
}
async function helper(service) {
  const result=spawn(process.execPath,[join(evidence,'observer.cjs'),pluginRoot,join(evidence,'observer-workspace'),evidence,requiredPluginIds().length===1?'whatsapp-only':'both-plugins'],{cwd:source,env:process.env,stdio:['ignore','pipe','pipe']})
  let error,witnessError,witnessStarted=false;const chunks=[],errors=[]
  result.stdout.on('data',b=>{
    chunks.push(b)
    if(!witnessStarted&&Buffer.concat(chunks).toString('utf8').includes('WINDOWS_PLUGIN_UPGRADE_TOOLS_READY_V1')) {
      witnessStarted=true
      try {
        let witness
        try{summary.liveHosts=liveHosts(service);witness={passed:true,ownerEpoch:service.owner.epoch}}
        catch(error){witnessError=error;witness={passed:false,failure:error.stack??String(error)}}
        keep('observer-native-witness.tmp',witness)
        renameSync(join(evidence,'observer-native-witness.tmp'),join(evidence,'observer-native-witness.json'))
      } catch(error) {witnessError=error}
    }
  })
  result.stderr.on('data',b=>errors.push(b));result.on('error',e=>{error=e})
  const timer=setTimeout(()=>{result.kill();},240000)
  const status=await new Promise(resolve=>result.on('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer)
  keep('observer.stdout.log',Buffer.concat(chunks));keep('observer.stderr.log',Buffer.concat(errors));keep('observer-exit.json',{...status,error:error?.message})
  assert.ifError(error);assert.ifError(witnessError);assert(witnessStarted,'observer never reached tool witness boundary');assert.deepEqual(status,{code:0,signal:null});const receipt=readJson(join(evidence,'observer-result.json'));assert.equal(receipt.passed,true);return receipt
}
async function cleanup(label='cleanup', baseline=false) {
  if(!ownsFixture){keep(`${label}.json`,{skipped:true,reason:'fresh-runner precondition never established; no existing process or data touched'});return}
  const diagnostics=()=>{const found={};try{found.owner=publicOwner(ownerRecord())}catch(error){found.ownerError=String(error)}try{found.receipts=hostReceipts()}catch(error){found.receiptsError=String(error)}return found}
  const before=ownProcesses();keep(`${label}-before.json`,{...diagnostics(),processes:before})
  if(before.length) {
    // Failure-only containment. Re-read creation identity before stopping an owned process.
    for(const original of before) {const current=ownProcesses().find(p=>p.ProcessId===original.ProcessId&&p.CreationDate===original.CreationDate);if(current)spawnSync('taskkill',['/PID',String(current.ProcessId),'/T','/F'],{windowsHide:true,timeout:10000})}
    if(!baseline)summary.failures.push('forced cleanup was required; normal shutdown was not proved')
    await pause(3000)
  }
  running?.browser?.close();running?.cdp?.close()
  const after=ownProcesses();const receipt={forced:before.length>0,processes:after,...diagnostics()};keep(`${label}.json`,receipt)
  assert.equal(after.length,0,'owned processes remain')
  return receipt
}
function residualState(label) {
  const files=[]
  function walk(folder) {
    if(!existsSync(folder))return
    for(const entry of readdirSync(folder,{withFileTypes:true})) {
      const path=join(folder,entry.name)
      if(entry.isDirectory())walk(path)
      else if(entry.isFile()){const bytes=readFileSync(path);files.push({path:relative(pluginRoot,path),bytes:bytes.length,sha256:digest(bytes)})}
      else files.push({path:relative(pluginRoot,path),type:'non-file'})
    }
  }
  for(const name of ['state','package-vault'])walk(join(pluginRoot,name))
  files.sort((a,b)=>a.path.localeCompare(b.path));keep(`${label}.json`,files);return files
}
try {
  await phase('fresh runner and provenance',async()=>{
    assert(!existsSync(appRoot),'runner has existing BroCrew data');assert.equal(appsEntries().length,0,'runner has existing install')
    assert.equal(allProcesses().filter(p=>products.has(p.Name)).length,0,'runner has existing app processes')
    assert.equal(run('git',['-C',source,'rev-parse','HEAD']).trim(),args['candidate-sha'])
    const betaMetadata=readdirSync(inputs).filter(n=>n.endsWith('.json')).map(n=>join(inputs,n)).filter(p=>{try{return readJson(p).tag_name==='v0.1.36'}catch{return false}});assert.equal(betaMetadata.length,1,'exactly one beta release JSON in inputs')
    const candidatePath=join(resolve(args['candidate-dir']),'BroCrew-Setup-0.2.11-x64.exe'),candidateBytes=readFileSync(candidatePath)
    const observerSource=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'windows-plugin-upgrade-driver.ts'),'utf8').replaceAll('@SOURCE@',source.replaceAll('\\','/'))
    keep('observer.ts',observerSource)
    // Bundle observer/control clients only. No product build or native runtime is launched here.
    const desktopRequire=createRequire(join(source,'apps','desktop','package.json'))
    const viteRequire=createRequire(desktopRequire.resolve('vite/package.json'))
    const esbuild=viteRequire('esbuild')
    esbuild.buildSync({entryPoints:[join(evidence,'observer.ts')],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:join(evidence,'observer.cjs'),absWorkingDir:source})
    summary.inputs={beta:installer(join(inputs,'BroCrew-Setup-0.1.36-x64.exe'),betaMetadata[0],'0.1.36','856b87c2fd1306745a881f7e5e97591888695dbf9a15d784b477a85f8f35578f'),candidate:{path:candidatePath,sha256:digest(candidateBytes),bytes:candidateBytes.length,sourceSha:args['candidate-sha'],provenance:'exact-source build or operator-pinned artifact; see workflow intake'},sourceSha:args['candidate-sha'],driverSha256:digest(readFileSync(new URL(import.meta.url))),helperSha256:digest(readFileSync(join(evidence,'observer.cjs')))}
    const catalogue=await publicJson('https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json','public-catalogue-v2.json')
    for(const [id,wanted]of Object.entries(publishedExpected)) {
      const entry=catalogue.entries.find(e=>e.id===id);assert.equal(entry?.version,wanted.version)
      const target=entry.targets.find(t=>t.os==='win32'&&t.cpu==='x64');assert.equal(target?.sha256,wanted.sha256);assert.equal(target?.manifestSha256,wanted.manifest);assert.equal(target?.bytes,wanted.bytes)
      const release=await publicJson(`https://api.github.com/repos/brocrew/${wanted.repo}/releases/tags/v${wanted.version}`,`public-${id}-release.json`)
      assert.equal(release.draft,false);assert.equal(release.tag_name,`v${wanted.version}`)
      const asset=release.assets.find(a=>a.name===`${id}-win32-x64.tar.gz`);assert.equal(asset?.digest,`sha256:${wanted.sha256}`);assert.equal(asset?.size,wanted.bytes);assert.equal(asset?.browser_download_url,target.url)
      const inputArchive=readFileSync(join(inputs,asset.name));assert.equal(inputArchive.length,wanted.bytes);assert.equal(digest(inputArchive),wanted.sha256)
    }
    if(args['plugin-inputs']) {
      const custom=readCustomPluginInputs(resolve(args['plugin-inputs']),args['plugin-receipt-sha256'],catalogue,{runId:args['plugin-run-id'],artifact:args['plugin-artifact']})
      expected=custom.expected;summary.expected=expected;summary.customPlugins=custom.witness
      summary.transport='instrumented transport, not public delivery'
      keep('custom-plugin-input-witness.json',custom.witness)
      keep('transport-catalogue-v2.json',custom.catalogueBytes)
      const legacy=await publicJson('https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json','transport-catalogue-v1.json')
      const legacyBytes=readFileSync(join(evidence,'transport-catalogue-v1.json'))
      assert.equal(legacy.format,1)
      transportManifest={format:1,entries:[
        {url:'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json',path:join(evidence,'transport-catalogue-v2.json'),size:custom.catalogueBytes.length,sha256:digest(custom.catalogueBytes)},
        {url:'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json',path:join(evidence,'transport-catalogue-v1.json'),size:legacyBytes.length,sha256:digest(legacyBytes)},...custom.archives]}
      // Published unchanged plugins also travel through the same pinned fixture transport.
      for(const [id,wanted]of Object.entries(expected))if(!transportManifest.entries.some(e=>e.sha256===wanted.sha256)) {
        const entry=catalogue.entries.find(e=>e.id===id),target=entry.targets.find(t=>t.os==='win32'&&t.cpu==='x64')
        const path=join(inputs,`${id}-win32-x64.tar.gz`),bytes=readFileSync(path)
        assert.equal(bytes.length,wanted.bytes);assert.equal(digest(bytes),wanted.sha256)
        transportManifest.entries.push({url:target.url,path,size:bytes.length,sha256:wanted.sha256})
      }
      keep('instrumented-transport-manifest.json',transportManifest)
      transportFixture=readTransportFixture(join(evidence,'instrumented-transport-manifest.json'))
    } else summary.transport='public delivery'
    ownsFixture=true
  })
  let beta
  if(!cleanInstall) {
  beta=await phase('actual beta NSIS install',()=>install(summary.inputs.beta,'0.1.36'))
  await phase('beta Chrome installation failure baseline',async()=>{
    await launch(beta,'0.1.36',9345)
    assert.equal((await request({kind:'availability'},'beta-availability')).available,true)
    const listed=await request({kind:'list'},'beta-list');assert.equal(listed.ok,true)
    for(const [id,wanted]of [['chrome',publishedExpected.chrome]]) {
      const card=listed.cards.find(c=>c.id===id);assert(card);assert.equal(card.installed,false)
      let consent
      if(card.preparationRequired) {const prepared=await request({kind:'prepare',id,action:'install'},`beta-${id}-review`);assert.equal(prepared.ok,true);assert.equal(prepared.review.details.version,wanted.version);assert.equal(prepared.review.details.manifestSha256,wanted.manifest);assert.equal(prepared.review.details.digest,wanted.sha256);consent=prepared.review.consent}
      const installed=await request({kind:'install',id,...(consent?{consent}:{})},`beta-${id}-install`)
      summary.baseline={expectedFailure:true,reply:installed,cause:'unknown',hostReceipts:hostReceipts()}
      keep('beta-failure-baseline.json',summary.baseline)
      assert.equal(installed.ok,false,'this journey requires the observed failing beta installation baseline')
    }
    await screenshot('beta-failed-install.png')
    try{await quit('beta');summary.baseline.normalShutdown=true}
    catch(error){summary.baseline.normalShutdown=false;summary.baseline.quitFailure=error.stack??String(error);summary.baseline.cleanup=await cleanup('baseline-cleanup',true);running=null}
    keep('beta-failure-baseline.json',summary.baseline)
    summary.residualPreUpgrade=residualState('baseline-residual-state')
    keep('pre-upgrade-host-receipts.json',hostReceipts())
  })
  } else {
    keep('clean-install-control.json',{testPath:args['test-path'],betaInstalled:false,betaLaunched:false})
    keep('pre-upgrade-host-receipts.json',[])
  }
  const candidate=await phase(cleanInstall?'actual candidate clean NSIS install':'actual candidate NSIS upgrade',()=>install(summary.inputs.candidate,'0.2.11'))
  if(!cleanInstall) {
  assert(samePath(candidate.folder,beta.folder),'candidate replaced the registered beta install location')
  assert.deepEqual(residualState('after-installer-residual-state'),summary.residualPreUpgrade,'NSIS upgrade changed the retained beta plugin state before candidate launch')
  }
  await phase('installed candidate plugin tools',async()=>{
    await launch(candidate,'0.2.11',9346)
    assert.equal((await request({kind:'availability'},'candidate-availability')).available,true)
    if(transportFixture) {
      const service=installedService(candidate,'pre-install-transport'),expectedProcess=transportExpected(service.process)
      await transportHandles.get('main').activateSupervisorInspector(expectedProcess,observeTransportProcess)
      const hook=await attachSupervisor({execute:true,fixture:transportFixture,expected:expectedProcess,observeProcess:observeTransportProcess})
      transportHandles.set('supervisor',hook);keep('transport-supervisor-attach.json',hook.receipt)
    }
    if(appCompat)summary.compatibilityServiceBefore=installedService(candidate,'before-compatibility-attempt')
    for(const [id,wanted]of Object.entries(expected)) {
      const listed=await request({kind:'list'},`candidate-${id}-before-install`);assert.equal(listed.ok,true)
      const card=listed.cards.find(c=>c.id===id);assert(card)
      if(cleanInstall)assert.equal(card.installed,false,'clean candidate unexpectedly has an installed plugin')
      const attemptPaths=appCompat&&id==='chrome'?new Set(hostReceipts().map(r=>r.path)):null
      let installed
      if(card.installed) {
        assert.equal(card.installedVersion,wanted.version)
        installed=await request({kind:'retry',id},`candidate-${id}-retry-existing`)
      } else {
        let consent
        if(card.preparationRequired){const prepared=await request({kind:'prepare',id,action:'install'},`candidate-${id}-review`);assert.equal(prepared.ok,true);assert.equal(prepared.review.details.version,wanted.version);assert.equal(prepared.review.details.digest,wanted.sha256);assert.equal(prepared.review.details.manifestSha256,wanted.manifest);consent=prepared.review.consent}
        installed=await request({kind:'install',id,...(consent?{consent}:{})},`candidate-${id}-install`)
      }
      if(appCompat&&id==='chrome') {
        const current=await request({kind:'list'},'candidate-chrome-after-attempt');assert.equal(current.ok,true)
        const evidence=chromeAttemptEvidence(installed,current.cards.find(c=>c.id==='chrome'),attemptPaths)
        summary.chromeCompatibility=chromeCompatibilityResult({version:wanted.version,sha256:wanted.sha256,reply:installed,serverClosed:evidence.serverClosed,stderr:evidence.stderr})
        keep('candidate-chrome-compatibility-result.json',summary.chromeCompatibility)
        assert.notEqual(summary.chromeCompatibility.status,'FAIL',summary.chromeCompatibility.reason)
      } else assert.equal(installed.ok,true)
    }
    summary.candidateInstalled=snapshot('candidate-installed')
    const status=await request({kind:'list'},'candidate-list');assert.equal(status.ok,true)
    for(const id of requiredPluginIds()){const wanted=expected[id],card=status.cards.find(c=>c.id===id);assert.equal(card?.installed,true);assert.equal(card?.installedVersion,wanted.version);assert.notEqual(card?.state,'Unavailable')}
    summary.candidateService=installedService(candidate,'candidate')
    if(appCompat){assert.equal(summary.candidateService.owner.epoch,summary.compatibilityServiceBefore.owner.epoch,'service owner changed during compatibility attempt');assert.equal(summary.candidateService.service.pid,summary.compatibilityServiceBefore.service.pid,'service restarted during compatibility attempt')}
    summary.observer=await helper(summary.candidateService)
    assert.equal(summary.observer.ownerEpoch,summary.candidateService.owner.epoch)
    await screenshot('candidate-tools.png')
    const after=await request({kind:'status'},'candidate-after-tools');assert.equal(after.ok,true)
    if(transportFixture)summary.transportReceipts=await finishTransport(true)
    await quit('candidate')
    summary.finalState=snapshot('final');assert.deepEqual(summary.finalState.activation,summary.candidateInstalled.activation)
    const receipts=hostReceipts();keep('final-host-receipts.json',receipts)
    const prePaths=new Set(readJson(join(evidence,'pre-upgrade-host-receipts.json')).map(r=>r.path))
    const candidateProcesses=receipts.filter(r=>r.path.endsWith('process.json')&&!prePaths.has(r.path)),candidateExits=receipts.filter(r=>r.path.endsWith('exit.json')&&!prePaths.has(r.path))
    for(const id of requiredPluginIds()){const starts=candidateProcesses.filter(r=>r.value.pluginId===id);assert(starts.length>0,`${id} candidate process receipt missing`);for(const start of starts){assert.equal(start.value.releaseDigest,expected[id].sha256);const exit=candidateExits.find(r=>dirname(r.path)===dirname(start.path));assert.equal(exit?.value.exited,true,`${id} candidate host did not exit`);assert.equal(exit.value.releaseDigest,expected[id].sha256);assert.equal(exit.value.guardianPid,start.value.guardianPid);assert.equal(exit.value.runId,start.value.runId);assert.deepEqual(exit.value.groups,start.value.groups)}}
  })
} catch(error) {if(error.transportCleanup)keep('transport-partial-attach-cleanup.json',error.transportCleanup);summary.failures.push(error.stack??String(error));await screenshot('failure.png')}
finally {
  if(transportHandles.size)try{await finishTransport()}catch(error){summary.failures.push(`transport cleanup: ${error.stack??error}`)}
  try{await cleanup()}catch(error){summary.failures.push(`cleanup: ${error.stack??error}`)}
  if(transportFixture)try{for(const port of [9356,9229])await assertUnusedInspectorPort(port);keep('transport-ports-after-exit.json',{ports:[9356,9229],unused:true})}catch(error){summary.failures.push(`inspector port cleanup: ${error.stack??error}`)}
  // Preserve only synthetic fixture metadata and native receipts; never upload capabilities or plugin data.
  for(const name of ['plugin-startup.log'])if(ownsFixture&&existsSync(join(pluginRoot,name)))copyFileSync(join(pluginRoot,name),join(evidence,name))
  summary.finished=new Date().toISOString();const complete=summary.failures.length===0&&summary.phases.length===(cleanInstall?3:5)&&summary.phases.every(p=>p.passed)
  summary.verdict=!complete?'FAIL':summary.chromeCompatibility?.status==='PARTIAL'?'PARTIAL':summary.chromeCompatibility?.status==='KNOWN-ISSUE'?'APP-COMPAT-PASS-WITH-KNOWN-CHROME-ISSUE':'PASS'
  summary.passed=complete&&summary.verdict!=='PARTIAL'
  keep('summary.json',summary);console.log(JSON.stringify({passed:summary.passed,transport:summary.transport,verdict:summary.verdict,chrome:summary.chromeCompatibility,failures:summary.failures,evidence}));process.exitCode=summary.passed?0:summary.verdict==='PARTIAL'?2:1
}
