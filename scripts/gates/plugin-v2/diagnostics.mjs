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
          once(source, "stdio: 'ignore',", "stdio: ['ignore', 'ignore', 'pipe'],"),
          '      let failed = false',
          "      gateChild(child, 'supervisor')\n      let failed = false",
        ),
    )
    change(
      'apps/desktop/src/main/plugins/node-host.ts',
      (source) =>
        helper('guardian') +
        once(
          once(
            source,
            "stdio: ['ignore', 'ignore', 'ignore', 'ipc'],",
            "stdio: ['ignore', 'ignore', 'pipe', 'ipc'],",
          ),
          '    const ready = deferred<PluginNodeReady>(),',
          '    gateChild(child, manifest.id)\n    const ready = deferred<PluginNodeReady>(),',
        ),
    )
    change(
      'apps/desktop/resources/plugin-host/guardian.mjs',
      (source) =>
        helper('plugin') +
        once(
          once(
            source,
            "stdio: ['ignore', 'ignore', 'ignore', 'ipc'],",
            "stdio: ['ignore', 'ignore', 'pipe', 'ipc'],",
          ),
          "  child.on('message', (message) => {",
          "  gateChild(child, config.pluginId)\n  child.on('message', (message) => {",
        ),
    )
    change(
      'apps/desktop/src/main/plugins/supervisor/entry.ts',
      (source) =>
        helper('owner') +
        once(
          source,
          '.catch(() => {\n    process.exitCode = 1',
          ".catch((error) => {\n    gateLog('fatal', {error: error?.stack ?? String(error)})\n    process.exitCode = 1",
        ),
    )
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
