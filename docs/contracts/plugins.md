# Plugins contract draft v1

17 October 2026 · slice 1 · proposed implementation contract, not permission to execute plugins

Plugins are global per OS user, under `<appData>/@brobot2/plugins`, outside every workspace. Settings → Plugins searches BroCrew’s curated catalogue and opens plugin-provided configuration pages. Every agent sees the catalogue, including absent plugins; installed tools default to everyone. Chrome is the first plugin. Curated plugins run with the user's rights. No OS sandbox in v1; only the curated catalogue and its checks decide what code runs. Host wording is fixed below; package text needs separate review.

## 1 Package and compatibility envelope

The strict UTF-8 JSON manifest rejects duplicate keys and unknown required features; names/paths are normalized and checked for Windows case collisions, devices, alternate streams, traversal, links and reparse points. Publish only built Node code/dependencies; no shell recipes, install hooks or local builds.

| Manifest v1 field | Frozen meaning |
| --- | --- |
| `format`, `id`, `version`, `sourceCommit` | Format 1; lower-case slug ≤64 characters; package version follows Skills’ 1–80-character contract; `(id, version)` pins immutable bytes. |
| `platforms`, `hostApi`, `toolApi`, `uiApi`, `dataSchema` | Explicit OS/CPU; API ranges use `{major,minMinor,maxMinor,requiredFeatures}` with inclusive bounds. Unknown major/features refuse only the affected attachment/surface; data schema versions are integers. |
| `archive` (catalogue), `files` (manifest) | The app-admitted repository list pins HTTPS archive URL/size/SHA-256 and `manifestSha256`. Package `plugin.json` inventories payload files by size/digest/type, excluding itself. Limits: catalogue 1 MiB/200 entries; manifest 64 KiB; archive 64 MiB; expansion 256 MiB/10,000 files. |
| `server`, `skills`, `serviceTemplates`, `ui` | One Node entry with loopback HTTP MCP/admin paths; skills obey the existing store; optional workspace-local service templates; bundled UI entry/assets, RPC method schemas and reviewed text inventory. |
| `permissions`, `dataCompatibility` | Plain capability description, typed resource read/write policy and supported data schemas; never an OS confinement claim. |

Production reads the fixed JSON list in `brocrew/brocrew` over HTTPS and permits only `brocrew` GitHub release archives, checked by SHA-256/size and payload digests before execution/serving. The 2026-10-18 repository trust decision removes signing and key setup from production; plugins come only from the app’s own repositories. A compromised repository or replayed trusted list remains a risk. The signed-wire verifier below is retained dormant for existing tests; see `plugin-production.md` for the active list format and source policy.

## 2 Incumbent supervisor and rolling upgrades

Supervisor executable and bundled Node live in immutable global version directories, retained while used; no workspace or replaceable app-bundle executable owns the live service. Require proven exclusive global ownership and generation fencing. Today’s `single-instance.ts` permits unknown ownership; that cannot authorize plugin mutation/execution. Hidden tests must supply a scratch global root, never fall back to the real one.

Authenticated `hello` exchanges app build, workspace registration, wire-major/minor range and feature set. V1 is wire major 1; select the highest shared minor and feature intersection. Supervisor DB schema is private to that executable: clients never open it. Initial host/tool/UI APIs are 1.0, negotiating separately. Keep a compatible incumbent, even when a newer BroBot starts. An incompatible framework client keeps normal work and supported cached discovery, but no incompatible plugin tools/UI; it cannot migrate, replace or launch another supervisor. Pre-framework copies retain their existing behaviour and never attach.

A lease binds authenticated workspace registration and host generation to an opaque secret, owner epoch and increasing renewal counter. Heartbeat every 15 seconds; expire after 60 seconds on the supervisor’s monotonic clock. Expired/stale renewal cannot revive it: cancel that workspace’s queued calls, revoke its capabilities, request cancellation of its active call, then require fresh authenticated attachment and projection checks. Other workspaces continue. Expiry proves no process exited.

