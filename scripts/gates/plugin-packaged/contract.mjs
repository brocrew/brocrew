import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { safeFailure, safeAppStderr } from './diagnostics.mjs'
import { safeMatrix, safeSelection, safeMatrixDrains, safeMatrixPageStates } from './matrix.mjs'
import { safePageState } from './page-state.mjs'
import { safeProviderState } from './provider-state.mjs'
import { safePluginState } from './plugin-state.mjs'
import { GATE_BUILD_MARKER, assertNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'

export const checks = [
  'packagedArm64',
  'bundledNode',
  'bundledSupervisor',
  'pluginsTab',
  'installed',
  'profileCreated',
  'profileEnabled',
  'restartRetained',
  'concurrentWorkspaces',
  'reinstallRetained',
  'tamperedArchiveRefused',
  'foreignUrlRefused',
  'fakeBrowserOnly',
  'drawsWindow',
  'agentBrowserAction',
  'liveTabs',
]
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const report = () => ({
  passed: false,
  checks: Object.fromEntries(checks.map((k) => [k, false])),
  counts: {},
  cleanup: { drained: false, boundary: 'hosted-vm-teardown' },
  coverage: { agentBrowserActions: false, liveTabs: false, providerCredentialAudit: false },
})
export function finish(summary) {
  summary.passed =
    checks.every((key) => summary.checks[key] === true) &&
    summary.coverage?.agentBrowserActions === true &&
    summary.coverage?.liveTabs === true &&
    summary.coverage?.providerCredentialAudit === false &&
    !(summary.counts.failed > 0) &&
    summary.failure === undefined &&
    safeCleanup(summary.cleanup)
  return summary
}
export function requireCheck(summary, key, value) {
  if (!checks.includes(key) || value !== true) throw new Error('Gate assertion failed')
  summary.checks[key] = true
}
export function safeCleanup(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'boundary,drained' &&
    typeof value.drained === 'boolean' &&
    value.boundary === 'hosted-vm-teardown'
  )
}
export function safeReport(value) {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    Object.entries(value).every(([key, one]) =>
      key === 'providerState'
        ? safeProviderState(one)
        : key === 'pageState'
          ? safePageState(one)
          : key === 'pluginState'
            ? safePluginState(one)
            : key === 'matrixPageStates'
              ? safeMatrixPageStates(one)
              : key === 'probeMatrix'
                ? safeMatrix(one)
                : key === 'matrixDrains'
                  ? safeMatrixDrains(one)
                  : key === 'launchSelection'
                    ? safeSelection(one)
                    : ['failure', 'drainFailure'].includes(key)
                      ? safeFailure(one)
                      : key === 'appStderr'
                        ? safeAppStderr(one)
                        : key === 'cleanup'
                          ? safeCleanup(one)
                          : safeReport(one),
    )
  )
}
/** The private repositories whose hosted runners may run the gate; each workflow also requires private. */
export const GATE_REPOSITORIES = ['brocrew/brocrew']
export function requireCI(env = process.env, platform = process.platform, arch = process.arch) {
  if (
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !GATE_REPOSITORIES.includes(env.GITHUB_REPOSITORY) ||
    !env.GITHUB_REF?.startsWith('refs/heads/gate/plugin-packaged-') ||
    platform !== 'darwin' ||
    arch !== 'arm64'
  )
    throw new Error('Private Mac gate only')
}
export function ownedRoot(root) {
  const info = fs.lstatSync(root)
  if (
    !path.isAbsolute(root) ||
    fs.realpathSync(root) !== root ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077 ||
    fs.readFileSync(path.join(root, 'fixture-owned'), 'utf8') !== 'packaged-plugin-gate\n'
  )
    throw new Error('Not an owned gate fixture')
  return root
}
/** Only temporary build inputs change. The committed product remains fail-closed. */
export function projectBuild(config, entry, appData, browser) {
  if (![appData, browser].every(path.isAbsolute)) throw new Error('Invalid gate build inputs')
  assertNormalPluginBuild(config, entry)
  const replace = (source, before, after) => {
    if (source.split(before).length !== 2) throw new Error('Build anchor changed')
    return source.replace(before, after)
  }
  entry = replace(
    entry,
    "import { RuntimeHost } from './runtime/runtime-host'",
    `/* ${GATE_BUILD_MARKER} */ import { PackagedGateRuntime, preparePackagedGateHome } from ${JSON.stringify(path.join(path.dirname(appData), 'repo/scripts/gates/plugin-packaged/provider-fixture.mjs'))}\nimport { RuntimeHost } from './runtime/runtime-host'`,
  )
  entry = replace(
    entry,
    'return prepareProviderHome(userData, { profileId, provider }, homeSeams)',
    `/* ${GATE_BUILD_MARKER} */ return preparePackagedGateHome(${JSON.stringify(path.dirname(appData))}, userData, provider, profileId)`,
  )
  entry = replace(
    entry,
    '    renewClaudeLogin,\n',
    `    /* ${GATE_BUILD_MARKER} */ renewClaudeLogin: undefined,\n`,
  )
  entry = replace(
    entry,
    `createProviderRuntime(provider, {
        apiKey,
        codexCommand: () => codexProgram().path,
        claudeProgram: () => claudeProgram().path,
        claudeProgramFound,
        managedProviderHomesRoot: providerHomesRoot(userData),
      })`,
    `/* ${GATE_BUILD_MARKER} */ new PackagedGateRuntime(provider, ${JSON.stringify(path.dirname(appData))})`,
  )
  entry = replace(
    entry,
    'pinTheDataFolder(app)',
    `/* ${GATE_BUILD_MARKER} */ app.setPath('appData', ${JSON.stringify(appData)})\npinTheDataFolder(app)`,
  )
  entry = replace(
    entry,
    '            supervisor: pluginSupervisor,',
    `            /* ${GATE_BUILD_MARKER} */ fixtureSource: ${JSON.stringify(path.join(appData, 'repo-fixture'))},
            /* ${GATE_BUILD_MARKER} */ browserExecutable: ${JSON.stringify(browser)},
            supervisor: pluginSupervisor,`,
  )
  return { config, entry }
}
export const loopbackSandbox = `(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(deny file-read* file-write* (regex #"/Library/Keychains(/|$)"))
`
