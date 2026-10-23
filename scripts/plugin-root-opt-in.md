# Select a plugin setup without moving its data

This headless, offline operator command requires Node 24+ and installed desktop dependencies.
Run it from the matching landed checkout with a clean tree. Preview prints the canonical appData,
workspace, root, exact configuration changes and a hash of the bundled tool source. It opens no
Electron window, makes no network request, and never runs during ordinary app startup.

Before applying either mode, close every BroCrew window using the target workspace's data folder
and verify those windows have quit. Other workspaces may stay open, including an unselected daily
dev window using the default shared plugin root. That default owner may keep its leases, person
connection and catalogue refresh running: selection changes do not stop or rebind it. The command's
configuration lock is separate from the default owner's supervisor and state locks.

The command cannot prove that the target workspace's windows have quit; the operator must check.
It does not inspect private supervisor state or stop processes. A running app keeps its root until
it restarts, so changing its selection while it runs is unsupported. Existing builds without
selection support ignore these records and continue sharing until upgraded.

## Own: select a fresh separate setup

Preview writes nothing, including no lock, temporary file or directory:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode own --slot p1
```

Read the plan, then repeat it with `--apply` after approval:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode own --slot p1 --apply
```

`own` is the default mode for compatibility. All paths must be explicit and absolute. The workspace,
appData and its `@brobot2` directory must already exist. Anything within `@brobot2`, including the
normal daily default folder, is ineligible. Slots start with a lowercase letter, contain only
lowercase letters and digits, and have at most six characters. Each workspace needs a distinct,
unused slot. An occupied slot or existing `plugins-<slot>` path refuses; no plugin data directory
or install is created. An exact existing pair reports `already selected` without writing.

The command publishes `<appData>/@brobot2/plugin-root-pins.json` first, then exclusively publishes
`<workspace>/plugin-root.json`. It preserves every other pin entry's order and values. Incomplete
own selections refuse in the reader and in `own`; they never fall back to shared data.

## State: a literal read-only query

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode state
```

This prints exactly `shared` or `own`, followed by a newline, on stdout. `shared` means neither a
marker nor a matching pin entry exists; `own` means the app's reader accepts both matching records.
A mixed, mismatched or unsafe state exits nonzero, with one line on stderr and nothing on stdout.
It changes nothing and does not accept `--apply`. The swap must check all selected workspaces are
shared before starting and check state again after each step. No JSON or source hash accompanies
this literal output.

## Shared: explicitly remove the selection, including partial states

The swap's rollback and the way-back script use this mode. Whenever either record exists, pass the
expected slot assigned to this exact workspace:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode shared --slot p1
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode shared --slot p1 --apply
```

Preview writes nothing and states exactly which marker, matching tool temp and pin entry will be
removed. Apply only after the workspace's owner approves this specific return to shared and its
windows are closed. After restart this workspace's agents use the shared plugins, including the
daily Chrome profiles/sign-ins and the WhatsApp account with its read/group settings. The preview
prints this warning too. This is an intentional change of account access, not just configuration
cleanup.

The expected slot must match every existing marker and target pin. Missing or wrong slot,
unparseable marker, unexpected keys or disagreement refuses without changing either record.
Already shared needs no slot and succeeds idempotently. A marker with two links is accepted only
when its exact extra name is a UUID-named tool marker temp with the same device and inode; only
that proven temp is removed before the marker. Other temporary files are never removed. The
reader continues to refuse all multiply linked markers during ordinary startup.

Apply removes the marker first and then the pin ENTRY. Other entries keep their order and values;
an empty valid pin map is retained. Neither the separate data root nor the shared data root is
read, deleted, moved or merged. Kept separate data permits a future reviewed recovery and blocks
slot reuse: own refuses that slot while its root exists. Deleting any data root is a separate
reviewed step.

Marker-only, pin-only and interrupted-own selections with the matching expected slot are cleared.
If shared stops after removing the marker, the remaining pin makes the reader refuse; rerun shared
with the same expected slot to finish. Other selections retain their previous view. A malformed
global map or unsafe marker refuses for review rather than guessing which records to preserve.
Afterwards the app reader must confirm shared before the command exits successfully. Neither mode
reads or changes workspace-policy.json, packaged-workspaces.json or packaged-workspace-owners/.

## Privacy, interruption and reviewed recovery

Both modes use one exclusive appData lock. A busy or leftover `plugin-root-pins.lock` is never
stolen. After a hard process kill, the operator must:

1. Use the process list to verify no creator command is running, and keep the target workspace's
   windows closed. Other workspaces, including the daily dev window, may remain open.
2. Preview own and shared for the approved explicit workspace and expected slot; an incomplete own
   preview may refuse, which is expected. Review the shared plan and existing records.
3. Verify the leftover lock is a regular file at exactly `@brobot2/plugin-root-pins.lock`. Remove
   only that verified lock, never a directory, link, configuration record or data root.
4. Rerun shared preview and apply with the same approved expected slot, then state must print shared.

The command never steals a lock automatically. Normal errors release this command's
own lock. The tool exits nonzero with a one-line reason on failure and zero only after verification.

On Windows the existing configuration parent and workspace must already have private ACLs. The
command checks those ACLs without changing them and gives its new files private ACLs. On POSIX new
files are owned by this user and mode 0600. Atomic file publication and directory fsync on POSIX
keep complete records durable. The reader rejects incomplete or multiply linked markers.
Temporary names `.plugin-root-pins-<uuid>.tmp` and `.plugin-root-marker-<uuid>.tmp` can remain after
failure; the reader ignores them. Do not automatically delete unrelated temporary files.

Shared is the normal automated way to undo a failed own selection. If an approved review instead
chooses to FINISH the original own selection, use only these minimal steps with the target
workspace's windows and all creator commands quit. Other workspaces may remain open:

1. Verify the existing pin entry exactly names the native canonical workspace and approved slot,
   the global map is otherwise valid, and the missing-marker state is the only discrepancy.
2. Create only `<workspace>/plugin-root.json` with exactly `{"format":1,"slot":"<slot>"}`.
   Use exclusive creation (refuse an existing name), mode 0600 on POSIX, and a regular file with one
   link. On Windows create it inside the verified private workspace and keep its file ACL private.
   Never hand-edit or replace the shared pin file.
3. Run an own preview for the same explicit paths and slot. It must report `already selected`, and
   the app's reader must resolve `plugins-<slot>`. The pin bytes must remain unchanged.
4. If a complete marker instead has two links, verify that its only extra name is this transaction's
   `.plugin-root-marker-<uuid>.tmp`, with the same device and inode. Unlink only that temp name,
   leave the marker and pin unchanged, and repeat step 3. Do not infer this from a filename alone.

A different slot, moved or copied workspace, or damaged global map needs its own reviewed recovery;
this command never rebinds or migrates it. Do not remove both records by hand as an implicit repair.

When a new own workspace opens in the matching build, Plugins starts empty. Reinstall plugins,
create Chrome profiles and sign in, pair WhatsApp separately, and set permissions and switches.
Unselected ordinary workspaces and their original shared setup remain unchanged.