The last lease starts an atomic `accepting → draining` barrier; late arrivals wait/retry and cannot reopen that owner. A person-requested supervisor upgrade must use compatible incumbent control, announce the global drain, stop admission, obtain attached clients’ quiescence acknowledgements, drain/cancel bounded calls and prove child/descendant exit. Only then publish the executable/schema change and release ownership. Clients reattach with fresh leases; incompatible copies stay plugin-unavailable. If a client cannot cooperate, ask the person to close/update it; never silently force-close it. If no compatible upgrade controller exists, close all copies first. Failed exit, migration or restore leaves plugins unavailable, without replacing the uncertain owner.

<div style="page-break-after: always;"></div>

## 3 Exact configuration-view boundary

Each view gets an ephemeral Electron session and a fresh `brocrew-plugin://<view-uuid>/` origin bound immutably to `(pluginId, releaseDigest)`. Register the handler on **that session’s** `protocol`, not the default session; allow GET/HEAD only for its admitted asset map, with verified bytes/MIME and no cross-package lookup. Register the scheme before app readiness: standard/secure, CSP bypass and service-worker privileges off. Keep web security on.

Use a separate sandboxed `WebContentsView`: context isolation on; Node, Node-in-workers/subframes and webview support off. CSP plus session/network guards deny remote code/network, file URLs, child frames, workers/service workers, objects, navigation, new windows and downloads. Deny both permission checks and requests. Initial host-controlled load is the sole allowed navigation. Plugin code cannot supply a preload.

BroCrew’s fixed minimal preload exports **no API/global object** to the page. DOM packets are `{channel:'brocrew-plugin-ui:v1',requestId,method,payload,configRevision}`; methods are `read`, `subscribe`, `unsubscribe`, `proposeConfig` only. Preload accepts only its own main window/source and exact origin, forwards fixed plugin-RPC messages, and returns data-only replies; no Electron events, sender objects, Node, `ipcRenderer`, Electron channel selectors or downstream credentials cross into page code. Host RPC checks the registered WebContents, `senderFrame === webContents.mainFrame`, its current origin/document generation, installation incarnation and lease. Reject null/stale/child frames. All existing main-app IPC handlers must reject plugin senders; only dedicated plugin RPC accepts them. No caller-selected plugin ID, URL, port, filesystem path or app command is authority.

