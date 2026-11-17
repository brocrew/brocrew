import type { AgentNotes } from '../../agents'
import type { OwnNotesStore } from './own-notes-store'

export function createSqliteAgentNotes(notes: OwnNotesStore): AgentNotes {
  return {
    async currentOwnNotesOf(profile) {
      return notes.currentOwnNotesOf(profile)
    },
    async ownNotesOf(profile) {
      return notes.ownNotesOf(profile)
    },
    async writeOwnNotes(profile, said, by, at) {
      return notes.writeOwnNotes(profile, said, by, at)
    },
    async undoOwnNotes(profile, baseline, by, at) {
      return notes.undoOwnNotes(profile, baseline, by, at)
    },
    async ownNotesUnread(profile) {
      return notes.ownNotesUnread(profile)
    },
    async markOwnNotesSeen(profile, throughVersion, by) {
      return notes.markOwnNotesSeen(profile, throughVersion, by)
    },
  }
}
