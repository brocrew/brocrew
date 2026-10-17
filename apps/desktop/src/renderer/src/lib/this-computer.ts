import { fileManagerWord } from './message-paths'

/**
 * The words that differ between a Mac and a Windows PC, picked by the platform this window is on:
 * the modifier key, the file manager and where a deleted folder goes.
 */

export function platformHere(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform
}

const onAMac = (platform: string): boolean => /mac/i.test(platform)

/** A shortcut inside a sentence: `⌘K`, or `Ctrl+K` where there is no ⌘ key. */
export function chordSaid(platform: string, key: string): string {
  return onAMac(platform) ? `⌘${key}` : `Ctrl+${key}`
}

/** A shortcut as a key hint on a button: `⌘ K`, or `Ctrl K`. */
export function chordKeys(platform: string, key: string): string {
  return onAMac(platform) ? `⌘ ${key}` : `Ctrl ${key}`
}

/** Where a deleted folder goes, as the computer names it. */
export function binWord(platform: string): string {
  return /win/i.test(platform) ? 'Recycle Bin' : 'Trash'
}

export const fileManagerHere = (): string => fileManagerWord(platformHere())
