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
    change('apps/desktop/src/main/plugins/ui/host.ts', (source) => {
      const id = 'options.verified.manifest.id'
      const viewLog = `const gateViewStart=performance.now();const gateView=(event,data={})=>gateLog('view-'+event,{plugin:${id},ms:Math.round(performance.now()-gateViewStart),wall:new Date().toISOString(),...data});`
      const watch = `gateView('created');for(const gateEvent of ['did-start-loading','did-start-navigation','did-navigate','dom-ready','did-finish-load','did-fail-load','did-stop-loading','render-process-gone','unresponsive','responsive','destroyed'])contents.on(gateEvent,(...gateArgs)=>{let pid=null;try{pid=contents.getOSProcessId()}catch{}gateView(gateEvent,{pid,detail:gateEvent==='did-fail-load'?String(gateArgs[1])+' '+String(gateArgs[2]):gateEvent==='did-start-navigation'?String(gateArgs[0]?.url??gateArgs[0]):undefined})});isolated.webRequest.onCompleted((d)=>gateView('request-completed',{url:d.url,status:d.statusCode,type:d.resourceType}));isolated.webRequest.onErrorOccurred((d)=>gateView('request-error',{url:d.url,error:d.error,type:d.resourceType}));`
      let out = once(
        source,
        '  const contents = view.webContents\n',
        `  const contents = view.webContents\n  ${viewLog}${watch}\n`,
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
      out = once(
        out,
        '    await Promise.race([\n',
        "    gateView('load-start')\n    await Promise.race([\n",
      )
      return helper('view-host') + out
    })
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
