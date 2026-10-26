"""Portable conversation storage, with legacy null paths and unchanged login selection.

Fictional database, filesystem and external runtime fixtures only.
Each row names its focused assertion killer; canonical proofs restore source bytes.
"""

MUTATIONS = [('M1 · a fresh conversation loses its prepared storage address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    '      record.profileId,\n'
    '      record.providerLocation ?? null,\n'
    '      // Null, not a default:',
    '      record.profileId,\n      null,\n      // Null, not a default:')]),
 ('M2 · the private address query always answers legacy-null — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    '      return row?.provider_home ?? null\n',
    '      return null\n')]),
 ('M3 · cold preparation re-derives storage instead of forwarding the saved address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      sessionId,\n      recordedLocation,\n    )\n',
    '      sessionId,\n    )\n')]),
 ('M4 · stopped config and export reads ignore the saved address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    const recorded = this.recordedProviderHome(session)\n'
    '    if (recorded !== null) return recorded\n',
    '')]),
 ('M5 · deletion preview re-derives the current home — killed by '
  '`recorded-provider-home-readers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      const home =\n'
    '        this.recordedProviderHome(row) ??\n'
    '        this.deps.providerHomePath(row.provider, row.profileId ?? DEFAULT_PROFILE_ID)\n'
    '      const sessions =',
    '      const home = this.deps.providerHomePath(row.provider, row.profileId ?? '
    'DEFAULT_PROFILE_ID)\n'
    '      const sessions =')]),
 ('M6 · deletion execution re-derives the current home — killed by '
  '`recorded-provider-home-readers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '        const home =\n'
    '          this.recordedProviderHome(row) ??\n'
    '          this.deps.providerHomePath(row.provider, row.profileId ?? DEFAULT_PROFILE_ID)\n'
    '        const leftHere =',
    '        const home = this.deps.providerHomePath(row.provider, row.profileId ?? '
    'DEFAULT_PROFILE_ID)\n'
    '        const leftHere =')]),
 ('M7 · transcript import ignores the saved home — killed by '
  '`recorded-provider-home-readers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    const providerHome =\n'
    '      this.recordedProviderHome(session) ??\n'
    '      this.deps.providerHomePath(session.provider, session.profileId ?? DEFAULT_PROFILE_ID)\n',
    '    const providerHome = this.deps.providerHomePath(session.provider, session.profileId ?? '
    'DEFAULT_PROFILE_ID)\n')]),
 ('M8 · generated images look in the current profile home — killed by '
  '`recorded-provider-home-readers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '          recorded ?? (profileId === null ? null : this.deps.providerHomePath(provider, '
    'profileId))\n',
    '          profileId === null ? null : this.deps.providerHomePath(provider, profileId)\n')]),
 ('M9 · the claude home module ignores a saved address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/providers/claude/index.ts',
    '    recordedLocation === undefined\n      ? undefined\n',
    '    true\n      ? undefined\n')]),
 ('M10 · the codex home module ignores a saved address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/providers/codex/index.ts',
    '    recordedLocation === undefined\n      ? undefined\n',
    '    true\n      ? undefined\n')]),
 ('M11 · the address accepts extra path segments — killed by `provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts', '    parts.length !== 3 ||\n', '')]),
 ('M12 · the address accepts another namespace — killed by `provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts', "    parts[0] !== 'default' ||\n", '')]),
 ('M13 · the address accepts another provider leaf — killed by `provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts', '    parts[2] !== provider ||\n', '')]),
 ('M14 · path segments no longer reject traversal and empty names — killed by '
  '`provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts', '    !parts.every(isPathSegment) ||\n', '')]),
 ('M15 · saved addresses bypass the existing ancestry and symlink checks — killed by '
  '`provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts',
    '  if (lstatSync(root, { throwIfNoEntry: false }) !== undefined) {\n'
    '    let existing = root\n'
    '    for (const part of parts) {\n'
    '      const candidate = join(existing, part)\n'
    '      const stat = lstatSync(candidate, { throwIfNoEntry: false })\n'
    '      if (stat === undefined) break\n'
    '      if (stat.isSymbolicLink())\n'
    "        throw new Error('Recorded provider location passes through a symlink')\n"
    '      if (!stat.isDirectory())\n'
    "        throw new Error('Recorded provider location passes through a non-directory')\n"
    '      existing = candidate\n'
    '    }\n'
    '    const ancestry = trustProviderHomeAncestry(root, existing, { includeLeaf: true })\n'
    '    try {\n'
    '      ancestry.verify()\n'
    '    } finally {\n'
    '      ancestry.release()\n'
    '    }\n'
    '  }\n',
    '')]),
 ('M16 · recording folds a mixed-case directory name — killed by `provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts',
    "  const location = relative(resolve(root), resolve(home)).split(sep).join('/')\n",
    '  const location = relative(resolve(root), '
    "resolve(home)).split(sep).join('/').toLowerCase()\n")]),
 ('M17 · a reserved service retry overwrites its original address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    'provider_home = COALESCE(provider_home, ?), updated_at',
    'provider_home = ?, updated_at')]),
 ('M18 · a reserved service never records its first prepared address — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    '        record.providerLocation ?? null,\n        at,\n        record.id,',
    '        null,\n        at,\n        record.id,')]),
 ('M19 · native-user adoption stores a managed address supplied by the caller — killed by '
  '`recorded-provider-home-readers.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    '      record.profileId === null ? null : (record.providerLocation ?? null),',
    '      record.providerLocation ?? null,')]),
 ('M20 · managed discovery does not record the discovered home — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '              providerLocation: this.locationOfPreparedHome(\n'
    '                this.deps.providerHomePath(session.provider, session.profileId),\n'
    '                session.provider,\n'
    '              ),',
    '              providerLocation: undefined,')]),
 ('M21 · production omits the managed-root binding and silently records nothing — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/index.ts',
    '    providerHomesRoot: () => providerHomesRoot(userData),\n',
    '')]),
 ('M22 · production discards a recorded address before entering the module — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/index.ts',
    '      return providerModules[provider].home.prepare(profileId, recordedLocation)\n',
    '      return providerModules[provider].home.prepare(profileId)\n')])]
