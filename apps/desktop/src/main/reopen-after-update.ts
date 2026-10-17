import { spawn } from 'node:child_process'
import { builtEnvironment } from './built-launch'

/**
 * After a Windows update, reopen the workspace the app was running.
 *
 * ⚑ **The installer's own way back opens the default workspace only**: NSIS starts BroBot again from
 * its Start-menu shortcut with `--updated` and nothing else (`StartApp`, app-builder-lib's
 * `common.nsh`), and electron-updater passes it no more (`NsisUpdater.doInstall`). So a launch on
 * any other data folder (`--user-data-dir`) would come back on the default one.
 *
 * ⚑ **So the installer carries the way back, told by its own command line, not remembered**: for any
 * other folder BroBot starts the installer it downloaded and checked itself — `--updated /S`, no
 * `--force-run` — and names the folder in one argument (`--brobot-reopen=<folder>`); the installer's
 * `customInstall` (`build/installer.nsh`) starts BroBot on that folder once the files are in place,
 * as the person, and only when the folder is there. ⛔ The arguments are built, never copied from this launch's own (A2's rule): the
 * folder and nothing else — no `--brobot-hidden`, no debugging port.
 *
 * ⚠️ **Not a waiting PowerShell**, the first way this was built: measured on GitHub's Windows runner
 * (`update-test-7`), a PowerShell started detached — without a console, as a process that outlives
 * BroBot must be — never ran its script, though the same script ran attached.
 *
 * ⚑ **The default workspace keeps the installer's own way back**, unchanged.
 */

/** Which workspace BroBot comes back on after the installer. */
export type TheWayBack =
  { readonly on: 'the-default-workspace' } | { readonly on: 'a-folder'; readonly folder: string }

/** The way back for a launch on `userData`, which is the default workspace's folder or another. */
export function theWayBack(userData: string, isTheDefault: boolean): TheWayBack {
  return isTheDefault ? { on: 'the-default-workspace' } : { on: 'a-folder', folder: userData }
}

/** What tells the installer which folder to open BroBot on (`build/installer.nsh`). */
export const REOPEN_SWITCH = '--brobot-reopen='

/**
 * The installer's arguments for a way back on `folder`: silent, as an update, and the folder in one
 * argument — Node quotes it when it holds a space, and the installer reads it to its closing quote,
 * so a folder's own spaces and dashes stay its own. ⚠️ A folder that ends in a backslash (a drive's
 * root) is named with a `.` after it: the installer quotes it again for BroBot, and a backslash
 * before that quote would escape it.
 */
export function installerArgsFor(folder: string): string[] {
  const named = folder.endsWith('\\') ? `${folder}.` : folder
  return ['--updated', '/S', `${REOPEN_SWITCH}${named}`]
}

/**
 * 🔴 **Start the installer, for a way back on `folder`**: detached, as electron-updater starts it, so
 * it outlives this app; in a built environment (`built-launch.ts`). ⚑ BroBot itself is started through the
 * person's shell, and takes the shell's environment. Answers the installer's pid, or `undefined`
 * when it did not start: the caller then takes the installer's own way back.
 */
export function startTheInstaller(options: {
  readonly installer: string
  readonly folder: string
  readonly env: NodeJS.ProcessEnv
}): number | undefined {
  const installer = spawn(options.installer, installerArgsFor(options.folder), {
    detached: true,
    stdio: 'ignore',
    env: builtEnvironment(options.env),
  })
  installer.on('error', () => {})
  installer.unref()
  return installer.pid
}
