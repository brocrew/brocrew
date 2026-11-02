# Disposable native endpoint focus check

Qualification tooling only, never plugin runtime. A NEW explicit hands-off execution authorization is required for every native execution. Only disposable non-signed-in profiles; no personal Chrome profiles/windows. Compile/bundle preparation never runs observer/reset/browser. Pin source, observer/reset binaries and bundle hashes; run from the clean canonical root:

`node <bundle> <observer> <new-receipt.json> <reset-helper> <explicit-BroCrew-PID> <reviewed-full-SHA>`

Identify BroCrew's main PID before the window. Its creation/bundle identity is checked before the reset helper requests activation; a mismatch skips that reset and is recorded. The helper is test setup before EACH case, never product focus restoration. Positive control FIRST shows an owned calibration browser and must detect its owned PID; that browser must then exit. Qualification captures its own browser PID before target work.

The endpoint protocol defines the runtime verdict. Only positive-control failure, screen lock, unidentified owned Chrome PID, or failure to confirm cleanup stops the run. All4 cases (first visible launch, plain open_tab, matching windowOf, newWindow) are attempted regardless of earlier results. A case passes when BOTH1s/4s frontmost observations have identified ancestry outside owned Chrome roots and global/per-display Space is unchanged. Missing endpoint evidence is a failed case; later cases still run. Explicit cross-window fallback/opposed ordering remain separately native UNRUN unless authorized.

Every precision check is diagnostic only: sample age, native/receipt gaps, calibration, reset stability, capture timing, intermediate changes and run duration never decide a case or stop later cases. Raw native/wall timestamps, Node receipt times, ancestry and measured calibration/drift remain in the receipt; uncertainty>100ms warns. There is no fatal75s run budget,20ms precision gate, or placement/window-ID gate. Observer polling targets5ms and cannot exclude shorter excursions; receipt timing does not measure native delivery latency.

Tool/reset/metadata errors are retained separately from endpoint verdicts. An endpoint pass does not establish that a failed operation completed. Per-operation waits are bounded so errors can be recorded and later cases attempted; timeout errors themselves do not terminate the four-case driver. Ownership/cleanup retains late launch handles and exact disposable roots. Cleanup PASS requires observer/owned-process exit, no pending launches, and root removal; elapsed cleanup time is recorded rather than a separate gate. No broad profile matching or cleanup occurs. No new native run, publication or landing is authorized by source/harness readiness.

# Two-Space check for the BroCrew helper

`two-space-check.ts` and `space-observer.swift` measure whether opening agent tabs brings Chrome to the front or switches Space. They are qualification tooling only: a NEW explicit authorization from the person is required for every run. They use throwaway, never-signed-in profiles under `/tmp`, never touch the person's own Chrome, never move a window or change a setting, and stop only the Chrome processes they started. The observer uses public AppKit and CoreGraphics only (activation and Space-change notifications, the frontmost app every 100 ms, owner process and on-screen state of windows). It needs no Screen Recording permission.

The person keeps TextEdit in front on Desktop 1 and moves the test windows to Desktop 2 when the run says so. Each measured action waits until TextEdit has been in front for 3 s with no test window on the current Space. It then samples the front app at t0, t0+1 s and t0+4 s and keeps every event. An action passes only when TextEdit stays in front throughout, Chrome is never activated, the Space never changes, and no test window shows up on the current Space in any 100 ms sample, launches included.

Prepare, from a clean checkout of the commit under test (repeat in a checkout of the commit before the change for step A):

```sh
xcrun swiftc -O scripts/native/space-observer.swift -o /tmp/brocrew-space-observer
plugins/chrome/node_modules/.bin/esbuild scripts/native/two-space-check.ts --bundle --platform=node \
  --format=esm --target=node22 --external:playwright-core --outfile=plugins/chrome/node_modules/.two-space/check.mjs
node plugins/chrome/node_modules/.two-space/check.mjs /tmp/brocrew-space-observer <new-receipt.json> <steps>
```

Steps, in the order given: `A` (before the change: cross-window `open_tab`, expected to fail at least once), then `E,B,D,F,S,C,H,X,G` on the commit under test:

- E: visible launches with the helper;
- B: cross-window `open_tab` with the helper;
- D: `open_tab` with no window named;
- F: one agent click, recorded only;
- S: five idle minutes, then placements;
- C: helper switched off in `chrome://extensions`;
- H: restart with it off, then "Turn on";
- X: a profile with extensions off;
- G: `show_tab`, where activation is expected.

An action whose call fails, whose result is not what its step requires (the helper ready at launch, the tab in the requested window, the fallback note when it is off), or whose observer evidence is missing (the observer stopped, fewer samples than its 100 ms cadence, an unknown window state in any sample) is a FAIL, kept apart from the focus failures. Step A must show at least one focus failure and step G must show Chrome activated. The receipt holds every verdict, sample and event, and the cleanup proof.
