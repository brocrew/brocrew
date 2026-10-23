# Select a plugin setup without moving its data

This headless, offline operator command requires Node 24+ and installed desktop dependencies.
Run it from the matching landed checkout with a clean tree. Preview prints the canonical appData,
workspace, root, exact configuration changes and a hash of the bundled tool source. It opens no
Electron window, makes no network request, and never runs during ordinary app startup.

Before applying either mode, close every BroCrew window using that appData and verify they have
quit. The command cannot prove that all app processes have quit; it does not inspect private
supervisor state or stop processes. A running app keeps its root until it restarts. Existing builds
without selection support ignore these records and continue sharing until upgraded.

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

## Shared: explicitly remove the selection, including partial states

The swap's rollback and the way-back script use this mode. No slot is required:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode shared
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --mode shared --apply
```

The first command previews exactly which marker and pin entry will be removed. Its JSON `state` is `own`, `shared`, or `partial`, so the swap adapter can classify the existing selection without supplying a slot; an unsafe global map instead exits nonzero. Apply removes only
that workspace's marker, then its pin entry. An empty, valid pin map may remain. It never deletes
other entries or either plugin data directory. Both absent is an idempotent success, `already
shared`. Marker-only, pin-only and interrupted-own states are cleared; a marker with an unfinished
temp hard link is also removed safely. If shared stops after removing the marker, the remaining pin
keeps the reader refused; rerun shared to finish. Every other selection retains its previous view.
A malformed global pin map or an unsafe marker kind refuses for review instead of guessing which
other records to preserve. A regular partial marker may be removed without parsing its content.

After shared completes, the app's reader must confirm the unchanged shared root before the command
exits successfully. Kept data from a former separate setup is never moved, merged or reused. A later
own enrollment needs a fresh unused slot if that data root exists. No workspace-policy.json,
packaged-workspaces.json or packaged-workspace-owners/ path is read or changed by either mode.

## Privacy, interruption and reviewed recovery

Both modes use one exclusive appData lock. A busy or leftover `plugin-root-pins.lock` is never
stolen. After a hard process kill, verify no creator is running and review publication state before
removing that lock; then shared can clear the partial pair. Normal errors release this command's
own lock. The tool exits nonzero with a one-line reason on failure and zero only after verification.

On Windows the existing configuration parent and workspace must already have private ACLs. The
command checks those ACLs without changing them and gives its new files private ACLs. On POSIX new
files are owned by this user and mode 0600. Atomic file publication and directory fsync on POSIX
keep complete records durable. The reader rejects incomplete or multiply linked markers.
Temporary names `.plugin-root-pins-<uuid>.tmp` and `.plugin-root-marker-<uuid>.tmp` can remain after
failure; the reader ignores them. Do not automatically delete unrelated temporary files.

Shared is the normal automated way to undo a failed own selection. If an approved review instead
chooses to FINISH the original own selection, use only these minimal steps with all apps and
creators quit:

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
