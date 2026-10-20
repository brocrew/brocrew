/**
 * Workspaces are independent data folders. Packaged Finder launches reopen their last workspace;
 * explicit restarts retain their folder. Packaged and development builds keep separate lists.
 */

/** Whether a listed workspace runs now, as its folder's gate answers. */
export type WorkspaceState =
  /** A BroBot runs on it now. */
  | 'open'
  /** Its folder is there, and nothing runs on it. */
  | 'closed'
  /** Its folder is not there any more: offered for removal, never made again silently. */
  | 'missing'
  /** Its gate could not be asked (a path too long for it), or did not answer in time. */
  | 'unknown'

/** One workspace in the chooser. */
export interface WorkspaceRow {
  readonly path: string
  /** Its own `workspace.json` name, else `Default` for the default folder, else the folder's name. */
  readonly name: string
  readonly isDefault: boolean
  /** The workspace this window runs on. */
  readonly isThisOne: boolean
  readonly state: WorkspaceState
  /** When it was last opened by a person's launch; `null` for this one when it never was. */
  readonly lastOpenedAt: number | null
  /**
   * For this one, a sentence saying who else may read its data, when anyone besides this user may;
   * `null` otherwise.
   */
  readonly readers: string | null
}

/** What a folder offered as a workspace is, and whether it may be one. */
export interface WorkspaceFolderVerdict {
  readonly path: string
  /** It may be opened (or made) as a workspace. */
  readonly ok: boolean
  /** Why not, in words for the person; `null` when it may. */
  readonly refusal: string | null
  /** It may, but: a sentence for the person (the folder's path is too long to guard against a second
   * BroBot on it, or a cloud service syncs it); `null` when there is nothing to say. */
  readonly warning: string | null
  /** The folder is there now. */
  readonly exists: boolean
  /** It is a BroBot workspace already (it holds a database). */
  readonly isBroBots: boolean
}

/** What opening or making a workspace answered. */
export type WorkspaceOpened =
  | { readonly opened: true; readonly path: string; readonly warning: string | null }
  | { readonly opened: false; readonly refusal: string }

/** A new workspace: its name, and its folder — `folderFor(name)`'s answer unless the person chose. */
export interface NewWorkspace {
  readonly name: string
  readonly path?: string
}

/** A workspace's new name. */
export interface WorkspaceRename {
  readonly path: string
  readonly name: string
}

/** What renaming a workspace, or removing one from the list, answered. */
export type WorkspaceChanged =
  { readonly done: true } | { readonly done: false; readonly refusal: string }

/**
 * 🔴 **W4.151 · F092 — whether a workspace may be deleted, and what would go**, for the confirmation:
 * its folder, how much it holds, and its pasted pictures' folder when that goes with it.
 */
export type WorkspaceDeleteVerdict =
  | {
      readonly ok: true
      /** The folder that would go to the Trash, as the disk spells it. */
      readonly path: string
      /** What it holds, in bytes, and how many files — its pasted pictures' included. */
      readonly bytes: number
      readonly files: number
      /** Of those, the files in its working folder that its conversations made (`brobot-workspace/`). */
      readonly workingFiles: number
      /** …and its exported conversations (`exports/`), which a reset keeps and this does not. */
      readonly exports: number
      /** Its pasted pictures' folder (`<folder>-pasted-images`), which goes with it; `null` for none. */
      readonly pastedImages: string | null
      /** It may, but: a sentence for the person; `null` when there is nothing to say. */
      readonly warning: string | null
    }
  | { readonly ok: false; readonly refusal: string }

/** What deleting a workspace answered: what went to the Trash, or why nothing did. */
export type WorkspaceDeleted =
  | {
      readonly deleted: true
      /** The folders moved to the Trash: the workspace's, and its pasted pictures' when it had them. */
      readonly trashed: readonly string[]
      /** Done, but: a sentence for the person (the list could not be written); `null` for none. */
      readonly warning: string | null
    }
  | { readonly deleted: false; readonly refusal: string }

/** The window's workspaces wire: `ipcRenderer.invoke` channels. */
export const WORKSPACES_CHANNELS = {
  list: 'workspaces:list',
  open: 'workspaces:open',
  create: 'workspaces:create',
  rename: 'workspaces:rename',
  remove: 'workspaces:remove',
  checkFolder: 'workspaces:check-folder',
  folderFor: 'workspaces:folder-for',
  chooseFolder: 'workspaces:choose-folder',
  checkDelete: 'workspaces:check-delete',
  delete: 'workspaces:delete',
} as const
