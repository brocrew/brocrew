# Chrome 0.1.1 source port

Base: `e7f626a16b1c30559befbc1356d98520e108a369`.
Target: `8b2627f5dbf86f749b53ca0fbf93e3b645b698e2`.
All 42 original inventory source hashes (including package metadata) match the base.
Source inspection used Git show, diff and log only. The source repository is never a runtime or install dependency.

Paths on the left are below `servers/`; destinations are relative to `plugins/chrome/`.

| Every upstream delta file                      | Decision | Destination / reason                                                                                                                                                                                                                |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent-chrome/README.md                         | adapt    | This document and src/browser/launchArgs.ts:19 record the minimal flags, preserve private storage, and omit source deployment/personal instructions.                                                                                |
| agent-chrome/src/browser/chromeBrowser.ts      | adapt    | src/browser/chromeBrowser.ts:262 uses the complete minimal argument builder; private staging, allowAndName CDP, private profile fences and owned shutdown remain.                                                                   |
| agent-chrome/src/browser/chromeBrowser.test.ts | adapt    | test/private-browser.test.ts:69 and test/upstream-parity.test.ts:28 cover complete argument forwarding alongside private download staging/CDP.                                                                                      |
| agent-chrome/src/browser/launchArgs.ts         | port     | src/browser/launchArgs.ts:19 is the minimal argument builder; old comments/environment descriptions removed.                                                                                                                        |
| agent-chrome/src/browser/launchArgs.test.ts    | adapt    | test/launch-args.test.ts:1 pins the exact arguments, modes, sync/extensions, sandbox, Linux exception, forbidden defaults and owned profile argument with fictional paths.                                                          |
| agent-chrome/src/browser/strayBrowsers.ts      | skip     | PID1/temp-profile matching may select other apps or personal automation. No exact-run proof; keep the owned guardian, no global sweep or replacement.                                                                               |
| agent-chrome/src/browser/strayBrowsers.test.ts | skip     | Global sweep omitted; test/upstream-parity.test.ts:131 checks module/hooks absent and owned shutdown/readiness retained.                                                                                                            |
| agent-chrome/src/chrome.integration.test.ts    | adapt    | test/upstream-parity.test.ts:65 asserts back/forward commit wait through actual tool execution; launch-args controls assert popup-blocking/cache flags absent. No upstream real-browser integration setup or personal paths copied. |
| agent-chrome/src/index.ts                      | skip     | Global sweep hooks omitted. src/index.ts:89 retains graceful save/owned close and authenticated readiness.                                                                                                                          |
| agent-chrome/src/security.guard.test.ts        | adapt    | test/upstream-parity.test.ts:28 checks the sole exact owned user-data-dir argument and refuses missing/duplicate/foreign arguments; existing launch/private-directory and source scans remain.                                      |
| agent-chrome/src/tools/index.ts                | port     | src/tools/index.ts:361 uses commit waits only for back/forward; direct URL and reload keep domcontentloaded.                                                                                                                        |
| shared/src/browser/browser-launch.ts           | adapt    | src/shared/browser/browser-launch.ts:35 forwards ignoreDefaultArgs:true only through the explicit guarded option, retaining both private-directory checks around import.                                                            |
| shared/src/browser/browser-launch.test.ts      | adapt    | test/upstream-parity.test.ts:28 uses an inert Playwright driver to assert complete-default forwarding and refusals.                                                                                                                 |
| shared/src/browser/launchGuard.ts              | adapt    | src/shared/browser/launchGuard.ts:79 permits all-default removal only with exactly one argument equal to the validated private profile; retains private-folder validation and the approved generic refusal.                         |
| shared/src/browser/launchGuard.test.ts         | adapt    | test/upstream-parity.test.ts:28 covers exact/duplicate/foreign/missing owned arguments and the legacy refusal; test/launch-guard.test.ts:7 preserves ordinary/default-profile fences.                                               |

## Headline parity already in the matched base

| Behaviour                                                     | Decision / retained implementation                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| show_tab / hide_tab replacing person-named tools              | port, already present: src/tools/showHide.ts:76 and :95; no new tool descriptions. New parity control executes both and checks no ask_ tools.                                                                                                                                             |
| Tools keep working while a person has the visible window      | port, already present: src/windows.ts:11 and src/tools/showHide.ts:15 serialize browser operations without reserving a person session. Parity control navigates while visible and opens another tab after restore.                                                                        |
| Graceful restart restores every eligible visible tab in order | port, already present: src/restoreSession.ts:44 saves eligible tabs; :123 restores HTTP(S), bounded by age/page/time and current profile permissions, with the loop at154. New round-trip control restores three ordered tabs. Existing queued/during-prepare permission controls remain. |
| Shared browser helpers                                        | port, already present: local src/shared/browser/. No import or dependency on the source repository.                                                                                                                                                                                       |

## BroCrew adaptations retained

Every download remains under private staging; CDP stays allowAndName in both modes. There is no OS Downloads fallback. The explicit private data/config roots, separate person/tool authentication, authenticated readiness, host-owned executable, IPC receipt, exact-run exit proof and removed person-step records are unchanged. A new invalid all-default launch uses only the already approved “Plugin unavailable. Try again.” wording. No product UI or tool description is changed.

The server runtime version comes from manifest-template.json, the same release metadata used by the builder. The shared MCP factory requires an explicit version, with no literal fallback. Built-archive health and MCP initialization are checked against the emitted manifest; the app-only integration also runs the real Node host through ready and exact-run exit with an inert browser.

## 0.1.2: Windows

Not an upstream change. On Windows, `src/browser/processes.ts` no longer ends a profile's browsers by process number: the BroCrew plugin host holds every process this server starts in a job object, Playwright's own force-close ends the browser through its handle, and the job ends the rest. The release builds one archive per target from the same source; each manifest names exactly its own target.
