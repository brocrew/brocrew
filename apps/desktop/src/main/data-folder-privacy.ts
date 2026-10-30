import { realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  accessEntries,
  hasNoAccessList,
  keepToThisUser,
  NotKeptToThisUser,
  othersLetIn,
  windowsAccessLists,
  type AccessLists,
} from './recovery/windows-privacy'

/**
 * Who may read the data folder, and what that asks of the recovery copies kept inside it.
 *
 * The data folder holds the live database, so it is where privacy is decided: a copy is never left
 * more open than the data beside it, and never held to more than it either. A folder BroBot makes
 * for a workspace is made readable by this user alone. A folder a person chose, and that others may
 * read, is not changed without asking: BroBot says so, once in its log and beside the folder in
 * Settings, and goes on.
 */

/** Who may read a folder. */
export type WhoMayRead =
  /** This user alone (and, on Windows, SYSTEM and the Administrators). */
  | { readonly kind: 'this-user' }
  /** Other users of the computer too. */
  | { readonly kind: 'others' }
  /** Anyone: the drive keeps no access lists at all (FAT, exFAT). */
  | { readonly kind: 'anyone' }
  | { readonly kind: 'unknown'; readonly why: string }

export interface PrivacyOptions {
  readonly platform?: NodeJS.Platform
  readonly lists?: AccessLists
  /** A folder's mode, following links; the parents' too. */
  readonly modeOf?: (path: string) => Promise<number>
  /** Where a folder really is, its links followed. */
  readonly realOf?: (path: string) => Promise<string>
}

const modeOnDisk = async (path: string): Promise<number> => (await stat(path)).mode

/**
 * Who may read `folder`. On Windows, its access list, by SID. Elsewhere, its mode and its parents',
 * from where it really is: others may read it when they may pass through it and every folder above
 * it. On macOS a folder's group counts as others too, since every account there shares `staff`;
 * on Linux, where each account usually has a group of its own, only the world's bit counts.
 */
export async function whoMayRead(
  folder: string,
  options: PrivacyOptions = {},
): Promise<WhoMayRead> {
  const platform = options.platform ?? process.platform
  try {
    if (platform === 'win32') {
      const lists = options.lists ?? windowsAccessLists
      const user = await lists.userSid()
      const machine = await lists.machineSid().catch(() => null)
      const sddl = await lists.read(folder)
      if (hasNoAccessList(sddl)) return { kind: 'anyone' }
      return othersLetIn(accessEntries(sddl, machine), user).length > 0
        ? { kind: 'others' }
        : { kind: 'this-user' }
    }
    const modeOf = options.modeOf ?? modeOnDisk
    const passable = platform === 'darwin' ? 0o011 : 0o001
    const real = await (options.realOf ?? realpath)(folder)
    for (let at = real; ; at = dirname(at)) {
      if (((await modeOf(at)) & passable) === 0) return { kind: 'this-user' }
      if (dirname(at) === at) return { kind: 'others' }
    }
  } catch (error) {
    return { kind: 'unknown', why: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * What to tell the person about who may read the data folder, or null when nobody else may. A
 * folder whose readers could not be found out is said in the log, not to the person.
 */
export function sayWhoMayRead(folder: string, who: WhoMayRead): string | null {
  switch (who.kind) {
    case 'this-user':
      return null
    case 'others':
      return (
        `Other users of this computer can read BroCrew’s data folder (${folder}). ` +
        'Limit its permissions, or move it to a folder only you can open.'
      )
    case 'anyone':
      return (
        `BroCrew’s data folder (${folder}) is on a drive that can’t limit who reads it, so ` +
        'anyone with this drive can read BroCrew’s data and its recovery copies.'
      )
    case 'unknown':
      return `BroCrew could not check who can read its data folder (${folder}): ${who.why}`
  }
}

/** This process's answer about its own data folder, found and logged once. */
let aboutTheDataFolder: Promise<WhoMayRead> | null = null

/** Who may read this launch's data folder, found once a process; said in the log when not just this user. */
export function whoMayReadTheDataFolder(
  userData: string,
  options: PrivacyOptions & { readonly log?: (line: string) => void } = {},
): Promise<WhoMayRead> {
  aboutTheDataFolder ??= whoMayRead(userData, options).then((who) => {
    const said = sayWhoMayRead(userData, who)
    if (said !== null) (options.log ?? ((line: string) => console.warn(line)))(said)
    return who
  })
  return aboutTheDataFolder
}

/**
 * The sentence Settings shows beside the workspace at `folder`, or null: when nobody else may read
 * it, when that could not be found out (said in the log only), or when `who` has not answered within
 * `waitMs`, so a slow check never holds the list up.
 */
export async function whatSettingsSays(
  folder: string,
  who: Promise<WhoMayRead>,
  waitMs = 1500,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs)
    timer.unref?.()
  })
  try {
    const answer = await Promise.race([who, late])
    return answer === null || answer.kind === 'unknown' ? null : sayWhoMayRead(folder, answer)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Keeps a recovery folder inside the data folder no more open than the data folder: on Windows it
 * is made readable by this user alone where that can be done. When it cannot be, it is used anyway
 * and the log says why: a recovery copy is worth more than its access list, and it holds only what
 * the data folder holds. Elsewhere its mode does this.
 */
export async function keepNoMoreOpenThanTheData(
  folder: string,
  userData: string,
  options: PrivacyOptions & { readonly warn?: (line: string) => void } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return
  try {
    await keepToThisUser(folder, options.lists, platform)
  } catch (error) {
    const why = error instanceof NotKeptToThisUser ? error.reason : String(error)
    const data = await whoMayRead(userData, options).catch(() => null)
    ;(options.warn ?? ((line: string) => console.warn(line)))(
      data?.kind === 'this-user'
        ? `BroCrew could not make ${folder} readable by you alone, and used it anyway: ${why}`
        : `BroCrew keeps ${folder} as open as its data folder, since it could not make it more private: ${why}`,
    )
  }
}
