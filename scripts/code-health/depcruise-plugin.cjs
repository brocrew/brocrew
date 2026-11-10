const { options } = require('./depcruise.cjs')

const pluginCode = '^apps/desktop/(src/main/plugins/|resources/plugin-host/)'
const providerSdks = '(^|/)node_modules/@(anthropic-ai/claude-agent-sdk|openai/codex-sdk)/'

module.exports = {
  forbidden: [
    {
      name: 'plugin-code-not-to-runtime-barrel',
      severity: 'error',
      from: { path: pluginCode },
      to: { path: '^packages/runtime/src/index\\.ts$', reachable: true },
    },
    {
      name: 'plugin-code-not-to-provider-sdks',
      severity: 'error',
      from: { path: pluginCode },
      to: { path: providerSdks, reachable: true },
    },
  ],
  options: { ...options, tsPreCompilationDeps: false },
}
