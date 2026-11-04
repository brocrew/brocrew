# WhatsApp plugin source

A one-time port of the WhatsApp bridge and server from whatsapp-mcp (MIT, Copyright (c) 2025 Luke Harries; its notice is in `bridge/UPSTREAM-LICENSE` and ships in the package's `licenses/`), with the group-sending, file-typing and archive checks of the source project that ran it. It has no runtime dependency on either. Only code was copied: no WhatsApp session, keys, message store, contacts or media. `COPY-INVENTORY.json` records each copied file, its source digest and its destination; `UPSTREAM-CHANGES.md` says what changed.

## What it does

- **Linking.** The settings page shows a fresh QR code. The phone scans it, and this plugin becomes one of its linked devices. "Log out" removes the device from the phone's linked devices, through WhatsApp, and deletes the session, the messages it kept and the photos and PDFs it downloaded. If WhatsApp can't be reached within about 25 seconds, only the plugin's side is cleared: the device can no longer be used, and the page says to remove it on the phone too. A log out the app quits during is finished at the next start. Uninstalling logs out first, then deletes all of the plugin's data.
- **Reading** (`list_chats`, `read_messages`, `search_messages`, `search_contacts`, `get_media`) works only while the person has "Read conversations" on. It is off at first, and applies to all agents.
- **Sending** (`send_to_group`) goes only to groups whose "Can write" the person turned on; never to a person. Text up to 4,000 characters, or one file with a caption up to 1,000. Five messages per group in ten minutes, twenty an hour in all, and the same message to the same group once an hour. `list_groups` names the groups that can be written to.
- **Files to send** must be in the plugin's `files` folder (an absolute path, shown in the tool's description), up to 100 MB. The bridge checks the file's type from its bytes, and refuses programs and archives that hold keys or credentials.
- **Every refusal** gives the agent a fixed line and is written to `refusals.jsonl` in the plugin's private folder: when, which tool and which rule, never what was asked.

## Parts

- `src/`: the format-3 Node MCP server over stdio. Domain tools, Configure actions and explicit removal use the same MCP connection. There is no admin HTTP or legacy launch IPC dependency.
- `bridge/`: a Go program (whatsmeow, with a pure-Go SQLite) that holds the WhatsApp session. The server starts it with a per-run token on its standard input, talks to it over loopback, and restarts it if it stops. It writes only inside the plugin's private folder.
- `ui/`: the settings page.

## Build and check

Node 22 and Go 1.27.2. In this folder, run `npm ci --ignore-scripts --no-audit --no-fund`. From the repository root, run `BROCREW_GO=/absolute/path/to/go1.27.2/bin/go BROCREW_PLUGIN_SOURCE_COMMIT=$(git rev-parse HEAD) node plugins/whatsapp/build.mjs /absolute/fresh/output darwin-arm64` (or `win32-x64`). The bridge is built with `CGO_ENABLED=0 -trimpath -buildvcs=false -ldflags="-s -w -buildid="`, so the same commit and Go give the same archive bytes.

Tests use a fake bridge and made-up chats; none starts WhatsApp. From the repository root: `pnpm exec vitest run --config plugins/whatsapp/vitest.config.ts`, and in `bridge/`, `go test ./...`.

## Host attachment

The generic runner supplies `BROCREW_PLUGIN_DATA` and `BROCREW_PLUGIN_BOOTSTRAP` (JSON with `dataDirectory`, `previousVersion` and `previousDataSchema`). The entry uses that exact directory, including the production selected root's `host/data/whatsapp` suffix. It never selects data from HOME, cwd or the code directory. Stdio carries MCP; SIGTERM, SIGINT or stdin EOF closes the MCP server and the package-owned bridge. Configure tools require generic host metadata with origin `settings.page`; the removal binding requires origin `lifecycle.beforeRemove`. Agents and calls with missing/unknown origin cannot disclose configuration, change permissions, link/unlink or wipe data. These origin fields come from the generic host call metadata, never plugin arguments. The host origin labels are agreed contracts; connected host integration qualification remains separate.

Schema 1 is unchanged. Startup/update/reopen reads existing settings and leaves pairing/history SQLite files and sidecars to the bridge; the Node migration does not open them. Updates do not call unlink or removal. `whatsapp_before_remove` is the explicit manifest cleanup binding and returns human-readable text plus structured `{status,message}`; `whatsapp_unlink` is the explicit Configure logout action. An existing `log-out.pending` remains the package's interrupted logout intent and resumes through its existing bridge behavior.

The optional bootstrap `legacyConfiguration:{directory,floor}` names the actual old per-install ledger and its floor file. The package imports only the consumed revision boundary and install association into an atomically published `legacy-configuration.json` in the same private data folder. It reads birth/checkpoint/floor metadata and published 8/16-digit intent filenames; command bodies stay opaque and are never opened, replayed or copied into the marker. Existing legacy bytes are left untouched. A published marker is reused across reopen/update, including interrupted publication; malformed boundary metadata stops startup while retaining current data. Missing legacy input does not create an empty checkpoint. The package never scans for old app directories or reconstructs settings from commands. The host handoff and old active-ledger retirement still require connected integration qualification.

The bridge program is copied from the package into `<data>/bin/` only when its SHA-256 equals the one built into `server.mjs`. `tools.json` is generated from the server's definitions during the later package build; runtime `tools/list` remains authoritative.

Archives are built for macOS on Apple silicon and for Windows x64. On Windows the program is `whatsapp-bridge.exe`; it has no file modes or umask there, so its files are private only through the data folder's access list, provided for the selected root.

The Groups list puts groups with Can write on first, then sorts each part by name.
Filter groups matches names without case. Refresh asks the bridge for the current
groups, bypassing its 30-second cache; only the Refresh button waits for the answer.
The page keeps its own stylesheet because the app hosts it in an isolated view.
