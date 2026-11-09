import type { Stats } from 'node:fs'
import { lstat, realpath, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { errorCode, nodeFs, retrying, writeAtomically } from '../recovery/files'
import {
  readThemeFile,
  THEME_ID,
  THEME_READ_FILES,
  type ThemeFileRead,
  type ThemeReadFiles,
} from './files'

export const ACTIVE_THEME_FILE = 'active-theme.json'
export const THEME_LIBRARY_FOLDER = 'themes'

export function themeRoots(where: {
  readonly appData: string
  readonly userData: string
  readonly resources: string
  readonly hidden: boolean
}): { readonly library: string; readonly builtIns: string; readonly userData: string } {
  return {
    library: where.hidden
      ? join(where.userData, THEME_LIBRARY_FOLDER)
      : join(where.appData, '@brobot2', THEME_LIBRARY_FOLDER),
    builtIns: join(where.resources, THEME_LIBRARY_FOLDER),
    userData: where.userData,
  }
}

export async function themeDirectory(path: string): Promise<string | null> {
  try {
    const before = await lstat(path)
    if (!before.isDirectory() || before.isSymbolicLink()) return null
    const root = await realpath(path)
    const after = await lstat(root)
    return before.dev === after.dev && before.ino === after.ino ? root : null
  } catch {
    return null
  }
}

/** Whether `error` is the system saying a path is not there, rather than refusing to answer. */
export const saysAbsent = (error: unknown): boolean => {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export type ThemeFolderState =
  | { readonly kind: 'here'; readonly root: string }
  | { readonly kind: 'absent' }
  /** The system would not say, even after waiting out a brief hold. */
  | { readonly kind: 'unresolved' }

export async function themeFolderState(
  path: string,
  look: (path: string) => Promise<Stats> = lstat,
): Promise<ThemeFolderState> {
  try {
    const before = await retrying(() => look(path))
    if (!before.isDirectory() || before.isSymbolicLink()) return { kind: 'absent' }
    const root = await retrying(() => realpath(path))
    const after = await retrying(() => look(root))
    return before.dev === after.dev && before.ino === after.ino
      ? { kind: 'here', root }
      : { kind: 'unresolved' }
  } catch (error) {
    return saysAbsent(error) ? { kind: 'absent' } : { kind: 'unresolved' }
  }
}

export type ThemeChoice =
  | { readonly kind: 'chosen'; readonly id: string | null }
  /** The choice file is there but the system would not let it be read. */
  | { readonly kind: 'unresolved' }

export async function readThemeChoice(
  userData: string,
  readFiles: ThemeReadFiles = THEME_READ_FILES,
  look?: (path: string) => Promise<Stats>,
): Promise<ThemeChoice> {
  const folder = await themeFolderState(userData, look)
  if (folder.kind === 'absent') return { kind: 'chosen', id: null }
  if (folder.kind === 'unresolved') return { kind: 'unresolved' }
  let read: ThemeFileRead
  try {
    read = await retrying(async () => {
      const once = await readThemeFile(folder.root, ACTIVE_THEME_FILE, 1024, readFiles)
      if (!once.ok && 'refused' in once && once.refused !== undefined) throw once.refused
      return once
    })
  } catch {
    return { kind: 'unresolved' }
  }
  if (!read.ok) return { kind: 'chosen', id: null }
  try {
    const value: unknown = JSON.parse(read.bytes.toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { kind: 'chosen', id: null }
    if (!('theme' in value) || typeof value.theme !== 'string' || !THEME_ID.test(value.theme))
      return { kind: 'chosen', id: null }
    return { kind: 'chosen', id: value.theme }
  } catch {
    return { kind: 'chosen', id: null }
  }
}

export async function readActiveTheme(userData: string): Promise<string | null> {
  const choice = await readThemeChoice(userData)
  return choice.kind === 'chosen' ? choice.id : null
}

export interface ThemeCommitFiles {
  readonly rename: typeof rename
  /** How the store looks at a theme folder or a set-aside copy; the real one unless given. */
  readonly lstat?: (path: string) => Promise<Stats>
  /** How the store lists a folder of themes; the real one unless given. */
  readonly readdir?: (path: string) => Promise<string[]>
}

export async function writeActiveTheme(
  userData: string,
  id: string,
  files: ThemeCommitFiles = { rename },
): Promise<void> {
  if (!THEME_ID.test(id)) throw new Error('invalid theme id')
  await writeWorkspaceFile(userData, ACTIVE_THEME_FILE, `${JSON.stringify({ theme: id })}\n`, files)
}

export async function writeWorkspaceFile(
  userData: string,
  name: string,
  text: string,
  files: ThemeCommitFiles = { rename },
): Promise<void> {
  const root = await themeDirectory(userData)
  if (!root) throw new Error('unavailable workspace state folder')
  const owned = await lstat(root)
  const target = join(root, name)
  await writeAtomically(target, text, {
    ...nodeFs,
    rename: async (from, to) => {
      const current = await lstat(root)
      if (
        (await themeDirectory(userData)) !== root ||
        current.dev !== owned.dev ||
        current.ino !== owned.ino
      )
        throw new Error('changed workspace state folder')
      await files.rename(from, to)
    },
  })
}
