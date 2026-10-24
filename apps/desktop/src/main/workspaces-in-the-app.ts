import { ipcMain } from './app-ipc'
import { claimPackagedWorkspace, WORKSPACE_LIST_REFUSAL } from './workspace-routing-store'
import { requiresWorkspacePolicy, workspaceRouting } from './workspace-routing'
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { shell, type App, type IpcMainInvokeEvent } from 'electron'
import {
  WORKSPACES_CHANNELS,
  type WorkspaceChanged,
  type WorkspaceDeleted,
  type WorkspaceDeleteVerdict,
  type WorkspaceFolderVerdict,
  type WorkspaceOpened,
  type WorkspaceRow,
} from '../shared/workspaces'
import { builtEnvironment } from './built-launch'
import { defaultDataFolder } from './data-folder'
import { whatSettingsSays, whoMayReadTheDataFolder } from './data-folder-privacy'
import { deleteVerdict, deleteWorkspace, type DeleteContext } from './delete-workspace'
import { whoIsOn } from './one-host-gate'
import {
  argumentsToOpen,
  asStartedOn,
  aWorkspaceName,
  checkWorkspaceFolder,
  createFirstWorkspaceDatabase,
  folderForANewWorkspace,
  forgetWorkspace,
  howToStart,
  isWithin,
  makeWorkspaceFolder,
  nameWorkspace,
  readWorkspaceList,
  rememberWorkspace,
  workspaceListFile,
  workspaceRows,
} from './workspaces'
import { sameFolder, samePath } from './same-folder'
import { DEFAULT_THEME_ID } from './themes/defaults'
import { writeActiveTheme } from './themes/state'

/**
 * 🔴 **W4.131 · A2 — workspaces, wired to Electron**: the list is kept up to date by every person's
 * launch, and the window lists, opens, makes, renames and removes through the channels below. Every
 * rule is `workspaces.ts`'s.
 *
 * ⛔ **Nothing here chooses this launch's folder**, and nothing here is waited on by the launch: it
 * runs once the app does, on the folder Electron already has (the pinned default, or its own
 * `--user-data-dir`).
 */
