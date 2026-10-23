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
