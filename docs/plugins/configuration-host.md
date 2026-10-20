# Plugin configuration host (slice 12a)

`openPluginConfigurationView` creates a sandboxed `WebContentsView` with a fresh,
nonpersistent session and origin. It copies only verified, digest-checked UI assets
into a private GET/HEAD map. Register `PLUGIN_SCHEME` before app readiness and call
`installPluginUiRpc` once with the raw main IPC registrar. Existing application
handlers use one shared `app-ipc` registrar so plugin-session senders cannot
invoke them, even before navigation or without a registered RPC view. A source
control rejects future raw Electron IPC imports outside the dedicated plugin
registration and the shared registrar.

The controller supplies the verified package and its authenticated, immutable
`PluginUiBinding` (plugin/release/install/incarnation/lease), an adapter to that
plugin's own process, a current-binding predicate, and a revocation registration.
The controller must pair the verified package with the matching release digest;
it must not accept those authorities from page input. Slice 12a never starts or
selects a process, handles a credential, or writes configuration. The adapter
returns public UI snapshots and proposals only. `propose` is the BroCrew-owned
handoff to the later person-only Apply flow; its acknowledgment is not a commit.

The fixed bundled preload exposes no globals or Electron API. It accepts the
contract's exact DOM packet on its own main frame and origin, forwards one fixed
channel, and returns bounded JSON data. The host verifies the registered sender,
actual main-frame identity/document, generation and current installation/lease
before dispatch and after asynchronous replies. Payloads follow the verified
manifest's restricted schemas. Limits are 64 KiB/request, four pending calls, two
subscriptions, 1 MiB/snapshot and one snapshot/second; calls expire after ten
seconds. Reads are serialized and fetch fresh state only after their next snapshot
slot opens, within that same request deadline. An immediate refresh after a committed
Apply is paced rather than reported as unavailable.
Queued readers take precedence over subscription pushes; close or revocation cancels the wait.
Peers must honor the supplied abort signal; late results are discarded.

The owning Settings controller attaches/detaches the view and calls `close` when
the screen closes. Its `onInvalidate` registration must revoke on uninstall,
lease loss, upgrade and global restore. Navigation, reload, crash, popup and
download attempts also revoke locally. Revocation immediately removes RPC
registration and aborts calls/subscriptions, then closes the contents, waits for
Electron's destruction event, and clears the private session. Explicit `close`
rejects if destruction cannot be confirmed within ten seconds. Reopen creates a
new origin and session. Settings rendering and Apply integration are slice 12b.

## Accepted limit

WebRTC/ICE is not a security boundary here: curated first-party plugins run with the user's rights and their own process already has network access.

## Inert verification

The three `test/plugin-ui-*.test.ts` suites exercise the actual preload and host
wiring with a fake peer and fake Electron boundary. The separate
`node apps/desktop/smoke/run-plugin-ui-isolation.mjs` probe bundles the fixed
preload and actual host and runs a fictional verified page in Electron, with a
fake peer. It imports no application entry, supervisor or provider. It uses a
scratch user-data folder, forces `BROBOT_TESTS_START_NO_PROGRAM`, and emits only
counts/booleans. `BROBOT_TEST_ELECTRON_BINARY` can select an already-installed
Electron binary; otherwise the package's Electron is used. It is not a live
plugin or application smoke.
