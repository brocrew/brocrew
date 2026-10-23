# Select a separate plugin setup

This offline operator command creates an explicit selection for one existing workspace. It requires
the repository's Node 24+ and installed desktop dependencies. It never runs during app startup.

Close every BroCrew window using the target appData before applying a selection. Confirm the chosen
workspace and a fresh, distinct slot with its owner first. Existing releases that do not implement
selection continue to use the shared setup; install the matching new build before reopening.

Preview is the default and writes nothing:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --slot p1
```

Read the printed canonical workspace, marker, complete pin set, and selected root. Apply that exact
plan with:

```sh
node scripts/plugin-root-opt-in.mjs --app-data /absolute/app-data --workspace /absolute/workspace --slot p1 --apply
```

All paths must be explicit and absolute. The workspace, appData and its `@brobot2` directory must
already exist. The daily default folder and anything inside `@brobot2` are ineligible. Slot names
start with a lowercase letter, contain only lowercase letters and digits, and have at most six
characters. Each selected workspace needs a distinct unused slot. An occupied slot or existing
`plugins-<slot>` path refuses. Neither that plugin data directory nor any install is created here.

The command writes only `<workspace>/plugin-root.json` and the matching entry in
`<appData>/@brobot2/plugin-root-pins.json`. Other entries keep their order and values. An exact
existing pair reports `already selected` and changes nothing. A different slot, copied or moved
workspace, removal, rebind, or incomplete selection refuses; there is no migration or repair mode.

On Windows the existing parent and workspace must already have private access lists. The command
checks them without changing them, and gives each new configuration file its own private access
list. On other platforms files are owned by this user and mode 0600. No routing or settings files,
profiles, pairing data, credentials or existing plugin data are read, copied or moved.

The pin is published first, then the fully written marker. The command verifies the result with the
same reader the app uses, including every other existing selected workspace. A partial publication
refuses plugin startup for the incomplete workspace rather than returning to shared data. Other
valid selections continue working. A running app keeps its previous root until it restarts.

After an interrupted or failed application, stop and have the exact files reviewed. Do not delete
both records, silently recreate a missing pin, reuse a slot, or automatically rerun a half-written
selection. Recovery is deliberately a separate reviewed operation. Temporary files named
`.plugin-root-pins-<uuid>.tmp` or `.plugin-root-marker-<uuid>.tmp` may remain; the reader ignores
them. If interruption occurs between linking the marker and removing its temp name, the reader
refuses its extra hard link too. Do not remove a leftover `plugin-root-pins.lock` until no creator
is running and its publication state has been reviewed; the tool never steals a lock.

Once the selected workspace is reopened in the new build, Plugins starts empty. Reinstall plugins,
create Chrome profiles and sign in again, pair WhatsApp, and set the desired permissions and
switches for that setup. Separate setups need separate WhatsApp pairings. Unselected workspaces
and their existing shared setup are unchanged.
