"""Dark fake-only Claude auth seams, safe status, serialization and legacy routing."""

MUTATIONS = [('M1 · default preparation reports enabled — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '      enabled: false,\n',
    '      enabled: true,\n')]),
 ('M2 · API-key selection enters the fake native route — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '  if (fixtures === undefined || fixtures.apiKeySelected === true) {\n',
    '  if (fixtures === undefined) {\n')]),
 ('M3 · a non-fictional CLI marker is admitted — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "  if (fixtures.cli.kind !== 'fake-cli') throw new Error('Invalid auth preparation fixture')\n",
    '')]),
 ('M4 · release provider gains an import of the preparation module — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/index.ts',
    "import { claudeToolSelection } from '@brobot2/runtime'\n",
    "import { claudeToolSelection } from '@brobot2/runtime'\n"
    "import './native-auth-preparation'\n")]),
 ('M5 · relative or NUL-containing home is accepted — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\\0'))\n",
    '  if (false)\n')]),
 ('M6 · the selected auth verb is replaced with login — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        args: Object.freeze(['auth', verb] as const),\n",
    "        args: Object.freeze(['auth', 'login'] as const),\n")]),
 ('M7 · commands target a different config directory — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '        env: Object.freeze({ CLAUDE_CONFIG_DIR: home }),\n',
    "        env: Object.freeze({ CLAUDE_CONFIG_DIR: '/fictional/other/claude' }),\n")]),
 ('M8 · login and logout request captured output — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        output: verb === 'status' ? 'status-only' : 'discard',\n",
    "        output: 'status-only',\n")]),
 ('M9 · status from a different directory is trusted — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "    if (body.configDirectory !== home) throw new PreparationFailure('status', "
    "'status-schema')\n",
    '')]),
 ('M10 · missing native account identity is accepted — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "      if (typeof body.email !== 'string' || body.email.trim() === '')\n",
    '      if (false)\n')]),
 ('M11 · organisation changes are omitted from account comparison — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '        .update(JSON.stringify([body.email, body.orgId ?? null]))\n',
    '        .update(JSON.stringify([body.email]))\n')]),
 ('M12 · public status exposes the internal account identity — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        accountSignal: identity === null ? 'absent' : 'present',\n        change,\n",
    "        accountSignal: identity === null ? 'absent' : 'present',\n"
    '        change,\n'
    '        identity,\n')]),
 ('M13 · switch ignores a failed sign-out — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        if (logout.exitCode !== 0) throw new PreparationFailure('logout', 'command')\n",
    '')]),
 ('M14 · switch skips confirmation that sign-out succeeded — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        if (unsigned.status.signedIn) throw new PreparationFailure('logout', "
    "'logout-not-confirmed')\n",
    '')]),
 ('M15 · switch ignores a failed sign-in — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        if (login.exitCode !== 0) throw new PreparationFailure('login', 'command')\n",
    '')]),
 ('M16 · an unsigned final status is called a completed switch — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        if (!after.status.signedIn) throw new PreparationFailure('login', "
    "'login-not-confirmed')\n",
    '')]),
 ('M17 · switch drops the required resume confirmation — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '          requiresResumeConfirmation: true,\n',
    '          requiresResumeConfirmation: false,\n')]),
 ('M18 · concurrent switches do not join their operation — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '      if (switching !== undefined) return switching\n',
    '')]),
 ('M19 · status bypasses the active operation reservation — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '    if (busy) return Promise.resolve(BUSY)\n    busy = true\n',
    '    busy = true\n')]),
 ('M20 · the fake CLI does not receive the operation cancellation signal — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '        signal,\n',
    '        signal: new AbortController().signal,\n')]),
 ('M21 · the fake command deadline is extended beyond its bound — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    'const COMMAND_BOUND_MS = 120_000\n',
    'const COMMAND_BOUND_MS = 1_200_000\n')]),
 ('M22 · resume replaces the recorded home with the new default — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '  const home = checkedHome(recordedHome ?? legacyHome())\n',
    '  const home = checkedHome(legacyHome())\n')]),
 ('M23 · legacy auth silently moves away from its conversation home — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    '  return Object.freeze({ providerHome: home, authHome: home })\n',
    "  return Object.freeze({ providerHome: home, authHome: '/fictional/shared-auth/claude' "
    '})\n')]),
 ('M24 · a fake transport error is disclosed to the caller — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "        return Object.freeze({ kind: 'failed', stage: failure.stage, reason: failure.reason "
    '})\n',
    "        return Object.freeze({ kind: 'failed', stage: failure.stage, reason: failure.reason, "
    "detail: error instanceof Error ? error.message : '' })\n")]),
 ('M25 · signed-in status ignores the command exit code — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "    } else if (body.loggedIn === true && body.authMethod === 'claude.ai' && reply.exitCode "
    '=== 0) {\n',
    "    } else if (body.loggedIn === true && body.authMethod === 'claude.ai') {\n")]),
 ('M26 · the preparation module gains filesystem authority — killed by '
  '`apps/desktop/test/claude-native-auth-preparation.test.ts`',
  [('apps/desktop/src/main/providers/claude/native-auth-preparation.ts',
    "import { isAbsolute } from 'node:path'\n",
    "import { isAbsolute } from 'node:path'\nimport 'node:fs'\n")])]
