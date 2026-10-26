import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
export const GATE_BUILD_MARKER = 'packaged-plugin-gate-only'
export function assertNormalPluginBuild(config, entry, devSource) {
  if (
    [config, entry].some(
      (text) =>
        text.includes(GATE_BUILD_MARKER) ||
        text.includes('preparePackagedGateHome') ||
        text.includes('plugin-packaged/provider-fixture.mjs') ||
        /(?:renewClaudeLogin|loginRenewal)\s*:\s*undefined/.test(text),
    ) ||
    !/PLUGIN_LOCAL_RELEASE_ENABLED:\s*boolean\s*=\s*false/.test(config) ||
    (devSource !== undefined &&
      (!/if \(!options \|\| options\.isPackaged !== false\) return undefined/.test(devSource) ||
        !/devSource: !app\.isPackaged\s*\? \{ isPackaged: app\.isPackaged, appData: app\.getPath\('appData'\) \}\s*: undefined/.test(
          entry,
        )))
  )
    throw new Error('Refusing to package private plugin gate inputs in a normal build')
}
export function checkNormalPluginBuild(root) {
  // A restored index cannot make a previously projected owner/main output ordinary.
  for (const name of [
    'apps/desktop/src/main/plugins/catalogue/v2-gate-fetch.ts',
    'apps/desktop/src/main/plugins/catalogue/download.ts',
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/preload/index.ts',
    'apps/desktop/electron.vite.config.ts',
    'scripts/gates/plugin-reload/main-app-controller.mjs',
    'scripts/gates/plugin-reload/controlled-sdk.mjs',
    'apps/desktop/out/preload/index.js',
    'apps/desktop/out/main/index.js',
    'apps/desktop/resources/plugin-supervisor/entry.cjs',
  ]) {
    const file = path.join(root, name)
    if (
      fs.existsSync(file) &&
      (name.endsWith('v2-gate-fetch.ts') ||
        [
          'plugin-v2-review-gate-only',
          'plugin-reload-main-app-gate-only',
          '__pluginReloadGate',
          'packaged-plugin-gate-only:reload-v1',
        ].some((marker) => fs.readFileSync(file, 'utf8').includes(marker)))
    )
      throw new Error('Refusing synthetic v2 plugin source or output in a normal build')
  }
  assertNormalPluginBuild(
    fs.readFileSync(
      path.join(root, 'apps/desktop/src/main/plugins/catalogue/build-config.ts'),
      'utf8',
    ),
    fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8'),
    fs.readFileSync(
      path.join(root, 'apps/desktop/src/main/plugins/catalogue/dev-source.ts'),
      'utf8',
    ),
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkNormalPluginBuild(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  } catch {
    console.error('Refusing to package private plugin gate inputs in a normal build')
    process.exitCode = 1
  }
}
