# Logging

BroCrew writes one log file per workspace, `logs/brocrew.log` in its data folder, using
[electron-log 5.4.4](https://github.com/megahertz/electron-log). The plugin service, which runs as its
own process, writes `service.log` in the plugin root. Settings > General > Debug mode shows both
paths.

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
