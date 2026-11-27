# Global plugin state, format 2

This is the storage-only part of section 5 of `plugins.md`. It starts no process, installs no package, changes no workspace DB or Skills store, and exposes no IPC/UI/provider-home API. The authenticated person-command controller supplies consent and verified release metadata; these data methods do not authenticate a person or authorize plugin execution.

## Location

The app explicitly supplies its per-user global plugin root (`<appData>/@brobot2/plugins`) and the known workspace roots. There is no live-root or workspace fallback. A state folder inside a supplied workspace, including through a differently spelled alias, is refused, so no workspace backup or restore carries it. `GlobalPluginState.create` creates a new private state folder exclusively; `open` requires an existing state. Missing or unreadable state is never initialized as empty.

The state folder holds:

- `plugin-state.json`: the whole lifecycle state, plain JSON with a closed schema. It is excluded from every global and workspace restore set.
- `writer-lock.sqlite`: uses the existing SQLite dependency only for kernel-backed `BEGIN EXCLUSIVE` exclusion, without tables or data writes. Every write takes it.

The state file holds:

- the global root id, the operational epoch and a sequence that goes up by one with every change;
- every plugin ever installed, removed ones included, with its installation identity, lifecycle sequence, revisions, release pin and phase. Removed plugins are kept so that nothing can bring one back;
- the admitted (active) plugins;
- the operation in progress, if any;
- the latest operation of each plugin and of a global restore, with its status. That is all that retries and recovery read, so the file stays small: at most 200 plugins, 201 operations and 4 MiB.

## Writes and crash safety

Each change writes the whole file to a temporary file, flushes it, renames it over the old one and flushes the folder. A crash leaves either the old state or the new one, never a mix. When a write fails, the service holds whatever the file now says, since the rename may have landed before the failure. Under the writer lock, a write is refused as a conflict if another copy changed the file since this one read it.

`prepare` writes the operation as pending before the installer changes anything. `complete` and `abort` write its outcome and clear it. A crash or a failed write in between leaves the operation pending, and recovery on the next start finishes it or rolls it back, as before.

## Operations

`prepare({operationId, consent, snapshot})` records the exact bounded consent before the installer may mutate anything. Consent is `{action, pluginId, at, expectedSequence, expectedInstallId, release}`, where action is `install`, `update`, `uninstall` or `global-restore`. Release references pin version, downloaded archive SHA-256, manifest SHA-256 and data schema. Restore carries the exported activation snapshot instead of a release. Unknown fields are refused. The older optional `workspaces` field is still read, from migrated operations, but no workspace receipts are kept for it. One pending operation serializes metadata changes across all plugins; stale expected sequences and mismatching retries refuse. Repeating the latest operation ID of a plugin with the identical request returns its original allocation, including after a restart or completion. An older operation ID of that plugin refuses as a conflict. Dropping the operation a new one replaces leaves recovery nothing to lose: a new operation starts only when nothing is pending, the controller settles an operation's effect before completing it, and an aborted operation leaves its plugin removed, so the next one is a fresh install with a new `installId`, which recovery never confuses with the old one.

`complete(operationId)` and `abort(operationId)` resolve the exact pending operation. They are idempotent once resolved. Abort marks the affected installation removed instead of reviving its prior state. This code proves only storage state: before calling it, the controller performs the readiness, drain, stop/exit and consent checks. A prepared allocation is never access.

Every fresh Install, including reinstall after uninstall or abort, allocates a new `installId` and activation `incarnation`. Update preserves `installId` and `configRevision`, advances `releaseRevision` and lifecycle sequence, and allocates another incarnation. Changes of data schema are refused. Uninstall records the removed phase at preparation, before revocation and cleanup, and keeps it after completion. Changing bytes for the same plugin and version, against its installed release or its latest operation, refuses.

## Restore

Global restore is recorded as an operation before the caller drains all workspaces. Completion keeps every plugin entry and filters the supplied snapshot against the **current exact** active installation records. A removed plugin never returns. If B replaced A, an A snapshot cannot guess B's missing metadata or configuration: B remains unavailable until explicit repair. Compatible restored entries keep their installation identity and get a fresh operational epoch. Aborting a restore also rotates the epoch and admits nothing. A snapshot from a different global root is refused. Only `exportActivation()` returns backup data. Workspace restore never changes this state.

## The journal it replaced

Earlier builds kept an append-only journal in `lifecycle-guard/`, with `resolution-reservations/` and `activations/` beside it, and rebuilt the state by replaying every record. Its 4,096-record limit would have refused every install, update and removal once reached.

When `open` finds no state file but a journal, it reads the journal once and writes the state file. It counts exactly the records the old recovery counted, ignores leftover crash stages, and never writes or removes anything in the journal folders. After the state file, it writes a `moved-to-plugin-state` marker into `resolution-reservations/`. Older builds refuse any name there that is not an operation id, so an older app on a migrated workspace shows "Plugin recovery is required" and changes no plugins. A crash before the state file is in place leaves the journal untouched, and the next start migrates again. A crash between the state file and the marker leaves a journal that is still current, and the next start writes the marker. A state file that is missing while the marker is there refuses with "Plugin recovery is required", because the journal is stale and rebuilding from it could bring back a removed plugin.

To use an older app anyway, delete the marker and `plugin-state.json`. Plugins then return to how they were when the migration ran, so check them in Settings, and remove or reinstall any that changed since. The next newer start migrates again.

The journal folders stay in place until they are removed by a later, separate change.

## Display reads

The window reads `plugin-state.json` asynchronously, for display only. A missing or unreadable file is unknown, never an action state.

Errors contain only approved section 6 wording (`Plugin recovery is required. Open Plugins.`, `Plugin busy. Try again.`, `Plugin unavailable. Try again.`), never raw filesystem errors, paths, causes, credentials or configuration bodies.
