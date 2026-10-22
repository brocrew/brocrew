# Where BroCrew keeps its data

## Early releases

> **Alpha.** BroCrew is early, so expect rough edges. Your agents, conversations and settings live in one folder on your machine: `~/Library/Application Support/@brobot2/desktop/` on a Mac, and `%APPDATA%\@brobot2\desktop` on Windows. The downloaded app and a copy run from source use this same folder, so run only one of them at a time ([details](#recovery-copies)). Before an update changes how your conversations are stored, BroCrew saves a checked copy of them. If you then go back to an older version, it won't open the newer data. It says so, and offers to restore that copy to read your history, with agents stopped. Your newer data is kept, so you can return to it.

BroCrew keeps every conversation, setting and saved API key in one data folder:

- **macOS:** `~/Library/Application Support/@brobot2/desktop`
- **Windows:** `%APPDATA%\@brobot2\desktop`

The app pins this folder when it starts, so its name does not depend on what the app is called. Renaming the app from BroBot2 to BroBot, and then to BroCrew, did not move anyone's data.

## A packaged BroCrew and a development build share it

A BroCrew you install and a BroCrew you run from source (`pnpm dev`) on the same machine use **the same data folder**. They see the same conversations, settings and API keys. Only one of them runs at a time: if you start the second, it brings the first one's window forward and quits.

So, when you test a packaged build on a machine where someone else's BroCrew runs, always give it a folder of its own:

- **macOS:** `BroCrew.app/Contents/MacOS/BroCrew --user-data-dir=/tmp/my-test-folder`
- **Windows:** `BroCrew.exe --user-data-dir=%TEMP%\my-test-folder`

Without `--user-data-dir`, the build opens that person's conversations and settings. That includes opening the app by double-clicking it.

Scripted runs also pass `--brobot-hidden`, which keeps the window out of sight. Leave it off when you test by hand: a hidden build shows no window and no Dock icon.

## What a test build still shares with that person

- **The Keychain entry that seals API keys, on macOS.** BroCrew seals the API keys it saves with a sealing key kept in the Keychain entry `@brobot2/desktop Safe Storage`, whatever data folder it runs on. When a test build saves or reads an API key, macOS asks on that person's screen whether it may use the entry. On someone else's Mac, choose **Deny**, never **Always Allow**. On Windows, the sealing key is kept inside the data folder itself, so nothing is shared.

## Recovery copies

Before an update changes your data, BroCrew saves a checked copy of its database and the app's saved workspace state, so a newer version can't strand your history.

- **When:** on existing data, at the first start of each new version, and before any change to the database's format. Restarting the same version makes no new copy.
- **Where:** in the data folder, under `backups/`. Each copy is checked after it's written. One that isn't complete is never offered.
- **How many:** the two newest, plus the newest copy for each database version while it is at most seven days old. Once a newer copy exists, copies older than seven days are removed; the newest copy is kept regardless of age. Removal runs only after a version has started successfully.
- **Private:** only your user account can read them, as long as it alone can read the data folder. In a data folder other users can read, or on a drive that can't limit who reads it (FAT, exFAT), the copies are as open as the data beside them, and Settings says so beside the workspace. Your saved API keys travel inside the copy as they are in the database: still sealed, and never opened by the copy or the restore.
- **Not copied:** the providers' own folders (an agent's memory, the providers' own transcripts and saved authentication), your project files, and anything you exported. A restore doesn't rewind them.

### If an older BroCrew meets newer data

An older BroCrew doesn't open data a newer one has changed. When a checked copy from before that change exists, it offers **Restore the copy from <date>**. Restoring:

- puts that copy back so you can **read your history up to that date**;
- keeps agents stopped, with nothing sent or started;
- keeps your newer data, set aside in the data folder and untouched.

**Return to the newer data** puts the newer data back exactly as it was. Open it with the newer BroCrew to keep working. To keep working without restoring anything, close the older BroCrew and open the newer one.

If BroCrew can't confirm it's the only app using the folder, or a file changed in a way it doesn't recognise, it stops and says so instead of guessing.

## Starting again from nothing

`pnpm clean-base` empties a data folder back to a fresh install. Without `--dir` it empties the shared folder: the data of every BroCrew on that machine that was not started with its own `--user-data-dir`, installed or run from source. Pass `--dir <folder>` to empty another one, and `--dry-run` to see what would go without removing anything.
