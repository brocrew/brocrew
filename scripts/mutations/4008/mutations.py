"""Explicit tool-source boundaries, honest receipts and one host authority selection."""

MUTATIONS = [('M1 · Codex start admits an unsupported source request — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/codex/codex-runtime.ts',
    '    requireToolSelection(codexToolSelection, opts)\n',
    '')]),
 ('M2 · Codex resume admits an unsupported source request — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/codex/codex-runtime.ts',
    '    if (!options.signal?.aborted) requireToolSelection(codexToolSelection, options)\n',
    '')]),
 ('M3 · explicit source requests are silently ignored — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '  if (context.toolSelection === undefined) return undefined\n',
    '  return undefined\n')]),
 ('M4 · malformed source requests are downgraded — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    "  if (context.toolSelection.inheritedSources !== 'exclude')\n",
    '  if (false)\n')]),
 ('M5 · Codex falls back instead of refusing exact exclusion — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/codex/tool-selection.ts',
    '    if (request !== undefined)\n',
    '    if (false)\n')]),
 ('M6 · Codex hides unproved project sources — killed by '
  '`apps/desktop/test/provider-tool-selection.test.ts`',
  [('packages/runtime/src/codex/tool-selection.ts',
    "const uncovered = ['home-mcp', 'project-mcp', 'native-plugins'] as const\n",
    "const uncovered = ['home-mcp', 'native-plugins'] as const\n")]),
 ('M7 · the receipt drops selected app tools — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '      appTools: selected.agentTools?.tools.map((tool) => tool.name) ?? [],\n',
    '      appTools: [],\n')]),
 ('M8 · the receipt drops selected external servers — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '      externalServers: selected.externalMcp?.servers.map((server) => server.name) ?? [],\n',
    '      externalServers: [],\n')]),
 ('M9 · the receipt exposes broker capabilities instead of names — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '      pluginServers: selected.managedPluginMcp?.map((server) => server.name) ?? [],\n',
    '      pluginServers: selected.managedPluginMcp?.map((server) => server.capability) ?? '
    '[],\n')]),
 ('M10 · unproved legacy sources are called excluded — killed by '
  '`apps/desktop/test/provider-tool-selection.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '    inheritedSources: { mcp, uncovered: [...uncovered] },\n',
    "    inheritedSources: { mcp: 'excluded-by-explicit-config', uncovered: [...uncovered] },\n")]),
 ('M11 · the receipt invents a known server exclusion — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '    knownRestrictions: { excludedServers: [], filteredTools: [] },\n',
    "    knownRestrictions: { excludedServers: ['maple'], filteredTools: [] },\n")]),
 ('M12 · unmeasured external discovery is called declared — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    "    discovery: { appTools: 'declared', externalTools: 'not-established' },\n",
    "    discovery: { appTools: 'declared', externalTools: 'declared' },\n")]),
 ('M13 · the launch receipt can be replaced by mutation — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/tool-selection.ts',
    '  return Object.freeze(receipt)\n',
    '  return receipt\n')]),
 ('M14 · Claude start loses its requested catalog receipt — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '\n    return withToolCatalog(handle, toolCatalog)\n',
    '\n    return handle\n')]),
 ('M15 · Claude resume loses its requested catalog receipt — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '\n      return withToolCatalog(handle, toolCatalog)\n',
    '\n      return handle\n')]),
 ('M16 · Claude reports a requested boundary as unestablished — killed by '
  '`packages/runtime/test/tool-selection-contract.test.ts`',
  [('packages/runtime/src/claude/tool-selection.ts',
    "        request ? 'excluded-by-explicit-config' : 'not-established',\n",
    "        'not-established',\n")]),
 ('M17 · plugin occupancy ignores the selected external namespaces — killed by '
  '`apps/desktop/test/launch-tool-selection.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '          ...(selected.externalMcp?.servers.map((one) => one.name) ?? []),\n',
    '          ...[],\n')]),
 ('M18 · start re-reads grants after the namespace snapshot — killed by '
  '`apps/desktop/test/launch-tool-selection.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '          ...(selectedTools.externalMcp ? { externalMcp: selectedTools.externalMcp } : {}),\n'
    '          // ⚑ **W4.189** — the folders its open pieces grant it, as on a resume (none on a '
    'first start).\n',
    '          ...externalMcpContext(this.deps.store, input.provider, profileId),\n'
    '          // ⚑ **W4.189** — the folders its open pieces grant it, as on a resume (none on a '
    'first start).\n')]),
 ('M19 · resume re-reads grants after the namespace snapshot — killed by '
  '`apps/desktop/test/launch-tool-selection.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '          ...(selectedTools.externalMcp ? { externalMcp: selectedTools.externalMcp } : {}),\n'
    '          // 🔴 **W4.189 · and the folders its open pieces grant it** — a resume is a new '
    'process on\n',
    '          ...externalMcpContext(this.deps.store, row.provider, row.profileId),\n'
    '          // 🔴 **W4.189 · and the folders its open pieces grant it** — a resume is a new '
    'process on\n')]),
 ('M20 · the panel discards the same selected external servers — killed by '
  '`apps/desktop/test/launch-tool-selection.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      externalServers: (selectedTools.externalMcp?.servers ?? []).map((one) => one.name),\n',
    '      externalServers: [],\n')]),
 ('M21 · an unidentified selection inherits the default identity grants — killed by '
  '`apps/desktop/test/launch-tool-selection.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      ...externalMcpContext(this.deps.store, provider, profileId),\n',
    "      ...externalMcpContext(this.deps.store, provider, profileId ?? DEFAULT_PROFILE_ID),\n")])]
