"""Claude agent state paths, with unchanged legacy login and transcript routes."""

MUTATIONS = [('M1 · selected agent root silently follows the provider home — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/agent-paths.ts',
    '  const home = agentStateHome ?? providerHome\n',
    '  const home = providerHome\n')]),
 ('M2 · omission invents a new legacy root — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/agent-paths.ts',
    '  const home = agentStateHome ?? providerHome\n',
    "  const home = agentStateHome ?? join(providerHome, 'new-agent-state')\n")]),
 ('M3 · start points memory at provider state — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '      opts.managedPluginMcp,\n      agentHome,\n',
    '      opts.managedPluginMcp,\n      opts.providerHome,\n')]),
 ('M4 · resume points memory at provider state — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '        options.managedPluginMcp,\n        agentHome,\n',
    '        options.managedPluginMcp,\n        options.providerHome,\n')]),
 ('M5 · start reads provider user rules — killed by `packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '    const kept = await keptRulesForALaunch(agentHome, handle.launchLocalFiles(), opts.signal)\n',
    '    const kept = await keptRulesForALaunch(opts.providerHome, handle.launchLocalFiles(), '
    'opts.signal)\n')]),
 ('M6 · resume reads provider user rules — killed by `packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '      const kept = await keptRulesForALaunch(agentHome, handle.launchLocalFiles(), '
    'options.signal)\n',
    '      const kept = await keptRulesForALaunch(options.providerHome, handle.launchLocalFiles(), '
    'options.signal)\n')]),
 ('M7 · model list reads provider user rules — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '    const kept = await keptRulesForALaunch(agentHome, null, context.signal)\n',
    '    const kept = await keptRulesForALaunch(context.providerHome, null, context.signal)\n')]),
 ('M8 · model list points memory at provider state — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '        ...flagSettingsFor(agentHome, kept),\n',
    '        ...flagSettingsFor(providerHome, kept),\n')]),
 ('M9 · instruction disclosure reads shared profile memory — killed by '
  '`apps/desktop/test/claude-agent-paths.test.ts`',
  [('apps/desktop/src/main/providers/claude/instructions.ts',
    "  take(agentPaths.instructionsFile, 'profile-memory')\n",
    "  take(join(inputs.providerHome, INSTRUCTION_FILENAME), 'profile-memory')\n")]),
 ('M10 · memory disclosure reads shared agent memory — killed by '
  '`apps/desktop/test/claude-agent-paths.test.ts`',
  [('apps/desktop/src/main/providers/claude/instructions.ts',
    '  const agent = readClaudeAgentMemory(agentPaths.home)\n',
    '  const agent = readClaudeAgentMemory(inputs.providerHome)\n')]),
 ('M11 · explicit root skips managed folder validation — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '      await provisionProviderHome(this.managedProviderHomesRoot, paths.home)\n',
    '')]),
 ('M12 · explicit root without guard is admitted — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    "        throw new Error('Claude agent state needs its managed root')\n",
    '        return paths.home\n')]),
 ('M13 · canonical reader accepts malformed explicit paths — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/agent-paths.ts',
    '  if (\n'
    '    agentStateHome !== undefined &&\n'
    "    (!isAbsolute(agentStateHome) || agentStateHome.includes('\\0'))\n"
    '  ) {\n'
    "    throw new Error('Claude agent state needs an absolute directory without NUL')\n"
    '  }\n',
    '')]),
 ('M14 · retention follows agent state — killed by `packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '        ...handle.launchFlagSettings(agentHome ?? providerHome, kept),\n'
    '        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),\n',
    '        ...handle.launchFlagSettings(agentHome ?? providerHome, kept),\n'
    '        ...managedTranscriptSettings(agentHome ?? providerHome, '
    'this.managedProviderHomesRoot),\n')]),
 ('M15 · agent state redirects the login folder — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '    const { additions, piped, onAKey } = this.childEnvAdditions(providerHome, auth)\n',
    '    const { additions, piped, onAKey } = this.childEnvAdditions(agentHome ?? providerHome, '
    'auth)\n')]),
 ('M16 · resume checks the transcript in agent state — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '      if (!(await this.sessionExists(ref.sessionId, ref.cwd, options.providerHome))) {\n',
    '      if (!(await this.sessionExists(ref.sessionId, ref.cwd, agentHome))) {\n')]),
 ('M17 · agent selection discards project permission rules — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '    const kept = await keptRulesForALaunch(agentHome, handle.launchLocalFiles(), opts.signal)\n',
    '    const kept = await keptRulesForALaunch(agentHome, null, opts.signal)\n')]),
 ('M18 · omission adds legacy folder access — killed by '
  '`packages/runtime/test/claude-agent-paths.test.ts`',
  [('packages/runtime/src/claude/claude-runtime.ts',
    '    if (context.agentStateHome !== undefined) {\n',
    '    if (true) {\n')])]