export function startWorkspaces(options: {
  /** Electron's `app`, handed in: only `index.ts` may hold it (it pins the data folder first). */
  readonly app: App
  /** A hidden launch (every test and smoke): its own list, never added to, and hidden workspaces. */
  readonly hidden: boolean
  /** The folder picker, on the window that asked (a hidden launch answers cancelled). */
  readonly pickFolder: (event: IpcMainInvokeEvent) => Promise<string | null>
}): void {
  const { app } = options
  const userData = app.getPath('userData')
  const requiredPolicy = app.isPackaged && requiresWorkspacePolicy(app.getAppPath())
  const listFile = workspaceListFile({
    appData: app.getPath('appData'),
    userData,
    hidden: options.hidden,
    packaged: app.isPackaged,
  })
  const defaultFolder = defaultDataFolder(app.getPath('appData'))
  /** The account's home: Electron's is the account's, whatever a test's environment says. */
  const home = app.getPath('home')
  /**
   * Where new workspaces are offered: `~/BroBot workspaces/`. ⛔ **A hidden launch — a test — offers
   * them beside its own data folder**, never in a person's home (measured on the live check, which
   * made one there).
   */
  const newWorkspacesHome = options.hidden ? dirname(userData) : home

  // 🔴 **A person's launch adds its own folder** — so one started from a script appears too. ⛔ A
  // list that cannot be written is said in the log and changes nothing about this launch.
  if (!options.hidden) {
    try {
      rememberWorkspace(listFile, userData, Date.now())
    } catch (error) {
      console.error(`BroCrew could not add this workspace to its list (${listFile}):`, error)
    }
  }

  const buildRefusal = (folder: string, toMake = false): string | null => {
    const routing = workspaceRouting(app.getPath('appData'), app.isPackaged, requiredPolicy, {
      readOnly: options.hidden || toMake,
    })
    return toMake ? routing.creationRefusal(folder) : routing.refusal(folder)
  }
  const listed = (): string[] =>
    readWorkspaceList(listFile)
      .map((one) => one.path)
      .filter((folder) => buildRefusal(folder) === null)
  /**
   * The list's own spelling of `folder`, when it lists it: the one its BroBot was started with.
   * ⚑ By spelling — as asked, and as BroBot is started on it — so no listed folder is read: one on a
   * share that is gone cannot hold the window up.
   */
  const listedAs = (folder: string): string | null => {
    const started = asStartedOn(folder)
    return listed().find((one) => samePath(one, folder) || samePath(one, started)) ?? null
  }
  const check = (folder: string, toMake: boolean): WorkspaceFolderVerdict => {
    const refusal = buildRefusal(folder, toMake)
    return refusal
      ? { path: folder, ok: false, refusal, warning: null, exists: false, isBroBots: false }
      : checkWorkspaceFolder(folder, { toMake, listed: listed(), platform: process.platform })
  }
  /**
   * ⛔ **A hidden launch — a test — starts, makes, renames and deletes only folders beside its own**,
   * and never the default one: a test's window can ask for any path, and none of a person's is a
   * test's.
   */
  const outOfReach = (folder: string, toMake = false): string | null =>
    buildRefusal(folder, toMake) ??
    (options.hidden && (sameFolder(folder, defaultFolder) || !isWithin(folder, dirname(userData)))
      ? `A hidden copy of BroCrew works only on the folders beside its own: ${folder}`
      : null)
  /**
   * What a delete is checked against (`delete-workspace.ts`), read when it is asked. ⛔ **A hidden
   * launch — a test — guards the home its own environment names** (`HOME`, Node's `homedir`) and no
   * redirected provider folder, so no test reads the account's `~/.claude`, `~/.codex` or an agent's
   * own provider folder, even to compare: it can delete only beside its own folder anyway. ⚑ A
   * folder this window started a BroBot on moments ago counts as open: it has no gate yet.
   */
  const deleting = (): DeleteContext => ({
    listed: listed(),
    thisOne: userData,
    defaultFolder,
    home: options.hidden ? homedir() : home,
    env: options.hidden ? {} : process.env,
    cwd: process.cwd(),
    platform: process.platform,
    ask: async (folder) => (startingHere(folder) ? 'open' : whoIsOn(folder)),
    outOfReach,
  })
  /**
   * The folders this window started a BroBot on that has not answered at its gate yet: watched
   * until it does, for half a minute at most — one starting has no gate, and one that started and
   * quit is closed again.
   */
  const starting = new Set<string>()
  const STARTING_MS = 30_000
  const watchTheStart = (folder: string): void => {
    starting.add(folder)
    const until = Date.now() + STARTING_MS
    const look = async (): Promise<void> => {
      if ((await whoIsOn(folder)) === 'open' || Date.now() > until) {
        starting.delete(folder)
        return
      }
      setTimeout(() => void look(), 500).unref()
    }
    void look()
  }
  const startingHere = (folder: string): boolean =>
    [...starting].some((one) => samePath(one, folder) || samePath(one, asStartedOn(folder)))
  /** The folder being deleted now, if one is: nothing else is started on it, renamed or deleted. */
  let deletingNow: string | null = null
  const beingDeleted = (folder: string): string | null =>
    deletingNow !== null &&
    (samePath(deletingNow, folder) || samePath(asStartedOn(deletingNow), asStartedOn(folder)))
      ? `This workspace is being deleted: ${folder}`
      : null

  /**
   * Start BroBot on `folder`, nobody's child so it outlives this one (`howToStart`), and put it first
   * in this launch's list — so the chooser shows it at once, before it has started. ⚑ A folder a
   * BroBot already runs on is brought forward by that BroBot: the new one finds it holding the
   * folder, tells it, and leaves (`single-instance.ts`). ⚑ A development build passes its renderer's
   * address on, or the new window would have no page.
   */
  const openOn = async (folder: string): Promise<string | null> => {
    const refusal = buildRefusal(folder)
    if (refusal) return refusal
    if (app.isPackaged && !options.hidden) {
      try {
        claimPackagedWorkspace(app.getPath('appData'), folder)
      } catch {
        return WORKSPACE_LIST_REFUSAL
      }
    }
    const start = howToStart(
      process.execPath,
      argumentsToOpen(folder, {
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        hidden: options.hidden,
      }),
      process.platform,
    )
    const failed = await new Promise<Error | null>((settle) => {
      try {
        const started = spawn(start.command, start.args, {
          detached: true,
          stdio: 'ignore',
          env: builtEnvironment(process.env, app.isPackaged ? [] : ['ELECTRON_RENDERER_URL']),
        })
        started.once('spawn', () => settle(null))
        started.once('error', settle)
        started.unref()
      } catch (error) {
        settle(error as Error)
      }
    })
    if (failed !== null) {
      console.error(`BroCrew could not open ${folder}:`, failed)
      return `BroCrew could not start on this folder: ${failed.message}`
    }
    watchTheStart(folder)
    try {
      rememberWorkspace(listFile, folder, Date.now())
    } catch (error) {
      console.error(`BroCrew could not add ${folder} to its list (${listFile}):`, error)
    }
    return null
  }

  ipcMain.handle(WORKSPACES_CHANNELS.list, (): Promise<WorkspaceRow[]> =>
    workspaceRows({
      listed: readWorkspaceList(listFile).filter((row) => buildRefusal(row.path) === null),
      thisOne: userData,
      defaultFolder,
      ask: (folder) => whoIsOn(folder),
      readersOfThisOne: () => whatSettingsSays(userData, whoMayReadTheDataFolder(userData)),
    }),
  )

  ipcMain.handle(
    WORKSPACES_CHANNELS.open,
    async (_event, path: unknown): Promise<WorkspaceOpened> => {
      const folder = aPath(path)
      if (folder === null) return { opened: false, refusal: 'A workspace is a folder’s path.' }
      const outside = outOfReach(folder) ?? beingDeleted(folder)
      if (outside !== null) return { opened: false, refusal: outside }
      if (sameFolder(folder, userData)) return { opened: true, path: userData, warning: null }
      const verdict = check(folder, false)
      if (!verdict.ok) return { opened: false, refusal: verdict.refusal ?? 'It cannot be opened.' }
      // ⚑ Started as the list spells it, so its gate and its window are the ones already there; a
      // folder not listed yet, as the BroBot there will spell it, so it is listed once.
      const as = listedAs(verdict.path) ?? asStartedOn(verdict.path)
      const refusal = await openOn(as)
      return refusal === null
        ? { opened: true, path: as, warning: verdict.warning }
        : { opened: false, refusal }
    },
  )

  ipcMain.handle(
    WORKSPACES_CHANNELS.create,
    async (_event, asked: unknown): Promise<WorkspaceOpened> => {
      const input =
        typeof asked === 'object' && asked !== null ? (asked as Record<string, unknown>) : {}
      const name = typeof input.name === 'string' ? aWorkspaceName(input.name) : null
      if (name === null) return { opened: false, refusal: 'A new workspace needs a name.' }
      const chosen = input.path === undefined ? null : aPath(input.path)
      if (input.path !== undefined && chosen === null) {
        return { opened: false, refusal: 'A workspace is a folder’s path.' }
      }
      const folder = chosen ?? folderForANewWorkspace(newWorkspacesHome, name)
      const outside = outOfReach(folder, true)
      if (outside !== null) return { opened: false, refusal: outside }
      const verdict = check(folder, true)
      if (!verdict.ok) return { opened: false, refusal: verdict.refusal ?? 'It cannot be made.' }
      if (verdict.isBroBots) {
        return { opened: false, refusal: 'This folder is a workspace already: open it instead.' }
      }
      try {
        const unlimited = await makeWorkspaceFolder(verdict.path, name)
        // A new workspace starts in the new look. Kept before any first database is made, which
        // would otherwise read as data from an earlier version.
        await writeActiveTheme(verdict.path, DEFAULT_THEME_ID).catch((error: unknown) => {
          console.warn(
            `BroCrew made ${verdict.path}, but could not keep its starting look: ${(error as Error).message}`,
          )
        })
        if (
          app.isPackaged &&
          workspaceRouting(app.getPath('appData'), true, requiredPolicy, {
            readOnly: options.hidden,
          }).configured
        ) {
          createFirstWorkspaceDatabase(verdict.path)
        }
        if (unlimited !== null) {
          console.warn(
            `BroCrew made ${verdict.path}, but could not make it readable by you alone: ${unlimited}`,
          )
        }
      } catch (error) {
        return {
          opened: false,
          refusal: `BroCrew could not make this folder: ${(error as Error).message}`,
        }
      }
      const as = asStartedOn(verdict.path)
      const refusal = await openOn(as)
      return refusal === null
        ? { opened: true, path: as, warning: verdict.warning }
        : { opened: false, refusal }
    },
  )

  ipcMain.handle(WORKSPACES_CHANNELS.rename, (_event, asked: unknown): WorkspaceChanged => {
    const input =
      typeof asked === 'object' && asked !== null ? (asked as Record<string, unknown>) : {}
    const folder = aPath(input.path)
    const name = typeof input.name === 'string' ? aWorkspaceName(input.name) : null
    if (folder === null || name === null) {
      return { done: false, refusal: 'A workspace’s new name needs its folder and a name.' }
    }
    // ⛔ Only this workspace or one in the list: a name is written into the folder.
    const as = sameFolder(folder, userData) ? userData : listedAs(folder)
    if (as === null) return { done: false, refusal: `This folder is not in the list: ${folder}` }
    const outside = as === userData ? null : (outOfReach(as) ?? beingDeleted(as))
    if (outside !== null) return { done: false, refusal: outside }
    if (!isAFolder(as)) return { done: false, refusal: `Not found — ${as}` }
    try {
      nameWorkspace(as, name)
    } catch (error) {
      return {
        done: false,
        refusal: `BroCrew could not write the new name: ${(error as Error).message}`,
      }
    }
    return { done: true }
  })

  ipcMain.handle(WORKSPACES_CHANNELS.remove, (_event, path: unknown): WorkspaceChanged => {
    const folder = aPath(path)
    if (folder === null) return { done: false, refusal: 'A workspace is a folder’s path.' }
    if (sameFolder(folder, userData)) {
      return { done: false, refusal: 'This is the workspace this window runs on.' }
    }
    try {
      forgetWorkspace(listFile, folder, Date.now())
    } catch (error) {
      return {
        done: false,
        refusal: `BroCrew could not change its list: ${(error as Error).message}`,
      }
    }
    return { done: true }
  })

  ipcMain.handle(
    WORKSPACES_CHANNELS.checkFolder,
    (_event, path: unknown, toMake: unknown): WorkspaceFolderVerdict | null => {
      const folder = aPath(path)
      return folder === null ? null : check(folder, toMake === true)
    },
  )

  ipcMain.handle(WORKSPACES_CHANNELS.folderFor, (_event, name: unknown): string =>
    folderForANewWorkspace(
      newWorkspacesHome,
      (typeof name === 'string' ? aWorkspaceName(name) : null) ?? 'Workspace',
    ),
  )

  ipcMain.handle(WORKSPACES_CHANNELS.chooseFolder, (event) => options.pickFolder(event))

  ipcMain.handle(
    WORKSPACES_CHANNELS.checkDelete,
    async (_event, path: unknown): Promise<WorkspaceDeleteVerdict> => {
      const folder = aPath(path)
      if (folder === null) return { ok: false, refusal: 'A workspace is a folder’s path.' }
      return deleteVerdict(folder, deleting())
    },
  )

  /** ⛔ **The Trash, never `rm`**: the system's, so a person can put the folder back. */
  ipcMain.handle(
    WORKSPACES_CHANNELS.delete,
    async (_event, path: unknown): Promise<WorkspaceDeleted> => {
      const folder = aPath(path)
      if (folder === null) return { deleted: false, refusal: 'A workspace is a folder’s path.' }
      // ⛔ One at a time: a second ask while one runs would find its folder already gone.
      if (deletingNow !== null) {
        return { deleted: false, refusal: 'A workspace is being deleted. Try again in a moment.' }
      }
      deletingNow = folder
      try {
        return await deleteWorkspace(folder, {
          ...deleting(),
          trash: (one) => shell.trashItem(one),
          listFile,
          now: Date.now(),
        })
      } finally {
        deletingNow = null
      }
    },
  )
}

/** A path from the window: a non-empty string of a sane length, or null. */
function aPath(said: unknown): string | null {
  return typeof said === 'string' && said.trim() !== '' && said.length <= 4096 ? said : null
}

/** Whether `path` is a folder there now. */
function isAFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
