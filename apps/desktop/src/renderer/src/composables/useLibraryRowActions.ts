import { ref } from 'vue'
import type { ClientApi } from '../../../shared/client-api'
import type { ImportedFromHome, LibraryEntry, RebuiltLedger } from '../../../shared/runtime-ipc'
import { archiveConversation, restoreConversation } from '../lib/archive-and-delete'
import { readableError } from '../lib/session-record'

/** What the library's row actions need from the page that hosts them. */
interface RowActionHost {
  api: Pick<ClientApi, 'sessions'>
  nameOfProvider: (provider: LibraryEntry['provider']) => string | undefined
  /** Read the rows again, so a row's new state comes from the store. */
  reload: () => Promise<void>
  /** These conversations were archived from a row. */
  archived: (conversations: readonly string[]) => void
}

/** Import, rebuild, archive and restore from a library row, with each row's busy flag and outcome. */
export function useLibraryRowActions({
  api: selectedClientApi,
  nameOfProvider,
  reload: load,
  archived,
}: RowActionHost) {
  /**
   * The outcome of the last import, keyed by `entry.id` — which is the PROVIDER's identity and does
   * not change when the conversation becomes one we hold. It used to be our row id, which is null
   * until the import lands: the key moved at exactly the moment the outcome arrived, so a successful
   * import silently dropped its own confirmation while a failed one kept it.
   */
  type LibraryOutcome = ImportedFromHome & { goneProvider?: LibraryEntry['provider'] }
  const outcomes = ref<Record<string, LibraryOutcome>>({})
  /** Which rows have an import in flight, so a row cannot be pressed twice into the same queue. */
  const importing = ref<Record<string, boolean>>({})
  /**
   * The same, for a rebuild (065) — a SECOND map rather than one shared "busy" flag, because a row can
   * legitimately be offered both and they are different questions: import brings the bytes in, rebuild
   * re-reads the bytes already here.
   */
  const rebuilding = ref<Record<string, boolean>>({})

  /**
   * Import one conversation out of a provider home.
   *
   * Whatever comes back is shown as itself. "Already imported" is an outcome the host names, not a
   * failure — a row that reported it as an error would send someone looking for a bug in a working
   * import.
   */
  async function importEntry(entry: LibraryEntry): Promise<void> {
    if (entry.providerSessionId === null || importing.value[entry.id]) return
    importing.value = { ...importing.value, [entry.id]: true }
    try {
      const sessions = selectedClientApi.sessions
      if (!sessions) throw new Error('Session library is unavailable')
      outcomes.value = {
        ...outcomes.value,
        [entry.id]: await sessions.importUserHomeSession({
          provider: entry.provider,
          providerSessionId: entry.providerSessionId,
        }),
      }
      // Re-read so the row's own state — imported, readable — comes from the store rather than from
      // what the button assumed the press would do.
      await load()
    } catch (cause) {
      outcomes.value = {
        ...outcomes.value,
        [entry.id]: {
          outcome: 'unreadable',
          sessionId: null,
          readable: false,
          note: readableError(cause),
        },
      }
    } finally {
      importing.value = { ...importing.value, [entry.id]: false }
    }
  }

  /**
   * Rebuild one conversation's transcript from its provider's file (065).
   *
   * Offered only where the contract says it is worth offering — see {@link behind}. The row re-reads
   * itself afterwards for the same reason the import does: what state it ended in is the store's to
   * say, not the button's to assume.
   */
  async function rebuildEntry(entry: LibraryEntry): Promise<void> {
    if (entry.recordId === null || rebuilding.value[entry.id]) return
    rebuilding.value = { ...rebuilding.value, [entry.id]: true }
    const originalProvider = entry.provider
    try {
      const sessions = selectedClientApi.sessions
      if (!sessions) throw new Error('Session library is unavailable')
      const result = await sessions.rebuildLedger({ sessionId: entry.recordId })
      outcomes.value = {
        ...outcomes.value,
        [entry.id]: {
          // The rebuild's own words, mapped onto the same row surface the import already uses rather
          // than a second one beside it.
          //
          // ⚠️ **Three buckets, not two** (review). Everything-but-success used to land on
          // `unreadable`, which this surface paints in warning colour — so "BroBot2 is shutting down,
          // so nothing was started" arrived looking like a fault, and a user who read the sentence and
          // then saw the colour would believe the colour. Only the endings where something actually
          // did not work are warned about; the benign ones borrow `up-to-date`, which is what the
          // import path already uses for "you already have this".
          outcome: rebuildOutcome(result.outcome),
          sessionId: entry.recordId,
          readable: result.status?.present ?? false,
          note: rebuildNote(result),
          ...(result.outcome === 'gone' ? { goneProvider: originalProvider } : {}),
        },
      }
      await load()
    } catch (cause) {
      outcomes.value = {
        ...outcomes.value,
        [entry.id]: {
          outcome: 'unreadable',
          sessionId: entry.recordId,
          readable: false,
          note: readableError(cause),
        },
      }
    } finally {
      rebuilding.value = { ...rebuilding.value, [entry.id]: false }
    }
  }

  /**
   * Which of this surface's three tones an ending deserves.
   *
   * `imported` reads as success, `up-to-date` as ordinary, `unreadable` as a warning. The split is by
   * *did something go wrong*, not by *did it rebuild*: a refusal during shutdown and a session that is
   * already whole are both the system working, and colouring them like a failure would contradict the
   * sentence printed beside them.
   */
  function rebuildOutcome(outcome: RebuiltLedger['outcome']): ImportedFromHome['outcome'] {
    switch (outcome) {
      case 'imported':
        return 'imported'
      case 'still-writing':
        return 'still-writing'
      case 'skipped':
      case 'recorded':
      case 'in-use':
      case 'refused':
      case 'stopped':
      case 'superseded':
        // ⛔ **`superseded` reads as ordinary and NOT as a failure** (293 §4). Another writer promoted
        // a different generation from the same file, so the conversation the reader is looking at
        // is whole — this pass simply lost the flip, which is the system working.
        return 'up-to-date'
      case 'failed':
      case 'nothing-readable':
      case 'unknown-session':
      case 'gone':
        return 'unreadable'
    }
  }

  function goneNote(name: string): string {
    return `${name}'s file for this conversation is gone, so it can't be rebuilt.`
  }

  function outcomeNote(outcome: LibraryOutcome | undefined): string | undefined {
    return outcome?.goneProvider === undefined
      ? outcome?.note
      : goneNote(nameOfProvider(outcome.goneProvider) ?? 'The provider')
  }

  /** One line per ending, and none of them is "error". See {@link RebuiltLedger}. */
  function rebuildNote(result: RebuiltLedger): string {
    switch (result.outcome) {
      case 'imported':
        return 'Read again from its file.'
      case 'skipped':
        return 'Nothing to rebuild.'
      case 'nothing-readable':
        return 'Its file holds no readable conversation, so nothing was replaced.'
      case 'still-writing':
        return 'Still being written. Try again later.'
      case 'gone':
        return goneNote('The provider')
      case 'stopped':
        return 'Stopped part-way. The previous transcript is untouched; try again.'
      case 'in-use':
        return 'Open now; rebuild after closing.'
      case 'recorded':
        return 'Keeping the fuller recorded transcript.'
      case 'refused':
        return 'BroCrew is shutting down, so nothing was started.'
      case 'unknown-session':
        return 'There is no record of that conversation here any more.'
      case 'superseded':
        return 'Rebuilt elsewhere just now.'
      case 'failed':
        return `It could not be rebuilt: ${result.status?.failure ?? 'unknown'}. The previous transcript is untouched.`
    }
  }
  /** A restore in flight, and main's words when it refused one, by row. */
  const bringingBack = ref<Record<string, boolean>>({})
  const restoreRefused = ref<Record<string, string>>({})

  /** Rows whose archive is under way, and what main said when it refused one. */
  const archiving = ref<Record<string, boolean>>({})
  const archiveRefused = ref<Record<string, string>>({})

  /** Archive a recorded conversation and every helper below it, from its row. */
  async function archiveEntry(entry: LibraryEntry): Promise<void> {
    if (entry.recordId === null || archiving.value[entry.id]) return
    archiving.value = { ...archiving.value, [entry.id]: true }
    archiveRefused.value = Object.fromEntries(
      Object.entries(archiveRefused.value).filter(([id]) => id !== entry.id),
    )
    try {
      const outcome = await archiveConversation(
        {
          archiveConversation: (input) => {
            const sessions = selectedClientApi.sessions
            if (!sessions) throw new Error('Session library is unavailable')
            return sessions.archiveConversation(input)
          },
        },
        entry.recordId,
      )
      if (!outcome.done) {
        archiveRefused.value = { ...archiveRefused.value, [entry.id]: outcome.refusal }
        return
      }
      archived(outcome.conversations)
      await load()
    } finally {
      archiving.value = { ...archiving.value, [entry.id]: false }
    }
  }

  /** Bring an archived conversation and its archived tree back to the lists. */
  async function restoreEntry(entry: LibraryEntry): Promise<void> {
    if (entry.recordId === null || bringingBack.value[entry.id]) return
    bringingBack.value = { ...bringingBack.value, [entry.id]: true }
    restoreRefused.value = Object.fromEntries(
      Object.entries(restoreRefused.value).filter(([id]) => id !== entry.id),
    )
    try {
      const outcome = await restoreConversation(
        {
          restoreConversation: (input) => {
            const sessions = selectedClientApi.sessions
            if (!sessions) throw new Error('Session library is unavailable')
            return sessions.restoreConversation(input)
          },
        },
        entry.recordId,
      )
      if (!outcome.done) {
        restoreRefused.value = { ...restoreRefused.value, [entry.id]: outcome.refusal }
        return
      }
      await load()
    } finally {
      bringingBack.value = { ...bringingBack.value, [entry.id]: false }
    }
  }

  return {
    outcomes,
    importing,
    rebuilding,
    bringingBack,
    restoreRefused,
    archiving,
    archiveRefused,
    importEntry,
    rebuildEntry,
    archiveEntry,
    restoreEntry,
    outcomeNote,
  }
}
