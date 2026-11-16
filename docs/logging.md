# Logging

BroCrew writes one log file per workspace, `logs/brocrew.log` in its data folder, using
[electron-log 5.4.4](https://github.com/megahertz/electron-log). The plugin service, which runs as its
own process, writes `service.log` in the plugin root. Settings > General > Debug mode shows both
paths. Main and renderer messages use the same app file through electron-log’s built-in renderer bridge.
Renderer console calls, uncaught errors and unhandled rejections use that bridge; Debug mode
filters their detail at the same file transport.

- Errors, warnings and info lines are always written.
- Console warnings/errors are copied to the file. Uncaught exceptions and default unhandled
  rejections are observed without changing the app's crash handling or dialogs.
- Debug mode adds detail, such as each app call's channel, call number and duration.
- Each file rotates at 5 MiB to `<name>.old.log`, replacing the older copy.
- App log writes are asynchronous; the separate plugin service writes synchronously. Quitting
  adds no wait or flush, so queued app lines can be lost.

Database writer summaries are info lines, including with Debug mode off. Once per minute, each
active component reports its transaction count, tables, direct affected-row count, total and
longest transaction milliseconds, and the actual reporting period. These come from the existing
local commit recorder after successful commits, not from SQL tracing. Nested commits merge into
their outer transaction; rolled-back work is not counted. Foreign or uncertain resyncs have no
invented local writer or row totals. `rows` sums native statement changes: it can count a row more
than once and excludes trigger/cascade row counts. Table names include the recorder's existing
known trigger/cascade targets. DDL, raw `exec`, foreign-process writes and writes before observation
are outside this summary.

Component names identify the existing synchronous `store.<method>` door, not a person or agent.
Unscoped writes are `database.direct`; promise continuations do not inherit an ended writer scope.
The observer is attached after the store is constructed. It aggregates numbers and table names,
without writing one line per commit or adding queries. The minute timer does not keep the app
alive. On `will-quit` the last partial summary is queued without waiting for it to reach disk.

Startup phase lines use the `startup` part at info level and report start, end or failure with
phase-local `ms`, alongside launch-relative `elapsed`. Recovery, migrations, pre-open compaction
and initial list attempts use their actual completion paths. Initial list timing covers requests
started before the existing first accepted list; overlapping initial requests can each have a span.
Refused or rejected attempts say failure, and later successful-list state is still owned by the
existing `firstListAcceptedAt` hook. This measures a main-process response, not renderer paint.
The whole launch settlement sweep still requires its runtime owner's exact hook; runtime-host
construction is not logged as a substitute for that sweep.

Live terminal output uses electron-log's existing level colours: errors red and warnings yellow.
Redirected output stays plain. Raw console calls retain their original fallback before logging
opens or when console transport is disabled. Colour is applied only by the console transport;
the file receives undecorated messages. A plain `cat` or `tail` of the stored file stays plain.

Lines have a timestamp, level, part of the app, message and any named facts, for example:

```text
[2026-11-09 20:00:00.000] [error] (ipc) app:save { call: 7, ms: 12, error: 'Disk full' }
```

Debug mode is saved for each workspace. It controls file detail and shows Unmodeled event cards
with expandable raw JSON in conversations. With Debug mode off, those cards are hidden. Unrecognized
provider events are logged either way. The former Events tab has been removed.

The hidden main/renderer probe is `node scripts/renderer-logging-probe.mjs`. Its build and
Electron dependencies belong to the desktop package; the runner declares the same esbuild version already pinned under Vite.
The executable smoke entry keeps the same-file, Debug off/on/off and native error-default
assertions. A host must be able to launch sandboxed Electron; a startup failure provides no
renderer behavior evidence.

CI runs that probe once in Windows DOM group 1, using the already-installed desktop Electron
and the host display. The former Linux launch failed at Chromium's SUID sandbox-helper startup
before any probe assertions; that failure does not establish logging behavior on either platform.
