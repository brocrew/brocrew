# Chrome plugin source

This is a one-time port of the standalone browser server and its closed set of shared helpers. It has no source-project runtime dependency. Only code was copied: no browser profiles, authentication material, downloads, dashboard, proxy, deploy recipes, local builds or integration tests. `COPY-INVENTORY.json` records each copied code file, its original digest, and its destination. Existing comments were removed; client references, source-project defaults and paths were removed. Unit fixtures use fictional profiles.

## Build and check

The package requires Node 22 and installed Google Chrome on macOS arm64. It does not download Chrome. In this folder, run `npm ci --ignore-scripts --no-audit --no-fund`. From the repository root, run `BROCREW_PLUGIN_SOURCE_COMMIT=$(git rev-parse HEAD) node plugins/chrome/build.mjs /absolute/fresh/output`. The output must not exist. This produces a flat runtime: bundled MCP SDK/Express, one pinned `node_modules/playwright-core`, licenses, UI assets, a complete `plugin.json`, and uncompressed USTAR. No symlinks, scripts/hooks, native builds or shell recipes are shipped. Build/dependency tools and source are not in the archive. Package versions are pinned in package-lock.json.

Run the fake-only controls from the repository root: `BROCREW_CHROME_TEST_ARTIFACT=/absolute/fresh/output pnpm exec vitest run --config plugins/chrome/vitest.config.ts`. They exercise authentication, profile enable/window controls, tools and typed tabs through a fake browser, then verify the actual archive with the app’s pure verifier and a public fictional key held only in memory. They never start Chrome. No catalogue is signed with a production key or published by this build; fixture-release.json is test metadata with an invalid example URL.

## Host attachment

The later Node host supplies `BROCREW_CHROME_DATA` (absolute private data root), `BROCREW_CHROME_AUTH` (absolute owner-only JSON file containing distinct mcpToken and adminToken strings, each 32–4096 non-whitespace printable characters), and optional `BROCREW_CHROME_PORT` (default 0). These are server-side configuration only. The supervisor creates the auth file; this package never generates a production credential. The executable refuses missing/invalid inputs, links at the auth leaf, or broad POSIX auth modes. Data, profiles, file roots and all downloads stay under the supplied private root. The Node host owns only the supplied root and its parents, including their Windows ACLs. Within that root, this package checks profile and download directories with lstat and realpath, refuses links even to another internal profile, and checks permissions again when queued actions reach execution; POSIX data directories are 0700, records and reserved files 0600. There is no fallback to a personal browser or workspace. Data remains when the executable stops.

Start with supplied Node: `node /verified/package/server.mjs`. All HTTP binds are loopback. MCP is `/mcp` with the tool token. Health `/healthz`, profile admin `/v1/profiles` and typed tab snapshot `GET /v1/tabs` require the distinct person-admin token; Origin-bearing requests are denied everywhere. Neither token is sent to UI or tools. The later broker keeps those credentials private and enforces person-only admin. Profiles start disabled. Person admin can create/enable a profile or open its window; agents cannot enable profiles. Open window launches the installed Chrome into that private profile; it does not wait for sign-in or reserve a person-step session. Stop with SIGTERM/SIGINT; the ported shutdown handler closes owned profiles and saves visible-session metadata. Proven descendant exit remains the later Node host’s release gate, not a claim of this package.

Tabs return `{tabs:[{id,profile,url,title}]}`, capped at 200, title at 512 characters and URL at 2048. URLs omit credentials/query/fragment; closed/old generations are excluded. Tool calls retain the ported tab-generation and profile checks. No resources/prompts are advertised.

## UI adapter boundary

The assets use only the contract’s window DOM packets: read/subscribe/unsubscribe/proposeConfig, no plugin preload, app global, network API or credential. The future isolated host maps read `{surface:"chrome"}` to an authenticated admin snapshot `{configRevision,profiles,tabs}` and returns data-only `{channel,requestId,result}` replies. It validates method schemas and revision before a BroCrew-owned confirmation; only then may it map create-profile/set-enabled/open-window to the corresponding admin endpoints. The package page proposes actions; it cannot apply changes itself. UI host origin, sender, incarnation and lease enforcement remain slice 12a. The refresh is bounded to one request at a time, every 1.5 seconds. Views render all dynamic labels with textContent.

`manifest-template.json` contains the complete static UI text and method schemas. Package wording and production catalogue signing require separate review. No install, dispatch, provider integration or BroCrew launch code is added here.

Within the plugin’s owner-only private folder, a same-user process swapping a checked directory during download placement is within the accepted trust boundary; these path checks do not provide atomic protection against that race.

## Window targeting and local files

`open_tab` accepts `windowOf:tabId` to join a live tab's window in the same profile, or
`newWindow:true` for a separate visible background window. Otherwise Chrome chooses its most recently active available window. If that differs from the
last tool-used window, the result includes a placement note. Listing tabs does not focus Chrome. Both
`open_tab` and `list_tabs` return a numeric `windowId`; it is an observation, not a selector, and
can change after a restart. Conflicting selectors and dead/foreign anchors are refused.

`open_tab` and `navigate` accept HTTP(S), `file:` URLs, native absolute paths and `about:blank`.
Native paths are encoded as file URLs, preserving spaces, Unicode, `#` and `?`; relative and tilde
paths are rejected. Chrome and the OS determine local-file access; navigation has no upload-root
allowlist. File tabs are eligible for normal mode/session URL restoration. The separate
`download_url` transport stays HTTP(S)-only, including redirects; upload/download guards remain.

Background opening grants no user activation. Its launch policy suppresses Chrome's startup
window and disables popup blocking for this owned process, which also permits site-script popups.
Ordinary opens and separate background windows request inactive CDP creation. An explicit
`windowOf` first uses a private unused background probe. If Chrome chooses another window, the
probe is closed and the explicit request uses the isolated-link fallback; this cross-window
fallback may bring Chrome forward and returns a warning note. It never restores focus afterwards.
Internal probes are not admitted as tool tabs. Failed late creations retain cleanup ownership;
after the finite unresolved-operation limit, creation refuses until the profile is restarted. Run the optional disposable native
focus check in `scripts/native/` to verify frontmost-app/Space behavior on a macOS seat; the opt-in
`BROCREW_CHROME_RUNTIME_TEST=1` tests load real local files with visible bookkeeping forced headless
and do not prove native focus. Never use personal or signed-in profiles for those checks.
