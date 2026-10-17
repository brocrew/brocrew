import { describe, expect, it } from 'vitest'
import { VERSION_A, VERSION_B } from '../lib/update-rehearsal.mjs'
import {
  broBotEntries,
  cameBack,
  installFolderOf,
  mainProcesses,
  rowsOf,
  theRestartsOrder,
  waitingOn,
} from '../lib/windows-update-test.mjs'

/**
 * 🔴 **The Windows update, end to end** (the update rehearsal's Windows lane, run on GitHub's
 * Windows runner only). What can be held here, on any computer:
 *
 *  - §1 · how the run reads Windows and the app: PowerShell's rows, the Apps entries, BroCrew's main
 *    processes and the restart's waiting list.
 *  - §2 · read off the app's last lines: it chose to restart, shut down, and only then started the
 *    installer.
 */

describe('§1 · how the run reads Windows and the app', () => {
  it('⚑ PowerShell answers one row as an object and none as nothing: always a list', () => {
    expect(rowsOf('')).toEqual([])
    expect(rowsOf('{"a":1}')).toEqual([{ a: 1 }])
    expect(rowsOf('[{"a":1},{"a":2}]')).toHaveLength(2)
  })

  it('⚑ the Apps entries that are BroCrew’s, and its main processes, not Electron’s helpers', () => {
    expect(
      broBotEntries([
        { DisplayName: 'BroCrew 0.0.1-test.1', DisplayVersion: VERSION_A },
        { DisplayName: 'Git', DisplayVersion: '2' },
        { DisplayName: null },
      ]),
    ).toEqual([{ DisplayName: 'BroCrew 0.0.1-test.1', DisplayVersion: VERSION_A }])
    expect(
      mainProcesses([
        { ProcessId: 1, CommandLine: '"C:\\B\\BroCrew.exe" --updated' },
        { ProcessId: 2, CommandLine: '"C:\\B\\BroCrew.exe" --type=renderer' },
        { ProcessId: 3, CommandLine: null },
      ]).map((row) => row.ProcessId),
    ).toEqual([1, 3])
  })

  it('⚑ where an Apps entry is installed: its InstallLocation, else its uninstaller’s folder', () => {
    expect(installFolderOf({ InstallLocation: 'C:\\P\\BroCrew\\' })).toBe('C:\\P\\BroCrew')
    expect(
      installFolderOf({
        InstallLocation: null,
        UninstallString:
          '"C:\\Users\\r\\AppData\\Local\\Programs\\BroCrew\\Uninstall BroCrew.exe" /currentuser',
      }),
    ).toBe('C:\\Users\\r\\AppData\\Local\\Programs\\BroCrew')
    expect(installFolderOf({ InstallLocation: null })).toBeNull()
  })

  it('⚑ the restart’s waiting list names a conversation', () => {
    const state = {
      kind: 'waiting-to-restart',
      version: VERSION_B,
      stops: {
        conversations: [{ conversation: 'sess_1', turnRunning: true }],
        otherWorkspaces: null,
      },
    }
    expect(waitingOn(state, 'sess_1')).toEqual({ conversation: 'sess_1', turnRunning: true })
    expect(waitingOn(state, 'sess_2')).toBeNull()
    expect(waitingOn({ kind: 'ready' }, 'sess_1')).toBeNull()
  })
})

