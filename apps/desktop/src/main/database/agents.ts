import type {
  OwnNotesBaseline,
  OwnNotesPage,
  OwnNotesReading,
  OwnNotesUnread,
  OwnNotesVersion,
  OwnNotesWrite,
} from '../../shared/own-notes'
import type { ActedBy } from '../../shared/who-did-it'

export interface AgentNotes {
  currentOwnNotesOf(profile: string): Promise<OwnNotesPage | null>
  ownNotesOf(profile: string): Promise<OwnNotesReading | null>
  writeOwnNotes(
    profile: string,
    said: OwnNotesWrite,
    by: ActedBy,
    at: number,
  ): Promise<OwnNotesVersion | null>
  undoOwnNotes(
    profile: string,
    baseline: OwnNotesBaseline,
    by: ActedBy,
    at: number,
  ): Promise<OwnNotesVersion | null>
  ownNotesUnread(profile: string): Promise<OwnNotesUnread>
  markOwnNotesSeen(profile: string, throughVersion: number, by: ActedBy): Promise<boolean>
}
