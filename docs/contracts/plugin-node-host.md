# Plugin Node host

The supervisor constructs `createPluginNodeHost({ root, runtime })` with an explicitly owned private host directory under the global supervisor root and a runtime returned by `preparePluginNodeRuntime({ resourcesRoot, durableRoot })`. There is no live-data, PATH, system Node or package-manager fallback. Windows is refused. The first adapter admits only the reviewed Chrome server contract; other plugins need a reviewed adapter.

The app packages standalone Node 24.22.0 for Mac arm64. `prepare:plugin-node` and the Mac packaging commands prepare it explicitly; a build-time `beforePack` hook covers direct electron-builder calls too. This is not an npm installation hook. The archive and executable hashes are pinned in the build script against the [official release checksums](https://nodejs.org/download/release/v24.22.0/SHASUMS256.txt). The runtime's own license travels in the bundle and its durable private copy. The upstream executable bytes are preserved so they match the runtime descriptor. The bundled binary still needs the app's distribution signing when Mac signing is introduced; that gate must reconcile signed bytes with the descriptor. No package install hook runs in the host.

Preparation writes and fsyncs the executable and trusted bootstrap modules in a unique private stage, verifies their bytes and permissions, then atomically publishes the complete content-addressed directory. Interrupted unpublished stages cannot poison a same-id retry; incomplete stages left by a process death are not admitted or used. Published bytes are verified on reuse and never repaired or overwritten. Older runtimes are not removed. An app replacement cannot invalidate an already running guardian or its next child launch. The runtime descriptor is an app-owned build input, never plugin metadata.

## Supervisor seam

The durable runtime also retains its app-owned metadata. `resumePluginNodeRuntime({directory,id})`
reopens it in the standalone supervisor, recomputes the content identity over metadata and
bootstrap digests, and checks the Node executable digest. It needs no original app resources.
The resumable profile has a distinct content identity; earlier runtime directories stay intact
and are never repaired in place. The runtime and supervisor remain unavailable on Windows.

```ts
const process = await host.start({ package: verifiedPackage, releaseDigest })
const connection = await process.ready()
// connection.mcp() and connection.admin() are private supervisor/broker capabilities.
const result = await process.stop()
await process.exited
await host.stop() // close admission, stop all owned processes
```

`ready()` resolves only after the real entry reports its ephemeral port over per-run private IPC, unauthenticated/wrong-role health and admin requests are refused, authenticated health names the expected version, and authenticated MCP initialization succeeds with that version. It never consumes stdout as authority. MCP/admin tokens are independently generated, confined to a private per-run file and closure, excluded from JSON evidence, and revoked with the process. Ordinary inherited environment variables, Node options, provider settings and credentials are not forwarded. Plugin stdout/stderr are discarded.

Data and downloads live under `root/data/<id>` and survive stops; code lives in an immutable verified release directory. Package trees use the same private staging, verification and atomic publication helper as runtimes, including nested directory fsync. An interrupted unpublished package copy cannot poison a same-digest retry; published package mismatches are refused without repair, and verification never creates missing published directories. Files and directories reject links, unexpected permissions, owners and replacement bytes. `browserExecutable` is an app-owner configuration seam for an installed browser or an inert executable in tests; neither a package nor an agent chooses it. Chrome's real entry retains restore and shutdown hooks, reports only its bound port/run identity, and accepts the host's absolute browser executable.

## Cleanup and receipts

A detached guardian owns a separate server group. The preload awaits a run-bound admission ACK before Node evaluates the package entry or its imports. The live host records the exact group before acknowledging; the guardian only releases entry after both that ACK and the child's waiting handshake. Guardian death before admission therefore cannot leave a package-launched browser behind; missing ownership evidence still returns an unproven result and fences replacement. An app-owned preload prevents Node child launches from detaching, including Playwright's browser launch. Native browser descendants inherit the server's already-owned group, closing the registration gap if the server crashes during spawn. A Playwright forced per-browser group kill fails closed by stopping the whole host; the supervisor must treat that as a host failure, not a clean per-profile operation. Graceful browser close still uses its normal protocol. On stop, server crash, client IPC loss or quit, admission is revoked, TERM is followed by bounded KILL, surviving non-zombie group members are checked through the OS. UID/start-time receipts distinguish admitted leaders, and identity mismatches return an unproven exit without signalling the new process. Zombies cannot execute or retain a browser writer. A guardian crash triggers independent cleanup by the still-live host. Failure to prove exit returns `exited:false`; the supervisor must fence replacement. A timeout is never exit evidence.

On macOS, the guardian forks its durable Node server through the absolute `/usr/sbin/taskpolicy -a` command when that system utility is a root-owned regular executable (no symlink). The utility replaces itself with Node, retaining the exact server PID, process group and private IPC channel. The same owned preload and admission ACK remain mandatory before package evaluation; Chrome and its helpers inherit the server's application scheduling policy and owned group. A missing, non-regular, non-root-owned or non-executable utility selects the existing plain Node command. Other platforms use that command unchanged. An uncertain failure after starting the wrapper is not permission to launch a second server; normal exact-run cleanup and replacement fencing still apply. This policy does not promise to clear an inherited positive POSIX nice value or establish a browser performance result.

After authenticated readiness, the host snapshots only its owned server PID’s scheduling state into the optional `priorityClamped: boolean | null` card fact. The rule is `pri <= 20 OR nice > 0`; malformed, unavailable or non-macOS readings yield null. This diagnostic never grants admission and no raw OS output leaves the host. `taskpolicy -a` requests application scheduling policy but does not clear an inherited utility QoS ceiling or lower an inherited positive nice value, so either correctly remains clamped.

`runId` and `receiptPath` identify private credential-free process/exit receipts, bound to plugin/release/run identities. Auth and launch files are removed after teardown. These receipts are evidence to reconcile, not authorization to signal a reused PID: the supervisor must still establish the recorded owner's death and check the recorded groups. Loss of both guardian and host without a final receipt is an unknown state, never automatic takeover. The supervisor supplies exclusive global ownership; this host does not create a competing ownership lock.

This is not an OS sandbox for hostile signed code. The approved package runs with the person's OS authority; native code deliberately escaping the tracked process groups is outside this adapter's trust contract.

## Checks

Desktop controls use private scratch roots, a fixture app runtime and an inert browser executable. The offline native check `node scripts/plugin-node-host-check.mjs <fresh-chrome.tar> <evidence-directory>` uses the real built Chrome package and verifier, then checks fake-browser descendants on stop, server crash, quit and host-process death. It never starts real Chrome or a provider. Build the real package from `plugins/chrome` with its locked dependencies and disabled install hooks before running that check. Mac development tests require `pnpm --filter @brobot2/desktop prepare:plugin-node`; Linux unit fixtures can copy the CI-provided standalone Node into a fictional app bundle.
