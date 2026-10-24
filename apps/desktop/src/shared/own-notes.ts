import type { RulesAuthor } from './own-instructions'
import type { ActedBy } from './who-did-it'

export const OWN_NOTES_CHARACTERS = 4000

export interface OwnNotesBaseline {
  readonly expectedVersion: number
  readonly currentText: string
}

export interface OwnNotesWrite extends OwnNotesBaseline {
  readonly text: string
  readonly why: string
}

export interface OwnNotesVersion {
  readonly version: number
  readonly text: string
  readonly by: ActedBy
  /** Null for a person's edit; an agent's name is captured at the write. */
  readonly author: RulesAuthor | null
  readonly reason: string
  /** Zero restores absence; null is a new edit, including an ordinary clear. */
  readonly restoredFromVersion: number | null
  readonly writtenAt: number
}

export interface OwnNotesReading {
  readonly profile: string
  readonly versions: readonly OwnNotesVersion[]
}

export interface OwnNotesUnread {
  readonly seenThrough: number
  readonly newestAgentVersion: number
  readonly unread: boolean
}

/** Code points, consistently with the book's counter; refuse text SQLite cannot preserve. */
export function ownNotesTextFits(text: string): boolean {
  let characters = 0
  for (const character of text) {
    const code = character.charCodeAt(0)
    if (code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) return false
    if (++characters > OWN_NOTES_CHARACTERS) return false
  }
  return true
}
