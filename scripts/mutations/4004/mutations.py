"""Portable conversation storage, with legacy null paths and unchanged login selection.

Fictional database, filesystem and external runtime fixtures only.
Each row names its focused assertion killer; canonical proofs restore source bytes.
"""

MUTATIONS = [('M1 · a fresh conversation loses its prepared storage address — killed by '
 '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '      record.profileId,\n'
   '      ...(locationStatements === null ? [] : [record.providerLocation ?? null]),\n'
   '      // Null, not a default:',
   '      record.profileId,\n'
   '      ...(locationStatements === null ? [] : [null]),\n'
   '      // Null, not a default:')]),
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
   '        ...(locationStatements === null ? [] : [record.providerLocation ?? null]),\n'
   '        at,\n'
   '        record.id,',
   '        ...(locationStatements === null ? [] : [null]),\n        at,\n        record.id,')]),
 ('M19 · native-user adoption stores a managed address supplied by the caller — killed by '
 '`recorded-provider-home-readers.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '    const location = record.profileId === null ? undefined : record.providerLocation\n',
   '    const location = record.providerLocation\n')]),
 ('M20 · managed discovery does not record the discovered home — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    # ⚑ **4004 · re-anchored in place, not retired** — Discovery now preserves a legacy-null row when address validation fails; the managed-discovery omission plant is unchanged.
    "              providerLocation: this.locationOfDiscoveredHome(session.provider, session.profileId),",
    "              providerLocation: undefined,")]),
 ('M21 · production omits the managed-root binding and silently records nothing — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/index.ts',
    '    providerHomesRoot: () => providerHomesRoot(userData),\n',
    '')]),
 ('M22 · production discards a recorded address before entering the module — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/index.ts',
    '      return providerModules[provider].home.prepare(profileId, recordedLocation)\n',
    '      return providerModules[provider].home.prepare(profileId)\n')]),
 ('M23 · cold resume admits a different prepared folder — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    if (recordedHome !== null && providerHome !== recordedHome) {\n'
    "      throw new Error('Prepared provider folder differs from the recorded location')\n"
    '    }\n',
    '')]),
 ('M24 · a reserved service admits a different prepared folder — killed by '
  '`a-service-keeps-its-recorded-provider-folder.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    if (recordedAddress !== null && providerHome !== recordedAddress.home) {\n'
    "      throw new Error('Prepared provider folder differs from the recorded location')\n"
    '    }\n',
    '')]),
 ('M25 · saved-address validation happens after login renewal and preparation — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    const recordedAddress = this.recordedProviderAddress(row)\n'
    '    const recordedHome = recordedAddress?.home ?? null\n'
    '    const recordedLocation = recordedAddress?.location\n'
    '    const { home: providerHome, loginRenewed } = await this.prepareAHome(\n'
    '      row.provider,\n'
    '      profileId,\n'
    '      sessionId,\n'
    '      recordedLocation,\n'
    '    )\n',
    '    const recordedLocation = this.deps.store.providerLocationOf(sessionId) ?? undefined\n'
    '    const { home: providerHome, loginRenewed } = await this.prepareAHome(\n'
    '      row.provider,\n'
    '      profileId,\n'
    '      sessionId,\n'
    '      recordedLocation,\n'
    '    )\n'
    '    const recordedAddress = this.recordedProviderAddress(row)\n'
    '    const recordedHome = recordedAddress?.home ?? null\n')]),
 ('M26 · the final containment check trusts ancestors swapped after release — killed by '
  '`provider-locations.test.ts`',
  [('apps/desktop/src/main/providers/locations.ts',
    '  if (!inside(canonical(root), canonical(path))) {',
    '  if (false) {')]),
 ('M27 · one invalid discovered folder aborts every later adoption — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    } catch {\n'
    '      // Discovery predates this address field; an odd home retains its original legacy '
    'route.\n'
    '      return undefined\n'
    '    }\n',
    '    } catch (error) {\n      throw error\n    }\n')]),
 ('M28 · a saved-address config refusal escapes its typed IPC result — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    "      if (error instanceof ProviderLocationError) return { ok: false, reason: 'unreadable' "
    '}\n',
    '')]),
 ('M29 · a saved-address Finder refusal escapes its typed IPC result — killed by '
  '`a-conversation-keeps-its-recorded-provider-home.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      if (error instanceof ProviderLocationError) return null\n',
    '')]),
('M30 · store construction eagerly prepares the new column on old schemas — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '  let recordedLocationStatements: {',
   "  db.prepare('SELECT provider_home FROM provider_session WHERE id = ?')\n"
   '  let recordedLocationStatements: {')]),
('M31 · an explicit location is silently discarded before migration — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '      if (location !== undefined)\n'
   "        throw new Error('Provider locations require the database migration')\n",
   '')]),
('M32 · the column probe caches absence across an in-place migration — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '  let recordedLocationStatements: {',
   "  const columnsAtCreation = db.pragma('table_info(provider_session)') as { name: string }[]\n"
   '  let recordedLocationStatements: {'),
  ('apps/desktop/src/main/db/session-store.ts',
   "    const columns = db.pragma('table_info(provider_session)') as { name: string }[]\n",
   '    const columns = columnsAtCreation\n')]),
('M33 · creation writes an identity before refusing an unsupported location — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '    const locationStatements = providerLocationSql(record.providerLocation)\n'
   '    const identityId = identityRowFor(record.profileId, at)\n',
   '    const identityId = identityRowFor(record.profileId, at)\n'
   '    const locationStatements = providerLocationSql(record.providerLocation)\n')]),
('M34 · adoption writes an identity before refusing an unsupported location — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '    const locationStatements = providerLocationSql(location)\n',
   ''),
  ('apps/desktop/src/main/db/session-store.ts',
   '    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, '
   'at)\n',
   '    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, '
   'at)\n'
   '    const locationStatements = providerLocationSql(location)\n')]),
('M35 · the shared host fixture omits the managed namespace — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/test/lib/f093-host.ts',
   "    return join(this.root(), 'default', profileId, provider)\n",
   '    return join(this.root(), profileId, provider)\n')]),
('M36 · first launch discards a location before the migration guard — killed by '
 '`provider-location-legacy-compatibility.test.ts`',
 [('apps/desktop/src/main/db/session-store.ts',
   '    ): boolean => {\n'
   '      const locationStatements = providerLocationSql(record.providerLocation)\n',
   '    ): boolean => {\n      const locationStatements = providerLocationSql()\n')])]
