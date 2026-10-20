# Global plugin supervisor — slice 5

One POSIX owner holds the existing process-shared SQLite fence at the explicit global
plugin root for its entire lifetime. Workspaces do not open the global state database.
The owner publishes an atomic, private descriptor with a fresh epoch and authentication
key, and listens on a private Unix socket. Every command uses a fresh connection-bound
server challenge, fresh client nonce, direction-separated HMAC, bounded strict schemas
and a reply authenticated against that client nonce and owner epoch.
The key never enters provider text, homes, logs or the plugin's page. A caller needs read
authority in the same OS user's private root; workspace registration is its canonical
folder hash, authenticated with that local bootstrap key, bound to a fresh host generation.
This boundary does not isolate curated code from its own OS user.

`PluginWorkspaceLease.attach` reuses an accepting incumbent without calling the supplied
launcher. Wire-major mismatch or disjoint minor ranges are refused; the highest shared
minor and feature intersection are selected. The build is carried for identification,
not used as permission to replace an older compatible service. There are at most 64
leases, one per workspace. Renewal runs every 15 seconds, expires after 60 seconds on
the owner's monotonic clock, and requires the exact lease, host generation, workspace,
owner epoch and next counter. An expired lease cannot renew; fresh authenticated
attachment and the later controller's projection checks are required.

Removing the last lease durably changes accepting to draining before any await. New
arrivals cannot reopen it. Lease authority is removed before the injected revocation
callback runs; the broker must call `owner.valid()` at dispatch. Drain awaits revocation,
child stop, actual direct-child exit and positive descendant-exit evidence. A deadline
is failure, never proof. Only then does the owner close IPC, publish stopped and release
the fence. An unproved exit or failed revocation retains ownership and marks blocked.
Every child's stop and witnesses settle independently: a synchronous throw or asynchronous
rejection cannot skip the others. A stop error (including ESRCH) grants no exit credit;
only the actual exit witness and a positive descendant proof can establish cleanup.
The Node-host join is `createSupervisedPluginHost(owner, host)`. Its trusted controller calls
`start(spec)` only after a workspace lease exists. Registration through `owner.startChild`
precedes the asynchronous host start. It returns the exact run identity and private ready
capabilities; those never enter the lease protocol. A readiness failure stops the registered
run, without forgetting ownership. `ownedPluginNodeProcess` derives both exit and descendant
proofs from that same handle's `exited` result. Only literal `exited:true` passes; unknown,
rejected or pending proofs, other runs' receipts and successful stop commands grant no credit.
A process killed while owning leaves an uncertain record: even when its OS lock is free,
another process refuses takeover. Live migration/automatic upgrade/recovery of uncertain
descendants are deliberately unsupported, as specified for this slice.

The offline scratch join control is `node scripts/plugin-supervisor-host-check.mjs
<fresh-chrome.tar> <evidence-directory>` after the explicit app runtime and Chrome package
builds. It uses the real verified Chrome package and an inert browser with a descendant,
ends the authenticated workspace leases, then checks the exact run receipt, physical group
exit, stopped owner record and supervisor exit. It also checks both SQLite backends exclude
each other and an incumbent survives the first lease closing. It emits counts and booleans only.
The control folder is kept current outside restore sets. A missing descriptor with an
existing ownership fence is uncertain, not a new installation, and is refused too.

The trusted process host supplies `OwnedPluginChild` (not a workspace RPC). An asynchronous
launch uses `owner.startChild(factory)`, reserving the drain barrier before its first await;
drain waits pending starts as well as already tracked children. A rejected start is unproved
cleanup and blocks replacement. `owner.adopt()` is only for synchronous spawn and immediate
registration with no intervening await. The host owns descendant tracking and must not
resolve exit evidence from a timeout.
The POSIX process-group helper is for detached owned groups; it does not claim to find
descendants that deliberately escaped that group. Slice 6 supplies the real browser-tree
cleanup proof. Tests use an inert Node parent/descendant and prove their group is gone.

## App lifetime and delivery boundary

`index.ts` constructs a nonblocking attachment, starts it after workspace recovery admits
startup with proven workspace ownership, and releases it after session shutdown, including
failed startup. Unknown workspace ownership never attaches. Hidden starts
require an explicit scratch global root outside appData, with no live-root fallback.
Normal starts choose `<appData>/@brobot2/plugins`, outside the workspace. The parent must
be owned by this user and unwritable by other accounts (0755 is allowed); the plugin
root/control folder must be private (0700). The app never tightens an existing parent.
Storage refuses writable/unverifiable parents, links, workspace-contained roots and identity changes.
Windows and worker-thread storage fail closed pending their private storage backend;
the socket path must fit the conservative 100-byte POSIX bound.

`createPluginSupervisorLauncher` prepares the app-supplied Node and a self-contained entry
under private content-addressed global directories. The entry and runtime are verified
before reuse. Only these durable paths execute; no app-bundle entry, system Node or PATH
lookup is a fallback. Build/packaging prepares the entry automatically. `index.ts` supplies
this launcher to the existing nonblocking attachment and still only attaches, starts and quits.
The detached entry survives the launching workspace; the last lease proves all child exits
before it releases ownership and exits itself. No production catalogue/key or demo is installed.

The standalone bundle substitutes Node 24's built-in `node:sqlite` for `better-sqlite3` at
build time only. The shared fence API and process-wide holder remain unchanged. Both backends
use SQLite's ordinary file format, rollback/DELETE journal, zero busy timeout and an exclusive
transaction; WAL is never enabled. The bundled Node 24.22.0 opens SQLite without a flag.
The native proof checks mutual exclusion in both directions against the Electron-side backend.

A trusted controller can supply a signed startup plan to the launcher. Its app-pinned public
key and bounded catalogue/archive paths live only in the private launch descriptor; they never
come from lease IPC or package metadata. The entry independently verifies the signature and
package, waits for a lease, and uses the same in-process `createSupervisedPluginHost` seam.
It writes only credential-free run identities for reconciliation. The current app supplies no
plan; the later installer/controller owns that policy. Endpoint capabilities stay in the entry.
The offline check seeds fictional stored profiles and runs the real Chrome package with an
inert fake browser, never installed Chrome or a provider. No manual setup is required from the
person. Any unavailable runtime, entry or host leaves ordinary agents and the app running.
