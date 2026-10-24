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

/** A bounded current-page read; history is read only when the book asks for it. */
export interface OwnNotesPage {
  readonly profile: string
  readonly current: OwnNotesVersion | null
}

export interface AgentOwnNotesReading {
  readonly profile: string
  readonly version: number
  readonly text: string
  readonly author: RulesAuthor | null
  readonly reason: string | null
}

export interface OwnNotesReceipt {
  readonly profile: string
  readonly conversation: string
  readonly version: number
  readonly previousVersion: number
  readonly author: RulesAuthor | null
}

export const OWN_NOTES_TEXT_PROBLEM = 'Use at most 4000 characters of plain text.'
export const OWN_NOTES_REASON_PROBLEM = 'Say why the notes should change.'
export const OWN_NOTES_BASELINE_PROBLEM =
  'Read the current notes, provide their exact version and full text, and say why within the size limit.'
export const OWN_NOTES_STALE_PROBLEM = 'The notes changed; read them again before replacing them.'
export const OWN_NOTES_SAVE_PROBLEM =
  'The notes could not be saved. Read them again before retrying.'
export const OWN_NOTES_WRITE_CALLER_PROBLEM =
  "Only an agent's own running conversation can write its notes."
export const OWN_NOTES_READ_CALLER_PROBLEM = 'Use your own running conversation to read notes.'

/** The host checks the full request before the store repeats the baseline check in its transaction. */
export function ownNotesWriteFits(said: OwnNotesWrite): boolean {
  return (
    Number.isSafeInteger(said.expectedVersion) &&
    said.expectedVersion >= 0 &&
    typeof said.currentText === 'string' &&
    ownNotesTextFits(said.currentText) &&
    typeof said.text === 'string' &&
    ownNotesTextFits(said.text) &&
    typeof said.why === 'string' &&
    said.why.trim() !== '' &&
    ownNotesTextFits(said.why)
  )
}
