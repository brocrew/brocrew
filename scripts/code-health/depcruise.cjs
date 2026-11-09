const layer = (name, from, to) => ({
  name,
  severity: 'error',
  from: { path: `^apps/desktop/src/${from}/` },
  to: { path: `^apps/desktop/src/(${to})/` },
})

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'neutral-not-to-provider-adapters',
      severity: 'error',
      from: {
        path: '^(apps/desktop/src/|packages/(shared|orchestration)/src/)',
        pathNot:
          '^apps/desktop/src/main/providers/(index\\.ts$|workspace-layout\\.mjs$|claude/|codex/)',
      },
      to: {
        path: '^(apps/desktop/src/main/providers/(claude|codex)/|packages/runtime/src/(claude|codex)(/|\\.ts$))',
      },
    },
    {
      name: 'portable-provider-data-only-layouts',
      severity: 'error',
      from: { path: '^apps/desktop/src/main/providers/workspace-layout\\.mjs$' },
      to: { pathNot: '^apps/desktop/src/main/providers/(claude|codex)/layout\\.mjs$' },
    },
    {
      name: 'runtime-interface-not-to-provider-adapters',
      severity: 'error',
      from: {
        path: '^packages/runtime/src/',
        pathNot: '^packages/runtime/src/(claude|codex)(/|\\.ts$)',
      },
      to: { path: '^packages/runtime/src/(claude|codex)(/|\\.ts$)' },
    },
    ...['claude', 'codex'].map((provider, index, providers) => ({
      name: `${provider}-not-to-other-provider`,
      severity: 'error',
      from: {
        path: `^(apps/desktop/src/main/providers/${provider}/|packages/runtime/src/${provider}(/|\\.ts$))`,
      },
      to: {
        path: `^(apps/desktop/src/main/providers/${providers[1 - index]}/|packages/runtime/src/${providers[1 - index]}(/|\\.ts$))`,
      },
    })),
    layer('main-not-to-renderer-or-preload', 'main', 'renderer|preload'),
    layer('preload-not-to-main-or-renderer', 'preload', 'main|renderer'),
    layer('renderer-not-to-main-or-preload', 'renderer', 'main|preload'),
    layer('shared-not-to-app-layers', 'shared', 'main|preload|renderer'),
    {
      name: 'packages-not-to-apps-or-plugins',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|plugins)/' },
    },
    {
      name: 'plugins-not-to-desktop-or-other-plugins',
      severity: 'error',
      from: { path: '^plugins/([^/]+)/' },
      to: { path: '^(apps|plugins)/', pathNot: '^plugins/$1/' },
    },
    {
      name: 'production-not-to-tests',
      severity: 'error',
      from: { path: '^(apps/desktop|packages/[^/]+|plugins/[^/]+)/src/' },
      to: { path: '(^|/)(test|tests|smoke|fixtures)/|\\.(test|spec)\\.[cm]?[jt]sx?$' },
    },
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)\\.git/' },
    tsPreCompilationDeps: 'specify',
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json', '.vue'],
      conditionNames: ['types', 'import', 'node', 'default'],
      exportsFields: ['exports'],
      mainFields: ['types', 'module', 'main'],
    },
  },
}
