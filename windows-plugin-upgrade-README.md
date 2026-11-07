# Disposable Windows installed-plugin upgrade driver

Owner: Arjun (W15.51.1). Integration: Remy (W15.51). Independent review: Teo (W15.51.2). Only Sara dispatches the hosted Windows job.

## Workflow invocation

Keep `windows-plugin-upgrade.mjs` and `windows-plugin-upgrade-driver.ts` together in the carrier. The exact candidate checkout must have its frozen dependencies installed. Node 24 or later is required. Vite's installed esbuild dependency bundles the observer; no extra install is needed.

```powershell
node carrier/windows-plugin-upgrade.mjs --execute `
  --source-root candidate `
  --candidate-dir candidate/apps/desktop/dist `
  --candidate-sha $env:CANDIDATE_SHA `
  --candidate-version 0.2.11 `
  --inputs inputs `
  --evidence evidence
```

For Dara's installer artifact, use the directory containing that exact installer as `--candidate-dir`. Without `--execute`, the script only prints the plan. Execution refuses non-Windows/non-x64 machines, non-GitHub-hosted environments, or a repository other than `brocrew/brocrew`.

`inputs` must contain:

- `BroCrew-Setup-0.1.36-x64.exe` (248268080 bytes; SHA256 `856b87c2fd1306745a881f7e5e97591888695dbf9a15d784b477a85f8f35578f`).
- Exactly one top-level JSON file whose `tag_name` is `v0.1.36`: the public GitHub release API response, including the published asset digest, ID, size and download URL.
- `chrome-win32-x64.tar.gz` (3608965 bytes; SHA256 `d05363044da6b65cacfccee0149772b97c1a7e5dca83c8262bf91e70de84c8a0`).
- `whatsapp-win32-x64.tar.gz` (8228798 bytes; SHA256 `49497b4c15adffefdbc63f8490da542ebae78016975a72c6b55e4476aa3dc769`).

The candidate directory must contain `BroCrew-Setup-0.2.11-x64.exe`. The workflow preserves the single downloaded Setup EXE's original commit-suffixed path, size and supplied hash, then copies those verified bytes into a job-owned directory under that fixed driver name and checks the copied hash again. It retains immutable source/run/artifact/hash receipts. The driver records the actual installer SHA256 and length, then verifies Windows registration, native ProductVersion, running app version `0.2.11`, exact `build.commit == --candidate-sha`, and `build.dirty == false`. A matching build stamp does not independently prove a release artifact's provenance; reconcile the driver hash with the original and copied workflow intake hashes.

The evidence parent may already exist. The driver requires a fresh `evidence/driver` child, so old receipts cannot satisfy this run. Upload the driver's files and workflow input/provenance witnesses even on failure. Do not upload `%APPDATA%/@brobot2`, runtime launch configs, capabilities, or plugin data.

## Sequence and evidence

1. Refuse existing BroCrew data, app registration or app processes. Verify beta release bytes, exact source checkout SHA, both published plugin input archives and live public release/catalogue metadata. Build only the observer/control client bundle from the candidate source.
2. Run the actual beta NSIS `/S`. Require exit 0, one app-id registration, native version 0.1.36, and no installer-started app process.
3. Launch its registered installed executable with loopback CDP. Bind CDP browser PID to the spawned native executable. Read `window.api.getAppInfo()`. Wait for `window.api.plugins.request({kind:'availability'})`, then use `list`, `prepare` when required, and `install` for Chrome/WhatsApp with the returned displayed review consent. Assert both exact installed versions.
4. Bind the beta's running supervisor Node, entry and host scripts to its installed resources. Quit beta through native `taskkill /PID` without `/F`, as in `scripts/upgrade-path.mjs`; require no owned processes and owner `phase:'stopped'`. Record the sealed journal's resolved activation, installed identities, vault archive SHA/size and exact extracted manifest SHA. This is the pre-upgrade boundary. No registry seeding, copied installed-state fixture or candidate-side installation substitutes for it.
5. Run the candidate NSIS over that registration and leave the same `%APPDATA%/@brobot2` fixture in place. Launch the installed candidate and bind its version, build and native PID. Require the exact activation entries from before the upgrade. Bind its live service to candidate installed `plugin-supervisor/entry.cjs`, `plugin-node/node.exe`, runtime identity and all seven host scripts plus license.
6. The source observer creates a distinct disposable workspace and attaches to the existing service without a launch callback. It uses the shipped owner/person-control protocols for route discovery. The same service epoch must survive observation. It sends plain HTTP JSON-RPC MCP `initialize`, `notifications/initialized`, and `tools/list` to both routes. Chrome must expose `list_browser_profiles` and its call must answer without an error with a JSON array. WhatsApp must expose `list_chats`; no WhatsApp account-dependent tool is called.
7. While observer routes, person control and the workspace lease remain held, bind candidate host process receipts to published archive digests, guardian/service parentage and birth times, Windows job/server FILETIME birth identities, installed Node and server preload, and every deployed plugin file's published manifest digest. An atomic native-witness acknowledgement lets the observer proceed with cleanup. Close HTTP sessions where offered, release routes, detach person control, and close the observer lease. Quit the app and require stopped owner, no tracked native processes and matching candidate host exit receipts for both plugin IDs. Recheck retained installation identities. A forced cleanup records failure even if containment succeeds.

`summary.json` is terminal only when `finished` exists. Exit 0 requires all five phases, every assertion, normal shutdown and no failures. `observer-result.json`, `*-installed-service.json`, `candidate-live-hosts.json`, `pre-upgrade-state.json`, `final-host-receipts.json`, `cleanup.json`, native install/run receipts and app logs provide the corresponding witnesses. The entire hosted job's terminal result and artifact integrity still require independent review.

## Scope and current validation

This checks an empty disposable installation with no real account, browser profile, WhatsApp session or provider call. The app receives only an allowlist of Windows system/path environment values; CI/provider credentials and Node injection variables are excluded. The observer does not launch source service, Node runtime, plugin server or product code. Its control client is built from the candidate source, which is a stated instrumentation dependency.

The NSIS install and synthetic state remain on the disposable runner until job teardown; cleanup proves process termination, and does not claim an uninstall or data deletion. The workflow must be ephemeral and retain only the bounded evidence directory.

No main-Mac tests, syntax checks, bundle execution, native Windows execution, source product edits or dispatch were performed by Arjun. Source inspection is complete; Teo's independent check and Sara's actual hosted Windows run remain required. Main risks until that run: beta catalogue/network availability, native installer behavior, cold Windows service startup, native shutdown, and the source observer's bundle/protocol compatibility. Failures are retained as failures; there is no alternate fixture route.
