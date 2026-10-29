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
 if(size<2*1024*1024)gateAppend(file,JSON.stringify({role:${JSON.stringify(role)},pid:process.pid,at:Date.now(),event,...data})+'\\n',{mode:0o600});
 }catch{}
}
function gateError(error) {
 return error ? {name:error.name,message:error.message,stack:error.stack,code:error.code,
 kind:error.kind,status:error.status,cause:error.cause?gateError(error.cause):undefined} : null;
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
      'apps/desktop/src/main/plugins/supervisor/client.ts',
      (source) => {
        source = helper('attachment') + source
        for (const [from, to] of [
          ['    const deadline = setTimeout(() => finish(new NoReply()), OWNER_LIMITS.request)',
            "    const deadline = setTimeout(() => {gateLog('request-timeout',{kind:command.kind,requestMs:OWNER_LIMITS.request});finish(new NoReply())}, OWNER_LIMITS.request)"],
          ["    socket.on('error', () => finish(new NoReply()))",
            "    socket.on('error', error => {gateLog('socket-error',{kind:command.kind,error:gateError(error)});finish(new NoReply())})"],
          ['  static async attach(options: SupervisorClientOptions): Promise<PluginWorkspaceLease> {\n    let storage: SupervisorStorage | undefined',
            "  static async attach(options: SupervisorClientOptions): Promise<PluginWorkspaceLease> {\n    const gateStarted=performance.now();let gatePhase='workspace';\n    gateLog('attach-begin',{launchMs:OWNER_LAUNCH_MS,requestMs:OWNER_LIMITS.request});\n    let storage: SupervisorStorage | undefined"],
          ['      let record = storage.read()',
            "      gatePhase='record-read';let record = storage.read();gateLog('attach-record',{phase:record?.phase??null,elapsedMs:performance.now()-gateStarted})"],
          ['      storage = new SupervisorStorage(options.root, [workspace], !!options.launch)',
            "      gatePhase='storage';gateLog('attach-storage',{socketBytes:Buffer.byteLength(join(options.root,'supervisor','owner.sock')),socketLimit:100});\n      storage = new SupervisorStorage(options.root, [workspace], !!options.launch)"],
          ['        try {\n          await Promise.race([',
            "        gatePhase='launch';try {\n          await Promise.race(["],
          ["                () => reject(new PluginSupervisorError('unavailable')),",
            "                () => {gateLog('attach-launch-timeout',{launchMs:OWNER_LAUNCH_MS,elapsedMs:performance.now()-gateStarted});reject(new PluginSupervisorError('unavailable'))},"],
          ['        } catch {\n          // A simultaneous starter',
            "        } catch (error) {\n          gateLog('attach-launch-error',{error:gateError(error),elapsedMs:performance.now()-gateStarted});\n          // A simultaneous starter"],
          ["      if (!record || record.phase !== 'accepting')",
            "      gatePhase='record-after-launch';gateLog('attach-record-after-launch',{phase:record?.phase??null,elapsedMs:performance.now()-gateStarted});\n      if (!record || record.phase !== 'accepting')"],
          ['      const hello = Hello.parse(',
            "      gatePhase='hello';const hello = Hello.parse("],
          ['      return new PluginWorkspaceLease(storage, record, options, workspaceId, hello)',
            "      gateLog('attach-ready',{elapsedMs:performance.now()-gateStarted});\n      return new PluginWorkspaceLease(storage, record, options, workspaceId, hello)"],
          ['    } catch (error) {\n      storage?.close()',
            "    } catch (error) {\n      gateLog('attach-failed',{phase:gatePhase,error:gateError(error),elapsedMs:performance.now()-gateStarted});\n      storage?.close()"],
          ["      .catch(() => {\n        console.warn('[plugins] supervisor-start-failed')",
            "      .catch((error) => {\n        gateLog('supervisor-start-failed',{error:gateError(error),launchMs:OWNER_LAUNCH_MS,requestMs:OWNER_LIMITS.request});\n        console.warn('[plugins] supervisor-start-failed')"],
        ]) source = once(source, from, to)
        return source
      },
    )
    change(
      'apps/desktop/src/main/plugins/supervisor/launcher.ts',
      (source) => {
        source = helper('supervisor') + source
        for (const [from, to] of [
          ['    const storage = new SupervisorStorage(captured.root, captured.workspaceRoots, true)',
            "    const gateStarted=performance.now();gateLog('launch-begin',{launchMs:OWNER_LAUNCH_MS,readinessMs:OWNER_LAUNCH_MS-200});\n    const storage = new SupervisorStorage(captured.root, captured.workspaceRoots, true)"],
          ['      const runtime = await preparePluginNodeRuntime({',
            "      gateLog('launch-lifecycle-ready',{elapsedMs:performance.now()-gateStarted});\n      const runtime = await preparePluginNodeRuntime({"],
          ['      const { node } = await runtimeFiles(runtime)',
            "      gateLog('launch-runtime-ready',{elapsedMs:performance.now()-gateStarted});\n      const { node } = await runtimeFiles(runtime)"],
          ["      const child = spawn(node,", "      gateLog('launch-spawn-begin',{elapsedMs:performance.now()-gateStarted});\n      const child = spawn(node,"],
          ["stdio: 'ignore',", "stdio: ['ignore', 'ignore', 'pipe'],"],
          ['      let failed = false',
            "      gateChild(child, 'supervisor')\n      let gateReadError;let failed = false"],
          ['          if (ready.format === 1 && ready.ready === true && ready.pid === child.pid) return',
            "          if (ready.format === 1 && ready.ready === true && ready.pid === child.pid) {gateLog('launch-ready',{child:child.pid,elapsedMs:performance.now()-gateStarted});return}"],
          ['        } catch {\n          /* Missing private readiness',
            '        } catch (error) {\n          gateReadError=gateError(error);\n          /* Missing private readiness'],
          ["\n      throw new PluginSupervisorError('unavailable')\n    } finally {",
            "\n      gateLog('launch-readiness-failed',{child:child.pid,elapsedMs:performance.now()-gateStarted,failed,exitCode:child.exitCode,signal:child.signalCode,lastReadError:gateReadError});\n      throw new PluginSupervisorError('unavailable')\n    } finally {"],
          ["      .catch(() => {\n        throw new PluginSupervisorError('unavailable')",
            "      .catch((error) => {\n        gateLog('launcher-rejected',{error:gateError(error)});\n        throw new PluginSupervisorError('unavailable')"],
        ]) source = once(source, from, to)
        return source
      },
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
      (source) => {
        source = helper('owner') + source
        for (const [from, to] of [
          ['  const bytes = await sourceBytes(configPath, 1024 * 1024)',
            "  const gateStarted=performance.now();gateLog('owner-begin',{});\n  const bytes = await sourceBytes(configPath, 1024 * 1024)"],
          ['  const host = createPluginNodeHost({',
            "  gateLog('owner-started',{elapsedMs:performance.now()-gateStarted});\n  const host = createPluginNodeHost({"],
          ["  writeReceipt(receipts, 'service.json', { format: 1, ready: true, pid: process.pid })",
            "  writeReceipt(receipts, 'service.json', { format: 1, ready: true, pid: process.pid })\n  gateLog('owner-service-ready',{elapsedMs:performance.now()-gateStarted});"],
          ['    void bootstrap().catch(() => {\n      void stop()',
            "    void bootstrap().catch((error) => {\n      gateLog('lifecycle-bootstrap-failed',{error:gateError(error),elapsedMs:performance.now()-gateStarted});\n      void stop()"],
          ['.catch(() => {\n    process.exitCode = 1',
            ".catch((error) => {\n    gateLog('fatal', {error:gateError(error)})\n    process.exitCode = 1"],
        ]) source = once(source, from, to)
        return source
      },
    )
    change(
      'apps/desktop/src/main/plugins/production.ts',
      (source) => {
        source = helper('production') + source
        source = once(source,
          '            } catch (error) {\n              // List discovery',
          "            } catch (error) {\n              gateLog('catalogue-initialize-failed',{error:gateError(error)});\n              // List discovery")
        return once(source,
          '            } catch {\n              if (ended || connected !== connection) return fail()',
          "            } catch (error) {\n              gateLog('catalogue-refresh-failed',{error:gateError(error)});\n              if (ended || connected !== connection) return fail()")
      },
    )
    change(
      'apps/desktop/src/main/plugins/catalogue/repo-list.ts',
      (source) => once(helper('catalogue') + source,
        '        }).catch((error: unknown) => {',
        "        }).catch((error: unknown) => {\n          gateLog('catalogue-download-failed',{sourceVersion:options.sourceVersion??1,milliseconds:5000,error:gateError(error)});")
    )
    change(
      'apps/desktop/src/main/plugins/catalogue/download.ts',
      (source) => {
        source = helper('transport') + source
        for (const [from, to] of [
          ['  const abort = new AbortController(),',
            "  const gateStarted=performance.now(),gateCatalogue=catalogueUrl(options.url);\n  if(gateCatalogue)gateLog('catalogue-download-begin',{milliseconds:options.milliseconds??30000});\n  const abort = new AbortController(),"],
          ['      abort.abort()\n      reject(new PluginDownloadError',
            "      if(gateCatalogue)gateLog('catalogue-download-timeout',{elapsedMs:performance.now()-gateStarted});\n      abort.abort()\n      reject(new PluginDownloadError"],
          ['      if ([301, 302, 303, 307, 308].includes(response.status)) {',
            "      if(gateCatalogue)gateLog('catalogue-response',{status:response.status,hops,elapsedMs:performance.now()-gateStarted});\n      if ([301, 302, 303, 307, 308].includes(response.status)) {"],
          ['  } catch (error) {\n    if (error instanceof PluginDownloadError)',
            "  } catch (error) {\n    if(gateCatalogue)gateLog('catalogue-transport-failed',{elapsedMs:performance.now()-gateStarted,error:gateError(error)});\n    if (error instanceof PluginDownloadError)"],
        ]) source = once(source, from, to)
        return source
      },
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