Strict method/payload schemas cap requests at 64 KiB, four pending requests and two subscriptions per view; snapshot replies are bounded to 1 MiB at one per second. BroCrew-owned Apply shows the exact resource diff and “This change applies to all workspaces.” before revision-checked commit. Login/configuration/admin remain person-only. Closing, navigation attempts, crash, reload, lease loss, upgrade, global restore or uninstall revokes handles, cancels requests/subscriptions, clears session data and destroys the view; recreate with a fresh origin. Follow Electron’s [session protocols](https://www.electronjs.org/docs/latest/api/protocol#using-protocol-with-a-custom-partition-or-session) and [context/IPC rules](https://www.electronjs.org/docs/latest/api/context-bridge).

For the reviewed Chrome profile setup actions, the person's Create, Enable/Disable or Open window button press is confirmation. There is no second BroCrew/native dialog. The fixed person-only route validates the exact action/profile and durable per-install page revision before its own admin call; it grants no agent/broker authority. Other package configuration flows remain subject to their separately reviewed Apply integration. See `plugin-production.md`.

## 4 Everyone reach with bounded authority

Before either provider integration ships, inert probes must prove authenticated discovery/call/stream paths without exposing the server credential. Broker capabilities identify workspace, agent incarnation, installation and operational epoch. Everyone includes existing/new agents in every attached workspace; resource access still follows current person-selected read/write limits at **execution**, not enqueue. Enforce the same rules on tools, resources and prompts; undeclared or unsupported surfaces are absent. Reuse reserved names, collision checks and namespaces before publication.

Default one executing MCP request per plugin; queue limits are 64 total, eight per workspace and two per agent, with 120-second call and queue-wait deadlines. Schedule round-robin across workspaces, then agents; one workspace cannot fill everyone’s service. Cancel stopped callers and reject overflow promptly. At call deadline, require cancellation/exit proof before the next execution; otherwise mark that plugin unavailable. Human login waits release the execution slot; person mutations coordinate with the same data lock. Attribute calls to authenticated agents; identity labels/session IDs/loopback alone grant nothing. Diagnostic fields are allowlisted, never raw SDK/plugin payloads.

**Pairing QR is a secret type, not general status.** Person-only admin returns a tagged static PNG, nonce and expiry: ≤256 KiB, ≤1024×1024, at most 60 seconds’ display. No SVG, HTML, arbitrary URL or remote fetch. Bytes go only to BroCrew’s person-only raster display inside the plugin configuration card; plugin page receives an opaque display handle/expiry. Keep it volatile; exclude bytes/nonces from tools, resources, prompts, catalogue lines, logs, transcripts, BroCrew captures/exports and recovery persistence. Clear image/buffers on expiry, close, crash or teardown; requesting a new code uses a fresh handle. Curated server/UI code must respect this boundary; renderer isolation does not sandbox the server.

<div style="page-break-after: always;"></div>

## 5 Installation identity, restore and data

`installId` is a never-reused UUID created by each successful Install, including reinstall. Ordinary Update/rollback preserves it; `releaseRevision`, `configRevision` and ephemeral owner/auth epochs are separate. A kept-current lifecycle guard outside global restore sets retains each plugin’s latest installation identity, lifecycle sequence and removed marker. Detailed events may compact after durable completion, but **never discard that identity/tombstone floor**: unknown old workspace checkpoints can return. Missing/unreadable guard disables recovery/execution; rotating a credential cannot reconstruct an erased uninstall.

Journal exact person consent and idempotent operation IDs before mutation. Admission requires a committed lifecycle guard, matching global DB activation and a local projection receipt. Prepare states grant no access; recover recorded operations or conditionally compensate only unchanged revisions. Uninstall writes the denying guard first, revokes calls/UI, stops active consumers/children, then removes executables; offline cleanup remains explicitly pending.

Three-stage restore control: **(a)** old workspace snapshot records installation A; **(b)** A is uninstalled and B installed; **(c)** restoring that snapshot must compare A/B, revoke A’s skill origin/choices and old bindings, then ingest B with skills off until explicitly selected. Ordinary updates within A preserve surviving selections and person rules. Reuse the single workspace Skills store, origin-qualified IDs, immutable versions/aliases/limits and revision checks; no second skills catalogue. All-agent tool reach remains the approved global default. Optional service identities/rules/history stay local and are never overwritten.

Global restore drains **all attached workspaces** first, retains the current lifecycle guard and tombstones, restores only compatible state, rotates operational epochs, and rechecks installations before fresh leases. A snapshot cannot resurrect removed A or guess B’s missing metadata/configuration; disable affected plugins for repair. Workspace restore/reset/delete never rewinds global installations or permissions. Preserve concurrent person edits via revision comparisons; conflicts/failed data restore disable rather than overwrite. Stop every writer before backup/migration; refuse irreversible migrations and require tested recovery for reversible ones. No filesystem restore undoes remote effects. Uninstall keeps mutable/credential-bearing data; separate deletion names its recovery-copy scope and excludes the minimal lifecycle guard. Recommend opt-in encrypted backup/export. Windows path/ACL/reparse, verified publication and descendant-ownership checks apply before formats freeze.

## 6 Person-visible words

Only these host strings/templates may be introduced; errors map to them, never raw exceptions. Plugin names, reviewed capability/resource labels, workspace names and counts are escaped bounded substitutions. Each curated package must submit its complete UI/catalogue text inventory for separate approval; no remote/unreviewed copy. Existing unchanged BroCrew strings may be reused.

| Use | Exact approved strings/templates |
| --- | --- |
| Labels/actions | “Plugins”; “Search plugins”; “Install”; “Update”; “Uninstall”; “Configure”; “Apply”; “Cancel”; “Delete data”; “Create service”; “Skip service”; “Login code”; “Request new code”. |
| States | “Available”; “Installed”; “Running”; “Needs setup”; “Unavailable”; “Update available”; “Restarting”; “Cleanup pending”. |
| Global effects | “Installed for all workspaces.”; “This change applies to all workspaces.”; “Uninstall {plugin} from all workspaces. Its data will be kept.”; “Delete {plugin} data and its recovery copies from this computer.” |
| Failures/login | “{plugin} can't start right now.”; “Try again”; “Restart BroCrew if this keeps happening.”; “Plugin unavailable. Try again.”; “Plugin busy. Try again.”; “Plugins are restarting. Try again.”; “Update this copy of BroCrew to use this plugin.”; “Close or update the listed BroCrew copies before upgrading plugins.”; “Plugin cleanup is pending in {workspaces}.”; “Plugin recovery is required. Open Plugins.”; “Login code expired. Request a new code.” |
| Agent catalogue/trust | “Plugins: {plugin} — {state}; tools: {all agents \| none}; service: {service \| none}.”; “Plugins run with your computer user’s rights; they are not sandboxed.” |

After an explicit “Delete data” press, show “Delete {plugin} data and its recovery copies from this computer.” and require a second confirmation before deletion.

## 7 Later lifts and acceptance

Slice numbers refer to the round-3 plan. **L1: 5–6,13**, `src/main/index.ts` supervisor start/attach/quit; shared `single-instance.ts` changes need separate scope. **L2: 3,7–8,13**, `runtime/runtime-host.ts` native start/resume/stop plus Claude/Codex adapters. **L3: 7–9,13**, `skills/prepare-built-in-skills.ts` generated-view publication/cleanup; `runtime/provider-homes.ts` only if needed. **L4: 12**, per-turn plugin context. **L5: 8,11,13**, `index.ts` session/protocol/view lifecycle and dedicated plugin preload. Main-app IPC sender guards must be reviewed with L5. Scratch contract/schema/verifier work needs no lift; no lift authorizes real credentials or protected plants.

Required fixtures: 3–4 mixed-version clients, stale renewal, last/new-lease races, one-client failure, drain/exit, forged/child IPC, per-session assets, QR sinks/expiry, A→uninstall→B→old-restore and live-client global restore. Curated plugins run with the user’s rights, without an OS sandbox; the curated catalogue and its checks decide what runs.

## Appendix A — verifier wire profile, format 1

This appendix defines the concrete format for slice 2. It adds no permission to install or execute. The parsers and verifier are pure: bytes enter and verified bytes leave; no filesystem writes, downloads, process starts, UI or provider-home work occurs. The app supplies exactly one public Ed25519 `KeyObject` to `createPluginVerifier`. There is no default production key. The only private key in the controls is public deterministic fictional fixture material, created in memory and never written as a key file. The production public key is supplied separately.

`catalogue.sig` is a raw 64-byte Ed25519 signature over the **exact downloaded UTF-8 `catalogue.json` bytes**, including whitespace. It is not a JSON envelope, base64 string, hex string or canonicalized reserialization. Verify before parsing. Metadata is strict UTF-8 JSON without a BOM, duplicate decoded keys, unpaired surrogates, nonfinite numbers or trailing data. Unknown object fields are refused. Parsing is bounded to 64 nesting levels and 100,000 JSON values. The normative field validators are `package-schema.ts`; the complete required shapes follow. `?` below means optional only inside a value schema; all other fields are required. Nullable fields must be explicit `null` when absent.

```text
Target = { os: "darwin" | "win32" | "linux", cpu: "arm64" | "x64" }
Api = { major, minMinor, maxMinor, requiredFeatures: [slug] }
Archive = { url, size, sha256, compression: "tar" | "tar.gz" }
Release = { id, version, sourceCommit, platforms: [Target], archive: Archive, manifestSha256, description? }
Catalogue = { format: 1, entries: [Release] }

File = { path, size, sha256, type: "file" }
Server = { entry, mcpPath, adminPath }
Skill = { name, version, path, description, reminder }
ServiceTemplate = { id, rules, provider: "claude" | "codex", model,
                    effort: string | null, requiredTools: [string] }
Asset = { path, mime }
Ui = { entry, assets: [Asset], methodSchemas: {
         read: ValueSchema, subscribe: ValueSchema,
         unsubscribe: ValueSchema, proposeConfig: ValueSchema },
       texts: [{ id, text }] }
Permissions = { description, resources: [{ id, label, read: boolean, write: boolean }] }
Manifest = { format: 1, id, version, sourceCommit, platforms: [Target],
             hostApi: Api, toolApi: Api | null, uiApi: Api | null, dataSchema,
             files: [File], server: Server | null, skills: [Skill],
             serviceTemplates: [ServiceTemplate], ui: Ui | null,
             permissions: Permissions, dataCompatibility: { minSchema, maxSchema } }
```

Integers are nonnegative safe JSON integers; API majors start at 1. Slugs match `[a-z][a-z0-9-]{0,63}` and versions match Skills' `[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}`. Commits are lower-case 40- or 64-digit hex; SHA-256 is lower-case 64-digit hex. Archive URL is credential-free HTTPS, at most 2048 characters, with no fragment. A release's targets are a nonempty unique set, at most the six supported combinations. The manifest repeats the descriptor's identity, commit and ordered target list exactly. Unknown OS/CPU is rejected, and the selected app target must be explicitly included. Duplicate `(id, version)` entries are refused. Optional signed `description` is a nonempty single line of at most 240 characters, with no control characters, unpaired surrogates or Unicode line/paragraph separators. Older catalogues may omit it; curated plugins supply their purpose for agent suggestions. Display names come from the same catalogue presentation used by Settings → Plugins, with the ID as fallback only when no display name exists.

`Api` requires inclusive `minMinor ≤ maxMinor`; required features are unique slugs, at most 64. The default app support is host/tool/UI 1.0 with no features; callers can supply each support independently. Unknown major, required feature or unsupported minor disables that surface. An incompatible host attachment disables its tools/UI, while the package and compatible metadata remain verified. `toolApi` is null exactly when `server` is null; `uiApi` is null exactly when `ui` is null. Data schema must lie within inclusive `minSchema..maxSchema`. No API negotiation is authority to execute.

Server entry must be an inventoried `.js`, `.mjs` or `.cjs` built file. `mcpPath` and `adminPath` are distinct absolute endpoint paths of at most 200 characters, matching `/(segment/)*segment` with ASCII letters, digits, `_` or `-`. They have no host, port, query, shell command, args or environment. Loopback binding belongs to the later supervisor. Skills are capped at 200, with unique names, name-matching `<name>/SKILL.md`, existing Skills version/description/reminder/body limits and exact name/description frontmatter. Bodies are valid UTF-8 without NUL. This verifies inputs for the existing Skills store; it creates no second store. Service templates are capped at 32 with unique IDs; rules reference inventoried bytes. Model/tool labels are at most 128 characters, effort at most 32, required tools unique and capped at 64. This slice performs no provider or model lookup.

UI assets are nonempty, unique and capped at 1024. Entry must be an admitted `text/html` asset. MIME allowlist: `text/html`, `text/css`, `text/javascript`, `application/json`, PNG/JPEG/WebP/GIF, WOFF/WOFF2. Resource declarations are unique by ID and capped at 128; labels ≤160 characters. Permission description ≤2000 characters. Text inventory has unique IDs, at most 512 texts of ≤2000 characters. These labels reject control characters and unpaired surrogates. Verification does **not** confer copy approval: curated release review must separately approve the package's complete text inventory as section 6 requires. It also does not sandbox JS or validate future runtime confinement.

```text
ValueSchema = { type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null",
                properties?: { string: ValueSchema }, required?: [string],
                additionalProperties?: false, items?: ValueSchema,
                enum?: [string | number | boolean | null],
                maxLength?: integer, maxItems?: integer,
                minimum?: number, maximum?: number }
```

This is a local JSON Schema subset, not an executable validator or an arbitrary schema dialect. No `$ref`, remote schema, regex, custom code or unknown keyword is admitted. Each method schema has ≤1024 nodes/16 levels. Objects require `additionalProperties:false`, ≤64 properties, and unique `required` names that exist in properties. Arrays require `items` and `maxItems ≤1024`. Strings require `maxLength ≤65536`. Type-specific keywords cannot appear on another type. Property/required names ≤128 characters. Enum is nonempty, ≤64 matching primitive values, strings ≤1024 characters. Numeric limits are finite and ordered. The later RPC layer must still enforce this subset plus the fixed request/reply byte and concurrency bounds from section 3.

### A.1 Archive and extraction profile

The signed archive digest covers the downloaded bytes, **before** decompression. Format is USTAR, optionally gzip-compressed; the descriptor chooses `tar` or `tar.gz`. Download ≤64 MiB, decompressed archive (headers and padding included) ≤256 MiB, gzip expansion ≤100:1. The bounded built-in decompressor stops at the smaller cap. Summed file sizes ≤256 MiB. At most 10,000 archive entries, including directories and `plugin.json`; metadata file inventory therefore has at most 9,999 files. No bytes are written by this verifier, even on success.

Headers are 512 bytes with `ustar\0` magic, version `00`, correct unsigned checksum, octal numeric fields and ordinary permission bits only. Ownership/timestamps/modes are never applied. Admit only regular files (type `0` or NUL) and empty directories (type `5`). No symlinks, hardlinks, devices, FIFO, reparse metadata, GNU/base-256, sparse/PAX/long-name/other extensions. Link names and device IDs must be empty/zero. Header reserved bytes, payload padding and the trailing region must be zero; require two terminal zero blocks and reject appended nonzero archives.

Names and USTAR prefixes are fatal-decoded UTF-8 without dropping a BOM, then joined and checked against an **ASCII-only** relative-path profile. Each nonempty segment matches `[A-Za-z0-9._@-]+`, has no leading or trailing dot, and is ≤255 bytes; the full path is ≤1024 bytes. `@` admits scoped node_modules names; `+` is not admitted. Refuse every other character, including non-ASCII letters/combining marks, spaces, BOM, controls, backslash, colon and Windows special characters. Empty segments, `.`/`..`, absolute/drive/UNC paths and reserved Windows basenames (`CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`, including extensions) are refused. Preserve spelling, but compare segment keys by ASCII lowercase; reject duplicate entries, ASCII case aliases (including parent directories) and file/parent collisions. Explicit parent directory entries may follow their implied directory once. This intentionally restricts curated package names rather than emulating APFS/NTFS Unicode comparison. Both archive entries and manifest inventories use this rule. The pure verifier cannot inspect a future destination's existing symlinks/junctions; later installation must independently enforce ownership/no-follow/identity checks before publication.

Root `plugin.json` is mandatory and independently matched to `manifestSha256` before parsing. It excludes itself from `files`. Every inventoried file must appear exactly once with matching size/digest, and every regular payload file must be inventoried. Directories have no payload and are not in `files`. All server/skill/service/UI references must name an inventoried file. For built dependency `package.json` files, reject nonempty `scripts`, any `hooks` or `gypfile`; empty scripts objects are allowed. Reject `binding.gyp`, Makefile and `.sh/.bash/.zsh/.bat/.cmd/.ps1` recipes anywhere, including dependencies. Nothing installs dependencies or runs a hook. Package review remains responsible for arbitrary bundled Node behaviour under the approved user-rights trust model.

### A.2 Immutable releases, replay and use

`verifyCatalogue` returns trusted entries, accumulated `(id, version, archiveSha256, manifestSha256)` pins and a package-verification closure selecting only from those signed entries. Supply previously persisted pins through `knownReleases`; the later installer owns persistence. Conflicting archive or manifest digests for a previously pinned release are refused, even if freshly signed. Pins update only after the complete catalogue validates. Catalogue omission or replay of an older valid signed catalogue is accepted: there is no invented time, sequence, expiry, rotation or revocation rule in v1. This is the residual risk in section 1, not protection against all replay.

Results freeze metadata and copy file bytes when read, so a caller cannot mutate retained verified bytes. Inputs are copied before verifying, including archive bytes. Verification errors contain only a fixed category and section 6's “Plugin unavailable. Try again.”, without package text, paths, raw exceptions or causes. No network, disk, process or credential is needed by the inert fixture controls in `plugin-package-verifier.test.ts` and `plugin-package-integrity.test.ts`.
