// Source-only composition; no module is imported or app launched by this file.
import fs from 'node:fs'
import path from 'node:path'
import { projectBuild } from '../plugin-packaged/contract.mjs'
import { demand, once, hash, readFile, below } from './contract.mjs'
import { authorizeReloadRequest } from './reload-authorize.mjs'

export const RELOAD_MARKER = 'plugin-reload-main-app-gate-only'
export const RELOAD_CHANNEL = 'plugin-v2-reload-gate'
const names = ['contract.mjs', 'controlled-sdk.mjs', 'fixture.mjs', 'main-app-controller.mjs']

export function projectReload(repo, { root, token, appData, browser, modules }) {
  demand(fs.realpathSync.native(root) === root && below(root, repo) && /^[a-f0-9]{64}$/.test(token))
  // The module manifest is separately frozen/reviewed; nulls cannot produce a package.
  demand(Array.isArray(modules) && modules.length === names.length)
  demand(new Set(modules.map((m) => m.name)).size === names.length)
  const contents = new Map()
  for (const m of modules) {
    demand(names.includes(m.name) && path.isAbsolute(m.source) && /^[a-f0-9]{64}$/.test(m.sha256))
    const bytes = readFile(m.source, 1024 * 1024)
    demand(bytes.length === m.bytes && hash(bytes) === m.sha256)
    contents.set(m.name, bytes)
  }
  const mainPath = path.join(repo, 'apps/desktop/src/main/index.ts')
  const preloadPath = path.join(repo, 'apps/desktop/src/preload/index.ts')
  const vitePath = path.join(repo, 'apps/desktop/electron.vite.config.ts')
  const originals = new Map(
    [mainPath, preloadPath, vitePath].map((p) => [p, readFile(p).toString()]),
  )
  const destination = path.join(repo, 'scripts/gates/plugin-reload')
  demand(!fs.existsSync(destination))
  const projected = projectBuild(
    readFile(path.join(repo, 'apps/desktop/src/main/plugins/catalogue/build-config.ts')).toString(),
    originals.get(mainPath),
    appData,
    browser,
  )
  let entry = projected.entry
  const provider = path.join(
    path.dirname(appData),
    'repo/scripts/gates/plugin-packaged/provider-fixture.mjs',
  )
  // projectBuild assumes a repo sibling; this dedicated clone binds its actual path explicitly.
  entry = once(
    entry,
    JSON.stringify(provider),
    JSON.stringify(
      path.join(repo, 'scripts/gates/plugin-packaged/provider-fixture.mjs').replaceAll('\\', '/'),
    ),
  )
  entry = once(
    entry,
    `            /* packaged-plugin-gate-only */ fixtureSource: ${JSON.stringify(path.join(appData, 'repo-fixture'))},\n`,
    '',
  )
  entry = once(
    entry,
    `/* packaged-plugin-gate-only */ new PackagedGateRuntime(provider, ${JSON.stringify(path.dirname(appData))})`,
    `(provider === 'claude' ? createReloadGateRuntime({ownedRoot:${JSON.stringify(root)}}) : (()=>{throw new Error('Reload gate is Claude only')})())`,
  )
  entry = once(
    entry,
    "import { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'",
    `// ${RELOAD_MARKER}\nimport * as reloadGateFs from 'node:fs';\nimport {createReloadGateRuntime,bindReloadGateHost,reloadGateCommand} from ${JSON.stringify(path.join(destination, 'main-app-controller.mjs').replaceAll('\\', '/'))};\nimport { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'`,
  )
  entry = once(
    entry,
    'let host: RuntimeHost | null = null',
    `// ${RELOAD_MARKER}\nlet reloadGateWindow: BrowserWindow | null = null;\nconst reloadGateNonce=${JSON.stringify(token)};\nlet host: RuntimeHost | null = null`,
  )
  entry = once(
    entry,
    'function registerIpc(runtimeHost: RuntimeHost, localZone: () => LocalZone | null): void {',
    `function registerIpc(runtimeHost: RuntimeHost, localZone: () => LocalZone | null): void {\n  // ${RELOAD_MARKER}\n  bindReloadGateHost(runtimeHost);\n  const authorizeReloadRequest=${authorizeReloadRequest.toString()};\n  pluginIpcMain.handle(${JSON.stringify(RELOAD_CHANNEL)}, (event,payload:unknown)=>reloadGateCommand(authorizeReloadRequest(event,reloadGateWindow,payload,reloadGateNonce)));`,
  )
  entry = once(
    entry,
    '  if (presentation.hidden) keepOutOfSight(window)',
    `  // ${RELOAD_MARKER}\n  if(reloadGateWindow!==null)throw new Error('Reload gate requires one main window');\n  reloadGateWindow=window;\n  if (presentation.hidden) keepOutOfSight(window)`,
  )
  entry = once(
    entry,
    '    db?.close()\n    db = null',
    `    const reloadHeldDb=db;\n    db?.close()\n    if(!reloadHeldDb)throw new Error('${RELOAD_MARKER}');\n    reloadGateFs.writeFileSync(${JSON.stringify(path.join(root, 'reload-native-db-closed.json'))},JSON.stringify({schema:1,closed:true,token:reloadGateNonce}),{flag:'wx',mode:0o600});\n    db = null`,
  )
  demand(!entry.includes('fixtureSource:'))
  const preload =
    originals.get(preloadPath) +
    `\n// ${RELOAD_MARKER}\nif(process.isMainFrame)contextBridge.exposeInMainWorld('__pluginReloadGate',Object.freeze({\n command:(op:unknown,token:unknown)=>ipcRenderer.invoke(${JSON.stringify(RELOAD_CHANNEL)},{op,token})\n}));\n`
  let vite = once(
    originals.get(vitePath),
    "const workspacePackages = ['@brobot2/shared', '@brobot2/runtime', '@brobot2/orchestration']",
    `// ${RELOAD_MARKER}\nconst workspacePackages = ['@brobot2/shared', '@brobot2/runtime', '@brobot2/orchestration','@anthropic-ai/claude-agent-sdk']`,
  )
  vite = once(
    vite,
    '    main: {',
    `    main: {\n      // ${RELOAD_MARKER}: keep the controlled SDK witness in the bound main entry.\n      build:{rollupOptions:{output:{inlineDynamicImports:true}}},\n      resolve:{alias:{'@anthropic-ai/claude-agent-sdk':resolve(__dirname,'../../scripts/gates/plugin-reload/controlled-sdk.mjs')}},`,
  )
  fs.mkdirSync(destination, { mode: 0o700 })
  const created = []
  const removeModules = () => {
    for (const name of created) {
      const file = path.join(destination, name)
      demand(hash(readFile(file)) === hash(contents.get(name)))
      fs.unlinkSync(file)
    }
    // Refuse unknown additions; never recursively delete the source/evidence root.
    fs.rmdirSync(destination)
  }
  try {
    for (const [name, bytes] of contents) {
      fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 })
      created.push(name)
    }
    fs.writeFileSync(mainPath, entry)
    fs.writeFileSync(preloadPath, preload)
    fs.writeFileSync(vitePath, vite)
  } catch (error) {
    for (const [file, bytes] of originals) fs.writeFileSync(file, bytes)
    removeModules()
    throw error
  }
  return {
    marker: RELOAD_MARKER,
    modulePins: modules.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    restore() {
      for (const [file, bytes] of originals) fs.writeFileSync(file, bytes)
      removeModules()
      for (const [file, bytes] of originals) demand(readFile(file).toString() === bytes)
    },
  }
}
