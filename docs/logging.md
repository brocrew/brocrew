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

Lines have a timestamp, level, part of the app, message and any named facts, for example:

```text
[2026-11-09 20:00:00.000] [error] (ipc) app:save { call: 7, ms: 12, error: 'Disk full' }
```

Debug mode is saved for each workspace. It controls file detail; the former Events tab and
in-app debug views have been removed.

The hidden main/renderer probe is `node scripts/renderer-logging-probe.mjs`. Its build and
Electron dependencies belong to the desktop package; the runner declares the same esbuild version already pinned under Vite.
The executable smoke entry keeps the same-file, Debug off/on/off and native error-default
assertions. A host must be able to launch sandboxed Electron; a startup failure provides no
renderer behavior evidence.

CI runs that probe once in Windows DOM group 1, using the already-installed desktop Electron
and the host display. The former Linux launch failed at Chromium's SUID sandbox-helper startup
before any probe assertions; that failure does not establish logging behavior on either platform.
