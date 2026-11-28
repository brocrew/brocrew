import fs from 'node:fs'
import path from 'node:path'
import { once, readFile } from './contract.mjs'

// Only the disposable projected package pipes child diagnostics. Release sources stay unchanged.
export function projectDiagnostics(repo, root) {
  const originals = new Map()
  const helper = (role) => `
import {appendFileSync as gateAppend,statSync as gateStat} from 'node:fs';
function gateLog(event, data) {
 try { const file=${JSON.stringify(path.join(root, 'plugin-process.jsonl'))};
 let size=0;try{size=gateStat(file).size}catch{}
 if(size<2*1024*1024)gateAppend(file,JSON.stringify({role:${JSON.stringify(role)},pid:process.pid,event,...data})+'\\n',{mode:0o600});
 }catch{}
}
process.on('uncaughtExceptionMonitor',error=>gateLog('uncaught',{error:error.stack??String(error)}));
function gateChild(child, plugin) {
 gateLog('spawn',{child:child.pid,plugin});
 child.stderr?.on('data',chunk=>gateLog('stderr',{child:child.pid,plugin,text:String(chunk).slice(-65536)}));
 child.on('error',error=>gateLog('error',{child:child.pid,plugin,error:error.stack??String(error)}));
 child.on('exit',(code,signal)=>gateLog('exit',{child:child.pid,plugin,code,signal}));
}
`
  const change = (relative, transform) => {
    const file = path.join(repo, relative)
    const original = fs.readFileSync(file, 'utf8')
    const changed = transform(original)
    originals.set(file, original)
    fs.writeFileSync(file, changed)
  }
  try {
    change(
      'apps/desktop/src/main/plugins/supervisor/launcher.ts',
      (source) =>
        helper('supervisor') +
        once(
          source.includes("stdio: 'ignore',")
            ? once(source, "stdio: 'ignore',", "stdio: ['ignore', 'ignore', 'pipe'],")
            : source,
          '      let failed = false',
          "      gateChild(child, 'supervisor')\n      let failed = false",
        ),
    )
    // Sources since the 0.2 plugin startup errors pipe the forked child's stderr themselves.
    const ignoredIpc = "stdio: ['ignore', 'ignore', 'ignore', 'ipc'],"
    const pipeIpcStderr = (source) =>
      source.includes(ignoredIpc)
        ? once(source, ignoredIpc, "stdio: ['ignore', 'ignore', 'pipe', 'ipc'],")
        : source
    change(
      'apps/desktop/src/main/plugins/node-host.ts',
      (source) =>
        helper('guardian') +
        once(
          pipeIpcStderr(source),
          '    const ready = deferred<PluginNodeReady>(),',
          '    gateChild(child, manifest.id)\n    const ready = deferred<PluginNodeReady>(),',
        ),
    )
    change(
      'apps/desktop/resources/plugin-host/guardian.mjs',
      (source) =>
        helper('plugin') +
        once(
          pipeIpcStderr(source),
          "  child.on('message', (message) => {",
          "  gateChild(child, config.pluginId)\n  child.on('message', (message) => {",
        ),
    )
    // Gate-only timing of each plugin view: load events, its renderer, asset requests, teardown.
    // Diagnostic only (card 621), never for landing.
    change('apps/desktop/src/main/plugins/ui/host.ts', (source) => {
      const id = 'options.verified.manifest.id'
      const viewLog = `const gateViewStart=performance.now();const gateView=(event,data={})=>gateLog('view-'+event,{plugin:${id},ms:Math.round(performance.now()-gateViewStart),wall:new Date().toISOString(),...data});`
      const watch = `gateView('created');for(const gateEvent of ['did-start-loading','did-start-navigation','did-navigate','dom-ready','did-finish-load','did-fail-load','did-stop-loading','render-process-gone','unresponsive','responsive','destroyed'])contents.on(gateEvent,(...gateArgs)=>{let pid=null;try{pid=contents.getOSProcessId()}catch{}gateView(gateEvent,{pid,detail:gateEvent==='did-fail-load'?String(gateArgs[1])+' '+String(gateArgs[2]):gateEvent==='did-start-navigation'?String(gateArgs[0]?.url??gateArgs[0]):undefined})});isolated.webRequest.onCompleted((d)=>gateView('request-completed',{url:d.url,status:d.statusCode,type:d.resourceType}));isolated.webRequest.onErrorOccurred((d)=>gateView('request-error',{url:d.url,error:d.error,type:d.resourceType}));`
      // A plain sandboxed page in the default session, started once a load passes 10 s.
      const probe = `const gateProbe=()=>{const t=performance.now();const probe=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});const pc=probe.webContents;const log=(e)=>{let pid=0;try{pid=pc.getOSProcessId()}catch{}gateView('probe-'+e,{probeMs:Math.round(performance.now()-t),pid})};for(const e of ['did-start-loading','did-navigate','dom-ready','did-finish-load','did-fail-load','render-process-gone'])pc.on(e,()=>log(e));const every=setInterval(()=>log('sample'),1000);setTimeout(()=>{clearInterval(every);log('end');try{pc.close()}catch{}},50000);void pc.loadURL('data:text/html,<p>probe</p>').catch(()=>{})};`
      // How long the OS takes to start and end a trivial process, and the stuck renderer's state.
      const spawnTime = `const gateSpawn=(label,file,args)=>{const t=performance.now();gateExec(file,args,{windowsHide:true,timeout:120000},(error,stdout)=>gateView('spawn-'+label,{spawnMs:Math.round(performance.now()-t),error:error?String(error.code??error.message):null,out:String(stdout??'').trim().slice(0,300)}))};`
      const sample = `let gateProbed=false,gateTick=0;const gateSampler=setInterval(()=>{gateTick++;let pid=0;try{pid=contents.getOSProcessId()}catch{}const all=app.getAppMetrics();const m=all.find((row)=>row.pid===pid);const ms=Math.round(performance.now()-gateViewStart);gateView('load-sample',{pid,loading:(()=>{try{return contents.isLoading()}catch{return null}})(),created:m?.creationTime??null,cpu:m?.cpu?.percentCPUUsage??null,type:m?.type??null,processes:all.map((row)=>row.type+':'+row.pid+':'+Math.round(row.cpu.percentCPUUsage)).join(' ')});if(gateTick%4===0)gateSpawn('cmd','cmd.exe',['/c','exit 0']);if(pid>0&&(gateTick===10||gateTick===40))gateSpawn('renderer-state','powershell.exe',['-NoProfile','-NonInteractive','-Command','$p=Get-Process -Id '+pid+' -ErrorAction SilentlyContinue; if($p){"cpu=$($p.CPU) threads=$($p.Threads.Count) handles=$($p.HandleCount) responding=$($p.Responding) start=$($p.StartTime.ToString(\"o\"))"}else{"gone"}']);if(!gateProbed&&ms>10000){gateProbed=true;gateProbe()}},500);`
      let out = once(
        source,
        '  const contents = view.webContents\n',
        `  const contents = view.webContents\n  ${viewLog}${watch}${probe}${spawnTime}\n`,
      )
      out = once(
        out,
        '    void destroyed.then(async (confirmed) => {\n',
        "    void destroyed.then(async (confirmed) => {\n      gateView('teardown-start',{confirmed})\n",
      )
      out = once(
        out,
        '      if (\n        confirmed &&\n',
        "      gateView('teardown-end',{cleared:cleared.map((c)=>c.status)})\n      if (\n        confirmed &&\n",
      )
      out = once(out, '    await Promise.race([\n', `    gateView('load-start');${sample}\n    await Promise.race([\n`)
      out = once(
        out,
        '    ]).finally(() => {\n',
        "    ]).finally(() => {\n      clearInterval(gateSampler);gateView('load-end')\n",
      )
      out = once(
        out,
        "import { session, WebContentsView } from 'electron'\n",
        "import { app, session, WebContentsView } from 'electron'\nimport { execFile as gateExec } from 'node:child_process'\n",
      )
      return helper('view-host') + out
    })
    // Card 621 diagnostic 5 only, never for landing: time every Codex process-table read; arm
    // `held` also holds every Codex tree ending until the app's first window has loaded.
    if (process.env.PLUGIN_DIAG_ARM) {
      const arm = process.env.PLUGIN_DIAG_ARM
      if (!['shared', 'held'].includes(arm)) throw new Error('Unknown diagnostic arm')
      change('packages/runtime/src/codex/windows-tree.ts', (source) => {
        let out = once(
          source,
          '  return new Promise((resolve) => {\n    execFile(\n',
          "  const gateReadStart = performance.now(), gateReadWall = new Date().toISOString()\n  return new Promise((resolve) => {\n    execFile(\n",
        )
        out = once(
          out,
          '      (error, stdout) => resolve(error ? null : parseReading(stdout)),\n',
          "      (error, stdout) => {\n        gateLog('codex-table-read', { arm: " +
            JSON.stringify(arm) +
            ", startedAt: gateReadWall, ms: Math.round(performance.now() - gateReadStart), limitMs: ms, error: error ? String(error.code ?? error.killed ?? error.message) : null, rows: String(stdout ?? '').split('\\n').length - 1 })\n        resolve(error ? null : parseReading(stdout))\n      },\n",
        )
        const hold =
          arm === 'held'
            ? "  const gateHeldFrom = performance.now()\n  while (!(globalThis as { __gateFirstWindowReady?: boolean }).__gateFirstWindowReady) await new Promise((resolve) => setTimeout(resolve, 100))\n  gateLog('codex-ending-held', { heldMs: Math.round(performance.now() - gateHeldFrom), wall: new Date().toISOString() })\n"
            : "  gateLog('codex-ending-start', { wall: new Date().toISOString() })\n"
        out = once(
          out,
          'export async function endTree(t: TreeEnding): Promise<boolean> {\n',
          'export async function endTree(t: TreeEnding): Promise<boolean> {\n' + hold,
        )
        return helper('codex-tree') + out
      })
      change('apps/desktop/src/main/index.ts', (source) =>
        once(
          source,
          "  window.webContents.once('did-finish-load', () => signalFirstWindowLoad())\n",
          "  window.webContents.once('did-finish-load', () => {\n    ;(globalThis as { __gateFirstWindowReady?: boolean }).__gateFirstWindowReady = true\n    signalFirstWindowLoad()\n  })\n",
        ),
      )
    }
    change('apps/desktop/src/main/plugins/supervisor/entry.ts', (source) => {
      const modern =
        'void runPluginSupervisor(process.argv[2]!, process.argv[3]!).catch((error) => {'
      return (
        helper('owner') +
        (source.includes(modern)
          ? once(
              source,
              modern,
              modern + "\n    gateLog('fatal', {error: error?.stack ?? String(error)})",
            )
          : once(
              source,
              '.catch(() => {\n    process.exitCode = 1',
              ".catch((error) => {\n    gateLog('fatal', {error: error?.stack ?? String(error)})\n    process.exitCode = 1",
            ))
      )
    })
  } catch (error) {
    for (const [file, original] of originals) fs.writeFileSync(file, original)
    throw error
  }
  return {
    restore() {
      for (const [file, original] of originals) fs.writeFileSync(file, original)
    },
  }
}

export function printPluginDiagnostics(root, records) {
  for (const record of records) {
    if (!record.cdp) continue
    const tails = record.tails()
    console.error('App main stdout tail:', tails.stdout)
    console.error('App main stderr tail:', tails.stderr)
  }
  try {
    console.error(
      'Plugin process stderr and exit log tail:',
      readFile(path.join(root, 'plugin-process.jsonl'), 3 * 1024 * 1024)
        .toString()
        .slice(-256 * 1024),
    )
  } catch (error) {
    console.error('Plugin process log unavailable:', error.message)
  }
}
