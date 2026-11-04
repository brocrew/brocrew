# Plugin process host

`createPluginNodeHost({ root, runtime, sharedDataOwner?, hostRequest? })` is the production launch seam. `start({ package, releaseDigest, previousVersion?, previousDataSchema? })` consumes a verified package and its normalized contract. Every plugin ID uses the same launch path. Selected bytes and target compatibility are checked before code is published atomically under `root/packages/<digest>`.

Format 3 declares either a Node entry or a process executable. Node entries use the app's prepared standalone runtime. Absolute commands are used as declared; relative commands present in the package resolve under its published directory; other process commands use ordinary OS lookup. The app's small guardian and process holder also use that runtime for both kinds. Arguments are passed as separate arguments without a shell. The package executable receives executable permissions when published. No browser discovery or domain endpoint probe runs in this path.

```ts
const run = await host.start({ package: verifiedPackage, releaseDigest })
const connection = await run.ready()
const tools = await connection.client.listTools()
const result = await connection.client.callTool({ name, arguments: originalArguments })
await host.restart(verifiedPackage.manifest.id)
await host.stopPlugin(verifiedPackage.manifest.id)
await host.stop()
```

A format 3 instance retains one MCP SDK `Client` at `PluginNodeReady.client`. The owner and its bridge share that connection; it must stay in the owner process and never cross application IPC. MCP initialization establishes readiness. The server's reported version and tool inventory are returned by MCP, without comparing them to a compiled domain inventory or requiring a package version string match. `mcp()` and `admin()` are legacy-only methods and throw for generic instances.

## Bootstrap and transport

The process inherits the ordinary OS environment. The host supplies these additional generic values:

| Variable | Value |
| --- | --- |
| `BROCREW_PLUGIN_DATA` | Existing private data directory, `root/data/<pluginId>` |
| `BROCREW_PLUGIN_SHARED` | Existing `appData/@brobot2/shared/<pluginId>` when an owner supplies shared storage |
| `BROCREW_PLUGIN_RUN_ID` | This running instance's ID |
| `BROCREW_PLUGIN_BOOTSTRAP` | JSON described below |

Bootstrap JSON contains `{api:1, pluginId, instanceId, dataDirectory, sharedDataDirectory?, previousVersion?, previousDataSchema?, dataSchema, host:{api:1,method:'brocrew/host'}}`. The install/update owner supplies the previous installed version and schema. The package owns its data migration. Stop, restart and replacement of code preserve the selected directories and opaque data bytes.

For `mcp:{transport:'stdio'}`, stdin/stdout carry ordinary newline-framed MCP messages. The guardian relays the owned process streams and the SDK attaches to those streams; it does not spawn another copy. Diagnostic output belongs on stderr, which the host consumes.

For `mcp:{transport:'streamable-http',bootstrap:'ready-message'}`, the package writes one JSON line to stdout after its endpoint starts:

```json
{"type":"brocrew-plugin-ready","api":1,"mcp":{"url":"http://127.0.0.1:43210/package-mcp","headers":{"Authorization":"Bearer package-generated-value"}}}
```

`headers` is optional. The host initializes MCP at that endpoint and retains the client. Ordinary startup lines are ignored. The same startup timeout covers waiting for this message and MCP initialization. There are no domain health, profile, status or admin probes.

## Duplex host calls and lifetime

The client advertises experimental `brocrew/host` API 1. A plugin calls that MCP request method with `{api:1,workspaceId,requestId,method,params}`. The host invokes `hostRequest({pluginId,runId}, envelope, signal)` with identity from the launch closure. The package's arguments never choose its installation or instance identity. Host method implementations belong to the generic host-method dispatcher; missing dispatch returns `{error:{code:'unsupported'}}`. The request signal combines MCP cancellation with instance shutdown.

There is at most one managed runtime per plugin ID within each installation's private-data root. Workspaces using the default installation share that runtime. `stopPlugin(id)` and `restart(id)` operate on that ID's retained handle and launch declaration. `restart(spec)` supplies a replacement verified package. Other plugin slots and clients remain running if one process exits, fails readiness or restarts. Stop uses the manifest signal and grace period, then escalates. A timeout returns an unsuccessful exit result; successful signal delivery never stands for actual process exit.

An ordinary lifetime mutex at `root/process-slots/<pluginId>.sqlite` covers the managed runtime, including installed formats 1 and 2. The guardian holds it outside the managed POSIX group or Windows job. On POSIX its launcher signals the captured runtime group and awaits its retained direct ChildProcess exit before reporting completion. On Windows the waiting launcher enters the owned job before it can spawn package code; job termination must reach zero active processes before release. The guardian survives app-supervisor disconnect and follows the same stop path. Native Windows still requires an execution receipt.

Distinct private installations may run concurrently with the same provided shared directory. The package coordinates its shared storage. A plugin that starts detached helpers must stop them when it is told to stop. Uninstall leaves the shared folder intact; removing that folder is a separate decision.

## Installed formats 1 and 2

The normalizer keeps their original manifest bytes, data paths and declared endpoints. During package migration they use the existing guardian/preload launch and IPC listening message. Environment aliases are derived from the package ID, and generic data/shared aliases are supplied too. The host initializes the declared MCP endpoint rather than probing a domain route. Hook-only legacy packages retain their existing hook health protocol. Legacy MCP/admin credentials stay in owner closures, and their bootstrap files are removed after the listening message.

The app's bundled runtime and discovered bootstrap files are copied into a reusable cache. A digest selects that cache; metadata, version strings and repeated byte comparisons are not launch admission. Existing runtime directories remain available through app replacement. Selected plugin package bytes still undergo integrity checking before atomic code publication. Generic format 3 startup does not add a root certificate, process proof journal or package trust policy.

## Checks

`plugin-generic-runner.test.ts` uses fictional Node/process entries, stdio and HTTP MCP, duplex host calls, ordinary inherited environment, stable private/shared paths, opaque fake data, per-ID restart, same-installation serialization, independent private installations and isolated failures. `plugin-launcher-environment.test.ts` checks the actual owner launcher seam with fictional environment values. `plugin-owner-close.test.ts` separates lifecycle notification from physical drain. `plugin-process-guardian.test.ts` controls signal delivery and post-spawn errors so release requires actual managed exit. `plugin-node-host.test.ts` retains the legacy process/guardian controls and verifies interrupted ordinary runtime copying leaves no published partial directory before a successful retry. These are focused process fixtures; they do not establish packaged application, native Windows, provider, real browser or account behavior.