describe('§2 · the installer starts only after the app has shut down', () => {
  const chose = `updates: restarting to install ${VERSION_B}`
  const shutDown = 'BroCrew shut down in 412ms — stop archive work 0ms · close its sessions 380ms'
  const install = 'updater: Install: isSilent: true, isForceRunAfter: true'
  const executing = `updater: Executing: C:\\Users\\r\\AppData\\Local\\brobot2desktop-updater\\pending\\BroCrew-Setup-${VERSION_B}-x64.exe with args: --updated,/S,--force-run`

  it('🔴 chose to restart → shut down → the installer: held', () => {
    const order = theRestartsOrder(
      ['x', chose, shutDown, 'quit at +3ms', install, executing].join('\r\n'),
      VERSION_B,
    )
    expect(order.problems).toEqual([])
    expect(order.lines).toHaveLength(4)
  })

  it('⛔ an installer started before the teardown reported, or a line missing, is a failure', () => {
    expect(
      theRestartsOrder([chose, install, executing, shutDown].join('\n'), VERSION_B).problems,
    ).toEqual(['the installer started before the teardown had reported'])
    expect(theRestartsOrder([chose, install, executing].join('\n'), VERSION_B).problems).toEqual([
      'no "shutDown" line in the app\'s log',
    ])
  })

  it('🔴 W4.128 · another folder: chose → shut down → BroCrew’s own installer and way back — and not electron-updater’s', () => {
    const folder = 'C:\\Users\\r\\BroBot workspaces\\Research one'
    const ours = `updates: installing C:\\Users\\r\\AppData\\Local\\@brobot2desktop-updater\\pending\\BroCrew-Setup-${VERSION_B}-x64.exe, then reopening BroCrew with --user-data-dir=${folder}`
    expect(
      theRestartsOrder([chose, shutDown, ours].join('\n'), VERSION_B, folder).problems,
    ).toEqual([])
    expect(
      theRestartsOrder([chose, ours, shutDown].join('\n'), VERSION_B, folder).problems,
    ).toEqual(['the installer started before the teardown had reported'])
    expect(
      theRestartsOrder([chose, shutDown, ours, install].join('\n'), VERSION_B, folder).problems,
    ).toEqual(['electron-updater started the installer too, with its own way back'])
    // ⚑ Another folder's line names THAT folder.
    expect(
      theRestartsOrder([chose, shutDown, ours].join('\n'), VERSION_B, 'C:\\Other').problems,
    ).toEqual(['no "installing" line in the app\'s log'])
  })
})

describe('§2b · the BroCrew the update started again', () => {
  const exe = '"C:\\Users\\r\\AppData\\Local\\Programs\\BroCrew\\BroCrew.exe"'
  const folder = 'C:\\Users\\r\\BroBot workspaces\\Research one'

  it('🔴 the default workspace: the one the installer started (`--updated`); another: the one on that folder', () => {
    const rows = [
      { ProcessId: 1, CommandLine: `${exe} --updated` },
      { ProcessId: 2, CommandLine: `${exe} "--user-data-dir=${folder}"` },
      { ProcessId: 3, CommandLine: `${exe} --type=renderer "--user-data-dir=${folder}"` },
    ]
    expect(cameBack(rows, null)).toMatchObject({ ProcessId: 1, testSwitches: false, exact: true })
    expect(cameBack(rows, folder)).toMatchObject({
      ProcessId: 2,
      testSwitches: false,
      exact: true,
      args: [`--user-data-dir=${folder}`],
    })
    expect(cameBack(rows.slice(0, 1), folder)).toBeNull()
  })

  it('⛔ a relaunch with anything more than its way back is caught', () => {
    expect(
      cameBack([{ ProcessId: 6, CommandLine: `${exe} "--user-data-dir=${folder}" /NCRC` }], folder),
    ).toMatchObject({ exact: false, args: [`--user-data-dir=${folder}`, '/NCRC'] })
  })

  it('⛔ a relaunch that carried a test switch is caught', () => {
    expect(
      cameBack(
        [{ ProcessId: 4, CommandLine: `${exe} --brobot-hidden "--user-data-dir=${folder}"` }],
        folder,
      ),
    ).toMatchObject({ testSwitches: true })
    expect(
      cameBack(
        [{ ProcessId: 5, CommandLine: `${exe} --updated --remote-debugging-port=9339` }],
        null,
      ),
    ).toMatchObject({ testSwitches: true })
  })
})
